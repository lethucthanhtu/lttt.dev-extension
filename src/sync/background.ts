/**
 * Wiki.js session sync — service worker side (protocol v3).
 *
 * Reads the Wiki.js session cookie (`jwt`) of an allowed wiki origin and POSTs
 * it to the requesting web app, which verifies it and stores its own session.
 * The token is never logged, never stored and never returned to the page.
 *
 * A page is an allowed web app if either:
 * - v3: it sends a certificate signed with the project key (cert.ts) whose
 *   `apps` list the sender's origin. Its wiki is the certificate's `wiki`.
 *   No setup in the extension is needed.
 * - v1/v2: its origin is the web app configured in Options. Its wikis are the
 *   ones the user allowed there.
 * Any other page gets no reply at all.
 *
 * v2 adds two deferred flows; their state lives in chrome.storage.session
 * (origins and tab ids only) so it survives the service worker being stopped:
 * - PERMISSION_REQUESTED: the page asked for a wiki origin the user has not
 *   allowed yet. The options page opens prefilled; once the user allows it,
 *   the sync runs and the result is pushed to the app tabs (`synced`).
 * - LOGIN_STARTED: no `jwt` cookie, or the app rejected it. The wiki login
 *   page opens; when a new `jwt` cookie appears (within 10 min) it is POSTed
 *   and the result is pushed to the app tabs (`synced`).
 */
import {
	RUNTIME_PING,
	RUNTIME_SYNC,
	RUNTIME_SYNCED,
	getConfig,
	hasAppPermission,
	isConfigChange,
	isWikiGranted,
	pattern,
	toOrigin,
	type SyncConfig,
	type SyncErrorCode,
	type SyncResult,
} from './config';
import { verifyCert } from './cert';
import { syncContentScript } from './register';

const fail = (code: SyncErrorCode): SyncResult => ({ ok: false, code });

const PENDING_MS = 10 * 60 * 1000;
const LOGIN_KEY = 'wikijsSessionSync:pendingLogin';
const PERMISSION_KEY = 'wikijsSessionSync:pendingPermission';
type PendingKey = typeof LOGIN_KEY | typeof PERMISSION_KEY;
/** How the app was allowed: signed certificate (v3) or Options config. */
type Via = 'cert' | 'config';
type Pending = {
	appOrigin: string;
	wikiOrigin: string;
	via: Via;
	tabId?: number;
	expiresAt: number;
};

const getPending = async (key: PendingKey): Promise<Pending | null> => {
	const { [key]: p } = await chrome.storage.session.get(key);
	const pending = p as Pending | undefined;
	if (!pending) return null;
	if (pending.expiresAt < Date.now()) {
		await chrome.storage.session.remove(key);
		return null;
	}
	return pending;
};
const setPending = (key: PendingKey, p: Pending) =>
	chrome.storage.session.set({ [key]: p });
const clearPending = (key: PendingKey) => chrome.storage.session.remove(key);

/**
 * Run tasks one at a time, so overlapping syncs, cookie events and permission
 * grants cannot race on the pending state.
 */
let queue: Promise<unknown> = Promise.resolve();
const serial = <T>(task: () => Promise<T>): Promise<T> => {
	const run = queue.then(task);
	queue = run.catch(() => {});
	return run;
};

const readJwt = async (wikiOrigin: string) =>
	(await chrome.cookies.get({ url: `${wikiOrigin}/`, name: 'jwt' }))?.value ||
	null;

/** POST the token to the web app and map the response to a result. */
const postToken = async (
	appOrigin: string,
	token: string
): Promise<SyncResult> => {
	let res: Response;
	try {
		res = await fetch(`${appOrigin}/api/auth/token`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ token }),
			credentials: 'include',
			cache: 'no-store',
			// Never follow a redirect: a 307/308 would re-POST the token elsewhere.
			redirect: 'error',
			// The page gives up after 20 s; do not hold the sync queue longer.
			signal: AbortSignal.timeout(15_000),
		});
	} catch {
		return fail('FAILED');
	}
	if (res.status === 200) return { ok: true };
	if (res.status === 403) return fail('APP_FORBIDDEN');
	if (res.status === 401) {
		const code = await res
			.json()
			.then((b) => b?.error?.code)
			.catch(() => undefined);
		if (code === 'WIKI_UNAUTHORIZED' || code === 'INVALID_TOKEN') {
			return fail('REJECTED');
		}
	}
	return fail('FAILED');
};

/**
 * Focus an existing tab (navigating it to `url` if `navigate`), or open `url`
 * in a new active tab next to the requesting tab.
 */
const focusOrOpen = async (
	tabId: number | undefined,
	url: string,
	navigate: boolean,
	near?: chrome.tabs.Tab
): Promise<number | undefined> => {
	if (tabId !== undefined) {
		try {
			const tab = await chrome.tabs.update(tabId, {
				active: true,
				...(navigate ? { url } : {}),
			});
			if (tab?.windowId !== undefined) {
				await chrome.windows.update(tab.windowId, { focused: true });
			}
			return tabId;
		} catch {
			// tab was closed: open a new one
		}
	}
	if (near?.id !== undefined) {
		try {
			return (
				await chrome.tabs.create({
					url,
					active: true,
					windowId: near.windowId,
					openerTabId: near.id,
				})
			).id;
		} catch {
			// requesting tab or its window is gone: open without them
		}
	}
	return (await chrome.tabs.create({ url, active: true })).id;
};

/**
 * Open the tab for a pending flow. There is at most one tab per kind: if one
 * is still open it is reused (and navigated when the app or wiki differs), so
 * a page cannot flood the browser with tabs by sending many wiki URLs.
 */
const openPending = async (
	key: PendingKey,
	appOrigin: string,
	wikiOrigin: string,
	via: Via,
	url: string,
	near?: chrome.tabs.Tab
) => {
	const p = await getPending(key);
	const same = p?.appOrigin === appOrigin && p.wikiOrigin === wikiOrigin;
	const tabId = await focusOrOpen(p?.tabId, url, !same, near);
	// At most one pending entry per kind: the latest request wins.
	await setPending(key, {
		appOrigin,
		wikiOrigin,
		via,
		tabId,
		expiresAt: Date.now() + PENDING_MS,
	});
};

const startLogin = async (
	appOrigin: string,
	wikiOrigin: string,
	via: Via,
	near?: chrome.tabs.Tab
): Promise<SyncResult> => {
	await openPending(
		LOGIN_KEY,
		appOrigin,
		wikiOrigin,
		via,
		`${wikiOrigin}/login`,
		near
	);
	return fail('LOGIN_STARTED');
};

const requestPermission = async (
	appOrigin: string,
	wikiOrigin: string,
	near?: chrome.tabs.Tab
): Promise<SyncResult> => {
	const url = `${chrome.runtime.getURL('src/options/index.html')}?wiki=${encodeURIComponent(wikiOrigin)}`;
	await openPending(PERMISSION_KEY, appOrigin, wikiOrigin, 'config', url, near);
	return fail('PERMISSION_REQUESTED');
};

/**
 * Push the result of a deferred sync to every tab of the app. `appOrigin` lets
 * the content script drop it if the tab navigated elsewhere meanwhile.
 */
const broadcast = async (appOrigin: string, result: SyncResult) => {
	const tabs = await chrome.tabs.query({ url: pattern(appOrigin) });
	await Promise.all(
		tabs.map(
			(t) =>
				t.id === undefined
					? undefined
					: chrome.tabs
							.sendMessage(
								t.id,
								{ type: RUNTIME_SYNCED, appOrigin, result },
								{ frameId: 0 }
							)
							.catch(() => {}) // no content script in that tab
		)
	);
};

/**
 * The sync itself, after the sender checks. `wikiUrl` undefined = v1 page:
 * use the default wiki, and report NO_PERMISSION / NOT_LOGGED_IN / REJECTED
 * instead of starting the interactive flows.
 */
const runSync = async (
	config: SyncConfig,
	wikiUrl: unknown,
	near?: chrome.tabs.Tab
): Promise<SyncResult> => {
	if (!(await hasAppPermission(config))) return fail('NO_PERMISSION');

	const v2 = wikiUrl !== undefined;
	const wikiOrigin = v2 ? toOrigin(wikiUrl) : (config.wikiOrigins[0] ?? null);
	if (!wikiOrigin) return fail(v2 ? 'INVALID_WIKI_URL' : 'NOT_CONFIGURED');

	if (!(await isWikiGranted(config, wikiOrigin))) {
		return v2
			? requestPermission(config.appOrigin, wikiOrigin, near)
			: fail('NO_PERMISSION');
	}

	const token = await readJwt(wikiOrigin);
	if (!token) {
		return v2
			? startLogin(config.appOrigin, wikiOrigin, 'config', near)
			: fail('NOT_LOGGED_IN');
	}
	const result = await postToken(config.appOrigin, token);
	if (v2 && !result.ok && result.code === 'REJECTED') {
		return startLogin(config.appOrigin, wikiOrigin, 'config', near);
	}
	if (result.ok) await clearPending(LOGIN_KEY);
	return result;
};

const hasHost = (origin: string) =>
	chrome.permissions.contains({ origins: [pattern(origin)] });

/**
 * v3 sync for an app allowed by its certificate: the wiki comes from the
 * certificate and the token goes only to the sender's own origin. Host access
 * is required by the manifest, so there is no PERMISSION_REQUESTED here.
 */
const runCertSync = async (
	appOrigin: string,
	wikiOrigin: string,
	near?: chrome.tabs.Tab
): Promise<SyncResult> => {
	// Only false if the user withheld site access in the browser settings.
	if (!(await hasHost(appOrigin)) || !(await hasHost(wikiOrigin))) {
		return fail('NO_PERMISSION');
	}
	const token = await readJwt(wikiOrigin);
	if (!token) return startLogin(appOrigin, wikiOrigin, 'cert', near);
	const result = await postToken(appOrigin, token);
	if (!result.ok && result.code === 'REJECTED') {
		return startLogin(appOrigin, wikiOrigin, 'cert', near);
	}
	if (result.ok) await clearPending(LOGIN_KEY);
	return result;
};

type Allowed =
	| { via: 'cert'; appOrigin: string; wikiOrigin: string }
	| { via: 'config'; config: SyncConfig };

/**
 * Is the sender an allowed web app? Uses `sender.origin`, which the browser
 * sets (the page cannot fake it). null = not allowed: the page gets no reply.
 */
const allowedApp = async (
	message: { cert?: unknown },
	sender: chrome.runtime.MessageSender
): Promise<Allowed | null> => {
	// Only our own content script, in a tab's top-level frame.
	if (
		sender.id !== chrome.runtime.id ||
		!sender.tab ||
		sender.frameId !== 0 ||
		!sender.origin
	) {
		return null;
	}
	if (message.cert !== undefined) {
		const cert = await verifyCert(message.cert);
		if (cert?.apps.includes(sender.origin)) {
			return { via: 'cert', appOrigin: sender.origin, wikiOrigin: cert.wiki };
		}
	}
	const config = await getConfig();
	if (config && sender.origin === config.appOrigin) {
		return { via: 'config', config };
	}
	return null;
};

const handleSync = async (
	message: { wikiUrl?: unknown; cert?: unknown },
	sender: chrome.runtime.MessageSender
): Promise<SyncResult | null> => {
	// An error while checking must not answer an unverified page (not even FAILED).
	const app = await allowedApp(message, sender).catch(() => null);
	if (!app) return null;
	return app.via === 'cert'
		? runCertSync(app.appOrigin, app.wikiOrigin, sender.tab)
		: runSync(app.config, message.wikiUrl, sender.tab);
};

/** Does a cookie apply to the wiki origin's host? */
const cookieMatches = (cookie: chrome.cookies.Cookie, wikiOrigin: string) => {
	const host = new URL(wikiOrigin).hostname.toLowerCase();
	const domain = cookie.domain.replace(/^\./, '').toLowerCase();
	return host === domain || (!cookie.hostOnly && host.endsWith(`.${domain}`));
};

/** A `jwt` cookie was set: finish a pending login. */
const onJwtCookie = async (cookie: chrome.cookies.Cookie) => {
	const p = await getPending(LOGIN_KEY);
	if (!p || !cookieMatches(cookie, p.wikiOrigin)) return;

	if (p.via === 'cert') {
		// The certificate was checked when the login started.
		if (!(await hasHost(p.appOrigin)) || !(await hasHost(p.wikiOrigin))) {
			await clearPending(LOGIN_KEY);
			await broadcast(p.appOrigin, fail('NO_PERMISSION'));
			return;
		}
		await finishLogin(p.appOrigin, p.wikiOrigin);
		return;
	}

	const config = await getConfig();
	if (!config || config.appOrigin !== p.appOrigin) {
		await clearPending(LOGIN_KEY); // configuration changed meanwhile
		return;
	}
	if (
		!(await hasAppPermission(config)) ||
		!(await isWikiGranted(config, p.wikiOrigin))
	) {
		await clearPending(LOGIN_KEY);
		await broadcast(config.appOrigin, fail('NO_PERMISSION'));
		return;
	}
	await finishLogin(config.appOrigin, p.wikiOrigin);
};

/** POST the new wiki session of a pending login and push the result. */
const finishLogin = async (appOrigin: string, wikiOrigin: string) => {
	// Read through cookies.get so the cookie that applies to the wiki URL wins.
	const token = await readJwt(wikiOrigin);
	if (!token) return;
	const result = await postToken(appOrigin, token);
	// Still rejected (e.g. a cookie set before the user finished logging in):
	// keep waiting for the next cookie until the pending login expires.
	if (!result.ok && result.code === 'REJECTED') return;
	await clearPending(LOGIN_KEY);
	await broadcast(appOrigin, result);
};

/** The user may have just allowed a requested wiki origin: run that sync. */
const resumePermission = async () => {
	const p = await getPending(PERMISSION_KEY);
	if (!p) return;
	const config = await getConfig();
	if (!config || config.appOrigin !== p.appOrigin) {
		await clearPending(PERMISSION_KEY);
		return;
	}
	if (
		!(await hasAppPermission(config)) ||
		!(await isWikiGranted(config, p.wikiOrigin))
	) {
		return; // not allowed (yet)
	}
	await clearPending(PERMISSION_KEY);
	// Broadcast every result, including LOGIN_STARTED (a login tab opened; the
	// login flow sends another `synced` when it finishes).
	await broadcast(config.appOrigin, await runSync(config, p.wikiOrigin));
};

export const initSessionSync = () => {
	chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
		if (message?.type === RUNTIME_PING) {
			allowedApp(message, sender)
				.catch(() => null)
				.then((app) => sendResponse(app ? { ok: true } : null));
			return true; // async response
		}
		if (message?.type !== RUNTIME_SYNC) return false;
		serial(() => handleSync(message, sender))
			.catch((): SyncResult => fail('FAILED'))
			.then(sendResponse);
		return true; // async response
	});

	chrome.cookies.onChanged.addListener(({ removed, cookie }) => {
		if (removed || cookie.name !== 'jwt') return;
		serial(() => onJwtCookie(cookie)).catch(() => {});
	});

	const resume = () => {
		serial(resumePermission).catch(() => {});
	};
	chrome.storage.onChanged.addListener((changes, area) => {
		if (area === 'local' && isConfigChange(changes)) resume();
	});

	// Keep the dynamic content script in line with the stored config and the
	// granted permissions.
	const resync = () => {
		syncContentScript().catch(() => {});
	};
	chrome.runtime.onInstalled.addListener(resync);
	chrome.runtime.onStartup.addListener(resync);
	chrome.permissions.onRemoved.addListener(resync);
	chrome.permissions.onAdded.addListener(() => {
		resync();
		resume();
	});
};
