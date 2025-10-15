import axios from 'axios';

/**
 * Config default API endpoint
 */
export const BASE_URL = 'https://lttt.dev';

/**
 * Default API
 */
const API = axios.create({ baseURL: BASE_URL });

/**
 * fetch Metadata title from endpoint
 * @param url
 * @returns
 */
export const fetchMetadataTitle = async (url: string): Promise<string> => {
	try {
		const { data } = await API.get(`/api/utils/metadata`, { params: { url }, });
		return data?.metadata?.title || '';
	} catch { return ''; }
};

/**
 * Shorten URL via API
 * @param originalUrl
 * @param title
 * @returns
 */
export const createShortUrl = async (originalUrl: string, title: string): Promise<string> => {
	const { data } = await API.post(`/api/url`, { title, original_url: originalUrl, });
	return `${BASE_URL}/${data.shorten_url}`;
};
