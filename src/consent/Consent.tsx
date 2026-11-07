/**
 * Consent window: asks the user whether a web app may use their session on a
 * source site. Opened by the background (src/bridge/background.ts) with
 * `?id=<consent id>`; the details come from chrome.storage.session, never from
 * the URL, so a page cannot make it show something else.
 */
import { useEffect, useRef, useState } from 'react';
import {
	CONSENTS_KEY,
	RUNTIME_CONSENT,
	type Consent as ConsentRequest,
} from '../bridge/config';

/** Delay before Allow is enabled, so a stray click or key cannot approve. */
const ALLOW_DELAY_MS = 1000;

const id = new URLSearchParams(location.search).get('id') ?? '';

const loadRequest = async (): Promise<ConsentRequest | null> => {
	const all = (await chrome.storage.session.get(CONSENTS_KEY))[CONSENTS_KEY] as
		Record<string, ConsentRequest> | undefined;
	const request = all?.[id];
	return request && request.expiresAt >= Date.now() ? request : null;
};

const ORIGIN = 'font-mono font-semibold break-all';
const BUTTON =
	'rounded-md border border-neutral-400/50 px-4 py-1.5 enabled:cursor-pointer disabled:opacity-50';

export default function Consent() {
	/** undefined = loading, null = expired or unknown. */
	const [request, setRequest] = useState<ConsentRequest | null>();
	const [ready, setReady] = useState(false);
	const [answered, setAnswered] = useState(false);
	const denyButton = useRef<HTMLButtonElement>(null);

	useEffect(() => {
		loadRequest().then(setRequest);
	}, []);

	useEffect(() => {
		if (!request) return;
		denyButton.current?.focus();
		const timer = setTimeout(() => setReady(true), ALLOW_DELAY_MS);
		return () => clearTimeout(timer);
	}, [request]);

	const answer = async (allow: boolean) => {
		setAnswered(true);
		try {
			await chrome.runtime.sendMessage({ type: RUNTIME_CONSENT, id, allow });
		} finally {
			window.close();
		}
	};

	if (request === undefined) return null;
	if (request === null)
		return (
			<main className='p-5 leading-relaxed'>
				<p>This request has expired. You can close this window.</p>
			</main>
		);

	return (
		<main className='space-y-3 p-5 leading-relaxed'>
			<h1 className='text-lg font-semibold'>Allow access?</h1>
			<p>
				<span className={ORIGIN}>{request.appOrigin}</span> wants to use your
				session on
			</p>
			<p>
				<span className={ORIGIN}>{request.source}</span>
			</p>
			<p>
				If you allow it, that app can read your cookies for that site and load
				pages from it as you, whenever you have it open, until you revoke this
				in the extension options.
			</p>
			<p className='text-sm opacity-80'>Only allow sites you trust.</p>
			<div className='flex justify-end gap-2 pt-5'>
				<button
					ref={denyButton}
					className={BUTTON}
					type='button'
					disabled={answered}
					onClick={() => answer(false)}
				>
					Deny
				</button>
				<button
					className={`${BUTTON} border-blue-600 bg-blue-600 text-white`}
					type='button'
					disabled={!ready || answered}
					onClick={() => answer(true)}
				>
					Allow
				</button>
			</div>
		</main>
	);
}
