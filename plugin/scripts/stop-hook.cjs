#!/usr/bin/env node
"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// dist/hooks/stopDrain.js
var import_promises = require("node:fs/promises");
var import_node_os2 = require("node:os");
var import_node_path2 = require("node:path");

// dist/parser/decisionTagParser.js
var TAG_RE = /<assay-decision\b([^>]*)>([\s\S]*?)<\/assay-decision>/g;
var ATTR_RE = /(\w[\w-]*)\s*=\s*"([^"]*)"/g;
function parseAttrs(attrString) {
  const out = {};
  let m;
  ATTR_RE.lastIndex = 0;
  while (m = ATTR_RE.exec(attrString)) {
    out[m[1]] = m[2];
  }
  return out;
}
function parseDecisionTags(transcript) {
  const decisions = [];
  const errors = [];
  const seen = /* @__PURE__ */ new Set();
  let match;
  TAG_RE.lastIndex = 0;
  while (match = TAG_RE.exec(transcript)) {
    const start = match.index;
    const end = match.index + match[0].length;
    const attrs = parseAttrs(match[1] ?? "");
    const body = (match[2] ?? "").trim();
    const kindRaw = attrs.kind ?? "decision";
    if (kindRaw !== "decision" && kindRaw !== "conflict") {
      errors.push({
        message: `unknown kind="${kindRaw}" (expected "decision" or "conflict")`,
        span: { start, end }
      });
      continue;
    }
    if (body.length === 0) {
      errors.push({ message: "empty <assay-decision> body", span: { start, end } });
      continue;
    }
    const dedupeKey = `${kindRaw}:${body}`;
    if (seen.has(dedupeKey))
      continue;
    seen.add(dedupeKey);
    let confidence;
    if (attrs.confidence !== void 0) {
      const n = Number(attrs.confidence);
      if (Number.isFinite(n) && n >= 0 && n <= 1)
        confidence = n;
      else
        errors.push({
          message: `invalid confidence="${attrs.confidence}" (expected 0..1)`,
          span: { start, end }
        });
    }
    decisions.push({
      kind: kindRaw,
      body,
      supersedes_raw: attrs.supersedes,
      confidence,
      layer: attrs.layer,
      source_span: { start, end }
    });
  }
  return { decisions, errors };
}

// dist/decisions/store.js
var import_better_sqlite3 = __toESM(require("better-sqlite3"), 1);
var import_node_os = require("node:os");
var import_node_path = require("node:path");
var import_node_fs = require("node:fs");
var import_node_crypto = require("node:crypto");

// dist/decisions/schema.js
var SCHEMA_VERSION = 1;
var SCHEMA = `
CREATE TABLE IF NOT EXISTS decisions (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('decision', 'conflict')),
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'tentative'
    CHECK (status IN ('candidate', 'tentative', 'confirmed', 'superseded', 'rejected')),
  confidence REAL,
  layer TEXT,
  supersedes_raw TEXT,
  supersedes_resolved_id TEXT,
  supersedes_unresolved_reason TEXT
    CHECK (supersedes_unresolved_reason IS NULL
       OR supersedes_unresolved_reason IN ('none-specified', 'prefix-not-found',
                                            'prefix-ambiguous', 'malformed')),
  source_session_id TEXT,
  source_transcript_path TEXT,
  source_span_start INTEGER,
  source_span_end INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  embedding_model TEXT,
  embedded_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_decisions_kind ON decisions(kind);
CREATE INDEX IF NOT EXISTS idx_decisions_status ON decisions(status);
CREATE INDEX IF NOT EXISTS idx_decisions_supersedes ON decisions(supersedes_resolved_id)
  WHERE supersedes_resolved_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_decisions_created ON decisions(created_at DESC);

-- Append-only audit trail: every state transition logged
CREATE TABLE IF NOT EXISTS decision_transitions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  decision_id TEXT NOT NULL REFERENCES decisions(id),
  from_status TEXT,
  to_status TEXT NOT NULL,
  reason TEXT,
  transitioned_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_transitions_decision
  ON decision_transitions(decision_id, transitioned_at);

-- Evidence rows linking decisions to claude-mem observations (or other sources)
CREATE TABLE IF NOT EXISTS decision_evidence (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  decision_id TEXT NOT NULL REFERENCES decisions(id),
  source_type TEXT NOT NULL CHECK (source_type IN ('claude-mem', 'transcript', 'manual')),
  source_id TEXT NOT NULL,
  snippet TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_evidence_decision ON decision_evidence(decision_id);

-- Append-only enforcement at the storage layer: decision_transitions and
-- decision_evidence rows are immutable. Honors C10 contract beyond the API
-- boundary \u2014 direct SQL UPDATE/DELETE is blocked even by tooling.
CREATE TRIGGER IF NOT EXISTS decision_transitions_no_update
  BEFORE UPDATE ON decision_transitions
  BEGIN
    SELECT RAISE(FAIL, 'decision_transitions is append-only; UPDATE not permitted');
  END;

CREATE TRIGGER IF NOT EXISTS decision_transitions_no_delete
  BEFORE DELETE ON decision_transitions
  BEGIN
    SELECT RAISE(FAIL, 'decision_transitions is append-only; DELETE not permitted');
  END;

CREATE TRIGGER IF NOT EXISTS decision_evidence_no_update
  BEFORE UPDATE ON decision_evidence
  BEGIN
    SELECT RAISE(FAIL, 'decision_evidence is append-only; UPDATE not permitted');
  END;

CREATE TRIGGER IF NOT EXISTS decision_evidence_no_delete
  BEFORE DELETE ON decision_evidence
  BEGIN
    SELECT RAISE(FAIL, 'decision_evidence is append-only; DELETE not permitted');
  END;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL
);

INSERT OR IGNORE INTO schema_migrations (version, applied_at)
  VALUES (${SCHEMA_VERSION}, unixepoch() * 1000);
`;

// dist/decisions/store.js
var MAX_SUPERSESSION_HOPS = 10;
function defaultDbPath() {
  const override = process.env.ASSAY_DB_PATH;
  if (override) {
    (0, import_node_fs.mkdirSync)((0, import_node_path.dirname)(override), { recursive: true });
    return override;
  }
  const dir = (0, import_node_path.join)((0, import_node_os.homedir)(), ".assay");
  (0, import_node_fs.mkdirSync)(dir, { recursive: true });
  return (0, import_node_path.join)(dir, "decisions.db");
}
var DecisionStore = class {
  db;
  constructor(dbPath = defaultDbPath()) {
    this.db = new import_better_sqlite3.default(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.exec(SCHEMA);
  }
  close() {
    this.db.close();
  }
  /**
   * Deposit a batch of parsed decisions inside a single transaction.
   * Atomicity per Day 8-10 spec: all-or-nothing on the candidate set.
   * Returns ids of newly inserted decisions.
   */
  depositBatch(decisions, ctx = {}) {
    if (decisions.length === 0)
      return [];
    const ids = [];
    const insert = this.db.prepare(`
      INSERT INTO decisions (
        id, kind, body, status, confidence, layer,
        supersedes_raw, source_session_id, source_transcript_path,
        source_span_start, source_span_end, created_at, updated_at
      ) VALUES (
        @id, @kind, @body, 'tentative', @confidence, @layer,
        @supersedes_raw, @session_id, @transcript_path,
        @span_start, @span_end, @now, @now
      )
    `);
    const transition = this.db.prepare(`
      INSERT INTO decision_transitions (decision_id, from_status, to_status, reason, transitioned_at)
      VALUES (?, NULL, 'tentative', 'initial deposit', ?)
    `);
    const txn = this.db.transaction(() => {
      const now = Date.now();
      for (const d of decisions) {
        const id = (0, import_node_crypto.randomUUID)();
        insert.run({
          id,
          kind: d.kind,
          body: d.body,
          confidence: d.confidence ?? null,
          layer: d.layer ?? null,
          supersedes_raw: d.supersedes_raw ?? null,
          session_id: ctx.session_id ?? null,
          transcript_path: ctx.transcript_path ?? null,
          span_start: d.source_span.start,
          span_end: d.source_span.end,
          now
        });
        transition.run(id, now);
        ids.push(id);
      }
    });
    txn();
    return ids;
  }
  /**
   * Look up a decision by id.
   */
  get(id) {
    const row = this.db.prepare("SELECT * FROM decisions WHERE id = ?").get(id);
    return row ?? null;
  }
  /**
   * Total count of decisions (used for cold-start envelope detection).
   */
  count() {
    const row = this.db.prepare("SELECT COUNT(*) as n FROM decisions").get();
    return row?.n ?? 0;
  }
  /**
   * Recent decisions ordered by created_at desc, capped at limit.
   * Used by the SessionStart context payload writer.
   */
  recent(limit = 10) {
    return this.db.prepare("SELECT * FROM decisions ORDER BY created_at DESC LIMIT ?").all(limit);
  }
  /**
   * Walk the supersession chain forward from a decision id.
   * Returns the chain in deposit order, oldest first. Cycle-guarded.
   * Empty array if id not found.
   */
  supersessionChain(id) {
    const visited = /* @__PURE__ */ new Set();
    const chain = [];
    let current = this.get(id);
    while (current && !visited.has(current.id) && chain.length < MAX_SUPERSESSION_HOPS) {
      visited.add(current.id);
      chain.push(current);
      if (!current.supersedes_resolved_id)
        break;
      current = this.get(current.supersedes_resolved_id);
    }
    return chain.reverse();
  }
};

// dist/hooks/stopDrain.js
function profile() {
  const p = process.env.ECC_HOOK_PROFILE;
  if (p === "minimal" || p === "strict")
    return p;
  return "standard";
}
function isDisabled() {
  const disabled = process.env.ECC_DISABLED_HOOKS ?? "";
  return disabled.split(",").map((s) => s.trim()).includes("stop:zz-assay-decision-drain");
}
async function appendJsonl(path, record) {
  await (0, import_promises.mkdir)((0, import_node_path2.dirname)(path), { recursive: true });
  await (0, import_promises.appendFile)(path, JSON.stringify(record) + "\n", "utf8");
}
function logPath(name) {
  return (0, import_node_path2.join)((0, import_node_os2.homedir)(), ".assay", name);
}
async function runStopDrain(input) {
  const prof = profile();
  if (isDisabled()) {
    return { ok: true, profile: prof, reason: "disabled via ECC_DISABLED_HOOKS" };
  }
  if (prof === "minimal") {
    return { ok: true, profile: prof, reason: "minimal profile: hook noop" };
  }
  if (input.stopHookActive === true) {
    return { ok: true, profile: prof, reason: "stop hook re-entry guard" };
  }
  const transcriptPath = input.transcript_path ?? input.transcriptPath;
  if (!transcriptPath) {
    await appendJsonl(logPath("analytics/tool-usage.jsonl"), {
      ts: Date.now(),
      tool: "stop-drain",
      outcome: "parse-failed",
      reason: "missing transcriptPath"
    });
    return { ok: false, profile: prof, reason: "missing transcriptPath" };
  }
  let transcript;
  try {
    transcript = await (0, import_promises.readFile)(transcriptPath, "utf8");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await appendJsonl(logPath("analytics/tool-usage.jsonl"), {
      ts: Date.now(),
      tool: "stop-drain",
      outcome: "parse-failed",
      reason: `read failed: ${msg}`
    });
    return { ok: false, profile: prof, reason: `read failed: ${msg}` };
  }
  const { decisions, errors } = parseDecisionTags(transcript);
  for (const e of errors) {
    await appendJsonl(logPath("analytics/tool-usage.jsonl"), {
      ts: Date.now(),
      tool: "stop-drain",
      outcome: "parse-failed",
      reason: e.message,
      span: e.span
    });
  }
  if (decisions.length === 0) {
    await appendJsonl(logPath("analytics/tool-usage.jsonl"), {
      ts: Date.now(),
      tool: "stop-drain",
      outcome: "no-decisions",
      profile: prof
    });
    return { ok: true, profile: prof, decisions_captured: 0, parse_errors: errors.length };
  }
  let store = null;
  try {
    store = new DecisionStore();
    let depositedIds = [];
    let lastErr = null;
    const BACKOFFS_MS = [100, 200, 400, 800, 1600, 2e3];
    for (let attempt = 0; attempt < BACKOFFS_MS.length; attempt++) {
      try {
        depositedIds = store.depositBatch(decisions, {
          session_id: input.session_id,
          transcript_path: transcriptPath
        });
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
        const msg = err instanceof Error ? err.message : String(err);
        if (/SQLITE_BUSY|database is locked/i.test(msg)) {
          if (attempt === BACKOFFS_MS.length - 1)
            break;
          await new Promise((r) => setTimeout(r, BACKOFFS_MS[attempt]));
          continue;
        }
        throw err;
      }
    }
    if (lastErr)
      throw lastErr;
    await appendJsonl(logPath("analytics/tool-usage.jsonl"), {
      ts: Date.now(),
      tool: "stop-drain",
      outcome: "ok",
      profile: prof,
      decisions_captured: depositedIds.length,
      parse_errors: errors.length
    });
    if (prof === "strict") {
      const conflicts = decisions.filter((d) => d.kind === "conflict");
      if (conflicts.length > 0) {
        process.stderr.write(`[assay] strict mode: ${conflicts.length} conflict(s) captured this session
`);
      }
    }
    return {
      ok: true,
      profile: prof,
      decisions_captured: depositedIds.length,
      parse_errors: errors.length
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await appendJsonl(logPath("errors.jsonl"), {
      ts: Date.now(),
      source: "stop-drain",
      reason: msg,
      transcript_path: transcriptPath
    });
    process.stderr.write(`[assay] hook degraded: ${msg}
`);
    return { ok: false, profile: prof, reason: msg };
  } finally {
    store?.close();
  }
}

// plugin-src/stop-hook-entry.mjs
async function readStdin() {
  return new Promise((resolveP) => {
    let buf = "";
    if (process.stdin.isTTY) return resolveP("{}");
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      buf += chunk;
    });
    process.stdin.on("end", () => resolveP(buf || "{}"));
    setTimeout(() => resolveP(buf || "{}"), 5e3);
  });
}
async function main() {
  let input = {};
  try {
    const raw = await readStdin();
    input = JSON.parse(raw);
  } catch {
  }
  try {
    const result = await runStopDrain(input);
    process.stdout.write(JSON.stringify({ continue: true, suppressOutput: true, assay: result }) + "\n");
    process.exit(0);
  } catch (err) {
    process.stderr.write(`[assay] hook crashed: ${err.message}
`);
    process.stdout.write('{"continue":true,"suppressOutput":true}\n');
    process.exit(1);
  }
}
main();
