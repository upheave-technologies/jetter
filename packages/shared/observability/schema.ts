// =============================================================================
// Observability — OTel Logs Data Model + ECS Field Serialization
// =============================================================================
// Each log record on the wire conforms to the OpenTelemetry Logs Data Model:
//   https://opentelemetry.io/docs/specs/otel/logs/data-model/
//
// Fields inside Attributes use Elastic Common Schema (ECS) names where natural:
//   https://www.elastic.co/guide/en/ecs/current/ecs-field-reference.html
//
// Top-level OTel fields:
//   Timestamp         — ISO-8601 nanosecond wall clock (string)
//   SeverityNumber    — OTel int severity (1/5/9/13/17/21 for t/d/i/w/e/f)
//   SeverityText      — TRACE/DEBUG/INFO/WARN/ERROR/FATAL
//   Body              — the event string (ECS: message)
//   Attributes        — merged context + bound child fields + per-call fields
//   TraceId           — from context, if present
//   SpanId            — from context, if present
//   Resource          — { service.name } from env SERVICE_NAME / npm package name

import { LogLevel, OTEL_SEVERITY_NUMBERS, OTEL_SEVERITY_TEXT } from './levels.js';
import type { LogContext } from './context.js';

// =============================================================================
// OTel Logs Data Model wire shape
// =============================================================================

/** The canonical record shape emitted to transports. */
export type LogRecord = {
  /** ISO-8601 UTC timestamp with millisecond precision. */
  Timestamp: string;
  /** OTel SeverityNumber integer. */
  SeverityNumber: number;
  /** OTel SeverityText string (TRACE/DEBUG/INFO/WARN/ERROR/FATAL). */
  SeverityText: string;
  /** The log event body. */
  Body: string;
  /** Merged attributes: context + bindings + per-call fields. ECS names where applicable. */
  Attributes: Record<string, unknown>;
  /** Trace ID from context, if present. */
  TraceId?: string;
  /** Span ID from context, if present. */
  SpanId?: string;
  /** Static resource metadata. */
  Resource: {
    'service.name': string;
  };
};

// =============================================================================
// Service name resolution
// =============================================================================

function resolveServiceName(): string {
  // In Node.js: try SERVICE_NAME env, fallback to a generic name
  if (typeof process !== 'undefined' && process.env.SERVICE_NAME) {
    return process.env.SERVICE_NAME;
  }
  return 'unknown-service';
}

const SERVICE_NAME = resolveServiceName();

// =============================================================================
// Attribute builder — merges ECS error fields from Error instances
// =============================================================================

/**
 * Merge bindings, context, and per-call fields into a flat Attributes object.
 * Error instances are expanded into ECS error.* fields.
 */
export function buildAttributes(
  bindings: Record<string, unknown>,
  context: LogContext,
  fieldsArg: Record<string, unknown> | undefined,
  error: Error | undefined,
): Record<string, unknown> {
  // Start with bound child fields (lowest priority)
  const attrs: Record<string, unknown> = { ...bindings };

  // Merge context fields (second priority)
  for (const [k, v] of Object.entries(context)) {
    if (v !== undefined) attrs[k] = v;
  }

  // Merge per-call fields (third priority)
  if (fieldsArg) {
    for (const [k, v] of Object.entries(fieldsArg)) {
      attrs[k] = v;
    }
  }

  // Expand Error into ECS error.* fields (highest priority — overwrites keys)
  if (error) {
    attrs['error.message'] = error.message;
    if (error.stack) attrs['error.stack_trace'] = error.stack;
    if ((error as NodeJS.ErrnoException).code) {
      attrs['error.code'] = (error as NodeJS.ErrnoException).code;
    }
    attrs['error.type'] = error.name ?? 'Error';
  }

  return attrs;
}

// =============================================================================
// Record factory
// =============================================================================

/**
 * Build a complete LogRecord from its constituent parts.
 */
export function buildRecord(opts: {
  level: LogLevel;
  body: string;
  bindings: Record<string, unknown>;
  context: LogContext;
  fields?: Record<string, unknown>;
  error?: Error;
}): LogRecord {
  const { level, body, bindings, context, fields, error } = opts;
  const attrs = buildAttributes(bindings, context, fields, error);

  const { traceId, spanId, requestId } = context;

  // requestId is common enough to surface at the Attributes level with ECS name
  if (requestId && !attrs['http.request.id']) {
    attrs['http.request.id'] = requestId;
  }

  return {
    Timestamp: new Date().toISOString(),
    SeverityNumber: OTEL_SEVERITY_NUMBERS[level],
    SeverityText: OTEL_SEVERITY_TEXT[level],
    Body: body,
    Attributes: attrs,
    ...(traceId ? { TraceId: traceId } : {}),
    ...(spanId   ? { SpanId:  spanId  } : {}),
    Resource: {
      'service.name': SERVICE_NAME,
    },
  };
}

// =============================================================================
// Record serialization
// =============================================================================

/** Serialize a LogRecord to a single JSON line (no trailing newline). */
export function serializeRecord(record: LogRecord): string {
  return JSON.stringify(record);
}
