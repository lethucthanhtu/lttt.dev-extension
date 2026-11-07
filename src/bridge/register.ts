/**
 * Dynamic registration of the bridge content script. The file is built
 * by the `bridge-content-script` plugin in vite.config.ts as one IIFE,
 * not listed in web_accessible_resources (so sites cannot detect it).
 */
const CONTENT_SCRIPT = 'src/content/bridge.js';

const SCRIPT_ID = 'lttt-bridge';

/**
 * Sites the content script runs on: web apps live only on subdomains of
 * lttt.dev. It still stays silent unless the background confirms that the
 * page sent a valid signed certificate for its origin.
 */
const MATCHES = ['https://*.lttt.dev/*']; // APP_DOMAIN in config.ts

/** (Re)register the content script, dropping any older registration. */
export const syncContentScript = async (): Promise<void> => {
	// All dynamic scripts are ours; this also removes ids of older versions.
	const existing = await chrome.scripting.getRegisteredContentScripts();
	if (existing.length) {
		await chrome.scripting.unregisterContentScripts({
			ids: existing.map((s) => s.id),
		});
	}
	await chrome.scripting.registerContentScripts([
		{
			id: SCRIPT_ID,
			js: [CONTENT_SCRIPT],
			matches: MATCHES,
			runAt: 'document_start',
			allFrames: false,
			persistAcrossSessions: true,
		},
	]);
};
