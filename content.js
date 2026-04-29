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

  /** Get the property address from the page for display */
  function getPropertyAddress() {
    const h1 = document.querySelector('h1');
    if (h1) return h1.textContent.trim();
    return document.title.replace(/ \[funda\].*/, "").trim();
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
    try {
      const data = localStorage.getItem(STORAGE_KEY + propertyId);
      if (data) return JSON.parse(data);
    } catch (e) { /* ignore */ }

    // Return demo data if nothing saved
    return {
      emojis: {
        "🔥": { count: 3, active: false },
        "😍": { count: 1, active: false },
        "🤔": { count: 2, active: false },
        "💸": { count: 5, active: false },
        "📉": { count: 0, active: false },
        "🏡": { count: 1, active: false },
      },
      // Track the current user's vote per comment: { commentId: "up" | "down" | null }
      userVotes: {},
      comments: [
        {
          id: "demo1",
          name: "Woningzoeker",
          text: "Hier hebben we vorig jaar een bezichtiging gedaan. Erg klein in het echt, foto's zijn misleidend.",
          time: new Date(Date.now() - 86400000 * 3).toISOString(),
          upvotes: 7,
          downvotes: 1,
        },
        {
          id: "demo2",
          name: "Buurman",
          text: "Mooie straat, maar let op: de achterburen hebben een hond die de hele dag blaft. 🐕",
          time: new Date(Date.now() - 86400000 * 1).toISOString(),
          upvotes: 12,
          downvotes: 0,
        },
      ],
    };
  }

  /** Save reactions */
  function saveReactions(propertyId, data) {
    try {
      localStorage.setItem(STORAGE_KEY + propertyId, JSON.stringify(data));
    } catch (e) { /* ignore */ }
  }

  // ---- UI Rendering ----

  function createPanel() {
    const propertyId = getPropertyId();
    const data = loadReactions(propertyId);
    const insights = generateInsights();

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

        <!-- Comments -->
        <ul class="fr-comments" id="fr-comments-list">
          ${renderComments(data.comments, data.userVotes)}
        </ul>

        <!-- Footer -->
        <div class="fr-footer">
          Funda Reacties - voor en door de community
        </div>
      </div>
    `;

    return root;
  }

  function renderComments(comments, userVotes) {
    if (!comments.length) {
      return `
        <li class="fr-empty">
          <div class="fr-empty__icon">🏠</div>
          <p class="fr-empty__text">Nog geen reacties — wees de eerste!</p>
        </li>`;
    }

    userVotes = userVotes || {};

    return comments
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

      // Re-render comments
      const list = root.querySelector("#fr-comments-list");
      list.innerHTML = renderComments(data.comments, data.userVotes);
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
