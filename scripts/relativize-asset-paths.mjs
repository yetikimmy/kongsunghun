// Post-build: rewrite Astro's absolute asset URLs (/_astro/…, /assets/…) in the
// built HTML to depth-relative paths (./… or ../…). Astro emits absolute paths
// for the stylesheet/script links it injects, which 404 when the static site is
// served from a sub-path (or via file://). The page <a>/<img> links are already
// relative (see src/lib/href.ts); this brings the asset links in line so the
// whole site is portable regardless of the deploy root.
import { readFileSync, writeFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join, relative, dirname, sep } from "node:path";
import { fileURLToPath } from "node:url";

const distDir = fileURLToPath(new URL("../dist", import.meta.url));

// Absolute references to Astro's emitted asset roots, in HTML attributes.
const ASSET_ROOTS = ["/_astro/", "/assets/"];

async function* filesWithExt(dir, exts) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* filesWithExt(full, exts);
    else if (exts.some((e) => entry.name.endsWith(e))) yield full;
  }
}

function toRelativePrefix(htmlPath) {
  // Depth from the HTML file's directory back to dist root, as ./ or ../…/
  const fromDir = dirname(htmlPath);
  const rel = relative(fromDir, distDir);
  if (rel === "") return "./";
  return rel.split(sep).join("/") + "/";
}

let changedFiles = 0;
let changedRefs = 0;

// HTML: rewrite href="/_astro/…" / src="/assets/…" to a depth-relative prefix.
for await (const file of filesWithExt(distDir, [".html"])) {
  const prefix = toRelativePrefix(file);
  let html = readFileSync(file, "utf8");
  let touched = false;

  for (const root of ASSET_ROOTS) {
    // Match the root only when it directly follows an attribute opener
    // (href="/_astro/… or src='/assets/…) to avoid touching unrelated text.
    const re = new RegExp(`((?:href|src)\\s*=\\s*["'])${root.replace("/", "\\/")}`, "g");
    html = html.replace(re, (_m, attr) => {
      changedRefs += 1;
      touched = true;
      return `${attr}${prefix}${root.slice(1)}`;
    });
  }

  if (touched) {
    writeFileSync(file, html);
    changedFiles += 1;
  }
}

// CSS: font/asset url(/_astro/…) inside a /_astro/*.css file points at a sibling,
// so an absolute /_astro/ root only resolves when the site is at the domain root.
// Rewrite to "./" (same directory) so it works under any deploy root.
for await (const file of filesWithExt(distDir, [".css"])) {
  let css = readFileSync(file, "utf8");
  let touched = false;
  css = css.replace(/url\(\s*(['"]?)\/_astro\//g, (_m, q) => {
    changedRefs += 1;
    touched = true;
    return `url(${q}./`;
  });
  if (touched) {
    writeFileSync(file, css);
    changedFiles += 1;
  }
}

console.log(
  `relativize-asset-paths: rewrote ${changedRefs} reference(s) across ${changedFiles} file(s).`,
);
