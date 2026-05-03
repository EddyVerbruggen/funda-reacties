// ==========================================================================
// Funda Reacties — Background Service Worker
// ==========================================================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  if (message.type === "UPDATE_BADGE" && sender.tab) {
    const count = message.count || 0;
    const text = count > 0 ? String(count) : "";
    chrome.action.setBadgeText({ text, tabId: sender.tab.id });
    chrome.action.setBadgeBackgroundColor({ color: "#e86c2a", tabId: sender.tab.id });
    chrome.action.setBadgeTextColor({ color: "#ffffff", tabId: sender.tab.id });
    sendResponse({ status: "ok" });
  }

  if (message.type === "SHOW_NOTIFICATION" || message.type === "TEST_NOTIFICATION") {
    const notificationId = "funda-reactie-" + Date.now();
    console.log("[Funda Reacties BG] Creating notification:", notificationId, message.title);

    chrome.notifications.create(notificationId, {
      type: "basic",
      iconUrl: "icons/icon128.png",
      title: message.title || "💬 Nieuwe reactie",
      message: message.message || "Iemand heeft gereageerd op een woning.",
      priority: 2,
    }, (createdId) => {
      if (chrome.runtime.lastError) {
        console.error("[Funda Reacties BG] Notification error:", chrome.runtime.lastError.message);
        sendResponse({ status: "error", error: chrome.runtime.lastError.message });
      } else {
        console.log("[Funda Reacties BG] Notification created:", createdId);
        sendResponse({ status: "ok", id: createdId });
      }
    });

    if (message.propertyUrl) {
      chrome.storage.local.set({ [`notification_${notificationId}`]: message.propertyUrl });
    }

    // Return true for async sendResponse
    return true;
  }

  if (message.type === "CHECK_NOTIFICATIONS") {
    // Check if notifications permission is available by attempting a test
    chrome.notifications.getPermissionLevel((level) => {
      console.log("[Funda Reacties BG] Notification permission level:", level);
      sendResponse({ level });
    });
    return true;
  }

  return true;
});

chrome.notifications.onClicked.addListener((notificationId) => {
  chrome.storage.local.get([`notification_${notificationId}`], (result) => {
    const url = result[`notification_${notificationId}`];
    if (url) {
      chrome.tabs.create({ url });
      chrome.storage.local.remove(`notification_${notificationId}`);
    }
    chrome.notifications.clear(notificationId);
  });
});

// ---- Icoontje: grijs is de standaard (manifest), blauw alleen op funda.nl ----

const ICON_COLORED = { 16: "icons/icon16.png", 48: "icons/icon48.png", 128: "icons/icon128.png" };
const ICON_GREY    = { 16: "icons/icon16_grey.png", 48: "icons/icon48_grey.png", 128: "icons/icon128_grey.png" };

function isFundaPage(url) {
  return url && /funda\.nl/.test(url);
}

function updateIcon(tabId, url) {
  if (isFundaPage(url)) {
    chrome.action.setIcon({ path: ICON_COLORED, tabId });
  } else {
    chrome.action.setIcon({ path: ICON_GREY, tabId });
    chrome.action.setBadgeText({ text: "", tabId });
  }
}

// changeInfo.url vuurt bij navigatie naar een andere URL.
// changeInfo.status === "loading" vuurt ook bij F5/reload op dezelfde URL.
// Beide gevallen afhandelen zodat het icoontje altijd correct is.
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url !== undefined) {
    updateIcon(tabId, changeInfo.url);
  } else if (changeInfo.status === "loading" && tab.url) {
    updateIcon(tabId, tab.url);
  }
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  chrome.tabs.get(tabId, (tab) => {
    if (chrome.runtime.lastError) return;
    updateIcon(tabId, tab.url);
  });
});
