# lttt.dev Extension

A Chromium based extension for [**lttt.dev**](https://lttt.dev) — quickly create short links directly from your browser.

---

## 🚀 Features

- Right-click any link/page → **“Create short link”** using lttt.dev
- Quickly open [lttt.dev](https://lttt.dev) from the extension icon
- Works seamlessly with your logged-in lttt.dev account
- Optional **Wiki.js session sync**: lets a web app you configure sign you in with your existing Wiki.js session (see below)

---

## 🧩 Installation

### Option 1: Install from ZIP file (recommended for manual install)

1. Download the latest build: [**lttt.dev-extension.zip**](https://github.com/lethucthanhtu/lttt.dev-extension/raw/main/release/lttt.dev-extension.zip)
   (it lives in [`release/`](./release) in this repo), or from the [**Download**](https://lttt.dev/extension) page.
   ![alt text](./blob/download_tutorial.png)
2. Extract it into a folder you keep (the browser loads the extension from there; deleting the folder removes it).
3. Open Chrome/Edge and go to:

- Chrome

  ```txt
  chrome://extensions/
  ```

- Edge

  ```txt
  edge://extensions/
  ```

4. Enable **Developer Mode** (toggle in the top right corner).
5. Click **“Load unpacked”** → select the extracted folder.
6. The **lttt.dev** icon will appear in your browser toolbar.

To update, download the new zip, replace the folder's contents and click the reload icon on the extension's card. The
prebuilt zip is built with the project's `key`, so its extension ID is the same on every computer.

### Option 2: Install from Chrome Web Store

_Coming soon..._

---

### Option 3: Build it yourself

#### Prerequisites

- Git

- Node.js & npm

- A Chromium-based browser (Chrome, Edge, etc.)

#### Installation & Build

1. Clone the repository:

   ```bash
   git clone https://github.com/lethucthanhtu/lttt.dev-extension.git
   cd lttt.dev-extension
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Build the extension:

   ```bash
   npm run build
   ```

4. In the `release/` folder, unzip `.zip` file and load in Chrome/Edge via **Load unpacked** (same as above).

---

## 🔐 Wiki.js session sync (optional)

Lets a web app sign you in with your existing Wiki.js session, without you copying any token. Nothing is hard-coded: you enter both URLs in the extension options, and the extension asks for access to exactly those two sites.

### How it works

1. In **Options** (right-click the extension icon → **Options**), enter the **Wiki.js URL** (e.g. `https://wiki.example.com`) and the **Web app URL** (e.g. `https://app.example.com`), then click **Save**. Chrome asks you to allow access to those two sites.
   - URLs must be `https://…`. For local development, `http://localhost:<port>` is also accepted.
   - Only the two origins are saved, in `chrome.storage.local`. No token is stored.
2. The extension then registers a small content script that runs **only on the web app's origin**. On every other site it does nothing, so other sites cannot detect the extension.
3. The web app detects the extension with `window.postMessage` (`{source: 'wikijs-session-sync', type: 'ping', id}`), and the content script replies with `pong`. When you start a sync in the web app (`type: 'sync'`), the background service worker does the following:
   - checks that the request came from the top frame of a tab on the configured web app;
   - reads the Wiki.js session cookie (`jwt`) for the Wiki.js origin;
   - sends it with `POST <web app>/api/auth/token`, using the body `{"token": "…"}` and `credentials: 'include'`;
   - reports `ok`, or one of these codes: `NOT_CONFIGURED`, `NO_PERMISSION`, `NOT_LOGGED_IN`, `REJECTED`, `APP_FORBIDDEN`, `FORBIDDEN_ORIGIN` or `FAILED`.

   The token is never sent to the page and never logged.
4. **Disable** in Options removes the settings, the content script and the site permissions.

Wiki.js may renew its session (a new `jwt`). The web app's server handles renewal itself; the extension does nothing extra.

### Stable extension ID (`key`)

The web app's server only accepts the extension's origin if it is listed in its `EXTENSION_ORIGINS` setting, as `chrome-extension://<id>`. Without a `key`, Chrome derives an unpacked extension's ID from the folder path, so the ID changes from machine to machine. To pin the ID:

```bash
# 1. Generate a private key ONCE and keep it OUTSIDE the repo (never commit it)
openssl genrsa -out ~/keys/wikijs-sync-extension.pem 2048

# 2. Public key (base64 DER) → build-time env var (read by manifest.config.ts)
echo "EXTENSION_PUBLIC_KEY=$(openssl rsa -in ~/keys/wikijs-sync-extension.pem -pubout -outform DER | openssl base64 -A)" > .env.local

# 3. The resulting extension ID
openssl rsa -in ~/keys/wikijs-sync-extension.pem -pubout -outform DER | openssl dgst -sha256 -r | head -c 32 | tr '0-9a-f' 'a-p'; echo
```

- `.env.local` is git-ignored. You can also pass `EXTENSION_PUBLIC_KEY` as an environment variable in CI.
- Without it, the build simply has no `key`.
- Then set `EXTENSION_ORIGINS=chrome-extension://<id>` on the web app's server. To allow several builds or browsers, list each ID.
- Check the ID in `chrome://extensions` (Developer mode) after loading the build.
- The Chrome Web Store assigns its own ID and key. If the extension is published there, add that ID too. You can also use the store's public key as `EXTENSION_PUBLIC_KEY`, so that dev builds share the store ID.

### Manual test

Prerequisites:
- a Wiki.js instance you can log in to;
- the web app deployed (or running locally), with `EXTENSION_ORIGINS` containing this extension's ID.

1. Run `npm run build` with `EXTENSION_PUBLIC_KEY` set, then load `dist/` unpacked. Confirm the ID in `chrome://extensions`.
2. Before configuring: open the web app. It should **not** detect the extension (no `pong`).
3. Open **Options**, enter the Wiki.js URL and the web app URL, click **Save** and allow access. The page should say "Saved…".
4. Reload the web app tab. It should now detect the extension. Open any other site and check the DevTools console: `window.postMessage({source:'wikijs-session-sync',type:'ping',id:1}, location.origin)` should get no reply.
5. Logged **out** of Wiki.js, start a sync in the web app. Expect `NOT_LOGGED_IN`.
6. Log in to Wiki.js, then start a sync again. Expect `ok`, and you should be signed in to the web app.
   - In the service worker's DevTools (chrome://extensions → "service worker"), the `POST /api/auth/token` request should be 200.
   - The web app's session cookie should be stored. Check that this also works with "Block third-party cookies" enabled.
7. Error paths:
   - remove the ID from `EXTENSION_ORIGINS` → `APP_FORBIDDEN`;
   - in Options, change the web app URL to a different site → the old app no longer detects the extension;
   - revoke a site permission in the extension's details page → `NO_PERMISSION`;
   - click **Disable** → no detection.
8. Repeat in Edge / Brave / Opera if you use them.

Note: `npm run dev` (the crxjs dev server) makes all extension files web-accessible for HMR, so dev builds *are* detectable by any site. Test detection only with `npm run build`.

---

## 🧱 Tech Stack

- [Vite](https://vitejs.dev/)
- [React](https://react.dev/)
- [TypeScript](https://www.typescriptlang.org/)
- [CRXJS](https://crxjs.dev/vite-plugin) — Chrome Extension tooling
