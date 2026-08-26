import { defineCollection, z } from "astro:content";

/** The four Works categories from the Figma navigation. */
export const WORK_SERIES = [
  "blind-work",
  "installation-work",
  "multi-slide-projection",
  "paintings",
] as const;

const imageSchema = z.object({
  src: z.string(), // path under /public, e.g. /assets/works/web/foo.jpg
  alt: z.string(),
  width: z.number().optional(),
  height: z.number().optional(),
});

const works = defineCollection({
  type: "data",
  schema: z.object({
    slug: z.string(),
    series: z.enum(WORK_SERIES),
    titleKo: z.string(),
    titleEn: z.string(),
    year: z.number().nullable().default(null),
    medium: z.string().optional(),
    dimensions: z.string().optional(),
    /** Exhibition venue / place, when the legacy caption recorded one. */
    location: z.string().optional(),
    /** Venue split into Korean / English for the language toggle. */
    locationKo: z.string().optional(),
    locationEn: z.string().optional(),
    descriptionKo: z.string().optional(),
    descriptionEn: z.string().optional(),
    images: z.array(imageSchema).default([]),
    caption: z.string().optional(),
    order: z.number().default(0),
    /** Source legacy page this entry was extracted/curated from (provenance). */
    legacyFile: z.string().optional(),
    /** Heuristic extractor warnings carried over from the import pipeline. */
    extractionWarnings: z.array(z.string()).optional(),
    /** Hide this entry from the series thumbnail list (still shown on year pages). */
    listHidden: z.boolean().optional(),
    /** True when an auto-imported entry should be checked by a human. */
    manualReview: z.boolean().optional(),
    /** Human-readable reasons an entry was flagged for manual review. */
    reviewNotes: z.array(z.string()).optional(),
  }),
});

export const collections = { works };
