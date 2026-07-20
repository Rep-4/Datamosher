// File: scripts/copy-ffmpeg.mjs

import {
  copyFile,
  mkdir,
  rm
} from "node:fs/promises";

import { resolve } from "node:path";

const sourceDirectory = resolve(
  "node_modules",
  "@ffmpeg",
  "core",
  "dist",
  "esm"
);

const destinationDirectory = resolve(
  "public",
  "ffmpeg-esm-0.12.10"
);

await rm(destinationDirectory, {
  recursive: true,
  force: true
});

await mkdir(destinationDirectory, {
  recursive: true
});

await copyFile(
  resolve(
    sourceDirectory,
    "ffmpeg-core.js"
  ),
  resolve(
    destinationDirectory,
    "ffmpeg-core.js"
  )
);

await copyFile(
  resolve(
    sourceDirectory,
    "ffmpeg-core.wasm"
  ),
  resolve(
    destinationDirectory,
    "ffmpeg-core.wasm"
  )
);

console.log(
  "FFmpeg ESM core copied to " +
    "public/ffmpeg-esm-0.12.10."
);