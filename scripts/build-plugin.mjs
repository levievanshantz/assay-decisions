#!/usr/bin/env node
// Build self-contained plugin bundles + vendor the better-sqlite3 native
// dep so the plugin works after `claude plugin install` with no other setup.
//
//   plugin/scripts/mcp-server.cjs   ← esbuild bundle of plugin-src/mcp-server-entry.mjs
//   plugin/scripts/stop-hook.cjs    ← esbuild bundle of plugin-src/stop-hook-entry.mjs
//   plugin/node_modules/better-sqlite3/  ← vendored native module
//   plugin/node_modules/bindings/        ← peer of better-sqlite3
//   plugin/node_modules/file-uri-to-path/ ← peer of bindings

import { build } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const pluginDir = resolve(root, "plugin");
const scriptsDir = resolve(pluginDir, "scripts");
const pluginNodeModules = resolve(pluginDir, "node_modules");

const EXTERNALS = ["better-sqlite3", "bindings", "file-uri-to-path"];

async function bundle(entry, outfile) {
  await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node20",
    external: EXTERNALS,
    minify: false,
    sourcemap: false,
    banner: { js: "#!/usr/bin/env node" },
    logLevel: "warning",
  });
  console.log(`  bundled → ${outfile}`);
}

// Drop SQLite C source and other build-from-source artifacts that only
// matter when better-sqlite3 needs to be compiled (we ship the prebuilt
// .node binary, so they're dead weight). Keeps the vendored size to ~3MB
// instead of ~12MB.
const PRUNE_PATHS = ["deps", "src", "binding.gyp", "README.md"];

async function vendor(dep) {
  const src = resolve(root, "node_modules", dep);
  const dst = resolve(pluginNodeModules, dep);
  if (!existsSync(src)) {
    throw new Error(`missing node_modules/${dep} — run \`npm install\` first`);
  }
  await rm(dst, { recursive: true, force: true });
  await cp(src, dst, { recursive: true, dereference: true });
  for (const p of PRUNE_PATHS) {
    await rm(resolve(dst, p), { recursive: true, force: true });
  }
  console.log(`  vendored → plugin/node_modules/${dep}`);
}

async function main() {
  console.log("Building plugin bundles…");
  await mkdir(scriptsDir, { recursive: true });
  await bundle(
    resolve(root, "plugin-src/mcp-server-entry.mjs"),
    resolve(scriptsDir, "mcp-server.cjs"),
  );
  await bundle(
    resolve(root, "plugin-src/stop-hook-entry.mjs"),
    resolve(scriptsDir, "stop-hook.cjs"),
  );

  console.log("Vendoring native deps…");
  await mkdir(pluginNodeModules, { recursive: true });
  for (const dep of EXTERNALS) {
    await vendor(dep);
  }

  console.log("Plugin build complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
