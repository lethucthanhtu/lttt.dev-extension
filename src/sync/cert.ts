/**
 * Wiki.js session sync — web app certificates (protocol v3).
 *
 * A web app proves it may use the sync by sending a certificate signed with a
 * private key that never enters this repo:
 *
 *   cert = base64url(payload JSON) + "." + base64url(signature)
 *   payload = { "v": 1, "apps": ["https://app.example.com", …], "wiki": "https://wiki.example.com" }
 *
 * Version 2 also accepts wildcard entries in `apps`, `https://*.example.com`:
 * any https origin on the default port whose host is a subdomain of
 * example.com (at any depth, not example.com itself). The base domain needs
 * at least two labels, so `https://*.com` is rejected.
 *
 * The signature is ECDSA P-256 / SHA-256 in IEEE-P1363 form (64 bytes, r||s)
 * over the ASCII bytes of the first part. Only the background verifies certs;
 * the caller must still check the sender's origin with `certAllows`.
 */
import { MAX_CERT_LENGTH, toOrigin } from './config';

declare const __SIGNING_PUBLIC_KEY__: string;

/** Default verification key (base64 SPKI DER). Forks override it at build time. */
const DEFAULT_SIGNING_PUBLIC_KEY =
	'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEsLW5PlAKA1xbGe68LWr8tduSo0lxBCFxAikQhetFzs3t9zkWQe5iq14gHsVEkNrB7xqokPTBVKvHHvHj/fp9Ww==';

const SIGNING_PUBLIC_KEY = __SIGNING_PUBLIC_KEY__ || DEFAULT_SIGNING_PUBLIC_KEY;

const MAX_APPS = 32;
const MAX_CACHED = 64;

export type AppCert = {
	/** Exact app origins. */
	apps: string[];
	/** Wildcard base domains (v2): `example.com` for `https://*.example.com`. */
	wildcards: string[];
	wiki: string;
};

const WILDCARD = /^https:\/\/\*\.([a-z0-9-]+(?:\.[a-z0-9-]+)+)$/;

/** `https://*.example.com` → `example.com`, or null if not a valid wildcard. */
const toWildcard = (input: unknown): string | null => {
	if (typeof input !== 'string') return null;
	const base = WILDCARD.exec(input.trim().toLowerCase())?.[1];
	if (!base || /^[0-9]+$/.test(base.split('.').pop()!)) return null;
	try {
		// Reject anything the URL parser would rewrite (bad labels, IPs).
		return new URL(`https://${base}`).hostname === base ? base : null;
	} catch {
		return null;
	}
};

/** May the page at `origin` (the browser-provided sender origin) use `cert`? */
export const certAllows = (cert: AppCert, origin: string): boolean => {
	if (cert.apps.includes(origin)) return true;
	if (!cert.wildcards.length) return false;
	let url: URL;
	try {
		url = new URL(origin);
	} catch {
		return false;
	}
	if (url.protocol !== 'https:' || url.port || url.origin !== origin) {
		return false;
	}
	const host = url.hostname;
	return cert.wildcards.some((base) => host.endsWith(`.${base}`));
};

const bytes = (binary: string) =>
	Uint8Array.from(binary, (c) => c.charCodeAt(0));

/** Strict base64url (no padding, no other characters). Throws if invalid. */
const fromBase64Url = (s: string) => {
	if (!/^[A-Za-z0-9_-]*$/.test(s) || s.length % 4 === 1) {
		throw new Error('bad base64url');
	}
	return bytes(atob(s.replace(/-/g, '+').replace(/_/g, '/')));
};

let key: Promise<CryptoKey> | null = null;
const getKey = () =>
	(key ??= crypto.subtle.importKey(
		'spki',
		bytes(atob(SIGNING_PUBLIC_KEY)),
		{ name: 'ECDSA', namedCurve: 'P-256' },
		false,
		['verify']
	));

const parse = async (cert: string): Promise<AppCert | null> => {
	const parts = cert.split('.');
	if (parts.length !== 2 || !parts[0]) return null;
	const [body, sigPart] = parts;
	const sig = fromBase64Url(sigPart);
	if (sig.length !== 64) return null;
	const valid = await crypto.subtle.verify(
		{ name: 'ECDSA', hash: 'SHA-256' },
		await getKey(),
		sig,
		new TextEncoder().encode(body)
	);
	if (!valid) return null;

	const payload: unknown = JSON.parse(
		new TextDecoder('utf-8', { fatal: true }).decode(fromBase64Url(body))
	);
	if (!payload || typeof payload !== 'object') return null;
	const { v, apps, wiki } = payload as Record<string, unknown>;
	if (
		(v !== 1 && v !== 2) ||
		!Array.isArray(apps) ||
		!apps.length ||
		apps.length > MAX_APPS
	) {
		return null;
	}
	const wikiOrigin = toOrigin(wiki);
	if (!wikiOrigin) return null;
	const origins: string[] = [];
	const wildcards: string[] = [];
	for (const entry of apps) {
		const base = v === 2 ? toWildcard(entry) : null;
		const origin = base ? null : toOrigin(entry);
		if (base) wildcards.push(base);
		else if (origin) origins.push(origin);
		else return null; // one bad entry invalidates the whole certificate
	}
	return {
		apps: [...new Set(origins)],
		wildcards: [...new Set(wildcards)],
		wiki: wikiOrigin,
	};
};

/** Verification results per certificate string (also failures, so junk is cheap). */
const cache = new Map<string, Promise<AppCert | null>>();

/**
 * Verify a certificate sent by a page. Returns its apps and wiki, or null if it
 * is missing, oversized, malformed, badly signed or has an invalid payload.
 */
export const verifyCert = (cert: unknown): Promise<AppCert | null> => {
	if (typeof cert !== 'string' || !cert || cert.length > MAX_CERT_LENGTH) {
		return Promise.resolve(null);
	}
	const hit = cache.get(cert);
	if (hit) return hit;
	const result = parse(cert).catch(() => null);
	cache.set(cert, result);
	if (cache.size > MAX_CACHED) {
		cache.delete(cache.keys().next().value as string);
	}
	return result;
};
