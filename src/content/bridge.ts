/**
 * Bridge — content script. Registered dynamically on https://*.lttt.dev only
 * (see src/bridge/register.ts).
 *
 * It stays silent unless the background confirms that this page is an allowed
 * web app: a page with a valid signed certificate listing its origin. The
 * background decides from the browser-provided sender origin, never from what
 * the page claims, so other sites cannot detect the extension.
 *
 * Page → extension (window.postMessage, target location.origin):
 *   { source: 'lttt-bridge', type: 'ping', id, cert }
 *   { source: 'lttt-bridge', type: 'request', id, cert, request }
 * Extension → page:
 *   { source: 'lttt-bridge-ext', type: 'pong', id, version, extVersion }
 *   { source: 'lttt-bridge-ext', type: 'result', id, ok, data? | code? }
 *   { source: 'lttt-bridge-ext', type: 'pending', id, code }
 *     (a `result` with the same id follows later)
 */
import {
	EXT_SOURCE,
	MAX_CERT_LENGTH,
	PAGE_SOURCE,
	PROTOCOL_VERSION,
	RUNTIME_DELIVER,
	RUNTIME_PING,
	RUNTIME_REQUEST,
	type Reply,
} from '../bridge/config';

/** Set once the background accepted this page; only then are replies relayed. */
let allowed = false;

const post = (payload: Record<string, unknown>) =>
	window.postMessage({ source: EXT_SOURCE, ...payload }, location.origin);

const postReply = (id: string | number, reply: Reply) => {
	if (reply.kind === 'pending') {
		post({ type: 'pending', id, code: reply.code });
	} else {
		post({ type: 'result', id, ...reply.result });
	}
};

/** Ask the background. `undefined` = not an allowed page (or no extension). */
const ask = async <T>(message: Record<string, unknown>) => {
	try {
		return ((await chrome.runtime.sendMessage(message)) ?? undefined) as
			| T
			| undefined;
	} catch {
		// e.g. extension reloaded and this context was invalidated
		return undefined;
	}
};

window.addEventListener('message', async (event: MessageEvent) => {
	if (event.source !== window || event.origin !== location.origin) return;
	const data = event.data;
	if (!data || typeof data !== 'object' || data.source !== PAGE_SOURCE) return;
	const { type, id, cert, request } = data as Record<string, unknown>;
	if (typeof id !== 'string' && typeof id !== 'number') return;
	if (type !== 'ping' && type !== 'request') return;
	// Without a usable certificate the page cannot be allowed: no reply.
	if (typeof cert !== 'string' || !cert || cert.length > MAX_CERT_LENGTH) {
		return;
	}

	if (type === 'ping') {
		const res = await ask<{ ok: true }>({ type: RUNTIME_PING, cert });
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

	// The background validates `request` (it comes from the page).
	const reply = await ask<Reply>({ type: RUNTIME_REQUEST, id, cert, request });
	if (reply) {
		allowed = true;
		postReply(id, reply);
	} else if (allowed) {
		// Allowed before, so the extension failed (e.g. it was reloaded).
		post({ type: 'result', id, ok: false, code: 'FAILED' });
	}
});

// Deferred replies (after consent or login), sent by the background to the
// tab that asked.
chrome.runtime.onMessage.addListener((message, sender) => {
	if (sender.id !== chrome.runtime.id || sender.tab) return;
	if (message?.type !== RUNTIME_DELIVER || !message.reply) return;
	if (!allowed || message.appOrigin !== location.origin) return;
	const { id } = message;
	if (typeof id !== 'string' && typeof id !== 'number') return;
	postReply(id, message.reply as Reply);
});
