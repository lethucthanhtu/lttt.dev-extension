/**
 * Dynamic registration of the Wiki.js session sync content script.
 * Imported only by extension pages / the service worker (never by the content
 * script itself). Uses an IIFE build so no web_accessible_resources are needed
 * (which would let any site detect the extension).
 */
import contentScript from '../content/sync.ts?script&iife';

const SCRIPT_ID = 'wikijs-session-sync';

/**
 * Sites the content script runs on: every site a web app can live on (the
 * required host permissions). It stays silent unless the background confirms
 * that the page is an allowed web app (signed certificate), so other sites
 * cannot detect the extension.
 */
const MATCHES = ['https://*/*', 'http://localhost/*'];

/** (Re)register the content script. */
export const syncContentScript = async (): Promise<void> => {
	const existing = await chrome.scripting.getRegisteredContentScripts({
		ids: [SCRIPT_ID],
	});
	if (existing.length) {
		await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
	}
	await chrome.scripting.registerContentScripts([
		{
			id: SCRIPT_ID,
			js: [contentScript],
			matches: MATCHES,
			runAt: 'document_start',
			allFrames: false,
			persistAcrossSessions: true,
		},
	]);
};
