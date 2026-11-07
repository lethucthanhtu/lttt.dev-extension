/**
 * Bridge — request parsing and execution.
 *
 * A page request (all fields come from the page, so all are checked):
 *
 *   {
 *     source: "https://accounts.example.com",      // https origin to read from
 *     get: [
 *       { type: "cookie", name: "session" },        // → { value: string | null }
 *       { type: "cookies" },                        // → { cookies: { name: value } }
 *       { type: "fetch", url: "/api/me",            // → { status, contentType, body }
 *         method?: "GET", headers?: {…}, body?: "…" }
 *     ],
 *     session?: { cookie: "session", login?: "/login", relogin?: false }
 *   }
 *
 * Every `fetch` URL must stay on `source`. `session` makes the extension open
 * the login page (on `source`) first when that cookie is missing, or always
 * when `relogin` is true (the app rejected the session it got).
 */
import {
	COOKIE_NAME,
	MAX_URL_LENGTH,
	toOrigin,
	type BridgeRequest,
	type GetItem,
	type ItemResult,
} from './config';

const MAX_ITEMS = 16;
const MAX_HEADERS = 32;
const MAX_HEADER_LENGTH = 8192;
const MAX_REQUEST_BODY = 1024 * 1024;
const MAX_RESPONSE_BODY = 5 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 15_000;
const METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'];
const HEADER_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]{1,128}$/;
const DEFAULT_LOGIN = '/login';

const isRecord = (v: unknown): v is Record<string, unknown> =>
	!!v && typeof v === 'object' && !Array.isArray(v);

/** Resolve a path or URL on `source`; null if it leaves it. */
const onSource = (input: unknown, source: string): string | null => {
	if (
		typeof input !== 'string' ||
		!input ||
		input.length > MAX_URL_LENGTH ||
		input.includes('\\')
	) {
		return null;
	}
	try {
		const url = new URL(input, `${source}/`);
		return url.origin === source && !url.username && !url.password
			? url.href
			: null;
	} catch {
		return null;
	}
};

const parseHeaders = (input: unknown): Record<string, string> | null => {
	if (input === undefined) return {};
	if (!isRecord(input)) return null;
	const entries = Object.entries(input);
	if (entries.length > MAX_HEADERS) return null;
	const headers: Record<string, string> = {};
	for (const [name, value] of entries) {
		if (
			!HEADER_NAME.test(name) ||
			typeof value !== 'string' ||
			value.length > MAX_HEADER_LENGTH ||
			/[\r\n\0]/.test(value)
		) {
			return null;
		}
		headers[name] = value;
	}
	return headers;
};

const parseItem = (input: unknown, source: string): GetItem | null => {
	if (!isRecord(input)) return null;
	switch (input.type) {
		case 'cookie':
			return typeof input.name === 'string' && COOKIE_NAME.test(input.name)
				? { type: 'cookie', name: input.name }
				: null;
		case 'cookies':
			return { type: 'cookies' };
		case 'fetch': {
			const url = onSource(input.url, source);
			const method =
				input.method === undefined
					? 'GET'
					: typeof input.method === 'string'
						? input.method.toUpperCase()
						: '';
			const headers = parseHeaders(input.headers);
			const { body } = input;
			if (!url || !METHODS.includes(method) || !headers) return null;
			if (body !== undefined) {
				if (
					typeof body !== 'string' ||
					body.length > MAX_REQUEST_BODY ||
					method === 'GET' ||
					method === 'HEAD'
				) {
					return null;
				}
				return { type: 'fetch', url, method, headers, body };
			}
			return { type: 'fetch', url, method, headers };
		}
		default:
			return null;
	}
};

/** Validate a page request; null if anything is off. */
export const parseRequest = (input: unknown): BridgeRequest | null => {
	if (!isRecord(input)) return null;
	const source = toOrigin(input.source);
	// An origin exactly, not a URL with a path.
	if (!source || source !== input.source) return null;
	const { get, session } = input;
	if (!Array.isArray(get) || !get.length || get.length > MAX_ITEMS) return null;
	const items: GetItem[] = [];
	for (const entry of get) {
		const item = parseItem(entry, source);
		if (!item) return null;
		items.push(item);
	}
	const request: BridgeRequest = { source, get: items };
	if (session !== undefined) {
		if (!isRecord(session)) return null;
		const { cookie, login, relogin } = session;
		if (typeof cookie !== 'string' || !COOKIE_NAME.test(cookie)) return null;
		if (relogin !== undefined && typeof relogin !== 'boolean') return null;
		const path = login ?? DEFAULT_LOGIN;
		const loginUrl =
			typeof path === 'string' && path.startsWith('/') && !path.startsWith('//')
				? onSource(path, source)
				: null;
		if (!loginUrl) return null;
		request.session = { cookie, loginUrl, relogin: relogin === true };
	}
	return request;
};

export const readCookie = async (source: string, name: string) =>
	(await chrome.cookies.get({ url: `${source}/`, name }))?.value ?? null;

const readCookies = async (source: string) => {
	const cookies: Record<string, string> = {};
	for (const c of await chrome.cookies.getAll({ url: `${source}/` })) {
		// getAll lists the most specific cookie first; keep that one.
		if (!(c.name in cookies)) cookies[c.name] = c.value;
	}
	return cookies;
};

/** Read a response body as text, up to MAX_RESPONSE_BODY bytes. */
const readBody = async (res: Response): Promise<string | null> => {
	const length = Number(res.headers.get('content-length'));
	if (length > MAX_RESPONSE_BODY) return null;
	if (!res.body) return '';
	const reader = res.body.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		size += value.byteLength;
		if (size > MAX_RESPONSE_BODY) {
			await reader.cancel().catch(() => {});
			return null;
		}
		chunks.push(value);
	}
	const all = new Uint8Array(size);
	let offset = 0;
	for (const c of chunks) {
		all.set(c, offset);
		offset += c.byteLength;
	}
	return new TextDecoder().decode(all);
};

const runFetch = async (
	item: Extract<GetItem, { type: 'fetch' }>
): Promise<ItemResult> => {
	let res: Response;
	try {
		res = await fetch(item.url, {
			method: item.method,
			headers: item.headers,
			body: item.body,
			credentials: 'include',
			cache: 'no-store',
			// Never follow a redirect: it could leave the approved source.
			redirect: 'error',
			signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
		});
	} catch {
		return { error: 'FAILED' };
	}
	try {
		const body = await readBody(res);
		if (body === null) return { error: 'TOO_LARGE' };
		return {
			status: res.status,
			contentType: res.headers.get('content-type'),
			body,
		};
	} catch {
		return { error: 'FAILED' };
	}
};

/** Get every item, in order. One failed item does not fail the others. */
export const execute = (request: BridgeRequest): Promise<ItemResult[]> =>
	Promise.all(
		request.get.map(async (item): Promise<ItemResult> => {
			try {
				switch (item.type) {
					case 'cookie':
						return { value: await readCookie(request.source, item.name) };
					case 'cookies':
						return { cookies: await readCookies(request.source) };
					case 'fetch':
						return await runFetch(item);
				}
			} catch {
				return { error: 'FAILED' };
			}
		})
	);
