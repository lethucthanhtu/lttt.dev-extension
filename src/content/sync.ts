/**
 * Wiki.js session sync — content script. Registered dynamically for the
 * configured web app origin only (see src/sync/register.ts).
 *
 * Answers the page's `ping` / `sync` messages. It stays silent on every other
 * origin so other sites cannot detect the extension. The Wiki.js token never
 * passes through this script: the background reads the cookie and sends it
 * straight to the web app.
 */
import {
	EXT_SOURCE,
	PAGE_SOURCE,
	PROTOCOL_VERSION,
	RUNTIME_SYNC,
	getConfig,
	type SyncResult,
} from '../sync/config';

// Resolved once; the listener is attached immediately (document_start) so the
// page's first ping is not missed while storage is being read.
const enabled = getConfig()
	.then((c) => c !== null && c.appOrigin === location.origin)
	.catch(() => false);

const reply = (payload: Record<string, unknown>) =>
	window.postMessage({ source: EXT_SOURCE, ...payload }, location.origin);

window.addEventListener('message', async (event: MessageEvent) => {
	if (event.source !== window || event.origin !== location.origin) return;
	const data = event.data;
	if (!data || typeof data !== 'object' || data.source !== PAGE_SOURCE) return;
	const { type, id } = data as { type?: unknown; id?: unknown };
	if (typeof id !== 'string' && typeof id !== 'number') return;
	if (type !== 'ping' && type !== 'sync') return;
	if (!(await enabled)) return;

	if (type === 'ping') {
		reply({ type: 'pong', id, version: PROTOCOL_VERSION });
		return;
	}

	let result: SyncResult;
	try {
		result = (await chrome.runtime.sendMessage({ type: RUNTIME_SYNC })) ?? {
			ok: false,
			code: 'FAILED',
		};
	} catch {
		// e.g. extension reloaded and this context was invalidated
		result = { ok: false, code: 'FAILED' };
	}
	reply(
		result.ok
			? { type: 'result', id, ok: true }
			: { type: 'result', id, ok: false, code: result.code }
	);
});
