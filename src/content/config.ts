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
    descriptionKo: z.string().optional(),
    descriptionEn: z.string().optional(),
    images: z.array(imageSchema).default([]),
    caption: z.string().optional(),
    order: z.number().default(0),
  }),
});

export const collections = { works };
