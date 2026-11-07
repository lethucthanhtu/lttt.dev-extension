/**
 * Bridge — shared constants and types (background, content script, extension
 * pages).
 *
 * A web app on `https://*.lttt.dev` with a signed certificate (cert.ts) may ask
 * the extension to read cookies of, or fetch data from, another https site (the
 * source) with the user's session there, and get the data back. The
 * certificate only proves the app may talk to the extension; the source comes
 * from each request, and the user approves every (app, source) pair once.
 */

/** Page → extension message source (posted by the web app). */
export const PAGE_SOURCE = 'lttt-bridge';
/** Extension → page message source (posted by the content script). */
export const EXT_SOURCE = 'lttt-bridge-ext';
/** Content script → background: may this page see the extension? */
export const RUNTIME_PING = 'lttt-bridge:ping';
/** Content script → background: run a request. */
export const RUNTIME_REQUEST = 'lttt-bridge:request';
/** Background → content script: a deferred reply for one request. */
export const RUNTIME_DELIVER = 'lttt-bridge:deliver';
/** Consent page → background: the user's answer. */
export const RUNTIME_CONSENT = 'lttt-bridge:consent';
export const PROTOCOL_VERSION = 5;

/** Web apps must be served from a subdomain of this domain. */
export const APP_DOMAIN = 'lttt.dev';

/** Storage keys. */
export const GRANTS_KEY = 'ltttBridge:grants'; // chrome.storage.local
export const CONSENTS_KEY = 'ltttBridge:consents'; // chrome.storage.session
export const LOGIN_KEY = 'ltttBridge:login'; // chrome.storage.session

/** Extension pages. */
export const CONSENT_PAGE = 'src/consent/index.html';

export type ErrorCode =
	| 'BAD_REQUEST'
	| 'DENIED'
	| 'NO_PERMISSION'
	| 'CANCELLED'
	| 'FAILED';
export type PendingCode = 'CONSENT_REQUIRED' | 'LOGIN_STARTED';

/** One thing to get from the source. */
export type GetItem =
	| { type: 'cookie'; name: string }
	| { type: 'cookies' }
	| {
			type: 'fetch';
			url: string;
			method: string;
			headers: Record<string, string>;
			body?: string;
	  };

export type ItemResult =
	| { value: string | null }
	| { cookies: Record<string, string> }
	| { status: number; contentType: string | null; body: string }
	| { error: 'FAILED' | 'TOO_LARGE' };

/** A validated request. */
export type BridgeRequest = {
	source: string;
	get: GetItem[];
	/** Make sure the user is logged in to the source first. */
	session?: { cookie: string; loginUrl: string; relogin: boolean };
};

export type Result =
	| { ok: true; data: ItemResult[] }
	| { ok: false; code: ErrorCode };

/** What the background answers a request with (immediately or later). */
export type Reply =
	| { kind: 'result'; result: Result }
	| { kind: 'pending'; code: PendingCode };

/** User decisions per app origin, then per source origin. */
export type Grants = Record<string, Record<string, { allow: boolean; at: number }>>;

/** A consent waiting for the user (chrome.storage.session, by consent id). */
export type Consent = {
	appOrigin: string;
	source: string;
	/** Tab of the consent window. */
	tabId?: number;
	expiresAt: number;
};

/** Longest URL accepted. */
export const MAX_URL_LENGTH = 2048;
/** Longest app certificate accepted from a page. */
export const MAX_CERT_LENGTH = 4096;

/** RFC 6265 cookie-name token. */
export const COOKIE_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]{1,128}$/;

/**
 * Parse a URL into an https origin (https://<host>[:port]); rejects other
 * schemes and credentials. Returns null otherwise.
 */
export const toOrigin = (input: unknown): string | null => {
	if (typeof input !== 'string' || input.length > MAX_URL_LENGTH) return null;
	let url: URL;
	try {
		url = new URL(input.trim());
	} catch {
		return null;
	}
	// `*` is a valid URL host character, but never part of a real origin.
	if (url.username || url.password || url.hostname.includes('*')) return null;
	return url.protocol === 'https:' && url.hostname ? url.origin : null;
};

/**
 * Is `origin` an exact https origin on the default port whose host is a
 * subdomain (any depth) of APP_DOMAIN? Applied to the browser-provided sender
 * origin and to every app listed in a certificate.
 */
export const isAppOrigin = (origin: string): boolean => {
	let url: URL;
	try {
		url = new URL(origin);
	} catch {
		return false;
	}
	return (
		url.protocol === 'https:' &&
		!url.port &&
		url.origin === origin &&
		!url.hostname.includes('*') &&
		url.hostname.endsWith(`.${APP_DOMAIN}`)
	);
};

export const pattern = (origin: string) => `${origin}/*`;
