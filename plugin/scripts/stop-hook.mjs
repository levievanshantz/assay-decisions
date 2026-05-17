#!/usr/bin/env node
// AssayLabs Stop hook entry. Reads the Stop hook input JSON from stdin,
// invokes runStopDrain(), writes a single-line JSON result to stdout for
// Claude Code's hook contract. Exits 0 on success, 1 on tier-3 failure.

import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const distRoot = resolve(__dirname, "..", "..", "dist");

async function loadStopDrain() {
  // Try installed location first, fall back to dev location.
  try {
    return await import(resolve(distRoot, "hooks/stopDrain.js"));
  } catch (err) {
    // Last-resort dev fallback for when running from repo without build.
    try {
      return await import(resolve(distRoot, "..", "src/hooks/stopDrain.ts"));
    } catch {
      throw err;
    }
  }
}

async function readStdin() {
  return new Promise((resolveP) => {
    let buf = "";
    if (process.stdin.isTTY) return resolveP("{}");
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { buf += chunk; });
    process.stdin.on("end", () => resolveP(buf || "{}"));
    setTimeout(() => resolveP(buf || "{}"), 5_000);
  });
}

async function main() {
  let input = {};
  try {
    const raw = await readStdin();
    input = JSON.parse(raw);
  } catch {
    // Hook input parse failure is non-fatal; we'll just have empty input.
  }

  let mod;
  try {
    mod = await loadStopDrain();
  } catch (err) {
    process.stderr.write(`[assaylabs] hook bootstrap failed: ${err.message}\n`);
    process.stdout.write('{"continue":true,"suppressOutput":true}\n');
    process.exit(0); // never block Claude Code's flow on our bootstrap failure
  }

  try {
    const result = await mod.runStopDrain(input);
    process.stdout.write(JSON.stringify({ continue: true, suppressOutput: true, assaylabs: result }) + "\n");
    process.exit(0);
  } catch (err) {
    process.stderr.write(`[assaylabs] hook crashed: ${err.message}\n`);
    process.stdout.write('{"continue":true,"suppressOutput":true}\n');
    process.exit(1);
  }
}

main();
