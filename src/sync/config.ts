/**
 * Wiki.js session sync — shared config (used by the options page, the
 * background service worker and the content script).
 *
 * Only origins are stored (no tokens). No host is hard-coded: the user enters
 * the Wiki.js URL and the web app URL on the options page and grants host
 * permissions for exactly those two origins at runtime.
 */
export type SyncConfig = { wikiOrigin: string; appOrigin: string };

/** Page → extension message source (posted by the web app). */
export const PAGE_SOURCE = 'wikijs-session-sync';
/** Extension → page message source (posted by the content script). */
export const EXT_SOURCE = 'wikijs-session-sync-ext';
/** Content script → background runtime message type. */
export const RUNTIME_SYNC = 'wikijs-session-sync:sync';
export const PROTOCOL_VERSION = 1;

export type SyncErrorCode =
	| 'NOT_CONFIGURED'
	| 'NO_PERMISSION'
	| 'NOT_LOGGED_IN'
	| 'REJECTED'
	| 'APP_FORBIDDEN'
	| 'FORBIDDEN_ORIGIN'
	| 'FAILED';

export type SyncResult = { ok: true } | { ok: false; code: SyncErrorCode };

const STORAGE_KEY = 'wikijsSessionSync';

/**
 * Parse a user-entered URL into an origin. Accepts https://<host>[:port], or
 * http://localhost[:port] for local development. Returns null otherwise.
 */
export const toOrigin = (input: string): string | null => {
	let url: URL;
	try {
		url = new URL(input.trim());
	} catch {
		return null;
	}
	if (url.username || url.password) return null;
	if (url.protocol === 'https:' && url.hostname) return url.origin;
	if (url.protocol === 'http:' && url.hostname === 'localhost') return url.origin;
	return null;
};

/** Host permission patterns needed for a config. */
export const originPatterns = (c: SyncConfig): string[] => [
	`${c.wikiOrigin}/*`,
	`${c.appOrigin}/*`,
];

export const getConfig = async (): Promise<SyncConfig | null> => {
	const { [STORAGE_KEY]: value } = await chrome.storage.local.get(STORAGE_KEY);
	const c = value as Partial<SyncConfig> | undefined;
	if (!c?.wikiOrigin || !c?.appOrigin) return null;
	const wikiOrigin = toOrigin(c.wikiOrigin);
	const appOrigin = toOrigin(c.appOrigin);
	return wikiOrigin && appOrigin ? { wikiOrigin, appOrigin } : null;
};

export const setConfig = (c: SyncConfig) =>
	chrome.storage.local.set({ [STORAGE_KEY]: c });

export const hasPermissions = (c: SyncConfig) =>
	chrome.permissions.contains({ origins: originPatterns(c) });

export const clearConfig = () => chrome.storage.local.remove(STORAGE_KEY);
