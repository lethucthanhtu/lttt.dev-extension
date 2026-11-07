/**
 * Wiki.js session sync — web app certificates (protocol v3).
 *
 * A web app proves it may use the sync by sending a certificate signed with a
 * private key that never enters this repo:
 *
 *   cert = base64url(payload JSON) + "." + base64url(signature)
 *   payload = { "v": 1, "apps": ["https://app.example.com", …], "wiki": "https://wiki.example.com" }
 *
 * The signature is ECDSA P-256 / SHA-256 in IEEE-P1363 form (64 bytes, r||s)
 * over the ASCII bytes of the first part. Only the background verifies certs;
 * the caller must still check that the sender's origin is in `apps`.
 */
import { MAX_CERT_LENGTH, toOrigin } from './config';

declare const __SIGNING_PUBLIC_KEY__: string;

/** Default verification key (base64 SPKI DER). Forks override it at build time. */
const DEFAULT_SIGNING_PUBLIC_KEY =
	'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEsLW5PlAKA1xbGe68LWr8tduSo0lxBCFxAikQhetFzs3t9zkWQe5iq14gHsVEkNrB7xqokPTBVKvHHvHj/fp9Ww==';

const SIGNING_PUBLIC_KEY = __SIGNING_PUBLIC_KEY__ || DEFAULT_SIGNING_PUBLIC_KEY;

const MAX_APPS = 32;
const MAX_CACHED = 64;

export type AppCert = { apps: string[]; wiki: string };

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
		v !== 1 ||
		!Array.isArray(apps) ||
		!apps.length ||
		apps.length > MAX_APPS
	) {
		return null;
	}
	const appOrigins = apps.map(toOrigin);
	const wikiOrigin = toOrigin(wiki);
	if (!wikiOrigin || appOrigins.some((o) => o === null)) return null;
	return { apps: [...new Set(appOrigins as string[])], wiki: wikiOrigin };
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
