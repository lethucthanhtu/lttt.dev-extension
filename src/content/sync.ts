/**
 * Wiki.js session sync — content script. Registered dynamically on every
 * https site and on localhost (see src/sync/register.ts).
 *
 * It stays silent unless the background confirms that this page is an allowed
 * web app: a page with a valid signed certificate listing its origin (v3), or
 * the app configured in Options (v1/v2). The background decides from the
 * browser-provided sender origin, never from what the page claims. So other
 * sites cannot detect the extension. The Wiki.js token never passes through
 * this script: the background reads the cookie and sends it straight to the
 * web app.
 */
import {
	EXT_SOURCE,
	MAX_CERT_LENGTH,
	MAX_URL_LENGTH,
	PAGE_SOURCE,
	PROTOCOL_VERSION,
	RUNTIME_PING,
	RUNTIME_SYNC,
	RUNTIME_SYNCED,
	type SyncResult,
} from '../sync/config';

/** Set once the background accepted this page; only then are results relayed. */
let allowed = false;

const post = (payload: Record<string, unknown>) =>
	window.postMessage({ source: EXT_SOURCE, ...payload }, location.origin);

const resultFields = (r: SyncResult) =>
	r.ok ? { ok: true } : { ok: false, code: r.code };

/** Ask the background. `undefined` = not an allowed page (or no extension). */
const ask = async <T>(message: Record<string, unknown>) => {
	try {
		return ((await chrome.runtime.sendMessage(message)) ?? undefined) as
			T | undefined;
	} catch {
		// e.g. extension reloaded and this context was invalidated
		return undefined;
	}
};

window.addEventListener('message', async (event: MessageEvent) => {
	if (event.source !== window || event.origin !== location.origin) return;
	const data = event.data;
	if (!data || typeof data !== 'object' || data.source !== PAGE_SOURCE) return;
	const { type, id, wikiUrl, cert } = data as Record<string, unknown>;
	if (typeof id !== 'string' && typeof id !== 'number') return;
	if (type !== 'ping' && type !== 'sync') return;
	// An unusable certificate is treated like none (no reply unless configured).
	const certField =
		typeof cert === 'string' && cert.length <= MAX_CERT_LENGTH ? { cert } : {};

	if (type === 'ping') {
		const res = await ask<{ ok: true }>({ type: RUNTIME_PING, ...certField });
		if (!res?.ok) return;
		allowed = true;
		post({
			type: 'pong',
			id,
			version: PROTOCOL_VERSION,
			extVersion: chrome.runtime.getManifest().version,
		});
		return;
	}

	// Only a short string is forwarded; the background validates it as an
	// origin, and reports INVALID_WIKI_URL only to an allowed page.
	const wikiField =
		wikiUrl === undefined
			? {}
			: typeof wikiUrl === 'string' && wikiUrl.length <= MAX_URL_LENGTH
				? { wikiUrl }
				: { wikiUrl: null };
	const result = await ask<SyncResult>({
		type: RUNTIME_SYNC,
		...certField,
		...wikiField,
	});
	if (result) {
		allowed = true;
		post({ type: 'result', id, ...resultFields(result) });
	} else if (allowed) {
		// Allowed before, so the extension failed (e.g. it was reloaded).
		post({ type: 'result', id, ok: false, code: 'FAILED' });
	}
});

// Deferred results (after the user logged in to the wiki or allowed a wiki
// origin), pushed by the background to every tab of the app.
chrome.runtime.onMessage.addListener((message, sender) => {
	if (sender.id !== chrome.runtime.id || sender.tab) return;
	if (message?.type !== RUNTIME_SYNCED || !message.result) return;
	if (!allowed || message.appOrigin !== location.origin) return;
	post({ type: 'synced', ...resultFields(message.result as SyncResult) });
});
