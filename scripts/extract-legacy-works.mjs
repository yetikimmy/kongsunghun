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

/*
 * Medium phrases in the legacy captions are English material descriptions drawn
 * from a small, recurring vocabulary. A caption's medium can appear before OR
 * after the year and with or without a dimension token, so rather than anchoring
 * on position we detect the medium as the run of text starting at a material
 * *head phrase* and running to the end (minus any trailing venue).
 *
 * The anchors below are deliberately multi-word / specific ("Oil on",
 * "Dust and Acrylic", "Fluorescent Paint") so they match real media and NOT the
 * same word used inside an English title (e.g. the title "Dust Painting" or
 * "Perfect Painting" must not be mistaken for a medium). This is corpus-driven:
 * every legacy work whose caption carries a medium uses one of these heads.
 */
const MEDIUM_ANCHORS = [
  // paint / drawing media
  "Fluorescent Paint",
  "Dust and Acrylic",
  "Acrylic on",
  "Oil on",
  "Ink on",
  "Photo-Collage",
  "Offset Print",
  "Plaster Cast",
  "Plaster,",
  "Mixed Media",
  "C-print",
  "Photograph",
  // installation object/material lists (corpus-specific head terms)
  "Camera Obscura",
  "Partition with",
  "Partition,",
  "LED Displayer",
  "Plywood",
  "Helmet",
  "Comic Book",
  "Electric Shock Circuit",
  "Stainless Steel",
  // slide / projection apparatus
  "Slide Projection",
  "Hand-made Slide",
  "Hand-Made Slide",
  "Four Hand-Made Slide",
  // Korean media markers (e.g. "아크릴 박스 위에 실크스크린", "수제 슬라이드 프로젝터")
  "아크릴",
  "수제",
];
const MEDIUM_START_RE = new RegExp(
  "(" + MEDIUM_ANCHORS.map((k) => k.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")).join("|") + ")",
  "i"
);

/*
 * "Installation view", "detail", etc. are view labels, not media. When the
 * residue after stripping year/dimensions is only such a label (no material
 * anchor), the work genuinely has no medium and we leave `medium` empty.
 */
const VIEW_LABEL_RE = /\b(installation\s*view|detail|view)\b/i;

/*
 * A trailing exhibition venue in the unambiguous "<Name> Gallery|Museum, <City>"
 * form — an institution word followed by a comma and a city. We only strip this
 * in the *no-medium* path, and only with the trailing-comma form: that comma is
 * the reliable boundary, so we never accidentally swallow an English title word
 * that happens to precede a venue without punctuation (those stay in the title
 * and are flagged for review instead). When a medium IS present the venue stays
 * appended to the medium exactly as the legacy caption wrote it.
 */
const VENUE_RE =
  /\s+((?:[A-Z][\w.'-]*\s+){1,3}(?:Gallery|Museum|Center|Centre|Hall|Park)\s*,\s*[A-Z][\w.'-]+)\s*$/;

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
 * The caption interleaves optional tokens after the title — year, dimensions,
 * and a material medium — in a loose order (the medium can come before OR after
 * the year, with or without dimensions). We peel year and dimensions off the
 * line by what they *are* (a 4-digit year, an "NxN cm" dimension), then locate
 * the medium by its material head phrase, and treat the residue as the title
 * block (Korean then English). This is order-independent, unlike anchoring
 * everything on the year position, which mis-handled medium-before-year and
 * medium-without-dimensions captions.
 */
function parseCaption(raw, warnings) {
  const result = { titleKo: "", titleEn: "", year: null, medium: "", dimensions: "", location: "" };
  if (!raw) {
    warnings.push("no-caption");
    return result;
  }

  let work = raw.trim();

  // 1) Year — remove the token so it can't bleed into title/medium.
  const yearMatch = work.match(YEAR_RE);
  if (yearMatch) {
    result.year = Number(yearMatch[1]);
    work = (work.slice(0, yearMatch.index) + " " + work.slice(yearMatch.index + yearMatch[0].length))
      .replace(/\s+/g, " ")
      .trim();
  } else {
    warnings.push("no-year");
  }

  // 2) Dimensions — remove the token.
  const dimMatch = work.match(DIM_RE);
  if (dimMatch) {
    result.dimensions = dimMatch[0].replace(/\s+/g, "").trim();
    work = (work.slice(0, dimMatch.index) + " " + work.slice(dimMatch.index + dimMatch[0].length))
      .replace(/\s+/g, " ")
      .trim();
  }

  // 3) Medium — the English (or Korean) material phrase. Detect by the first
  // material *head phrase*; everything from there to the end of the residue is
  // the medium. What precedes the head phrase is the title block.
  //
  // A trailing exhibition venue (e.g. "... Kumho Museum, Seoul"), when present,
  // stays appended to the medium. Splitting the venue out deterministically is
  // unreliable — venue proper-nouns and material nouns are both capitalized and
  // are not always comma-separated — so we keep the medium exactly as the legacy
  // caption wrote it (venue included) rather than risk truncating the materials.
  let titleBlock = work;
  const medMatch = work.match(MEDIUM_START_RE);
  if (medMatch) {
    let medStart = medMatch.index;
    // Some media are quantified ("12 Hand-made Slide projectors", "59 Hand-made
    // Slide projector", "42대의 수제 슬라이드 ..."). The count belongs to the
    // medium, not the title — pull a leading numeric quantity into the medium.
    const lead = work.slice(0, medStart);
    const qty = lead.match(/(\d+(?:대의)?)\s*$/);
    if (qty) medStart = qty.index;
    titleBlock = work.slice(0, medStart).trim().replace(/[,\s]+$/, "");
    result.medium = work.slice(medStart).trim() || undefined;
  } else {
    // No material head phrase. Strip a trailing venue from the title block
    // (safe here: no medium text to confuse it with) and record it as location.
    const venue = titleBlock.match(VENUE_RE);
    if (venue) {
      result.location = venue[1].trim();
      titleBlock = titleBlock.slice(0, venue.index).trim().replace(/[,\s]+$/, "");
    }
    if (yearMatch && !VIEW_LABEL_RE.test(work)) {
      // Not merely a view label (installation view / detail): the caption
      // genuinely lacks a medium.
      warnings.push("no-medium");
    }
  }

  // Title block -> Korean / English split.
  titleBlock = titleBlock.replace(/[,\s]+$/, "").trim();
  if (titleBlock) {
    const firstAscii = titleBlock.match(/[A-Za-z]/);
    if (/[가-힣]/.test(titleBlock) && firstAscii) {
      // Boundary: Hangul (+ adjacent punctuation/numerals) then the English run.
      const m = titleBlock.match(/^([^A-Za-z]*[가-힣][^A-Za-z]*?)\s+([A-Za-z].*)$/);
      if (m) {
        result.titleKo = m[1].trim().replace(/[,\s]+$/, "");
        result.titleEn = m[2].trim();
      } else {
        // Hangul and Latin interleaved without a clean break (e.g. a Korean
        // title with a parenthetical English gloss). Keep as the Korean title.
        result.titleKo = titleBlock;
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
      location: parsed.location || undefined,
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
