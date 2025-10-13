import { defineManifest } from '@crxjs/vite-plugin';
import pkg from './package.json';

export default defineManifest({
	manifest_version: 3,
	name: pkg.name.replace('-e', ' E'),
	version: pkg.version,
	homepage_url: 'https://lttt.dev',
	author: { email: 'lethucthanhtu+extension@gamil.com' },
	description: 'Extension for quick and easy create lttt.dev link',
	icons: { 48: 'public/logo.png' },
	action: { default_icon: { 48: 'public/logo.png' } },
	permissions: ['contextMenus', 'activeTab', 'scripting', 'clipboardWrite'],
	content_scripts: [
		{
			js: ['src/content/main.tsx'],
			matches: ['https://*/*'],
		},
	],
	background: {
		service_worker: 'src/background.ts',
		type: 'module',
	},
});
