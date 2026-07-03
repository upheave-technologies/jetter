// =============================================================================
// Domain — Thread Entity
// =============================================================================
// A Thread groups related Messages into a conversational exchange on a channel.
// It represents a persistent session between the system and an external address.
//
// Threads enable the dispatch system to:
//   - Associate multiple messages with a single conversation
//   - Route inbound replies back to the correct originating context
//   - Maintain state across multi-turn agent interactions
//
// ThreadStatus governs whether the thread accepts new messages:
//   - active: open for new inbound and outbound messages
//   - closed: terminal state; no new messages should be associated
//
// Design decisions:
//   - A thread is keyed on (channel, externalAddress) — the combination uniquely
//     identifies the communication session on a given channel.
//   - principalId is optional because threads can be initiated before a Principal
//     is identified (e.g. an inbound message from an unknown address).
//   - sourceType/sourceId link a thread back to the originating business object
//     (e.g. a campaign run, a support ticket) for cross-module lookup.
//   - All factory functions return Result<T, Error> — never throw.
//   - State transition functions return a new thread object (immutable update).
// =============================================================================

import { Result } from '../../../shared/lib/result';

// =============================================================================
// SECTION 1: TYPES
// =============================================================================

export type ThreadStatus = 'active' | 'closed';

export type Thread = {
  id: string;
  /** Registered channel name this thread belongs to (e.g. "email", "sms") */
  channel: string;
  /** ID of the Principal associated with this thread, if resolved */
  principalId?: string;
  /** The external address on the channel (email address, phone number, etc.) */
  externalAddress: string;
  /** Source system type that originated this thread (e.g. "campaign", "workflow") */
  sourceType?: string;
  /** Source system record ID that originated this thread */
  sourceId?: string;
  status: ThreadStatus;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
};

// =============================================================================
// SECTION 2: FACTORY FUNCTION
// =============================================================================

/**
 * Validates and assembles the core fields for a new Thread.
 * The calling use case is responsible for appending id, createdAt, and updatedAt.
 *
 * Business rules applied:
 *   1. channel must be a non-empty string (trimmed)
 *   2. externalAddress must be a non-empty string (trimmed)
 *   3. status is initialized to 'active'
 */
export const createThread = (input: {
  channel: string;
  externalAddress: string;
  principalId?: string;
  sourceType?: string;
  sourceId?: string;
  metadata?: Record<string, unknown>;
}): Result<Omit<Thread, 'id' | 'createdAt' | 'updatedAt'>, Error> => {
  if (!input.channel || input.channel.trim().length === 0) {
    return {
      success: false,
      error: new Error('Thread channel cannot be empty'),
    };
  }

  if (!input.externalAddress || input.externalAddress.trim().length === 0) {
    return {
      success: false,
      error: new Error('Thread external address cannot be empty'),
    };
  }

  return {
    success: true,
    value: {
      channel: input.channel.trim(),
      externalAddress: input.externalAddress.trim(),
      status: 'active',
      ...(input.principalId !== undefined && { principalId: input.principalId }),
      ...(input.sourceType !== undefined && { sourceType: input.sourceType }),
      ...(input.sourceId !== undefined && { sourceId: input.sourceId }),
      ...(input.metadata !== undefined && { metadata: input.metadata }),
    },
  };
};

// =============================================================================
// SECTION 3: STATE TRANSITION FUNCTIONS
// =============================================================================

/**
 * Closes a thread, marking it as terminal.
 * Once closed, no new messages should be associated with the thread.
 * Returns a new thread object with an updated timestamp — does not mutate the input.
 */
export const closeThread = (thread: Thread): Thread => {
  return { ...thread, status: 'closed', updatedAt: new Date() };
};
