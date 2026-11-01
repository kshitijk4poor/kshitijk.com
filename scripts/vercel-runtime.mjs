// @astrojs/vercel 7.x (Astro 4) can only emit nodejs18.x/nodejs20.x function runtimes, and Vercel has
// discontinued both. Rewrite the generated function configs to the Node version the build runs on.
// Remove this once the site moves to Astro 5+ with a current @astrojs/vercel.
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = ".vercel/output/functions";
const runtime = `nodejs${process.versions.node.split(".")[0]}.x`;

function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) walk(p);
    else if (entry.name === ".vc-config.json") {
      const cfg = JSON.parse(readFileSync(p, "utf8"));
      if (cfg.runtime?.startsWith("nodejs") && cfg.runtime !== runtime) {
        console.log(`vercel-runtime: ${p} ${cfg.runtime} -> ${runtime}`);
        cfg.runtime = runtime;
        writeFileSync(p, JSON.stringify(cfg, null, "\t"));
      }
    }
  }
}

if (existsSync(root)) walk(root);
