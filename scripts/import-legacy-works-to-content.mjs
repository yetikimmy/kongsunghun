#!/usr/bin/env node
/*
 * Turn the auto-extracted legacy work data into Astro content-collection
 * entries (one JSON file per work under src/content/works/).
 *
 * Pipeline position:
 *   image/*.htm  --(extract-legacy-works.mjs)-->  data/legacy-works.generated.json
 *                --(THIS script)-->               src/content/works/<slug>.json  (+ images)
 *
 * Design decisions
 * ----------------
 * 1. Curated entries win. A small set of hand-written entries already live in
 *    src/content/works/ with richer slugs, descriptions and trimmed metadata.
 *    Each declares the `legacyFile` it came from. We index curated entries by
 *    that field and NEVER overwrite them — the generated record for the same
 *    legacy page is skipped, so manual curation is always preserved.
 *
 * 2. Slugs are the legacy filename stem (bw01, install01_1, paint09_03, ...).
 *    These are already unique across all ~180 works (the legacy site had one
 *    HTML file per work view), so they are stable and collision-free without
 *    needing to derive slugs from frequently-duplicated titles. Curated entries
 *    keep their nicer human slugs; this script only emits the remaining ones.
 *
 * 3. No broken images. Every referenced artwork image is copied from the root
 *    image/ folder into the committed public/assets/works/web/ directory and
 *    referenced as /assets/works/web/<file>. If a referenced file is missing on
 *    disk the image is dropped from the entry and a manualReview note is added,
 *    rather than emitting a dead <img src>.
 *
 * 4. Auditability. extractionWarnings from the extractor are carried through,
 *    and a `manualReview: true` flag plus human-readable `reviewNotes[]` are set
 *    ONLY when the entry has a genuinely unresolved gap — a caption with no
 *    medium or no year, a title that fell back to the slug, an ambiguous KO/EN
 *    title split, or a missing/unusable image. Benign warnings that the improved
 *    extractor now resolves (medium-before-year, etc.) do not trip review.
 *    Legacy thumbnail index pages (install.htm, painting.htm) are skipped
 *    entirely — they are navigation, not works. These flags are optional schema
 *    fields, invisible in the UI.
 *
 * Usage:  node scripts/import-legacy-works-to-content.mjs [--clean]
 *   --clean  remove previously generated (non-curated) entries first, so the
 *            content dir exactly mirrors the current generated data.
 *
 * Idempotent: re-running overwrites generated entries in place and leaves
 * curated entries untouched.
 */

import {
  readFileSync,
  writeFileSync,
  readdirSync,
  mkdirSync,
  copyFileSync,
  existsSync,
  unlinkSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, basename } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const IMAGE_DIR = join(ROOT, "image");
const GEN_JSON = join(ROOT, "data", "legacy-works.generated.json");
const CONTENT_DIR = join(ROOT, "src", "content", "works");
const WEB_IMAGE_DIR = join(ROOT, "public", "assets", "works", "web");

const VALID_SERIES = new Set([
  "blind-work",
  "installation-work",
  "multi-slide-projection",
  "paintings",
]);

function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/* The legacy-filename stem for a content entry (e.g. "bw02.htm" -> "bw02"). */
function legacyStem(legacyFile) {
  return (legacyFile || "").replace(/\.htm$/i, "").toLowerCase();
}

/*
 * Read existing content entries and split them into CURATED vs GENERATED.
 *
 * Hand-curated entries are recognised by a human-friendly slug that differs
 * from the legacy filename stem (e.g. slug "self-portrait" from paint02_01.htm).
 * Auto-generated entries use the stem itself as the slug (paint02_02, ...), so
 * `slug === stem` marks an entry this script owns and may freely regenerate.
 *
 * Returns { bySlug, byLegacyFile } over the curated entries only — so generated
 * entries are NOT treated as "preserve me" on re-runs and instead get rebuilt
 * from the latest extracted data.
 */
function readCuratedEntries() {
  const bySlug = new Map();
  const byLegacyFile = new Map();
  if (!existsSync(CONTENT_DIR)) return { bySlug, byLegacyFile };
  for (const f of readdirSync(CONTENT_DIR)) {
    if (!f.endsWith(".json")) continue;
    const full = join(CONTENT_DIR, f);
    let data;
    try {
      data = JSON.parse(readFileSync(full, "utf8"));
    } catch {
      continue;
    }
    // Only hand-curated entries (slug != legacy stem) are preserved.
    if (!data.slug || data.slug === legacyStem(data.legacyFile)) continue;
    const entry = { file: f, full, data };
    bySlug.set(data.slug, entry);
    if (data.legacyFile) byLegacyFile.set(data.legacyFile, entry);
  }
  return { bySlug, byLegacyFile };
}

/*
 * Build a readable alt string for an image when the extractor did not provide
 * one. Mirrors the style of the curated entries: "<titleKo> <titleEn> — <bits>".
 */
function buildAlt(rec) {
  const title = [rec.titleKo, rec.titleEn].filter((t, i, a) => t && a.indexOf(t) === i).join(" ");
  const bits = [rec.medium, rec.year].filter(Boolean).join(", ");
  return bits ? `${title} — ${bits}` : title || rec.slug;
}

/*
 * Legacy thumbnail INDEX pages (install.htm, painting.htm) carry a grid of
 * navigation thumbnails but no work caption. They are site chrome, not works,
 * and must not become content entries.
 */
const INDEX_LEGACY_FILES = new Set(["install.htm", "painting.htm", "multi.htm", "real.htm"]);

/*
 * Map the extractor's terse warning codes to specific, actionable review notes.
 * Only warnings that reflect genuinely *missing or ambiguous* source data are
 * carried into `reviewNotes` (and trip `manualReview`). Benign codes the
 * extractor no longer emits are intentionally absent.
 */
/*
 * An exhibition-institution word left inside a title. We only treat this as a
 * misplaced venue when the entry has NO medium (a present medium already holds
 * any trailing venue verbatim) and the title is not itself a view label
 * ("... installation view"), where the institution word is part of a legitimate
 * descriptive title rather than a venue to relocate.
 */
const VENUE_IN_TITLE_RE = /\b(Gallery|Museum|Art\s+Center|Arts\s+Center)\b/;
const TITLE_VIEW_LABEL_RE = /\b(installation\s*view|exhibition\s*view|detail|view)\b/i;

const REVIEW_NOTE_BY_WARNING = {
  "no-medium": "Legacy caption has no medium/material text — confirm against the original page.",
  "no-year": "Legacy caption has no 4-digit year — confirm the work's year.",
  "title-fallback-slug": "No caption title found; title fell back to the slug — supply a real title.",
  "title-split-ambiguous":
    "Korean and Latin text in the title could not be split cleanly — verify titleKo / titleEn.",
};

function main() {
  const clean = process.argv.includes("--clean");
  ensureDir(CONTENT_DIR);
  ensureDir(WEB_IMAGE_DIR);

  const records = JSON.parse(readFileSync(GEN_JSON, "utf8"));
  const { bySlug: curatedBySlug, byLegacyFile: curatedByLegacy } = readCuratedEntries();

  // Slugs already taken by curated entries — generated entries must not collide.
  const takenSlugs = new Set(curatedBySlug.keys());

  // Track which content files we (re)generate this run, for --clean.
  const generatedFiles = new Set();
  // Remember curated files so --clean never deletes them.
  const curatedFiles = new Set([...curatedBySlug.values()].map((e) => e.file));

  const copiedImages = new Set();
  const stats = {
    total: records.length,
    skippedCurated: 0,
    skippedIndex: 0,
    written: 0,
    bySeries: {},
    imagesCopied: 0,
    missingImages: 0,
    needsReview: 0,
  };

  for (const rec of records) {
    if (!VALID_SERIES.has(rec.series)) continue;

    // Preserve curated entries: if a hand-written entry already covers this
    // legacy page, leave it alone.
    if (curatedByLegacy.has(rec.legacyFile)) {
      stats.skippedCurated++;
      continue;
    }

    // Skip legacy thumbnail index pages — they are navigation, not works.
    if (INDEX_LEGACY_FILES.has(rec.legacyFile)) {
      stats.skippedIndex++;
      continue;
    }

    // Deterministic, stable slug from the legacy filename stem.
    let slug = rec.slug;
    if (takenSlugs.has(slug)) {
      // Extremely unlikely (legacy stems are unique), but disambiguate
      // deterministically against curated slugs just in case.
      let n = 2;
      while (takenSlugs.has(`${slug}-${n}`)) n++;
      slug = `${slug}-${n}`;
    }
    takenSlugs.add(slug);

    // Build specific, actionable review notes only for warnings that signal
    // genuinely missing/ambiguous source data.
    const reviewNotes = [];
    for (const w of rec.extractionWarnings || []) {
      const note = REVIEW_NOTE_BY_WARNING[w];
      if (note && !reviewNotes.includes(note)) reviewNotes.push(note);
    }

    // A venue name left inside the title (the extractor only strips the
    // unambiguous "Name Gallery, City" comma form) — flag for a curator to move
    // it into `location`. Skipped when a medium is present (it already holds any
    // trailing venue verbatim) or when the title is a view label, where the
    // institution word is part of a legitimate descriptive title.
    if (
      !rec.location &&
      !rec.medium &&
      !TITLE_VIEW_LABEL_RE.test(rec.titleEn || "") &&
      VENUE_IN_TITLE_RE.test(rec.titleEn || "")
    ) {
      reviewNotes.push(
        "Title may still contain an exhibition venue — move the venue into `location` and trim the title."
      );
    }

    // Resolve images against the committed web image dir, copying as needed.
    const images = [];
    for (const img of rec.images || []) {
      const fname = basename(img.src);
      const srcPath = join(IMAGE_DIR, fname);
      if (!existsSync(srcPath)) {
        reviewNotes.push(`Referenced image "${fname}" is missing from image/ — locate the file or drop the reference.`);
        stats.missingImages++;
        continue;
      }
      if (!copiedImages.has(fname)) {
        copyFileSync(srcPath, join(WEB_IMAGE_DIR, fname));
        copiedImages.add(fname);
      }
      images.push({
        src: `/assets/works/web/${fname}`,
        alt: buildAlt(rec),
        ...(img.width ? { width: img.width } : {}),
        ...(img.height ? { height: img.height } : {}),
      });
    }
    if (images.length === 0) {
      reviewNotes.push("No usable artwork image resolved for this entry — supply or fix the image reference.");
    }

    const needsReview = reviewNotes.length > 0;
    if (needsReview) stats.needsReview++;

    const entry = {
      slug,
      series: rec.series,
      titleKo: rec.titleKo || rec.titleEn || slug,
      titleEn: rec.titleEn || rec.titleKo || slug,
      year: rec.year ?? null,
      ...(rec.medium ? { medium: rec.medium } : {}),
      ...(rec.dimensions ? { dimensions: rec.dimensions } : {}),
      ...(rec.location ? { location: rec.location } : {}),
      ...(rec.descriptionKo ? { descriptionKo: rec.descriptionKo } : {}),
      ...(rec.descriptionEn ? { descriptionEn: rec.descriptionEn } : {}),
      images,
      ...(rec.caption ? { caption: rec.caption } : {}),
      order: rec.order ?? 0,
      legacyFile: rec.legacyFile,
      ...(rec.extractionWarnings && rec.extractionWarnings.length
        ? { extractionWarnings: rec.extractionWarnings }
        : {}),
      ...(needsReview ? { manualReview: true, reviewNotes } : {}),
    };

    const outFile = `${slug}.json`;
    writeFileSync(join(CONTENT_DIR, outFile), JSON.stringify(entry, null, 2) + "\n", "utf8");
    generatedFiles.add(outFile);

    stats.written++;
    stats.bySeries[rec.series] = (stats.bySeries[rec.series] || 0) + 1;
    stats.imagesCopied = copiedImages.size;
  }

  if (clean) {
    for (const f of readdirSync(CONTENT_DIR)) {
      if (!f.endsWith(".json")) continue;
      if (curatedFiles.has(f) || generatedFiles.has(f)) continue;
      unlinkSync(join(CONTENT_DIR, f));
    }
  }

  // Count curated entries per series for the final report.
  const curatedBySeries = {};
  for (const e of curatedBySlug.values()) {
    curatedBySeries[e.data.series] = (curatedBySeries[e.data.series] || 0) + 1;
  }

  console.log("=== import legacy works -> content ===");
  console.log(`generated records read : ${stats.total}`);
  console.log(`curated (preserved)    : ${stats.skippedCurated}`);
  console.log(`index pages skipped    : ${stats.skippedIndex}`);
  console.log(`written (generated)    : ${stats.written}`);
  console.log(`images copied to web/  : ${stats.imagesCopied}`);
  console.log(`missing images dropped : ${stats.missingImages}`);
  console.log(`entries needing review : ${stats.needsReview}`);
  console.log("written by series:");
  for (const [s, n] of Object.entries(stats.bySeries)) console.log(`  ${s.padEnd(24)} ${n}`);
  console.log("curated by series:");
  for (const [s, n] of Object.entries(curatedBySeries)) console.log(`  ${s.padEnd(24)} ${n}`);
  const totalBySeries = {};
  for (const [s, n] of Object.entries(stats.bySeries)) totalBySeries[s] = n;
  for (const [s, n] of Object.entries(curatedBySeries)) totalBySeries[s] = (totalBySeries[s] || 0) + n;
  console.log("TOTAL registered by series:");
  for (const [s, n] of Object.entries(totalBySeries)) console.log(`  ${s.padEnd(24)} ${n}`);
  console.log(`TOTAL registered       : ${stats.written + stats.skippedCurated}`);
}

main();
