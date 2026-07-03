// =============================================================================
// observability shim — Turbopack .js extension workaround
// =============================================================================
//
// WHY THIS FILE EXISTS
// --------------------
// The nucleus-installed packages/shared/observability/index.ts re-exports from
// sibling files using .js extensions (e.g. './log.js', './levels.js'). This is
// valid under TypeScript's moduleResolution: "bundler" and works with Webpack,
// but Next 16's Turbopack does NOT resolve .js extensions to the colocated .ts
// source files. Both `pnpm build` and `pnpm dev` fail with:
//   Module not found: Can't resolve './log.js'
//
// Because nucleus-managed files are read-only (nucleus-readonly rule), the
// correct workaround is to shadow the broken import path via tsconfig paths.
// The alias @/packages/shared/observability → lib/observability.ts (this file)
// is declared BEFORE the generic @/* alias in tsconfig.json so it wins by
// specificity. Existing use case imports (`import { log } from
// '@/packages/shared/observability'`) require zero changes.
//
// INTENTIONALLY NOT RE-IMPLEMENTED
// ---------------------------------
// The full nucleus observability surface includes:
//   withContext, setLevel, getLevel, addTransport,
//   makeFileTransport, makeConsoleTransport
// These are not used anywhere in this repo's modules/ tree. Implementing them
// here would be premature abstraction (architecture.md §9). They are omitted.
// If a use case needs them in the future, add them here at that time.
//
// FUTURE RESOLUTION PATHS
// ------------------------
// Either of these would let this shim be deleted:
//   a) Upstream a barrel-rewrite to nucleus that removes .js extensions
//      (nucleus then distributes updated files via `nucleus update`).
//   b) Add a Turbopack resolveAlias rule in next.config.ts that maps the
//      .js extension requests to the real .ts source paths.
// =============================================================================

import pino from 'pino';

// ---------------------------------------------------------------------------
// Logger type — matches the public surface of packages/shared/observability
// ---------------------------------------------------------------------------

export type Logger = {
  trace: (event: string, fieldsOrErr?: LogFields, fields?: Record<string, unknown>) => void;
  debug: (event: string, fieldsOrErr?: LogFields, fields?: Record<string, unknown>) => void;
  info:  (event: string, fieldsOrErr?: LogFields, fields?: Record<string, unknown>) => void;
  warn:  (event: string, fieldsOrErr?: LogFields, fields?: Record<string, unknown>) => void;
  error: (event: string, fieldsOrErr?: LogFields, fields?: Record<string, unknown>) => void;
  fatal: (event: string, fieldsOrErr?: LogFields, fields?: Record<string, unknown>) => void;
  child: (bindings: Record<string, unknown>) => Logger;
};

type LogFields =
  | Record<string, unknown>
  | Error
  | (() => Record<string, unknown>);

// ---------------------------------------------------------------------------
// ECS error serialization helper
// ---------------------------------------------------------------------------

function serializeError(err: Error): Record<string, unknown> {
  return {
    error: {
      message:     err.message,
      stack_trace: err.stack,
      type:        err.name,
    },
  };
}

// ---------------------------------------------------------------------------
// Resolve the LogFields argument to a plain object pino can merge
// ---------------------------------------------------------------------------

function resolveFields(
  fieldsOrErr?: LogFields,
  extra?: Record<string, unknown>,
): Record<string, unknown> {
  if (fieldsOrErr === undefined) {
    return extra ?? {};
  }

  if (typeof fieldsOrErr === 'function') {
    // Lazy callback — invoke only now (caller already checked level)
    return { ...(fieldsOrErr()), ...(extra ?? {}) };
  }

  if (fieldsOrErr instanceof Error) {
    return { ...serializeError(fieldsOrErr), ...(extra ?? {}) };
  }

  return { ...fieldsOrErr, ...(extra ?? {}) };
}

// ---------------------------------------------------------------------------
// pino instance — ISO timestamps, no base bindings, level from env
// ---------------------------------------------------------------------------

const rootPino = pino({
  level:      process.env.LOG_LEVEL ?? 'info',
  timestamp:  pino.stdTimeFunctions.isoTime,
  base:       null,
});

// ---------------------------------------------------------------------------
// makeLogger — builds a Logger wrapping a pino child
// ---------------------------------------------------------------------------

function makeLogger(pinoInstance: pino.Logger): Logger {
  function logMethod(
    level: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal',
  ) {
    return (
      event: string,
      fieldsOrErr?: LogFields,
      extra?: Record<string, unknown>,
    ): void => {
      // Level guard — pino checks this, but the lazy callback must only be
      // invoked when the level is enabled (architecture.md §7 / observability spec).
      if (!pinoInstance.isLevelEnabled(level)) return;

      const merged = resolveFields(fieldsOrErr, extra);
      pinoInstance[level](merged, event);
    };
  }

  const logger: Logger = {
    trace: logMethod('trace'),
    debug: logMethod('debug'),
    info:  logMethod('info'),
    warn:  logMethod('warn'),
    error: logMethod('error'),
    fatal: logMethod('fatal'),

    child(bindings: Record<string, unknown>): Logger {
      return makeLogger(pinoInstance.child(bindings));
    },
  };

  return logger;
}

// ---------------------------------------------------------------------------
// Singleton — the only export callers need
// ---------------------------------------------------------------------------

export const log: Logger = makeLogger(rootPino);
