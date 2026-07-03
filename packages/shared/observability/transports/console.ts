// =============================================================================
// Observability — Console Transport
// =============================================================================
// Writes serialized JSON log records to stdout, one record per line.
// Default in serverless / production environments.
//
// Pretty output: when pino-pretty is available AND LOG_FORMAT=pretty (or
// NODE_ENV=development with LOG_FORMAT unset), the JSON record is formatted
// with pino-pretty. If pino-pretty is absent, silently falls back to JSON.
//
// pino-pretty configuration:
//   messageKey:   'Body'      — OTel Body field is the human-readable message
//   timestampKey: 'Timestamp' — ISO-8601 OTel Timestamp field
//   levelKey:     'level'     — pino's native numeric level (present alongside
//                               SeverityText/SeverityNumber) for colorization

import type { LogRecord } from '../schema.js';

export type Transport = {
  write: (record: LogRecord, json: string) => void;
};

// =============================================================================
// Format selection
// =============================================================================

type OutputFormat = 'json' | 'pretty';

function resolveOutputFormat(): OutputFormat {
  const explicit = process.env.LOG_FORMAT?.toLowerCase().trim();
  if (explicit === 'pretty') return 'pretty';
  if (explicit === 'json')   return 'json';

  // NODE_ENV-derived default
  const nodeEnv = (process.env.NODE_ENV ?? '').toLowerCase().trim();
  if (nodeEnv === 'development' || nodeEnv === 'dev') return 'pretty';
  return 'json';
}

// =============================================================================
// pino-pretty optional integration
// =============================================================================

type PrettyFormatter = (json: string) => string | undefined;

let prettyFormatter: PrettyFormatter | null = null;
let prettyAttempted = false;

/**
 * Attempt to load pino-pretty at runtime. If absent, returns null silently.
 * Result is cached after the first attempt.
 *
 * pino-pretty is configured with our OTel field keys:
 *   - messageKey: 'Body'       — event string (OTel Body)
 *   - timestampKey: 'Timestamp' — ISO-8601 timestamp (OTel Timestamp)
 *   - levelKey: 'level'        — pino native numeric level (for colorization)
 *
 * The 'level' field is present in pino's serialized output alongside
 * SeverityText/SeverityNumber. pino-pretty uses it to apply level-based
 * color coding with its built-in label map.
 */
function tryLoadPretty(): PrettyFormatter | null {
  if (prettyAttempted) return prettyFormatter;
  prettyAttempted = true;

  try {
    // Dynamic require to avoid hard dependency at bundle time.
    // The absence at runtime produces a simple module-not-found — caught below.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pinoPretty = require('pino-pretty') as {
      build?: (opts: Record<string, unknown>) => {
        write?: (s: string) => void;
        prettify?: (s: string) => string;
      };
    };

    // pino-pretty 11+ exports a build factory that returns a prettifier object.
    if (typeof pinoPretty.build === 'function') {
      const prettifier = pinoPretty.build({
        colorize: true,
        translateTime: false,
        ignore: 'pid,hostname,level,SeverityNumber',
        messageKey: 'Body',
        levelKey: 'level',
        timestampKey: 'Timestamp',
      });

      if (prettifier && typeof prettifier.prettify === 'function') {
        const p = prettifier;
        prettyFormatter = (json: string): string | undefined => {
          try {
            const result = p.prettify!(JSON.parse(json));
            // Guard against empty/undefined return
            return result != null && result.length > 0 ? result : undefined;
          } catch {
            return undefined;
          }
        };
      } else {
        // build() returned an object without a prettify method — not usable
        prettyFormatter = null;
      }
    } else {
      // pino-pretty present but doesn't have the build() API (unexpected version)
      prettyFormatter = null;
    }
  } catch {
    // pino-pretty not installed — silently fall back to JSON (AC7).
    prettyFormatter = null;
  }

  return prettyFormatter;
}

// =============================================================================
// Console transport factory
// =============================================================================

/**
 * Create a console transport that writes to process.stdout.
 * Format is resolved from LOG_FORMAT env var / NODE_ENV at construction time.
 */
export function makeConsoleTransport(): Transport {
  const format = resolveOutputFormat();

  return {
    write(_record: LogRecord, json: string): void {
      if (format === 'pretty') {
        const formatter = tryLoadPretty();
        if (formatter) {
          const pretty = formatter(json);
          if (pretty != null) {
            process.stdout.write(pretty.endsWith('\n') ? pretty : pretty + '\n');
            return;
          }
        }
        // pino-pretty absent or returned nothing — fall back to JSON (AC7)
      }
      process.stdout.write(json + '\n');
    },
  };
}

// =============================================================================
// Exported for testing — allows resetting the cached formatter
// =============================================================================

/**
 * Reset the cached pino-pretty formatter state. Used in tests to simulate
 * presence/absence of pino-pretty without restarting the process.
 */
export function _resetPrettyFormatterCache(): void {
  prettyFormatter = null;
  prettyAttempted = false;
}
