// =============================================================================
// Application — Close Thread Use Case
// =============================================================================
// Closes an active Thread, preventing further messages from being associated
// with it. Returns THREAD_NOT_FOUND if the thread does not exist, and
// VALIDATION_ERROR if the thread is already closed.
//
// Flow:
//   1. Fetch the thread by ID — THREAD_NOT_FOUND if missing
//   2. Verify status is 'active' — VALIDATION_ERROR if already closed
//   3. Apply the domain closeThread() transition (returns new thread with updatedAt bumped)
//   4. Persist the updated thread via threadRepo.update()
//   5. Return the closed thread
// =============================================================================

import { Result } from '../../../shared/lib/result';
import { Thread, closeThread } from '../domain/thread';
import { IThreadRepository } from '../domain/threadRepository';
import { DispatchError } from './dispatchError';

// =============================================================================
// SECTION 1: TYPES
// =============================================================================

export type CloseThreadInput = {
  threadId: string;
};

// =============================================================================
// SECTION 2: USE CASE FACTORY
// =============================================================================

/**
 * Higher-order function that creates the closeThread use case.
 * Follows the factory pattern for dependency injection.
 */
export const makeCloseThreadUseCase = (threadRepo: IThreadRepository) => {
  return async (data: CloseThreadInput): Promise<Result<Thread, DispatchError>> => {
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

      // Step 2: Verify the thread is currently active
      if (thread.status !== 'active') {
        return {
          success: false,
          error: new DispatchError(
            `Thread "${data.threadId}" is already closed`,
            'VALIDATION_ERROR'
          ),
        };
      }

      // Step 3: Apply domain state transition
      const closedThread = closeThread(thread);

      // Step 4: Persist the updated thread
      await threadRepo.update(closedThread);

      // Step 5: Return the closed thread
      return { success: true, value: closedThread };
    } catch {
      return {
        success: false,
        error: new DispatchError('Failed to close thread', 'SERVICE_ERROR'),
      };
    }
  };
};
