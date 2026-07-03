// =============================================================================
// Observability -- File Transport with Size-Based Rotation
// =============================================================================
// Writes line-delimited JSON records to a rotating log file.
//
// Rotation contract (AC3):
//   - Rotate when active file reaches `maxSizeBytes` (default: 10 MB)
//   - Retain `maxFiles` rotated files (default: 5); oldest evicted on 6th rotation
//   - Zero record loss across rotation: uses synchronous appends so every write
//     is durable before the call returns.
//
// File naming:
//   {path}           -- current log file (always written to this name)
//   {path}.1         -- most-recent rotation
//   {path}.2         -- older
//   ...
//   {path}.{n}       -- oldest retained
//
// Design: we use fs.appendFileSync for writes. This is synchronous and
// avoids the async-stream drain problem in tests. For production use in a
// high-throughput service, a batched async transport can be added later, but
// for correctness and zero-record-loss the sync approach is the right default.

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { LogRecord } from '../schema.js';
import type { Transport } from './console.js';

// =============================================================================
// File transport options
// =============================================================================

export type FileTransportOptions = {
  /** Absolute path to the log file. Rotated copies append .1, .2, ... */
  filePath: string;
  /** Rotate when the active file exceeds this many bytes. Default: 10 MB. */
  maxSizeBytes?: number;
  /** Number of rotated files to retain. Oldest evicted beyond this count. Default: 5. */
  maxFiles?: number;
};

const DEFAULT_MAX_SIZE  = 10 * 1024 * 1024; // 10 MB
const DEFAULT_MAX_FILES = 5;

// =============================================================================
// File transport implementation
// =============================================================================

/**
 * Create a file transport.
 *
 * The returned transport writes one JSON line per record using synchronous
 * fs.appendFileSync to guarantee zero record loss. When the active file
 * reaches `maxSizeBytes`, it rotates: shifts existing .1..N files to .2..N+1,
 * evicts the oldest beyond `maxFiles`, moves the active file to .1, then
 * continues writing to a fresh active file.
 */
export function makeFileTransport(opts: FileTransportOptions): Transport & { close: () => void } {
  const filePath = opts.filePath;
  const maxSize  = opts.maxSizeBytes ?? DEFAULT_MAX_SIZE;
  const maxFiles = opts.maxFiles    ?? DEFAULT_MAX_FILES;

  // Ensure the directory exists
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  // Track bytes written since last rotation (initialize from existing file)
  let bytesWritten = getFileSizeSync(filePath);

  function getFileSizeSync(p: string): number {
    try { return fs.statSync(p).size; } catch { return 0; }
  }

  /**
   * Rotate files synchronously:
   * 1. Evict file beyond maxFiles
   * 2. Shift .N-1 -> .N, .N-2 -> .N-1, ..., active -> .1
   * 3. Active file is now gone; next write creates it fresh
   */
  function rotate(): void {
    // Evict the oldest retained file if it exists
    const evict = `${filePath}.${maxFiles}`;
    if (fs.existsSync(evict)) {
      try { fs.unlinkSync(evict); } catch { /* best effort */ }
    }

    // Shift: .N-1 -> .N, .N-2 -> .N-1, ..., .1 -> .2
    for (let i = maxFiles - 1; i >= 1; i--) {
      const src = `${filePath}.${i}`;
      const dst = `${filePath}.${i + 1}`;
      if (fs.existsSync(src)) {
        try { fs.renameSync(src, dst); } catch { /* best effort */ }
      }
    }

    // Move active -> .1
    if (fs.existsSync(filePath)) {
      try { fs.renameSync(filePath, `${filePath}.1`); } catch { /* best effort */ }
    }

    // Reset byte counter
    bytesWritten = 0;
  }

  return {
    write(_record: LogRecord, json: string): void {
      const line = json + '\n';
      const lineSize = Buffer.byteLength(line, 'utf8');

      // Rotate if adding this record would exceed the threshold
      if (bytesWritten + lineSize > maxSize && bytesWritten > 0) {
        rotate();
      }

      // Write synchronously -- zero record loss guaranteed
      fs.appendFileSync(filePath, line, 'utf8');
      bytesWritten += lineSize;
    },

    close(): void {
      // No-op: sync writes have no stream to close.
      // Kept in the API for interface compatibility.
    },
  };
}
