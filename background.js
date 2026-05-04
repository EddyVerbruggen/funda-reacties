// ==========================================================================
// Funda Inzicht — Background Service Worker
// ==========================================================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  if (message.type === "UPDATE_BADGE" && sender.tab) {
    const count = message.count || 0;
    setIconWithCount(sender.tab.id, count);
    sendResponse({ status: "ok" });
  }

  if (message.type === "SHOW_NOTIFICATION" || message.type === "TEST_NOTIFICATION") {
    const notificationId = "funda-reactie-" + Date.now();
    console.log("[Funda Inzicht BG] Creating notification:", notificationId, message.title);

    chrome.notifications.create(notificationId, {
      type: "basic",
      iconUrl: "icons/icon128.png",
      title: message.title || "💬 Nieuwe reactie",
      message: message.message || "Iemand heeft gereageerd op een woning.",
      priority: 2,
    }, (createdId) => {
      if (chrome.runtime.lastError) {
        console.error("[Funda Inzicht BG] Notification error:", chrome.runtime.lastError.message);
        sendResponse({ status: "error", error: chrome.runtime.lastError.message });
      } else {
        console.log("[Funda Inzicht BG] Notification created:", createdId);
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
      console.log("[Funda Inzicht BG] Notification permission level:", level);
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

// ---- Icoontje: grijs is de standaard (manifest), gekleurd alleen op funda.nl ----

const ICON_COLORED = { 16: "icons/icon16.png", 48: "icons/icon48.png", 128: "icons/icon128.png" };
const ICON_GREY    = { 16: "icons/icon16_grey.png", 48: "icons/icon48_grey.png", 128: "icons/icon128_grey.png" };

// Cache van ImageData per grootte zodat we niet elke keer opnieuw fetchen
const iconCache = {};

async function getIconImageData(url, size) {
  if (iconCache[url]) return iconCache[url];
  const resp = await fetch(chrome.runtime.getURL(url));
  const blob = await resp.blob();
  const bitmap = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bitmap, 0, 0, size, size);
  const imageData = ctx.getImageData(0, 0, size, size);
  iconCache[url] = imageData;
  return imageData;
}

/**
 * Teken het icoon met een subtiele teller rechtsboven.
 * count === 0 → gewoon het kale gekleurde icoon.
 */
async function setIconWithCount(tabId, count) {
  // Werkt alleen voor de 16px en 32px varianten die Chrome daadwerkelijk in de toolbar toont
  const sizes = [16, 32];
  const imageData = {};

  for (const size of sizes) {
    // 32px valt terug op 48px bronbestand
    const srcUrl = size <= 16 ? ICON_COLORED[16] : ICON_COLORED[48];
    const base = await getIconImageData(srcUrl, size);

    const canvas = new OffscreenCanvas(size, size);
    const ctx = canvas.getContext("2d");

    // Zet de bestaande pixels van de base ImageData
    ctx.putImageData(base, 0, 0);

    if (count > 0) {
      const label = count > 99 ? "99+" : String(count);

      // Schaal mee met icongrootte — subtiel kleine dot rechtsboven
      const dotR  = size * 0.28;          // straal van het bolletje
      const dotX  = size - dotR - 10;   // rechts
      const dotY  = dotR + 4;           // boven
      const fs    = size <= 16 ? 6 : (count > 99 ? 10 : 14); // lettergrootte

      // Subtiel donker halftransparant bolletje
      ctx.globalAlpha = 1; // 0.75;
      ctx.fillStyle = "#6a281c";
      ctx.beginPath();
      ctx.arc(dotX, dotY, dotR, 0, Math.PI * 2);
      ctx.fill();

      // Getal
      ctx.globalAlpha = 0.90;
      // ctx.fillStyle = "#f5e8d8";
      ctx.fillStyle = "#ffffff";
      ctx.font = `bold ${fs}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label, dotX, dotY + 0.5);

      ctx.globalAlpha = 1.0;
    }

    imageData[size] = ctx.getImageData(0, 0, size, size);
  }

  chrome.action.setIcon({ imageData, tabId });
  // Geen setBadgeText — badge volledig uitgeschakeld
  chrome.action.setBadgeText({ text: "", tabId });
}

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
