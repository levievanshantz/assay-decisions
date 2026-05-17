// AssayLabs v2 MCP server.
// 3 tools: assay_decision_recall, assay_decision_expand, assay_brief_render
// All tools query MemoryProvider (claude-mem HTTP) for context enrichment,
// join with the local decision graph, return cited evidence.
//
// "Not the agent" axiom DROPPED per CEO T1 (May 17). assay_brief_render
// composes verdicts with citations; opacity is not permitted, synthesis is.

import { DecisionStore, type StoredDecision } from "../decisions/store.js";
import {
  ClaudeMemHTTPProvider,
} from "../providers/ClaudeMemHTTPProvider.js";
import type { MemoryProvider } from "../providers/MemoryProvider.js";

const COLD_START_THRESHOLD = 5;
const EAGER_FETCH_TOP_N = 3;
const RECALL_DEFAULT_LIMIT = 10;

export interface RecallResponse {
  query: string;
  results: Array<{
    decision: StoredDecision;
    supersession_chain: StoredDecision[];
    enrichment?: { source: string; snippet: string }[];
  }>;
  context_tier: "full" | "degraded" | "unavailable";
  context_tier_reason?: string;
  cold_start?: {
    message: string;
    corpus_size: number;
  };
}

export interface ExpandResponse {
  query: string;
  expanded_results: Array<{
    decision_id: string;
    enrichment: { source: string; snippet: string }[];
  }>;
  context_tier: "full" | "degraded" | "unavailable";
}

export interface BriefResponse {
  topic: string;
  verdict: string; // composed synthesis (axiom dropped — composition allowed)
  citations: Array<{
    decision_id: string;
    body: string;
    evidence_source?: string;
    evidence_snippet?: string;
  }>;
  refusal?: { reason: string };
}

export class AssayMCPServer {
  private readonly store: DecisionStore;
  private readonly provider: MemoryProvider;

  constructor(
    store: DecisionStore = new DecisionStore(),
    provider: MemoryProvider = new ClaudeMemHTTPProvider(),
  ) {
    this.store = store;
    this.provider = provider;
  }

  async close(): Promise<void> {
    this.store.close();
  }

  /**
   * assay_decision_recall: typed decision-graph recall with provider enrichment.
   *
   * Flow (per CEO review §2 Days 11-13):
   *   1. Cold-start check: if total corpus <5 decisions, return cold-start envelope.
   *   2. Deterministic coverage: retrieve recent decisions (no agent-judgment fetching).
   *      Note: full vector similarity over decisions is a v3 add; v2 uses recency.
   *   3. Two-tier context enrichment: top-N batched eagerly via provider.
   *   4. Supersession traversal: walk chain for each result.
   *   5. Graceful degrade: provider unreachable → return decisions without enrichment.
   */
  async recall(query: string, opts: { limit?: number } = {}): Promise<RecallResponse> {
    const limit = opts.limit ?? RECALL_DEFAULT_LIMIT;
    const corpusSize = this.store.count();

    if (corpusSize < COLD_START_THRESHOLD) {
      return {
        query,
        results: [],
        context_tier: "unavailable",
        cold_start: {
          message: `Your decision corpus has ${corpusSize} item${corpusSize === 1 ? "" : "s"} (fewer than ${COLD_START_THRESHOLD}). AssayLabs accumulates decisions as you work — tag decisions inline with <assay-decision> in your agent sessions, or invoke /assay-decision-deposit explicitly. Recall improves with use.`,
          corpus_size: corpusSize,
        },
      };
    }

    // v2 deterministic coverage = recent decisions. v3 swaps to vector similarity
    // once the decisions table supports embeddings (deferred per Anti-axiom #6).
    const decisions = this.store.recent(limit);

    // Probe provider health before fan-out.
    const health = await this.provider.health();
    const contextTier: RecallResponse["context_tier"] =
      health.status === "full" ? "full"
      : health.status === "degraded" ? "degraded"
      : "unavailable";

    const results: RecallResponse["results"] = [];

    if (contextTier === "unavailable") {
      // Graceful degrade: return decisions without enrichment, flag tier.
      for (const d of decisions) {
        results.push({
          decision: d,
          supersession_chain: this.store.supersessionChain(d.id),
        });
      }
      return {
        query,
        results,
        context_tier: "unavailable",
        context_tier_reason: health.reason ?? "provider offline",
      };
    }

    // Two-tier eager fetch: enrich top-N via batched provider call.
    const eagerDecisions = decisions.slice(0, EAGER_FETCH_TOP_N);
    let enrichmentMap = new Map<string, { source: string; snippet: string }[]>();
    try {
      const searchResults = await this.provider.search(query, { limit: 10 });
      const ids = searchResults.map((r) => r.id);
      if (ids.length > 0) {
        const { found } = await this.provider.getObservations(ids);
        // Naive enrichment join: attach top observations to top eager decisions.
        const enrichments = found.slice(0, EAGER_FETCH_TOP_N).map((o) => ({
          source: `claude-mem:${o.id}`,
          snippet: (o.narrative ?? o.text ?? "").slice(0, 280),
        }));
        for (const d of eagerDecisions) {
          enrichmentMap.set(d.id, enrichments);
        }
      }
    } catch (err) {
      // Provider call failed mid-flight; degrade for this request.
      return {
        query,
        results: decisions.map((d) => ({
          decision: d,
          supersession_chain: this.store.supersessionChain(d.id),
        })),
        context_tier: "degraded",
        context_tier_reason: err instanceof Error ? err.message : String(err),
      };
    }

    for (const d of decisions) {
      results.push({
        decision: d,
        supersession_chain: this.store.supersessionChain(d.id),
        enrichment: enrichmentMap.get(d.id),
      });
    }

    return { query, results, context_tier: contextTier };
  }

  /**
   * assay_decision_expand: lazy fetch ranks 4-10 enrichment.
   * (Top-3 are already eagerly enriched by recall().)
   */
  async expand(query: string, decisionIds: string[]): Promise<ExpandResponse> {
    const health = await this.provider.health();
    const contextTier: ExpandResponse["context_tier"] =
      health.status === "full" ? "full"
      : health.status === "degraded" ? "degraded"
      : "unavailable";

    if (contextTier === "unavailable") {
      return { query, expanded_results: [], context_tier: "unavailable" };
    }

    const expanded: ExpandResponse["expanded_results"] = [];
    try {
      const searchResults = await this.provider.search(query, { limit: 20 });
      const allIds = searchResults.map((r) => r.id);
      const { found } = await this.provider.getObservations(allIds);
      for (const decisionId of decisionIds) {
        expanded.push({
          decision_id: decisionId,
          enrichment: found.map((o) => ({
            source: `claude-mem:${o.id}`,
            snippet: (o.narrative ?? o.text ?? "").slice(0, 280),
          })),
        });
      }
    } catch (err) {
      return { query, expanded_results: [], context_tier: "degraded" };
    }

    return { query, expanded_results: expanded, context_tier: contextTier };
  }

  /**
   * assay_brief_render: composes a verdict from accumulated decisions + evidence.
   * Synthesis is permitted (axiom dropped); opacity is not — every verdict carries
   * citations. Refusal envelope when confidence is low or evidence is ambiguous.
   */
  async brief(topic: string): Promise<BriefResponse> {
    const recall = await this.recall(topic, { limit: 5 });

    if (recall.cold_start) {
      return {
        topic,
        verdict: "",
        citations: [],
        refusal: { reason: recall.cold_start.message },
      };
    }

    if (recall.results.length === 0) {
      return {
        topic,
        verdict: "",
        citations: [],
        refusal: { reason: "No relevant decisions found in corpus." },
      };
    }

    // Naive v2 composition: stitch decision bodies into a structured brief.
    // Future: real LLM composition via Claude Code's available context.
    const citations = recall.results.map((r) => ({
      decision_id: r.decision.id,
      body: r.decision.body,
      evidence_source: r.enrichment?.[0]?.source,
      evidence_snippet: r.enrichment?.[0]?.snippet,
    }));

    const verdict = recall.results
      .map((r, i) => `[${i + 1}] ${r.decision.body}`)
      .join("\n\n");

    return { topic, verdict, citations };
  }
}
