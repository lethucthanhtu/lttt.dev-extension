/**
 * Options page: lists the bridge decisions (app → site, allowed or denied) and
 * revokes them. Revoking removes the decision, so the app asks again.
 */
import { useEffect, useState } from 'react';
import { GRANTS_KEY, type Grants } from '../bridge/config';

const getGrants = async (): Promise<Grants> =>
	((await chrome.storage.local.get(GRANTS_KEY))[GRANTS_KEY] as Grants) ?? {};

const revoke = async (app: string, source: string) => {
	const grants = await getGrants();
	if (!grants[app]) return;
	delete grants[app][source];
	if (!Object.keys(grants[app]).length) delete grants[app];
	await chrome.storage.local.set({ [GRANTS_KEY]: grants });
};

type Row = { app: string; source: string; allow: boolean; at: number };

const toRows = (grants: Grants): Row[] =>
	Object.keys(grants)
		.sort()
		.flatMap((app) =>
			Object.keys(grants[app])
				.sort()
				.map((source) => {
					const { allow, at } = grants[app][source];
					return { app, source, allow, at };
				})
		);

const CELL =
	'border-b border-neutral-400/30 px-2 py-1.5 text-left align-middle';
const ORIGIN = `${CELL} font-mono break-all`;

export default function Options() {
	/** null = loading. */
	const [rows, setRows] = useState<Row[] | null>(null);

	useEffect(() => {
		const load = () => getGrants().then((grants) => setRows(toRows(grants)));
		const onChanged = (
			changes: Record<string, chrome.storage.StorageChange>,
			area: string
		) => {
			if (area === 'local' && GRANTS_KEY in changes) load();
		};
		chrome.storage.onChanged.addListener(onChanged);
		load();
		return () => chrome.storage.onChanged.removeListener(onChanged);
	}, []);

	return (
		<main className='mx-auto max-w-3xl space-y-4 p-6 leading-relaxed'>
			<h1 className='text-xl font-semibold'>Site access</h1>
			<p>
				Web apps on lttt.dev that asked to use your session on another site.
				Revoke a decision to be asked again next time.
			</p>
			{rows?.length === 0 && <p>No decisions yet.</p>}
			{!!rows?.length && (
				<table className='w-full border-collapse'>
					<thead>
						<tr>
							<th className={CELL}>App</th>
							<th className={CELL}>Site</th>
							<th className={CELL}>Decision</th>
							<th className={CELL} />
						</tr>
					</thead>
					<tbody>
						{rows.map(({ app, source, allow, at }) => (
							<tr key={`${app} ${source}`}>
								<td className={ORIGIN}>{app}</td>
								<td className={ORIGIN}>{source}</td>
								<td
									className={`${CELL} ${allow ? 'text-green-600' : 'text-red-600'}`}
									title={new Date(at).toLocaleString()}
								>
									{allow ? 'Allowed' : 'Denied'}
								</td>
								<td className={CELL}>
									<button
										className='cursor-pointer rounded-md border border-neutral-400/50 px-3 py-0.5'
										type='button'
										onClick={() => revoke(app, source)}
									>
										Revoke
									</button>
								</td>
							</tr>
						))}
					</tbody>
				</table>
			)}
		</main>
	);
}
