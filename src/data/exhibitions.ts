import pages from "../../data/legacy-pages.generated.json";

/*
 * Exhibition data is not maintained separately — it is derived from the same
 * legacy C.V. source (cv.htm / cv02.htm) already extracted into
 * data/legacy-pages.generated.json. The Exhibition page reuses the CV's
 * exhibition sections (개인전 / 2인전 / 주요 단체전 — SOLO / DUO / GROUP) and
 * splits each flat line into a leading year and the remaining title/venue text
 * so it can render a structured, scannable list.
 *
 * Nothing is invented here: when a line has no parseable leading year, the
 * whole line is kept as the title and `year` is left empty. The original line
 * is always preserved verbatim in `raw` so manual review against the legacy
 * source stays possible.
 */

export interface ExhibitionEntry {
  /** Leading 4-digit year, or "" when the legacy line has none. */
  year: string;
  /** Title + venue text after the year (original wording preserved). */
  text: string;
  /** The untouched legacy line, for manual review. */
  raw: string;
}

export interface ExhibitionSection {
  heading: string;
  entries: ExhibitionEntry[];
}

export interface ExhibitionGroup {
  lang: "ko" | "en";
  label: string;
  sections: ExhibitionSection[];
}

/* Section headings that hold exhibitions (not education / collections). */
const KO_EXHIBITION_HEADINGS = ["개인전", "2인전", "주요 단체전", "단체전"];
const EN_EXHIBITION_HEADINGS = [
  "SOLO EXHIBITIONS",
  "DUO EXHIBITIONS",
  "SELECTED GROUP EXHIBITIONS",
  "GROUP EXHIBITIONS",
];

function parseEntry(raw: string): ExhibitionEntry {
  const m = raw.match(/^((?:19|20)\d{2})\s+(.*)$/);
  if (m) return { year: m[1], text: m[2].trim(), raw };
  return { year: "", text: raw, raw };
}

type LegacyCv = (typeof pages.cv.ko) | (typeof pages.cv.en);

function buildGroup(cv: LegacyCv, headings: string[]): ExhibitionSection[] {
  return cv.sections
    .filter((s) => headings.includes(s.heading))
    .map((s) => ({
      heading: s.heading,
      entries: s.items.map(parseEntry),
    }));
}

export const EXHIBITION_GROUPS: ExhibitionGroup[] = [
  {
    lang: "ko",
    label: "국문",
    sections: buildGroup(pages.cv.ko, KO_EXHIBITION_HEADINGS),
  },
  {
    lang: "en",
    label: "English",
    sections: buildGroup(pages.cv.en, EN_EXHIBITION_HEADINGS),
  },
];

export const EXHIBITION_LEGACY_FILES = pages.cv.legacyFiles;
