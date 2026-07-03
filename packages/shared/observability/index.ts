// =============================================================================
// Observability — Package Entry Point
// =============================================================================
// Single import path: import { log } from '@/packages/shared/observability'
//
// This file is the SDK's public surface — not a re-export shim over hidden
// internals, but the direct source of the package's primary export.

export { log, makeLogger } from './log.js';
export type { Logger, LogFields, Transport, LoggerState } from './log.js';
export type { LogLevel } from './levels.js';
export type { LogRecord } from './schema.js';
export type { LogContext } from './context.js';
export { makeConsoleTransport } from './transports/console.js';
export { makeFileTransport } from './transports/file.js';
export type { FileTransportOptions } from './transports/file.js';
