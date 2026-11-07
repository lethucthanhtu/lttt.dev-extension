import path from 'node:path'
import { crx } from '@crxjs/vite-plugin'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import zip from 'vite-plugin-zip-pack'
import manifest from './manifest.config.js'
import { name } from './package.json'
import tailwindcss from "@tailwindcss/vite";

/**
 * crxjs lists `?script` files in web_accessible_resources for every site.
 * Scripts injected via chrome.scripting.registerContentScripts do not need
 * that, and exposing them lets any page detect the extension by fetching
 * chrome-extension://<id>/<file>. Strip those entries from the final manifest.
 */
const PRIVATE_SCRIPTS = ['src/content/sync.js'];
const stripWebAccessible = (): Plugin & {
  renderCrxManifest: (m: chrome.runtime.ManifestV3) => chrome.runtime.ManifestV3;
} => ({
  name: 'strip-web-accessible-dynamic-scripts',
  apply: 'build',
  enforce: 'post',
  // crxjs plugin hook, runs on the final manifest
  renderCrxManifest(manifest) {
    const war = (manifest.web_accessible_resources ?? [])
      .map((e) => ({
        ...e,
        resources: e.resources.filter((r) => !PRIVATE_SCRIPTS.includes(r)),
      }))
      .filter((e) => e.resources.length);
    if (war.length) manifest.web_accessible_resources = war;
    else delete manifest.web_accessible_resources;
    return manifest;
  },
});

export default defineConfig({
  resolve: {
    alias: {
      "@": `${path.resolve(__dirname, "src")}`,
    },
  },
  plugins: [
    react(),
    crx({ manifest }),
    stripWebAccessible(),
    zip({ outDir: "release", outFileName: `${name}.zip` }),
    tailwindcss(),
  ],
  server: {
    cors: {
      origin: [/chrome-extension:\/\//],
    },
  },
});
