import { defineConfig } from "astro/config";

// Modernized site scaffold. Legacy Dreamweaver HTML remains at the repo root
// and is intentionally left out of the Astro build during this first phase.
export default defineConfig({
  site: "https://kongsunghun.example",
  build: {
    format: "directory",
  },
});
