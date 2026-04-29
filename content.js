// ==========================================================================
// Funda Reacties — Content Script
// Injects a comment/reaction panel into Funda property detail pages.
// ==========================================================================

(function () {
  "use strict";

  // ---- Helpers ----

  /** Extract a stable property ID from the current Funda URL */
  function getPropertyId() {
    // Funda detail URLs look like:
    //   /detail/koop/amsterdam/huis-straatnaam-123/12345678/
    //   /koop/amsterdam/huis-12345-straatnaam/
    const path = location.pathname.replace(/\/+$/, "");
    // Try to grab the numeric object ID at the end
    const numericMatch = path.match(/\/(\d{6,})$/);
    if (numericMatch) return numericMatch[1];
    // Fallback: use the full path as key (normalized)
    return path.replace(/\//g, "_").replace(/^_/, "");
  }

  /**
   * Get the property address from the page, normalized as "Straat 12, Stad".
   *
   * Funda's H1 and its surrounding container include the postcode, city, and
   * wijk link. The DOM structure varies (sometimes text nodes, sometimes nested
   * spans). Instead of depending on a specific DOM shape, we take the full
   * textContent and strip everything from the first Dutch postcode pattern
   * ("1234 AB") onwards. This reliably isolates the "Straatnaam 12" part.
   */
  function getPropertyAddress() {
    const h1 = document.querySelector("h1");
    let streetPart = "";

    if (h1) {
      const raw = (h1.textContent || "").trim();
      // Cut at the first Dutch postcode pattern ("3863 AS", "1012 AB", etc.)
      const postcodeIdx = raw.search(/\d{4}\s?[A-Z]{2}/);
      if (postcodeIdx > 0) {
        streetPart = raw.slice(0, postcodeIdx).trim();
      } else {
        // No postcode found — likely the H1 really only contains the street.
        streetPart = raw;
      }
    }

    // City from the URL (more reliable than scraping)
    const cityMatch = location.pathname.match(/\/(?:detail\/)?(?:koop|huur)\/([^/]+)\//);
    const cityTitle = cityMatch ? titleCase(decodeURIComponent(cityMatch[1])) : "";

    if (streetPart && cityTitle) return `${streetPart}, ${cityTitle}`;
    if (streetPart) return streetPart;
    if (cityTitle) return cityTitle;
    return document.title.replace(/ \[funda\].*/, "").trim();
  }

  /** Get the canonical URL for the current property (without query/hash) */
  function getPropertyUrl() {
    return location.origin + location.pathname.replace(/\/+$/, "") + "/";
  }

  /**
   * Extract location signals (street, neighborhood, city) from the page + URL.
   * These are best-effort; missing fields are simply omitted.
   *
   * Used for two purposes:
   *  - tag every new comment with the location of the property it was posted on
   *  - look up nearby properties when this property has no comments yet
   */
  function getPropertyLocation() {
    const loc = {};

    // --- City from URL ---
    // Funda paths: /koop/<city>/huis-..., /huur/<city>/..., /detail/koop/<city>/...
    const cityMatch = location.pathname.match(/\/(?:detail\/)?(?:koop|huur)\/([^/]+)\//);
    if (cityMatch) {
      loc.city = decodeURIComponent(cityMatch[1]).toLowerCase();
    }

    // --- Street from H1 ---
    // Same postcode-stripping trick as getPropertyAddress: take h1.textContent
    // and cut everything from the postcode pattern onwards, then strip the
    // house number to get just the street name.
    const h1 = document.querySelector("h1");
    if (h1) {
      const raw = (h1.textContent || "").trim();
      const postcodeIdx = raw.search(/\d{4}\s?[A-Z]{2}/);
      const streetWithNumber = postcodeIdx > 0 ? raw.slice(0, postcodeIdx).trim() : raw;
      // Drop trailing house number (and possible suffix like 12a, 12-3)
      const street = streetWithNumber.replace(/\s+\d+[a-zA-Z]?(?:[-/]\d+[a-zA-Z]?)?\s*$/, "").trim();
      if (street) loc.street = street.toLowerCase();
    }

    // --- Neighborhood (wijk) from the address block under the H1 ---
    // Funda renders the wijk as a link near the H1, but the href format varies:
    //   - Relative: /koop/nijkerk/corlaer/
    //   - Absolute: https://www.funda.nl/informatie/nijkerk/corlaer
    //   - Search link: /koop/nijkerk/corlaer/
    //
    // Strategy: look for links near the H1 whose last path segment is a
    // plausible wijk slug (not a listing, not the city itself, not a generic
    // page). We also check for /informatie/<city>/<wijk> which Funda uses
    // for neighbourhood info pages.
    try {
      const candidateLinks = [];
      // Scope 1: links inside the H1 element itself (Funda puts the wijk link here)
      if (h1) {
        candidateLinks.push(...h1.querySelectorAll("a[href]"));
      }
      // Scope 2: links in the H1's parent block
      if (h1 && h1.parentElement) {
        candidateLinks.push(...h1.parentElement.querySelectorAll("a[href]"));
      }

      for (const a of candidateLinks) {
        const href = a.getAttribute("href") || "";

        // Normalize: strip origin for absolute URLs so we can parse the path
        let path = href;
        try {
          const u = new URL(href, location.origin);
          path = u.pathname;
        } catch (e) { /* keep raw href */ }
        // Ensure no trailing slash for consistent splitting
        path = path.replace(/\/+$/, "");
        const segments = path.split("/").filter(Boolean);

        // Pattern 1: /koop/<city>/<wijk> or /huur/<city>/<wijk>
        if (
          segments.length === 3 &&
          (segments[0] === "koop" || segments[0] === "huur")
        ) {
          const [, hrefCity, hrefSlug] = segments;
          if (loc.city && hrefCity.toLowerCase() !== loc.city) continue;
          if (/^huis-|^appartement-|^woonhuis-/.test(hrefSlug)) continue;
          loc.neighborhood = hrefSlug.toLowerCase();
          break;
        }

        // Pattern 2: /informatie/<city>/<wijk>  (neighbourhood info pages)
        if (
          segments.length === 3 &&
          segments[0] === "informatie"
        ) {
          const [, hrefCity, hrefSlug] = segments;
          if (loc.city && hrefCity.toLowerCase() !== loc.city) continue;
          loc.neighborhood = hrefSlug.toLowerCase();
          break;
        }
      }
    } catch (e) { /* ignore */ }

    dbg("getPropertyLocation:", JSON.stringify(loc));

    // Region / province are intentionally not extracted: not reliably available
    // on the page, and the user explicitly scoped this iteration to street/wijk/city.
    return loc;
  }

  /** Time-ago formatter */
  function timeAgo(dateString) {
    const now = Date.now();
    const then = new Date(dateString).getTime();
    const diff = Math.floor((now - then) / 1000);
    if (diff < 60) return "zojuist";
    if (diff < 3600) {
      const m = Math.floor(diff / 60);
      return `${m} min geleden`;
    }
    if (diff < 86400) {
      const h = Math.floor(diff / 3600);
      return `${h} uur geleden`;
    }
    if (diff < 604800) {
      const d = Math.floor(diff / 86400);
      return d === 1 ? "Gisteren" : `${d} dagen geleden`;
    }
    return new Date(dateString).toLocaleDateString("nl-NL", {
      day: "numeric",
      month: "short",
    });
  }

  /** Generate a random muted color for avatar backgrounds */
  function avatarColor(name) {
    let hash = 0;
    for (let i = 0; i < name.length; i++)
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    const colors = [
      "#e86c2a", "#4a9b6e", "#5b7fc4", "#c4534a",
      "#8a6bbf", "#d4943a", "#3b8a8a", "#bf6b8a",
    ];
    return colors[Math.abs(hash) % colors.length];
  }

  // ---- Mock Data Layer ----
  // In production, replace this with real API calls to your backend.

  const STORAGE_KEY = "funda_reacties_";
  const DEMO_SEED_KEY = "funda_reacties__demo_seeded__";

  // Toggle the seeded fake-neighbour data. Set to false once a real backend is
  // wired up so we don't pollute storage with mock entries.
  const DEMO_MODE = true;

  // Verbose console logging for the buurt-aggregatie. Leave on while iterating
  // on the matching logic; flip off before shipping.
  const DEBUG = true;
  function dbg(...args) { if (DEBUG) console.log("[Funda Reacties]", ...args); }

  /**
   * Seed a few fake "neighbour" properties so the buurt-aggregatie has
   * something to show even on a fresh install. Seeds are tied to the *current*
   * property's location (street/neighborhood/city) so the matcher actually
   * lights up. Idempotent per (city, neighborhood, street) tuple via a sentinel.
   */
  function seedDemoNeighbours(currentPropertyId, currentLocation) {
    if (!DEMO_MODE) return;
    if (!currentLocation || !currentLocation.city) return;

    const sentinel =
      DEMO_SEED_KEY +
      [currentLocation.city, currentLocation.neighborhood || "-", currentLocation.street || "-"].join("|");
    if (localStorage.getItem(sentinel)) return;

    const cityTitle = titleCase(currentLocation.city);
    const streetTitle = currentLocation.street ? titleCase(currentLocation.street) : null;
    const wijkTitle = currentLocation.neighborhood ? titleCase(currentLocation.neighborhood) : null;

    const seeds = [];

    // 1. Same street neighbour (only if we know the street)
    if (streetTitle) {
      const houseNum = Math.floor(Math.random() * 80) + 2;
      seeds.push({
        id: `seed_street_${currentLocation.city}_${currentLocation.street}`,
        address: `${streetTitle} ${houseNum}`,
        url: `https://www.funda.nl/koop/${currentLocation.city}/huis-99000001-${currentLocation.street}-${houseNum}/`,
        location: {
          city: currentLocation.city,
          neighborhood: currentLocation.neighborhood,
          street: currentLocation.street,
        },
        comments: [
          {
            id: "seed_street_c1",
            name: "Buurtbewoner",
            text: "Een paar huizen verderop heb ik bezichtigd — vergelijkbare lay-out, maar de tuin lag op het noorden. Let dus goed op de oriantatie als je hier komt kijken.",
            time: new Date(Date.now() - 86400000 * 4).toISOString(),
            upvotes: 9,
            downvotes: 0,
          },
        ],
      });
    }

    // 2. Same wijk neighbour (only if we know the wijk)
    if (wijkTitle) {
      seeds.push({
        id: `seed_wijk_${currentLocation.city}_${currentLocation.neighborhood}`,
        address: `Voorbeeldlaan 12, ${cityTitle}`,
        url: `https://www.funda.nl/koop/${currentLocation.city}/huis-99000002-voorbeeldlaan-12/`,
        location: {
          city: currentLocation.city,
          neighborhood: currentLocation.neighborhood,
        },
        comments: [
          {
            id: "seed_wijk_c1",
            name: "Wijkkenner",
            text: `Mooie wijk, ${wijkTitle}. ’s Avonds rustig en de basisschool om de hoek heeft een goede reputatie. Wel weinig parkeerplekken in het weekend.`,
            time: new Date(Date.now() - 86400000 * 8).toISOString(),
            upvotes: 14,
            downvotes: 1,
          },
        ],
      });
    }

    // 3. Same city neighbour (always)
    seeds.push({
      id: `seed_city_${currentLocation.city}`,
      address: `Stadshof 5, ${cityTitle}`,
      url: `https://www.funda.nl/koop/${currentLocation.city}/huis-99000003-stadshof-5/`,
      location: {
        city: currentLocation.city,
      },
      comments: [
        {
          id: "seed_city_c1",
          name: "Vastgoedfan",
          text: `Algemene tip voor ${cityTitle}: kijk goed naar de WOZ-waarde versus vraagprijs. Verschillen lopen hier soms flink uit elkaar tussen wijken.`,
          time: new Date(Date.now() - 86400000 * 14).toISOString(),
          upvotes: 6,
          downvotes: 0,
        },
      ],
    });

    // Persist each seed under a property-id key, but skip the current property.
    for (const seed of seeds) {
      if (seed.id === currentPropertyId) continue;
      // Don't overwrite real data the user may already have on these IDs
      if (localStorage.getItem(STORAGE_KEY + seed.id)) continue;
      const data = {
        address: seed.address,
        url: seed.url,
        location: seed.location,
        // Mark this entry as seeded mock data so the UI can suppress the
        // "open in new tab" link — these properties don't actually exist.
        isSeed: true,
        emojis: {
          "🔥": { count: 0, active: false },
          "😍": { count: 0, active: false },
          "🤔": { count: 0, active: false },
          "💸": { count: 0, active: false },
          "📉": { count: 0, active: false },
          "🏡": { count: 0, active: false },
        },
        userVotes: {},
        comments: seed.comments,
      };
      try {
        localStorage.setItem(STORAGE_KEY + seed.id, JSON.stringify(data));
      } catch (e) { /* ignore */ }
    }

    try { localStorage.setItem(sentinel, "1"); } catch (e) { /* ignore */ }
  }

  function titleCase(str) {
    return String(str)
      .split(/[\s-]+/)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
  }

  /** Auto-generated insights based on URL / meta tags */
  function generateInsights() {
    const insights = [];
    // Days on market (mock — in production, scrape from page or API)
    const daysOnMarket = Math.floor(Math.random() * 180) + 5;
    insights.push({ icon: "📅", text: `${daysOnMarket} dagen online` });

    // Price per m² (mock)
    const priceEl = document.querySelector('[class*="price"], [data-testid*="price"]');
    const areaEl = document.querySelector('[class*="surface"], [class*="area"]');
    if (priceEl || areaEl) {
      const mockPricePerM2 = (3000 + Math.floor(Math.random() * 4000));
      insights.push({ icon: "📐", text: `~€${mockPricePerM2.toLocaleString("nl-NL")}/m²` });
    }

    // Neighborhood vibe (mock)
    const vibes = ["Rustige buurt", "Levendige buurt", "Kindvriendelijk", "Veel groen", "Dichtbij centrum"];
    insights.push({ icon: "🏘️", text: vibes[Math.floor(Math.random() * vibes.length)] });

    return insights;
  }

  /** Load reactions for a property (from localStorage for demo) */
  function loadReactions(propertyId) {
    let stored = null;
    try {
      const raw = localStorage.getItem(STORAGE_KEY + propertyId);
      if (raw) stored = JSON.parse(raw);
    } catch (e) { /* ignore */ }

    if (stored) {
      // Strip leftover demo comments from previous versions of the extension.
      // These were seeded into every fresh property entry under fixed IDs and
      // would otherwise stick around forever — and pollute the buurt pool.
      if (Array.isArray(stored.comments)) {
        stored.comments = stored.comments.filter(
          (c) => c && c.id !== "demo1" && c.id !== "demo2"
        );
      }

      // Keep address/url/location up to date for the active property so that
      // the neighborhood lookup always has the freshest metadata to match on.
      stored.address = getPropertyAddress() || stored.address;
      stored.url = getPropertyUrl() || stored.url;
      stored.location = Object.assign({}, stored.location || {}, getPropertyLocation());
      return stored;
    }

    // Return a clean empty entry. Each property starts without comments;
    // the buurt-aggregatie surfaces seeded neighbour content when there are
    // no comments on the current property yet.
    return {
      address: getPropertyAddress(),
      url: getPropertyUrl(),
      location: getPropertyLocation(),
      emojis: {
        "🔥": { count: 0, active: false },
        "😍": { count: 0, active: false },
        "🤔": { count: 0, active: false },
        "💸": { count: 0, active: false },
        "📉": { count: 0, active: false },
        "🏡": { count: 0, active: false },
      },
      // Track the current user's vote per comment: { commentId: "up" | "down" | null }
      userVotes: {},
      comments: [],
    };
  }

  /** Save reactions */
  function saveReactions(propertyId, data) {
    try {
      localStorage.setItem(STORAGE_KEY + propertyId, JSON.stringify(data));
    } catch (e) { /* ignore */ }
  }

  // ---- Neighborhood Aggregation ----
  // When the current property has no comments yet, surface comments from
  // properties in the same area, falling back from most-specific to least-specific:
  //   street → neighborhood → city → region → province
  // Region/province are not yet populated in the data layer but the matcher
  // already supports them so they light up automatically once available.

  const SCOPE_ORDER = ["street", "neighborhood", "city", "region", "province"];

  const SCOPE_LABELS = {
    street: "Zelfde straat",
    neighborhood: "Zelfde wijk",
    city: "Zelfde stad",
    region: "Zelfde regio",
    province: "Zelfde provincie",
  };

  /** Iterate over all stored property entries except the current one. */
  function getAllStoredProperties(currentPropertyId) {
    const entries = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(STORAGE_KEY)) continue;
      const propertyId = key.slice(STORAGE_KEY.length);
      if (propertyId === currentPropertyId) continue;
      try {
        const data = JSON.parse(localStorage.getItem(key));
        if (data && Array.isArray(data.comments) && data.comments.length > 0) {
          entries.push({ propertyId, data });
        }
      } catch (e) { /* ignore */ }
    }
    return entries;
  }

  /**
   * Determine the most specific scope at which two locations match.
   * Returns one of SCOPE_ORDER, or null if there is no match at all.
   */
  function matchScope(here, there) {
    if (!here || !there) return null;
    for (const scope of SCOPE_ORDER) {
      const a = here[scope];
      const b = there[scope];
      if (a && b && a === b) return scope;
    }
    return null;
  }

  /**
   * Find comments from neighboring properties, grouped by the most-specific
   * matching scope. Returns an array of { scope, comments: [...] } already
   * sorted from most-specific to least-specific. Each comment is enriched
   * with the address and URL of the property it was originally posted on.
   */
  function findNeighborhoodComments(currentPropertyId, currentLocation, limitPerScope = 3) {
    if (!currentLocation || Object.keys(currentLocation).length === 0) {
      dbg("buurt: geen location voor huidige property, skip");
      return [];
    }

    dbg("buurt: zoek buren voor property", currentPropertyId, "location:", currentLocation);

    const buckets = {}; // scope -> array of enriched comments
    const stored = getAllStoredProperties(currentPropertyId);
    dbg("buurt: gevonden andere properties met comments:", stored.length);

    for (const { propertyId, data } of stored) {
      const scope = matchScope(currentLocation, data.location);
      dbg(
        "buurt:   property", propertyId,
        "location:", data.location,
        "-> match scope:", scope || "(geen match)"
      );
      if (!scope) continue;

      // Sort that property's comments by recency, take the most recent ones
      const sorted = data.comments
        .slice()
        .sort((a, b) => new Date(b.time) - new Date(a.time));

      for (const c of sorted) {
        if (!buckets[scope]) buckets[scope] = [];
        buckets[scope].push({
          ...c,
          fromAddress: data.address || "een andere woning",
          // Suppress the link for seeded mock properties since they don't
          // resolve to a real Funda page.
          fromUrl: data.isSeed ? null : (data.url || null),
          fromIsSeed: !!data.isSeed,
        });
      }
    }

    // Show the most specific scope that has results. If that scope has few
    // comments (≤ 2), also include the next-most-specific scope to fill the
    // block, and so on, until we have enough context or run out of scopes.
    const MIN_COMMENTS = 3;
    const result = [];
    let totalSoFar = 0;
    for (const scope of SCOPE_ORDER) {
      const list = buckets[scope];
      if (!list || list.length === 0) continue;
      list.sort((a, b) => new Date(b.time) - new Date(a.time));
      result.push({ scope, comments: list.slice(0, limitPerScope) });
      totalSoFar += Math.min(list.length, limitPerScope);
      if (totalSoFar >= MIN_COMMENTS) break; // enough context
    }
    dbg("buurt: eindresultaat groepen:", result.map((g) => `${g.scope}=${g.comments.length}`).join(", ") || "(leeg)");
    return result;
  }

  // ---- UI Rendering ----

  function createPanel() {
    const propertyId = getPropertyId();
    const data = loadReactions(propertyId);
    const insights = generateInsights();

    // Persist any newly-extracted address/url/location so other tabs can match
    // against them, even if the user never posts a comment here.
    saveReactions(propertyId, data);
    dbg("property", propertyId, "address:", data.address, "location:", data.location, "comments:", data.comments.length);

    // Seed a few mock neighbour properties so the buurt-aggregatie has
    // something to show on a fresh install. No-op once a sentinel is set,
    // and a no-op when DEMO_MODE is off.
    seedDemoNeighbours(propertyId, data.location);

    // Comments on this property always take precedence over neighborhood ones,
    // but the neighborhood block is shown alongside them — below the own
    // comments, as additional context. Only the most specific scope with any
    // matches is shown (e.g. street wins over wijk wins over stad).
    const neighborhoodGroups = findNeighborhoodComments(propertyId, data.location);

    // Root
    const root = document.createElement("div");
    root.id = "funda-reacties-root";

    root.innerHTML = `
      <div class="fr-container">

        <!-- Header -->
        <div class="fr-header">
          <h3 class="fr-header__title">
            <span class="fr-header__icon">💬</span>
            Reacties
          </h3>
          <span class="fr-header__count">${data.comments.length} reactie${data.comments.length !== 1 ? "s" : ""}</span>
        </div>

        <!-- Quick Emoji Reactions -->
        <div class="fr-quick-reactions" id="fr-emoji-bar">
          ${Object.entries(data.emojis)
            .map(
              ([emoji, info]) => `
            <button class="fr-emoji-btn ${info.active ? "active" : ""}" data-emoji="${emoji}">
              ${emoji}
              <span class="fr-emoji-btn__count">${info.count || ""}</span>
            </button>`
            )
            .join("")}
        </div>

        <!-- Auto-generated insights -->
        <div class="fr-insights">
          ${insights
            .map(
              (i) =>
                `<span class="fr-insight-chip"><span class="fr-insight-chip__icon">${i.icon}</span>${i.text}</span>`
            )
            .join("")}
        </div>

        <!-- Compose -->
        <div class="fr-compose">
          <div class="fr-compose__wrapper">
            <div class="fr-compose__avatar" style="background:#e86c2a22;color:#e86c2a">?</div>
            <div class="fr-compose__input-group">
              <textarea
                class="fr-compose__textarea"
                id="fr-compose-input"
                placeholder="Deel je ervaring…"
                rows="1"
              ></textarea>
              <div class="fr-compose__actions">
                <span class="fr-compose__hint">Anoniem · zichtbaar voor iedereen met de extensie</span>
                <button class="fr-compose__submit" id="fr-submit-btn" disabled>Plaatsen</button>
              </div>
            </div>
          </div>
        </div>

        <!-- Comments (this property) -->
        <ul class="fr-comments" id="fr-comments-list">
          ${renderComments(data.comments, data.userVotes, neighborhoodGroups)}
        </ul>

        <!-- Footer -->
        <div class="fr-footer">
          Funda Reacties - voor en door de community
        </div>
      </div>
    `;

    return root;
  }

  function renderComments(comments, userVotes, neighborhoodGroups) {
    userVotes = userVotes || {};
    const hasNeighborhood = neighborhoodGroups && neighborhoodGroups.length > 0;
    const hasOwn = comments.length > 0;

    // Empty state: no own comments and no neighborhood matches
    if (!hasOwn && !hasNeighborhood) {
      return `
        <li class="fr-empty">
          <div class="fr-empty__icon">🏠</div>
          <p class="fr-empty__text">Nog geen reacties — wees de eerste!</p>
        </li>`;
    }

    const ownHtml = comments
      .slice()
      .sort((a, b) => new Date(b.time) - new Date(a.time))
      .map((c) => {
        const initial = c.name.charAt(0).toUpperCase();
        const bg = avatarColor(c.name);
        const myVote = userVotes[c.id] || null; // "up", "down", or null
        return `
        <li class="fr-comment" data-id="${c.id}">
          <div class="fr-comment__top">
            <div class="fr-comment__avatar" style="background:${bg}22;color:${bg}">${initial}</div>
            <span class="fr-comment__name">${escapeHtml(c.name)}</span>
            <span class="fr-comment__time">${timeAgo(c.time)}</span>
          </div>
          <p class="fr-comment__body">${escapeHtml(c.text)}</p>
          <div class="fr-comment__footer">
            <button class="fr-vote-btn fr-vote-btn--up${myVote === "up" ? " active" : ""}" data-vote="up" data-comment="${c.id}">
              ▲ <span>${c.upvotes}</span>
            </button>
            <button class="fr-vote-btn fr-vote-btn--down${myVote === "down" ? " active" : ""}" data-vote="down" data-comment="${c.id}">
              ▼ <span>${c.downvotes}</span>
            </button>
          </div>
        </li>`;
      })
      .join("");

    const neighborhoodHtml = hasNeighborhood
      ? renderNeighborhoodGroups(neighborhoodGroups, hasOwn)
      : "";

    return ownHtml + neighborhoodHtml;
  }

  /**
   * Render the neighborhood-aggregation block. Always rendered when there are
   * matches; placed below own comments when those exist. Within the block,
   * only the most specific scope with any matches is shown (street > wijk >
   * stad), so the user is never overwhelmed by less-relevant matches.
   */
  function renderNeighborhoodGroups(groups, ownCommentsExist) {
    const totalCount = groups.reduce((n, g) => n + g.comments.length, 0);
    const intro = ownCommentsExist
      ? (totalCount === 1 ? "Ook een reactie" : `Ook ${totalCount} reacties`) +
        " op andere woningen in de omgeving:"
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
          ${groups
            .map((g) =>
              g.comments
                .map((c) => renderNeighborhoodComment(c, g.scope))
                .join("")
            )
            .join("")}
        </ul>
      </li>`;
  }

  function renderNeighborhoodComment(c, scope) {
    const initial = (c.name || "?").charAt(0).toUpperCase();
    const bg = avatarColor(c.name || "");
    const scopeLabel = SCOPE_LABELS[scope] || "In de buurt";

    // For real neighbour comments, link out to the source property in a new tab.
    // For seeded mock data, render the address as plain text (no fake link).
    let footer;
    if (c.fromUrl) {
      footer = `<a class="fr-neighborhood-comment__link"
            href="${escapeAttr(c.fromUrl)}"
            target="_blank"
            rel="noopener"
          >${escapeHtml(c.fromAddress || "Bekijk de woning")}</a>`;
    } else if (c.fromAddress) {
      footer = `<span class="fr-neighborhood-comment__source">${escapeHtml(c.fromAddress)}${c.fromIsSeed ? " · voorbeeld" : ""}</span>`;
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

  // ---- Event Handlers ----

  function attachEvents(root) {
    const propertyId = getPropertyId();
    const data = loadReactions(propertyId);

    // Emoji reactions
    root.querySelectorAll(".fr-emoji-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const emoji = btn.dataset.emoji;
        const info = data.emojis[emoji];
        if (info.active) {
          info.count = Math.max(0, info.count - 1);
          info.active = false;
          btn.classList.remove("active");
        } else {
          info.count++;
          info.active = true;
          btn.classList.add("active");
        }
        btn.querySelector(".fr-emoji-btn__count").textContent = info.count || "";
        saveReactions(propertyId, data);
      });
    });

    // Compose textarea
    const textarea = root.querySelector("#fr-compose-input");
    const submitBtn = root.querySelector("#fr-submit-btn");

    textarea.addEventListener("input", () => {
      submitBtn.disabled = textarea.value.trim().length === 0;
      // Auto-grow
      textarea.style.height = "auto";
      textarea.style.height = textarea.scrollHeight + "px";
    });

    // Submit comment
    submitBtn.addEventListener("click", () => {
      const text = textarea.value.trim();
      if (!text) return;

      // Generate a random anonymous name
      const names = [
        "Huizenzoeker", "Woningkijker", "Buurtbewoner",
        "Starter", "Bezichtiger", "Vastgoedfan",
        "Koopjesjager", "Huurder", "Verhuizer",
      ];
      const name = names[Math.floor(Math.random() * names.length)];

      const newComment = {
        id: "c_" + Date.now(),
        name,
        text,
        time: new Date().toISOString(),
        upvotes: 0,
        downvotes: 0,
      };

      data.comments.unshift(newComment);
      saveReactions(propertyId, data);

      // Re-render comments. We pass the freshly-computed neighborhood groups
      // so the buurt-blok stays visible underneath after the user posts.
      const list = root.querySelector("#fr-comments-list");
      const neighborhoodGroups = findNeighborhoodComments(propertyId, data.location);
      list.innerHTML = renderComments(data.comments, data.userVotes, neighborhoodGroups);
      attachVoteEvents(root, data, propertyId);

      // Update count
      root.querySelector(".fr-header__count").textContent =
        `${data.comments.length} reactie${data.comments.length !== 1 ? "s" : ""}`;

      // Update badge
      chrome.runtime.sendMessage({
        type: "UPDATE_BADGE",
        count: data.comments.length,
      });

      // Reset input
      textarea.value = "";
      textarea.style.height = "auto";
      submitBtn.disabled = true;
    });

    attachVoteEvents(root, data, propertyId);
  }

  function attachVoteEvents(root, data, propertyId) {
    // Ensure userVotes map exists (for data saved before this feature)
    if (!data.userVotes) data.userVotes = {};

    root.querySelectorAll(".fr-vote-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const commentId = btn.dataset.comment;
        const direction = btn.dataset.vote; // "up" or "down"
        const comment = data.comments.find((c) => c.id === commentId);
        if (!comment) return;

        const previousVote = data.userVotes[commentId] || null;
        const commentEl = btn.closest(".fr-comment");
        const upBtn = commentEl.querySelector('.fr-vote-btn--up');
        const downBtn = commentEl.querySelector('.fr-vote-btn--down');

        if (previousVote === direction) {
          // Clicking the same button again → undo the vote
          if (direction === "up") {
            comment.upvotes = Math.max(0, comment.upvotes - 1);
          } else {
            comment.downvotes = Math.max(0, comment.downvotes - 1);
          }
          data.userVotes[commentId] = null;
          btn.classList.remove("active");
        } else {
          // Remove previous vote if switching
          if (previousVote === "up") {
            comment.upvotes = Math.max(0, comment.upvotes - 1);
            upBtn.classList.remove("active");
          } else if (previousVote === "down") {
            comment.downvotes = Math.max(0, comment.downvotes - 1);
            downBtn.classList.remove("active");
          }

          // Apply new vote
          if (direction === "up") {
            comment.upvotes++;
            upBtn.classList.add("active");
          } else {
            comment.downvotes++;
            downBtn.classList.add("active");
          }
          data.userVotes[commentId] = direction;
        }

        // Update displayed counts
        upBtn.querySelector("span").textContent = comment.upvotes;
        downBtn.querySelector("span").textContent = comment.downvotes;

        saveReactions(propertyId, data);
      });
    });
  }

  // ---- Injection ----

  function isDetailPage() {
    // Match Funda property detail pages — both old and new URL formats
    // /detail/koop/..., /koop/city/huis-name-123/..., etc.
    return /\/(detail\/koop|detail\/huur|koop\/[^/]+\/[^/]+|huur\/[^/]+\/[^/]+)/.test(location.pathname);
  }

  /**
   * Find the makelaar/agent panel on the page.
   *
   * Funda's detail page uses a 2-column CSS grid:
   *   div.lg:grid-cols-[7fr_3fr]
   *     div          ← left column (main content)
   *     div          ← right column (sidebar, contains agent card)
   *       div
   *         div.bg-secondary-10.rounded-lg  ← the agent card
   *
   * The agent card contains "Neem contact op" and "Toon telefoonnummer".
   * We use two strategies:
   *   1. Find the card by its unique class combination (bg-secondary-10 + rounded-lg)
   *   2. Text-based heuristic as fallback
   */
  function findAgentPanel() {
    // Strategy 1: Direct class-based lookup
    // The agent card has bg-secondary-10 and rounded-lg and text-center
    const cardCandidates = document.querySelectorAll('.bg-secondary-10.rounded-lg');
    for (const card of cardCandidates) {
      const text = (card.textContent || "").toLowerCase();
      if (text.includes("neem contact op") || text.includes("toon telefoonnummer")) {
        return card;
      }
    }

    // Strategy 2: Find the right sidebar column, then the first card-like child
    const gridContainer = document.querySelector('[class*="grid-cols-"][class*="7fr"]');
    if (gridContainer) {
      const sidebar = gridContainer.children[1]; // right column
      if (sidebar) {
        // The agent card is typically the first significant child
        const firstCard = sidebar.querySelector('.rounded-lg');
        if (firstCard) return firstCard;
      }
    }

    // Strategy 3: Text-based heuristic — find "Neem contact op" and walk up
    const allLinks = document.querySelectorAll("a");
    for (const link of allLinks) {
      const text = (link.textContent || "").trim().toLowerCase();
      if (text.includes("neem contact op") && link.href && link.href.includes("makelaar-contact")) {
        // Walk up to find the card container (has rounded-lg and bg-secondary-10)
        let parent = link.parentElement;
        for (let depth = 0; depth < 15 && parent; depth++) {
          if (
            parent.classList &&
            (parent.classList.contains("rounded-lg") || parent.classList.contains("bg-secondary-10")) &&
            parent.getBoundingClientRect().height > 100
          ) {
            return parent;
          }
          parent = parent.parentElement;
        }
      }
    }

    // Strategy 4: Look for the "Download brochure" link and find its sibling card
    const brochureLink = document.querySelector('a[href*="valentina_media"][download]');
    if (brochureLink) {
      const wrapper = brochureLink.parentElement;
      if (wrapper) {
        const card = wrapper.querySelector('.rounded-lg');
        if (card) return card;
      }
    }

    return null;
  }

  function findFallbackInjectionPoint() {
    // Try the Funda sidebar column (right side of the 7fr/3fr grid)
    const gridContainer = document.querySelector('[class*="grid-cols-"][class*="7fr"]');
    if (gridContainer && gridContainer.children[1]) {
      return gridContainer.children[1];
    }
    // Generic sidebar selectors
    const sidebarSels = ['aside', '[class*="sidebar"]', '[role="complementary"]'];
    for (const sel of sidebarSels) {
      const el = document.querySelector(sel);
      if (el && el.getBoundingClientRect().width > 100) return el;
    }
    // Main content area
    const mainSels = ['main', '#content', '#__nuxt', '.container', 'article'];
    for (const sel of mainSels) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    return document.body;
  }

  function inject() {
    if (!isDetailPage()) return;
    if (document.getElementById("funda-reacties-root")) return;

    const panel = createPanel();
    const agentPanel = findAgentPanel();

    if (agentPanel) {
      agentPanel.parentNode.insertBefore(panel, agentPanel);
      panel.style.marginTop = "0";
      panel.style.marginBottom = "16px";
      console.log("[Funda Reacties] ✅ Panel injected above agent card");
    } else {
      const target = findFallbackInjectionPoint();
      target.appendChild(panel);
      console.log("[Funda Reacties] ⚠️ Agent card not found, using fallback position");
    }

    attachEvents(panel);

    // Send comment count to background for badge
    try {
      const propertyId = getPropertyId();
      const data = loadReactions(propertyId);
      chrome.runtime.sendMessage({
        type: "UPDATE_BADGE",
        count: data.comments.length,
      });
    } catch (e) { /* sendMessage may fail in non-extension context */ }
  }

  // ---- Robust SPA-aware injection with retry ----

  // Funda is a Nuxt/Vue SPA — the DOM content renders asynchronously
  // after the initial page load. We need to retry injection until the
  // page content (especially the agent card) has rendered.

  let retryCount = 0;
  const maxRetries = 15;

  function attemptInject() {
    if (document.getElementById("funda-reacties-root")) return; // Done
    if (!isDetailPage()) return;
    if (retryCount >= maxRetries) {
      console.log("[Funda Reacties] Max retries reached, injecting at fallback position");
      inject(); // Force inject at fallback
      return;
    }
    retryCount++;

    // Only inject if there's meaningful page content loaded
    // (not just the shell/skeleton)
    const hasContent = document.querySelector('h1') || document.querySelector('[class*="price"]');
    if (hasContent) {
      inject();
    }

    if (!document.getElementById("funda-reacties-root")) {
      setTimeout(attemptInject, 400 + retryCount * 200);
    }
  }

  // Start attempting injection
  attemptInject();

  // Watch for SPA navigation (URL changes without page reload)
  let lastUrl = location.href;
  const observer = new MutationObserver(() => {
    // Handle SPA navigation
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      retryCount = 0;
      const existing = document.getElementById("funda-reacties-root");
      if (existing) existing.remove();
      setTimeout(attemptInject, 300);
    }

    // Handle initial render: keep trying if not yet injected
    if (!document.getElementById("funda-reacties-root") && isDetailPage() && retryCount < maxRetries) {
      attemptInject();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
})();
