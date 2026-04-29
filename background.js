// ==========================================================================
// Funda Reacties — Background Service Worker
//
// Handles:
// - Badge counter showing number of comments on the active Funda page
// - Message passing between content scripts and background
// - In production: API communication with the backend
// ==========================================================================

// Listen for badge update messages from content script
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

  if (message.type === "GET_COMMENTS") {
    sendResponse({ status: "ok", source: "local" });
  }

  if (message.type === "POST_COMMENT") {
    sendResponse({ status: "ok", source: "local" });
  }
});

// Clear badge when navigating away from Funda
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && tab.url) {
    if (!tab.url.includes("funda.nl")) {
      chrome.action.setBadgeText({ text: "", tabId });
    }
  }
});
