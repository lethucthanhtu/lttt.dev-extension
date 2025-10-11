import axios from "axios";

const BASE_URL = "https://lttt.dev";

chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: BASE_URL });
});

chrome.contextMenus.create({
  id: "ltttDevCreateShortUrl",
  title: "Create short link",
  contexts: ["all"],
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const url = info.linkUrl || info.pageUrl;

  try {
    const { data: metaRes } = await axios.get(
      `${BASE_URL}/api/utils/metadata`,
      {
        params: { url },
      }
    );
    const title = metaRes?.metadata?.title || "";

    const { data } = await axios.post(`${BASE_URL}/api/url`, {
      title,
      original_url: url,
    });

    const shortUrl = `${BASE_URL}/${data.shorten_url}`;

    if (tab?.id)
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        args: [shortUrl],
        func: (text) => {
          copy(text);
          toast("Short URL copied");
        },
      });
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 401) {
      chrome.tabs.create({ url: `${BASE_URL}/login` });
      return;
    }
  }
});

function copy(text: string) {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

function toast(message: string, time = 3000) {
  const toast = document.createElement("div");
  toast.textContent = message;
  Object.assign(toast.style, {
    position: "fixed",
    bottom: "20px",
    right: "20px",
    background: "#323232",
    color: "#fff",
    padding: "10px 16px",
    borderRadius: "8px",
    fontSize: "14px",
    zIndex: "999999",
    boxShadow: "0 2px 10px rgba(0,0,0,0.2)",
    opacity: "0",
    transition: "opacity 0.3s ease",
  });
  document.body.appendChild(toast);

  // Fade in
  requestAnimationFrame(() => {
    toast.style.opacity = "1";
  });

  // Remove after 3 seconds
  setTimeout(() => {
    toast.style.opacity = "0";
    setTimeout(() => toast.remove(), 300);
  }, time);
}
