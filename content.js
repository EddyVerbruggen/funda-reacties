// ==========================================================================
// Funda Reacties — Content Script (Supabase Edition)
// Injects a comment/reaction panel into Funda property detail pages.
// All data is stored in Supabase for multi-user sharing.
// ==========================================================================

(function () {
  "use strict";

  // ---- State ----
  let currentUserId = null;
  let realtimeChannel = null;

  // ---- Helpers ----

  function getPropertyId() {
    const path = location.pathname.replace(/\/+$/, "");
    const numericMatch = path.match(/\/(\d{6,})$/);
    if (numericMatch) return numericMatch[1];
    return path.replace(/\//g, "_").replace(/^_/, "");
  }

  function getPropertyAddress() {
    const h1 = document.querySelector("h1");
    let streetPart = "";

    if (h1) {
      const raw = (h1.textContent || "").trim();
      const postcodeIdx = raw.search(/\d{4}\s?[A-Z]{2}/);
      if (postcodeIdx > 0) {
        streetPart = raw.slice(0, postcodeIdx).trim();
      } else {
        streetPart = raw;
      }
    }

    const cityMatch = location.pathname.match(/\/(?:detail\/)?(?:koop|huur)\/([^/]+)\//);
    const cityTitle = cityMatch ? titleCase(decodeURIComponent(cityMatch[1])) : "";

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

    const cityMatch = location.pathname.match(/\/(?:detail\/)?(?:koop|huur)\/([^/]+)\//);
    if (cityMatch) {
      loc.city = decodeURIComponent(cityMatch[1]).toLowerCase();
    }

    const h1 = document.querySelector("h1");
    if (h1) {
      const raw = (h1.textContent || "").trim();
      const postcodeIdx = raw.search(/\d{4}\s?[A-Z]{2}/);
      const streetWithNumber = postcodeIdx > 0 ? raw.slice(0, postcodeIdx).trim() : raw;
      const street = streetWithNumber.replace(/\s+\d+[a-zA-Z]?(?:[-/]\d+[a-zA-Z]?)?\s*$/, "").trim();
      if (street) loc.street = street.toLowerCase();
    }

    try {
      const candidateLinks = [];
      if (h1) candidateLinks.push(...h1.querySelectorAll("a[href]"));
      if (h1 && h1.parentElement) candidateLinks.push(...h1.parentElement.querySelectorAll("a[href]"));

      for (const a of candidateLinks) {
        const href = a.getAttribute("href") || "";
        let path = href;
        try { const u = new URL(href, location.origin); path = u.pathname; } catch (e) {}
        path = path.replace(/\/+$/, "");
        const segments = path.split("/").filter(Boolean);

        if (segments.length === 3 && (segments[0] === "koop" || segments[0] === "huur")) {
          const [, hrefCity, hrefSlug] = segments;
          if (loc.city && hrefCity.toLowerCase() !== loc.city) continue;
          if (/^huis-|^appartement-|^woonhuis-/.test(hrefSlug)) continue;
          loc.neighborhood = hrefSlug.toLowerCase();
          break;
        }

        if (segments.length === 3 && segments[0] === "informatie") {
          const [, hrefCity, hrefSlug] = segments;
          if (loc.city && hrefCity.toLowerCase() !== loc.city) continue;
          loc.neighborhood = hrefSlug.toLowerCase();
          break;
        }
      }
    } catch (e) {}

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
    const cleaned = priceStr.replace(/[^\d.,]/g, "").replace(/\./g, "").replace(",", ".");
    const num = parseInt(cleaned, 10);
    return isNaN(num) ? null : num;
  }

  function timeAgo(dateString) {
    const now = Date.now();
    const then = new Date(dateString).getTime();
    const diff = Math.floor((now - then) / 1000);
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

    const sinceStr = findDd("aangeboden sinds", "datum van aanmelding");
    if (sinceStr) {
      const parsed = parseDutchDate(sinceStr);
      if (parsed) {
        const days = Math.floor((Date.now() - parsed.getTime()) / 86400000);
        if (days >= 0) insights.push({ icon: "📅", text: `${days} dagen online` });
      }
    }

    const areaStr = findDd("wonen", "woonoppervlakte", "gebruiksoppervlakte wonen");
    let livingArea = null;
    if (areaStr) { const m = areaStr.match(/([\d.,]+)\s*m/i); if (m) livingArea = parseInt(m[1].replace(/\./g, ""), 10); }
    const priceNum = parsePrice(getAskingPrice());
    if (livingArea > 0 && priceNum > 0) {
      insights.push({ icon: "📋", text: `€ ${Math.round(priceNum / livingArea).toLocaleString("nl-NL")}/m²` });
    } else if (livingArea > 0) {
      insights.push({ icon: "📋", text: `${livingArea} m² wonen` });
    }

    const energyLabel = findDd("energielabel");
    if (energyLabel && energyLabel.length <= 5) insights.push({ icon: "⚡", text: energyLabel });

    const buildYear = findDd("bouwjaar");
    if (buildYear && /^\d{4}$/.test(buildYear)) insights.push({ icon: "🏗️", text: buildYear });

    const rooms = findDd("aantal kamers");
    if (rooms) insights.push({ icon: "🛏️", text: rooms });

    return insights;
  }

  function parseDutchDate(str) {
    const months = {
      januari: 0, februari: 1, maart: 2, april: 3, mei: 4, juni: 5,
      juli: 6, augustus: 7, september: 8, oktober: 9, november: 10, december: 11,
      jan: 0, feb: 1, mrt: 2, apr: 3, jun: 5, jul: 6, aug: 7, sep: 8, okt: 9, nov: 10, dec: 11,
    };
    const cleaned = str.replace(/\./g, "").trim().toLowerCase();
    const m = cleaned.match(/(\d{1,2})\s+([a-z]+)\s+(\d{4})/);
    if (!m) return null;
    const monthIdx = months[m[2]];
    if (monthIdx === undefined) return null;
    return new Date(parseInt(m[3], 10), monthIdx, parseInt(m[1], 10));
  }

  // ---- Supabase Data Layer ----

  const DEFAULT_EMOJIS = ["🔥", "😍", "🤔", "💸", "📉", "🏡"];

  async function loadReactions(propertyId) {
    const userId = currentUserId;

    await upsertProperty(propertyId, getPropertyAddress(), getPropertyUrl(), getPropertyLocation());

    const emojiCounts = await getEmojiCounts(propertyId, userId);

    const emojis = {};
    for (const e of DEFAULT_EMOJIS) emojis[e] = emojiCounts[e] || { count: 0, active: false };
    for (const [e, info] of Object.entries(emojiCounts)) { if (!emojis[e]) emojis[e] = info; }

    const { data: rawComments, error: commentsError } = await supabaseClient
      .from('comments')
      .select('*, votes(*)')
      .eq('property_id', propertyId)
      .order('created_at', { ascending: false });

    if (commentsError) console.error('Error loading comments:', commentsError);

    const comments = (rawComments || []).map(c => {
      const upvotes = (c.votes || []).filter(v => v.vote_type === 'up').length;
      const downvotes = (c.votes || []).filter(v => v.vote_type === 'down').length;
      const myVote = (c.votes || []).find(v => v.user_id === userId);
      return {
        id: c.id, name: c.name, text: c.text, time: c.created_at,
        askingPrice: c.asking_price, upvotes, downvotes,
        myVote: myVote ? myVote.vote_type : null,
      };
    });

    return { address: getPropertyAddress(), url: getPropertyUrl(), location: getPropertyLocation(), emojis, comments };
  }

  // ---- Neighborhood Aggregation ----

  const SCOPE_ORDER = ["street", "neighborhood", "city", "region", "province"];
  const SCOPE_LABELS = {
    street: "Zelfde straat", neighborhood: "Zelfde wijk", city: "Zelfde stad",
    region: "Zelfde regio", province: "Zelfde provincie",
  };

  async function findNeighborhoodComments(currentPropertyId, currentLocation, limitPerScope = 3) {
    if (!currentLocation || Object.keys(currentLocation).length === 0) {
      dbg("buurt: geen location voor huidige property, skip");
      return [];
    }
    dbg("buurt: zoek buren voor property", currentPropertyId, "location:", currentLocation);

    const results = await getNeighborhoodComments(currentPropertyId, currentLocation, limitPerScope);
    dbg("buurt: eindresultaat groepen:", results.map((g) => `${g.scope}=${g.comments.length}`).join(", ") || "(leeg)");

    return results.map(g => ({
      scope: g.scope,
      comments: g.comments.map(c => ({
        id: c.id, name: c.name, text: c.text, time: c.created_at,
        fromAddress: c.fromAddress || "een andere woning",
        fromUrl: c.fromUrl || null,
      })),
    }));
  }

  // ---- Emoji Picker Data ----

  const DEFAULT_EMOJI_SET = new Set(DEFAULT_EMOJIS);

  const EMOJI_CATEGORIES = {
    "Woning": [
      ["🏠", "huis woning huis"], ["🏡", "huis tuin woning"], ["🏘️", "wijk huizen buurt"],
      ["🏗️", "bouw nieuwbouw constructie"], ["🏢", "kantoor gebouw appartement"],
      ["🪴", "plant groen tuin"], ["🛋️", "bank woonkamer meubel"], ["🛏️", "bed slaapkamer"],
      ["🚿", "douche badkamer"], ["🔑", "sleutel kopen verkocht"], ["🪟", "raam venster licht"],
      ["🚪", "deur ingang"], ["🧱", "steen muur baksteen"], ["🏚️", "oud vervallen opknapper"],
    ],
    "Gevoel": [
      ["😍", "mooi prachtig verliefd love"], ["🤩", "wauw geweldig star"],
      ["😊", "blij leuk fijn"], ["🤔", "twijfel denken hmm"],
      ["😬", "oeps awkward yikes"], ["😢", "verdrietig jammer helaas"],
      ["😱", "schrik shock duur"], ["🥳", "feest party verkocht hoera"],
      ["👀", "kijken bezichtigen ogen"], ["🙈", "oh nee niet kijken"],
      ["❤️", "hart liefde love"], ["💔", "teleurstelling gebroken hart"],
      ["👍", "goed top prima akkoord"], ["👎", "slecht nee afwijzen"],
    ],
    "Geld": [
      ["💰", "geld rijk duur prijs"], ["💸", "geld weg duur kwijt"],
      ["🤑", "geld hebberig rijk"], ["📉", "daling goedkoper zakking"],
      ["📈", "stijging duurder waarde"], ["💲", "prijs kosten dollar"],
      ["🏦", "bank hypotheek lening"], ["💳", "betalen creditcard"], ["🪙", "munt geld"],
    ],
    "Locatie": [
      ["📍", "locatie plek plek"], ["🚉", "station trein ov"],
      ["🚗", "auto parkeren weg"], ["🚲", "fiets fietsen"],
      ["🌳", "boom park natuur groen"], ["🏫", "school onderwijs kinderen"],
      ["🏥", "ziekenhuis gezondheid"], ["🛒", "supermarkt winkelen boodschappen"],
      ["🍽️", "restaurant eten uit"], ["☕", "koffie cafe horeca"],
      ["🏖️", "strand zee vakantie"], ["⛰️", "berg natuur uitzicht"],
    ],
    "Overig": [
      ["🔥", "hot populair gewild"], ["⭐", "ster favoriet top"],
      ["✨", "nieuw schoon fris"], ["💎", "luxe premium diamant"],
      ["🎉", "feest gefeliciteerd verkocht"], ["⚠️", "waarschuwing let op"],
      ["❓", "vraag onzeker"], ["💡", "idee tip"],
      ["📸", "foto camera beeld"], ["🐶", "hond huisdier"],
      ["🐱", "kat poes huisdier"], ["👶", "baby kind gezin"],
    ],
  };

  const ALL_PICKER_EMOJI = Object.values(EMOJI_CATEGORIES).flat();

  // ---- UI Rendering ----

  /**
   * Render the full panel once all data has loaded.
   * Called after the skeleton placeholder is already visible.
   */
  async function createPanel() {
    const propertyId = getPropertyId();
    const data = await loadReactions(propertyId);
    const insights = generateInsights();

    dbg("property", propertyId, "address:", data.address, "location:", data.location, "comments:", data.comments.length);

    const neighborhoodGroups = await findNeighborhoodComments(propertyId, data.location);

    const root = document.createElement("div");
    root.id = "funda-reacties-root";

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
            <button class="fr-emoji-btn ${info.active ? "active" : ""}" data-emoji="${emoji}">
              ${emoji}
              <span class="fr-emoji-btn__count">${info.count || ""}</span>
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
        </div>

        <div class="fr-compose">
          <div class="fr-compose__wrapper">
            <div class="fr-compose__avatar" style="background:#e86c2a22;color:#e86c2a">?</div>
            <div class="fr-compose__input-group">
              <textarea class="fr-compose__textarea" id="fr-compose-input" placeholder="Deel je ervaring…" rows="1"></textarea>
              <div class="fr-compose__actions">
                <span class="fr-compose__hint">Anoniem · zichtbaar voor iedereen met de extensie</span>
                <button class="fr-compose__submit" id="fr-submit-btn" disabled>Plaatsen</button>
              </div>
            </div>
          </div>
        </div>

        <ul class="fr-comments" id="fr-comments-list">
          ${renderComments(data.comments, neighborhoodGroups)}
        </ul>

        <div class="fr-footer">
          Funda Reacties - voor en door de community
        </div>
      </div>
    `;

    return root;
  }

  /**
   * Render price change tag — only for comments on THIS property,
   * comparing the asking price at comment time vs now.
   */
  function renderPriceChange(commentPrice, currentPrice) {
    if (!commentPrice || !currentPrice) return "";
    const then = parsePrice(commentPrice);
    const now = parsePrice(currentPrice);
    if (!then || !now || then === now) return "";

    const diff = now - then;
    const pct = ((diff / then) * 100).toFixed(0);
    const sign = diff > 0 ? "+" : "";
    const cls = diff > 0 ? "fr-price-change--up" : "fr-price-change--down";

    return `
      <div class="fr-price-change ${cls}">
        <div class="fr-price-change__old">Vraagprijs destijds ${escapeHtml(commentPrice)}</div>
        <div class="fr-price-change__pct">${sign}${pct}%</div>
      </div>`;
  }

  function renderComments(comments, neighborhoodGroups) {
    const hasNeighborhood = neighborhoodGroups && neighborhoodGroups.length > 0;
    const hasOwn = comments.length > 0;
    const currentPrice = getAskingPrice();

    if (!hasOwn && !hasNeighborhood) {
      return `
        <li class="fr-empty">
          <div class="fr-empty__icon">🏠</div>
          <p class="fr-empty__text">Nog geen reacties — wees de eerste!</p>
        </li>`;
    }

    // Own comments — with price change tag
    const ownHtml = comments.map((c) => {
      const initial = c.name.charAt(0).toUpperCase();
      const bg = avatarColor(c.name);
      const myVote = c.myVote || null;
      const priceTag = renderPriceChange(c.askingPrice, currentPrice);
      return `
        <li class="fr-comment" data-id="${c.id}">
          <div class="fr-comment__top">
            <div class="fr-comment__avatar" style="background:${bg}22;color:${bg}">${initial}</div>
            <span class="fr-comment__name">${escapeHtml(c.name)}</span>
            <span class="fr-comment__time">${timeAgo(c.time)}</span>
          </div>
          <p class="fr-comment__body">${escapeHtml(c.text)}</p>${priceTag}
          <div class="fr-comment__footer">
            <button class="fr-vote-btn fr-vote-btn--up${myVote === "up" ? " active" : ""}" data-vote="up" data-comment="${c.id}">
              ▲ <span>${c.upvotes}</span>
            </button>
            <button class="fr-vote-btn fr-vote-btn--down${myVote === "down" ? " active" : ""}" data-vote="down" data-comment="${c.id}">
              ▼ <span>${c.downvotes}</span>
            </button>
          </div>
        </li>`;
    }).join("");

    const neighborhoodHtml = hasNeighborhood
      ? renderNeighborhoodGroups(neighborhoodGroups, hasOwn)
      : "";

    return ownHtml + neighborhoodHtml;
  }

  function renderNeighborhoodGroups(groups, ownCommentsExist) {
    const totalCount = groups.reduce((n, g) => n + g.comments.length, 0);
    const intro = ownCommentsExist
      ? (totalCount === 1 ? "Ook een reactie" : `Ook ${totalCount} reacties`) + " op andere woningen in de omgeving:"
      : ("Nog geen reacties op deze woning. " +
         (totalCount === 1 ? "Dit is een reactie" : `Dit zijn ${totalCount} reacties`) +
         " op andere woningen in de omgeving.");

    return `
      <li class="fr-neighborhood">
        <div class="fr-neighborhood__header">
          <span>📍 Reacties uit de buurt</span>
        </div>
        <p class="fr-neighborhood__intro">${escapeHtml(intro)}</p>
        <ul class="fr-neighborhood__list">
          ${groups.map((g) => g.comments.map((c) => renderNeighborhoodComment(c, g.scope)).join("")).join("")}
        </ul>
      </li>`;
  }

  /**
   * Render a single neighborhood comment.
   * NO price change tag — the asking price of a different property is
   * not comparable to the current page's asking price.
   */
  function renderNeighborhoodComment(c, scope) {
    const initial = (c.name || "?").charAt(0).toUpperCase();
    const bg = avatarColor(c.name || "");
    const scopeLabel = SCOPE_LABELS[scope] || "In de buurt";

    let footer;
    if (c.fromUrl) {
      footer = `<a class="fr-neighborhood-comment__link" href="${escapeAttr(c.fromUrl)}" target="_blank" rel="noopener">${escapeHtml(c.fromAddress || "Bekijk de woning")}</a>`;
    } else if (c.fromAddress) {
      footer = `<span class="fr-neighborhood-comment__source">${escapeHtml(c.fromAddress)}</span>`;
    } else {
      footer = "";
    }

    return `
      <li class="fr-neighborhood-comment">
        <span class="fr-neighborhood-comment__scope">📍 ${escapeHtml(scopeLabel)}</span>
        <div class="fr-neighborhood-comment__top">
          <div class="fr-neighborhood-comment__avatar" style="background:${bg}22;color:${bg}">${initial}</div>
          <span class="fr-neighborhood-comment__name">${escapeHtml(c.name || "Anoniem")}</span>
          <span class="fr-neighborhood-comment__time">${timeAgo(c.time)}</span>
        </div>
        <p class="fr-neighborhood-comment__body">${escapeHtml(c.text || "")}</p>
        ${footer}
      </li>`;
  }

  function escapeAttr(str) {
    return String(str).replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function escapeHtml(str) {
    const d = document.createElement("div");
    d.textContent = str;
    return d.innerHTML;
  }

  // ---- Emoji Bar ----

  function refreshEmojiBar(root, emojis, propertyId) {
    const bar = root.querySelector("#fr-emoji-bar");
    if (!bar) return;

    bar.innerHTML = `
      ${Object.entries(emojis).map(([emoji, info]) => `
        <button class="fr-emoji-btn ${info.active ? "active" : ""}" data-emoji="${emoji}">
          ${emoji}
          <span class="fr-emoji-btn__count">${info.count || ""}</span>
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
    `;

    attachEmojiBarEvents(root, emojis, propertyId);
  }

  function attachEmojiBarEvents(root, emojis, propertyId) {
    const userId = currentUserId;

    root.querySelectorAll(".fr-emoji-btn[data-emoji]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const emoji = btn.dataset.emoji;
        const info = emojis[emoji] || { count: 0, active: false };

        // Optimistic UI
        if (info.active) { info.count = Math.max(0, info.count - 1); info.active = false; btn.classList.remove("active"); }
        else { info.count++; info.active = true; btn.classList.add("active"); }
        btn.querySelector(".fr-emoji-btn__count").textContent = info.count || "";

        const result = await toggleEmojiReaction(propertyId, emoji, userId);
        info.count = result.count;
        info.active = result.active;
        btn.querySelector(".fr-emoji-btn__count").textContent = info.count || "";
        btn.classList.toggle("active", info.active);

        if (info.count === 0 && !DEFAULT_EMOJI_SET.has(emoji)) {
          delete emojis[emoji];
          refreshEmojiBar(root, emojis, propertyId);
        }
      });
    });

    const addBtn = root.querySelector("#fr-add-emoji-btn");
    const picker = root.querySelector("#fr-emoji-picker");
    const grid = root.querySelector("#fr-emoji-grid");
    const searchInput = root.querySelector("#fr-emoji-search");

    function renderPickerGrid(filter) {
      const filt = (filter || "").trim().toLowerCase();
      let html = "";
      const alreadyInBar = new Set(Object.keys(emojis));

      if (filt) {
        const matches = ALL_PICKER_EMOJI.filter(([e, keywords]) => {
          if (alreadyInBar.has(e)) return false;
          if (keywords.toLowerCase().includes(filt)) return true;
          return Object.entries(EMOJI_CATEGORIES).some(([cat, list]) => list.some(([le]) => le === e) && cat.toLowerCase().includes(filt));
        });
        html = matches.length > 0
          ? matches.map(([e]) => `<button class="fr-emoji-picker__item" data-pick="${e}">${e}</button>`).join("")
          : `<div class="fr-emoji-picker__category">Geen resultaten</div>`;
      } else {
        for (const [cat, categoryEmojis] of Object.entries(EMOJI_CATEGORIES)) {
          const filtered = categoryEmojis.filter(([e]) => !alreadyInBar.has(e));
          if (filtered.length === 0) continue;
          html += `<div class="fr-emoji-picker__category">${escapeHtml(cat)}</div>`;
          html += filtered.map(([e]) => `<button class="fr-emoji-picker__item" data-pick="${e}">${e}</button>`).join("");
        }
      }

      grid.innerHTML = html;
      grid.querySelectorAll(".fr-emoji-picker__item").forEach((item) => {
        item.addEventListener("click", async () => {
          picker.style.display = "none";
          searchInput.value = "";
          const result = await toggleEmojiReaction(propertyId, item.dataset.pick, userId);
          emojis[item.dataset.pick] = { count: result.count, active: result.active };
          refreshEmojiBar(root, emojis, propertyId);
        });
      });
    }

    addBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const isVisible = picker.style.display !== "none";
      picker.style.display = isVisible ? "none" : "";
      if (!isVisible) { renderPickerGrid(""); setTimeout(() => searchInput.focus(), 50); }
    });

    searchInput.addEventListener("input", () => renderPickerGrid(searchInput.value));
    picker.addEventListener("click", (e) => e.stopPropagation());
  }

  // ---- Event Handlers ----

  function attachEvents(root) {
    const propertyId = getPropertyId();

    loadReactions(propertyId).then((data) => {
      attachEmojiBarEvents(root, data.emojis, propertyId);

      document.addEventListener("click", () => {
        const picker = root.querySelector("#fr-emoji-picker");
        if (picker) picker.style.display = "none";
      });

      const textarea = root.querySelector("#fr-compose-input");
      const submitBtn = root.querySelector("#fr-submit-btn");

      textarea.addEventListener("input", () => {
        submitBtn.disabled = textarea.value.trim().length === 0;
        textarea.style.height = "auto";
        textarea.style.height = textarea.scrollHeight + "px";
      });

      submitBtn.addEventListener("click", async () => {
        const text = textarea.value.trim();
        if (!text) return;

        submitBtn.disabled = true;
        submitBtn.textContent = "Bezig…";

        const names = ["Huizenzoeker", "Woningkijker", "Buurtbewoner", "Starter", "Bezichtiger", "Vastgoedfan", "Koopjesjager", "Huurder", "Verhuizer"];
        const name = names[Math.floor(Math.random() * names.length)];

        const newComment = await postComment(propertyId, text, name, getAskingPrice(), currentUserId);

        if (newComment) {
          const freshData = await loadReactions(propertyId);
          const neighborhoodGroups = await findNeighborhoodComments(propertyId, freshData.location);
          const list = root.querySelector("#fr-comments-list");
          list.innerHTML = renderComments(freshData.comments, neighborhoodGroups);
          attachVoteEvents(root, propertyId);
          root.querySelector(".fr-header__count").textContent =
            `${freshData.comments.length} reactie${freshData.comments.length !== 1 ? "s" : ""}`;
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
      setupRealtimeSubscription(root, propertyId, data);
    });
  }

  function setupRealtimeSubscription(root, propertyId) {
    if (realtimeChannel) unsubscribeFromPropertyUpdates(realtimeChannel);

    realtimeChannel = subscribeToPropertyUpdates(propertyId, currentUserId, async (newComment) => {
      dbg("Realtime: nieuwe comment ontvangen", newComment);

      const address = getPropertyAddress();
      try {
        chrome.runtime.sendMessage({
          type: "SHOW_NOTIFICATION",
          title: "💬 Nieuwe reactie op " + (address || "een woning"),
          message: `${newComment.name}: ${newComment.text.substring(0, 80)}${newComment.text.length > 80 ? "…" : ""}`,
          propertyUrl: getPropertyUrl(),
        });
      } catch (e) { dbg("Notification send error:", e); }

      const freshData = await loadReactions(propertyId);
      const neighborhoodGroups = await findNeighborhoodComments(propertyId, freshData.location);

      const list = root.querySelector("#fr-comments-list");
      if (list) {
        list.innerHTML = renderComments(freshData.comments, neighborhoodGroups);
        attachVoteEvents(root, propertyId);
      }

      const countEl = root.querySelector(".fr-header__count");
      if (countEl) countEl.textContent = `${freshData.comments.length} reactie${freshData.comments.length !== 1 ? "s" : ""}`;
      chrome.runtime.sendMessage({ type: "UPDATE_BADGE", count: freshData.comments.length });
    });
  }

  function attachVoteEvents(root, propertyId) {
    const userId = currentUserId;
    root.querySelectorAll(".fr-vote-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const commentId = btn.dataset.comment;
        const direction = btn.dataset.vote;
        const commentEl = btn.closest(".fr-comment");
        const upBtn = commentEl.querySelector('.fr-vote-btn--up');
        const downBtn = commentEl.querySelector('.fr-vote-btn--down');

        const wasActive = btn.classList.contains("active");
        if (wasActive) { btn.classList.remove("active"); }
        else { upBtn.classList.remove("active"); downBtn.classList.remove("active"); btn.classList.add("active"); }

        const result = await voteComment(commentId, userId, direction);
        if (result) {
          upBtn.querySelector("span").textContent = result.upvotes;
          downBtn.querySelector("span").textContent = result.downvotes;
        }
      });
    });
  }

  // ---- Injection ----

  function isDetailPage() {
    return /\/(detail\/koop|detail\/huur|koop\/[^/]+\/[^/]+|huur\/[^/]+\/[^/]+)/.test(location.pathname);
  }

  function findAgentPanel() {
    const cardCandidates = document.querySelectorAll('.bg-secondary-10.rounded-lg');
    for (const card of cardCandidates) {
      const text = (card.textContent || "").toLowerCase();
      if (text.includes("neem contact op") || text.includes("toon telefoonnummer")) return card;
    }

    const gridContainer = document.querySelector('[class*="grid-cols-"][class*="7fr"]');
    if (gridContainer) {
      const sidebar = gridContainer.children[1];
      if (sidebar) { const firstCard = sidebar.querySelector('.rounded-lg'); if (firstCard) return firstCard; }
    }

    for (const link of document.querySelectorAll("a")) {
      const text = (link.textContent || "").trim().toLowerCase();
      if (text.includes("neem contact op") && link.href && link.href.includes("makelaar-contact")) {
        let parent = link.parentElement;
        for (let depth = 0; depth < 15 && parent; depth++) {
          if (parent.classList && (parent.classList.contains("rounded-lg") || parent.classList.contains("bg-secondary-10")) && parent.getBoundingClientRect().height > 100) return parent;
          parent = parent.parentElement;
        }
      }
    }

    const brochureLink = document.querySelector('a[href*="valentina_media"][download]');
    if (brochureLink && brochureLink.parentElement) {
      const card = brochureLink.parentElement.querySelector('.rounded-lg');
      if (card) return card;
    }

    return null;
  }

  function findFallbackInjectionPoint() {
    const gridContainer = document.querySelector('[class*="grid-cols-"][class*="7fr"]');
    if (gridContainer && gridContainer.children[1]) return gridContainer.children[1];
    for (const sel of ['aside', '[class*="sidebar"]', '[role="complementary"]']) {
      const el = document.querySelector(sel);
      if (el && el.getBoundingClientRect().width > 100) return el;
    }
    for (const sel of ['main', '#content', '#__nuxt', '.container', 'article']) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    return document.body;
  }

  /**
   * Build a rich skeleton placeholder that shows instantly-available data
   * (insights scraped from the page) while remote data loads in the background.
   */
  function buildSkeletonPlaceholder() {
    const insights = generateInsights();

    const insightsHtml = insights.length > 0
      ? `<div class="fr-insights">
           ${insights.map((i) => `<span class="fr-insight-chip"><span class="fr-insight-chip__icon">${i.icon}</span>${i.text}</span>`).join("")}
         </div>`
      : "";

    const el = document.createElement("div");
    el.id = "funda-reacties-root";
    el.innerHTML = `
      <div class="fr-container">
        <div class="fr-header">
          <h3 class="fr-header__title">
            <span class="fr-header__icon">💬</span>
            Reacties
          </h3>
          <span class="fr-header__count fr-header__count--loading">laden…</span>
        </div>

        <!-- Skeleton emoji bar -->
        <div class="fr-quick-reactions">
          ${DEFAULT_EMOJIS.map(e => `<button class="fr-emoji-btn fr-emoji-btn--skeleton" disabled>${e}<span class="fr-emoji-btn__count"></span></button>`).join("")}
        </div>

        ${insightsHtml}

        <!-- Skeleton compose area -->
        <div class="fr-compose">
          <div class="fr-compose__wrapper">
            <div class="fr-compose__avatar" style="background:#e86c2a22;color:#e86c2a">?</div>
            <div class="fr-compose__input-group">
              <textarea class="fr-compose__textarea" placeholder="Deel je ervaring…" rows="1" disabled></textarea>
              <div class="fr-compose__actions">
                <span class="fr-compose__hint">Anoniem · zichtbaar voor iedereen met de extensie</span>
                <button class="fr-compose__submit" disabled>Plaatsen</button>
              </div>
            </div>
          </div>
        </div>

        <!-- Skeleton comments -->
        <ul class="fr-comments">
          <li class="fr-skeleton">
            <div class="fr-skeleton__line" style="width: 40%"></div>
            <div class="fr-skeleton__line" style="width: 90%"></div>
            <div class="fr-skeleton__line" style="width: 65%"></div>
          </li>
          <li class="fr-skeleton">
            <div class="fr-skeleton__line" style="width: 35%"></div>
            <div class="fr-skeleton__line" style="width: 80%"></div>
            <div class="fr-skeleton__line" style="width: 50%"></div>
          </li>
        </ul>

        <div class="fr-footer">
          Funda Reacties - voor en door de community
        </div>
      </div>
    `;

    return el;
  }

  async function inject() {
    if (!isDetailPage()) return;
    if (document.getElementById("funda-reacties-root")) return;

    if (!currentUserId) {
      currentUserId = await getUserId();
      dbg("userId:", currentUserId);
    }

    // Inject skeleton placeholder with real insights immediately
    const placeholder = buildSkeletonPlaceholder();

    const agentPanel = findAgentPanel();
    if (agentPanel) {
      agentPanel.parentNode.insertBefore(placeholder, agentPanel);
      placeholder.style.marginTop = "0";
      placeholder.style.marginBottom = "16px";
      dbg("✅ Skeleton injected above agent card");
    } else {
      const target = findFallbackInjectionPoint();
      target.appendChild(placeholder);
      dbg("⚠️ Agent card not found, using fallback position");
    }

    // Load data and replace skeleton with full panel
    try {
      const panel = await createPanel();
      placeholder.replaceWith(panel);

      if (agentPanel) {
        panel.style.marginTop = "0";
        panel.style.marginBottom = "16px";
      }

      attachEvents(panel);

      const propertyId = getPropertyId();
      const data = await loadReactions(propertyId);
      chrome.runtime.sendMessage({ type: "UPDATE_BADGE", count: data.comments.length });

      dbg("✅ Panel fully rendered");
    } catch (error) {
      console.error("[Funda Reacties] Error rendering panel:", error);
      const header = placeholder.querySelector(".fr-header__count");
      if (header) header.textContent = "fout";
      const commentsList = placeholder.querySelector(".fr-comments");
      if (commentsList) {
        commentsList.innerHTML = `
          <li class="fr-empty">
            <div class="fr-empty__icon">⚠️</div>
            <p class="fr-empty__text">Fout bij laden: ${escapeHtml(error.message)}</p>
            <p style="font-size:12px;color:#888;margin:4px 0 0;">Check de console (F12) voor details.</p>
          </li>`;
      }
    }
  }

  // ---- SPA-aware injection with retry ----

  let retryCount = 0;
  const maxRetries = 15;

  function attemptInject() {
    if (document.getElementById("funda-reacties-root")) return;
    if (!isDetailPage()) return;
    if (retryCount >= maxRetries) { dbg("Max retries reached, injecting at fallback"); inject(); return; }
    retryCount++;

    if (document.querySelector('h1') || document.querySelector('[class*="price"]')) inject();

    if (!document.getElementById("funda-reacties-root")) {
      setTimeout(attemptInject, 400 + retryCount * 200);
    }
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

    if (!document.getElementById("funda-reacties-root") && isDetailPage() && retryCount < maxRetries) {
      attemptInject();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
})();
