// =============================================================================
// Application — Get Message Status Use Case
// =============================================================================
// Returns a lightweight status summary for a Message by ID. Useful for polling
// delivery state without returning the full Message entity including its payload.
//
// Flow:
//   1. Fetch the message by ID — MESSAGE_NOT_FOUND if missing
//   2. Map to a MessageStatusSummary and return
// =============================================================================

import { Result } from '../../../shared/lib/result';
import { MessageDirection, MessageStatus } from '../domain/message';
import { IMessageRepository } from '../domain/messageRepository';
import { DispatchError } from './dispatchError';

// =============================================================================
// SECTION 1: TYPES
// =============================================================================

export type GetMessageStatusInput = {
  messageId: string;
};

export type MessageStatusSummary = {
  id: string;
  direction: MessageDirection;
  channel: string;
  status: MessageStatus;
  retryCount: number;
  maxRetries: number;
  deliveredAt?: Date;
  processedAt?: Date;
  lastAttemptAt?: Date;
  providerResponse?: Record<string, unknown>;
  createdAt: Date;
};

// =============================================================================
// SECTION 2: USE CASE FACTORY
// =============================================================================

/**
 * Higher-order function that creates the getMessageStatus use case.
 * Follows the factory pattern for dependency injection.
 */
export const makeGetMessageStatusUseCase = (messageRepo: IMessageRepository) => {
  return async (data: GetMessageStatusInput): Promise<Result<MessageStatusSummary, DispatchError>> => {
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

      // Step 2: Build and return the status summary
      const summary: MessageStatusSummary = {
        id: message.id,
        direction: message.direction,
        channel: message.channel,
        status: message.status,
        retryCount: message.retryCount,
        maxRetries: message.maxRetries,
        ...(message.deliveredAt !== undefined && { deliveredAt: message.deliveredAt }),
        ...(message.processedAt !== undefined && { processedAt: message.processedAt }),
        ...(message.lastAttemptAt !== undefined && { lastAttemptAt: message.lastAttemptAt }),
        ...(message.providerResponse !== undefined && { providerResponse: message.providerResponse }),
        createdAt: message.createdAt,
      };

      return { success: true, value: summary };
    } catch {
      return {
        success: false,
        error: new DispatchError('Failed to retrieve message status', 'SERVICE_ERROR'),
      };
    }
  };
};
