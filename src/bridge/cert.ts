/**
 * Bridge — web app certificates.
 *
 * The certificate is only a key: it proves that a web app may talk to the
 * extension. It says nothing about which sites the app may read (each request
 * names its source, and the user approves it). Signed with a private key that
 * never enters this repo:
 *
 *   cert = base64url(payload JSON) + "." + base64url(signature)
 *   payload = { "v": 4, "apps": ["https://app.lttt.dev", "https://*.lttt.dev", …] }
 *
 * Every app must be on APP_DOMAIN (config.ts): an exact origin
 * `https://<sub>.lttt.dev`, or a wildcard `https://*.lttt.dev` /
 * `https://*.<sub>.lttt.dev` matching subdomains at any depth on the default
 * port. One invalid entry invalidates the whole certificate.
 *
 * The signature is ECDSA P-256 / SHA-256 in IEEE-P1363 form (64 bytes, r||s)
 * over the ASCII bytes of the first part. Only the background verifies certs;
 * the caller must still check the sender's origin with `certAllows`.
 */
import { APP_DOMAIN, MAX_CERT_LENGTH, isAppOrigin, toOrigin } from './config';

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
	/** Wildcard base domains: `lttt.dev` for `https://*.lttt.dev`. */
	wildcards: string[];
};

const WILDCARD = /^https:\/\/\*\.([a-z0-9-]+(?:\.[a-z0-9-]+)+)$/;

/** `https://*.lttt.dev` → `lttt.dev`, or null if not a valid app wildcard. */
const toWildcard = (input: unknown): string | null => {
	if (typeof input !== 'string') return null;
	const base = WILDCARD.exec(input.trim().toLowerCase())?.[1];
	if (!base || (base !== APP_DOMAIN && !base.endsWith(`.${APP_DOMAIN}`))) {
		return null;
	}
	try {
		// Reject anything the URL parser would rewrite (bad labels, IPs).
		return new URL(`https://${base}`).hostname === base ? base : null;
	} catch {
		return null;
	}
};

/** May the page at `origin` (the browser-provided sender origin) use `cert`? */
export const certAllows = (cert: AppCert, origin: string): boolean => {
	if (!isAppOrigin(origin)) return false;
	if (cert.apps.includes(origin)) return true;
	const host = new URL(origin).hostname;
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
	const { v, apps } = payload as Record<string, unknown>;
	if (
		v !== 4 ||
		!Array.isArray(apps) ||
		!apps.length ||
		apps.length > MAX_APPS
	) {
		return null;
	}
	const origins: string[] = [];
	const wildcards: string[] = [];
	for (const entry of apps) {
		const base = toWildcard(entry);
		const origin = base ? null : toOrigin(entry);
		if (base) wildcards.push(base);
		else if (origin && isAppOrigin(origin)) origins.push(origin);
		else return null; // one bad entry invalidates the whole certificate
	}
	return {
		apps: [...new Set(origins)],
		wildcards: [...new Set(wildcards)],
	};
};

/** Verification results per certificate string (also failures, so junk is cheap). */
const cache = new Map<string, Promise<AppCert | null>>();

/**
 * Verify a certificate sent by a page. Returns its apps, or null if it
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
