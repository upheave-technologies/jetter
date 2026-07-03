// =============================================================================
// Observability — Log Levels
// =============================================================================
// Integer-based severity levels aligned with RFC 5424 / pino / OTel.
// Level guards use integer comparison: cost = one integer compare when disabled.

/** Ordered severity levels, lowest to highest. */
export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

/** Integer values for each level. Lower = less severe. */
export const LEVEL_VALUES: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info:  30,
  warn:  40,
  error: 50,
  fatal: 60,
};

/**
 * OTel SeverityNumber mapping.
 * https://opentelemetry.io/docs/specs/otel/logs/data-model/#field-severitynumber
 */
export const OTEL_SEVERITY_NUMBERS: Record<LogLevel, number> = {
  trace:  1,
  debug:  5,
  info:   9,
  warn:  13,
  error: 17,
  fatal: 21,
};

/** Canonical SeverityText for each level. */
export const OTEL_SEVERITY_TEXT: Record<LogLevel, string> = {
  trace: 'TRACE',
  debug: 'DEBUG',
  info:  'INFO',
  warn:  'WARN',
  error: 'ERROR',
  fatal: 'FATAL',
};

/** Returns true when `level` should be emitted given `minimumLevel`. */
export function isLevelEnabled(level: LogLevel, minimumLevel: LogLevel): boolean {
  return LEVEL_VALUES[level] >= LEVEL_VALUES[minimumLevel];
}

/**
 * Parse a LogLevel string, returning undefined for unknown values.
 * Used when reading env vars to avoid throwing on misconfiguration.
 */
export function parseLevel(raw: string): LogLevel | undefined {
  const lower = raw.toLowerCase().trim();
  if (lower in LEVEL_VALUES) return lower as LogLevel;
  return undefined;
}

/**
 * Determine the default log level from NODE_ENV.
 * dev=debug, prod=info, test=warn.
 * Falls back to 'info' for unknown NODE_ENV values.
 */
export function defaultLevelFromNodeEnv(nodeEnv?: string): LogLevel {
  const env = (nodeEnv ?? '').toLowerCase().trim();
  if (env === 'development' || env === 'dev') return 'debug';
  if (env === 'test')                          return 'warn';
  return 'info';
}
