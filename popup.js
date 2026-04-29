// Popup script — loads basic stats from storage
(async function () {
  // Check if we're on a Funda tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const statusEl = document.getElementById("status");

  if (tab && tab.url && tab.url.includes("funda.nl")) {
    if (/\/(detail|koop|huur)\/[^/]+\/[^/]+/.test(tab.url)) {
      statusEl.className = "popup__status popup__status--active";
      statusEl.textContent = "✅ Reactiepaneel is actief op deze pagina.";
    } else {
      statusEl.className = "popup__status popup__status--inactive";
      statusEl.textContent = "📋 Open een woningpagina om reacties te zien.";
    }
  } else {
    statusEl.className = "popup__status popup__status--inactive";
    statusEl.textContent = "🏠 Ga naar funda.nl om reacties te bekijken.";
  }

  // Load basic stats from chrome.storage.local
  chrome.storage.local.get(["totalComments", "propertiesViewed"], (result) => {
    document.getElementById("stat-comments").textContent =
      result.totalComments || 0;
    document.getElementById("stat-properties").textContent =
      result.propertiesViewed || 0;
  });
})();
