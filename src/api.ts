import axios from 'axios';

/**
 * Config default API endpoint
 */
export const BASE_URL = 'https://lttt.dev';

/**
 * Default API
 */
const API = axios.create({
	baseURL: BASE_URL,
	withCredentials: true
});

export const shortenUrl = async (
	originalUrl: string
): Promise<{ short_url: string; title: string }> => {
	const { data } = await API.get('/api/extension/url', {
		params: { url: originalUrl },
	});
	return data;
};
