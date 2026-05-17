#!/usr/bin/env node
// Assay MCP server entry. stdio transport. Exposes 3 tools:
//   - assay_decision_recall
//   - assay_decision_expand
//   - assay_brief_render

import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const distRoot = resolve(__dirname, "..", "..", "dist");

const { AssayMCPServer } = await import(resolve(distRoot, "mcp/server.js"));

const assay = new AssayMCPServer();

const server = new Server(
  { name: "assay", version: "2.0.0-alpha.2" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
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

const transport = new StdioServerTransport();
await server.connect(transport);

const shutdown = async () => {
  try { await assay.close(); } catch {}
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
