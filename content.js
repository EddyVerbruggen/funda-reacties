// ==========================================================================
// Funda Reacties — Content Script (Supabase Edition)
// ==========================================================================

(function () {
  "use strict";

  // ---- State ----
  let currentUserId = null;
  let currentDisplayName = null;
  let realtimeChannel = null;
  let allComments = []; // Track all comments for pagination
  let allPriceHistory = []; // Track price history for renderPriceChange
  let commentsDisplayed = 10; // Initial batch size

  // ---- Helpers ----

  const FUNDA_URL_STATUS_SEGMENTS = new Set([
    "verkocht", "verhuurd", "onder-bod", "onder-optie",
    "verkocht-onder-voorbehoud", "verhuurd-onder-voorbehoud",
    "geveild", "ingetrokken",
  ]);

  function getCityFromPage() {
    const h1Container = document.querySelector('[city]');
    if (h1Container) {
      const city = h1Container.getAttribute('city');
      if (city) return city.toLowerCase();
    }

    const path = location.pathname.replace(/\/+$/, "");
    const segments = path.split("/").filter(Boolean);
    const startIdx = segments.indexOf("koop") !== -1
      ? segments.indexOf("koop") + 1
      : segments.indexOf("huur") !== -1 ? segments.indexOf("huur") + 1 : -1;

    if (startIdx > 0 && startIdx < segments.length) {
      for (let i = startIdx; i < segments.length; i++) {
        const seg = decodeURIComponent(segments[i]).toLowerCase();
        if (FUNDA_URL_STATUS_SEGMENTS.has(seg)) continue;
        if (/^huis-|^appartement-|^woonhuis-|^\d{6,}$/.test(seg)) break;
        return seg;
      }
    }
    return null;
  }

  function getNeighborhoodFromPage() {
    const h1Container = document.querySelector('[neighborhoodidentifier]');
    if (h1Container) {
      const raw = h1Container.getAttribute('neighborhoodidentifier') || "";
      const parts = raw.split("/");
      if (parts.length >= 2 && parts[1]) return parts[1].toLowerCase();
    }

    const h1 = document.querySelector("h1");
    if (!h1) return null;
    const city = getCityFromPage();
    const candidateLinks = [...h1.querySelectorAll("a[href]"), ...(h1.parentElement?.querySelectorAll("a[href]") || [])];

    for (const a of candidateLinks) {
      const href = a.getAttribute("href") || "";
      let path = href;
      try { const u = new URL(href, location.origin); path = u.pathname; } catch (e) {}
      path = path.replace(/\/+$/, "");
      const segments = path.split("/").filter(Boolean);

      if (segments.length === 3 && (segments[0] === "koop" || segments[0] === "huur")) {
        const [, hrefCity, hrefSlug] = segments;
        if (city && hrefCity.toLowerCase() !== city) continue;
        if (/^huis-|^appartement-|^woonhuis-/.test(hrefSlug)) continue;
        return hrefSlug.toLowerCase();
      }
      if (segments.length === 3 && segments[0] === "informatie") {
        const [, hrefCity, hrefSlug] = segments;
        if (city && hrefCity.toLowerCase() !== city) continue;
        return hrefSlug.toLowerCase();
      }
    }
    return null;
  }

  function getStreetFromPage() {
    const h1 = document.querySelector("h1");
    if (!h1) return null;
    const streetSpan = h1.querySelector('span.block');
    const raw = streetSpan ? (streetSpan.textContent || "").trim() : (h1.textContent || "").trim();
    if (!raw) return null;
    const street = raw.replace(/\s+\d+[a-zA-Z]?(?:[-/]\d+[a-zA-Z]?)?\s*$/, "").trim();
    return street ? street.toLowerCase() : null;
  }

  function getPropertyId() {
    const path = location.pathname.replace(/\/+$/, "");
    const numericMatch = path.match(/\/(\d{6,})(?:\/|$)/);
    if (numericMatch) return numericMatch[1];
    return null;
  }

  function getPropertyAddress() {
    const h1 = document.querySelector("h1");
    let streetPart = "";
    if (h1) {
      const streetSpan = h1.querySelector('span.block');
      if (streetSpan) {
        streetPart = (streetSpan.textContent || "").trim();
      } else {
        const raw = (h1.textContent || "").trim();
        const postcodeIdx = raw.search(/\d{4}\s?[A-Z]{2}/);
        streetPart = postcodeIdx > 0 ? raw.slice(0, postcodeIdx).trim() : raw;
      }
    }
    const city = getCityFromPage();
    const cityTitle = city ? titleCase(city) : "";
    if (streetPart && cityTitle) return `${streetPart}, ${cityTitle}`;
    if (streetPart) return streetPart;
    if (cityTitle) return cityTitle;
    return document.title.replace(/ \[funda].*/, "").trim();
  }

  function getPropertyUrl() {
    return location.origin + location.pathname.replace(/\/+$/, "") + "/";
  }

  function getPropertyLocation() {
    const loc = {};
    const city = getCityFromPage();
    if (city) loc.city = city;
    const street = getStreetFromPage();
    if (street) loc.street = street;
    const neighborhood = getNeighborhoodFromPage();
    if (neighborhood) loc.neighborhood = neighborhood;
    const h1Container = document.querySelector('[province]');
    if (h1Container) {
      const province = h1Container.getAttribute('province');
      if (province) loc.province = province.toLowerCase();
    }
    dbg("getPropertyLocation:", JSON.stringify(loc));
    return loc;
  }

  function cleanPriceText(raw) {
    if (!raw) return null;
    return raw.replace(/\s*(k\.k\.|v\.o\.n\.|kosten koper|vrij op naam)\s*/gi, "").trim();
  }

  function getAskingPrice() {
    let raw = null;
    const dts = document.querySelectorAll("dt");
    for (const dt of dts) {
      if ((dt.textContent || "").trim().toLowerCase().endsWith("vraagprijs")) {
        const dd = dt.nextElementSibling;
        if (dd && dd.tagName === "DD") {
          const txt = (dd.textContent || "").trim();
          if (txt.includes("€") || /\d/.test(txt)) { raw = txt; break; }
        }
      }
    }
    if (!raw) {
      for (const sel of ['[data-testid="asking-price"]', '[data-testid*="price"]', '[class*="askingPrice"]', '[class*="asking-price"]']) {
        const el = document.querySelector(sel);
        if (el) { const txt = (el.textContent || "").trim(); if (txt.includes("€") || /\d/.test(txt)) { raw = txt; break; } }
      }
    }
    if (!raw) {
      for (const el of document.querySelectorAll("h2, h3, span, p, div")) {
        const txt = (el.textContent || "").trim();
        if (/^€\s*[\d.,]+/.test(txt) && txt.length < 40) { raw = txt; break; }
      }
    }
    return cleanPriceText(raw);
  }

  function parsePrice(priceStr) {
    if (!priceStr) return null;
    const num = parseInt(priceStr.replace(/[^\d.,]/g, "").replace(/\./g, "").replace(",", "."), 10);
    return isNaN(num) ? null : num;
  }

  function formatPrice(num) {
    if (!num) return null;
    return "€\u00a0" + num.toLocaleString("nl-NL");
  }

  function timeAgo(dateString) {
    const diff = Math.floor((Date.now() - new Date(dateString).getTime()) / 1000);
    if (diff < 60) return "zojuist";
    if (diff < 3600) return `${Math.floor(diff / 60)} min geleden`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} uur geleden`;
    if (diff < 604800) { const d = Math.floor(diff / 86400); return d === 1 ? "Gisteren" : `${d} dagen geleden`; }
    return new Date(dateString).toLocaleDateString("nl-NL", { day: "numeric", month: "short" });
  }

  function avatarColor(name) {
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    const colors = ["#e86c2a", "#4a9b6e", "#5b7fc4", "#c4534a", "#8a6bbf", "#d4943a", "#3b8a8a", "#bf6b8a"];
    return colors[Math.abs(hash) % colors.length];
  }

  function titleCase(str) {
    return String(str).split(/[\s-]+/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
  }

  const DEBUG = true;
  function dbg(...args) { if (DEBUG) console.log("[Funda Reacties]", ...args); }

  // Verwijder HTML-tags en URLs stille zodat comments altijd plain text zijn.
  // Gebruikers merken dit alleen als ze echt HTML of links probeerden in te voeren.
  function sanitizeComment(text) {
    return text
      .replace(/<[^>]*>/g, '')                          // HTML-tags strippen
      .replace(/https?:\/\/\S+/gi, '')                  // http(s):// URLs verwijderen
      .replace(/www\.\S+/gi, '')                        // www.* URLs verwijderen
      .replace(/[ \t]{2,}/g, ' ')                       // dubbele spaties samenvoegen
      .trim();
  }

  /**
   * Leest de publicatiedatum van de woning op Funda ("Op Funda" in het populariteitsblok).
   * HTML-patroon: <p class="m-0 font-bold">13-1-2026</p><p class="m-0">Op Funda</p>
   * @returns {Date|null}
   */
  function getPublishedOnFundaDate() {
    const section = document.querySelector('[data-testid="object-insights"]');
    if (!section) return null;
    const paragraphs = section.querySelectorAll('p.m-0');
    for (let i = 0; i < paragraphs.length; i++) {
      if ((paragraphs[i].textContent || '').trim() === 'Op Funda') {
        // De tekst staat in de vorige <p> of een <p> met font-bold
        const boldP = paragraphs[i - 1];
        if (!boldP) continue;
        const raw = (boldP.textContent || '').trim();
        // formaat: 13-1-2026
        const m = raw.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
        if (m) return new Date(parseInt(m[3], 10), parseInt(m[2], 10) - 1, parseInt(m[1], 10));
      }
    }
    return null;
  }

  // ---- WOZ Data ----

  /**
   * Haalt WOZ-waarden op. Probeert eerst de DB-cache;
   * valt terug op externe PDOK/Kadaster API-calls als de cache leeg of onvolledig is.
   * Na een succesvolle externe fetch worden de waarden opgeslagen in de DB.
   *
   * @param {string} address  - bijv. "Anjelierstraat 4, Amsterdam"
   * @param {string} propertyId
   * @returns {Array<{peildatum, vastgesteldeWaarde}>|null}
   */
  async function fetchWozData(address, propertyId) {
    // 1. Probeer de DB-cache (alleen voor bekende numeric property IDs)
    if (/^\d{6,}$/.test(propertyId)) {
      const cached = await getCachedWozData(propertyId);
      if (cached) {
        dbg('WOZ: cache hit (✔️ DB)', propertyId);
        return cached;
      }
    }

    // 2. Externe API-calls
    try {
      const suggestUrl = `https://api.pdok.nl/bzk/locatieserver/search/v3_1/suggest?q=${encodeURIComponent(address)}&rows=10`;
      const suggestRes = await fetch(suggestUrl);
      if (!suggestRes.ok) return null;
      const suggestJson = await suggestRes.json();
      const docs = suggestJson?.response?.docs;
      if (!docs || docs.length === 0) return null;
      const locatieId = docs[0].id;
      if (!locatieId) return null;

      const lookupUrl = `https://api.pdok.nl/bzk/locatieserver/search/v3_1/lookup?fl=*&id=${encodeURIComponent(locatieId)}`;
      const lookupRes = await fetch(lookupUrl);
      if (!lookupRes.ok) return null;
      const lookupJson = await lookupRes.json();
      const lookupDocs = lookupJson?.response?.docs;
      if (!lookupDocs || lookupDocs.length === 0) return null;
      const nummeraanduidingId = lookupDocs[0].nummeraanduiding_id;
      if (!nummeraanduidingId) return null;

      const wozUrl = `https://api.kadaster.nl/lvwoz/wozwaardeloket-api/v1/wozwaarde/nummeraanduiding/${encodeURIComponent(nummeraanduidingId)}`;
      const wozRes = await fetch(wozUrl);
      if (!wozRes.ok) return null;
      const wozJson = await wozRes.json();
      const wozWaarden = wozJson?.wozWaarden;
      if (!wozWaarden || wozWaarden.length === 0) return null;

      const sorted = [...wozWaarden].sort((a, b) => a.peildatum.localeCompare(b.peildatum));

      // 3. Sla op in DB (fire-and-forget, niet awaiten zodat UI niet wacht)
      if (/^\d{6,}$/.test(propertyId)) {
        saveWozData(propertyId, sorted)
          .then(() => dbg('WOZ: opgeslagen in DB', propertyId))
          .catch(() => {});
      }

      return sorted;
    } catch (e) {
      dbg('WOZ fetch fout:', e);
      return null;
    }
  }

  /**
   * Rendert een insight-chip (of banner) over de gem. verkooptijd in de straat
   * versus het aantal dagen dat de woning al online staat.
   *
   * @param {number|null} avgSaleDays   - gem. verkooptijd in de straat
   * @param {Date|null}   publishedDate - datum "Op Funda"
   * @returns {string} HTML
   */
  function renderStreetSaleInsight(avgSaleDays, publishedDate) {
    if (avgSaleDays === null || avgSaleDays === undefined) return '';

    const daysOnline = publishedDate
      ? Math.floor((Date.now() - publishedDate.getTime()) / 86400000)
      : null;

    const avgFmt = `${avgSaleDays} dag${avgSaleDays !== 1 ? 'en' : ''}`;

    if (daysOnline === null) {
      // Geen publicatiedatum — toon alleen de gem. verkooptijd
      return `<div class="fr-sale-insight fr-sale-insight--neutral">
        <span class="fr-sale-insight__icon">⏱️</span>
        <span class="fr-sale-insight__text">Gem. verkooptijd in deze buurt: <strong>${escapeHtml(avgFmt)}</strong></span>
      </div>`;
    }

    const ratio = daysOnline / avgSaleDays; // >1 = langer online dan gemiddeld
    let cls = 'fr-sale-insight--neutral';
    let icon = '⏱️';
    let label;

    if (ratio < 0.5) {
      // Nog ruim binnen gemiddelde
      cls   = 'fr-sale-insight--fast';
      icon  = '🟢';
      label = `Al ${daysOnline} dag${daysOnline !== 1 ? 'en' : ''} online — gem. verkooptijd in deze straat is ${avgFmt}. Nog ruim op tijd.`;
    } else if (ratio < 1.0) {
      // Nadert het gemiddelde
      cls   = 'fr-sale-insight--approaching';
      icon  = '🟡';
      label = `Al ${daysOnline} dag${daysOnline !== 1 ? 'en' : ''} online — gem. verkooptijd hier is ${avgFmt}. Nadert het gemiddelde.`;
    } else if (ratio === 1.0) {
      // Is het gemiddelde
      cls   = 'fr-sale-insight--approaching';
      icon  = '🟡';
      label = `Al ${daysOnline} dag${daysOnline !== 1 ? 'en' : ''} online — gem. verkooptijd hier is ${avgFmt}. Precies het gemiddelde.`;
    } else if (ratio < 1.5) {
      // Licht boven het gemiddelde
      cls   = 'fr-sale-insight--slow';
      icon  = '🟠';
      label = `Al ${daysOnline} dag${daysOnline !== 1 ? 'en' : ''} online — gem. verkooptijd hier is ${avgFmt}. Staat al langer dan gemiddeld te koop.`;
    } else {
      // Significant boven het gemiddelde
      cls   = 'fr-sale-insight--very-slow';
      icon  = '🔴';
      label = `Al ${daysOnline} dag${daysOnline !== 1 ? 'en' : ''} online — gem. verkooptijd hier is ${avgFmt}. Flink langer dan gemiddeld — misschien onderhandelingsruimte?`;
    }

    return `<div class="fr-sale-insight ${cls}">
      <span class="fr-sale-insight__icon">${icon}</span>
      <span class="fr-sale-insight__text">${escapeHtml(label)}</span>
    </div>`;
  }

  /**
   * Rendert een compacte WOZ + vraagprijs grafiek als SVG,
   * met optioneel een WOZ-trendvergelijking direct onder de grafiek.
   * wozData: [{ peildatum: 'yyyy-MM-dd', vastgesteldeWaarde: number }]
   * priceHistory: [{ recorded_at, price }] (nieuwste eerst)
   * cityGrowth: { cagr_pct, from_jaar, to_jaar, count } | null
   */
  function renderWozChart(wozData, priceHistory, cityGrowth) {
    if (!wozData || wozData.length === 0) return '';

    // WOZ-punten
    const wozPoints = wozData.map(w => ({
      year: parseInt(w.peildatum.slice(0, 4), 10),
      value: w.vastgesteldeWaarde,
    }));

    // Vraagprijzen: dedupliceer op jaar (meest recente per jaar)
    const priceByYear = {};
    if (priceHistory && priceHistory.length > 0) {
      for (const p of [...priceHistory].reverse()) {
        const yr = new Date(p.recorded_at).getFullYear();
        priceByYear[yr] = p.price;
      }
    }
    const currentPrice = parsePrice(getAskingPrice());
    if (currentPrice) priceByYear[new Date().getFullYear()] = currentPrice;

    const pricePoints = Object.entries(priceByYear)
      .map(([yr, val]) => ({ year: parseInt(yr, 10), value: val }))
      .sort((a, b) => a.year - b.year);

    // Bereken WOZ-insight: vergelijk huidige vraagprijs met meest recente WOZ
    const latestWoz     = wozPoints[wozPoints.length - 1];
    const latestWozJaar = latestWoz.year;
    const comparePrice  = currentPrice || (pricePoints.length > 0 ? pricePoints[pricePoints.length - 1].value : null);
    let insightLabel = null;   // bijv. "+18% tov WOZ '25"
    let insightColor = '#8a7e6e';
    if (comparePrice && latestWoz.value > 0) {
      const pct = ((comparePrice - latestWoz.value) / latestWoz.value) * 100;
      const absPct = Math.abs(pct).toFixed(0);
      const shortJaar = String(latestWozJaar).slice(2); // '25'
      if (Math.abs(pct) < 2) {
        insightLabel = `≈ WOZ '${shortJaar}`;
        insightColor = '#8a7e6e';
      } else if (pct > 0) {
        insightLabel = `+${absPct}% tov WOZ '${shortJaar}`;
        insightColor = pct > 30 ? '#c4534a' : '#d4943a';
      } else {
        insightLabel = `-${absPct}% tov WOZ '${shortJaar}`;
        insightColor = '#4a9b6e';
      }
    }

    // Alle jaren voor x-as
    const allYears = [...new Set([
      ...wozPoints.map(p => p.year),
      ...pricePoints.map(p => p.year),
    ])].sort();

    if (allYears.length === 0) return '';

    const allValues = [
      ...wozPoints.map(p => p.value),
      ...pricePoints.map(p => p.value),
    ];
    const minVal = Math.min(...allValues) * 0.9;
    const maxVal = Math.max(...allValues) * 1.08;

    // SVG layout
    const W = 260, H = 110;
    const padL = 46, padR = 8, padT = 18, padB = 26;
    const chartW = W - padL - padR;
    const chartH = H - padT - padB;

    const xScale = year => padL + ((year - allYears[0]) / Math.max(allYears[allYears.length - 1] - allYears[0], 1)) * chartW;
    const yScale = val  => padT + chartH - ((val - minVal) / (maxVal - minVal)) * chartH;

    function toPolyline(pts) {
      return pts.map(p => `${xScale(p.year).toFixed(1)},${yScale(p.value).toFixed(1)}`).join(' ');
    }

    const wozLine   = wozPoints.length > 1   ? `<polyline points="${toPolyline(wozPoints)}"   fill="none" stroke="#5b7fc4" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round" />` : '';
    const priceLine = pricePoints.length > 1 ? `<polyline points="${toPolyline(pricePoints)}" fill="none" stroke="#e86c2a" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round" stroke-dasharray="4 2" />` : '';

    const wozDots = wozPoints.map(p =>
      `<circle cx="${xScale(p.year).toFixed(1)}" cy="${yScale(p.value).toFixed(1)}" r="2.8" fill="#5b7fc4" />`
    ).join('');
    const priceDots = pricePoints.map(p =>
      `<circle cx="${xScale(p.year).toFixed(1)}" cy="${yScale(p.value).toFixed(1)}" r="2.8" fill="#e86c2a" />`
    ).join('');

    // Y-as labels (3 niveaus)
    function fmtK(v) {
      if (v >= 1000000) return `€${(v/1000000).toFixed(1).replace('.',',')}M`;
      return `€${Math.round(v/1000)}k`;
    }
    const yLabels = [minVal, (minVal + maxVal) / 2, maxVal].map(v => {
      const y = yScale(v);
      return `<text x="${padL - 4}" y="${y.toFixed(1)}" text-anchor="end" dominant-baseline="middle" font-size="8" fill="#8a7e6e">${fmtK(v)}</text>`;
    }).join('');

    // X-as labels
    const step = allYears.length > 8 ? 2 : 1;
    const xLabels = allYears.filter((_, i) => i % step === 0 || i === allYears.length - 1).map(yr => {
      const x = xScale(yr);
      return `<text x="${x.toFixed(1)}" y="${(H - padB + 10).toFixed(1)}" text-anchor="middle" font-size="8" fill="#8a7e6e">${yr}</text>`;
    }).join('');

    // Hulplijnen
    const gridLines = [minVal, (minVal + maxVal) / 2, maxVal].map(v => {
      const y = yScale(v);
      return `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${W - padR}" y2="${y.toFixed(1)}" stroke="#e2ddd5" stroke-width="0.8" />`;
    }).join('');

    // Legenda links, insight-label rechts — beide op dezelfde rij onder de grafiek
    const legendY  = H - padB + 20;
    const legend = `
      <circle cx="${padL + 2}" cy="${legendY}" r="3" fill="#5b7fc4" />
      <text x="${padL + 8}" y="${legendY}" dominant-baseline="middle" font-size="8" fill="#5b7fc4" font-weight="600">WOZ</text>
      <line x1="${padL + 34}" y1="${legendY}" x2="${padL + 44}" y2="${legendY}" stroke="#e86c2a" stroke-width="1.8" stroke-dasharray="4 2" />
      <circle cx="${padL + 50}" cy="${legendY}" r="3" fill="#e86c2a" />
      <text x="${padL + 56}" y="${legendY}" dominant-baseline="middle" font-size="8" fill="#e86c2a" font-weight="600">Vraagprijs</text>
      ${insightLabel ? `<text x="${W - padR}" y="${legendY}" text-anchor="end" dominant-baseline="middle" font-size="8.5" fill="${insightColor}" font-weight="700">${insightLabel}</text>` : ''}
    `;

    // Bereken WOZ-trendvergelijking voor info-knopje in de grafiek-header
    let trendInfoBtn = '';
    if (cityGrowth && cityGrowth.cagr_pct !== null && wozData.length >= 2) {
      const cityFromJaar = cityGrowth.from_jaar;
      const cityToJaar   = cityGrowth.to_jaar;
      const fromEntry = wozData.find(w => parseInt(w.peildatum.slice(0, 4), 10) === cityFromJaar)
                     || wozData.find(w => parseInt(w.peildatum.slice(0, 4), 10) >= cityFromJaar);
      const toEntry   = [...wozData].reverse().find(w => parseInt(w.peildatum.slice(0, 4), 10) === cityToJaar)
                     || wozData[wozData.length - 1];

      if (fromEntry && toEntry && fromEntry !== toEntry) {
        const fromJaar = parseInt(fromEntry.peildatum.slice(0, 4), 10);
        const toJaar   = parseInt(toEntry.peildatum.slice(0, 4), 10);
        const years    = toJaar - fromJaar;
        if (years > 0 && fromEntry.vastgesteldeWaarde > 0) {
          const wonCagr  = (Math.pow(toEntry.vastgesteldeWaarde / fromEntry.vastgesteldeWaarde, 1 / years) - 1) * 100;
          const cityCagr = parseFloat(cityGrowth.cagr_pct);
          const diff     = wonCagr - cityCagr;
          const wonStr   = wonCagr.toFixed(1).replace('.', ',');
          const cityStr  = cityCagr.toFixed(1).replace('.', ',');
          const absDiff  = Math.abs(diff).toFixed(1).replace('.', ',');

          let trendTekst;
          if (Math.abs(diff) < 0.5) {
            trendTekst = `WOZ-stijging ≈ stadstrend (+${wonStr}% / jaar)`;
          } else if (diff > 0) {
            trendTekst = `WOZ-stijging ${absDiff}% per jaar boven stadstrend`;
          } else {
            trendTekst = `WOZ-stijging ${absDiff}% per jaar onder stadstrend`;
          }
          // const detailTekst = `Woning +${wonStr}% / jaar tov stad +${cityStr}% / jaar (${fromJaar}–${toJaar}, ${cityGrowth.count} won.)`;
          const detailTekst = `Woning +${wonStr}% / jaar tov stad +${cityStr}% / jaar`;
          const tooltipTekst = `${trendTekst} — ${detailTekst}`;
          trendInfoBtn = `<span class="fr-woz-info" data-tooltip="${escapeAttr(tooltipTekst)}">&#x2139;</span>`;
        }
      }
    }

    return `
      <div class="fr-woz-chart">
        <div class="fr-woz-chart__title">
          <span>📊 WOZ-waarde historie</span>
          ${trendInfoBtn}
        </div>
        <svg viewBox="0 0 ${W} ${H + 14}" width="100%" style="display:block;overflow:visible" xmlns="http://www.w3.org/2000/svg">
          ${gridLines}
          <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + chartH}" stroke="#e2ddd5" stroke-width="0.8" />
          ${wozLine}${priceLine}${wozDots}${priceDots}
          ${yLabels}${xLabels}
          ${legend}
        </svg>
      </div>`;
  }

  // ---- Scraping helpers ----

  function generateInsights() {
    const insights = [];
    const dts = document.querySelectorAll("dt");

    function findDd(...prefixes) {
      for (const dt of dts) {
        const label = (dt.textContent || "").trim().toLowerCase();
        if (prefixes.some((p) => label.startsWith(p))) {
          const dd = dt.nextElementSibling;
          if (dd && dd.tagName === "DD") return (dd.textContent || "").trim();
        }
      }
      return null;
    }

    // parseDutchDate is defined later — forward-reference is fine inside a function body

    const sinceStr = findDd("aangeboden sinds", "datum van aanmelding");
    if (sinceStr) {
      const parsed = parseDutchDate(sinceStr);
      if (parsed) {
        const days = Math.floor((Date.now() - parsed.getTime()) / 86400000);
        if (days >= 0) insights.push({ icon: "📅", text: `${days} dagen online` });
      }
    }

    let rooms = findDd("aantal kamers");
    if (rooms) {
      rooms = rooms.replace("slaapkamers", "slk");
      insights.push({icon: "🛏️", text: rooms});
    }

    const energyLabel = findDd("energielabel");
    if (energyLabel && energyLabel.length <= 5) insights.push({ icon: "⚡", text: energyLabel });

    const buildYear = findDd("bouwjaar");
    if (buildYear && /^\d{4}$/.test(buildYear)) insights.push({ icon: "🏗️", text: buildYear });

    const areaStr = findDd("wonen", "woonoppervlakte", "gebruiksoppervlakte wonen");
    let livingArea = null;
    if (areaStr) { const m = areaStr.match(/([\d.,]+)\s*m/i); if (m) livingArea = parseInt(m[1].replace(/\./g, ""), 10); }
    const priceNum = parsePrice(getAskingPrice());
    if (livingArea > 0 && priceNum > 0) {
      insights.push({ icon: "📋", text: `€ ${Math.round(priceNum / livingArea).toLocaleString("nl-NL")}/m²` });
    } else if (livingArea > 0) {
      insights.push({ icon: "📋", text: `${livingArea} m² wonen` });
    }

    return insights;
  }

  // ---- Whisper helpers ----

  /**
   * Verzamelt de woningdata die de whisper-generator nodig heeft.
   * Hergebruikt de dt/dd-logica uit generateInsights().
   */
  function getPropertyDataForWhisper() {
    const dts = document.querySelectorAll("dt");
    function findDd(...prefixes) {
      for (const dt of dts) {
        const label = (dt.textContent || "").trim().toLowerCase();
        if (prefixes.some((p) => label.startsWith(p))) {
          const dd = dt.nextElementSibling;
          if (dd && dd.tagName === "DD") return (dd.textContent || "").trim();
        }
      }
      return null;
    }

    const askingPriceStr = getAskingPrice();
    const priceNum       = parsePrice(askingPriceStr);

    const areaStr    = findDd("wonen", "woonoppervlakte", "gebruiksoppervlakte wonen");
    let livingArea   = null;
    if (areaStr) { const m = areaStr.match(/([\d.,]+)\s*m/i); if (m) livingArea = parseInt(m[1].replace(/\./g, ""), 10); }

    const pricePerM2   = livingArea > 0 && priceNum > 0 ? Math.round(priceNum / livingArea) : null;
    const energyLabel  = findDd("energielabel") || null;
    const buildYear    = findDd("bouwjaar") || null;

    // Monument: kijk of "Specifiek" de waarde "Monumentaal pand" bevat
    const specifiekRaw = findDd("specifiek") || "";
    const isMonument   = specifiekRaw.toLowerCase().includes("monument");

    // Perceelgrootte
    const perceelRaw = findDd("perceel") || "";
    const perceelMatch = perceelRaw.match(/([\d.,]+)/);
    const plotArea = perceelMatch ? parseInt(perceelMatch[1].replace(/\./g, "").replace(",", "."), 10) : null;

    const sinceStr = findDd("aangeboden sinds", "datum van aanmelding");
    let daysOnline = null;
    if (sinceStr) {
      const parsed = parseDutchDate(sinceStr);
      if (parsed) daysOnline = Math.floor((Date.now() - parsed.getTime()) / 86400000);
    }

    return { priceNum, livingArea, pricePerM2, energyLabel, buildYear, daysOnline, city: getCityFromPage(), isMonument, plotArea };
  }

  // wozData kan asynchroon meegegeven worden vanuit createPanel
  // zodat de whispers er gebruik van kunnen maken
  function enrichWhisperDataWithWoz(propertyData, wozData) {
    if (!wozData || wozData.length === 0) return propertyData;
    const latest = wozData[wozData.length - 1];
    const wozWaarde = latest.vastgesteldeWaarde;
    const wozJaar   = parseInt(latest.peildatum.slice(0, 4), 10);
    // Bereken j-op-j gemiddelde stijging over beschikbare jaren
    let wozGroeiPct = null;
    if (wozData.length >= 2) {
      const oldest = wozData[0];
      const years  = wozJaar - parseInt(oldest.peildatum.slice(0, 4), 10);
      if (years > 0 && oldest.vastgesteldeWaarde > 0) {
        wozGroeiPct = (Math.pow(wozWaarde / oldest.vastgesteldeWaarde, 1 / years) - 1) * 100;
      }
    }
    return { ...propertyData, wozWaarde, wozJaar, wozGroeiPct };
  }

  function parseDutchDate(str) {
    const months = { januari: 0, februari: 1, maart: 2, april: 3, mei: 4, juni: 5, juli: 6, augustus: 7, september: 8, oktober: 9, november: 10, december: 11, jan: 0, feb: 1, mrt: 2, apr: 3, jun: 5, jul: 6, aug: 7, sep: 8, okt: 9, nov: 10, dec: 11 };
    const m = str.replace(/\./g, "").trim().toLowerCase().match(/(\d{1,2})\s+([a-z]+)\s+(\d{4})/);
    if (!m) return null;
    const monthIdx = months[m[2]];
    if (monthIdx === undefined) return null;
    return new Date(parseInt(m[3], 10), monthIdx, parseInt(m[1], 10));
  }

  // ---- Supabase Data Layer ----

  // Standaard emoji met tooltiplabels. De volgorde bepaalt de weergave in de balk.
  const DEFAULT_EMOJIS = [
    { emoji: "🔥", label: "Must-see!" },
    { emoji: "😍", label: "Droomhuis" },
    { emoji: "💰", label: "Goede prijs" },
    { emoji: "😬", label: "Te duur" },
    { emoji: "📍", label: "Toplocatie" },
    { emoji: "🏚️", label: "Opknapper" },
  ];
  const DEFAULT_EMOJI_KEYS = DEFAULT_EMOJIS.map(e => e.emoji);
  const EMOJI_LABELS = Object.fromEntries(DEFAULT_EMOJIS.map(e => [e.emoji, e.label]));

  async function loadReactions(propertyId) {
    const userId = currentUserId;
    await upsertProperty(propertyId, getPropertyAddress(), getPropertyUrl(), getPropertyLocation());
    // Registreer de huidige vraagprijs als die veranderd is
    const currentPriceText = getAskingPrice();
    const currentPriceNum  = parsePrice(currentPriceText);
    const currentPricePerM2 = (() => {
      const dts = document.querySelectorAll('dt');
      for (const dt of dts) {
        const label = (dt.textContent || '').trim().toLowerCase();
        if (label.startsWith('wonen') || label.startsWith('woonoppervlakte') || label.startsWith('gebruiksoppervlakte wonen')) {
          const dd = dt.nextElementSibling;
          if (dd && dd.tagName === 'DD') {
            const m = (dd.textContent || '').match(/([\d.,]+)\s*m/i);
            if (m) {
              const area = parseInt(m[1].replace(/\./g, ''), 10);
              if (area > 0 && currentPriceNum > 0) return Math.round(currentPriceNum / area);
            }
          }
        }
      }
      return null;
    })();
    if (currentPriceNum && /^\d{6,}$/.test(propertyId)) {
      recordPriceIfChanged(propertyId, currentPriceNum, currentPricePerM2)
        .then(r => { if (r.inserted) dbg('Nieuwe prijs geregistreerd:', currentPriceNum); })
        .catch(() => {});
    }
    // Haal de prijshistorie op voor prijswijziging-banner en per-comment vergelijking
    const priceHistory = await getLastKnownPrice(propertyId);
    // trackPropertyView wordt NIET hier aangeroepen — dat gebeurt eenmalig
    // vanuit inject() nadat het profiel definitief bekend is.

    const emojiCounts = await getEmojiCounts(propertyId, userId);
    const emojis = {};
    for (const { emoji } of DEFAULT_EMOJIS) emojis[emoji] = emojiCounts[emoji] || { count: 0, active: false };
    for (const [emoji, info] of Object.entries(emojiCounts)) { if (!emojis[emoji]) emojis[emoji] = info; }

    const { data: rawComments, error: commentsError } = await supabaseClient
      .from('comments').select('*, votes(*)')
      .eq('property_id', propertyId)
      .order('created_at', { ascending: false });
    if (commentsError) console.error('Error loading comments:', commentsError);

    const comments = (rawComments || []).map(c => {
      const upvotes = (c.votes || []).filter(v => v.vote_type === 'up').length;
      const downvotes = (c.votes || []).filter(v => v.vote_type === 'down').length;
      const myVote = (c.votes || []).find(v => v.user_id === userId);
      return { id: c.id, name: c.name, text: c.text, time: c.created_at, upvotes, downvotes, myVote: myVote ? myVote.vote_type : null, isOwn: c.user_id === userId };
    });

    return { address: getPropertyAddress(), url: getPropertyUrl(), location: getPropertyLocation(), emojis, comments, priceHistory: priceHistory || [], priceComparison: null };
  }

  // ---- Neighborhood ----

  const SCOPE_LABELS = { street: "Zelfde straat", neighborhood: "Zelfde wijk", city: "Zelfde stad" };

  async function findNeighborhoodComments(currentPropertyId, currentLocation, limitPerScope = 3) {
    if (!currentLocation || Object.keys(currentLocation).length === 0) return [];
    const results = await getNeighborhoodComments(currentPropertyId, currentLocation, limitPerScope);
    return results.map(g => ({
      scope: g.scope,
      comments: g.comments.map(c => ({ id: c.id, name: c.name, text: c.text, time: c.created_at, fromAddress: c.fromAddress || "een andere woning", fromUrl: c.fromUrl || null, isOwn: c.user_id === currentUserId })),
    }));
  }

  // ---- Emoji Picker Data ----

  const DEFAULT_EMOJI_SET = new Set(DEFAULT_EMOJI_KEYS);

  const EMOJI_CATEGORIES = {
    "Woning": [["🏠","huis woning"],["🏡","huis tuin"],["🏘️","wijk buurt"],["🏗️","bouw nieuwbouw"],["🏢","appartement"],["🪴","plant tuin"],["🛋️","woonkamer"],["🛏️","slaapkamer"],["🚿","badkamer"],["🔑","sleutel kopen"],["🪟","raam"],["🚪","deur"],["🧱","baksteen"],["🏚️","opknapper"]],
    "Gevoel": [["😍","mooi verliefd"],["🤩","wauw geweldig"],["😊","blij leuk"],["🤔","twijfel hmm"],["😬","oeps yikes"],["😢","jammer helaas"],["😱","schrik duur"],["🥳","feest hoera"],["👀","kijken"],["🙈","oh nee"],["❤️","hart liefde"],["💔","teleurstelling"],["👍","goed akkoord"],["👎","nee afwijzen"]],
    "Geld": [["💰","geld duur"],["💸","kwijt duur"],["🤑","hebberig rijk"],["📉","daling zakking"],["📈","stijging waarde"],["💲","prijs kosten"],["🏦","hypotheek lening"],["💳","betalen"],["🪙","munt geld"]],
    "Locatie": [["📍","locatie plek"],["🚉","station trein"],["🚗","auto parkeren"],["🚲","fiets"],["🌳","park natuur"],["🏫","school kinderen"],["🏥","ziekenhuis"],["🛒","supermarkt"],["🍽️","restaurant"],["☕","koffie cafe"],["🏖️","strand zee"],["⛰️","berg natuur"]],
    "Overig": [["🔥","hot populair"],["⭐","favoriet top"],["✨","nieuw schoon"],["💎","luxe premium"],["🎉","feest verkocht"],["⚠️","waarschuwing"],["❓","vraag onzeker"],["💡","idee tip"],["📸","foto"],["🐶","hond"],["🐱","kat"],["👶","baby gezin"]],
  };

  const ALL_PICKER_EMOJI = Object.values(EMOJI_CATEGORIES).flat();

  // ---- UI Rendering ----

  function renderAvatar(name, size = 28) {
    const bg = avatarColor(name);
    const initial = (name || "?").charAt(0).toUpperCase();
    return `<div class="fr-comment__avatar" style="width:${size}px;height:${size}px;background:${bg}22;color:${bg}">${initial}</div>`;
  }

  async function createPanel() {
    const propertyId = getPropertyId();
    const data = await loadReactions(propertyId);
    const insights = generateInsights();
    const neighborhoodGroups = await findNeighborhoodComments(propertyId, data.location);

    // Haal prijs-per-m² vergelijking, WOZ-data, stads-WOZ-groei en straat-verkooptijd parallel op
    const loc = data.location;
    const streetSlug = loc?.neighborhood || null; // neighborhood-slug == straat-slug in Funda URLs
    const publishedDate = getPublishedOnFundaDate();

    const [priceComparison, wozData, cityWozGrowth, streetSaleStats] = await Promise.all([
      getPricePerM2Comparison(propertyId),
      fetchWozData(getPropertyAddress(), propertyId),
      getCityWozGrowth(data.location?.city || null),
      (loc?.city && streetSlug)
        ? getStreetSaleStats(loc.city, streetSlug)
        : Promise.resolve({ avgSaleDays: null, lastFetchedAt: null }),
    ]);
    const priceComparisonChip  = renderPriceComparisonChip(priceComparison);
    const wozChartHtml         = renderWozChart(wozData, data.priceHistory, cityWozGrowth);
    // Toon het "al x dagen online" blokje alleen als de woning nog niet verkocht/verhuurd is
    const isSold = location.pathname.split('/').some(seg => FUNDA_URL_STATUS_SEGMENTS.has(seg));
    const streetSaleInsightHtml = renderStreetSaleInsight(streetSaleStats.avgSaleDays, isSold ? null : publishedDate);
    dbg('WOZ data:', wozData ? `${wozData.length} waarden` : 'niet gevonden');
    dbg('City WOZ growth:', cityWozGrowth);
    dbg('Street sale stats:', streetSaleStats, 'Published:', publishedDate);

    dbg("property", propertyId, "address:", data.address, "comments:", data.comments.length, "user:", currentDisplayName);

    const myColor = avatarColor(currentDisplayName);
    const myInitial = currentDisplayName.charAt(0).toUpperCase();

    const root = document.createElement("div");
    root.id = "funda-reacties-root";

    const priceChangeBanner = renderPriceChangeBanner(data.priceHistory);

    root.innerHTML = `
      <div class="fr-container">
        <div class="fr-header">
          <h3 class="fr-header__title">
            <span class="fr-header__icon">💬</span>
            Reacties
          </h3>
          <span class="fr-header__count">${data.comments.length} reactie${data.comments.length !== 1 ? "s" : ""}</span>
        </div>

        <div class="fr-quick-reactions" id="fr-emoji-bar">
          ${Object.entries(data.emojis).map(([emoji, info]) => `
            <button class="fr-emoji-btn ${info.active ? "active" : ""}" data-emoji="${emoji}" title="${EMOJI_LABELS[emoji] || emoji}">
              ${emoji}<span class="fr-emoji-btn__count">${info.count || ""}</span>
            </button>`).join("")}
          <button class="fr-emoji-btn fr-emoji-btn--add" id="fr-add-emoji-btn" title="Emoji toevoegen">
            <span class="fr-emoji-btn--add__plus">+</span>
          </button>
          <div class="fr-emoji-picker" id="fr-emoji-picker" style="display:none">
            <div class="fr-emoji-picker__search-wrap">
              <input type="text" class="fr-emoji-picker__search" id="fr-emoji-search" placeholder="Zoek emoji…" />
            </div>
            <div class="fr-emoji-picker__grid" id="fr-emoji-grid"></div>
          </div>
        </div>

        <div class="fr-insights">
          ${insights.map((i) => `<span class="fr-insight-chip"><span class="fr-insight-chip__icon">${i.icon}</span>${i.text}</span>`).join("")}
          ${priceComparisonChip}
        </div>

        ${priceChangeBanner}
        ${streetSaleInsightHtml}
        ${wozChartHtml}

        <div class="fr-compose">
          <div class="fr-compose__wrapper">
            <div class="fr-compose__avatar" style="background:${myColor}22;color:${myColor}">${myInitial}</div>
            <div class="fr-compose__input-group">
              <div class="fr-compose__name-row">
                <span class="fr-compose__name-label">Naam:</span>
                <input
                  class="fr-compose__name-input"
                  id="fr-name-input"
                  type="text"
                  value="${escapeAttr(currentDisplayName)}"
                  maxlength="40"
                  placeholder="Jouw naam"
                />
              </div>
              <textarea class="fr-compose__textarea" id="fr-compose-input" placeholder="Deel je ervaring…" rows="1"></textarea>
              <div class="fr-compose__actions">
                <span class="fr-compose__hint">Zichtbaar voor iedereen met de extensie</span>
                <button class="fr-compose__submit" id="fr-submit-btn" disabled>Plaatsen</button>
              </div>
            </div>
          </div>
        </div>

        <div class="fr-comments-wrapper${data.comments.length > 10 ? " fr-scrollable" : ""}" id="fr-comments-wrapper">
          <ul class="fr-comments" id="fr-comments-list">
            ${renderComments(data.comments, true, data.priceHistory)}
          </ul>
        </div>

        ${renderNeighborhoodGroups(neighborhoodGroups, data.comments.length > 0)}

        ${renderWhispers(enrichWhisperDataWithWoz(getPropertyDataForWhisper(), wozData))}

        <div class="fr-footer">Funda Reacties - voor en door de community</div>
      </div>
    `;

    return { panel: root, commentCount: data.comments.length };
  }

  /**
   * Rendert een insight-chip die aangeeft of de prijs per m² hoger of lager is
   * dan andere woningen in de straat / wijk / stad.
   *
   * @param {{ scope, pct_diff, own_price_per_m2, avg_price_per_m2, count } | null} comparison
   */
  function renderPriceComparisonChip(comparison) {
    if (!comparison || comparison.scope === null || comparison.pct_diff === null) return "";

    const pct     = parseFloat(comparison.pct_diff);
    const count   = comparison.count;
    const scope   = comparison.scope;

    const scopeLabels = { street: 'dan straatgemiddelde', neighborhood: 'dan wijkgemiddelde', city: 'dan stadgemiddelde' };
    const scopeLabel  = scopeLabels[scope] || 'dan buurtgemiddelde';

    const absPct  = Math.abs(pct).toFixed(1).replace('.', ',');
    const cheaper = pct < 0;

    // Drempelwaarde: toon niets als het verschil < 1%
    if (Math.abs(pct) < 1) {
      return `<span class="fr-insight-chip fr-insight-chip--neutral" title="${count} woning${count !== 1 ? 'en' : ''} vergeleken ${scopeLabel}">≈ Marktconform/m² ${scopeLabel}</span>`;
    }

    const cls   = cheaper ? 'fr-insight-chip--cheaper' : 'fr-insight-chip--pricier';
    const icon  = cheaper ? '↓' : '↑';
    const label = cheaper
      ? `${icon} ${absPct}% goedkoper/m² ${scopeLabel}`
      : `${icon} ${absPct}% duurder/m² ${scopeLabel}`;

    const avgFmt = comparison.avg_price_per_m2
      ? `Gem. €\u00a0${Number(comparison.avg_price_per_m2).toLocaleString('nl-NL')}/m² (${count} woning${count !== 1 ? 'en' : ''})`
      : '';

    return `<span class="fr-insight-chip ${cls}" title="${escapeAttr(avgFmt)}">${escapeHtml(label)}</span>`;
  }

  /**
   * Toont een banner als de vraagprijs veranderd is t.o.v. de vorige keer dat
   * de extensie de woning bezocht heeft.
   */
  function renderPriceChangeBanner(priceHistory) {
    if (!priceHistory || priceHistory.length < 2) return "";
    const [latest, previous] = priceHistory;
    if (!latest.price || !previous.price) return "";
    if (latest.price === previous.price) return "";
    const diff  = latest.price - previous.price;
    const pct   = ((diff / previous.price) * 100).toFixed(1);
    const sign  = diff > 0 ? "+" : "";
    const arrow = diff > 0 ? "\u2191" : "\u2193";
    const cls   = diff > 0 ? "fr-price-banner--up" : "fr-price-banner--down";
    const prevFmt = formatPrice(previous.price);
    const nowFmt  = formatPrice(latest.price);
    const dateStr = new Date(previous.recorded_at).toLocaleDateString("nl-NL", { day: "numeric", month: "short" });
    return `<div class="fr-price-banner ${cls}">
      <span class="fr-price-banner__arrow">${arrow}</span>
      <span class="fr-price-banner__text">Vraagprijs veranderd: ${escapeHtml(prevFmt)} \u2192 ${escapeHtml(nowFmt)} <strong>(${sign}${pct}%)</strong> t.o.v.\u00a0${escapeHtml(dateStr)}</span>
    </div>`;
  }

  /**
   * Toont bij een comment of de vraagprijs veranderd is t.o.v. het moment van plaatsen.
   * Zoekt in de price history de entry die gold op commentTime (nieuwste entry ≤ commentTime),
   * en vergelijkt die met de huidige prijs (eerste entry in history = meest recent).
   */
  function renderPriceChange(commentTime, priceHistory) {
    if (!priceHistory || priceHistory.length === 0) return "";
    const commentTs = new Date(commentTime).getTime();
    const atComment = priceHistory.find(h => new Date(h.recorded_at).getTime() <= commentTs);
    const current   = priceHistory[0];
    if (!atComment || !current || !atComment.price || !current.price) return "";
    if (atComment.price === current.price) return "";
    const diff = current.price - atComment.price;
    const pct  = ((diff / atComment.price) * 100).toFixed(0);
    const sign = diff > 0 ? "+" : "";
    const cls  = diff > 0 ? "fr-price-change--up" : "fr-price-change--down";
    return `<div class="fr-price-change ${cls}"><div class="fr-price-change__old">Vraagprijs destijds ${escapeHtml(formatPrice(atComment.price))}</div><div class="fr-price-change__pct">${sign}${pct}%</div></div>`;
  }

  function renderComments(comments, isFirstRender = false, priceHistory = []) {
    // Store all comments for pagination (only on first render)
    if (isFirstRender) {
      allComments = comments;
      allPriceHistory = priceHistory;
      commentsDisplayed = Math.min(10, comments.length);
    }

    const hasOwn = comments.length > 0;

    if (!hasOwn) {
      return `<div class="fr-comments-empty"><div class="fr-empty__icon">🏠</div><p class="fr-empty__text">Nog geen reacties — wees de eerste!</p></div>`;
    }

    const visibleComments = comments.slice(0, commentsDisplayed);
    const hasMoreComments = comments.length > commentsDisplayed;

    const ownHtml = visibleComments.map((c) => {
      const bg = avatarColor(c.name);
      const initial = c.name.charAt(0).toUpperCase();
      const myVote = c.myVote || null;
      const priceTag = renderPriceChange(c.time, priceHistory);
      const ownBadge = c.isOwn ? `<span class="fr-comment__own-badge">jij</span>` : "";
      const disabledUpBtn = c.isOwn ? "disabled" : "";
      const disabledDownBtn = c.isOwn ? "disabled" : "";
      const deleteBtn = c.isOwn ? `<button class="fr-comment__delete-btn" data-comment="${c.id}" title="Verwijderen">✕</button>` : "";
      return `
        <li class="fr-comment${c.isOwn ? " fr-comment--own" : ""}" data-id="${c.id}" data-is-own="${c.isOwn ? "true" : "false"}">
          <div class="fr-comment__top">
            <div class="fr-comment__avatar" style="background:${bg}22;color:${bg}">${initial}</div>
            <span class="fr-comment__name">${escapeHtml(c.name)}</span>
            ${ownBadge}
            <span class="fr-comment__time">${timeAgo(c.time)}</span>
            ${deleteBtn}
          </div>
          <p class="fr-comment__body">${escapeHtml(c.text)}</p>${priceTag}
          <div class="fr-comment__footer">
            <button class="fr-vote-btn fr-vote-btn--up${myVote === "up" ? " active" : ""}" data-vote="up" data-comment="${c.id}" ${disabledUpBtn}>▲ <span>${c.upvotes}</span></button>
            <button class="fr-vote-btn fr-vote-btn--down${myVote === "down" ? " active" : ""}" data-vote="down" data-comment="${c.id}" ${disabledDownBtn}>▼ <span>${c.downvotes}</span></button>
          </div>
        </li>`;
    }).join("");

    const loadMoreBtn = hasMoreComments ? `<button class="fr-load-more-btn" id="fr-load-more">Meer reacties laden (${comments.length - commentsDisplayed} meer)</button>` : "";

    return ownHtml + loadMoreBtn;
  }

  /**
   * Rendert de lokale whisper-observaties altijd onderaan het paneel.
   * Geen DB, geen state — puur gegenereerd op basis van paginadata.
   */
  function renderWhispers(propertyData) {
    const texts = generateWhisperTexts(propertyData);
    if (!texts.length) return "";

    return `
      <div class="fr-whispers">
        <div class="fr-whispers__header">✨ Automatische observaties</div>
        <ul class="fr-whispers__list">
          ${texts.map(t => `
            <li class="fr-whisper-item">
              <div class="fr-comment__avatar" style="background:#8a7e6e22;color:#8a7e6e">✦</div>
              <p class="fr-whisper-item__text">${escapeHtml(t)}</p>
            </li>`).join("")}
        </ul>
      </div>`;
  }

  function renderNeighborhoodGroups(groups, ownCommentsExist) {
    if (!groups || groups.length === 0) return "";
    const totalCount = groups.reduce((n, g) => n + g.comments.length, 0);
    const intro = ownCommentsExist
      ? (totalCount === 1 ? "Ook een reactie" : `Ook ${totalCount} reacties`) + " op andere woningen in de omgeving:"
      : (totalCount === 1 ? "Dit is een reactie" : `Dit zijn ${totalCount} reacties`) + " op andere woningen in de omgeving.";

    return `
      <ul class="fr-comments" style="border-top: 1px solid var(--fr-border);">
        <li class="fr-neighborhood">
          <div class="fr-neighborhood__header"><span>📍 Reacties uit de buurt</span></div>
          <p class="fr-neighborhood__intro">${escapeHtml(intro)}</p>
          <ul class="fr-neighborhood__list">
            ${groups.map((g) => g.comments.map((c) => renderNeighborhoodComment(c, g.scope)).join("")).join("")}
          </ul>
        </li>
      </ul>`;
  }

  function renderNeighborhoodComment(c, scope) {
    const bg = avatarColor(c.name || "");
    const initial = (c.name || "?").charAt(0).toUpperCase();
    const scopeLabel = SCOPE_LABELS[scope] || "In de buurt";
    const ownBadge = c.isOwn ? `<span class="fr-comment__own-badge">jij</span>` : "";
    const footer = c.fromUrl
      ? `<a class="fr-neighborhood-comment__link" href="${escapeAttr(c.fromUrl)}" target="_blank" rel="noopener">${escapeHtml(c.fromAddress || "Bekijk de woning")}</a>`
      : c.fromAddress ? `<span class="fr-neighborhood-comment__source">${escapeHtml(c.fromAddress)}</span>` : "";

    return `
      <li class="fr-neighborhood-comment${c.isOwn ? " fr-comment--own" : ""}">
        <span class="fr-neighborhood-comment__scope">📍 ${escapeHtml(scopeLabel)}</span>
        <div class="fr-neighborhood-comment__top">
          <div class="fr-neighborhood-comment__avatar" style="background:${bg}22;color:${bg}">${initial}</div>
          <span class="fr-neighborhood-comment__name">${escapeHtml(c.name || "Anoniem")}</span>
          ${ownBadge}
          <span class="fr-neighborhood-comment__time">${timeAgo(c.time)}</span>
        </div>
        <p class="fr-neighborhood-comment__body">${escapeHtml(c.text || "")}</p>${footer}
      </li>`;
  }

  function escapeAttr(str) { return String(str).replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function escapeHtml(str) { const d = document.createElement("div"); d.textContent = str; return d.innerHTML; }

  // ---- Emoji Bar ----

  function refreshEmojiBar(root, emojis, propertyId) {
    const bar = root.querySelector("#fr-emoji-bar");
    if (!bar) return;
    bar.innerHTML = `
      ${Object.entries(emojis).map(([emoji, info]) => `
        <button class="fr-emoji-btn ${info.active ? "active" : ""}" data-emoji="${emoji}" title="${EMOJI_LABELS[emoji] || emoji}">
          ${emoji}<span class="fr-emoji-btn__count">${info.count || ""}</span>
        </button>`).join("")}
      <button class="fr-emoji-btn fr-emoji-btn--add" id="fr-add-emoji-btn" title="Emoji toevoegen"><span class="fr-emoji-btn--add__plus">+</span></button>
      <div class="fr-emoji-picker" id="fr-emoji-picker" style="display:none">
        <div class="fr-emoji-picker__search-wrap"><input type="text" class="fr-emoji-picker__search" id="fr-emoji-search" placeholder="Zoek emoji…" /></div>
        <div class="fr-emoji-picker__grid" id="fr-emoji-grid"></div>
      </div>`;
    attachEmojiBarEvents(root, emojis, propertyId);
  }

  function attachEmojiBarEvents(root, emojis, propertyId) {
    const userId = currentUserId;

    root.querySelectorAll(".fr-emoji-btn[data-emoji]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const emoji = btn.dataset.emoji;
        const info = emojis[emoji] || { count: 0, active: false };
        if (info.active) { info.count = Math.max(0, info.count - 1); info.active = false; btn.classList.remove("active"); }
        else { info.count++; info.active = true; btn.classList.add("active"); }
        btn.querySelector(".fr-emoji-btn__count").textContent = info.count || "";
        const result = await toggleEmojiReaction(propertyId, emoji, userId);
        info.count = result.count; info.active = result.active;
        btn.querySelector(".fr-emoji-btn__count").textContent = info.count || "";
        btn.classList.toggle("active", info.active);
        if (info.count === 0 && !DEFAULT_EMOJI_SET.has(emoji)) { delete emojis[emoji]; refreshEmojiBar(root, emojis, propertyId); }
      });
    });

    const addBtn = root.querySelector("#fr-add-emoji-btn");
    const picker = root.querySelector("#fr-emoji-picker");
    const grid = root.querySelector("#fr-emoji-grid");
    const searchInput = root.querySelector("#fr-emoji-search");

    function renderPickerGrid(filter) {
      const filt = (filter || "").trim().toLowerCase();
      const alreadyInBar = new Set(Object.keys(emojis));
      let html = "";
      if (filt) {
        const matches = ALL_PICKER_EMOJI.filter(([e, keywords]) => !alreadyInBar.has(e) && (keywords.toLowerCase().includes(filt) || Object.entries(EMOJI_CATEGORIES).some(([cat, list]) => list.some(([le]) => le === e) && cat.toLowerCase().includes(filt))));
        html = matches.length > 0 ? matches.map(([e]) => `<button class="fr-emoji-picker__item" data-pick="${e}">${e}</button>`).join("") : `<div class="fr-emoji-picker__category">Geen resultaten</div>`;
      } else {
        for (const [cat, categoryEmojis] of Object.entries(EMOJI_CATEGORIES)) {
          const filtered = categoryEmojis.filter(([e]) => !alreadyInBar.has(e));
          if (!filtered.length) continue;
          html += `<div class="fr-emoji-picker__category">${escapeHtml(cat)}</div>`;
          html += filtered.map(([e]) => `<button class="fr-emoji-picker__item" data-pick="${e}">${e}</button>`).join("");
        }
      }
      grid.innerHTML = html;
      grid.querySelectorAll(".fr-emoji-picker__item").forEach((item) => {
        item.addEventListener("click", async () => {
          picker.style.display = "none"; searchInput.value = "";
          const result = await toggleEmojiReaction(propertyId, item.dataset.pick, userId);
          emojis[item.dataset.pick] = { count: result.count, active: result.active };
          refreshEmojiBar(root, emojis, propertyId);
        });
      });
    }

    addBtn.addEventListener("click", (e) => { e.stopPropagation(); const v = picker.style.display !== "none"; picker.style.display = v ? "none" : ""; if (!v) { renderPickerGrid(""); setTimeout(() => searchInput.focus(), 50); } });
    searchInput.addEventListener("input", () => renderPickerGrid(searchInput.value));
    picker.addEventListener("click", (e) => e.stopPropagation());
  }

  // ---- Event Handlers ----

  function attachEvents(root) {
    const propertyId = getPropertyId();

    // Haal emoji-counts op (lightweight — enkel die tabel, vermijdt dubbele loadReactions)
    getEmojiCounts(propertyId, currentUserId).then(async (emojiCounts) => {
      const emojis = {};
      for (const { emoji } of DEFAULT_EMOJIS) emojis[emoji] = emojiCounts[emoji] || { count: 0, active: false };
      for (const [emoji, info] of Object.entries(emojiCounts)) { if (!emojis[emoji]) emojis[emoji] = info; }
      attachEmojiBarEvents(root, emojis, propertyId);

      document.addEventListener("click", () => {
        const picker = root.querySelector("#fr-emoji-picker");
        if (picker) picker.style.display = "none";
      });

      const textarea = root.querySelector("#fr-compose-input");
      const submitBtn = root.querySelector("#fr-submit-btn");
      const nameInput = root.querySelector("#fr-name-input");
      const avatarEl = root.querySelector(".fr-compose__avatar");

      // Live naam-update in avatar en opslaan
      nameInput.addEventListener("input", () => {
        const newName = nameInput.value.trim() || currentDisplayName;
        const bg = avatarColor(newName);
        avatarEl.style.background = `${bg}22`;
        avatarEl.style.color = bg;
        avatarEl.textContent = newName.charAt(0).toUpperCase();
      });

      nameInput.addEventListener("change", async () => {
        const newName = nameInput.value.trim();
        if (newName && newName !== currentDisplayName) {
          currentDisplayName = newName;
          await saveDisplayName(newName);
          dbg("displayName opgeslagen:", newName);
        }
      });

      textarea.addEventListener("input", () => {
        submitBtn.disabled = textarea.value.trim().length === 0 || textarea.value.length > 1000;
        textarea.style.height = "auto";
        textarea.style.height = textarea.scrollHeight + "px";
      });

      submitBtn.addEventListener("click", async () => {
        const text = textarea.value.trim();
        if (!text || text.length > 1000) return;

        // Sla eventuele naamswijziging op vóór plaatsen
        const typedName = nameInput.value.trim();
        if (typedName && typedName !== currentDisplayName) {
          currentDisplayName = typedName;
          await saveDisplayName(typedName);
        }

        submitBtn.disabled = true;
        submitBtn.textContent = "Bezig…";

        const sanitizedText = sanitizeComment(text);
        if (!sanitizedText) {
          submitBtn.textContent = "Plaatsen";
          submitBtn.disabled = false;
          return;
        }

        const newComment = await postComment(propertyId, sanitizedText, currentDisplayName, currentUserId);

        if (newComment) {
          const freshData = await loadReactions(propertyId);
          const neighborhoodGroups = await findNeighborhoodComments(propertyId, freshData.location);
          const list = root.querySelector("#fr-comments-list");
          const wrapper = root.querySelector("#fr-comments-wrapper");
          allComments = freshData.comments;
          allPriceHistory = freshData.priceHistory;
          commentsDisplayed = Math.min(10, freshData.comments.length);
          list.innerHTML = renderComments(freshData.comments, false, freshData.priceHistory);
          wrapper.classList.toggle("fr-scrollable", freshData.comments.length > 10);
          const neighborhoodHtml = renderNeighborhoodGroups(neighborhoodGroups, freshData.comments.length > 0);
          if (neighborhoodHtml && !root.querySelector(".fr-neighborhood")) {
            list.parentElement.insertAdjacentHTML("afterend", neighborhoodHtml);
          }
          attachVoteEvents(root, propertyId);
          attachDeleteEvents(root, propertyId);
          attachLoadMoreHandler(root, propertyId);
          root.querySelector(".fr-header__count").textContent = `${freshData.comments.length} reactie${freshData.comments.length !== 1 ? "s" : ""}`;
          chrome.runtime.sendMessage({ type: "UPDATE_BADGE", count: freshData.comments.length });
        } else {
          dbg("Error: comment niet geplaatst");
        }

        textarea.value = "";
        textarea.style.height = "auto";
        submitBtn.textContent = "Plaatsen";
        submitBtn.disabled = true;
      });

      attachVoteEvents(root, propertyId);
      attachDeleteEvents(root, propertyId);
      attachLoadMoreHandler(root, propertyId);
      setupRealtimeSubscription(root, propertyId);
    });
  }

  function setupRealtimeSubscription(root, propertyId) {
    if (realtimeChannel) unsubscribeFromPropertyUpdates(realtimeChannel);
    realtimeChannel = subscribeToPropertyUpdates(propertyId, currentUserId, async (newComment) => {
      dbg("Realtime: nieuwe comment", newComment);
      try {
        chrome.runtime.sendMessage({
          type: "SHOW_NOTIFICATION",
          title: `💬 Nieuwe reactie op ${getPropertyAddress() || "een woning"}`,
          message: `${newComment.name}: ${newComment.text.substring(0, 80)}${newComment.text.length > 80 ? "…" : ""}`,
          propertyUrl: getPropertyUrl(),
        });
      } catch (e) { dbg("Notification error:", e); }

      // Kleine delay zodat Supabase realtime updates kan verwerken
      await new Promise(resolve => setTimeout(resolve, 200));
      const freshData = await loadReactions(propertyId);
      const list = root.querySelector("#fr-comments-list");
      if (list) {
        allComments = freshData.comments;
        allPriceHistory = freshData.priceHistory;
        commentsDisplayed = Math.min(10, freshData.comments.length);
        list.innerHTML = renderComments(freshData.comments, false, freshData.priceHistory);
        attachVoteEvents(root, propertyId);
        attachDeleteEvents(root, propertyId);
      }
      const countEl = root.querySelector(".fr-header__count");
      if (countEl) countEl.textContent = `${freshData.comments.length} reactie${freshData.comments.length !== 1 ? "s" : ""}`;
      chrome.runtime.sendMessage({ type: "UPDATE_BADGE", count: freshData.comments.length });
    });
  }

  function attachDeleteEvents(root, propertyId) {
    const userId = currentUserId;
    root.querySelectorAll(".fr-comment__delete-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm("Weet je zeker dat je deze reactie wilt verwijderen?")) return;
        const commentId = btn.dataset.comment;
        const success = await deleteComment(commentId, userId);
        if (success) {
          // Wacht even tot Supabase de delete heeft verwerkt
          await new Promise(resolve => setTimeout(resolve, 300));
          const freshData = await loadReactions(propertyId);
          const list = root.querySelector("#fr-comments-list");
          const wrapper = root.querySelector("#fr-comments-wrapper");
          allComments = freshData.comments;
          allPriceHistory = freshData.priceHistory;
          commentsDisplayed = Math.min(10, freshData.comments.length);
          list.innerHTML = renderComments(freshData.comments, false, freshData.priceHistory);
          wrapper.classList.toggle("fr-scrollable", freshData.comments.length > 10);
          attachVoteEvents(root, propertyId);
          attachDeleteEvents(root, propertyId);
          attachLoadMoreHandler(root, propertyId);
          root.querySelector(".fr-header__count").textContent = `${freshData.comments.length} reactie${freshData.comments.length !== 1 ? "s" : ""}`;
          chrome.runtime.sendMessage({ type: "UPDATE_BADGE", count: freshData.comments.length });
        } else {
          alert("Fout bij verwijderen van reactie. Check je internet connectie.");
        }
      });
    });
  }

  function attachVoteEvents(root, propertyId) {
    const userId = currentUserId;
    root.querySelectorAll(".fr-vote-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const commentEl = btn.closest(".fr-comment");
        if (!commentEl) return;
        const isOwn = commentEl.dataset.isOwn === "true";
        if (isOwn) return;
        const commentId = btn.dataset.comment;
        const direction = btn.dataset.vote;
        const upBtn = commentEl.querySelector('.fr-vote-btn--up');
        const downBtn = commentEl.querySelector('.fr-vote-btn--down');
        if (btn.classList.contains("active")) { btn.classList.remove("active"); }
        else { upBtn.classList.remove("active"); downBtn.classList.remove("active"); btn.classList.add("active"); }
        const result = await voteComment(commentId, userId, direction);
        if (result) { upBtn.querySelector("span").textContent = result.upvotes; downBtn.querySelector("span").textContent = result.downvotes; }
      });
    });
  }

  function attachLoadMoreHandler(root, propertyId) {
    const loadMoreBtn = root.querySelector("#fr-load-more");
    if (!loadMoreBtn) return;

    loadMoreBtn.addEventListener("click", () => {
      commentsDisplayed += 10;
      const list = root.querySelector("#fr-comments-list");
      const wrapper = root.querySelector("#fr-comments-wrapper");
      list.innerHTML = renderComments(allComments, false, allPriceHistory);
      wrapper.classList.toggle("fr-scrollable", allComments.length > 10);
      attachVoteEvents(root, propertyId);
      attachLoadMoreHandler(root, propertyId);
    });
  }

  // ---- Injection ----

  function isDetailPage() {
    // Sluit media-subpagina's uit (foto, video, 360, plattegrond, etc.)
    if (/\/media\/|\/(foto|video|360|plattegrond|document)[\/\d]*/i.test(location.pathname)) return false;
    return /\/(detail\/koop|detail\/huur|koop\/[^/]+\/[^/]+|huur\/[^/]+\/[^/]+)/.test(location.pathname);
  }

  function findAgentPanel() {
    const cardCandidates = document.querySelectorAll('.bg-secondary-10.rounded-lg');
    for (const card of cardCandidates) {
      const text = (card.textContent || "").toLowerCase();
      if (text.includes("neem contact op") || text.includes("toon telefoonnummer")) return card;
    }
    const gridContainer = document.querySelector('[class*="grid-cols-"][class*="7fr"]');
    if (gridContainer?.children[1]) { const firstCard = gridContainer.children[1].querySelector('.rounded-lg'); if (firstCard) return firstCard; }
    for (const link of document.querySelectorAll("a")) {
      const text = (link.textContent || "").trim().toLowerCase();
      if (text.includes("neem contact op") && link.href?.includes("makelaar-contact")) {
        let parent = link.parentElement;
        for (let depth = 0; depth < 15 && parent; depth++) {
          if (parent.classList && (parent.classList.contains("rounded-lg") || parent.classList.contains("bg-secondary-10")) && parent.getBoundingClientRect().height > 100) return parent;
          parent = parent.parentElement;
        }
      }
    }
    const brochureLink = document.querySelector('a[href*="valentina_media"][download]');
    if (brochureLink?.parentElement) { const card = brochureLink.parentElement.querySelector('.rounded-lg'); if (card) return card; }
    return null;
  }

  function findFallbackInjectionPoint() {
    const gridContainer = document.querySelector('[class*="grid-cols-"][class*="7fr"]');
    if (gridContainer?.children[1]) return gridContainer.children[1];
    for (const sel of ['aside', '[class*="sidebar"]', '[role="complementary"]']) { const el = document.querySelector(sel); if (el && el.getBoundingClientRect().width > 100) return el; }
    for (const sel of ['main', '#content', '#__nuxt', '.container', 'article']) { const el = document.querySelector(sel); if (el) return el; }
    return document.body;
  }

  function buildSkeletonPlaceholder() {
    const insights = generateInsights();
    const insightsHtml = insights.length > 0
      ? `<div class="fr-insights">${insights.map((i) => `<span class="fr-insight-chip"><span class="fr-insight-chip__icon">${i.icon}</span>${i.text}</span>`).join("")}</div>`
      : "";

    const el = document.createElement("div");
    el.id = "funda-reacties-root";
    el.innerHTML = `
      <div class="fr-container">
        <div class="fr-header">
          <h3 class="fr-header__title"><span class="fr-header__icon">💬</span>Reacties</h3>
          <span class="fr-header__count fr-header__count--loading">laden…</span>
        </div>
        <div class="fr-quick-reactions">
          ${DEFAULT_EMOJIS.map(({ emoji, label }) => `<button class="fr-emoji-btn fr-emoji-btn--skeleton" disabled title="${label}">${emoji}<span class="fr-emoji-btn__count"></span></button>`).join("")}
        </div>
        ${insightsHtml}
        <div class="fr-compose">
          <div class="fr-compose__wrapper">
            <div class="fr-compose__avatar" style="background:#e86c2a22;color:#e86c2a">?</div>
            <div class="fr-compose__input-group">
              <div class="fr-compose__name-row">
                <span class="fr-compose__name-label">Naam:</span>
                <input class="fr-compose__name-input" type="text" value="" disabled placeholder="Laden…" />
              </div>
              <textarea class="fr-compose__textarea" placeholder="Deel je ervaring…" rows="1" disabled></textarea>
              <div class="fr-compose__actions">
                <span class="fr-compose__hint">Zichtbaar voor iedereen met de extensie</span>
                <button class="fr-compose__submit" disabled>Plaatsen</button>
              </div>
            </div>
          </div>
        </div>
        <ul class="fr-comments">
          <li class="fr-skeleton"><div class="fr-skeleton__line" style="width:40%"></div><div class="fr-skeleton__line" style="width:90%"></div><div class="fr-skeleton__line" style="width:65%"></div></li>
          <li class="fr-skeleton"><div class="fr-skeleton__line" style="width:35%"></div><div class="fr-skeleton__line" style="width:80%"></div><div class="fr-skeleton__line" style="width:50%"></div></li>
        </ul>
        <div class="fr-footer">Funda Reacties - voor en door de community</div>
      </div>`;
    return el;
  }

  async function inject() {
    if (!isDetailPage()) return;
    if (document.getElementById("funda-reacties-root")) return;

    // Controleer of we een geldig numeriek property ID hebben
    const propertyId = getPropertyId();
    if (!propertyId) {
      dbg("Geen geldig numeriek property ID gevonden, panel niet injecteren.", location.pathname);
      return;
    }

    // Laad profiel (userId + displayName)
    const profile = await getUserProfile();
    currentUserId = profile.userId;
    currentDisplayName = profile.displayName;
    dbg("Profiel geladen:", profile);

    const placeholder = buildSkeletonPlaceholder();
    const agentPanel = findAgentPanel();
    if (agentPanel) {
      agentPanel.parentNode.insertBefore(placeholder, agentPanel);
      placeholder.style.marginTop = "0";
      placeholder.style.marginBottom = "16px";
    } else {
      findFallbackInjectionPoint().appendChild(placeholder);
    }

    try {
      const { panel, commentCount } = await createPanel();
      placeholder.replaceWith(panel);
      if (agentPanel) { panel.style.marginTop = "0"; panel.style.marginBottom = "16px"; }
      attachEvents(panel);
      await watchLoginState(panel);
      const propertyId = getPropertyId();
      if (/^\d{6,}$/.test(propertyId)) trackPropertyView(propertyId);
      chrome.runtime.sendMessage({ type: "UPDATE_BADGE", count: commentCount });
      dbg("✅ Panel fully rendered");
    } catch (error) {
      console.error("[Funda Reacties] Error rendering panel:", error);
      const header = placeholder.querySelector(".fr-header__count");
      if (header) header.textContent = "fout";
      const commentsList = placeholder.querySelector(".fr-comments");
      if (commentsList) commentsList.innerHTML = `<li class="fr-empty"><div class="fr-empty__icon">⚠️</div><p class="fr-empty__text">Fout bij laden: ${escapeHtml(error.message)}</p></li>`;
    }
  }

  function isLoggedInFromDOM() {
    const spans = document.querySelectorAll('button[type="submit"] span');
    for (const span of spans) {
      if (span.textContent.trim() === 'Inloggen') return false;
    }
    const accountBtn = document.querySelector('button[aria-label="Open menu item"]');
    if (accountBtn) return true;
    return false;
  }

  async function applyProfileToPanel(root, profile, explicitPreviousUserId) {
    if (!profile.fundaEmail) return;

    const previousUserId = explicitPreviousUserId || currentUserId;
    currentUserId      = profile.userId;
    currentDisplayName = profile.displayName;

    console.log('[Funda Reacties] applyProfileToPanel:', { previousUserId, newUserId: profile.userId });

    if (previousUserId && previousUserId !== profile.userId) {
      console.log('[Funda Reacties] Migratie nodig: anoniem → Funda');
      await migrateAnonymousData(previousUserId, profile.userId, profile.displayName);
      const propertyId = getPropertyId();
      const freshData = await loadReactions(propertyId);
      const list = root.querySelector('#fr-comments-list');
      if (list) {
        allComments = freshData.comments;
        allPriceHistory = freshData.priceHistory;
        commentsDisplayed = Math.min(10, freshData.comments.length);
        list.innerHTML = renderComments(freshData.comments, false, freshData.priceHistory);
        attachVoteEvents(root, propertyId);
        attachDeleteEvents(root, propertyId);
        attachLoadMoreHandler(root, propertyId);
      }
    } else {
      chrome.storage.local.get(['previousUserId'], async ({ previousUserId: storedPrev }) => {
        if (storedPrev && storedPrev !== profile.userId) {
          await migrateAnonymousData(storedPrev, profile.userId, profile.displayName);
        }
      });
    }

    const nameInput = root.querySelector('#fr-name-input');
    if (nameInput) nameInput.value = currentDisplayName;

    const avatarEl = root.querySelector('.fr-compose__avatar');
    if (avatarEl) {
      const bg = avatarColor(currentDisplayName);
      avatarEl.style.background = `${bg}22`;
      avatarEl.style.color = bg;
      avatarEl.textContent = currentDisplayName.charAt(0).toUpperCase();
    }
  }

  async function checkLoginAndUpdatePanel(root) {
    const loggedIn = isLoggedInFromDOM();
    const stored = await new Promise(resolve => chrome.storage.local.get(['fundaEmail'], resolve));

    if (stored.fundaEmail && !loggedIn) {
      dbg('Uitgelogd gedetecteerd, storage opschonen');
      await new Promise(resolve => chrome.storage.local.remove(['fundaEmail', 'userId', 'displayName', 'previousUserId'], resolve));
      resetProfileCache();
      return;
    }

    if (stored.fundaEmail && loggedIn) {
      dbg('fundaEmail al bekend:', stored.fundaEmail);
      const profile = await getUserProfile();
      await applyProfileToPanel(root, profile);
      return;
    }

    if (!loggedIn) return;

    const anonUserId = currentUserId;
    const account = await detectFundaAccountFromFetch();
    if (!account?.email) return;

    const fundaUserId = `funda:${account.email}`;
    const displayName = account.name || currentDisplayName;

    await new Promise(resolve => chrome.storage.local.set({
      fundaEmail: account.email,
      userId:     fundaUserId,
      displayName,
    }, resolve));

    resetProfileCache();
    const profile = await getUserProfile();
    await applyProfileToPanel(root, profile, anonUserId);
  }

  async function watchLoginState(root) {
    await checkLoginAndUpdatePanel(root);
  }

  let retryCount = 0;
  const maxRetries = 15;

  function attemptInject() {
    if (document.getElementById("funda-reacties-root")) return;
    if (!isDetailPage()) return;
    if (retryCount >= maxRetries) { inject(); return; }
    retryCount++;
    if (document.querySelector('h1') || document.querySelector('[class*="price"]')) inject();
    if (!document.getElementById("funda-reacties-root")) setTimeout(attemptInject, 400 + retryCount * 200);
  }

  attemptInject();

  let lastUrl = location.href;
  const observer = new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      retryCount = 0;
      if (realtimeChannel) { unsubscribeFromPropertyUpdates(realtimeChannel); realtimeChannel = null; }
      const existing = document.getElementById("funda-reacties-root");
      if (existing) existing.remove();
      setTimeout(attemptInject, 300);
    }
    if (!document.getElementById("funda-reacties-root") && isDetailPage() && retryCount < maxRetries) attemptInject();
  });
  observer.observe(document.body, { childList: true, subtree: true });
})();
