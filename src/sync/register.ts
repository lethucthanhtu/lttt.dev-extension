/**
 * Dynamic registration of the Wiki.js session sync content script.
 * Imported only by extension pages / the service worker (never by the content
 * script itself). Uses an IIFE build so no web_accessible_resources are needed
 * (which would let any site detect the extension).
 */
import contentScript from '../content/sync.ts?script&iife';
import { getConfig, hasAppPermission } from './config';

const SCRIPT_ID = 'wikijs-session-sync';

/**
 * (Re)register the content script for the configured app origin only, or
 * unregister it when there is no config / no permission.
 */
export const syncContentScript = async (): Promise<void> => {
	const existing = await chrome.scripting.getRegisteredContentScripts({
		ids: [SCRIPT_ID],
	});
	if (existing.length) {
		await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
	}
	const c = await getConfig();
	if (!c || !(await hasAppPermission(c))) return;
	await chrome.scripting.registerContentScripts([
		{
			id: SCRIPT_ID,
			js: [contentScript],
			matches: [`${c.appOrigin}/*`],
			runAt: 'document_start',
			allFrames: false,
			persistAcrossSessions: true,
		},
	]);
};
