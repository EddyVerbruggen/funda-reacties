(async function () {
  // ---- Tab status ----
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const statusEl = document.getElementById("status");

  if (tab?.url?.includes("funda.nl")) {
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

  // ---- Profiel laden en tonen ----
  chrome.storage.local.get(['userId', 'displayName', 'fundaEmail'], (result) => {
    const profileSection = document.getElementById("profile-section");
    const fundaEmail = result.fundaEmail;
    const displayName = result.displayName || "—";

    if (fundaEmail) {
      profileSection.innerHTML = `
        <div class="diag-row">
          <span>Funda-account</span>
          <span class="diag-badge diag-badge--ok">✓ Ingelogd</span>
        </div>
        <div class="diag-row">
          <span>E-mail</span>
          <span style="font-size:11px;color:#5c5245;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${fundaEmail}</span>
        </div>
        <div class="diag-row">
          <span>Naam</span>
          <span style="font-size:11px;color:#5c5245">${displayName}</span>
        </div>`;
    } else {
      profileSection.innerHTML = `
        <div class="diag-row">
          <span>Funda-account</span>
          <span class="diag-badge diag-badge--warn">Niet ingelogd</span>
        </div>
        <div class="diag-row">
          <span>Naam</span>
          <span style="font-size:11px;color:#5c5245">${displayName}</span>
        </div>
        <div class="diag-row" style="font-size:11px;color:#8a7e6e;padding-top:4px">
          <span>Log in op funda.nl voor een vaste gebruikersnaam gekoppeld aan je account.</span>
        </div>`;
    }
  });

  // ---- Check notification permission level ----
  const diagNotif = document.getElementById("diag-notif");
  chrome.runtime.sendMessage({ type: "CHECK_NOTIFICATIONS" }, (response) => {
    if (chrome.runtime.lastError) { diagNotif.textContent = "fout"; diagNotif.className = "diag-badge diag-badge--warn"; return; }
    if (response?.level === "granted") { diagNotif.textContent = "✓ Toegestaan"; diagNotif.className = "diag-badge diag-badge--ok"; }
    else { diagNotif.textContent = `⚠ ${response?.level ?? "onbekend"}`; diagNotif.className = "diag-badge diag-badge--warn"; }
  });

  // ---- Check Supabase reachability ----
  const diagSupabase = document.getElementById("diag-supabase");
  try {
    await fetch('https://xjniqvdfwnsvsuuteakt.supabase.co/rest/v1/', {
      headers: { 'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhqbmlxdmRmd25zdnN1dXRlYWt0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc0NDgxNjIsImV4cCI6MjA5MzAyNDE2Mn0.Dr-t4SIBaZMYu2nn1553S1VzaSCm2bcnxCcAzue_xKo' }
    });
    diagSupabase.textContent = "✓ Verbonden";
    diagSupabase.className = "diag-badge diag-badge--ok";
  } catch (e) {
    diagSupabase.textContent = "✗ Geen verbinding";
    diagSupabase.className = "diag-badge diag-badge--warn";
  }
})();
