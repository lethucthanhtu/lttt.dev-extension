import { defineManifest } from '@crxjs/vite-plugin';
import { loadEnv } from 'vite';
import pkg from './package.json';

export default defineManifest(({ mode }) => {
	// Public key (base64 DER, no PEM header) that pins the extension ID.
	// Read from the environment or .env.local; the private key never enters
	// the repo. See README → "Stable extension ID".
	const { EXTENSION_PUBLIC_KEY } = loadEnv(mode, process.cwd(), 'EXTENSION_');
	if (!EXTENSION_PUBLIC_KEY && mode === 'production') {
		console.warn(
			'\n[manifest] EXTENSION_PUBLIC_KEY is not set: this build has no `key`, so its ID ' +
				'depends on the install folder. Do not commit release/ from this build.\n'
		);
	}

	return {
		manifest_version: 3,
		name: pkg.name.replace('-e', ' E'),
		version: pkg.version,
		homepage_url: 'https://lttt.dev',
		author: { email: 'lethucthanhtu+extension@gamil.com' },
		description: 'Extension for quick and easy create lttt.dev link',
		icons: { 48: 'public/logo.png' },
		action: { default_icon: { 48: 'public/logo.png' } },
		permissions: [
			'contextMenus',
			'activeTab',
			'scripting',
			'clipboardWrite',
			// Wiki.js session sync
			'cookies',
			'storage',
		],
		// Wiki.js session sync: the user grants only the two configured origins
		// at runtime from the options page; no host is hard-coded here.
		optional_host_permissions: ['https://*/*', 'http://localhost/*'],
		options_ui: { page: 'src/options/index.html', open_in_tab: true },
		// No static content scripts: they force web_accessible_resources on every
		// site, which lets any page detect the extension. The session sync
		// content script is registered at runtime for the configured app only.
		background: {
			service_worker: 'src/background.ts',
			type: 'module',
		},
		...(EXTENSION_PUBLIC_KEY ? { key: EXTENSION_PUBLIC_KEY.trim() } : {}),
	};
});
