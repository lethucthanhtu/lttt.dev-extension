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
		await utils.showToast(tab.id, 'Start to shorten URL. ', 1000);

		const title = await api.fetchMeta(url);
		const shortUrl = await api.createShortUrl(url, title);

		await utils.copyToClipboard(tab.id, shortUrl);

		await utils.showToast(tab.id, 'Short URL is copied.  ', 3000);
	} catch (error) {
		if (axios.isAxiosError(error) && error.response?.status === 401) {
			chrome.tabs.create({ url: `${api.BASE_URL}/login` });
			return;
		}

		await utils.showToast(tab.id, 'Failed to shorten URL.', 2000);
	}
});
