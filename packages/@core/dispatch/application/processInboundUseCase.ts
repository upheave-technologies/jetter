// =============================================================================
// Application — Process Inbound Use Case
// =============================================================================
// Fetches a single received inbound Message, routes it to the first matching
// handler registered on the DispatchEngine, and persists the outcome. If the
// handler returns a response payload, an outbound reply is enqueued on the
// same thread and channel.
//
// Flow:
//   1. Fetch the message by ID — MESSAGE_NOT_FOUND if missing
//   2. Verify direction is 'inbound' — VALIDATION_ERROR if not
//   3. Verify status is 'received' or 'failed' — VALIDATION_ERROR if not
//   4. Mark as processing and persist the status change
//   5. Resolve matching handlers — if none match, mark as failed + NO_HANDLER
//   6. Execute the first (highest-priority) handler; fetch thread if available
//   7. If handler returned a response payload, create and persist an outbound reply
//   8. Mark message as processed or failed based on handler result
//   9. Return the processing result
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
import { HandlerResult } from '../domain/handler';
import { MessageStatus } from '../domain/message';
import { IMessageRepository } from '../domain/messageRepository';
import { IThreadRepository } from '../domain/threadRepository';
import { DispatchEngine } from '../domain/engine';
import { DispatchError } from './dispatchError';

// =============================================================================
// SECTION 1: TYPES
// =============================================================================

export type ProcessInboundInput = {
  messageId: string;
};

export type ProcessInboundResult = {
  message: Message;
  handlerName: string;
  handlerResult: HandlerResult;
  autoReply?: Message;
};

// =============================================================================
// SECTION 2: USE CASE FACTORY
// =============================================================================

/**
 * Higher-order function that creates the processInbound use case.
 * Follows the factory pattern for dependency injection.
 */
export const makeProcessInboundUseCase = (
  messageRepo: IMessageRepository,
  threadRepo: IThreadRepository,
  engine: DispatchEngine
) => {
  return async (data: ProcessInboundInput): Promise<Result<ProcessInboundResult, DispatchError>> => {
    try {
      // Step 1: Fetch the message
      const message = await messageRepo.findById(data.messageId);
      if (!message) {
        return {
          success: false,
          error: new DispatchError(
            `No message found with ID "${data.messageId}"`,
            'MESSAGE_NOT_FOUND'
          ),
        };
      }

      // Step 2: Verify the message is inbound
      if (message.direction !== 'inbound') {
        return {
          success: false,
          error: new DispatchError(
            'Cannot process an outbound message as inbound',
            'VALIDATION_ERROR'
          ),
        };
      }

      // Step 3: Verify the message is in a processable status
      const processableStatuses: MessageStatus[] = ['received', 'failed'];
      if (!processableStatuses.includes(message.status)) {
        return {
          success: false,
          error: new DispatchError(
            `Message status "${message.status}" is not eligible for processing`,
            'VALIDATION_ERROR'
          ),
        };
      }

      // Step 4: Transition to 'processing' and persist
      const processingMessage = markAsProcessing(message);
      await messageRepo.updateStatus(processingMessage.id, { status: processingMessage.status });

      // Step 5: Resolve matching handlers
      const handlers = engine.resolveHandlers(processingMessage);
      if (handlers.length === 0) {
        const now = new Date();
        const failedMessage = markAsFailed(processingMessage, now);
        await messageRepo.updateStatus(failedMessage.id, {
          status: failedMessage.status,
          retryCount: failedMessage.retryCount,
          lastAttemptAt: failedMessage.lastAttemptAt,
        });
        return {
          success: false,
          error: new DispatchError(
            `No handler matched inbound message "${data.messageId}"`,
            'NO_HANDLER'
          ),
        };
      }

      // Step 6: Execute the first (highest-priority) handler
      const handler = handlers[0];
      let thread = undefined;
      if (processingMessage.threadId !== undefined) {
        const found = await threadRepo.findById(processingMessage.threadId);
        if (found !== null) {
          thread = found;
        }
      }

      const handlerResult = await handler.handle(processingMessage, thread);

      // Step 7: If the handler returned a response payload, create an outbound reply
      const now = new Date();
      let autoReply: Message | undefined;

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
          autoReply = replyMessage;
        }
      }

      // Step 8: Mark message as processed or failed based on handler result
      let finalMessage: Message;
      if (handlerResult.processed) {
        finalMessage = markAsProcessed(processingMessage, now);
        await messageRepo.updateStatus(finalMessage.id, {
          status: finalMessage.status,
          processedAt: finalMessage.processedAt,
        });
      } else {
        finalMessage = markAsFailed(processingMessage, now);
        await messageRepo.updateStatus(finalMessage.id, {
          status: finalMessage.status,
          retryCount: finalMessage.retryCount,
          lastAttemptAt: finalMessage.lastAttemptAt,
        });
      }

      // Step 9: Return the processing result
      return {
        success: true,
        value: {
          message: finalMessage,
          handlerName: handler.name,
          handlerResult,
          ...(autoReply !== undefined && { autoReply }),
        },
      };
    } catch {
      return {
        success: false,
        error: new DispatchError('Failed to process inbound message', 'SERVICE_ERROR'),
      };
    }
  };
};
