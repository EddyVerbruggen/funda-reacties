// ==========================================================================
// Funda Reacties — Background Service Worker
//
// Handles:
// - Badge counter showing number of comments on the active Funda page
// - Browser notifications for new comments
// - Message passing between content scripts and background
// ==========================================================================

// Listen for messages from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "UPDATE_BADGE" && sender.tab) {
    const count = message.count || 0;
    const text = count > 0 ? String(count) : "";

    chrome.action.setBadgeText({ text, tabId: sender.tab.id });
    chrome.action.setBadgeBackgroundColor({
      color: "#e86c2a",
      tabId: sender.tab.id,
    });
    chrome.action.setBadgeTextColor({
      color: "#ffffff",
      tabId: sender.tab.id,
    });

    sendResponse({ status: "ok" });
  }

  // Show a browser notification
  if (message.type === "SHOW_NOTIFICATION") {
    const notificationId = "funda-reactie-" + Date.now();

    chrome.notifications.create(notificationId, {
      type: "basic",
      iconUrl: "icons/icon128.png",
      title: message.title || "💬 Nieuwe reactie",
      message: message.message || "Iemand heeft gereageerd op een woning.",
      priority: 2,
    });

    // Store the property URL so we can open it when the notification is clicked
    if (message.propertyUrl) {
      chrome.storage.local.set({
        [`notification_${notificationId}`]: message.propertyUrl,
      });
    }

    sendResponse({ status: "ok" });
  }

  // Return true to keep the message channel open for async responses
  return true;
});

// Handle notification clicks — open the property page
chrome.notifications.onClicked.addListener((notificationId) => {
  chrome.storage.local.get([`notification_${notificationId}`], (result) => {
    const url = result[`notification_${notificationId}`];
    if (url) {
      chrome.tabs.create({ url });
      // Clean up stored URL
      chrome.storage.local.remove(`notification_${notificationId}`);
    }
    // Dismiss the notification
    chrome.notifications.clear(notificationId);
  });
});

// Clear badge when navigating away from Funda
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && tab.url) {
    if (!tab.url.includes("funda.nl")) {
      chrome.action.setBadgeText({ text: "", tabId });
    }
  }
});
