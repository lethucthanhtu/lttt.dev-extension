/**
 * Wiki.js session sync — shared constants (used by the background service
 * worker and the content script).
 *
 * No host is hard-coded and nothing is configured in the extension: a web app
 * sends a signed certificate listing its origins and its wiki (see cert.ts).
 */

/** Page → extension message source (posted by the web app). */
export const PAGE_SOURCE = 'wikijs-session-sync';
/** Extension → page message source (posted by the content script). */
export const EXT_SOURCE = 'wikijs-session-sync-ext';
/** Content script → background: may this page see the extension? */
export const RUNTIME_PING = 'wikijs-session-sync:ping';
/** Content script → background: run a sync. */
export const RUNTIME_SYNC = 'wikijs-session-sync:sync';
/** Background → content scripts: a deferred sync finished. */
export const RUNTIME_SYNCED = 'wikijs-session-sync:synced';
export const PROTOCOL_VERSION = 3;

export type SyncErrorCode =
	| 'NO_PERMISSION'
	/** Internal: the app rejected the token (a login is started instead). */
	| 'REJECTED'
	| 'APP_FORBIDDEN'
	| 'FAILED'
	| 'LOGIN_STARTED';

export type SyncResult = { ok: true } | { ok: false; code: SyncErrorCode };

/** Longest URL accepted as an origin. */
export const MAX_URL_LENGTH = 2048;
/** Longest app certificate accepted from a page. */
export const MAX_CERT_LENGTH = 4096;

/**
 * Parse a URL into an origin. Accepts https://<host>[:port], or
 * http://localhost[:port] for local development; rejects credentials.
 * Returns null otherwise.
 */
export const toOrigin = (input: unknown): string | null => {
	if (typeof input !== 'string' || input.length > MAX_URL_LENGTH) return null;
	let url: URL;
	try {
		url = new URL(input.trim());
	} catch {
		return null;
	}
	if (url.username || url.password) return null;
	if (url.protocol === 'https:' && url.hostname) return url.origin;
	if (url.protocol === 'http:' && url.hostname === 'localhost')
		return url.origin;
	return null;
};

export const pattern = (origin: string) => `${origin}/*`;
