import type { CollectionEntry } from "astro:content";

/**
 * Series rendered as a single artwork page (all images in one carousel) with
 * no selection grid. Blind Work is one continuous body of work.
 */
export const SINGLE_PAGE_SERIES = ["blind-work"] as const;

export function isSinglePageSeries(series: string): boolean {
  return (SINGLE_PAGE_SERIES as readonly string[]).includes(series);
}

/**
 * A single carousel slide within an artwork page. Every slide carries its own
 * title/description/caption so a page can represent either one artwork shown
 * from several angles (e.g. install01 — all slides share a title) or a single
 * exhibition browsed painting-by-painting (e.g. paint01 — each slide differs).
 */
export interface WorkSlide {
  src: string;
  alt: string;
  width?: number;
  height?: number;
  titleKo: string;
  titleEn: string;
  year: number | null;
  medium?: string;
  dimensions?: string;
  descriptionKo?: string;
  descriptionEn?: string;
  caption?: string;
}

export interface WorkGroup {
  series: string;
  /** Stable URL slug, derived from the legacy-file prefix (e.g. "install01"). */
  slug: string;
  /** Representative title for index cards (taken from the first slide). */
  titleKo: string;
  titleEn: string;
  year: number | null;
  /** Cover image for index grids. */
  cover?: { src: string; alt: string };
  slides: WorkSlide[];
}

/**
 * Reduce a legacy file/slug to its artwork-group key by dropping the trailing
 * image index. "install01_3" → "install01", "paint10_14" → "paint10",
 * "bw02" → "bw02". This mirrors the legacy site's Back/Next image chains, and
 * yields page counts matching the Figma index frames (installation 15,
 * multi-slide 4, paintings 10).
 */
export function groupKey(entry: CollectionEntry<"works">["data"]): string {
  const legacy = entry.legacyFile ?? `${entry.slug}.htm`;
  const stem = legacy.replace(/\.html?$/i, "");
  return stem.replace(/_\d+$/, "");
}

/**
 * Group a list of work entries into artwork pages, preserving order. Each
 * group's slides are the flattened, order-sorted images of its entries, with
 * per-image metadata attached.
 */
export function groupWorks(entries: CollectionEntry<"works">[]): WorkGroup[] {
  const sorted = [...entries].sort(
    (a, b) => a.data.order - b.data.order || a.data.slug.localeCompare(b.data.slug),
  );

  const groups = new Map<string, WorkGroup>();
  for (const entry of sorted) {
    const d = entry.data;
    const key = groupKey(d);
    let group = groups.get(key);
    if (!group) {
      group = {
        series: d.series,
        slug: key,
        titleKo: d.titleKo,
        titleEn: d.titleEn,
        year: d.year,
        cover: d.images[0]
          ? { src: d.images[0].src, alt: d.images[0].alt }
          : undefined,
        slides: [],
      };
      groups.set(key, group);
    }
    group.slides.push(...entryToSlides(d));
  }

  return [...groups.values()];
}

/**
 * Merge every entry of a series into a single artwork page (one carousel of
 * all images). Used for Blind Work, where all images belong to one body of
 * work and there is no per-piece selection grid.
 */
export function mergeWorks(
  entries: CollectionEntry<"works">[],
  slug: string,
): WorkGroup {
  const sorted = [...entries].sort(
    (a, b) => a.data.order - b.data.order || a.data.slug.localeCompare(b.data.slug),
  );
  const first = sorted[0]?.data;
  const slides = sorted.flatMap((e) => entryToSlides(e.data));
  return {
    series: first?.series ?? slug,
    slug,
    titleKo: first?.titleKo ?? "",
    titleEn: first?.titleEn ?? "",
    year: first?.year ?? null,
    cover: slides[0] ? { src: slides[0].src, alt: slides[0].alt } : undefined,
    slides,
  };
}

function entryToSlides(d: CollectionEntry<"works">["data"]): WorkSlide[] {
  const images = d.images.length > 0 ? d.images : [{ src: "", alt: d.titleEn }];
  return images.map((img) => ({
    src: img.src,
    alt: img.alt,
    width: img.width,
    height: img.height,
    titleKo: d.titleKo,
    titleEn: d.titleEn,
    year: d.year,
    medium: d.medium,
    dimensions: d.dimensions,
    descriptionKo: d.descriptionKo,
    descriptionEn: d.descriptionEn,
    caption: d.caption,
  }));
}
