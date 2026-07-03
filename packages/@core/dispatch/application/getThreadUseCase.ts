// =============================================================================
// Application — Get Thread Use Case
// =============================================================================
// Retrieves a Thread together with its paginated Message history.
// Returns THREAD_NOT_FOUND if no thread exists with the given ID.
//
// Flow:
//   1. Fetch the thread and its messages via threadRepo.findByIdWithMessages()
//      with optional cursor and limit for pagination
//   2. Return THREAD_NOT_FOUND if the result is null
//   3. Return { thread, messages }
// =============================================================================

import { Result } from '../../../shared/lib/result';
import { Thread } from '../domain/thread';
import { Message } from '../domain/message';
import { IThreadRepository } from '../domain/threadRepository';
import { DispatchError } from './dispatchError';

// =============================================================================
// SECTION 1: TYPES
// =============================================================================

export type GetThreadInput = {
  threadId: string;
  cursor?: string;
  limit?: number;
};

export type GetThreadResult = {
  thread: Thread;
  messages: Message[];
};

// =============================================================================
// SECTION 2: USE CASE FACTORY
// =============================================================================

/**
 * Higher-order function that creates the getThread use case.
 * Follows the factory pattern for dependency injection.
 */
export const makeGetThreadUseCase = (threadRepo: IThreadRepository) => {
  return async (data: GetThreadInput): Promise<Result<GetThreadResult, DispatchError>> => {
    try {
      // Step 1: Fetch the thread with its messages
      const result = await threadRepo.findByIdWithMessages(
        data.threadId,
        data.cursor,
        data.limit
      );

      // Step 2: Return not found if null
      if (!result) {
        return {
          success: false,
          error: new DispatchError(
            `No thread found with ID "${data.threadId}"`,
            'THREAD_NOT_FOUND'
          ),
        };
      }

      // Step 3: Return the thread and its messages
      return { success: true, value: { thread: result.thread, messages: result.messages } };
    } catch {
      return {
        success: false,
        error: new DispatchError('Failed to retrieve thread', 'SERVICE_ERROR'),
      };
    }
  };
};
