# lttt.dev Extension

A Chromium based extension for [**lttt.dev**](https://lttt.dev) — quickly create short links directly from your browser.

---

## 🚀 Features

- Right-click any link/page → **“Create short link”** using lttt.dev
- Quickly open [lttt.dev](https://lttt.dev) from the extension icon
- Works seamlessly with your logged-in lttt.dev account

---

## 🧩 Installation

### Option 1: Install from ZIP file (recommended for manual install)

1. Go to the [**Download**](https://lttt.dev/extension) page.
   ![alt text](./blob/download_tutorial.png)
2. Download the latest `.zip` file.
3. Extract it anywhere on your computer.
4. Open Chrome/Edge and go to:

- Chrome

  ```txt
  chrome://extensions/
  ```

- Edge

  ```txt
  edge://extensions/
  ```

1. Enable **Developer Mode** (toggle in the top right corner).
2. Click **“Load unpacked”** → select the extracted folder.
3. The **lttt.dev** icon will appear in your browser toolbar.

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

## 🧱 Tech Stack

- [Vite](https://vitejs.dev/)
- [React](https://react.dev/)
- [TypeScript](https://www.typescriptlang.org/)
- [CRXJS](https://crxjs.dev/vite-plugin) — Chrome Extension tooling
