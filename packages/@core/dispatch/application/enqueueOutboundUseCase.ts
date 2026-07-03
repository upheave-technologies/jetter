// =============================================================================
// Application — Enqueue Outbound Use Case
// =============================================================================
// Validates and persists one or more outbound Messages — one per channel —
// ready to be picked up by the dispatch worker batch processor.
//
// Optionally creates a new Thread if createThread is true and no threadId
// is provided. The first channel and its external address anchor the thread.
//
// Flow:
//   1. For each channel, verify an adapter is registered via engine.getAdapter()
//   2. For each channel, verify the adapter can send via canSend()
//   3. For each channel, verify an external address is present in externalAddresses
//   4. If createThread is true and no threadId given, create and persist a Thread
//   5. For each channel, call domain createOutboundMessage() factory to validate
//      and assemble the partial message
//   6. Append id and timestamps to each message
//   7. Bulk-persist all messages via messageRepo.saveBulk()
//   8. Return the array of created Messages
// =============================================================================

import { createId } from '@paralleldrive/cuid2';
import { Result } from '../../../shared/lib/result';
import { Message, MessagePayload, createOutboundMessage } from '../domain/message';
import { Thread, createThread } from '../domain/thread';
import { canSend } from '../domain/channel';
import { IMessageRepository } from '../domain/messageRepository';
import { IThreadRepository } from '../domain/threadRepository';
import { DispatchEngine } from '../domain/engine';
import { DispatchError } from './dispatchError';

// =============================================================================
// SECTION 1: TYPES
// =============================================================================

export type EnqueueOutboundInput = {
  channels: string[];
  payload: MessagePayload;
  /** Maps each channel to the external address to deliver to */
  externalAddresses: Record<string, string>;
  sourceType?: string;
  sourceId?: string;
  principalId?: string;
  /** ID of an existing thread to associate messages with */
  threadId?: string;
  /** When true and no threadId is provided, create a new thread before enqueuing */
  createThread?: boolean;
  metadata?: Record<string, unknown>;
};

// =============================================================================
// SECTION 2: USE CASE FACTORY
// =============================================================================

/**
 * Higher-order function that creates the enqueueOutbound use case.
 * Follows the factory pattern for dependency injection.
 */
export const makeEnqueueOutboundUseCase = (
  messageRepo: IMessageRepository,
  threadRepo: IThreadRepository,
  engine: DispatchEngine
) => {
  return async (data: EnqueueOutboundInput): Promise<Result<Message[], DispatchError>> => {
    try {
      // Step 1–3: Pre-flight checks for every requested channel
      for (const channel of data.channels) {
        const adapter = engine.getAdapter(channel);
        if (!adapter) {
          return {
            success: false,
            error: new DispatchError(
              `No adapter registered for channel "${channel}"`,
              'NO_ADAPTER'
            ),
          };
        }

        if (!canSend(adapter)) {
          return {
            success: false,
            error: new DispatchError(
              `Adapter for channel "${channel}" does not support sending`,
              'CHANNEL_CANNOT_SEND'
            ),
          };
        }

        const address = data.externalAddresses[channel];
        if (!address || address.trim().length === 0) {
          return {
            success: false,
            error: new DispatchError(
              `No external address provided for channel "${channel}"`,
              'VALIDATION_ERROR'
            ),
          };
        }
      }

      // Step 4: Optionally create a thread anchored on the first channel
      let resolvedThreadId = data.threadId;

      if (data.createThread && !resolvedThreadId) {
        const firstChannel = data.channels[0];
        const firstAddress = data.externalAddresses[firstChannel];

        const threadResult = createThread({
          channel: firstChannel,
          externalAddress: firstAddress,
          ...(data.principalId !== undefined && { principalId: data.principalId }),
          ...(data.sourceType !== undefined && { sourceType: data.sourceType }),
          ...(data.sourceId !== undefined && { sourceId: data.sourceId }),
        });

        if (!threadResult.success) {
          return {
            success: false,
            error: new DispatchError(threadResult.error.message, 'VALIDATION_ERROR'),
          };
        }

        const now = new Date();
        const thread: Thread = {
          id: createId(),
          ...threadResult.value,
          createdAt: now,
          updatedAt: now,
        };

        await threadRepo.save(thread);
        resolvedThreadId = thread.id;
      }

      // Step 5–6: Build a full Message for each channel
      const now = new Date();
      const messages: Message[] = [];

      for (const channel of data.channels) {
        const address = data.externalAddresses[channel];

        const messageResult = createOutboundMessage({
          channel,
          externalAddress: address,
          payload: data.payload,
          ...(data.principalId !== undefined && { principalId: data.principalId }),
          ...(resolvedThreadId !== undefined && { threadId: resolvedThreadId }),
          ...(data.sourceType !== undefined && { sourceType: data.sourceType }),
          ...(data.sourceId !== undefined && { sourceId: data.sourceId }),
          ...(data.metadata !== undefined && { metadata: data.metadata }),
        });

        if (!messageResult.success) {
          return {
            success: false,
            error: new DispatchError(messageResult.error.message, 'VALIDATION_ERROR'),
          };
        }

        const message: Message = {
          id: createId(),
          ...messageResult.value,
          createdAt: now,
          updatedAt: now,
        };

        messages.push(message);
      }

      // Step 7: Bulk-persist all messages in a single round-trip
      await messageRepo.saveBulk(messages);

      // Step 8: Return created messages
      return { success: true, value: messages };
    } catch {
      return {
        success: false,
        error: new DispatchError('Failed to enqueue outbound messages', 'SERVICE_ERROR'),
      };
    }
  };
};
