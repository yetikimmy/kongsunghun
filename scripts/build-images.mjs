#!/usr/bin/env node
/*
 * Image pipeline (DRAFT / placeholder for phase 1).
 *
 * Intended flow:
 *   public/assets/works/originals/*  -> web/ (max 1600px, ~85% quality)
 *                                    -> thumb/ (max 600px, ~80% quality)
 *
 * Not wired up yet: choose sharp (recommended) and implement the resize loop
 * in a later phase. Kept as a documented placeholder so the directory contract
 * (originals / web / thumb) is established now.
 */

console.log(
  "[build-images] placeholder — implement with `sharp` in a later phase.\n" +
    "  originals/ -> web/ (<=1600px) and thumb/ (<=600px)",
);
