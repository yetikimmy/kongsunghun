#!/usr/bin/env node
/*
 * Extract structured work data from the legacy Dreamweaver HTML pages.
 *
 * The legacy pages (bw*.htm, install*.htm, paint*.htm, slide*.htm) are
 * EUC-KR encoded and follow a consistent Dreamweaver table layout:
 *   - a series-label GIF (image/blindwork.gif, image/install01.gif, ...)
 *   - one or more work JPGs (image/bwp01.jpg, image/in01_01.jpg, ...)
 *   - a single-line caption in <td class="rabbit ...">:
 *       titleKo  titleEn  year  medium  dimensions  location
 *     (fields separated by runs of 2+ spaces, order/format varies)
 *   - a description paragraph in <td class="gong01">: Korean then English,
 *     <br>-separated.
 *
 * This script is a best-effort heuristic extractor. Anything it cannot parse
 * confidently is recorded in `extractionWarnings` rather than silently dropped,
 * so the output stays auditable for manual review.
 *
 * Usage:  node scripts/extract-legacy-works.mjs
 * Output: data/legacy-works.generated.json  (+ console stats)
 *         public/assets/works/legacy/*.jpg   (referenced images, copied so the
 *                                             Astro build can serve them without
 *                                             touching the original image/ dir)
 */

import { readFileSync, writeFileSync, readdirSync, mkdirSync, copyFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, basename } from "node:path";
import iconv from "iconv-lite";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const IMAGE_DIR = join(ROOT, "image");
const OUT_JSON = join(ROOT, "data", "legacy-works.generated.json");
const LEGACY_PUBLIC_DIR = join(ROOT, "public", "assets", "works", "legacy");

/* Map the legacy filename prefix to a modern content-collection series. */
const SERIES_BY_PREFIX = {
  bw: "blind-work",
  install: "installation-work",
  slide: "multi-slide-projection",
  paint: "paintings",
};

/*
 * Images that are part of the UI chrome / navigation / series labels rather
 * than the artwork itself. We exclude all .gif (every artwork is a .jpg in the
 * legacy site) plus a few jpg false-positives if any appear.
 */
const NON_ARTWORK_IMAGE = /\.gif$/i;
const EXPLICIT_EXCLUDE = new Set([
  "line.gif",
  "back.gif",
  "next.gif",
  "next02.gif",
  "main.gif",
  "background.gif",
  "message.gif",
]);

const YEAR_RE = /\b(19\d{2}|20\d{2})\b/;
const DIM_RE = /\d+(?:\.\d+)?\s*[x×]\s*\d+(?:\.\d+)?(?:\s*[x×]\s*\d+(?:\.\d+)?)?\s*(?:cm|mm|page|p)?/i;

function listLegacyFiles() {
  return readdirSync(ROOT)
    .filter((f) => /^(bw|install|paint|slide).*\.htm$/i.test(f))
    .sort();
}

function seriesForFile(file) {
  for (const [prefix, series] of Object.entries(SERIES_BY_PREFIX)) {
    if (file.toLowerCase().startsWith(prefix)) return series;
  }
  return null;
}

function decode(file) {
  const buf = readFileSync(join(ROOT, file));
  return iconv.decode(buf, "euc-kr");
}

function stripTags(html) {
  return html
    .replace(/<br\s*\/?>(\s*)/gi, " \n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/[ \t]+/g, " ")
    .trim();
}

/* Pull every <img src="image/..."> reference, in document order, deduped. */
function extractImages(html) {
  const out = [];
  const seen = new Set();
  const re = /<img[^>]+src="(image\/[^"]+)"[^>]*?(?:width="(\d+)")?[^>]*?(?:height="(\d+)")?[^>]*>/gi;
  let m;
  while ((m = re.exec(html))) {
    const src = m[1];
    const fname = basename(src);
    if (NON_ARTWORK_IMAGE.test(fname) || EXPLICIT_EXCLUDE.has(fname.toLowerCase())) continue;
    if (seen.has(src)) continue;
    seen.add(src);
    out.push({
      src,
      width: m[2] ? Number(m[2]) : undefined,
      height: m[3] ? Number(m[3]) : undefined,
    });
  }
  return out;
}

/* The caption sits in a cell whose class includes "rabbit". */
function extractRawCaption(html) {
  const re = /<td[^>]*class="[^"]*\brabbit\b[^"]*"[^>]*>([\s\S]*?)<\/td>/i;
  const m = re.exec(html);
  if (!m) return "";
  return stripTags(m[1]).replace(/\s+/g, " ").trim();
}

/* The body description sits in a cell whose class includes "gong01". */
function extractDescription(html) {
  const re = /<td[^>]*class="[^"]*\bgong01\b[^"]*"[^>]*>([\s\S]*?)<\/td>/i;
  const m = re.exec(html);
  if (!m) return { ko: "", en: "" };
  const text = stripTags(m[1]);
  // Korean vs English: split on the first line that is predominantly ASCII
  // after at least one Hangul line has appeared.
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const koLines = [];
  const enLines = [];
  let inEnglish = false;
  for (const line of lines) {
    const hasHangul = /[가-힣]/.test(line);
    if (!inEnglish && !hasHangul && /[A-Za-z]/.test(line) && koLines.length > 0) {
      inEnglish = true;
    }
    if (inEnglish) enLines.push(line);
    else koLines.push(line);
  }
  return { ko: koLines.join("\n").trim(), en: enLines.join("\n").trim() };
}

/*
 * Parse a free-form caption into title/year/medium/dimensions.
 * Strategy: locate the year token; text before it is the title block
 * (Korean title + English title), text after it is medium + dimensions +
 * location. Korean vs English title separated by the first ASCII run.
 */
function parseCaption(raw, warnings) {
  const result = { titleKo: "", titleEn: "", year: null, medium: "", dimensions: "" };
  if (!raw) {
    warnings.push("no-caption");
    return result;
  }

  const yearMatch = raw.match(YEAR_RE);
  let before = raw;
  let after = "";
  if (yearMatch) {
    result.year = Number(yearMatch[1]);
    const idx = yearMatch.index;
    before = raw.slice(0, idx).trim();
    after = raw.slice(idx + yearMatch[0].length).trim();
  } else {
    warnings.push("no-year");
  }

  // Some captions place medium/dimensions *before* the year (e.g.
  // "Blind-work 150x300cm Fluorescent Paint ... 1991"). If the pre-year block
  // contains a dimension token, treat everything from that token onward as
  // medium/dimensions and keep only the lead as the title.
  let titleBlock = before.trim();
  if (titleBlock) {
    const leadDim = titleBlock.match(DIM_RE);
    if (leadDim && leadDim.index > 0) {
      const tail = titleBlock.slice(leadDim.index).trim();
      titleBlock = titleBlock.slice(0, leadDim.index).trim();
      const tailDim = tail.match(DIM_RE);
      if (tailDim) {
        result.dimensions = tailDim[0].replace(/\s+/g, "").trim();
        const mediumTail = tail.slice(tailDim.index + tailDim[0].length).trim().replace(/^[,\s]+/, "");
        if (mediumTail) result.medium = mediumTail;
      }
      warnings.push("medium-before-year");
    }
  }
  if (titleBlock) {
    const firstAscii = titleBlock.match(/[A-Za-z]/);
    if (/[가-힣]/.test(titleBlock) && firstAscii) {
      // Find the boundary: last Hangul char before the English starts.
      const m = titleBlock.match(/^([^A-Za-z]*[가-힣][^A-Za-z]*?)\s{1,}([A-Za-z].*)$/);
      if (m) {
        result.titleKo = m[1].trim();
        result.titleEn = m[2].trim();
      } else {
        result.titleEn = titleBlock;
        warnings.push("title-split-ambiguous");
      }
    } else if (/[가-힣]/.test(titleBlock)) {
      result.titleKo = titleBlock;
    } else {
      result.titleEn = titleBlock;
    }
  } else {
    warnings.push("no-title");
  }

  // Medium + dimensions from the tail.
  if (after) {
    const dimMatch = after.match(DIM_RE);
    if (dimMatch) {
      result.dimensions = dimMatch[0].replace(/\s+/g, "").trim();
      result.medium = after.slice(0, dimMatch.index).trim().replace(/[,\s]+$/, "");
      // location (text after dimensions) is left within rawCaption only.
    } else {
      result.medium = after.trim();
    }
  } else if (yearMatch && !result.medium) {
    warnings.push("no-medium");
  }

  return result;
}

function slugFromFile(file) {
  return file.replace(/\.htm$/i, "").toLowerCase();
}

function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function main() {
  const files = listLegacyFiles();
  const records = [];
  const orderBySeries = {};
  ensureDir(LEGACY_PUBLIC_DIR);
  const copiedImages = new Set();

  for (const file of files) {
    const series = seriesForFile(file);
    const warnings = [];
    if (!series) {
      continue; // not a known work series
    }

    const html = decode(file);
    const images = extractImages(html);
    const rawCaption = extractRawCaption(html);
    const desc = extractDescription(html);

    // Index/menu pages (install.htm, painting.htm) have no artwork image or
    // caption — skip them, they are navigation, not works.
    if (images.length === 0 && !rawCaption) {
      continue;
    }
    if (images.length === 0) warnings.push("no-images");

    const parsed = parseCaption(rawCaption, warnings);

    // Title fallbacks.
    let titleKo = parsed.titleKo;
    let titleEn = parsed.titleEn;
    if (!titleKo && !titleEn) {
      const titleTag = (html.match(/<title>([^<]*)<\/title>/i) || [])[1];
      if (titleTag) {
        titleEn = titleTag.trim();
        warnings.push("title-from-html-title-tag");
      } else {
        titleEn = slugFromFile(file);
        warnings.push("title-fallback-slug");
      }
    }
    if (!titleKo) titleKo = titleEn;
    if (!titleEn) titleEn = titleKo;

    orderBySeries[series] = (orderBySeries[series] || 0) + 1;

    // Copy referenced artwork images into public/ so the Astro build can serve
    // them. We copy individual referenced files, never the whole image/ dir.
    const publicImages = images.map((img) => {
      const fname = basename(img.src);
      const srcPath = join(IMAGE_DIR, fname);
      const publicSrc = `/assets/works/legacy/${fname}`;
      if (existsSync(srcPath)) {
        if (!copiedImages.has(fname)) {
          copyFileSync(srcPath, join(LEGACY_PUBLIC_DIR, fname));
          copiedImages.add(fname);
        }
      } else {
        warnings.push(`missing-image:${fname}`);
      }
      return { ...img, publicSrc };
    });

    records.push({
      legacyFile: file,
      series,
      slug: slugFromFile(file),
      titleKo,
      titleEn,
      year: parsed.year,
      medium: parsed.medium || undefined,
      dimensions: parsed.dimensions || undefined,
      images: publicImages,
      caption: rawCaption || undefined,
      rawCaption: rawCaption || undefined,
      descriptionKo: desc.ko || undefined,
      descriptionEn: desc.en || undefined,
      order: orderBySeries[series],
      extractionWarnings: warnings,
    });
  }

  ensureDir(dirname(OUT_JSON));
  writeFileSync(OUT_JSON, JSON.stringify(records, null, 2) + "\n", "utf8");

  // Stats.
  const bySeries = {};
  let withWarnings = 0;
  let warningCount = 0;
  for (const r of records) {
    bySeries[r.series] = (bySeries[r.series] || 0) + 1;
    if (r.extractionWarnings.length) {
      withWarnings++;
      warningCount += r.extractionWarnings.length;
    }
  }

  console.log("=== legacy works extraction ===");
  console.log(`scanned legacy files : ${files.length}`);
  console.log(`extracted records    : ${records.length}`);
  console.log(`images copied        : ${copiedImages.size}`);
  console.log("by series:");
  for (const [s, n] of Object.entries(bySeries)) console.log(`  ${s.padEnd(24)} ${n}`);
  console.log(`records with warnings: ${withWarnings}`);
  console.log(`total warning count  : ${warningCount}`);
  console.log(`output               : ${OUT_JSON.replace(ROOT + "/", "")}`);
}

main();
