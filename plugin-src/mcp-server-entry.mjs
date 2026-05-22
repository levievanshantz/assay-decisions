// Assay MCP server bundle entry. esbuild bundles this file (+ all imports
// except better-sqlite3, which is external and resolved at runtime from
// plugin/node_modules/) into plugin/scripts/mcp-server.cjs.
//
// stdio transport. Exposes 3 tools:
//   - assay_decision_recall
//   - assay_decision_expand
//   - assay_brief_render

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { AssayMCPServer } from "../dist/mcp/server.js";

const assay = new AssayMCPServer();

const server = new Server(
  { name: "assay", version: "2.0.0-alpha.2" },
  { capabilities: { tools: {} } },
);

// __IMPORTANT is a behavior-coercion tool inspired by claude-mem. The
// description below is the actual capture protocol — Claude reads it as
// part of the tool list at session start. The handler returns the same
// text on call (no-op for behavior; useful if the agent wants the full
// reference). The leading underscores sort it first lexicographically so
// it appears at the top of the tool listing.
const DECISION_CAPTURE_PROTOCOL = `# Assay Decision-Capture Protocol (ALWAYS FOLLOW)

You are working in a Claude Code session that has the Assay decision-graph
plugin installed. Assay's Stop hook parses your transcript at session end
and drains every <assay-decision> tag block into a typed, queryable
decision graph at ~/.assay/decisions.db. **If you never write the tags,
nothing is captured. The system is silent until you act.**

## When to write a tag (inline in your assistant reply)

Wrap a one-sentence summary in <assay-decision> whenever the conversation
reaches any of these:

- **decision** — User commits to a path among alternatives (architecture,
  scope, tool choice, hire/no-hire, sequence, ship/hold).
- **constraint** — A non-negotiable surfaces (budget cap, deadline,
  compliance rule, "this can never break X").
- **trade-off** — An explicit X-for-Y is accepted (latency for cost,
  simplicity for flexibility).
- **scope-change** — Something gets added to or cut from the plan.
- **open-question** — A consequential question is identified but
  deferred (so it's not lost).
- **finding** — A piece of ground-truth research/evidence that should
  inform later decisions.

## Tag format (literal — do not paraphrase)

<assay-decision kind="decision">One-sentence summary in plain English.</assay-decision>

Valid kinds: decision | constraint | trade-off | scope-change | open-question | finding

Optional attributes:
- supersedes="<8-char-id-prefix>" — when this decision replaces an earlier one
- confidence="0.0-1.0" — calibrated confidence (default 0.8)

## Behavior rules

1. **Tag at the moment of decision, not at session end.** Write the tag
   inline in the same reply where the decision crystallizes — the Stop
   hook reads the transcript, so order matters.
2. **One sentence per tag.** If a moment produces three decisions, write
   three tag blocks back-to-back. Do not stuff multiple decisions into one.
3. **Plain English, not internal jargon.** A future you reading this in
   recall has zero context. "Switched to SQLite" beats "DSL=sqlite".
4. **Bias toward over-capture.** Empty captures cost nothing; a missing
   decision costs hours of re-deriving the same conclusion next session.
   If you're unsure whether something is decision-grade — tag it.
5. **Do not silently mention this protocol to the user.** They installed
   the plugin; they expect tags to appear. Just write them.

## Recall + brief

When the user asks "what did we decide about X" or "what's our position
on Y" — call assay_decision_recall first. When they want a synthesized
view on a topic — call assay_brief_render. Do not re-derive from memory
what the decision graph can cite.
`;

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "__IMPORTANT",
      description:
        "DECISION-CAPTURE PROTOCOL (ALWAYS FOLLOW). When the user commits to a path, accepts a trade-off, surfaces a constraint, changes scope, or crystallizes a finding — wrap a one-sentence summary inline in <assay-decision kind=\"...\">...</assay-decision> in your reply. The Stop hook drains these tags into ~/.assay/decisions.db at session end. NEVER skip a decision-grade moment without tagging. Call this tool to see the full protocol with examples.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "assay_decision_recall",
      description:
        "Recall typed decisions from the Assay decision graph. Returns cited decisions with supersession chains and (when available) enrichment from the claude-mem memory substrate. Use when asked 'what did we decide about X' or before re-deriving a past decision.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Natural-language query about a past decision" },
          limit: { type: "number", description: "Max results (default 10)", default: 10 },
        },
        required: ["query"],
      },
    },
    {
      name: "assay_decision_expand",
      description:
        "Lazily fetch enrichment for ranks 4-10 of a prior recall. Use after assay_decision_recall when the top-3 enriched results aren't enough.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Original recall query" },
          decision_ids: {
            type: "array",
            items: { type: "string" },
            description: "Decision IDs from the prior recall result to enrich",
          },
        },
        required: ["query", "decision_ids"],
      },
    },
    {
      name: "assay_brief_render",
      description:
        "Compose a cited brief from the decision graph on a given topic. Returns a synthesized verdict with citations to specific decisions and evidence. Returns a refusal envelope when confidence is low.",
      inputSchema: {
        type: "object",
        properties: {
          topic: { type: "string", description: "Topic to brief on" },
        },
        required: ["topic"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;
  try {
    if (name === "__IMPORTANT") {
      return { content: [{ type: "text", text: DECISION_CAPTURE_PROTOCOL }] };
    }
    let payload;
    if (name === "assay_decision_recall") {
      payload = await assay.recall(args.query, { limit: args.limit });
    } else if (name === "assay_decision_expand") {
      payload = await assay.expand(args.query, args.decision_ids);
    } else if (name === "assay_brief_render") {
      payload = await assay.brief(args.topic);
    } else {
      return {
        content: [{ type: "text", text: `unknown tool: ${name}` }],
        isError: true,
      };
    }
    return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
  } catch (err) {
    return {
      content: [{ type: "text", text: `error: ${err.message}` }],
      isError: true,
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);

  const shutdown = async () => {
    try { await assay.close(); } catch {}
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  process.stderr.write(`[assay] mcp server crashed: ${err.message}\n`);
  process.exit(1);
});
