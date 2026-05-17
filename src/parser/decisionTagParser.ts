// Parse <assay-decision> tags from raw agent transcript text.
// Independent of claude-mem — claude-mem strips memory tags before
// persistence, so AssayLabs must parse the original transcript directly.
//
// Tag shape (eng-decision, the v2 baseline):
//   <assay-decision kind="decision" supersedes="abc12345" confidence="0.8">
//     Decision text body.
//   </assay-decision>
//
// PM-shape tags (migration 035) are deferred until a PM asks.

export interface ParsedDecision {
  kind: "decision" | "conflict";
  body: string;
  supersedes_raw?: string;
  confidence?: number;
  layer?: string;
  source_span: { start: number; end: number };
}

export interface ParseResult {
  decisions: ParsedDecision[];
  errors: Array<{ message: string; span?: { start: number; end: number } }>;
}

const TAG_RE = /<assay-decision\b([^>]*)>([\s\S]*?)<\/assay-decision>/g;
const ATTR_RE = /(\w[\w-]*)\s*=\s*"([^"]*)"/g;

function parseAttrs(attrString: string): Record<string, string> {
  const out: Record<string, string> = {};
  let m: RegExpExecArray | null;
  ATTR_RE.lastIndex = 0;
  while ((m = ATTR_RE.exec(attrString))) {
    out[m[1]!] = m[2]!;
  }
  return out;
}

export function parseDecisionTags(transcript: string): ParseResult {
  const decisions: ParsedDecision[] = [];
  const errors: ParseResult["errors"] = [];
  const seen = new Set<string>(); // idempotency: dedupe by body+kind hash

  let match: RegExpExecArray | null;
  TAG_RE.lastIndex = 0;
  while ((match = TAG_RE.exec(transcript))) {
    const start = match.index;
    const end = match.index + match[0].length;
    const attrs = parseAttrs(match[1] ?? "");
    const body = (match[2] ?? "").trim();

    const kindRaw = attrs.kind ?? "decision";
    if (kindRaw !== "decision" && kindRaw !== "conflict") {
      errors.push({
        message: `unknown kind="${kindRaw}" (expected "decision" or "conflict")`,
        span: { start, end },
      });
      continue;
    }

    if (body.length === 0) {
      errors.push({ message: "empty <assay-decision> body", span: { start, end } });
      continue;
    }

    const dedupeKey = `${kindRaw}:${body}`;
    if (seen.has(dedupeKey)) continue; // idempotency per F4 smoke
    seen.add(dedupeKey);

    let confidence: number | undefined;
    if (attrs.confidence !== undefined) {
      const n = Number(attrs.confidence);
      if (Number.isFinite(n) && n >= 0 && n <= 1) confidence = n;
      else errors.push({
        message: `invalid confidence="${attrs.confidence}" (expected 0..1)`,
        span: { start, end },
      });
    }

    decisions.push({
      kind: kindRaw,
      body,
      supersedes_raw: attrs.supersedes,
      confidence,
      layer: attrs.layer,
      source_span: { start, end },
    });
  }

  return { decisions, errors };
}
