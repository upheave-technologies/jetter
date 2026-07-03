// =============================================================================
// Domain — Inbound Handler Interface
// =============================================================================
// An InboundHandler is an application-registered processor for inbound Messages.
// The dispatch system routes each received message to every matching handler in
// priority order. Handlers are registered at startup by application modules —
// the core dispatch package provides the routing infrastructure, application
// modules provide the business logic.
//
// HandlerPredicate defines matching criteria evaluated against an inbound Message.
// All specified fields are combined with AND logic — a message must satisfy every
// criterion. An empty predicate (no fields set) matches all messages.
//
// HandlerResult communicates the outcome of handling:
//   - processed: true means the handler completed its work
//   - response:  an optional MessagePayload to send back as a reply on the same
//                thread — the application layer enqueues this as an outbound message
//   - error:     a human-readable error description for logging and diagnostics
//
// Design decisions:
//   - Priority uses ascending order (lower number = higher priority) so that
//     handlers with the most specific predicates can be given priority 1, and a
//     catch-all fallback handler can sit at priority 100.
//   - The custom field on HandlerPredicate accepts an arbitrary function so that
//     complex matching logic not expressible as a static predicate can still be
//     encapsulated within the handler definition rather than scattered across
//     the router.
//   - matchesPredicate is a pure function — it does not execute handle(). The
//     router uses it to compute the candidate set before invoking any handlers.
// =============================================================================

import type { Message } from './message';
import type { Thread } from './thread';
import type { MessagePayload } from './message';

// =============================================================================
// SECTION 1: TYPES
// =============================================================================

/**
 * Criteria used to determine whether an InboundHandler should process a Message.
 * All specified fields are evaluated with AND logic.
 * An empty predicate (all fields absent) matches every message.
 */
export type HandlerPredicate = {
  /** Match if message.channel is in this list */
  channels?: string[];
  /** Match if message.sourceType is in this list */
  sourceTypes?: string[];
  /** Match if message.payload.body matches this pattern */
  contentPattern?: RegExp;
  /** Match if message.principalId is in this list */
  principalIds?: string[];
  /**
   * Match if message.metadata contains all of these key-value pairs.
   * Shallow equality check — nested objects are compared by reference.
   */
  metadataMatch?: Record<string, unknown>;
  /** Arbitrary predicate for matching logic not expressible via the static fields */
  custom?: (message: Message) => boolean;
};

/** Outcome reported by a handler after processing a message */
export type HandlerResult = {
  /** True if the handler completed its work (regardless of whether a reply was sent) */
  processed: boolean;
  /**
   * Optional payload for an automatic outbound reply.
   * When present, the application layer enqueues this as an outbound message
   * on the same thread and channel, addressed to message.externalAddress.
   */
  response?: MessagePayload;
  /** Human-readable error description for logging; present on processing failures */
  error?: string;
};

/** A registered processor for inbound Messages matching a given predicate */
export type InboundHandler = {
  /** Unique name identifying this handler — used for registration and removal */
  readonly name: string;
  readonly predicate: HandlerPredicate;
  /** Routing priority — lower number means higher priority (evaluated first) */
  readonly priority: number;
  /**
   * Process the message and optionally produce a reply.
   * The thread is provided when the message belongs to a known thread.
   */
  handle: (message: Message, thread?: Thread) => Promise<HandlerResult>;
};

// =============================================================================
// SECTION 2: UTILITY FUNCTIONS
// =============================================================================

/**
 * Evaluates all fields of a HandlerPredicate against a Message.
 * Returns true only if every specified criterion matches.
 * An empty predicate (no fields set) returns true for all messages.
 *
 * Evaluation rules per field:
 *   - channels:       message.channel must appear in the array
 *   - sourceTypes:    message.sourceType must appear in the array
 *   - contentPattern: message.payload.body must match the RegExp
 *   - principalIds:   message.principalId must appear in the array
 *   - metadataMatch:  every key in metadataMatch must exist in message.metadata
 *                     with a strictly equal value
 *   - custom:         the function must return true
 */
export const matchesPredicate = (message: Message, predicate: HandlerPredicate): boolean => {
  if (predicate.channels !== undefined) {
    if (!predicate.channels.includes(message.channel)) {
      return false;
    }
  }

  if (predicate.sourceTypes !== undefined) {
    if (message.sourceType === undefined || !predicate.sourceTypes.includes(message.sourceType)) {
      return false;
    }
  }

  if (predicate.contentPattern !== undefined) {
    if (!predicate.contentPattern.test(message.payload.body)) {
      return false;
    }
  }

  if (predicate.principalIds !== undefined) {
    if (message.principalId === undefined || !predicate.principalIds.includes(message.principalId)) {
      return false;
    }
  }

  if (predicate.metadataMatch !== undefined) {
    const meta = message.metadata;
    if (meta === undefined) {
      return false;
    }
    for (const [key, value] of Object.entries(predicate.metadataMatch)) {
      if (meta[key] !== value) {
        return false;
      }
    }
  }

  if (predicate.custom !== undefined) {
    if (!predicate.custom(message)) {
      return false;
    }
  }

  return true;
};
