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

Lets a web app sign you in with your existing Wiki.js session, without you copying any token. Nothing is hard-coded: you enter the web app URL in the extension options, and the extension asks for access only to the sites you allow.

### How it works

1. In **Options** (right-click the extension icon → **Options**), enter the **Web app URL** (e.g. `https://app.example.com`), then click **Save**. Chrome asks you to allow access to that site.
   - The **Wiki.js URL** (e.g. `https://wiki.example.com`) is optional. If you leave it empty, the web app asks for its wiki when it needs it (see "Protocol" below).
   - Allowed wikis are listed under **Allowed wikis**, each with a **Remove** button.
   - URLs must be `https://…`. For local development, `http://localhost:<port>` is also accepted.
   - Only origins are saved, in `chrome.storage.local`. No token is stored.
2. The extension then registers a small content script that runs **only on the web app's origin**. On every other site it does nothing, so other sites cannot detect the extension.
3. When you start a sync in the web app, the background service worker:
   - checks that the request came from the top frame of a tab on the configured web app;
   - reads the Wiki.js session cookie (`jwt`), but only for a wiki origin you allowed;
   - sends it with `POST <web app>/api/auth/token`, using the body `{"token": "…"}` and `credentials: 'include'`.

   The token is never sent to the page and never logged.
4. **Disable** in Options removes the settings, the content script and all site permissions. Changing the web app URL drops the wikis allowed for the previous app.

Wiki.js may renew its session (a new `jwt`). The web app's server handles renewal itself; the extension does nothing extra.

### Protocol (v2)

All messages use `window.postMessage(…, location.origin)` on the web app page. The page sends `source: 'wikijs-session-sync'`; the extension replies with `source: 'wikijs-session-sync-ext'`.

| Page → extension | Extension → page |
| --- | --- |
| `{type:'ping', id}` | `{type:'pong', id, version: 2, extVersion: '1.2.0'}` |
| `{type:'sync', id, wikiUrl}` | `{type:'result', id, ok, code?}` |
| — | `{type:'synced', ok, code?}` (unsolicited, no `id`) |

`wikiUrl` is the wiki the page wants to use. Only its origin is used (any path is ignored). Result codes:

| Code | Meaning |
| --- | --- |
| `NOT_CONFIGURED` | No web app is configured. |
| `NO_PERMISSION` | Access to the web app (or, for v1 pages, the wiki) is missing. |
| `INVALID_WIKI_URL` | `wikiUrl` is not a string, not `https://` (or `http://localhost`), or has credentials. |
| `PERMISSION_REQUESTED` | The wiki origin is not allowed yet. The options page opens with that wiki prefilled. Once you click **Save** and allow it, the sync runs and its result arrives as `synced` (this can be `LOGIN_STARTED`, followed later by the login result). |
| `LOGIN_STARTED` | No `jwt` cookie, or the app rejected it. The wiki's `/login` page opens in a new tab. When a new `jwt` cookie appears within 10 minutes, it is POSTed and the result arrives as `synced`. |
| `REJECTED` | The app rejected the token (v1 pages only; v2 starts a login instead). |
| `NOT_LOGGED_IN` | No `jwt` cookie (v1 pages only). |
| `APP_FORBIDDEN` | The app does not accept this extension's ID (`EXTENSION_ORIGINS`). |
| `FORBIDDEN_ORIGIN` | The request did not come from the top frame of the configured web app. |
| `FAILED` | Network error, timeout (15 s) or unexpected response. |

- `synced` is sent to every open tab of the web app.
- There is at most one pending login and one pending permission request, each with at most one tab. A second `sync` while one is pending reuses that tab (it is focused, and pointed at the new wiki if it differs) and returns the same code.
- The token `POST` never follows redirects: a redirect response gives `FAILED`.
- No `synced` is sent if the 10-minute login wait expires; the page should time out on its own.
- A page that sends no `wikiUrl` (protocol v1) uses the first allowed wiki and gets the v1 codes (`NO_PERMISSION`, `NOT_LOGGED_IN`, `REJECTED`) without any tab being opened.

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
3. Open **Options**, enter only the web app URL, click **Save** and allow access. The page should say "Saved…".
4. Reload the web app tab. It should now detect the extension (`pong` with `version: 2`). Open any other site and check the DevTools console: `window.postMessage({source:'wikijs-session-sync',type:'ping',id:1}, location.origin)` should get no reply.
5. Permission flow: start a sync in the web app. Expect `PERMISSION_REQUESTED`, and the options page opens with the Wiki.js URL prefilled and a banner.
   - Start a sync again: the same options tab is focused (no second tab).
   - Click **Save** and allow access. The web app should receive `synced` (`ok` if you are logged in to Wiki.js; otherwise `LOGIN_STARTED` and a login tab opens, then a second `synced` after you log in, see step 6).
6. Login flow: log out of Wiki.js, then start a sync. Expect `LOGIN_STARTED`, and the wiki login page opens in a new tab.
   - Start a sync again: the same login tab is focused.
   - Log in. The web app should receive `synced` with `ok`, and you should be signed in.
   - In the service worker's DevTools (chrome://extensions → "service worker"), the `POST /api/auth/token` request should be 200.
   - The web app's session cookie should be stored. Check that this also works with "Block third-party cookies" enabled.
7. Logged in to Wiki.js, start a sync. Expect `ok` directly, with no tab opened.
8. Error paths:
   - a sync with `wikiUrl: 'http://wiki.example.com'` → `INVALID_WIKI_URL`;
   - remove the ID from `EXTENSION_ORIGINS` → `APP_FORBIDDEN`;
   - remove the wiki under **Allowed wikis** → the next sync returns `PERMISSION_REQUESTED` again;
   - in Options, change the web app URL to a different site → the old app no longer detects the extension;
   - revoke the web app's site permission in the extension's details page → `NO_PERMISSION`;
   - click **Disable** → no detection.
9. Repeat in Edge / Brave / Opera if you use them.

Note: `npm run dev` (the crxjs dev server) makes all extension files web-accessible for HMR, so dev builds *are* detectable by any site. Test detection only with `npm run build`.

---

## 🧱 Tech Stack

- [Vite](https://vitejs.dev/)
- [React](https://react.dev/)
- [TypeScript](https://www.typescriptlang.org/)
- [CRXJS](https://crxjs.dev/vite-plugin) — Chrome Extension tooling
