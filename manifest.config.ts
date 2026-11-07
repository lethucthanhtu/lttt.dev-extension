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
			// Bridge
			'cookies',
			'storage', // local: per-site decisions; session: pending requests (no data)
		],
		// Short links: the service worker calls the lttt.dev API with the user's
		// cookies. Without this, CORS blocks it ("Failed to shorten URL"); the old
		// static content script on https://*/* used to grant it implicitly.
		// Bridge (v5): web apps live on https://*.lttt.dev, but the site they
		// read from (named in each request, approved by the user once per app
		// and site) may be any https origin, so reading its cookies or fetching
		// it with the user's session needs access to all https sites. The
		// content script itself runs only on *.lttt.dev.
		host_permissions: ['https://lttt.dev/*', 'https://*/*'],
		// No static content scripts: they force web_accessible_resources on every
		// site, which lets any page detect the extension. The bridge content
		// script is registered at runtime (src/bridge/register.ts) and
		// stays silent unless the page proves it is an allowed web app.
		// Lists and revokes the per-site decisions of the bridge.
		options_ui: { page: 'src/options/index.html', open_in_tab: true },
		background: {
			service_worker: 'src/background.ts',
			type: 'module',
		},
		...(EXTENSION_PUBLIC_KEY ? { key: EXTENSION_PUBLIC_KEY.trim() } : {}),
	};
});
