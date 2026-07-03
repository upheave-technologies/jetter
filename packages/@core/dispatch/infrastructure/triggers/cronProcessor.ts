// =============================================================================
// Infrastructure — Cron-Based Dispatch Processor (Inngest fallback)
// =============================================================================
// A lightweight interval-based trigger for environments that do not have Inngest
// (local development without the Inngest dev server, self-hosted deployments,
// or any runtime where event-driven processing is not available).
//
// How it works:
//   - On start(), fires one immediate tick then repeats every intervalMs
//   - Each tick processes both the outbound and inbound backlogs in sequence
//   - Errors from either processor are caught and logged — a failing tick
//     does not stop the interval or crash the process
//   - stop() clears the interval; calling start() after stop() resumes processing
//   - Calling start() while already running is a no-op (guard prevents double-start)
//
// Design decisions:
//   - Zero external dependencies — uses only Node's built-in setInterval /
//     clearInterval. This file must remain dependency-free to act as a true
//     fallback for any Node.js environment.
//   - The use case processors are injected via factory deps, same pattern as
//     inngestFunctions.ts, so the composition root can swap between the two
//     trigger strategies without touching use case or domain code.
//   - Default interval is 30 seconds — frequent enough for reasonable latency
//     without hammering the database on every tick.
//   - Default batchSize is 50 — same as the event-driven functions so behaviour
//     is consistent regardless of which trigger is active.
//
// Usage in composition root:
//   const cron = createCronProcessor({
//     processOutboundBatch: outboundUseCase,
//     processInboundBatch: inboundUseCase,
//     intervalMs: 30_000,
//   });
//   cron.start();
//   // ... on graceful shutdown:
//   process.on('SIGTERM', () => cron.stop());
// =============================================================================

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
// SECTION 2: PROCESSOR FACTORY
// =============================================================================

/**
 * Creates a cron-based dispatch processor with start/stop lifecycle control.
 *
 * @param deps.processOutboundBatch - Pre-wired outbound batch use case
 * @param deps.processInboundBatch  - Pre-wired inbound batch use case
 * @param deps.intervalMs           - Polling interval in milliseconds (default: 30_000)
 * @param deps.batchSize            - Messages to process per tick per direction (default: 50)
 */
export const createCronProcessor = (deps: {
  processOutboundBatch: OutboundBatchProcessor;
  processInboundBatch: InboundBatchProcessor;
  intervalMs?: number;
  batchSize?: number;
}) => {
  const intervalMs = deps.intervalMs ?? 30_000;
  const batchSize = deps.batchSize ?? 50;
  let timer: ReturnType<typeof setInterval> | null = null;

  // ---------------------------------------------------------------------------
  // tick: process one round of outbound and inbound messages
  // Errors are caught here so a single bad tick does not kill the interval
  // ---------------------------------------------------------------------------
  const tick = async (): Promise<void> => {
    try {
      await deps.processOutboundBatch({ batchSize, includeRetries: true });
      await deps.processInboundBatch({ batchSize });
    } catch (error) {
      console.error('[dispatch:cron] Processing error during tick:', error);
    }
  };

  return {
    /**
     * Starts the cron processor. Fires an immediate tick then repeats on
     * the configured interval. Calling start() while already running is a no-op.
     */
    start(): void {
      if (timer !== null) return; // Already running — guard against double-start
      timer = setInterval(tick, intervalMs);
      // Fire immediately so the first batch is not delayed by the full interval
      void tick();
    },

    /**
     * Stops the cron processor. No more ticks will fire after this call.
     * In-flight ticks are not interrupted — they will complete naturally.
     */
    stop(): void {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    },
  };
};
