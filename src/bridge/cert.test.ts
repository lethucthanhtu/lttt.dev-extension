import { beforeAll, describe, expect, it } from 'vitest';
import { isAppOrigin } from './config';
import { MATCHES } from './register';

type CertModule = typeof import('./cert');

let cert: CertModule;
let privateKey: CryptoKey;

const b64url = (data: ArrayBuffer | Uint8Array) =>
	Buffer.from(
		data instanceof Uint8Array ? data : new Uint8Array(data)
	).toString('base64url');

/** Sign a v4 certificate with the test key (same format as README). */
const sign = async (apps: unknown[], v = 4) => {
	const body = b64url(new TextEncoder().encode(JSON.stringify({ v, apps })));
	const sig = await crypto.subtle.sign(
		{ name: 'ECDSA', hash: 'SHA-256' },
		privateKey,
		new TextEncoder().encode(body)
	);
	return `${body}.${b64url(sig)}`;
};

beforeAll(async () => {
	const pair = await crypto.subtle.generateKey(
		{ name: 'ECDSA', namedCurve: 'P-256' },
		true,
		['sign', 'verify']
	);
	privateKey = pair.privateKey;
	// cert.ts reads the build-time constant once, at import.
	// Plain base64 SPKI DER, like EXTENSION_SIGNING_PUBLIC_KEY.
	(globalThis as Record<string, unknown>).__SIGNING_PUBLIC_KEY__ = Buffer.from(
		await crypto.subtle.exportKey('spki', pair.publicKey)
	).toString('base64');
	cert = await import('./cert');
});

describe('isAppOrigin', () => {
	it('accepts the apex and subdomains at any depth', () => {
		expect(isAppOrigin('https://lttt.dev')).toBe(true);
		expect(isAppOrigin('https://app.lttt.dev')).toBe(true);
		expect(isAppOrigin('https://a.b.lttt.dev')).toBe(true);
	});

	it('rejects other schemes, ports, look-alikes and non-origins', () => {
		for (const origin of [
			'http://lttt.dev',
			'https://lttt.dev:8443',
			'https://lttt.dev/',
			'https://xlttt.dev',
			'https://lttt.dev.example.com',
			'https://example.com',
			'https://*.lttt.dev',
		]) {
			expect(isAppOrigin(origin), origin).toBe(false);
		}
	});
});

describe('content script matches', () => {
	it('covers the apex and its subdomains', () => {
		expect(MATCHES).toContain('https://lttt.dev/*');
		expect(MATCHES).toContain('https://*.lttt.dev/*');
	});
});

describe('certificate apps', () => {
	it('accepts the exact apex entry and lets the apex use it', async () => {
		const parsed = await cert.verifyCert(await sign(['https://lttt.dev']));
		expect(parsed).toEqual({ apps: ['https://lttt.dev'], wildcards: [] });
		expect(cert.certAllows(parsed!, 'https://lttt.dev')).toBe(true);
		expect(cert.certAllows(parsed!, 'https://app.lttt.dev')).toBe(false);
	});

	it('normalizes an apex entry with a path', async () => {
		const parsed = await cert.verifyCert(await sign(['https://lttt.dev/x']));
		expect(parsed?.apps).toEqual(['https://lttt.dev']);
	});

	it('does not let a wildcard match the apex', async () => {
		const parsed = await cert.verifyCert(await sign(['https://*.lttt.dev']));
		expect(parsed).toEqual({ apps: [], wildcards: ['lttt.dev'] });
		expect(cert.certAllows(parsed!, 'https://app.lttt.dev')).toBe(true);
		expect(cert.certAllows(parsed!, 'https://a.b.lttt.dev')).toBe(true);
		expect(cert.certAllows(parsed!, 'https://lttt.dev')).toBe(false);
	});

	it('allows the apex next to a wildcard when listed exactly', async () => {
		const parsed = await cert.verifyCert(
			await sign(['https://lttt.dev', 'https://*.lttt.dev'])
		);
		expect(cert.certAllows(parsed!, 'https://lttt.dev')).toBe(true);
		expect(cert.certAllows(parsed!, 'https://app.lttt.dev')).toBe(true);
	});

	it('rejects the whole certificate for a bad apex variant', async () => {
		for (const bad of [
			'http://lttt.dev',
			'https://lttt.dev:8443',
			'https://user@lttt.dev',
			'https://*lttt.dev',
		]) {
			const c = await sign(['https://app.lttt.dev', bad]);
			expect(await cert.verifyCert(c), bad).toBeNull();
		}
	});

	it('never lets other origins use an apex certificate', async () => {
		const parsed = await cert.verifyCert(await sign(['https://lttt.dev']));
		expect(cert.certAllows(parsed!, 'http://lttt.dev')).toBe(false);
		expect(cert.certAllows(parsed!, 'https://lttt.dev:8443')).toBe(false);
		expect(cert.certAllows(parsed!, 'https://example.com')).toBe(false);
	});

	it('still rejects old versions and bad signatures', async () => {
		expect(
			await cert.verifyCert(await sign(['https://lttt.dev'], 3))
		).toBeNull();
		const good = await sign(['https://lttt.dev']);
		const [body] = good.split('.');
		expect(await cert.verifyCert(`${body}.${'A'.repeat(86)}`)).toBeNull();
	});
});
