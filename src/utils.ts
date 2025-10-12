/**
 * Display toast message
 * @param tabI
 * @param message
 * @param duration
 */
export const showToast = async ( tabId: number, message: string, duration = 2000 ): Promise<void> => {
	await chrome.scripting.executeScript({
		target: { tabId: tabId },
		args: [message, duration],
		func: (msg: string, duration: number) => {
			const toast = document.createElement('div');
			toast.textContent = msg;
			Object.assign(toast.style, {
				position: 'fixed',
				bottom: '20px',
				right: '20px',
				background: '#323232',
				color: '#fff',
				padding: '10px 16px',
				borderRadius: '8px',
				fontSize: '14px',
				zIndex: '999999',
				boxShadow: '0 2px 10px rgba(0,0,0,0.2)',
				opacity: '0',
				transition: 'opacity 0.3s ease',
			});
			document.body.appendChild(toast);
			requestAnimationFrame(() => (toast.style.opacity = '1'));
			setTimeout(() => {
				toast.style.opacity = '0';
				setTimeout(() => toast.remove(), 300);
			}, duration);
		},
	});
};

/**
 * Handle copy to clipboard
 * @param tabId
 * @param text
 */
export const copyToClipboard = async (tabId: number, text: string): Promise<void> => {
	await chrome.scripting.executeScript({
		target: { tabId },
		args: [text],
		func: (text) => {
			const textarea = document.createElement('textarea');
			textarea.value = text;
			document.body.appendChild(textarea);
			textarea.select();
			document.execCommand('copy');
			textarea.remove();
		},
	});
};