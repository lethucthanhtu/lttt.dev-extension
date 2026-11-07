import { useEffect, useState, type FormEvent } from 'react';
import {
	clearConfig,
	getConfig,
	originPatterns,
	pattern,
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

type WikiRow = { origin: string; granted: boolean };

const URL_HINT =
	'Use https://…, or http://localhost:<port> for local development.';

/** Wiki origin the web app asked for (`?wiki=`, set by PERMISSION_REQUESTED). */
const requestedWiki = toOrigin(
	new URLSearchParams(location.search).get('wiki')
);

const granted = (origin: string) =>
	chrome.permissions.contains({ origins: [pattern(origin)] });

/** All origins of a config. */
const allOrigins = (c: SyncConfig) => [c.appOrigin, ...c.wikiOrigins];

/** Remove host permissions, keeping any that are still in use. */
const dropPermissions = (origins: string[], keep: string[]) => {
	const drop = origins.filter((o) => !keep.includes(o));
	return drop.length
		? chrome.permissions
				.remove({ origins: drop.map(pattern) })
				.catch(() => false)
		: Promise.resolve(true);
};

/**
 * Options page: configure the web app URL (required) and the Wiki.js origins
 * the extension may read the session cookie from (optional; the web app can
 * also ask for one, which opens this page with `?wiki=` prefilled).
 */
function App() {
	const [config, setConfigState] = useState<SyncConfig | null>(null);
	const [wikis, setWikis] = useState<WikiRow[]>([]);
	const [appUrl, setAppUrl] = useState('');
	const [wikiUrl, setWikiUrl] = useState(requestedWiki ?? '');
	const [status, setStatus] = useState<Status>({ kind: 'idle' });

	const refresh = async () => {
		const c = await getConfig();
		setConfigState(c);
		setWikis(
			c
				? await Promise.all(
						c.wikiOrigins.map(async (origin) => ({
							origin,
							granted: await granted(origin),
						}))
					)
				: []
		);
		return c;
	};

	useEffect(() => {
		(async () => {
			const c = await refresh();
			if (!c) return;
			setAppUrl(c.appOrigin);
			if (!(await granted(c.appOrigin))) {
				setStatus({
					kind: 'error',
					message:
						'Access to the web app is missing. Click Save to grant it again.',
				});
			}
		})();
	}, []);

	const onSubmit = (e: FormEvent) => {
		e.preventDefault();
		const appOrigin = toOrigin(appUrl);
		const wikiOrigin = wikiUrl.trim() ? toOrigin(wikiUrl) : null;
		if (!appOrigin || (wikiUrl.trim() && !wikiOrigin)) {
			setStatus({
				kind: 'error',
				message: `Invalid ${!appOrigin ? 'web app' : 'Wiki.js'} URL. ${URL_HINT}`,
			});
			return;
		}
		const origins = [appOrigin, ...(wikiOrigin ? [wikiOrigin] : [])];
		setStatus({ kind: 'saving' });

		// Must be called synchronously inside the click handler (user gesture).
		chrome.permissions
			.request({ origins: origins.map(pattern) })
			.then(async (ok) => {
				if (!ok) {
					// Keep the current settings (do not switch apps or drop wikis).
					setStatus({
						kind: 'error',
						message:
							'Access to these sites was not granted, so nothing was changed. Click Save again to allow it.',
					});
					return;
				}
				const previous = await getConfig();
				const appChanged = previous?.appOrigin !== appOrigin;
				// Wikis allowed for another app are not carried over to a new one.
				const kept = appChanged ? [] : (previous?.wikiOrigins ?? []);
				const next: SyncConfig = {
					appOrigin,
					wikiOrigins: wikiOrigin ? [...kept, wikiOrigin] : kept,
				};
				await setConfig(next);
				await syncContentScript();
				if (previous && appChanged) {
					await dropPermissions(allOrigins(previous), origins);
				}
				await refresh();
				setAppUrl(appOrigin);
				setWikiUrl('');
				setStatus(
					requestedWiki && wikiOrigin === requestedWiki
						? {
								kind: 'ok',
								message:
									'Allowed. The web app will finish signing in; you can close this tab.',
							}
						: {
								kind: 'ok',
								message: appChanged
									? 'Saved. Reload the web app tab so it can detect the extension.'
									: 'Saved.',
							}
				);
			})
			.catch(() =>
				setStatus({ kind: 'error', message: 'Could not save the settings.' })
			);
	};

	const onRemoveWiki = async (origin: string) => {
		const c = await getConfig();
		if (!c) return;
		await setConfig({
			...c,
			wikiOrigins: c.wikiOrigins.filter((o) => o !== origin),
		});
		await dropPermissions([origin], [c.appOrigin]);
		await refresh();
		setStatus({ kind: 'ok', message: `Removed ${origin}.` });
	};

	const onDisable = async () => {
		const c = await getConfig();
		await clearConfig();
		await syncContentScript();
		if (c)
			await chrome.permissions
				.remove({ origins: originPatterns(c) })
				.catch(() => {});
		await refresh();
		setAppUrl('');
		setWikiUrl('');
		setStatus({
			kind: 'ok',
			message: 'Sync disabled and permissions removed.',
		});
	};

	const saving = status.kind === 'saving';
	const input =
		'rounded-md border border-gray-300 px-3 py-2 font-mono text-sm focus:border-gray-500 focus:outline-none';
	const showRequest =
		requestedWiki &&
		!wikis.some((w) => w.origin === requestedWiki && w.granted);

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

			{showRequest && (
				<p className='mt-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm'>
					{config ? (
						<>
							The web app <span className='font-mono'>{config.appOrigin}</span>{' '}
							asked to use your session on{' '}
						</>
					) : (
						<>A web app asked to use your session on </>
					)}
					<span className='font-mono'>{requestedWiki}</span>. Click{' '}
					<strong>Save</strong> to allow it, or close this tab to refuse.
				</p>
			)}

			<form className='mt-4 flex flex-col gap-3' onSubmit={onSubmit}>
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
				<label className='text-sm font-medium' htmlFor='wiki-url'>
					Wiki.js URL{' '}
					<span className='font-normal text-gray-500'>(optional)</span>
				</label>
				<input
					id='wiki-url'
					type='url'
					placeholder='https://wiki.example.com'
					className={input}
					value={wikiUrl}
					onChange={(e) => setWikiUrl(e.target.value)}
					disabled={saving}
				/>
				<p className='text-xs text-gray-500'>
					{URL_HINT} You can leave the Wiki.js URL empty: the web app asks for
					its wiki when needed.
				</p>
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
						onClick={onDisable}
						disabled={saving}
					>
						Disable
					</button>
				</div>
			</form>

			{wikis.length > 0 && (
				<section className='mt-6'>
					<h2 className='text-sm font-medium'>Allowed wikis</h2>
					<ul className='mt-2 flex flex-col gap-2'>
						{wikis.map((w) => (
							<li
								key={w.origin}
								className='flex items-center justify-between gap-2 text-sm'
							>
								<span className='font-mono'>
									{w.origin}
									{!w.granted && (
										<span className='ml-2 font-sans text-red-700'>
											(access missing)
										</span>
									)}
								</span>
								<button
									type='button'
									className='rounded-md border border-gray-300 px-2 py-1 text-xs disabled:opacity-50'
									onClick={() => onRemoveWiki(w.origin)}
									disabled={saving}
								>
									Remove
								</button>
							</li>
						))}
					</ul>
				</section>
			)}

			<div aria-live='polite' className='mt-4 text-sm'>
				{status.kind === 'ok' && (
					<p className='text-green-700'>{status.message}</p>
				)}
				{status.kind === 'error' && (
					<p className='text-red-700'>{status.message}</p>
				)}
			</div>
		</main>
	);
}

export default App;
