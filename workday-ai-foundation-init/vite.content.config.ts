import { defineConfig } from 'vite';
import { resolve } from 'path';

/**
 * Dedicated Vite config for building content.js as a self-contained IIFE.
 *
 * WHY IIFE:
 *   chrome.scripting.executeScript() injects scripts as classic scripts,
 *   not ES modules. An IIFE bundles all imports inline and wraps everything
 *   in a function scope — no import/export statements at the top level.
 *
 * This config runs AFTER the main build (emptyOutDir: false) so it overwrites
 * the ES-module content.js produced by vite.config.ts with the IIFE version.
 */
export default defineConfig({
  plugins: [],
  build: {
    rollupOptions: {
      input: resolve(__dirname, 'src/content/content.ts'),
      output: {
        format: 'iife',
        name: 'WorkdayContentScript',
        entryFileNames: 'content.js',
        // No chunking — everything inlined into a single file
        inlineDynamicImports: true,
      },
    },
    outDir: 'dist',
    emptyOutDir: false, // Keep the popup/background already in dist/
    copyPublicDir: false,
  },
});
