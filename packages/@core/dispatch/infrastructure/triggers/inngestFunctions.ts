// =============================================================================
// Infrastructure — Inngest Event-Driven Dispatch Functions
// =============================================================================
// Defines three Inngest functions that drive dispatch processing:
//
//   1. processOutbound — triggered by "dispatch/outbound.enqueued"
//      Fires whenever the application enqueues a new outbound message batch.
//      Retries up to 3 times on failure so transient adapter errors recover
//      without manual intervention.
//
//   2. processInbound — triggered by "dispatch/inbound.received"
//      Fires whenever an inbound message webhook is stored and needs routing.
//      Same retry semantics as processOutbound.
//
//   3. sweep — scheduled every 5 minutes via cron
//      Safety-net for orphaned messages that did not trigger events (e.g. after
//      a deploy restart, network partition, or a missed Inngest event delivery).
//      Processes both outbound and inbound backlogs in a single sweep tick.
//
// Design decisions:
//   - This file imports ONLY from the "inngest" package and uses locally-defined
//     function type aliases for the use case processors. It has zero imports from
//     the domain or application layers — those are injected at the composition
//     root via createDispatchInngestFunctions(deps).
//   - Use case processors are typed as plain async functions here. The composition
//     root passes pre-wired use case instances that satisfy these signatures.
//   - The Inngest client is created inside this file with id: 'dispatch' — the
//     composition root should NOT create a second client for dispatch functions.
//   - The returned object exposes { processOutbound, processInbound, sweep, inngest }
//     so the composition root can register all functions in one call:
//       serve('dispatch', [processOutbound, processInbound, sweep])
//
// Prerequisites:
//   - Add "inngest" to package.json dependencies before using this file.
//     npm install inngest   or   pnpm add inngest
// =============================================================================

import { Inngest } from 'inngest';

// =============================================================================
// SECTION 1: DEPENDENCY TYPES
// =============================================================================

/**
 * Type-compatible signature for the processOutboundBatch use case.
 * The composition root passes the pre-wired instance from the application layer.
 */
type OutboundBatchProcessor = (input: {
  batchSize: number;
  includeRetries?: boolean;
}) => Promise<unknown>;

/**
 * Type-compatible signature for the processInboundBatch use case.
 * The composition root passes the pre-wired instance from the application layer.
 */
type InboundBatchProcessor = (input: {
  batchSize: number;
}) => Promise<unknown>;

// =============================================================================
// SECTION 2: INNGEST FUNCTION FACTORY
// =============================================================================

/**
 * Creates and returns all Inngest functions for dispatch processing.
 *
 * Usage in composition root:
 *   import { makeProcessOutboundBatchUseCase } from '../../application/processOutboundBatchUseCase';
 *   import { makeProcessInboundBatchUseCase } from '../../application/processInboundBatchUseCase';
 *   const processOutboundBatch = makeProcessOutboundBatchUseCase(messageRepo, engine);
 *   const processInboundBatch = makeProcessInboundBatchUseCase(messageRepo, threadRepo, engine);
 *   const { processOutbound, processInbound, sweep, inngest } = createDispatchInngestFunctions({
 *     processOutboundBatch,
 *     processInboundBatch,
 *   });
 *   // Then register with your Inngest serve handler:
 *   serve('dispatch', [processOutbound, processInbound, sweep]);
 */
export const createDispatchInngestFunctions = (deps: {
  processOutboundBatch: OutboundBatchProcessor;
  processInboundBatch: InboundBatchProcessor;
}) => {
  const inngest = new Inngest({ id: 'dispatch' });

  // ---------------------------------------------------------------------------
  // Event-driven: process outbound messages when a new batch is enqueued
  // Send "dispatch/outbound.enqueued" from enqueueOutboundUseCase to trigger
  // Inngest v4 API: triggers are included in the first options object
  // ---------------------------------------------------------------------------
  const processOutbound = inngest.createFunction(
    {
      id: 'dispatch-process-outbound',
      retries: 3,
      triggers: [{ event: 'dispatch/outbound.enqueued' }],
    },
    async () => {
      return deps.processOutboundBatch({ batchSize: 50, includeRetries: true });
    },
  );

  // ---------------------------------------------------------------------------
  // Event-driven: process inbound messages when a new message is received
  // Send "dispatch/inbound.received" from receiveInboundUseCase to trigger
  // Inngest v4 API: triggers are included in the first options object
  // ---------------------------------------------------------------------------
  const processInbound = inngest.createFunction(
    {
      id: 'dispatch-process-inbound',
      retries: 3,
      triggers: [{ event: 'dispatch/inbound.received' }],
    },
    async () => {
      return deps.processInboundBatch({ batchSize: 50 });
    },
  );

  // ---------------------------------------------------------------------------
  // Scheduled sweep: safety-net for orphaned messages every 5 minutes
  // Handles messages that arrived during restarts or missed event deliveries
  // Inngest v4 API: cron trigger included in the first options object
  // ---------------------------------------------------------------------------
  const sweep = inngest.createFunction(
    {
      id: 'dispatch-sweep',
      triggers: [{ cron: '*/5 * * * *' }],
    },
    async () => {
      const outboundResult = await deps.processOutboundBatch({
        batchSize: 100,
        includeRetries: true,
      });
      const inboundResult = await deps.processInboundBatch({ batchSize: 100 });
      return { outboundResult, inboundResult };
    },
  );

  return { processOutbound, processInbound, sweep, inngest };
};
