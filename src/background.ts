import axios from 'axios';
import * as utils from './utils';
import * as api from './api';

// Redirect user to website when click extension icon
chrome.action.onClicked.addListener(() => { chrome.tabs.create({ url: api.BASE_URL }); });

// Add button to context menu
chrome.contextMenus.create({
	id: 'ltttDevCreateShortUrl',
	title: 'Create short link',
	contexts: ['all'],
});

// Handle create short link
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
	const url = info.linkUrl || info.pageUrl;
	if (!tab?.id || !url) return;

	try {
		await utils.showToast(tab.id, 'Shortening URL…', 1000);

		const { short_url } = await api.shortenUrl(url);

		await utils.copyToClipboard(tab.id, short_url);
		await utils.showToast(tab.id, 'Short URL copied! ✓', 3000);
	} catch (error) {
		if (axios.isAxiosError(error)) {
			switch (error.response?.status) {
				case 401:
					chrome.tabs.create({ url: `${api.BASE_URL}/login` });
					return;
				case 400:
					const msg = error.response.data?.error ?? 'Invalid URL';
					await utils.showToast(tab.id, msg, 2_500);
					return;
				default:
					break;
			}
		}
		await utils.showToast(tab.id, 'Failed to shorten URL', 2000);
	}
});
