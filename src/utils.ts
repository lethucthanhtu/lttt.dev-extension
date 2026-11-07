/**
 * Shows a toast on the page in the tab, styled like the sonner toasts of the lttt.dev apps
 * (zinc popover colours, light or dark from the OS). A new toast replaces the previous one.
 * @param tabId
 * @param message
 * @param duration in ms
 */
export const showToast = async (tabId: number, message: string, duration = 2000): Promise<void> => {
	await chrome.scripting.executeScript({
		target: { tabId },
		args: [message, duration],
		// Runs in the page, so it must be self-contained: no imports, no outer variables.
		func: (msg: string, duration: number) => {
			const HOST_ID = 'lttt-dev-extension-toast';
			document.getElementById(HOST_ID)?.remove();

			// A shadow root keeps the page's CSS off the toast and the toast's CSS off the page.
			const host = document.createElement('div');
			host.id = HOST_ID;
			const shadow = host.attachShadow({ mode: 'closed' });
			const style = document.createElement('style');
			style.textContent = `
				:host { all: initial; }
				div {
					--bg: oklch(1 0 0);
					--fg: oklch(0.141 0.005 285.823);
					--border: oklch(0.92 0.004 286.32);
					position: fixed;
					right: 24px;
					bottom: 24px;
					z-index: 2147483647;
					box-sizing: border-box;
					width: min(356px, calc(100vw - 48px));
					padding: 16px;
					border: 1px solid var(--border);
					border-radius: 8px;
					background: var(--bg);
					color: var(--fg);
					box-shadow: 0 4px 12px rgb(0 0 0 / 0.1);
					font: 500 13px/1.5 ui-sans-serif, system-ui, sans-serif;
					opacity: 0;
					transform: translateY(8px);
					transition: opacity 0.4s ease, transform 0.4s ease;
				}
				div.open { opacity: 1; transform: none; }
				@media (prefers-color-scheme: dark) {
					div {
						--bg: oklch(0.21 0.006 285.885);
						--fg: oklch(0.985 0 0);
						--border: oklch(1 0 0 / 10%);
					}
				}
				@media (prefers-reduced-motion: reduce) {
					div { transition: none; transform: none; }
				}
			`;
			const toast = document.createElement('div');
			toast.setAttribute('role', 'status');
			toast.textContent = msg;
			shadow.append(style, toast);
			document.documentElement.append(host);

			requestAnimationFrame(() => toast.classList.add('open'));
			setTimeout(() => {
				toast.classList.remove('open');
				setTimeout(() => host.remove(), 400);
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