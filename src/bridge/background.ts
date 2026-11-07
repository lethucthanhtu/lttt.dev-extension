/**
 * Bridge — service worker side (protocol v5).
 *
 * A page is an allowed web app only if its browser-provided origin is an https
 * subdomain of lttt.dev and it sends a certificate signed with the project key
 * (cert.ts) that lists that origin. Any other page gets no reply at all.
 *
 * An allowed app sends requests naming a source site and what to get from it
 * (request.ts). The user approves each (app, source) pair once in a consent
 * window; the decision is kept in chrome.storage.local and can be revoked on
 * the options page. Data goes back only to the tab that asked.
 *
 * Two deferred flows reply later to the requesting tab (`pending` now, the
 * `result` afterwards); their state lives in chrome.storage.session so it
 * survives the service worker being stopped:
 * - CONSENT_REQUIRED: the consent window is open (10 min).
 * - LOGIN_STARTED: the request has `session` and the session cookie is
 *   missing (or `relogin`); the source login page is open, and when a new
 *   session cookie appears (10 min) the request runs.
 * Nothing is logged.
 */
import {
	CONSENTS_KEY,
	CONSENT_PAGE,
	GRANTS_KEY,
	LOGIN_KEY,
	RUNTIME_CONSENT,
	RUNTIME_DELIVER,
	RUNTIME_PING,
	RUNTIME_REQUEST,
	pattern,
	type BridgeRequest,
	type Consent,
	type ErrorCode,
	type Grants,
	type PendingCode,
	type Reply,
} from './config';
import { certAllows, verifyCert } from './cert';
import { execute, parseRequest, readCookie } from './request';
import { syncContentScript } from './register';

const PENDING_MS = 10 * 60 * 1000;
/** Requests waiting on one consent or login, at most. */
const MAX_WAITERS = 10;

const fail = (code: ErrorCode): Reply => ({
	kind: 'result',
	result: { ok: false, code },
});
const pending = (code: PendingCode): Reply => ({ kind: 'pending', code });

/** A request waiting for a deferred reply. */
type Waiter = {
	appOrigin: string;
	tabId: number;
	id: string | number;
	request: BridgeRequest;
};
type StoredConsent = Consent & { waiters: Waiter[] };
type Login = {
	appOrigin: string;
	source: string;
	cookie: string;
	loginUrl: string;
	tabId?: number;
	expiresAt: number;
	waiters: Waiter[];
};

/**
 * Run tasks one at a time, so overlapping requests, consents and cookie events
 * cannot race on the stored state.
 */
let queue: Promise<unknown> = Promise.resolve();
const serial = <T>(task: () => Promise<T>): Promise<T> => {
	const run = queue.then(task);
	queue = run.catch(() => {});
	return run;
};

/* ---------- decisions ---------- */

const getGrants = async (): Promise<Grants> =>
	((await chrome.storage.local.get(GRANTS_KEY))[GRANTS_KEY] as Grants) ?? {};

/** true / false = the user allowed / denied, undefined = not asked yet. */
const getGrant = async (appOrigin: string, source: string) =>
	(await getGrants())[appOrigin]?.[source]?.allow;

const setGrant = async (appOrigin: string, source: string, allow: boolean) => {
	const grants = await getGrants();
	grants[appOrigin] = {
		...grants[appOrigin],
		[source]: { allow, at: Date.now() },
	};
	await chrome.storage.local.set({ [GRANTS_KEY]: grants });
};

/* ---------- deferred state ---------- */

const getConsents = async (): Promise<Record<string, StoredConsent>> => {
	const all =
		((await chrome.storage.session.get(CONSENTS_KEY))[CONSENTS_KEY] as
			| Record<string, StoredConsent>
			| undefined) ?? {};
	const now = Date.now();
	for (const [id, c] of Object.entries(all)) {
		if (c.expiresAt < now) delete all[id];
	}
	return all;
};
const setConsents = (all: Record<string, StoredConsent>) =>
	chrome.storage.session.set({ [CONSENTS_KEY]: all });

/**
 * Cookie name of the pending login, so cookie events can be filtered without
 * reading storage: undefined = not known yet (service worker just started),
 * null = no pending login.
 */
let loginCookie: string | null | undefined;

const getLogin = async (): Promise<Login | null> => {
	const { [LOGIN_KEY]: l } = await chrome.storage.session.get(LOGIN_KEY);
	let login = (l as Login | undefined) ?? null;
	if (login && login.expiresAt < Date.now()) {
		await chrome.storage.session.remove(LOGIN_KEY);
		login = null;
	}
	loginCookie = login?.cookie ?? null;
	return login;
};
const setLogin = async (l: Login) => {
	loginCookie = l.cookie; // before the write: do not drop an early event
	await chrome.storage.session.set({ [LOGIN_KEY]: l });
};
const clearLogin = async () => {
	await chrome.storage.session.remove(LOGIN_KEY);
	loginCookie = null;
};

const addWaiter = (waiters: Waiter[], w: Waiter) => {
	const list = waiters.filter((x) => x.tabId !== w.tabId || x.id !== w.id);
	list.push(w);
	return list.slice(-MAX_WAITERS);
};

/**
 * Send a deferred reply to the tab that asked. `appOrigin` lets the content
 * script drop it if the tab navigated to another site meanwhile.
 */
const deliver = async (w: Waiter, reply: Reply) => {
	await chrome.tabs
		.sendMessage(
			w.tabId,
			{ type: RUNTIME_DELIVER, appOrigin: w.appOrigin, id: w.id, reply },
			{ frameId: 0 }
		)
		.catch(() => {}); // tab closed, or no content script there
};

/* ---------- tabs ---------- */

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

/* ---------- flows ---------- */

/**
 * Open the source login page. There is at most one login tab: if one is still
 * open it is reused (and navigated when the target differs), so a page cannot
 * flood the browser with tabs.
 */
const startLogin = async (w: Waiter, near?: chrome.tabs.Tab): Promise<Reply> => {
	const { source, session } = w.request;
	if (!session) return fail('FAILED');
	const l = await getLogin();
	const same =
		!!l &&
		l.appOrigin === w.appOrigin &&
		l.source === source &&
		l.cookie === session.cookie &&
		l.loginUrl === session.loginUrl;
	if (l && !same) {
		// At most one pending login: the latest request wins.
		await Promise.all(l.waiters.map((x) => deliver(x, fail('CANCELLED'))));
	}
	const tabId = await focusOrOpen(l?.tabId, session.loginUrl, !same, near);
	await setLogin({
		appOrigin: w.appOrigin,
		source,
		cookie: session.cookie,
		loginUrl: session.loginUrl,
		tabId,
		expiresAt: Date.now() + PENDING_MS,
		waiters: addWaiter(same ? l.waiters : [], w),
	});
	return pending('LOGIN_STARTED');
};

/**
 * Run an approved request. `loggedIn` = a fresh session cookie just appeared,
 * so `relogin` no longer applies.
 */
const run = async (
	w: Waiter,
	near?: chrome.tabs.Tab,
	loggedIn = false
): Promise<Reply> => {
	const { source, session } = w.request;
	// Checked again here: the user may have revoked it while waiting.
	if ((await getGrant(w.appOrigin, source)) !== true) return fail('DENIED');
	// Only false if the user withheld site access in the browser settings.
	if (!(await chrome.permissions.contains({ origins: [pattern(source)] }))) {
		return fail('NO_PERMISSION');
	}
	if (session) {
		const token = await readCookie(source, session.cookie);
		if (!token || (session.relogin && !loggedIn)) return startLogin(w, near);
	}
	return { kind: 'result', result: { ok: true, data: await execute(w.request) } };
};

/** Ask the user about (app, source); one consent window per pair. */
const askConsent = async (w: Waiter): Promise<Reply> => {
	const all = await getConsents();
	const found = Object.entries(all).find(
		([, c]) => c.appOrigin === w.appOrigin && c.source === w.request.source
	);
	if (found) {
		const [id, c] = found;
		all[id] = { ...c, waiters: addWaiter(c.waiters, w) };
		await setConsents(all);
		if (c.tabId !== undefined) {
			const tab = await chrome.tabs.get(c.tabId).catch(() => undefined);
			if (tab?.windowId !== undefined) {
				await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
			}
		}
		return pending('CONSENT_REQUIRED');
	}
	const id = crypto.randomUUID();
	// Stored before the window opens, so the page can read it at once.
	all[id] = {
		appOrigin: w.appOrigin,
		source: w.request.source,
		expiresAt: Date.now() + PENDING_MS,
		waiters: [w],
	};
	await setConsents(all);
	const win = await chrome.windows.create({
		url: `${chrome.runtime.getURL(CONSENT_PAGE)}?id=${id}`,
		type: 'popup',
		width: 440,
		height: 420,
		focused: true,
	});
	all[id].tabId = win?.tabs?.[0]?.id;
	await setConsents(all);
	return pending('CONSENT_REQUIRED');
};

/** Decide what to do with a request from an allowed app. */
const process = async (w: Waiter, near?: chrome.tabs.Tab): Promise<Reply> => {
	const grant = await getGrant(w.appOrigin, w.request.source);
	if (grant === false) return fail('DENIED');
	if (grant === undefined) return askConsent(w);
	return run(w, near);
};

/** The consent page answered. */
const onConsent = async (id: unknown, allow: unknown) => {
	if (typeof id !== 'string' || typeof allow !== 'boolean') return false;
	const all = await getConsents();
	const c = all[id];
	if (!c) return false;
	delete all[id];
	await setConsents(all);
	await setGrant(c.appOrigin, c.source, allow);
	for (const w of c.waiters) {
		await deliver(w, allow ? await run(w).catch(() => fail('FAILED')) : fail('DENIED'));
	}
	return true;
};

/** The consent window was closed without an answer: ask again next time. */
const onTabRemoved = async (tabId: number) => {
	const all = await getConsents();
	const found = Object.entries(all).find(([, c]) => c.tabId === tabId);
	if (!found) return;
	const [id, c] = found;
	delete all[id];
	await setConsents(all);
	await Promise.all(c.waiters.map((w) => deliver(w, fail('CANCELLED'))));
};

/** Is `cookie` the pending session cookie of the source origin's host? */
const cookieMatches = (cookie: chrome.cookies.Cookie, l: Login) => {
	if (cookie.name !== l.cookie) return false;
	const host = new URL(l.source).hostname.toLowerCase();
	const domain = cookie.domain.replace(/^\./, '').toLowerCase();
	return host === domain || (!cookie.hostOnly && host.endsWith(`.${domain}`));
};

/** A cookie was set: finish a pending login if it is the session cookie. */
const onCookie = async (cookie: chrome.cookies.Cookie) => {
	const l = await getLogin();
	if (!l || !cookieMatches(cookie, l)) return;
	// Read through cookies.get so the cookie that applies to the source URL wins.
	if (!(await readCookie(l.source, l.cookie))) return;
	await clearLogin();
	for (const w of l.waiters) {
		await deliver(w, await run(w, undefined, true).catch(() => fail('FAILED')));
	}
};

/* ---------- messages ---------- */

/**
 * Is the sender an allowed web app? Uses `sender.origin`, which the browser
 * sets (the page cannot fake it). null = not allowed: the page gets no reply.
 */
const allowedApp = async (
	message: { cert?: unknown },
	sender: chrome.runtime.MessageSender
): Promise<string | null> => {
	// Only our own content script, in a tab's top-level frame.
	if (
		sender.id !== chrome.runtime.id ||
		sender.tab?.id === undefined ||
		sender.frameId !== 0 ||
		!sender.origin
	) {
		return null;
	}
	// certAllows also requires an https lttt.dev / *.lttt.dev origin.
	const cert = await verifyCert(message.cert);
	return cert && certAllows(cert, sender.origin) ? sender.origin : null;
};

const handleRequest = async (
	message: { cert?: unknown; id?: unknown; request?: unknown },
	sender: chrome.runtime.MessageSender
): Promise<Reply | null> => {
	// An error while checking must not answer an unverified page (not even FAILED).
	const appOrigin = await allowedApp(message, sender).catch(() => null);
	if (!appOrigin) return null;
	const { id } = message;
	const request = parseRequest(message.request);
	if (!request || (typeof id !== 'string' && typeof id !== 'number')) {
		return fail('BAD_REQUEST');
	}
	const w: Waiter = { appOrigin, tabId: sender.tab!.id!, id, request };
	return process(w, sender.tab).catch(() => fail('FAILED'));
};

/** Only the consent page of this extension may answer a consent. */
const isConsentPage = (sender: chrome.runtime.MessageSender) =>
	sender.id === chrome.runtime.id &&
	!!sender.url?.startsWith(chrome.runtime.getURL(CONSENT_PAGE));

export const initBridge = () => {
	chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
		switch (message?.type) {
			case RUNTIME_PING:
				allowedApp(message, sender)
					.catch(() => null)
					.then((app) => sendResponse(app ? { ok: true } : null));
				return true; // async response
			case RUNTIME_REQUEST:
				serial(() => handleRequest(message, sender))
					.catch(() => null)
					.then(sendResponse);
				return true;
			case RUNTIME_CONSENT:
				if (!isConsentPage(sender)) return false;
				serial(() => onConsent(message.id, message.allow))
					.catch(() => false)
					.then(sendResponse);
				return true;
			default:
				return false;
		}
	});

	chrome.tabs.onRemoved.addListener((tabId) => {
		serial(() => onTabRemoved(tabId)).catch(() => {});
	});

	chrome.cookies.onChanged.addListener(({ removed, cookie }) => {
		if (removed) return;
		// Cheap filter: skip unrelated cookies once the pending state is known.
		if (loginCookie !== undefined && cookie.name !== loginCookie) return;
		serial(() => onCookie(cookie)).catch(() => {});
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
