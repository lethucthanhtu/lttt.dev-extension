import path from 'node:path';
import { crx } from '@crxjs/vite-plugin';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { build as esbuild } from 'esbuild';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import zip from 'vite-plugin-zip-pack';
import manifest from './manifest.config.js';
import { name } from './package.json';

/**
 * Build the bridge content script as one self-contained IIFE file,
 * emitted at CONTENT_SCRIPT and registered at runtime (src/bridge/register.ts).
 * crxjs' `?script` import would split shared modules into chunks loaded via
 * web_accessible_resources, which lets any page detect the extension by
 * fetching chrome-extension://<id>/<file>. This file is not web accessible.
 */
const CONTENT_SCRIPT = 'src/content/bridge.js';
const contentScript = (): Plugin => ({
	name: 'bridge-content-script',
	apply: 'build',
	async generateBundle() {
		const result = await esbuild({
			entryPoints: [path.resolve(__dirname, 'src/content/bridge.ts')],
			bundle: true,
			format: 'iife',
			target: 'chrome120',
			minify: true,
			write: false,
			logLevel: 'silent',
		});
		this.emitFile({
			type: 'asset',
			fileName: CONTENT_SCRIPT,
			source: result.outputFiles[0].text,
		});
	},
});

export default defineConfig(({ mode }) => ({
	// Public key that verifies web app certificates (bridge). Empty = the
	// default key in src/bridge/cert.ts. Forks set EXTENSION_SIGNING_PUBLIC_KEY
	// (base64 SPKI DER, ECDSA P-256) to use their own signing key.
	define: {
		__SIGNING_PUBLIC_KEY__: JSON.stringify(
			loadEnv(
				mode,
				process.cwd(),
				'EXTENSION_'
			).EXTENSION_SIGNING_PUBLIC_KEY?.trim() ?? ''
		),
	},
	build: {
		rollupOptions: {
			// Extension pages not referenced by the manifest.
			input: {
				consent: path.resolve(__dirname, 'src/consent/index.html'),
			},
		},
	},
	resolve: {
		alias: {
			'@': `${path.resolve(__dirname, 'src')}`,
		},
	},
	plugins: [
		react(),
		tailwindcss(),
		crx({ manifest }),
		contentScript(),
		zip({ outDir: 'release', outFileName: `${name}.zip` }),
	],
	server: {
		cors: {
			origin: [/chrome-extension:\/\//],
		},
	},
}));
