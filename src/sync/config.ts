/**
 * Wiki.js session sync — shared config (used by the options page, the
 * background service worker and the content script).
 *
 * Only origins are stored (no tokens). No host is hard-coded: the user enters
 * the web app URL (required) and optionally a Wiki.js URL on the options page,
 * and grants host permissions for exactly those origins at runtime. More wiki
 * origins can be added later when the web app asks for one (protocol v2,
 * `PERMISSION_REQUESTED`).
 */
export type SyncConfig = {
	appOrigin: string;
	/**
	 * Wiki origins the user allowed. A wiki is usable only if it is listed here
	 * AND its host permission is granted. The first one is the default for
	 * pages that send no `wikiUrl` (protocol v1).
	 */
	wikiOrigins: string[];
};

/** Page → extension message source (posted by the web app). */
export const PAGE_SOURCE = 'wikijs-session-sync';
/** Extension → page message source (posted by the content script). */
export const EXT_SOURCE = 'wikijs-session-sync-ext';
/** Content script → background: run a sync. */
export const RUNTIME_SYNC = 'wikijs-session-sync:sync';
/** Background → content scripts: a deferred sync finished. */
export const RUNTIME_SYNCED = 'wikijs-session-sync:synced';
export const PROTOCOL_VERSION = 2;

export type SyncErrorCode =
	| 'NOT_CONFIGURED'
	| 'NO_PERMISSION'
	| 'NOT_LOGGED_IN'
	| 'REJECTED'
	| 'APP_FORBIDDEN'
	| 'FORBIDDEN_ORIGIN'
	| 'FAILED'
	// v2
	| 'INVALID_WIKI_URL'
	| 'PERMISSION_REQUESTED'
	| 'LOGIN_STARTED';

export type SyncResult = { ok: true } | { ok: false; code: SyncErrorCode };

/** Longest `wikiUrl` accepted from a page. */
export const MAX_URL_LENGTH = 2048;

const STORAGE_KEY = 'wikijsSessionSync';
export const isConfigChange = (changes: Record<string, unknown>) =>
	STORAGE_KEY in changes;

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
	if (url.protocol === 'http:' && url.hostname === 'localhost') return url.origin;
	return null;
};

export const pattern = (origin: string) => `${origin}/*`;

/** Host permission patterns for a whole config. */
export const originPatterns = (c: SyncConfig): string[] => [
	pattern(c.appOrigin),
	...c.wikiOrigins.map(pattern),
];

const unique = (xs: string[]) => [...new Set(xs)];

export const getConfig = async (): Promise<SyncConfig | null> => {
	const { [STORAGE_KEY]: value } = await chrome.storage.local.get(STORAGE_KEY);
	const c = value as
		| { appOrigin?: unknown; wikiOrigins?: unknown; wikiOrigin?: unknown }
		| undefined;
	const appOrigin = toOrigin(c?.appOrigin);
	if (!appOrigin) return null;
	// v1 stored a single `wikiOrigin`.
	const raw = Array.isArray(c?.wikiOrigins) ? c.wikiOrigins : [c?.wikiOrigin];
	const wikiOrigins = unique(
		raw.map(toOrigin).filter((o): o is string => o !== null)
	);
	return { appOrigin, wikiOrigins };
};

export const setConfig = (c: SyncConfig) =>
	chrome.storage.local.set({
		[STORAGE_KEY]: { appOrigin: c.appOrigin, wikiOrigins: unique(c.wikiOrigins) },
	});

export const clearConfig = () => chrome.storage.local.remove(STORAGE_KEY);

/** Host permission for the web app (needed for the content script and POST). */
export const hasAppPermission = (c: SyncConfig) =>
	chrome.permissions.contains({ origins: [pattern(c.appOrigin)] });

/** A wiki origin may be read only if the user listed it and granted access. */
export const isWikiGranted = async (c: SyncConfig, wikiOrigin: string) =>
	c.wikiOrigins.includes(wikiOrigin) &&
	(await chrome.permissions.contains({ origins: [pattern(wikiOrigin)] }));
