// =============================================================================
// Application — Send Reply Use Case
// =============================================================================
// Creates and persists an outbound reply Message within an existing Thread.
// The thread determines the channel and external address for the reply.
//
// Flow:
//   1. Fetch the thread by threadId — return THREAD_NOT_FOUND if missing
//   2. Verify thread.status is 'active' — return VALIDATION_ERROR if closed
//   3. Retrieve the adapter for the thread's channel — return NO_ADAPTER if missing
//   4. Verify the adapter can send via canSend() — return CHANNEL_CANNOT_SEND if not
//   5. Call domain createOutboundMessage() with the thread's channel and address
//   6. Append id and timestamps to assemble the full Message
//   7. Persist via messageRepo.save()
//   8. Return the created Message
// =============================================================================

import { createId } from '@paralleldrive/cuid2';
import { Result } from '../../../shared/lib/result';
import { Message, MessagePayload, createOutboundMessage } from '../domain/message';
import { canSend } from '../domain/channel';
import { IMessageRepository } from '../domain/messageRepository';
import { IThreadRepository } from '../domain/threadRepository';
import { DispatchEngine } from '../domain/engine';
import { DispatchError } from './dispatchError';

// =============================================================================
// SECTION 1: TYPES
// =============================================================================

export type SendReplyInput = {
  threadId: string;
  payload: MessagePayload;
  metadata?: Record<string, unknown>;
};

// =============================================================================
// SECTION 2: USE CASE FACTORY
// =============================================================================

/**
 * Higher-order function that creates the sendReply use case.
 * Follows the factory pattern for dependency injection.
 */
export const makeSendReplyUseCase = (
  messageRepo: IMessageRepository,
  threadRepo: IThreadRepository,
  engine: DispatchEngine
) => {
  return async (data: SendReplyInput): Promise<Result<Message, DispatchError>> => {
    try {
      // Step 1: Fetch the thread
      const thread = await threadRepo.findById(data.threadId);
      if (!thread) {
        return {
          success: false,
          error: new DispatchError(
            `No thread found with ID "${data.threadId}"`,
            'THREAD_NOT_FOUND'
          ),
        };
      }

      // Step 2: Verify the thread is still active
      if (thread.status !== 'active') {
        return {
          success: false,
          error: new DispatchError('Thread is closed', 'VALIDATION_ERROR'),
        };
      }

      // Step 3: Verify an adapter exists for the thread's channel
      const adapter = engine.getAdapter(thread.channel);
      if (!adapter) {
        return {
          success: false,
          error: new DispatchError(
            `No adapter registered for channel "${thread.channel}"`,
            'NO_ADAPTER'
          ),
        };
      }

      // Step 4: Verify the adapter can send
      if (!canSend(adapter)) {
        return {
          success: false,
          error: new DispatchError(
            `Adapter for channel "${thread.channel}" does not support sending`,
            'CHANNEL_CANNOT_SEND'
          ),
        };
      }

      // Step 5: Build the outbound message via domain factory
      const messageResult = createOutboundMessage({
        channel: thread.channel,
        externalAddress: thread.externalAddress,
        payload: data.payload,
        threadId: thread.id,
        ...(thread.principalId !== undefined && { principalId: thread.principalId }),
        ...(data.metadata !== undefined && { metadata: data.metadata }),
      });

      if (!messageResult.success) {
        return {
          success: false,
          error: new DispatchError(messageResult.error.message, 'VALIDATION_ERROR'),
        };
      }

      // Step 6: Assemble the full Message with id and timestamps
      const now = new Date();
      const message: Message = {
        id: createId(),
        ...messageResult.value,
        createdAt: now,
        updatedAt: now,
      };

      // Step 7: Persist
      await messageRepo.save(message);

      // Step 8: Return the created message
      return { success: true, value: message };
    } catch {
      return {
        success: false,
        error: new DispatchError('Failed to send reply', 'SERVICE_ERROR'),
      };
    }
  };
};
