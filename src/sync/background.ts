/**
 * Wiki.js session sync — service worker side.
 *
 * Reads the Wiki.js session cookie (`jwt`) and POSTs it to the web app, which
 * verifies it and stores its own session. The token is never logged and never
 * returned to the page.
 */
import {
	RUNTIME_SYNC,
	getConfig,
	hasPermissions,
	type SyncErrorCode,
	type SyncResult,
} from './config';
import { syncContentScript } from './register';

const fail = (code: SyncErrorCode): SyncResult => ({ ok: false, code });

const handleSync = async (
	sender: chrome.runtime.MessageSender
): Promise<SyncResult> => {
	// Only our own content script, in a tab's top-level frame.
	if (sender.id !== chrome.runtime.id || !sender.tab || sender.frameId !== 0) {
		return fail('FORBIDDEN_ORIGIN');
	}
	const config = await getConfig();
	if (!config) return fail('NOT_CONFIGURED');
	if (sender.origin !== config.appOrigin) return fail('FORBIDDEN_ORIGIN');

	if (!(await hasPermissions(config))) return fail('NO_PERMISSION');

	const cookie = await chrome.cookies.get({
		url: `${config.wikiOrigin}/`,
		name: 'jwt',
	});
	if (!cookie?.value) return fail('NOT_LOGGED_IN');

	let res: Response;
	try {
		res = await fetch(`${config.appOrigin}/api/auth/token`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ token: cookie.value }),
			credentials: 'include',
			cache: 'no-store',
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

export const initSessionSync = () => {
	chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
		if (message?.type !== RUNTIME_SYNC) return false;
		handleSync(sender)
			.catch((): SyncResult => fail('FAILED'))
			.then(sendResponse);
		return true; // async response
	});

	// Keep the dynamic content script in line with the stored config and the
	// granted permissions.
	const resync = () => {
		syncContentScript().catch(() => {});
	};
	chrome.runtime.onInstalled.addListener(resync);
	chrome.runtime.onStartup.addListener(resync);
	chrome.permissions.onRemoved.addListener(resync);
	chrome.permissions.onAdded.addListener(resync);
};
