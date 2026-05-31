#!/usr/bin/env node
/*
 * Extract the static "info" pages (C.V., CONTACT, ESSAY) from the legacy
 * EUC-KR HTML into one structured JSON file the Astro pages render from.
 *
 *   cv.htm      -> Korean C.V.   |  cv02.htm   -> English C.V.
 *   contact.htm -> address / tel / email
 *   essay.htm   -> Korean essay  |  essay02.htm -> English essay
 *
 * Output: data/legacy-pages.generated.json
 *
 * Keeping this content in a generated JSON (rather than pasted into .astro
 * files) means the long Korean text is never hand-transcribed — it is decoded
 * straight from the legacy source via iconv-lite, so nothing gets corrupted,
 * and the whole thing is regenerable with one command.
 *
 * Usage: node scripts/extract-legacy-pages.mjs
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import iconv from "iconv-lite";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OUT = join(ROOT, "data", "legacy-pages.generated.json");

function decode(file) {
  return iconv.decode(readFileSync(join(ROOT, file)), "euc-kr");
}

/* HTML -> array of non-empty trimmed text lines (block tags / <br> = breaks). */
function toLines(html) {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|td|h[1-6]|li)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/[ \t]+/g, " ");
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

/* ----------------------------- C.V. ----------------------------- */
/*
 * The CV is a flat list of lines: a few section headers (학력 / 개인전 / ...
 * or EDUCATION / SOLO EXHIBITIONS / ...) and many entry lines. We bucket lines
 * under the most recent header. A line is a header when it has no leading year
 * and matches the known header vocabulary.
 */
const CV_HEADERS_KO = ["학력", "개인전", "2인전", "주요 단체전", "단체전", "작품소장"];
const CV_HEADERS_EN = [
  "EDUCATION",
  "SOLO EXHIBITIONS",
  "DUO EXHIBITIONS",
  "SELECTED GROUP EXHIBITIONS",
  "GROUP EXHIBITIONS",
  "PUBLIC COLLECTIONS",
  "PRESENTLY",
];

function parseCv(file, headers) {
  const lines = toLines(file);
  // First line is the page title ("C.V."); a Korean "born" note may follow.
  const sections = [];
  let intro = "";
  let current = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (i === 0 && /^C\.?V\.?$/i.test(line)) continue;
    if (headers.includes(line)) {
      current = { heading: line, items: [] };
      sections.push(current);
      continue;
    }
    if (!current) {
      // Pre-header line: a born/biography note (인천생 / Born in Incheon...).
      intro = intro ? `${intro} ${line}` : line;
      continue;
    }
    current.items.push(line);
  }
  return { intro, sections };
}

/* --------------------------- CONTACT ---------------------------- */
/*
 * contact.htm holds Address / Tel / Email labels followed by their values,
 * scattered across many empty table cells. We collect lines, then split on the
 * known labels.
 */
function parseContact(file) {
  const lines = toLines(file).filter((l) => l.toLowerCase() !== "contact");
  const out = { address: [], tel: [], email: "" };
  let bucket = null;
  for (let raw of lines) {
    const m = raw.match(/^(Address|Tel|Email)\s*:?\s*(.*)$/i);
    if (m) {
      bucket = m[1].toLowerCase();
      const rest = m[2].trim();
      if (bucket === "email") out.email = rest;
      else if (rest) out[bucket].push(rest);
      continue;
    }
    if (!bucket) continue;
    if (bucket === "email") {
      if (!out.email) out.email = raw.trim();
    } else {
      out[bucket].push(raw.trim());
    }
  }
  // Email may carry a trailing token; keep just the address-looking part.
  const emailMatch = out.email.match(/[\w.+-]+@[\w.-]+/);
  if (emailMatch) out.email = emailMatch[0];
  return out;
}

/* ---------------------------- ESSAY ----------------------------- */
/*
 * The essay is a long interview. We keep the first line as the title and the
 * rest as ordered paragraphs. Short numbered lines ("1. 외도", "1. Deviation")
 * and the trailing signature are tagged so the page can style them.
 */
function parseEssay(file) {
  const lines = toLines(file);
  const title = lines.shift() || "";
  const paragraphs = lines.map((text) => {
    // A trailing signature like "1998. 2. 공성훈" — a 4-digit year (not a
    // section number) followed by the artist's name.
    const isSignature = /(공성훈|Kong\s*,?\s*Sung-?Hun)\s*$/.test(text) && /\b(19|20)\d{2}\b/.test(text) && text.length <= 60;
    // A section header like "1. 외도" / "2. Style - Consistency" — a small
    // ordinal (1 or 2 digits) then a short phrase.
    const isHeading = !isSignature && /^\d{1,2}\.\s+\S/.test(text) && text.length <= 40;
    return { text, ...(isSignature ? { kind: "signature" } : isHeading ? { kind: "heading" } : {}) };
  });
  return { title, paragraphs };
}

function main() {
  const data = {
    cv: {
      ko: parseCv(decode("cv.htm"), CV_HEADERS_KO),
      en: parseCv(decode("cv02.htm"), CV_HEADERS_EN),
      legacyFiles: ["cv.htm", "cv02.htm"],
    },
    contact: {
      ...parseContact(decode("contact.htm")),
      legacyFiles: ["contact.htm"],
    },
    essay: {
      ko: parseEssay(decode("essay.htm")),
      en: parseEssay(decode("essay02.htm")),
      legacyFiles: ["essay.htm", "essay02.htm"],
    },
  };

  if (!existsSync(dirname(OUT))) mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(data, null, 2) + "\n", "utf8");

  console.log("=== legacy info pages extraction ===");
  console.log(`cv.ko sections   : ${data.cv.ko.sections.length}`);
  console.log(`cv.en sections   : ${data.cv.en.sections.length}`);
  console.log(`contact          : address ${data.contact.address.length} line(s), tel ${data.contact.tel.length}, email ${data.contact.email || "—"}`);
  console.log(`essay.ko paras   : ${data.essay.ko.paragraphs.length}`);
  console.log(`essay.en paras   : ${data.essay.en.paragraphs.length}`);
  console.log(`output           : ${OUT.replace(ROOT + "/", "")}`);
}

main();
