// Decision store: thin wrapper over SQLite for ~/.assay/decisions.db.
// Transactional deposit + cycle-guarded supersession walk carry forward
// from current Assay's tested patterns.

import Database from "better-sqlite3";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";

import { SCHEMA } from "./schema.js";
import type { ParsedDecision } from "../parser/decisionTagParser.js";

export interface StoredDecision {
  id: string;
  kind: "decision" | "conflict";
  body: string;
  status: string;
  confidence: number | null;
  layer: string | null;
  supersedes_raw: string | null;
  supersedes_resolved_id: string | null;
  supersedes_unresolved_reason: string | null;
  created_at: number;
  updated_at: number;
}

export interface DepositContext {
  session_id?: string;
  transcript_path?: string;
}

const MAX_SUPERSESSION_HOPS = 10;

function defaultDbPath(): string {
  // Honors ASSAY_DB_PATH override for tests, demos, and sandboxed runs.
  // Falls back to ~/.assay/decisions.db for production use.
  const override = process.env.ASSAY_DB_PATH;
  if (override) {
    mkdirSync(dirname(override), { recursive: true });
    return override;
  }
  const dir = join(homedir(), ".assay");
  mkdirSync(dir, { recursive: true });
  return join(dir, "decisions.db");
}

export class DecisionStore {
  private readonly db: Database.Database;

  constructor(dbPath: string = defaultDbPath()) {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.exec(SCHEMA);
  }

  close(): void {
    this.db.close();
  }

  /**
   * Deposit a batch of parsed decisions inside a single transaction.
   * Atomicity per Day 8-10 spec: all-or-nothing on the candidate set.
   * Returns ids of newly inserted decisions.
   */
  depositBatch(decisions: ParsedDecision[], ctx: DepositContext = {}): string[] {
    if (decisions.length === 0) return [];

    const ids: string[] = [];
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
        const id = randomUUID();
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
          now,
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
  get(id: string): StoredDecision | null {
    const row = this.db.prepare("SELECT * FROM decisions WHERE id = ?").get(id) as
      | StoredDecision
      | undefined;
    return row ?? null;
  }

  /**
   * Total count of decisions (used for cold-start envelope detection).
   */
  count(): number {
    const row = this.db.prepare("SELECT COUNT(*) as n FROM decisions").get() as
      | { n: number }
      | undefined;
    return row?.n ?? 0;
  }

  /**
   * Recent decisions ordered by created_at desc, capped at limit.
   * Used by the SessionStart context payload writer.
   */
  recent(limit = 10): StoredDecision[] {
    return this.db
      .prepare("SELECT * FROM decisions ORDER BY created_at DESC LIMIT ?")
      .all(limit) as StoredDecision[];
  }

  /**
   * Walk the supersession chain forward from a decision id.
   * Returns the chain in deposit order, oldest first. Cycle-guarded.
   * Empty array if id not found.
   */
  supersessionChain(id: string): StoredDecision[] {
    const visited = new Set<string>();
    const chain: StoredDecision[] = [];

    let current = this.get(id);
    while (current && !visited.has(current.id) && chain.length < MAX_SUPERSESSION_HOPS) {
      visited.add(current.id);
      chain.push(current);
      if (!current.supersedes_resolved_id) break;
      current = this.get(current.supersedes_resolved_id);
    }

    return chain.reverse(); // oldest first
  }
}
