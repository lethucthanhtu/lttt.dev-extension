import { useEffect, useState, type FormEvent } from 'react';
import {
	clearConfig,
	getConfig,
	hasPermissions,
	originPatterns,
	setConfig,
	toOrigin,
	type SyncConfig,
} from '@/sync/config';
import { syncContentScript } from '@/sync/register';

type Status =
	| { kind: 'idle' }
	| { kind: 'saving' }
	| { kind: 'ok'; message: string }
	| { kind: 'error'; message: string };

const URL_HINT = 'Use https://…, or http://localhost:<port> for local development.';

/**
 * Options page: configure the Wiki.js URL and the web app URL for the Wiki.js
 * session sync, and grant host permissions for exactly those two origins.
 */
function App() {
	const [wikiUrl, setWikiUrl] = useState('');
	const [appUrl, setAppUrl] = useState('');
	const [status, setStatus] = useState<Status>({ kind: 'idle' });

	useEffect(() => {
		(async () => {
			const c = await getConfig();
			if (!c) return;
			setWikiUrl(c.wikiOrigin);
			setAppUrl(c.appOrigin);
			setStatus(
				(await hasPermissions(c))
					? { kind: 'ok', message: 'Configured and permissions granted.' }
					: {
							kind: 'error',
							message: 'Permissions are missing. Click Save to grant them again.',
						}
			);
		})();
	}, []);

	const onSubmit = (e: FormEvent) => {
		e.preventDefault();
		const wikiOrigin = toOrigin(wikiUrl);
		const appOrigin = toOrigin(appUrl);
		if (!wikiOrigin || !appOrigin) {
			setStatus({
				kind: 'error',
				message: `Invalid ${!wikiOrigin ? 'Wiki.js' : 'web app'} URL. ${URL_HINT}`,
			});
			return;
		}
		const config: SyncConfig = { wikiOrigin, appOrigin };
		setStatus({ kind: 'saving' });

		// Must be called synchronously inside the click handler (user gesture).
		chrome.permissions
			.request({ origins: originPatterns(config) })
			.then(async (granted) => {
				await setConfig(config);
				await syncContentScript();
				setWikiUrl(wikiOrigin);
				setAppUrl(appOrigin);
				setStatus(
					granted
						? {
								kind: 'ok',
								message:
									'Saved. Reload the web app tab so it can detect the extension.',
							}
						: {
								kind: 'error',
								message:
									'Saved, but access to these sites was not granted, so sync stays off. Click Save again to allow it.',
							}
				);
			})
			.catch(() =>
				setStatus({ kind: 'error', message: 'Could not save the settings.' })
			);
	};

	const onReset = async () => {
		const c = await getConfig();
		await clearConfig();
		await syncContentScript();
		if (c) await chrome.permissions.remove({ origins: originPatterns(c) }).catch(() => {});
		setWikiUrl('');
		setAppUrl('');
		setStatus({ kind: 'ok', message: 'Sync disabled and permissions removed.' });
	};

	const saving = status.kind === 'saving';
	const input =
		'rounded-md border border-gray-300 px-3 py-2 font-mono text-sm focus:border-gray-500 focus:outline-none';

	return (
		<main className='mx-auto max-w-lg p-6 font-sans text-gray-800'>
			<h1 className='text-xl font-semibold'>Wiki.js session sync</h1>
			<p className='mt-2 text-sm text-gray-600'>
				Lets your web app sign you in with your existing Wiki.js session. The
				extension only answers on the web app below. When you start a sync
				there, the extension reads your Wiki.js session cookie and sends it
				straight to that app. The cookie is never stored by the extension or
				shown to the page.
			</p>

			<form className='mt-4 flex flex-col gap-3' onSubmit={onSubmit}>
				<label className='text-sm font-medium' htmlFor='wiki-url'>
					Wiki.js URL
				</label>
				<input
					id='wiki-url'
					type='url'
					placeholder='https://wiki.example.com'
					className={input}
					value={wikiUrl}
					onChange={(e) => setWikiUrl(e.target.value)}
					disabled={saving}
					required
				/>
				<label className='text-sm font-medium' htmlFor='app-url'>
					Web app URL
				</label>
				<input
					id='app-url'
					type='url'
					placeholder='https://app.example.com'
					className={input}
					value={appUrl}
					onChange={(e) => setAppUrl(e.target.value)}
					disabled={saving}
					required
				/>
				<p className='text-xs text-gray-500'>{URL_HINT}</p>
				<div className='flex gap-2'>
					<button
						type='submit'
						className='rounded-md bg-gray-900 px-4 py-2 text-sm text-white disabled:opacity-50'
						disabled={saving}
					>
						{saving ? 'Saving…' : 'Save'}
					</button>
					<button
						type='button'
						className='rounded-md border border-gray-300 px-4 py-2 text-sm disabled:opacity-50'
						onClick={onReset}
						disabled={saving}
					>
						Disable
					</button>
				</div>
			</form>

			<div aria-live='polite' className='mt-4 text-sm'>
				{status.kind === 'ok' && <p className='text-green-700'>{status.message}</p>}
				{status.kind === 'error' && <p className='text-red-700'>{status.message}</p>}
			</div>
		</main>
	);
}

export default App;
