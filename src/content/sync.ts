/**
 * Wiki.js session sync — content script. Registered dynamically for the
 * configured web app origin only (see src/sync/register.ts).
 *
 * Answers the page's `ping` / `sync` messages and relays deferred `synced`
 * results from the background. It stays silent on every other origin so other
 * sites cannot detect the extension. The Wiki.js token never passes through
 * this script: the background reads the cookie and sends it straight to the
 * web app.
 */
import {
	EXT_SOURCE,
	MAX_URL_LENGTH,
	PAGE_SOURCE,
	PROTOCOL_VERSION,
	RUNTIME_SYNC,
	RUNTIME_SYNCED,
	getConfig,
	type SyncResult,
} from '../sync/config';

// Resolved once; the listener is attached immediately (document_start) so the
// page's first ping is not missed while storage is being read.
const enabled = getConfig()
	.then((c) => c !== null && c.appOrigin === location.origin)
	.catch(() => false);

const post = (payload: Record<string, unknown>) =>
	window.postMessage({ source: EXT_SOURCE, ...payload }, location.origin);

const resultFields = (r: SyncResult) =>
	r.ok ? { ok: true } : { ok: false, code: r.code };

window.addEventListener('message', async (event: MessageEvent) => {
	if (event.source !== window || event.origin !== location.origin) return;
	const data = event.data;
	if (!data || typeof data !== 'object' || data.source !== PAGE_SOURCE) return;
	const { type, id, wikiUrl } = data as {
		type?: unknown;
		id?: unknown;
		wikiUrl?: unknown;
	};
	if (typeof id !== 'string' && typeof id !== 'number') return;
	if (type !== 'ping' && type !== 'sync') return;
	if (!(await enabled)) return;

	if (type === 'ping') {
		post({
			type: 'pong',
			id,
			version: PROTOCOL_VERSION,
			extVersion: chrome.runtime.getManifest().version,
		});
		return;
	}

	// Only a string is forwarded; the background validates it as an origin.
	if (
		wikiUrl !== undefined &&
		(typeof wikiUrl !== 'string' || wikiUrl.length > MAX_URL_LENGTH)
	) {
		post({ type: 'result', id, ok: false, code: 'INVALID_WIKI_URL' });
		return;
	}

	let result: SyncResult;
	try {
		result = (await chrome.runtime.sendMessage({
			type: RUNTIME_SYNC,
			...(wikiUrl !== undefined ? { wikiUrl } : {}),
		})) ?? { ok: false, code: 'FAILED' };
	} catch {
		// e.g. extension reloaded and this context was invalidated
		result = { ok: false, code: 'FAILED' };
	}
	post({ type: 'result', id, ...resultFields(result) });
});

// Deferred results (after the user logged in to the wiki or allowed a wiki
// origin), pushed by the background to every tab of the app.
chrome.runtime.onMessage.addListener((message, sender) => {
	if (sender.id !== chrome.runtime.id || sender.tab) return;
	if (message?.type !== RUNTIME_SYNCED || !message.result) return;
	const result = message.result as SyncResult;
	enabled.then((on) => {
		if (on) post({ type: 'synced', ...resultFields(result) });
	});
});
