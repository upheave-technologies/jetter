// =============================================================================
// Domain — Dispatch Engine (Adapter + Handler Registries)
// =============================================================================
// The DispatchEngine is the top-level registry that ties together all channel
// adapters and inbound handlers. It is the single entry point through which
// the application layer accesses the full dispatch capability set.
//
// Responsibilities:
//   Adapter registry:
//     - registerAdapter: add/replace a ChannelAdapter by channel name
//     - getAdapter:      look up the adapter for a given channel
//     - listAdapters:    enumerate all registered adapters
//
//   Handler registry (delegated to an internal Router):
//     - registerHandler:  add/replace an InboundHandler by name
//     - removeHandler:    remove a handler by name
//     - resolveHandlers:  return matching handlers sorted by priority
//
// Design decisions:
//   - Adapters are stored in a Map<string, ChannelAdapter> keyed by channel name.
//     Last-registration-wins semantics allow hot-swap of adapter implementations
//     during development or testing without requiring engine restarts.
//   - Handler operations are fully delegated to an internal Router created by
//     createRouter(). The engine does not duplicate router logic.
//   - The engine is a shared in-memory registry — it should be created once
//     (at application startup) and injected as a dependency into use cases
//     that need to dispatch or route messages.
//   - Mutable internal state (the adapter Map and router) is encapsulated inside
//     the factory closure. This mirrors the Router pattern and is the only
//     acceptable exception to pure-function rules in the domain layer.
// =============================================================================

import type { ChannelAdapter } from './channel';
import type { InboundHandler } from './handler';
import type { Message } from './message';
import type { Router } from './router';
import { createRouter } from './router';

// =============================================================================
// SECTION 1: TYPES
// =============================================================================

export type DispatchEngine = {
  // ---------------------------------------------------------------------------
  // Adapter registry
  // ---------------------------------------------------------------------------

  /**
   * Register a channel adapter. Replaces any existing adapter registered
   * under the same channel name (last-registration-wins).
   */
  registerAdapter: (adapter: ChannelAdapter) => void;

  /**
   * Retrieve the adapter registered for a given channel name.
   * Returns undefined if no adapter is registered for that channel.
   */
  getAdapter: (channel: string) => ChannelAdapter | undefined;

  /**
   * Return all currently registered channel adapters.
   */
  listAdapters: () => ChannelAdapter[];

  // ---------------------------------------------------------------------------
  // Handler registry (delegates to internal Router)
  // ---------------------------------------------------------------------------

  /**
   * Register an inbound handler. Replaces any existing handler with the same
   * name (last-registration-wins, safe for hot-reload scenarios).
   */
  registerHandler: (handler: InboundHandler) => void;

  /**
   * Remove a registered inbound handler by name.
   * No-op if no handler with that name exists.
   */
  removeHandler: (name: string) => void;

  /**
   * Return all handlers whose predicate matches the message,
   * sorted by priority ascending (lower number = higher priority).
   * Returns an empty array if no handlers match.
   */
  resolveHandlers: (message: Message) => InboundHandler[];
};

// =============================================================================
// SECTION 2: FACTORY FUNCTION
// =============================================================================

/**
 * Creates a new DispatchEngine instance with empty adapter and handler registries.
 * Internal state is maintained via closure — each call produces an isolated engine.
 *
 * Intended to be called once at application startup and shared as a singleton
 * dependency through the application layer.
 */
export const createDispatchEngine = (): DispatchEngine => {
  const adapters = new Map<string, ChannelAdapter>();
  const router: Router = createRouter();

  return {
    registerAdapter(adapter: ChannelAdapter): void {
      adapters.set(adapter.channel, adapter);
    },

    getAdapter(channel: string): ChannelAdapter | undefined {
      return adapters.get(channel);
    },

    listAdapters(): ChannelAdapter[] {
      return Array.from(adapters.values());
    },

    registerHandler(handler: InboundHandler): void {
      router.register(handler);
    },

    removeHandler(name: string): void {
      router.remove(name);
    },

    resolveHandlers(message: Message): InboundHandler[] {
      return router.resolve(message);
    },
  };
};
