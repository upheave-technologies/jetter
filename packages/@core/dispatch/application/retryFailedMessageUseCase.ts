// =============================================================================
// Application — Retry Failed Message Use Case
// =============================================================================
// Resets a failed Message back to its initial status so that the next batch
// processor run will pick it up and attempt delivery (outbound) or routing
// (inbound) again. Uses the domain canRetry() guard to enforce the retry limit.
//
// Flow:
//   1. Fetch the message by ID — MESSAGE_NOT_FOUND if missing
//   2. Check domain canRetry() — MAX_RETRIES_EXCEEDED if false
//   3. Reset status: outbound → 'pending'; inbound → 'received'
//   4. Persist the status reset via messageRepo.updateStatus()
//   5. Return the message with the updated status
// =============================================================================

import { Result } from '../../../shared/lib/result';
import { Message, canRetry } from '../domain/message';
import { IMessageRepository } from '../domain/messageRepository';
import { DispatchError } from './dispatchError';

// =============================================================================
// SECTION 1: TYPES
// =============================================================================

export type RetryFailedMessageInput = {
  messageId: string;
};

// =============================================================================
// SECTION 2: USE CASE FACTORY
// =============================================================================

/**
 * Higher-order function that creates the retryFailedMessage use case.
 * Follows the factory pattern for dependency injection.
 */
export const makeRetryFailedMessageUseCase = (messageRepo: IMessageRepository) => {
  return async (data: RetryFailedMessageInput): Promise<Result<Message, DispatchError>> => {
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

      // Step 2: Check the domain retry eligibility guard
      if (!canRetry(message)) {
        return {
          success: false,
          error: new DispatchError(
            `Message "${data.messageId}" has exhausted its retry attempts`,
            'MAX_RETRIES_EXCEEDED'
          ),
        };
      }

      // Step 3: Determine the reset status based on direction
      const resetStatus = message.direction === 'outbound' ? 'pending' : 'received';

      // Step 4: Persist the status reset
      await messageRepo.updateStatus(message.id, { status: resetStatus });

      // Step 5: Return the message with the updated status
      const updatedMessage: Message = { ...message, status: resetStatus };
      return { success: true, value: updatedMessage };
    } catch {
      return {
        success: false,
        error: new DispatchError('Failed to retry failed message', 'SERVICE_ERROR'),
      };
    }
  };
};
