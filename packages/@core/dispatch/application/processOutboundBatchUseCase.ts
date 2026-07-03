// =============================================================================
// Application — Process Outbound Batch Use Case
// =============================================================================
// Fetches a batch of pending outbound messages across all registered channels,
// marks them as processing, attempts delivery through each channel's adapter,
// then persists the final status for each message.
//
// Flow:
//   1. List all registered adapters; filter to those that can send
//   2. For each sendable adapter, fetch pending outbound messages up to
//      perChannelLimit = ceil(batchSize / sendableAdapterCount)
//   3. If includeRetries is true (default), also fetch failed messages eligible
//      for retry up to ceil(batchSize * 0.2)
//   4. Mark all fetched messages as 'processing' and bulk-update their status
//   5. For each message, attempt delivery via its channel's adapter:
//        - No adapter or adapter cannot send → skip (increment skipped)
//        - Adapter send succeeds            → markAsSent, increment delivered
//        - Adapter send fails permanently   → markAsBounced, increment bounced
//        - Adapter send fails transiently   → markAsFailed, increment failed
//   6. Bulk-update all final statuses in one round-trip
//   7. Return an OutboundBatchReport
// =============================================================================

import { Result } from '../../../shared/lib/result';
import {
  Message,
  markAsProcessing,
  markAsSent,
  markAsFailed,
  markAsBounced,
} from '../domain/message';
import { canSend } from '../domain/channel';
import { IMessageRepository } from '../domain/messageRepository';
import { DispatchEngine } from '../domain/engine';
import { DispatchError } from './dispatchError';

// =============================================================================
// SECTION 1: TYPES
// =============================================================================

export type ProcessOutboundBatchInput = {
  batchSize: number;
  /** When true (default), also include failed messages eligible for retry */
  includeRetries?: boolean;
};

export type OutboundBatchReport = {
  processed: number;
  delivered: number;
  failed: number;
  bounced: number;
  skipped: number;
  failures: Array<{ messageId: string; channel: string; error: string }>;
};

// =============================================================================
// SECTION 2: USE CASE FACTORY
// =============================================================================

/**
 * Higher-order function that creates the processOutboundBatch use case.
 * Follows the factory pattern for dependency injection.
 */
export const makeProcessOutboundBatchUseCase = (
  messageRepo: IMessageRepository,
  engine: DispatchEngine
) => {
  return async (
    data: ProcessOutboundBatchInput
  ): Promise<Result<OutboundBatchReport, DispatchError>> => {
    try {
      const includeRetries = data.includeRetries !== false;

      // Step 1: Identify all adapters capable of sending
      const sendableAdapters = engine.listAdapters().filter(canSend);

      // Step 2: Fetch pending messages evenly distributed across channels
      const pendingMessages: Message[] = [];

      if (sendableAdapters.length > 0) {
        const perChannelLimit = Math.ceil(data.batchSize / sendableAdapters.length);
        const perChannelResults = await Promise.all(
          sendableAdapters.map((adapter) =>
            messageRepo.findPendingOutbound(adapter.channel, perChannelLimit)
          )
        );
        for (const channelMessages of perChannelResults) {
          pendingMessages.push(...channelMessages);
        }
      }

      // Step 3: Optionally append failed messages eligible for retry
      if (includeRetries) {
        const retryLimit = Math.ceil(data.batchSize * 0.2);
        const retryMessages = await messageRepo.findFailedForRetry('outbound', retryLimit);
        pendingMessages.push(...retryMessages);
      }

      if (pendingMessages.length === 0) {
        return {
          success: true,
          value: {
            processed: 0,
            delivered: 0,
            failed: 0,
            bounced: 0,
            skipped: 0,
            failures: [],
          },
        };
      }

      // Step 4: Transition all fetched messages to 'processing' and bulk-update
      const processingMessages = pendingMessages.map(markAsProcessing);
      await messageRepo.updateStatusBulk(
        processingMessages.map((m) => ({ id: m.id, changes: { status: m.status } }))
      );

      // Step 5: Attempt delivery for each message
      const report: OutboundBatchReport = {
        processed: processingMessages.length,
        delivered: 0,
        failed: 0,
        bounced: 0,
        skipped: 0,
        failures: [],
      };

      const now = new Date();
      const finalUpdates: Array<{
        id: string;
        changes: Partial<
          Pick<
            Message,
            | 'status'
            | 'retryCount'
            | 'lastAttemptAt'
            | 'deliveredAt'
            | 'processedAt'
            | 'providerResponse'
          >
        >;
      }> = [];

      for (const message of processingMessages) {
        const adapter = engine.getAdapter(message.channel);

        if (!adapter || !canSend(adapter)) {
          // No adapter or adapter lost send capability — skip this message
          report.skipped += 1;
          report.failures.push({
            messageId: message.id,
            channel: message.channel,
            error: adapter
              ? `Adapter for channel "${message.channel}" cannot send`
              : `No adapter registered for channel "${message.channel}"`,
          });
          continue;
        }

        const sendResult = await adapter.send!({
          to: message.externalAddress,
          payload: message.payload,
          metadata: message.metadata,
        });

        if (sendResult.success) {
          const sentMessage = markAsSent(message, now);
          report.delivered += 1;
          finalUpdates.push({
            id: sentMessage.id,
            changes: {
              status: sentMessage.status,
              deliveredAt: sentMessage.deliveredAt,
              ...(sendResult.providerResponse !== undefined && {
                providerResponse: sendResult.providerResponse,
              }),
            },
          });
        } else if (sendResult.permanent) {
          const bouncedMessage = markAsBounced(message);
          report.bounced += 1;
          report.failures.push({
            messageId: message.id,
            channel: message.channel,
            error: 'Permanent delivery failure — address bounced',
          });
          finalUpdates.push({
            id: bouncedMessage.id,
            changes: {
              status: bouncedMessage.status,
              lastAttemptAt: now,
              ...(sendResult.providerResponse !== undefined && {
                providerResponse: sendResult.providerResponse,
              }),
            },
          });
        } else {
          const failedMessage = markAsFailed(message, now);
          report.failed += 1;
          report.failures.push({
            messageId: message.id,
            channel: message.channel,
            error: 'Transient delivery failure',
          });
          finalUpdates.push({
            id: failedMessage.id,
            changes: {
              status: failedMessage.status,
              retryCount: failedMessage.retryCount,
              lastAttemptAt: failedMessage.lastAttemptAt,
              ...(sendResult.providerResponse !== undefined && {
                providerResponse: sendResult.providerResponse,
              }),
            },
          });
        }
      }

      // Step 6: Persist all final status changes in one batch
      if (finalUpdates.length > 0) {
        await messageRepo.updateStatusBulk(finalUpdates);
      }

      // Step 7: Return the report
      return { success: true, value: report };
    } catch {
      return {
        success: false,
        error: new DispatchError('Failed to process outbound batch', 'SERVICE_ERROR'),
      };
    }
  };
};
