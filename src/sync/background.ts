/**
 * Wiki.js session sync — service worker side (protocol v3).
 *
 * Reads the Wiki.js session cookie (`jwt`) of an allowed wiki origin and POSTs
 * it to the requesting web app, which verifies it and stores its own session.
 * The token is never logged, never stored and never returned to the page.
 *
 * A page is an allowed web app only if it sends a certificate signed with the
 * project key (cert.ts) whose `apps` list the sender's origin. Its wiki is the
 * certificate's `wiki`. No setup in the extension is needed. Any other page
 * gets no reply at all.
 *
 * LOGIN_STARTED is a deferred flow; its state lives in chrome.storage.session
 * (origins and a tab id only) so it survives the service worker being stopped:
 * with no `jwt` cookie, or when the app rejected it, the wiki login page opens;
 * when a new `jwt` cookie appears (within 10 min) it is POSTed and the result
 * is pushed to the app tabs (`synced`).
 */
import {
	RUNTIME_PING,
	RUNTIME_SYNC,
	RUNTIME_SYNCED,
	pattern,
	type SyncErrorCode,
	type SyncResult,
} from './config';
import { verifyCert } from './cert';
import { syncContentScript } from './register';

const fail = (code: SyncErrorCode): SyncResult => ({ ok: false, code });

const PENDING_MS = 10 * 60 * 1000;
const LOGIN_KEY = 'wikijsSessionSync:pendingLogin';
type Pending = {
	appOrigin: string;
	wikiOrigin: string;
	tabId?: number;
	expiresAt: number;
};

const getPending = async (): Promise<Pending | null> => {
	const { [LOGIN_KEY]: p } = await chrome.storage.session.get(LOGIN_KEY);
	const pending = p as Pending | undefined;
	if (!pending) return null;
	if (pending.expiresAt < Date.now()) {
		await chrome.storage.session.remove(LOGIN_KEY);
		return null;
	}
	return pending;
};
const setPending = (p: Pending) =>
	chrome.storage.session.set({ [LOGIN_KEY]: p });
const clearPending = () => chrome.storage.session.remove(LOGIN_KEY);

/**
 * Run tasks one at a time, so overlapping syncs and cookie events cannot race
 * on the pending state.
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
 * Open the wiki login page. There is at most one login tab: if one is still
 * open it is reused (and navigated when the app or wiki differs), so a page
 * cannot flood the browser with tabs.
 */
const startLogin = async (
	appOrigin: string,
	wikiOrigin: string,
	near?: chrome.tabs.Tab
): Promise<SyncResult> => {
	const p = await getPending();
	const same = p?.appOrigin === appOrigin && p.wikiOrigin === wikiOrigin;
	const tabId = await focusOrOpen(
		p?.tabId,
		`${wikiOrigin}/login`,
		!same,
		near
	);
	// At most one pending login: the latest request wins.
	await setPending({
		appOrigin,
		wikiOrigin,
		tabId,
		expiresAt: Date.now() + PENDING_MS,
	});
	return fail('LOGIN_STARTED');
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

const hasHost = (origin: string) =>
	chrome.permissions.contains({ origins: [pattern(origin)] });

/** Only false if the user withheld site access in the browser settings. */
const hasAccess = async (appOrigin: string, wikiOrigin: string) =>
	(await hasHost(appOrigin)) && (await hasHost(wikiOrigin));

/**
 * The sync itself, after the sender checks: the wiki comes from the
 * certificate and the token goes only to the sender's own origin.
 */
const runSync = async (
	appOrigin: string,
	wikiOrigin: string,
	near?: chrome.tabs.Tab
): Promise<SyncResult> => {
	if (!(await hasAccess(appOrigin, wikiOrigin))) return fail('NO_PERMISSION');
	const token = await readJwt(wikiOrigin);
	if (!token) return startLogin(appOrigin, wikiOrigin, near);
	const result = await postToken(appOrigin, token);
	if (!result.ok && result.code === 'REJECTED') {
		return startLogin(appOrigin, wikiOrigin, near);
	}
	if (result.ok) await clearPending();
	return result;
};

type Allowed = { appOrigin: string; wikiOrigin: string };

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
	const cert = await verifyCert(message.cert);
	if (!cert?.apps.includes(sender.origin)) return null;
	return { appOrigin: sender.origin, wikiOrigin: cert.wiki };
};

const handleSync = async (
	message: { cert?: unknown },
	sender: chrome.runtime.MessageSender
): Promise<SyncResult | null> => {
	// An error while checking must not answer an unverified page (not even FAILED).
	const app = await allowedApp(message, sender).catch(() => null);
	if (!app) return null;
	return runSync(app.appOrigin, app.wikiOrigin, sender.tab);
};

/** Does a cookie apply to the wiki origin's host? */
const cookieMatches = (cookie: chrome.cookies.Cookie, wikiOrigin: string) => {
	const host = new URL(wikiOrigin).hostname.toLowerCase();
	const domain = cookie.domain.replace(/^\./, '').toLowerCase();
	return host === domain || (!cookie.hostOnly && host.endsWith(`.${domain}`));
};

/** A `jwt` cookie was set: finish a pending login. */
const onJwtCookie = async (cookie: chrome.cookies.Cookie) => {
	const p = await getPending();
	if (!p || !cookieMatches(cookie, p.wikiOrigin)) return;
	// The certificate was checked when the login started.
	if (!(await hasAccess(p.appOrigin, p.wikiOrigin))) {
		await clearPending();
		await broadcast(p.appOrigin, fail('NO_PERMISSION'));
		return;
	}
	// Read through cookies.get so the cookie that applies to the wiki URL wins.
	const token = await readJwt(p.wikiOrigin);
	if (!token) return;
	const result = await postToken(p.appOrigin, token);
	// Still rejected (e.g. a cookie set before the user finished logging in):
	// keep waiting for the next cookie until the pending login expires.
	if (!result.ok && result.code === 'REJECTED') return;
	await clearPending();
	await broadcast(p.appOrigin, result);
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

	// Keep the dynamic content script registered.
	const resync = () => {
		syncContentScript().catch(() => {});
	};
	chrome.runtime.onInstalled.addListener(resync);
	chrome.runtime.onStartup.addListener(resync);
	chrome.permissions.onRemoved.addListener(resync);
	chrome.permissions.onAdded.addListener(resync);
};
