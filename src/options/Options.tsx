/**
 * Options page: lists the bridge decisions (app → site, allowed or denied) and
 * revokes them. Revoking removes the decision, so the app asks again.
 */
import { useEffect, useState } from 'react';
import { GRANTS_KEY, type Grants } from '@/bridge/config';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from '@/components/ui/card';
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table';

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

const ORIGIN = 'font-mono whitespace-normal break-all';

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
		<main className='mx-auto max-w-3xl p-6'>
			<Card>
				<CardHeader>
					<CardTitle>
						<h1 className='text-xl'>Site access</h1>
					</CardTitle>
					<CardDescription>
						Web apps on lttt.dev that asked to use your session on another
						site. Revoke a decision to be asked again next time.
					</CardDescription>
				</CardHeader>
				<CardContent>
					{rows?.length === 0 && (
						<p className='text-muted-foreground text-sm'>No decisions yet.</p>
					)}
					{!!rows?.length && (
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>App</TableHead>
									<TableHead>Site</TableHead>
									<TableHead>Decision</TableHead>
									<TableHead>
										<span className='sr-only'>Actions</span>
									</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{rows.map(({ app, source, allow, at }) => (
									<TableRow key={`${app} ${source}`}>
										<TableCell className={ORIGIN}>{app}</TableCell>
										<TableCell className={ORIGIN}>{source}</TableCell>
										<TableCell>
											<Badge
												variant={allow ? 'secondary' : 'destructive'}
												title={new Date(at).toLocaleString()}
											>
												{allow ? 'Allowed' : 'Denied'}
											</Badge>
										</TableCell>
										<TableCell className='text-right'>
											<Button
												variant='outline'
												size='sm'
												aria-label={`Revoke ${app} on ${source}`}
												onClick={() => revoke(app, source)}
											>
												Revoke
											</Button>
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					)}
				</CardContent>
			</Card>
		</main>
	);
}
