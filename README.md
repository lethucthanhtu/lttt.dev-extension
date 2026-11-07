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

## 🔐 Wiki.js session sync

Lets a web app sign you in with your existing Wiki.js session, without you copying any token. No app or wiki host is hard-coded in the extension.

A page is an **allowed web app** only if it sends a **signed certificate** (protocol v3): a certificate signed by the project's signing key that lists the app's origins and its wiki. There is nothing to configure in the extension (it has no options page), in any Chromium browser.

Every other page gets **no reply at all**, so it cannot detect the extension.

### How it works

1. On install and on browser start, the extension registers a small content script for `https://*/*` and `http://localhost/*`. It does nothing until the page posts a sync message, and even then it only forwards the message to the background service worker. It replies to the page only if the background confirms that the page is an allowed web app.
2. The background decides from `sender.origin`, which the browser sets (the page cannot fake it). It also requires the message to come from this extension's content script, in the top frame of a tab.
3. For a sync, the background:
   - reads the Wiki.js session cookie (`jwt`) of the certificate's `wiki`;
   - sends it with `POST <sender origin>/api/auth/token`, using the body `{"token": "…"}` and `credentials: 'include'`.

   The token is never sent to the page and never logged.
4. Nothing is saved except a pending login (app origin, wiki origin, tab id) in `chrome.storage.session`. No token is stored.

Wiki.js may renew its session (a new `jwt`). The web app's server handles renewal itself; the extension does nothing extra.

### Permissions trade-off

Zero-setup detection means any `https` site (or `localhost`) may turn out to be a signed web app, and its wiki may be any `https` origin. So since version 1.3.0 the extension requires host access to `https://*/*` and `http://localhost/*` (plus `https://lttt.dev/*` for short links). Chrome shows the install warning **"Read and change all your data on all websites"**, and asks again when updating from an older version.

What limits the risk:

- The content script answers only pages the background has verified; it sends nothing on its own.
- A `jwt` cookie is read only for the wiki named in a valid certificate, and is sent only to the verified sender's own origin.
- The signing private key never enters this repo. Without it, nobody can add an app or a wiki to the trusted list.

If you prefer, you can limit the extension's site access in the browser (extension details → **Site access** → "On specific sites"). The extension is then not available on other sites, and a sync whose wiki it cannot access returns `NO_PERMISSION`.

### Protocol (v3)

All messages use `window.postMessage(…, location.origin)` on the web app page. The page sends `source: 'wikijs-session-sync'`; the extension replies with `source: 'wikijs-session-sync-ext'`.

| Page → extension | Extension → page |
| --- | --- |
| `{type:'ping', id, cert}` | `{type:'pong', id, version: 3, extVersion: '1.4.0'}` |
| `{type:'sync', id, cert}` | `{type:'result', id, ok, code?}` |
| — | `{type:'synced', ok, code?}` (unsolicited, no `id`) |

**Certificate.** `cert` is a string of at most 4 KB:

```text
cert    = base64url(payload JSON) + "." + base64url(signature)
payload = {"v": 1, "apps": ["https://app.example.com", "http://localhost:3000"], "wiki": "https://wiki.example.com"}
```

- The signature is ECDSA P-256 with SHA-256, in IEEE-P1363 form (64 bytes, `r‖s`), over the ASCII bytes of the first part. base64url has no padding.
- `apps` holds 1 to 32 origins and `wiki` one origin. Each must be `https://…` (or `http://localhost[:port]`), without credentials. Any path is ignored.
- The background verifies the certificate with WebCrypto against the public key built into the extension, and caches the result per certificate string in memory.
- A page is accepted only if the certificate is valid **and** `sender.origin` is in `apps` **and** it is the top frame. A missing, oversized, malformed or badly signed certificate is treated as no certificate: the page gets no reply.
- Signing a certificate (outside this repo) with Node:

  ```js
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.sign('sha256', Buffer.from(body), { key: privatePem, dsaEncoding: 'ieee-p1363' });
  const cert = `${body}.${sig.toString('base64url')}`;
  ```

**Sync.** The wiki is the certificate's `wiki` (a `wikiUrl` sent by the page is ignored), and the token goes only to the sender's origin.

Result codes:

| Code | Meaning |
| --- | --- |
| `NO_PERMISSION` | Site access to the web app or the wiki is missing (for example, limited in the browser settings). |
| `LOGIN_STARTED` | No `jwt` cookie, or the app rejected it. The wiki's `/login` page opens in a new tab. When a new `jwt` cookie appears within 10 minutes, it is POSTed and the result arrives as `synced`. |
| `APP_FORBIDDEN` | The app does not accept this extension's ID (`EXTENSION_ORIGINS`). |
| `FAILED` | Network error, timeout (15 s) or unexpected response. |

- `synced` is sent to every open tab of that web app's origin.
- There is at most one pending login, with at most one tab. A second `sync` while one is pending reuses that tab (it is focused, and pointed at the new wiki if it differs) and returns the same code. The latest request wins.
- The token `POST` never follows redirects: a redirect response gives `FAILED`.
- No `synced` is sent if the 10-minute login wait expires; the page should time out on its own.
- Since 1.4.0, pages without a certificate (protocol v1/v2, configured in the old Options page) are no longer supported: they get no reply.

### Using your own signing key (forks)

The built-in public key only trusts certificates signed by this project's private key. A fork that serves its own apps should use its own key pair:

```bash
# 1. Generate a P-256 private key ONCE and keep it OUTSIDE the repo (never commit it)
openssl ecparam -name prime256v1 -genkey -noout | openssl pkcs8 -topk8 -nocrypt -out ~/keys/my-sync-signing.pem

# 2. Public key (base64 SPKI DER) → build-time env var (read by vite.config.ts)
echo "EXTENSION_SIGNING_PUBLIC_KEY=$(openssl pkey -in ~/keys/my-sync-signing.pem -pubout -outform DER | openssl base64 -A)" >> .env.local
```

3. Build (`npm run build`). The build then trusts only certificates signed by your key.
4. Sign a certificate for each web app with your private key (see the Node snippet above), and give it to the web app to send in `ping`/`sync`.

If `EXTENSION_SIGNING_PUBLIC_KEY` is empty or unset, the default key is used.

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
- the web app deployed (or running locally), with `EXTENSION_ORIGINS` containing this extension's ID and a valid certificate for its origin.

1. Run `npm run build` with `EXTENSION_PUBLIC_KEY` set, then load `dist/` unpacked. Confirm the ID in `chrome://extensions`.
2. Detection (no setup): open the web app. It should detect the extension (`pong` with `version: 3`). Open any other site and check the DevTools console: `window.postMessage({source:'wikijs-session-sync',type:'ping',id:1}, location.origin)` should get no reply. Sending the web app's certificate from another site should get no reply either.
3. Login flow: log out of Wiki.js, then start a sync. Expect `LOGIN_STARTED`, and the wiki login page opens in a new tab.
   - Start a sync again: the same login tab is focused.
   - Log in. The web app should receive `synced` with `ok`, and you should be signed in.
   - In the service worker's DevTools (chrome://extensions → "service worker"), the `POST /api/auth/token` request should go to the web app's own origin and return 200.
   - The web app's session cookie should be stored. Check that this also works with "Block third-party cookies" enabled.
4. Logged in to Wiki.js, start a sync. Expect `ok` directly, with no tab opened.
5. Error paths:
   - remove the ID from `EXTENSION_ORIGINS` → `APP_FORBIDDEN`;
   - set the extension's **Site access** to "On specific sites" with only the web app → `NO_PERMISSION` (the wiki cannot be read).
6. Repeat in Edge / Brave / Opera if you use them.

Note: `npm run dev` (the crxjs dev server) makes all extension files web-accessible for HMR, so dev builds *are* detectable by any site. Test detection only with `npm run build`.

---

## 🧱 Tech Stack

- [Vite](https://vitejs.dev/)
- [React](https://react.dev/)
- [TypeScript](https://www.typescriptlang.org/)
- [CRXJS](https://crxjs.dev/vite-plugin) — Chrome Extension tooling
