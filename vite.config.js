import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { rm } from 'node:fs/promises';
import path from 'node:path';

// The marketing tile template lives in public/ so the dev server can serve
// it same-origin for screenshot generation, but it's a dev-only artifact
// and should not ship inside the production app bundle. Vite copies public/
// verbatim into dist/, so strip it back out after the build completes.
function stripMarketingFromBuild() {
  return {
    name: 'strip-marketing-from-build',
    apply: 'build',
    async closeBundle() {
      await rm(path.resolve('dist/marketing'), { recursive: true, force: true });
    },
  };
}

export default defineConfig({
  plugins: [react(), stripMarketingFromBuild()],
  worker: {
    format: 'es',
  },
  build: {
    target: 'esnext',
    chunkSizeWarningLimit: 2000,
  },
  optimizeDeps: {
    exclude: ['@huggingface/transformers'],
  },
  server: {
    headers: {
      // Required for WASM multithreading (SharedArrayBuffer) used by onnxruntime-web
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
    },
  },
  preview: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
    },
  },
});
