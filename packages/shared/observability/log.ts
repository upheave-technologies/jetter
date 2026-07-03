// =============================================================================
// Observability — Logger SDK
// =============================================================================
// Public surface: import { log } from '@/packages/shared/observability'
//
// Features:
//   - Six severity levels: trace, debug, info, warn, error, fatal
//   - Level guard: one integer compare before any serialization
//   - Lazy callback form: logger.debug('event', () => expensivePayload())
//     The callback is NEVER invoked when the level is disabled (AC2).
//   - Child loggers: log.child({ source: 'campaigns.createUseCase' })
//   - Context propagation: log.withContext({ requestId, traceId }, fn)
//   - Runtime level control: log.setLevel(pattern, level), log.getLevel(source)
//   - Transport registry: log.addTransport(transport)
//   - OTel Logs Data Model + ECS field names on the wire
//
// Pino is the underlying JSON serializer and engine. It is fully wrapped —
// consumers never import pino directly. The pino instance is an internal
// implementation detail invisible outside this module.

import pino from 'pino';
import { Writable } from 'node:stream';
import type { LogLevel } from './levels.js';
import { OTEL_SEVERITY_NUMBERS } from './levels.js';
import {
  buildRegistryFromEnv,
  registrySetLevel,
  registryGetLevel,
  isSourceLevelEnabled,
  type LevelRegistry,
} from './levelControl.js';
import { withContext as alsWithContext, getContext } from './context.js';
import { buildRecord, type LogRecord } from './schema.js';
import { makeConsoleTransport, type Transport } from './transports/console.js';

// =============================================================================
// Method signature
// =============================================================================

/**
 * Fields argument for a log call.
 * Can be a plain object, an Error, or a lazy callback returning an object.
 */
export type LogFields =
  | Record<string, unknown>
  | Error
  | (() => Record<string, unknown>);

// =============================================================================
// Logger type
// =============================================================================

export type Logger = {
  trace: (event: string, fieldsOrErr?: LogFields, fields?: Record<string, unknown>) => void;
  debug: (event: string, fieldsOrErr?: LogFields, fields?: Record<string, unknown>) => void;
  info:  (event: string, fieldsOrErr?: LogFields, fields?: Record<string, unknown>) => void;
  warn:  (event: string, fieldsOrErr?: LogFields, fields?: Record<string, unknown>) => void;
  error: (event: string, fieldsOrErr?: LogFields, fields?: Record<string, unknown>) => void;
  fatal: (event: string, fieldsOrErr?: LogFields, fields?: Record<string, unknown>) => void;

  /**
   * Create a child logger with bound fields merged into every record it emits.
   * Child loggers share the same transport list and level registry as the root.
   */
  child: (bindings: Record<string, unknown>) => Logger;

  /**
   * Run `fn` with `fields` merged into the ambient log context.
   * Fields are automatically attached to every record emitted inside `fn`,
   * including across await boundaries and nested withContext calls.
   * Inner fields override outer fields per-key (shallow merge).
   */
  withContext: <T>(fields: {
    requestId?: string;
    traceId?: string;
    spanId?: string;
    userId?: string;
    tenantId?: string;
    [key: string]: unknown;
  }, fn: () => T) => T;

  /**
   * Set the minimum level for loggers whose source matches `pattern`.
   * `pattern` is a glob: '*' (all), 'campaigns.*', 'iam.policy.evaluate' (exact).
   * Most-specific match wins. Affects the shared level registry.
   */
  setLevel: (pattern: string, level: LogLevel) => void;

  /**
   * Get the effective level for the given source string.
   */
  getLevel: (source?: string) => LogLevel;

  /**
   * Register an additional transport. All transports receive every record
   * that passes the level guard.
   */
  addTransport: (transport: Transport) => void;
};

// =============================================================================
// Internal types
// =============================================================================

type LoggerState = {
  /** Shared transport list (mutated when addTransport is called). */
  transports: Transport[];
  /** Shared level registry (mutated when setLevel is called). */
  registry: LevelRegistry;
};

// =============================================================================
// OTel severity number map — pino's level number → OTel SeverityNumber
// =============================================================================

// Pino uses its own level numbers (10/20/30/40/50/60). We override them
// in formatters.level so the serialized JSON contains OTel numbers instead.
const PINO_LEVEL_TO_OTEL: Record<string, number> = {
  trace:  OTEL_SEVERITY_NUMBERS.trace,
  debug:  OTEL_SEVERITY_NUMBERS.debug,
  info:   OTEL_SEVERITY_NUMBERS.info,
  warn:   OTEL_SEVERITY_NUMBERS.warn,
  error:  OTEL_SEVERITY_NUMBERS.error,
  fatal:  OTEL_SEVERITY_NUMBERS.fatal,
};

// =============================================================================
// Pino instance factory
// =============================================================================

/**
 * Create a pino instance wired to deliver JSON lines to the given callback.
 *
 * The instance is configured to produce OTel Logs Data Model JSON on each write:
 *   - formatters.level maps level labels to { SeverityText, SeverityNumber }
 *   - messageKey: 'Body' places the event string in the OTel Body field
 *   - timestamp produces an ISO-8601 Timestamp field
 *   - base: null removes pino's default pid/hostname fields
 *
 * We set pino's level to 'trace' so it never suppresses records — our own
 * level guard runs BEFORE calling pino and short-circuits disabled levels.
 */
function makePinoInstance(onLine: (json: string) => void): pino.Logger {
  const dest = new Writable({
    write(chunk: Buffer, _encoding: BufferEncoding, callback: () => void) {
      const line = chunk.toString().trim();
      if (line.length > 0) onLine(line);
      callback();
    },
  });

  return pino(
    {
      level: 'trace',
      messageKey: 'Body',
      timestamp: () => `,"Timestamp":"${new Date().toISOString()}"`,
      base: null,
      formatters: {
        level(label: string, number: number) {
          return {
            // pino's native numeric level — retained so pino-pretty can apply
            // level-based colorization using its built-in level map.
            level: number,
            SeverityText: label.toUpperCase(),
            SeverityNumber: PINO_LEVEL_TO_OTEL[label] ?? 0,
          };
        },
      },
    },
    dest,
  );
}

// =============================================================================
// Shared pino instance (one per LoggerState)
// =============================================================================

// WeakMap so each distinct state object gets its own pino instance.
// This ensures isolated loggers (e.g. in tests) each get their own pipeline.
const pinoInstances = new WeakMap<LoggerState, pino.Logger>();

function getPinoInstance(state: LoggerState): pino.Logger {
  let instance = pinoInstances.get(state);
  if (!instance) {
    instance = makePinoInstance((json: string) => {
      // pino has serialized the record to a JSON line.
      // Parse it back to a typed LogRecord for transports that inspect fields.
      let record: LogRecord;
      try {
        record = JSON.parse(json) as LogRecord;
      } catch {
        // Unparseable output from pino — skip delivery
        return;
      }
      for (const transport of state.transports) {
        transport.write(record, json);
      }
    });
    pinoInstances.set(state, instance);
  }
  return instance;
}

// =============================================================================
// Internal logger factory
// =============================================================================

/**
 * Create a Logger instance.
 *
 * @param state    - Shared mutable state (transport list + level registry).
 * @param bindings - Bound fields included in every record this logger emits.
 * @param source   - Dot-notation source name for level resolution
 *                   (e.g. 'campaigns.createUseCase').
 */
function makeLogger(
  state: LoggerState,
  bindings: Record<string, unknown> = {},
  source = '',
): Logger {

  /** Core emit function — called only after the level guard passes. */
  function emit(
    level: LogLevel,
    event: string,
    fieldsOrErr?: LogFields,
    extraFields?: Record<string, unknown>,
  ): void {
    // Resolve lazy callback AFTER the level guard (caller already checked).
    let resolvedFields: Record<string, unknown> | undefined;
    let resolvedError: Error | undefined;

    if (typeof fieldsOrErr === 'function') {
      resolvedFields = fieldsOrErr();
    } else if (fieldsOrErr instanceof Error) {
      resolvedError  = fieldsOrErr;
      resolvedFields = extraFields;
    } else if (fieldsOrErr !== undefined) {
      resolvedFields = fieldsOrErr as Record<string, unknown>;
    }

    if (extraFields && !(fieldsOrErr instanceof Error)) {
      resolvedFields = { ...(resolvedFields ?? {}), ...extraFields };
    }

    // Build the OTel-shaped record — merges bindings, ALS context, call fields,
    // and expands Error instances into ECS error.* attributes.
    const ctx    = getContext();
    const record = buildRecord({
      level,
      body: event,
      bindings,
      context: ctx,
      fields: resolvedFields,
      error: resolvedError,
    });

    // Hand the pre-built record to pino. Pino handles JSON serialization via
    // its fast-json-stringify engine and writes the resulting JSON line to the
    // shared writable, which delivers it to our transport list.
    //
    // We pass the record as pino's merge object (first arg) and use an empty
    // string as the message because Body is already inside the record object —
    // pino.info(obj, '') would write Body: '' and ignore obj.Body. Instead
    // we pass Body as the message arg so pino places it in the messageKey field.
    const pinoInstance = getPinoInstance(state);

    // Strip the fields pino will re-generate via formatters.level, messageKey,
    // and the timestamp fn. The remaining fields (Attributes, Resource, TraceId,
    // SpanId) pass through as the merge object. Pino places `event` in messageKey
    // ('Body') and re-generates SeverityText, SeverityNumber, Timestamp.
    const pinoFields = { ...(record as Record<string, unknown>) };
    delete pinoFields['Body'];
    delete pinoFields['SeverityNumber'];
    delete pinoFields['SeverityText'];
    delete pinoFields['Timestamp'];

    pinoInstance[level](pinoFields, event);
  }

  /** Level-guarded log method. */
  function logMethod(level: LogLevel) {
    return (
      event: string,
      fieldsOrErr?: LogFields,
      fields?: Record<string, unknown>,
    ): void => {
      // Level guard: one integer compare. Return immediately if disabled.
      if (!isSourceLevelEnabled(state.registry, source, level)) return;
      emit(level, event, fieldsOrErr, fields);
    };
  }

  return {
    trace: logMethod('trace'),
    debug: logMethod('debug'),
    info:  logMethod('info'),
    warn:  logMethod('warn'),
    error: logMethod('error'),
    fatal: logMethod('fatal'),

    child(childBindings: Record<string, unknown>): Logger {
      // Merge parent bindings with child bindings (child wins).
      const merged = { ...bindings, ...childBindings };
      const childSource = (childBindings.source as string | undefined) ?? source;
      return makeLogger(state, merged, childSource);
    },

    withContext<T>(
      fields: {
        requestId?: string;
        traceId?: string;
        spanId?: string;
        userId?: string;
        tenantId?: string;
        [key: string]: unknown;
      },
      fn: () => T,
    ): T {
      return alsWithContext(fields, fn);
    },

    setLevel(pattern: string, level: LogLevel): void {
      registrySetLevel(state.registry, pattern, level);
    },

    getLevel(queriedSource?: string): LogLevel {
      return registryGetLevel(state.registry, queriedSource ?? source);
    },

    addTransport(transport: Transport): void {
      state.transports.push(transport);
    },
  };
}

// =============================================================================
// Singleton logger
// =============================================================================

const sharedState: LoggerState = {
  transports: [makeConsoleTransport()],
  registry: buildRegistryFromEnv({
    LOG_LEVEL:  process.env.LOG_LEVEL,
    LOG_LEVELS: process.env.LOG_LEVELS,
    NODE_ENV:   process.env.NODE_ENV,
  }),
};

/**
 * The default singleton logger.
 *
 * Usage:
 *   import { log } from '@/packages/shared/observability'
 *
 *   log.info('campaign.created', { campaignId: '123' })
 *   log.debug('cache.hit', () => ({ key, size: cache.size }))
 *
 *   const childLog = log.child({ source: 'campaigns.createUseCase' })
 *
 *   await log.withContext({ requestId: req.id, userId: session.userId }, async () => {
 *     await doWork()   // every log call here gets requestId + userId automatically
 *   })
 */
export const log: Logger = makeLogger(sharedState, {}, '');

/**
 * Export the factory function for consumers that need to create isolated
 * loggers (e.g. in tests, or for distinct service boundaries).
 */
export { makeLogger, type LoggerState };

/**
 * Export Transport type so consumers can implement custom transports.
 */
export type { Transport };
