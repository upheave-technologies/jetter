// =============================================================================
// Application — Process Inbound Batch Use Case
// =============================================================================
// Fetches a batch of unprocessed inbound messages, routes each to the first
// matching handler, and aggregates the results into a report. If a handler
// returns a response payload, an outbound reply is created and persisted.
//
// Flow:
//   1. Fetch up to batchSize unprocessed inbound messages
//   2. For each message:
//      a. Mark as processing; persist status
//      b. Resolve matching handlers; if none, mark as failed, increment noHandler
//      c. Execute first handler; fetch thread if message belongs to one
//      d. If handler returned a response, create and persist an outbound reply
//      e. Mark message as processed or failed based on handler result
//   3. Aggregate per-message outcomes into an InboundBatchReport
//   4. Return the report
// =============================================================================

import { createId } from '@paralleldrive/cuid2';
import { Result } from '../../../shared/lib/result';
import {
  Message,
  createOutboundMessage,
  markAsProcessing,
  markAsProcessed,
  markAsFailed,
} from '../domain/message';
import { IMessageRepository } from '../domain/messageRepository';
import { IThreadRepository } from '../domain/threadRepository';
import { DispatchEngine } from '../domain/engine';
import { DispatchError } from './dispatchError';

// =============================================================================
// SECTION 1: TYPES
// =============================================================================

export type ProcessInboundBatchInput = {
  batchSize: number;
};

export type InboundBatchReport = {
  processed: number;
  succeeded: number;
  failed: number;
  noHandler: number;
  autoReplies: number;
  failures: Array<{ messageId: string; error: string }>;
};

// =============================================================================
// SECTION 2: USE CASE FACTORY
// =============================================================================

/**
 * Higher-order function that creates the processInboundBatch use case.
 * Follows the factory pattern for dependency injection.
 */
export const makeProcessInboundBatchUseCase = (
  messageRepo: IMessageRepository,
  threadRepo: IThreadRepository,
  engine: DispatchEngine
) => {
  return async (
    data: ProcessInboundBatchInput
  ): Promise<Result<InboundBatchReport, DispatchError>> => {
    try {
      // Step 1: Fetch unprocessed inbound messages
      const messages = await messageRepo.findUnprocessedInbound(data.batchSize);

      const report: InboundBatchReport = {
        processed: messages.length,
        succeeded: 0,
        failed: 0,
        noHandler: 0,
        autoReplies: 0,
        failures: [],
      };

      if (messages.length === 0) {
        return { success: true, value: report };
      }

      // Step 2: Process each message
      for (const message of messages) {
        const now = new Date();

        // Step 2a: Mark as processing and persist
        const processingMessage = markAsProcessing(message);
        await messageRepo.updateStatus(processingMessage.id, { status: processingMessage.status });

        // Step 2b: Resolve matching handlers
        const handlers = engine.resolveHandlers(processingMessage);
        if (handlers.length === 0) {
          const failedMessage = markAsFailed(processingMessage, now);
          await messageRepo.updateStatus(failedMessage.id, {
            status: failedMessage.status,
            retryCount: failedMessage.retryCount,
            lastAttemptAt: failedMessage.lastAttemptAt,
          });
          report.noHandler += 1;
          report.failed += 1;
          report.failures.push({
            messageId: message.id,
            error: 'No handler matched the inbound message',
          });
          continue;
        }

        // Step 2c: Execute the first (highest-priority) handler
        const handler = handlers[0];
        let thread = undefined;
        if (processingMessage.threadId !== undefined) {
          const found = await threadRepo.findById(processingMessage.threadId);
          if (found !== null) {
            thread = found;
          }
        }

        let handlerResult;
        try {
          handlerResult = await handler.handle(processingMessage, thread);
        } catch (handlerError) {
          const failedMessage = markAsFailed(processingMessage, now);
          await messageRepo.updateStatus(failedMessage.id, {
            status: failedMessage.status,
            retryCount: failedMessage.retryCount,
            lastAttemptAt: failedMessage.lastAttemptAt,
          });
          report.failed += 1;
          report.failures.push({
            messageId: message.id,
            error: handlerError instanceof Error ? handlerError.message : 'Handler threw an unexpected error',
          });
          continue;
        }

        // Step 2d: If handler returned a response payload, create an outbound reply
        if (handlerResult.response !== undefined && thread !== undefined) {
          const replyResult = createOutboundMessage({
            channel: thread.channel,
            externalAddress: thread.externalAddress,
            payload: handlerResult.response,
            threadId: thread.id,
            ...(thread.principalId !== undefined && { principalId: thread.principalId }),
          });

          if (replyResult.success) {
            const replyMessage: Message = {
              id: createId(),
              ...replyResult.value,
              createdAt: now,
              updatedAt: now,
            };
            await messageRepo.save(replyMessage);
            report.autoReplies += 1;
          }
        }

        // Step 2e: Mark message as processed or failed based on handler result
        if (handlerResult.processed) {
          const processedMessage = markAsProcessed(processingMessage, now);
          await messageRepo.updateStatus(processedMessage.id, {
            status: processedMessage.status,
            processedAt: processedMessage.processedAt,
          });
          report.succeeded += 1;
        } else {
          const failedMessage = markAsFailed(processingMessage, now);
          await messageRepo.updateStatus(failedMessage.id, {
            status: failedMessage.status,
            retryCount: failedMessage.retryCount,
            lastAttemptAt: failedMessage.lastAttemptAt,
          });
          report.failed += 1;
          report.failures.push({
            messageId: message.id,
            error: handlerResult.error ?? 'Handler reported failure without a specific error',
          });
        }
      }

      // Step 3–4: Return the aggregated report
      return { success: true, value: report };
    } catch {
      return {
        success: false,
        error: new DispatchError('Failed to process inbound batch', 'SERVICE_ERROR'),
      };
    }
  };
};
