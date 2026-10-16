/**
 * Builds the operator console as ONE self-contained HTML file running in demo
 * mode: all pages, styles, demo data and the fake backend are inlined. It can
 * be opened straight from disk, iCloud Drive or a phone's Files app, with no
 * server and no network.
 *
 * The same page is also written to docs/ with an icon, manifest and offline
 * cache, so GitHub Pages can serve it as an installable web app
 * ("Add to Home Screen" in Safari).
 *
 *   pnpm build:standalone   →   standalone/vantalos-demo.html
 *                               docs/ (GitHub Pages site)
 */
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const outDir = join(root, "standalone");
const outFile = join(outDir, "vantalos-demo.html");
const siteDir = join(root, "docs");
const iconsDir = join(root, "scripts/standalone/icons");
mkdirSync(outDir, { recursive: true });
mkdirSync(siteDir, { recursive: true });

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
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="apple-mobile-web-app-title" content="Vantalos">
<meta name="theme-color" content="#ffffff">
<link rel="apple-touch-icon" href="apple-touch-icon.png">
<link rel="icon" type="image/png" href="icon-192.png">
<link rel="manifest" href="manifest.webmanifest">
<title>Vantalos Demo</title>
<style>${css}</style>
</head>
<body>
<div id="root"></div>
<script>${js}</script>
<script>
  // Offline support when served over https (GitHub Pages); skipped for file://
  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("sw.js").catch(function () {});
  }
</script>
</body>
</html>
`;
writeFileSync(outFile, html);

// GitHub Pages site
const version = Date.now().toString(36);
writeFileSync(join(siteDir, "index.html"), html);
writeFileSync(join(siteDir, ".nojekyll"), "");
for (const icon of ["apple-touch-icon.png", "icon-192.png", "icon-512.png"]) {
  copyFileSync(join(iconsDir, icon), join(siteDir, icon));
}
writeFileSync(
  join(siteDir, "manifest.webmanifest"),
  JSON.stringify(
    {
      name: "Vantalos Demo",
      short_name: "Vantalos",
      start_url: "./#/operator/inbox",
      scope: "./",
      display: "standalone",
      background_color: "#ffffff",
      theme_color: "#ffffff",
      icons: [
        { src: "icon-192.png", sizes: "192x192", type: "image/png" },
        { src: "icon-512.png", sizes: "512x512", type: "image/png" },
      ],
    },
    null,
    2
  )
);
// Cache-first so the installed app opens without signal; a new build changes
// the cache name, which replaces the old copy on next launch.
writeFileSync(
  join(siteDir, "sw.js"),
  `const CACHE = "vantalos-demo-${version}";
const FILES = ["./", "./index.html", "./manifest.webmanifest", "./apple-touch-icon.png", "./icon-192.png", "./icon-512.png"];
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request)));
});
`
);
execFileSync("rm", ["-f", cssFile]);
console.log(`✓ ${outFile} (${(html.length / 1024).toFixed(0)} KB)`);
console.log(`✓ ${siteDir}/ (GitHub Pages site)`);
