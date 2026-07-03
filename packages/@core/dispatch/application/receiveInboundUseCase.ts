// =============================================================================
// Application — Receive Inbound Use Case
// =============================================================================
// Accepts a raw inbound webhook payload from a channel, normalizes it via the
// registered adapter, finds or creates a conversation thread, persists the
// inbound Message, and returns both the message and its thread.
//
// Flow:
//   1. Retrieve the adapter for the given channel — NO_ADAPTER if missing
//   2. Verify the adapter can receive — CHANNEL_CANNOT_RECEIVE if not
//   3. If a signature is provided AND the adapter has verifySignature: verify it
//      — SIGNATURE_INVALID if the check fails
//   4. Normalize the raw payload via adapter.normalize() to get NormalizedInbound
//   5. Optionally resolve a principalId via the principalResolver callback
//   6. Find an active thread for (channel, externalAddress) or create a new one
//   7. Create the inbound Message via domain createInboundMessage() factory
//   8. Persist the message via messageRepo.save()
//   9. Return { message, thread }
// =============================================================================

import { createId } from '@paralleldrive/cuid2';
import { Result } from '../../../shared/lib/result';
import { Message, createInboundMessage } from '../domain/message';
import { Thread, createThread } from '../domain/thread';
import { canReceive } from '../domain/channel';
import { IMessageRepository } from '../domain/messageRepository';
import { IThreadRepository } from '../domain/threadRepository';
import { DispatchEngine } from '../domain/engine';
import { DispatchError } from './dispatchError';

// =============================================================================
// SECTION 1: TYPES
// =============================================================================

export type ReceiveInboundInput = {
  channel: string;
  rawPayload: Record<string, unknown>;
  signature?: string;
  rawBody?: string;                        // Raw HTTP request body for signature verification
  headers?: Record<string, string>;        // HTTP request headers for signature verification
};

export type ReceiveInboundResult = {
  message: Message;
  thread: Thread;
};

// =============================================================================
// SECTION 2: USE CASE FACTORY
// =============================================================================

/**
 * Higher-order function that creates the receiveInbound use case.
 * Follows the factory pattern for dependency injection.
 *
 * The optional principalResolver allows the caller to supply a function that
 * maps an (externalAddress, channel) pair to a known principalId. When provided
 * and a match is found, the principalId is stored on both the thread (if newly
 * created) and the inbound message.
 */
export const makeReceiveInboundUseCase = (
  messageRepo: IMessageRepository,
  threadRepo: IThreadRepository,
  engine: DispatchEngine,
  principalResolver?: (externalAddress: string, channel: string) => Promise<string | null>
) => {
  return async (data: ReceiveInboundInput): Promise<Result<ReceiveInboundResult, DispatchError>> => {
    try {
      // Step 1: Retrieve the adapter for the given channel
      const adapter = engine.getAdapter(data.channel);
      if (!adapter) {
        return {
          success: false,
          error: new DispatchError(
            `No adapter registered for channel "${data.channel}"`,
            'NO_ADAPTER'
          ),
        };
      }

      // Step 2: Verify the adapter can receive
      if (!canReceive(adapter)) {
        return {
          success: false,
          error: new DispatchError(
            `Adapter for channel "${data.channel}" does not support receiving`,
            'CHANNEL_CANNOT_RECEIVE'
          ),
        };
      }

      // Step 3: Verify the webhook signature if provided
      if (data.signature !== undefined && adapter.verifySignature !== undefined) {
        const valid = await adapter.verifySignature({
          rawPayload: data.rawPayload,
          signature: data.signature ?? '',
          rawBody: data.rawBody,
          headers: data.headers,
        });
        if (!valid) {
          return {
            success: false,
            error: new DispatchError(
              'Inbound webhook signature verification failed',
              'SIGNATURE_INVALID'
            ),
          };
        }
      }

      // Step 4: Normalize the raw provider payload
      const normalized = await adapter.normalize!(data.rawPayload);

      // Step 5: Optionally resolve a principalId for the external address
      let principalId: string | undefined;
      if (principalResolver !== undefined) {
        const resolved = await principalResolver(normalized.externalAddress, data.channel);
        if (resolved !== null) {
          principalId = resolved;
        }
      }

      // Step 6: Find an active thread or create a new one
      const now = new Date();
      let thread = await threadRepo.findByExternalAddress(
        data.channel,
        normalized.externalAddress,
        'active'
      );

      if (!thread) {
        const threadResult = createThread({
          channel: data.channel,
          externalAddress: normalized.externalAddress,
          ...(principalId !== undefined && { principalId }),
        });

        if (!threadResult.success) {
          return {
            success: false,
            error: new DispatchError(threadResult.error.message, 'VALIDATION_ERROR'),
          };
        }

        thread = {
          id: createId(),
          ...threadResult.value,
          createdAt: now,
          updatedAt: now,
        };

        await threadRepo.save(thread);
      }

      // Step 7: Create the inbound message via the domain factory
      const messageResult = createInboundMessage({
        channel: data.channel,
        externalAddress: normalized.externalAddress,
        payload: normalized.payload,
        ...(principalId !== undefined && { principalId }),
        threadId: thread.id,
        ...(normalized.metadata !== undefined && { metadata: normalized.metadata }),
      });

      if (!messageResult.success) {
        return {
          success: false,
          error: new DispatchError(messageResult.error.message, 'VALIDATION_ERROR'),
        };
      }

      // Step 8: Assemble the full Message with id, receivedAt, and timestamps
      const message: Message = {
        id: createId(),
        ...messageResult.value,
        receivedAt: now,
        createdAt: now,
        updatedAt: now,
      };

      await messageRepo.save(message);

      // Step 9: Return the persisted message and its thread
      return { success: true, value: { message, thread } };
    } catch {
      return {
        success: false,
        error: new DispatchError('Failed to receive inbound message', 'SERVICE_ERROR'),
      };
    }
  };
};
