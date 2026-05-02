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

  // ---- Supabase config ----
  const SUPABASE_URL = 'https://xjniqvdfwnsvsuuteakt.supabase.co';
  const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhqbmlxdmRmd25zdnN1dXRlYWt0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc0NDgxNjIsImV4cCI6MjA5MzAyNDE2Mn0.Dr-t4SIBaZMYu2nn1553S1VzaSCm2bcnxCcAzue_xKo';
  const headers = { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` };

  // ---- Activiteitsstatistieken laden ----
  const statHouses   = document.getElementById('stat-houses');
  const statComments = document.getElementById('stat-comments');

  chrome.storage.local.get(['userId'], async ({ userId }) => {
    if (!userId) {
      statHouses.textContent   = '—';
      statComments.textContent = '—';
      return;
    }

    try {
      // Aantal bekeken huizen: lees properties_viewed uit users tabel
      const userRes = await fetch(
        `${SUPABASE_URL}/rest/v1/users?user_id=eq.${encodeURIComponent(userId)}&select=properties_viewed`,
        { headers }
      );
      const userData = await userRes.json();
      const propertiesViewed = userData?.[0]?.properties_viewed ?? [];
      const housesCount = Array.isArray(propertiesViewed) ? propertiesViewed.length : null;
      statHouses.textContent = housesCount != null ? housesCount : '—';
      const housesLabel = statHouses.closest('.stat-card')?.querySelector('.stat-card__label');
      if (housesLabel) housesLabel.textContent = housesCount === 1 ? 'Huis bekeken' : 'Huizen bekeken';
    } catch (e) {
      statHouses.textContent = '?';
    }

    try {
      // Aantal reacties: tel comments van deze user
      const countRes = await fetch(
        `${SUPABASE_URL}/rest/v1/comments?user_id=eq.${encodeURIComponent(userId)}&select=id`,
        { headers: { ...headers, 'Prefer': 'count=exact', 'Range-Unit': 'items', 'Range': '0-0' } }
      );
      const total = countRes.headers.get('content-range')?.split('/')?.[1];
      const count = total != null ? parseInt(total, 10) : null;
      statComments.textContent = count != null ? count : '?';
      const commentLabel = statComments.closest('.stat-card')?.querySelector('.stat-card__label');
      if (commentLabel) commentLabel.textContent = count === 1 ? 'Reactie geplaatst' : 'Reacties geplaatst';
    } catch (e) {
      statComments.textContent = '?';
    }
  });
})();
