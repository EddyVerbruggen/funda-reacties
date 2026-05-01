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

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && tab.url && !tab.url.includes("funda.nl")) {
    chrome.action.setBadgeText({ text: "", tabId });
  }
});
