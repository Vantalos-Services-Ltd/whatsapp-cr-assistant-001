/**
 * Builds the operator console as ONE self-contained HTML file running in demo
 * mode: all pages, styles, demo data and the fake backend are inlined. It can
 * be opened straight from disk, iCloud Drive or a phone's Files app, with no
 * server and no network.
 *
 *   pnpm build:standalone   →   standalone/vantalos-demo.html
 */
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const outDir = join(root, "standalone");
const outFile = join(outDir, "vantalos-demo.html");
mkdirSync(outDir, { recursive: true });

// 1. Styles: Tailwind over the same sources the Next.js app uses
const cssFile = join(outDir, ".styles.tmp.css");
execFileSync(
  join(root, "node_modules/.bin/tailwindcss"),
  ["-i", "app/globals.css", "-c", "tailwind.config.js", "-o", cssFile, "--minify"],
  { cwd: root, stdio: "inherit" }
);
const css = readFileSync(cssFile, "utf8");

// 2. Script: every page + fake backend, with Next's router swapped for a hash router
const result = await build({
  entryPoints: [join(root, "scripts/standalone/entry.tsx")],
  bundle: true,
  write: false,
  format: "iife",
  platform: "browser",
  target: ["es2020", "safari15"],
  minify: true,
  jsx: "automatic",
  tsconfig: join(root, "tsconfig.json"),
  alias: { "next/navigation": join(root, "scripts/standalone/navigation.tsx") },
  define: {
    "process.env.NODE_ENV": '"production"',
    "process.env.NEXT_PUBLIC_DEMO_MODE": '"true"',
    "process.env.NEXT_PUBLIC_API_URL": '""',
  },
  logOverride: { "unsupported-dynamic-import": "silent" },
  logLevel: "warning",
});
// Keep "</script>" inside the bundle from closing the inline tag
const js = result.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<title>Vantalos Demo</title>
<style>${css}</style>
</head>
<body>
<div id="root"></div>
<script>${js}</script>
</body>
</html>
`;
writeFileSync(outFile, html);
execFileSync("rm", ["-f", cssFile]);
console.log(`✓ ${outFile} (${(html.length / 1024).toFixed(0)} KB)`);
