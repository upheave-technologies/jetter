#!/usr/bin/env node
// Captain compiler — the deterministic substrate under the PM agent.
// Reads the spine (initiatives + decisions + roadmap) and the leaves (SPEC.md
// files), emits system/state.json, validates structural integrity, and surfaces
// planning/health flags. No LLM. Zero dependencies. Pure function of the source.
//
// Usage:
//   node captain-compile.mjs [--root DIR] [--quiet] [--summary] [--json] [--strict-flags] [--today YYYY-MM-DD]
//
// Modes:
//   (default)       write state.json, print report to stderr, exit 1 if hard violations  -> CI gate
//   --quiet         write state.json, no output, always exit 0                            -> PostToolUse hook
//   --summary       write state.json, print a compact status block to stdout, exit 0      -> SessionStart context
//   --json          write state.json, print full state.json to stdout, exit 0             -> piping / portfolio rollup
//   --strict-flags  also exit 1 when soft flags exist (use when you want a hard line)
//   --today         override "today" for reproducible output in tests/CI

import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';

// ---------- config ----------
const DEFAULTS = {
  specsDir: 'system/context',
  specFile: 'SPEC.md',
  initiativesDir: 'system/initiatives',
  decisionsDir: 'system/decisions',
  roadmapFile: 'system/roadmap.md',
  out: 'system/state.json',
  staleDays: 14,
};

const SPEC_STATES = ['working', 'paused', 'done', 'abandoned'];
const SPEC_TYPES = ['feature', 'modification', 'removal', 'refactor', 'bugfix', 'schema', 'tooling', 'spike'];
const INIT_STATUSES = ['proposed', 'active', 'done', 'parked', 'dropped'];
const HORIZONS = ['now', 'next', 'later'];
const OPEN_SPEC_STATES = ['working', 'paused'];
const DECISION_STATUSES = ['proposed', 'accepted', 'superseded', 'deprecated'];

// ---------- args ----------
function parseArgs(argv) {
  const a = { root: '.', quiet: false, summary: false, json: false, strictFlags: false, today: null };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--root') a.root = argv[++i];
    else if (t === '--quiet') a.quiet = true;
    else if (t === '--summary') a.summary = true;
    else if (t === '--json') a.json = true;
    else if (t === '--strict-flags') a.strictFlags = true;
    else if (t === '--today') a.today = argv[++i];
  }
  return a;
}

// ---------- tiny YAML frontmatter parser (controlled schemas only) ----------
function parseFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { data: {}, body: text };
  return { data: parseYamlBlock(m[1]), body: text.slice(m[0].length) };
}

function stripQuotes(s) {
  s = s.trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

function parseInlineArray(s) {
  const inner = s.replace(/^\[/, '').replace(/\]$/, '').trim();
  if (!inner) return [];
  return inner.split(',').map((x) => stripQuotes(x)).filter(Boolean);
}

function parseYamlBlock(raw) {
  const data = {};
  const lines = raw.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    i++;
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const m = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    const val = m[2].trim();
    if (val === '') {
      const items = [];
      while (i < lines.length && /^\s*-\s+/.test(lines[i])) {
        items.push(stripQuotes(lines[i].replace(/^\s*-\s+/, '')));
        i++;
      }
      data[key] = items;
    } else if (val.startsWith('[')) {
      data[key] = parseInlineArray(val);
    } else {
      data[key] = stripQuotes(val);
    }
  }
  return data;
}

// ---------- verdict harvest (reads the auditor's AUTO blocks) ----------
function extractBlock(body, tag) {
  const re = new RegExp('<!--\\s*' + tag + '[\\s\\S]*?-->([\\s\\S]*?)<!--\\s*/' + tag + '\\s*-->');
  const m = body.match(re);
  return m ? m[1] : null;
}

function normalizeVerdict(block) {
  if (!block) return null;
  const t = block.toUpperCase();
  if (t.includes('FAIL')) return 'FAIL';
  if (t.includes('PASS WITH NOTES')) return 'PASS_WITH_NOTES';
  if (t.includes('PASS')) return 'PASS';
  if (t.includes('BLOCK')) return 'BLOCK';
  return null;
}

function harvestVerdict(body) {
  return normalizeVerdict(extractBlock(body, 'AUTO:VERDICT') || extractBlock(body, 'AUTO:CARD'));
}

// ---------- fs ----------
function walk(dir) {
  let out = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '.git') continue;
      out = out.concat(walk(p));
    } else {
      out.push(p);
    }
  }
  return out;
}

// ---------- dates ----------
function parseDate(s) {
  if (!s) return null;
  const d = new Date(s + 'T00:00:00Z');
  return isNaN(d.getTime()) ? null : d;
}
function daysBetween(a, b) {
  return Math.floor((a - b) / 86400000);
}

// ---------- load ----------
function loadConfig(root) {
  const p = join(root, 'captain.config.json');
  if (!existsSync(p)) return { ...DEFAULTS };
  try {
    return { ...DEFAULTS, ...JSON.parse(readFileSync(p, 'utf8')) };
  } catch {
    return { ...DEFAULTS };
  }
}

function loadSpecs(root, cfg) {
  const dir = join(root, cfg.specsDir);
  const files = walk(dir).filter((f) => basename(f) === cfg.specFile);
  const specs = {};
  const order = [];
  for (const f of files) {
    const text = readFileSync(f, 'utf8');
    const { data, body } = parseFrontmatter(text);
    const rel = f.slice(root.length).replace(/^[/\\]/, '');
    const id = data.id || `(no-id:${rel})`;
    specs[id] = {
      id: data.id || null,
      type: data.type || null,
      state: data.state || null,
      created: data.created || null,
      updated: data.updated || null,
      verdict: harvestVerdict(body),
      path: rel,
      initiative: null, // backfilled from spine
    };
    order.push(id);
  }
  return { specs, order };
}

function loadInitiatives(root, cfg) {
  const dir = join(root, cfg.initiativesDir);
  const files = walk(dir).filter((f) => /INIT-.*\.md$/.test(basename(f)));
  const inits = {};
  const order = [];
  for (const f of files) {
    const text = readFileSync(f, 'utf8');
    const { data } = parseFrontmatter(text);
    const rel = f.slice(root.length).replace(/^[/\\]/, '');
    const id = data.id || `(no-id:${rel})`;
    inits[id] = {
      id: data.id || null,
      title: data.title || null,
      status: data.status || null,
      horizon: data.horizon || null,
      owner: data.owner || null,
      opened: data.opened || null,
      target: data.target || null,
      specs: Array.isArray(data.specs) ? data.specs : [],
      path: rel,
    };
    order.push(id);
  }
  return { inits, order };
}

function loadDecisions(root, cfg) {
  const dir = join(root, cfg.decisionsDir);
  const files = walk(dir).filter((f) => /DEC-.*\.md$/.test(basename(f)));
  const decs = {};
  const order = [];
  for (const f of files) {
    const text = readFileSync(f, 'utf8');
    const { data } = parseFrontmatter(text);
    const rel = f.slice(root.length).replace(/^[/\\]/, '');
    const id = data.id || `(no-id:${rel})`;
    decs[id] = {
      id: data.id || null,
      title: data.title || null,
      status: data.status || null,
      decided: data.decided || null,
      owner: data.owner || null,
      supersedes: Array.isArray(data.supersedes) ? data.supersedes : [],
      relates: Array.isArray(data.relates) ? data.relates : [],
      path: rel,
    };
    order.push(id);
  }
  return { decs, order };
}

function loadRoadmapText(root, cfg) {
  const p = join(root, cfg.roadmapFile);
  return existsSync(p) ? readFileSync(p, 'utf8') : null;
}

// ---------- validate ----------
function validate(specs, specOrder, inits, initOrder, decs, decOrder, roadmapText, today, staleDays) {
  const violations = [];
  const flags = [];
  const V = (code, id, message) => violations.push({ code, level: 'violation', id, message });
  const F = (code, id, message) => flags.push({ code, level: 'flag', id, message });

  // --- spec integrity ---
  const seenSpec = {};
  for (const id of specOrder) {
    const s = specs[id];
    if (!s.id) V('spec-no-id', s.path, `SPEC has no id: ${s.path}`);
    if (s.id) {
      if (seenSpec[s.id]) V('spec-dup-id', s.id, `Duplicate SPEC id "${s.id}" (${s.path} and ${seenSpec[s.id]})`);
      seenSpec[s.id] = s.path;
    }
    if (s.state && !SPEC_STATES.includes(s.state)) V('spec-bad-state', s.id, `SPEC "${s.id}" has invalid state "${s.state}"`);
    if (!s.state) V('spec-no-state', s.id, `SPEC "${s.id}" has no state`);
    if (s.type && !SPEC_TYPES.includes(s.type)) V('spec-bad-type', s.id, `SPEC "${s.id}" has invalid type "${s.type}"`);
    if (!s.updated) V('spec-no-updated', s.id, `SPEC "${s.id}" has no updated date`);
  }

  // --- initiative integrity ---
  const seenInit = {};
  const referenced = new Set();
  for (const id of initOrder) {
    const it = inits[id];
    if (!it.id) V('init-no-id', it.path, `Initiative has no id: ${it.path}`);
    if (it.id) {
      if (seenInit[it.id]) V('init-dup-id', it.id, `Duplicate initiative id "${it.id}"`);
      seenInit[it.id] = it.path;
    }
    if (it.status && !INIT_STATUSES.includes(it.status)) V('init-bad-status', it.id, `Initiative "${it.id}" has invalid status "${it.status}"`);
    if (!it.status) V('init-no-status', it.id, `Initiative "${it.id}" has no status`);
    if (it.horizon && !HORIZONS.includes(it.horizon)) V('init-bad-horizon', it.id, `Initiative "${it.id}" has invalid horizon "${it.horizon}"`);
    if (!it.horizon) V('init-no-horizon', it.id, `Initiative "${it.id}" has no horizon`);
    for (const sid of it.specs) {
      if (!specs[sid]) V('init-broken-link', it.id, `Initiative "${it.id}" references unknown SPEC "${sid}"`);
      else {
        referenced.add(sid);
        specs[sid].initiative = it.id;
      }
    }
  }

  // --- decision integrity ---
  const seenDec = {};
  for (const id of decOrder) {
    const d = decs[id];
    if (!d.id) V('dec-no-id', d.path, `Decision has no id: ${d.path}`);
    if (d.id) {
      if (seenDec[d.id]) V('dec-dup-id', d.id, `Duplicate decision id "${d.id}" (${d.path} and ${seenDec[d.id]})`);
      seenDec[d.id] = d.path;
    }
    if (d.status && !DECISION_STATUSES.includes(d.status)) V('dec-bad-status', d.id, `Decision "${d.id}" has invalid status "${d.status}"`);
    if (!d.status) V('dec-no-status', d.id, `Decision "${d.id}" has no status`);
    for (const sup of d.supersedes) {
      if (!decs[sup]) V('dec-broken-supersede', d.id, `Decision "${d.id}" supersedes unknown decision "${sup}"`);
    }
  }

  // --- planning / health flags (soft) ---
  for (const id of specOrder) {
    const s = specs[id];
    if (!s.id) continue;
    if (OPEN_SPEC_STATES.includes(s.state) && !referenced.has(s.id)) {
      F('spec-orphan', s.id, `SPEC "${s.id}" is ${s.state} but belongs to no initiative`);
    }
    if (s.state === 'working' && s.updated) {
      const u = parseDate(s.updated);
      if (u) {
        const age = daysBetween(today, u);
        if (age > staleDays) F('spec-stale', s.id, `SPEC "${s.id}" is working but untouched for ${age}d`);
      }
    }
    if (s.state === 'done' && s.verdict !== 'PASS' && s.verdict !== 'PASS_WITH_NOTES') {
      F('spec-done-no-pass', s.id, `SPEC "${s.id}" is done but auditor verdict is ${s.verdict || 'absent'}`);
    }
  }

  let anyActiveNow = false;
  for (const id of initOrder) {
    const it = inits[id];
    if (!it.id) continue;
    const childStates = it.specs.filter((sid) => specs[sid]).map((sid) => specs[sid].state);
    const inFlight = childStates.filter((st) => OPEN_SPEC_STATES.includes(st)).length;

    if (it.horizon === 'now' && it.status === 'active') anyActiveNow = true;

    if (it.status === 'active' && it.target) {
      const t = parseDate(it.target);
      if (t && daysBetween(today, t) > 0) {
        F('init-off-track', it.id, `Initiative "${it.id}" is active and past target ${it.target}`);
      }
    }
    if (it.horizon === 'now' && it.status === 'active' && inFlight === 0) {
      F('init-now-idle', it.id, `Initiative "${it.id}" is active on the NOW horizon but has no in-flight SPEC`);
    }
    if (it.status === 'active' && childStates.length > 0 && inFlight === 0 &&
        childStates.every((st) => st === 'done' || st === 'abandoned')) {
      F('init-completable', it.id, `Initiative "${it.id}" is active but all its SPECs are done/abandoned — close it?`);
    }
    if (['proposed', 'active'].includes(it.status) && roadmapText && it.id && !roadmapText.includes(it.id)) {
      F('init-not-on-roadmap', it.id, `Initiative "${it.id}" is ${it.status} but not mentioned in roadmap.md`);
    }
  }

  if (initOrder.length === 0) F('no-initiatives', null, 'No initiatives found — the spine is empty');
  else if (!anyActiveNow) F('empty-now-horizon', null, 'Nothing active on the NOW horizon');
  if (roadmapText === null) F('no-roadmap', null, `No roadmap found at the configured path`);

  return { violations, flags };
}

// ---------- build state ----------
function buildState(specs, specOrder, inits, initOrder, decs, decOrder, findings, today) {
  const initView = (it) => ({
    id: it.id, title: it.title, status: it.status, horizon: it.horizon,
    owner: it.owner, target: it.target, specs: it.specs,
    specStates: Object.fromEntries(it.specs.filter((s) => specs[s]).map((s) => [s, specs[s].state])),
  });

  const horizons = { now: [], next: [], later: [] };
  for (const id of initOrder) {
    const it = inits[id];
    if (it.horizon && horizons[it.horizon]) horizons[it.horizon].push(initView(it));
  }

  const specRollup = {};
  for (const id of specOrder) {
    const st = specs[id].state || 'unknown';
    specRollup[st] = (specRollup[st] || 0) + 1;
  }
  const initRollup = {};
  for (const id of initOrder) {
    const st = inits[id].status || 'unknown';
    initRollup[st] = (initRollup[st] || 0) + 1;
  }
  const decRollup = {};
  for (const id of decOrder) {
    const st = decs[id].status || 'unknown';
    decRollup[st] = (decRollup[st] || 0) + 1;
  }

  return {
    generated: new Date().toISOString(),
    asOf: today.toISOString().slice(0, 10),
    horizons,
    initiatives: Object.fromEntries(initOrder.map((id) => [id, initView(inits[id])])),
    specs: Object.fromEntries(specOrder.map((id) => [id, specs[id]])),
    decisions: Object.fromEntries(decOrder.map((id) => [id, decs[id]])),
    rollup: { specs: specRollup, initiatives: initRollup, decisions: decRollup },
    violations: findings.violations,
    flags: findings.flags,
    healthy: findings.violations.length === 0,
  };
}

// ---------- report ----------
function printReport(state) {
  const v = state.violations, f = state.flags;
  const lines = [];
  lines.push(`Captain — index compiled ${state.asOf} · ${state.healthy ? 'STRUCTURE OK' : 'STRUCTURE BROKEN'}`);
  if (v.length) {
    lines.push(`\n${v.length} violation(s) — these fail CI:`);
    for (const x of v) lines.push(`  X  [${x.code}] ${x.message}`);
  }
  if (f.length) {
    lines.push(`\n${f.length} flag(s) — Captain should review:`);
    for (const x of f) lines.push(`  !  [${x.code}] ${x.message}`);
  }
  if (!v.length && !f.length) lines.push('No violations, no flags. Clean.');
  process.stderr.write(lines.join('\n') + '\n');
}

function printSummary(state) {
  const h = state.horizons;
  const fmt = (arr) => arr.length
    ? arr.map((i) => `${i.id} ${i.title || ''} (${i.status})`).join(' · ')
    : '—';
  const lines = [];
  lines.push(`CAPTAIN — project state as of ${state.asOf}`);
  lines.push(`NOW:   ${fmt(h.now)}`);
  lines.push(`NEXT:  ${fmt(h.next)}`);
  lines.push(`LATER: ${fmt(h.later)}`);
  lines.push(`Health: ${state.violations.length} violation(s), ${state.flags.length} flag(s)`);
  if (state.flags.length) {
    lines.push('Flags: ' + state.flags.slice(0, 8).map((x) => x.message).join('; '));
  }
  if (state.violations.length) {
    lines.push('VIOLATIONS: ' + state.violations.map((x) => x.message).join('; '));
  }
  process.stdout.write(lines.join('\n') + '\n');
}

// ---------- main ----------
function main() {
  const a = parseArgs(process.argv.slice(2));
  const root = a.root;
  const cfg = loadConfig(root);
  const today = a.today ? parseDate(a.today) : new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z');

  const { specs, order: specOrder } = loadSpecs(root, cfg);
  const { inits, order: initOrder } = loadInitiatives(root, cfg);
  const { decs, order: decOrder } = loadDecisions(root, cfg);
  const roadmapText = loadRoadmapText(root, cfg);

  const findings = validate(specs, specOrder, inits, initOrder, decs, decOrder, roadmapText, today, cfg.staleDays);
  const state = buildState(specs, specOrder, inits, initOrder, decs, decOrder, findings, today);

  const outPath = join(root, cfg.out);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(state, null, 2) + '\n');

  // Self-heal: state.json is a derived artifact with time-changing fields, so
  // it must be gitignored. If the project has a .gitignore and the line is
  // missing, append it. Idempotent (line-precise match). Silent in --quiet
  // mode. Failures are swallowed — gitignore self-heal must never break the
  // compiler's primary job.
  try {
    const gitignorePath = join(root, '.gitignore');
    if (existsSync(gitignorePath)) {
      const current = readFileSync(gitignorePath, 'utf8');
      const hasLine = current.split(/\r?\n/).some((line) => line.trim() === 'system/state.json');
      if (!hasLine) {
        const prefix = current.endsWith('\n') ? '' : '\n';
        const appended = prefix + '\n# captain compiler output (derived; regenerated on SessionStart + PostToolUse)\nsystem/state.json\n';
        writeFileSync(gitignorePath, current + appended);
        if (!a.quiet) {
          process.stderr.write("captain-compile: added system/state.json to .gitignore (it's a derived artifact)\n");
        }
      }
    }
  } catch {
    // Swallow — gitignore self-heal is a courtesy, not a hard requirement.
  }

  if (a.json) process.stdout.write(JSON.stringify(state, null, 2) + '\n');
  else if (a.summary) printSummary(state);
  else if (!a.quiet) printReport(state);

  const fail = state.violations.length > 0 || (a.strictFlags && state.flags.length > 0);
  process.exit(a.quiet ? 0 : fail ? 1 : 0);
}

main();
