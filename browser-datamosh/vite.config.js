// File: vite.config.js

import { defineConfig } from "vite";

export default defineConfig({
  base: "/Datamosher/browser-datamosh/",
  optimizeDeps: {
    exclude: [
      "@ffmpeg/ffmpeg",
      "@ffmpeg/util"
    ]
  },

  worker: {
    format: "es"
  }
});
