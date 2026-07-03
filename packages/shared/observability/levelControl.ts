// =============================================================================
// Observability -- Runtime Level Control
// =============================================================================
// Manages per-namespace level overrides with glob pattern matching.
// Pattern resolution:
//   1. Exact match (highest priority)
//   2. Most-specific glob (by length, descending)
//   3. Global '*' wildcard (lowest priority)
//   4. Instance default (fallback)
//
// Patterns are pre-compiled into a sorted lookup table; resolution cost is
// O(n) on the number of registered patterns, which is tiny in practice.

import { LogLevel, LEVEL_VALUES, parseLevel, defaultLevelFromNodeEnv } from './levels.js';

// =============================================================================
// Glob Matching -- Minimal, No Regex Per Call
// =============================================================================

/**
 * Compiled pattern entry. Sorted descending by specificity (length) so
 * the first match wins and we never compile a regex at match time.
 */
type PatternEntry = {
  pattern: string;
  level: LogLevel;
  /** Pre-compiled regex from the glob pattern. Compiled once at setLevel time. */
  regex: RegExp;
  /** Specificity score: exact match = Infinity, '*' = 0, others = pattern.length */
  score: number;
};

/**
 * Convert a glob pattern to a RegExp.
 * '*' alone (no surrounding chars) = catch-all, matches everything including dots.
 * 'prefix.*' = matches prefix followed by dot and any single segment (no further dots).
 * '**' anywhere = matches any number of characters including dots.
 * '?' = matches any single character.
 * Exact patterns (no wildcards) match verbatim.
 */
function globToRegex(pattern: string): RegExp {
  // Special case: bare '*' is a catch-all -- matches any source string.
  if (pattern === '*') return /^.*$/;

  // Build regex piece by piece to avoid string-escape confusion.
  // Split on '**' first, handle each piece, then join with '.*'.
  const parts = pattern.split('**');
  const regexParts = parts.map(part => {
    // Within each piece, split on '*', escape each fragment, join with [^.]*
    // (single '*' within a pattern means one segment, no dot crossing)
    const subParts = part.split('*');
    const escapedSubs = subParts.map(s => s.replace(/[.+^${}()|[\]\\]/g, '\\$&'));
    return escapedSubs.join('[^.]*');
  });
  const regexStr = regexParts.join('.*');
  return new RegExp('^' + regexStr + '$');
}

function patternScore(pattern: string): number {
  if (!pattern.includes('*') && !pattern.includes('?')) return Infinity; // exact
  if (pattern === '*') return 0;
  return pattern.length;
}

// =============================================================================
// Level Registry
// =============================================================================

/**
 * In-memory pattern registry.
 * Patterns are sorted descending by score so the first match wins.
 */
export type LevelRegistry = {
  patterns: PatternEntry[];
  instanceDefault: LogLevel;
};

export function makeLevelRegistry(instanceDefault: LogLevel): LevelRegistry {
  return { patterns: [], instanceDefault };
}

/**
 * Register or update a pattern in the registry.
 * Re-inserts the entry in sorted order (descending score).
 */
export function registrySetLevel(
  registry: LevelRegistry,
  pattern: string,
  level: LogLevel,
): void {
  // Remove existing entry for this pattern
  registry.patterns = registry.patterns.filter(e => e.pattern !== pattern);

  const entry: PatternEntry = {
    pattern,
    level,
    regex: globToRegex(pattern),
    score: patternScore(pattern),
  };

  // Insert in sorted order (descending score)
  let inserted = false;
  for (let i = 0; i < registry.patterns.length; i++) {
    if (entry.score >= registry.patterns[i].score) {
      registry.patterns.splice(i, 0, entry);
      inserted = true;
      break;
    }
  }
  if (!inserted) registry.patterns.push(entry);
}

/**
 * Resolve the effective level for a given source string.
 * Returns the instance default when no pattern matches.
 */
export function registryGetLevel(registry: LevelRegistry, source: string): LogLevel {
  for (const entry of registry.patterns) {
    if (entry.regex.test(source)) return entry.level;
  }
  return registry.instanceDefault;
}

// =============================================================================
// Env Var Parsing
// =============================================================================

/**
 * Parse LOG_LEVELS env var: '*=info,campaigns=debug,iam.policy=trace'
 * Returns an array of [pattern, level] pairs in declaration order.
 * Invalid entries are silently skipped.
 */
export function parseLogLevelsEnv(raw: string): Array<[string, LogLevel]> {
  return raw
    .split(',')
    .map(s => s.trim())
    .filter(s => s.length > 0)
    .flatMap(entry => {
      const eqIdx = entry.indexOf('=');
      if (eqIdx < 1) return [];
      const pattern = entry.slice(0, eqIdx).trim();
      const levelStr = entry.slice(eqIdx + 1).trim();
      const level = parseLevel(levelStr);
      if (!level || !pattern) return [];
      return [[pattern, level] as [string, LogLevel]];
    });
}

/**
 * Build the initial level registry from environment variables and NODE_ENV.
 *
 * Priority (highest to lowest):
 *   1. LOG_LEVELS per-namespace overrides (applied as individual setLevel calls)
 *   2. LOG_LEVEL global override
 *   3. NODE_ENV-derived default
 */
export function buildRegistryFromEnv(env: {
  LOG_LEVEL?: string;
  LOG_LEVELS?: string;
  NODE_ENV?: string;
}): LevelRegistry {
  const nodeEnvDefault = defaultLevelFromNodeEnv(env.NODE_ENV);
  const globalLevel = env.LOG_LEVEL ? (parseLevel(env.LOG_LEVEL) ?? nodeEnvDefault) : nodeEnvDefault;

  const registry = makeLevelRegistry(globalLevel);

  if (env.LOG_LEVELS) {
    const entries = parseLogLevelsEnv(env.LOG_LEVELS);
    for (const [pattern, level] of entries) {
      registrySetLevel(registry, pattern, level);
    }
  }

  return registry;
}

// =============================================================================
// Helpers used by the logger
// =============================================================================

/**
 * Returns true if the given level is enabled for the given source,
 * given the current registry state.
 */
export function isSourceLevelEnabled(
  registry: LevelRegistry,
  source: string,
  level: LogLevel,
): boolean {
  const effectiveLevel = registryGetLevel(registry, source);
  return LEVEL_VALUES[level] >= LEVEL_VALUES[effectiveLevel];
}
