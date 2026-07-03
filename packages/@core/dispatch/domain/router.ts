// =============================================================================
// Domain — Router (Pure Handler Registry)
// =============================================================================
// The Router maintains the registry of InboundHandlers and resolves which
// handlers should process a given inbound Message.
//
// Responsibilities:
//   - register: add a handler; replaces any existing handler with the same name
//   - remove:   remove a handler by name
//   - resolve:  return all handlers whose predicate matches the message, sorted
//               by priority ascending (lowest number = highest priority first)
//
// Design decisions:
//   - Handlers are keyed by name to make idempotent re-registration safe. An
//     application module that re-registers its handler on hot-reload will not
//     accumulate duplicate entries.
//   - Mutable internal state (the handler array) is encapsulated inside the
//     factory closure. This is the only file in the domain layer where internal
//     state is held — justified because the router is an in-memory registry,
//     not a domain entity with a persistence lifecycle.
//   - Sorting on every resolve call is intentional: handler sets are small
//     and registration is infrequent; the clarity of always returning a
//     correctly sorted list outweighs the marginal cost of re-sorting.
//   - The Router itself has no knowledge of Result — resolve returns an empty
//     array rather than an error when no handlers match.
// =============================================================================

import type { Message } from './message';
import type { InboundHandler } from './handler';
import { matchesPredicate } from './handler';

// =============================================================================
// SECTION 1: TYPES
// =============================================================================

export type Router = {
  /**
   * Register a handler. If a handler with the same name already exists,
   * it is replaced (last-registration-wins semantics).
   */
  register: (handler: InboundHandler) => void;

  /**
   * Remove a registered handler by name.
   * No-op if no handler with that name exists.
   */
  remove: (name: string) => void;

  /**
   * Return all handlers whose predicate matches the message,
   * sorted by priority ascending (lower number = higher priority).
   * Returns an empty array if no handlers match.
   */
  resolve: (message: Message) => InboundHandler[];
};

// =============================================================================
// SECTION 2: FACTORY FUNCTION
// =============================================================================

/**
 * Creates a new Router instance with an empty handler registry.
 * Internal state is maintained via closure — each call produces an isolated registry.
 */
export const createRouter = (): Router => {
  const handlers: InboundHandler[] = [];

  return {
    register(handler: InboundHandler): void {
      const existingIndex = handlers.findIndex((h) => h.name === handler.name);
      if (existingIndex >= 0) {
        handlers[existingIndex] = handler;
      } else {
        handlers.push(handler);
      }
    },

    remove(name: string): void {
      const index = handlers.findIndex((h) => h.name === name);
      if (index >= 0) {
        handlers.splice(index, 1);
      }
    },

    resolve(message: Message): InboundHandler[] {
      return handlers
        .filter((h) => matchesPredicate(message, h.predicate))
        .sort((a, b) => a.priority - b.priority);
    },
  };
};
