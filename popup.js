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
    statusEl.innerHTML = '🏠 Ga naar <a id="funda-link" href="https://www.funda.nl" style="color:inherit;font-weight:700;text-decoration:underline;cursor:pointer">funda.nl</a> om reacties te bekijken.';
    document.getElementById('funda-link').addEventListener('click', (e) => {
      e.preventDefault();
      chrome.tabs.create({ url: 'https://www.funda.nl' });
    });
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
  const activePropsEl = document.getElementById('active-properties');
  const cityStatsSection = document.getElementById('city-stats-section');
  const cityStatsTitleEl = document.getElementById('city-stats-title');
  const cityStatsEl = document.getElementById('city-stats');

  chrome.storage.local.get(['userId'], async ({ userId }) => {
    if (!userId) {
      statHouses.textContent   = '—';
      statComments.textContent = '—';
      activePropsEl.innerHTML  = '<div class="diag-row"><span style="color:#8a7e6e">Log in om je activiteit te zien.</span></div>';
      return;
    }

    let propertiesViewed = [];
    let detectedCity     = null;

    try {
      // Aantal bekeken huizen
      const userRes = await fetch(
        `${SUPABASE_URL}/rest/v1/users?user_id=eq.${encodeURIComponent(userId)}&select=properties_viewed`,
        { headers }
      );
      const userData = await userRes.json();
      propertiesViewed = userData?.[0]?.properties_viewed ?? [];
      const housesCount = Array.isArray(propertiesViewed) ? propertiesViewed.length : null;
      statHouses.textContent = housesCount != null ? housesCount : '—';
      const housesLabel = statHouses.closest('.stat-card')?.querySelector('.stat-card__label');
      if (housesLabel) housesLabel.textContent = housesCount === 1 ? 'Huis bekeken' : 'Huizen bekeken';
    } catch (e) {
      statHouses.textContent = '?';
    }

    try {
      // Aantal reacties
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

    // ---- Meest actieve bekeken woningen ----
    try {
      if (Array.isArray(propertiesViewed) && propertiesViewed.length > 0) {
        // Haal comments op voor bekeken woningen, plus adres/url via join
        const ids = propertiesViewed.map(id => `"${id}"`).join(',');
        const commentsRes = await fetch(
          `${SUPABASE_URL}/rest/v1/comments?property_id=in.(${ids})&select=property_id,created_at,properties(address,url)&order=created_at.desc&limit=200`,
          { headers }
        );
        const commentsData = await commentsRes.json();

        // Aggregeer per property
        const byProp = {};
        for (const row of (commentsData || [])) {
          if (!byProp[row.property_id]) {
            byProp[row.property_id] = {
              address: row.properties?.address || row.property_id,
              url:     row.properties?.url     || null,
              count:   0,
              latest:  row.created_at,
            };
          }
          byProp[row.property_id].count++;
        }

        const sorted = Object.values(byProp)
          .sort((a, b) => b.count - a.count || b.latest.localeCompare(a.latest))
          .slice(0, 3);

        if (sorted.length === 0) {
          activePropsEl.innerHTML = '<div class="diag-row"><span style="color:#8a7e6e">Nog geen reacties op bekeken woningen.</span></div>';
        } else {
          activePropsEl.innerHTML = `<ul class="active-list">${sorted.map(p => `
            <li class="active-item">
              ${p.url ? `<a href="${p.url}" target="_blank" rel="noopener">${p.address}</a>` : `<span style="font-size:12px;font-weight:600">${p.address}</span>`}
              <div class="active-item__meta">${p.count} reactie${p.count !== 1 ? 's' : ''}</div>
            </li>`).join('')}</ul>`;
        }

        // Detecteer de meest bezochte stad voor het stadsoverzicht
        try {
          const propRes = await fetch(
            `${SUPABASE_URL}/rest/v1/properties?property_id=in.(${ids})&select=property_id,loc_city&loc_city=not.is.null`,
            { headers }
          );
          const propData = await propRes.json();
          const cityCounts = {};
          for (const p of (propData || [])) {
            if (p.loc_city) cityCounts[p.loc_city] = (cityCounts[p.loc_city] || 0) + 1;
          }
          const topCity = Object.entries(cityCounts).sort((a, b) => b[1] - a[1])[0]?.[0];
          if (topCity) detectedCity = topCity;
        } catch (e) { /* stadsdetectie mislukt, geen probleem */ }
      } else {
        activePropsEl.innerHTML = '<div class="diag-row"><span style="color:#8a7e6e">Je hebt nog geen woningen bekeken.</span></div>';
      }
    } catch (e) {
      activePropsEl.innerHTML = '<div class="diag-row"><span>?</span></div>';
    }

    // ---- Stadsoverzicht WOZ ----
    if (detectedCity) {
      try {
        const wozRes = await fetch(
          `${SUPABASE_URL}/rest/v1/rpc/get_city_woz_stats`,
          {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({ p_city: detectedCity, p_years: 5 }),
          }
        );
        const wozData = await wozRes.json();
        if (Array.isArray(wozData) && wozData.length >= 2) {
          const cityTitle = detectedCity.charAt(0).toUpperCase() + detectedCity.slice(1);
          cityStatsTitleEl.textContent = `WOZ-ontwikkeling ${cityTitle}`;
          cityStatsSection.style.display = '';

          // Bereken j-op-j stijging
          const rows = wozData.map((row, i) => {
            const prev = wozData[i - 1];
            const groei = prev && prev.avg_woz > 0
              ? ((row.avg_woz - prev.avg_woz) / prev.avg_woz * 100).toFixed(1).replace('.', ',')
              : null;
            const fmtWoz = `€\u00a0${Math.round(row.avg_woz / 1000)}k`;
            return `
              <div class="city-row">
                <span class="city-row__year">${row.peiljaar}</span>
                <span class="city-row__val">${fmtWoz}</span>
                <span class="city-row__sub">${groei !== null ? (parseFloat(groei) >= 0 ? '+' : '') + groei + '%' : ''} (${row.count} woningen)</span>
              </div>`;
          });
          cityStatsEl.innerHTML = rows.join('');
        }
      } catch (e) { /* stadsoverzicht mislukt, toon niet */ }
    }
  });
})();
