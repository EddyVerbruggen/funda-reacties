// ==========================================================================
// Funda Reacties — Supabase Client
// ==========================================================================

const SUPABASE_URL = 'https://xjniqvdfwnsvsuuteakt.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhqbmlxdmRmd25zdnN1dXRlYWt0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc0NDgxNjIsImV4cCI6MjA5MzAyNDE2Mn0.Dr-t4SIBaZMYu2nn1553S1VzaSCm2bcnxCcAzue_xKo';

const DEBUG = false;
function dbg(...args) { if (DEBUG) console.log('[Funda Reacties]', ...args); }

const { createClient } = supabase;
const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ==========================================================================
// User Profile — Funda account detectie
// ==========================================================================

const ADJECTIVES = ["Nieuwsgierige","Kritische","Enthousiaste","Rustige","Slimme","Vrolijke","Serieuze","Avontuurlijke"];
const NOUNS      = ["Huizenzoeker","Woningkijker","Starter","Bezichtiger","Koopjesjager","Verhuizer","Investeerder","Huurder"];

function generateDefaultName() {
  return `${ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)]} ${NOUNS[Math.floor(Math.random() * NOUNS.length)]}`;
}

/**
 * Probeer het emailadres van de ingelogde Funda-gebruiker uit de
 * __NUXT_DATA__ JSON-blob in de huidige paginabron te lezen.
 *
 * De blob bevat een patroon als:
 *   "eddyverbruggen@gmail.com"
 * vlak na het "email" key-reference. We zoeken simpelweg naar een
 * e-mailadres in de inline JSON.
 *
 * Geen extra fetch nodig — de data staat al in de DOM.
 */
function detectFundaEmailFromPage() {
  try {
    // Zoek alle inline <script> tags naar __NUXT_DATA__ of een script
    // dat een e-mailadres bevat in de context van Funda account-data.
    const scripts = document.querySelectorAll('script[id="__NUXT_DATA__"]');
    for (const script of scripts) {
      const src = script.textContent || '';
      // Zoek naar e-mailadres dat direct na "email" in de JSON staat.
      // Patroon: ,"email@domain.tld", (omringd door komma's en aanhalingstekens)
      const emailMatch = src.match(/"([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})"/);
      if (emailMatch) {
        // Controleer of dit een Funda-context script is (bevat ook access_token of hashedEmail)
        if (src.includes('hashedEmail') || src.includes('access_token') || src.includes('hashedId')) {
          console.log('[Funda Reacties] Email gevonden in paginabron:', emailMatch[1]);
          return emailMatch[1];
        }
      }
    }
  } catch (e) {
    console.warn('[Funda Reacties] Fout bij lezen paginabron:', e);
  }
  return null;
}

/**
 * Probeer naam + email op te halen via een fetch naar /account/.
 * De pagina bevat: <h1>Hallo Eddy </h1> en <p>eddyverbruggen@gmail.com</p>
 *
 * Werkt alleen als de gebruiker ingelogd is; anders redirect Funda
 * naar de loginpagina en geven we null terug.
 */
async function detectFundaAccountFromFetch() {
  try {
    const res = await fetch('https://www.funda.nl/account/', {
      credentials: 'include', // stuur Funda-cookies mee
      headers: { 'Accept': 'text/html' }
    });

    if (!res.ok) return null;

    const html = await res.text();

    // Naam: "Hallo Eddy" → "Eddy"
    const nameMatch = html.match(/Hallo\s+([^<\s][^<]*?)\s*(?:<!--\]-->|<\/)/);
    const name = nameMatch ? nameMatch[1].trim() : null;

    // Email: eerste geldig e-mailadres in de HTML
    const emailMatch = html.match(/([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/);
    const email = emailMatch ? emailMatch[1] : null;

    if (email) {
      console.log('[Funda Reacties] Account via fetch:', { name, email });
      return { name, email };
    }
  } catch (e) {
    console.warn('[Funda Reacties] Fetch /account/ mislukt:', e);
  }
  return null;
}

/**
 * Bepaal het gebruikersprofiel.
 *
 * Prioriteitsvolgorde voor userId:
 *   1. email van ingelogde Funda-gebruiker (stabiel, account-gebonden)
 *   2. Bestaand anoniem userId uit chrome.storage.local
 *   3. Nieuw gegenereerd anoniem userId
 *
 * Prioriteitsvolgorde voor displayName:
 *   1. Voornaam van ingelogde Funda-gebruiker
 *   2. Handmatig ingestelde naam (chrome.storage.local → displayName)
 *   3. Automatisch gegenereerde naam
 *
 * Bij koppeling anoniem→ingelogd:
 *   Als er een bestaand anoniem ID is én nu een Funda-email gevonden
 *   wordt, slaan we het anonieme ID op als 'previousUserId' zodat
 *   we later comments kunnen migreren.
 */
// In-memory lock: voorkomt dat parallelle aanroepen elk een nieuw userId aanmaken
let _profilePromise = null;
let _profileCache   = null;

function resetProfileCache() {
  _profileCache   = null;
  _profilePromise = null;
  try { sessionStorage.removeItem('funda_reacties_profile'); } catch (e) { /* ignore */ }
}

async function getUserProfile() {
  const SESSION_KEY = 'funda_reacties_profile';

  // 1. In-memory cache (snelste, zelfde tab)
  if (_profileCache?.userId) return _profileCache;

  // 2. Lopende aanroep: wacht op dezelfde promise i.p.v. parallel te draaien
  if (_profilePromise) return _profilePromise;

  // 3. Sessionstorage (overleeft kleine re-renders, niet een verse installatie)
  try {
    const cached = sessionStorage.getItem(SESSION_KEY);
    if (cached) {
      const profile = JSON.parse(cached);
      if (profile?.userId) { _profileCache = profile; return profile; }
    }
  } catch (e) { /* ignore */ }

  _profilePromise = new Promise((resolve) => {
    chrome.storage.local.get(['userId', 'displayName', 'fundaEmail'], async (stored) => {
      let userId      = stored.userId      || null;
      let displayName = stored.displayName || null;
      let fundaEmail  = stored.fundaEmail  || null;
      let source      = 'anonymous';

      // Als er al een fundaEmail in storage staat, gebruik die direct.
      // De /account/ fetch wordt NOOIT hier gedaan — dat is de taak van
      // watchLoginState in content.js, die weet of de gebruiker ingelogd is.
      if (fundaEmail) {
        userId = `funda:${fundaEmail}`;
        source = 'funda-stored';
      }

      // Fallback — anoniem ID
      if (!userId) {
        userId = 'user_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        source = 'anonymous-new';
        console.log('[Funda Reacties] Nieuw anoniem userId:', userId);
      }

      if (!displayName) displayName = generateDefaultName();

      const profile = { userId, displayName, fundaEmail: fundaEmail || null, source };

      chrome.storage.local.set({ userId, displayName, fundaEmail: fundaEmail || null });
      try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(profile)); } catch (e) { /* ignore */ }
      _profileCache   = profile;
      _profilePromise = null;

      console.log('[Funda Reacties] Profiel (lokaal):', profile);
      resolve(profile);
    });
  });

  return _profilePromise;
}

/**
 * Sla een nieuwe displayName op (handmatig ingesteld door de gebruiker).
 */
async function saveDisplayName(displayName) {
  return new Promise((resolve) => {
    chrome.storage.local.get(['userId'], (result) => {
      chrome.storage.local.set({ displayName }, () => {
        try {
          const SESSION_KEY = 'funda_reacties_profile';
          const cached = sessionStorage.getItem(SESSION_KEY);
          const profile = cached ? JSON.parse(cached) : { userId: result.userId };
          profile.displayName = displayName;
          sessionStorage.setItem(SESSION_KEY, JSON.stringify(profile));
        } catch (e) { /* ignore */ }
        resolve({ userId: result.userId, displayName });
      });
    });
  });
}

// Backwards-compat
async function getUserId() {
  const profile = await getUserProfile();
  return profile.userId;
}

// ==========================================================================
// API Functions
// ==========================================================================

// ==========================================================================
// Prijshistorie
// ==========================================================================

/**
 * Registreert de huidige vraagprijs als die verschilt van de laatste bekende.
 * Roept de server-side RPC aan zodat er geen race-condition kan optreden.
 *
 * @param {string} propertyId
 * @param {string|null} priceText    - Ruwe tekst, bijv. "€ 425.000"
 * @param {number|null} priceNum     - Geparsed getal in euros
 * @param {number|null} pricePerM2   - Prijs per m² (int)
 * @returns {{ inserted: boolean, previousPriceNum: number|null }}
 */
async function recordPriceIfChanged(propertyId, price, pricePerM2) {
  if (!propertyId || !price) return { inserted: false, previousPrice: null };
  try {
    const { data, error } = await supabaseClient.rpc('record_price_if_changed', {
      p_property_id:  propertyId,
      p_price:        price        ?? null,
      p_price_per_m2: pricePerM2   ?? null,
    });
    if (error) { console.error('[Funda Reacties] recordPriceIfChanged fout:', error); return { inserted: false, previousPrice: null }; }
    return { inserted: data.inserted, previousPrice: data.previous_price ?? null };
  } catch (e) {
    console.error('[Funda Reacties] recordPriceIfChanged exception:', e);
    return { inserted: false, previousPrice: null };
  }
}

/**
 * Haalt de volledige vraagprijshistorie op, gesorteerd van nieuw naar oud.
 * Wordt gebruikt voor:
 *   - de prijswijziging-banner (nieuwste vs op-één-na-nieuwste)
 *   - renderPriceChange per comment (zoek entry dichtst bij comment.created_at)
 *
 * @param {string} propertyId
 * @returns {Array<{ price_text, price_num, price_per_m2, recorded_at }>}
 */
async function getLastKnownPrice(propertyId) {
  if (!propertyId) return [];
  try {
    const { data, error } = await supabaseClient
      .from('property_price_history')
      .select('price, price_per_m2, recorded_at')
      .eq('property_id', propertyId)
      .order('recorded_at', { ascending: false });
    if (error) { console.error('[Funda Reacties] getLastKnownPrice fout:', error); return []; }
    return data || [];
  } catch (e) {
    console.error('[Funda Reacties] getLastKnownPrice exception:', e);
    return [];
  }
}

async function getReactions(propertyId) {
  try {
    const { data: property, error: propError } = await supabaseClient
      .from('properties')
      .select('*, emoji_reactions(*), comments(*, votes(*))')
      .eq('property_id', propertyId)
      .single();
    if (propError && propError.code !== 'PGRST116') { console.error('Error fetching property:', propError); return null; }
    return property;
  } catch (error) { console.error('Error in getReactions:', error); return null; }
}

async function upsertProperty(propertyId, address, url, location) {
  try {
    const { data, error } = await supabaseClient
      .from('properties')
      .upsert({
        property_id:      propertyId,
        address,
        url,
        loc_street:       location?.street       || null,
        loc_neighborhood: location?.neighborhood || null,
        loc_city:         location?.city         || null,
        loc_province:     location?.province     || null,
        updated_at:       new Date().toISOString(),
      }, { onConflict: 'property_id' })
      .select().single();
    if (error) { console.error('Error upserting property:', error); return null; }
    return data;
  } catch (error) { console.error('Error in upsertProperty:', error); return null; }
}

/**
 * Vergelijkt de price_per_m2 van een woning met andere woningen in dezelfde
 * straat, wijk of stad (hiërarchische fallback via server-side RPC).
 *
 * @param {string} propertyId
 * @returns {{ scope, pct_diff, own_price_per_m2, avg_price_per_m2, count } | null}
 */
async function getPricePerM2Comparison(propertyId) {
  if (!propertyId || !/^\d{6,}$/.test(propertyId)) return null;
  try {
    const { data, error } = await supabaseClient.rpc('get_price_per_m2_comparison', {
      p_property_id: propertyId,
    });
    if (error) { console.error('[Funda Reacties] getPricePerM2Comparison fout:', error); return null; }
    if (!data || data.scope === null) return null;
    return data;
  } catch (e) {
    console.error('[Funda Reacties] getPricePerM2Comparison exception:', e);
    return null;
  }
}

async function trackPropertyView(propertyId) {
  try {
    const profile = await getUserProfile();
    const { error } = await supabaseClient.rpc('track_property_view', {
      p_user_id:      profile.userId,
      p_display_name: profile.displayName,
      p_is_anonymous: !profile.fundaEmail,
      p_property_id:  propertyId,
    });
    if (error) console.error('Error tracking property view:', error);
  } catch (error) { console.error('Error in trackPropertyView:', error); }
}

async function toggleEmojiReaction(propertyId, emoji, userId) {
  try {
    const { data: existing, error: fetchError } = await supabaseClient
      .from('emoji_reactions').select('*').eq('property_id', propertyId).eq('emoji', emoji).eq('user_id', userId).maybeSingle();
    if (fetchError) { console.error('Error checking emoji:', fetchError); return { active: false, count: 0 }; }

    if (existing) {
      const { error } = await supabaseClient.from('emoji_reactions').delete().eq('id', existing.id);
      if (error) { console.error('Error deleting emoji:', error); return { active: true, count: 0 }; }
    } else {
      const { error } = await supabaseClient.from('emoji_reactions').insert({ property_id: propertyId, emoji, user_id: userId });
      if (error) { console.error('Error inserting emoji:', error); return { active: false, count: 0 }; }
    }

    const { count } = await supabaseClient.from('emoji_reactions').select('*', { count: 'exact', head: true }).eq('property_id', propertyId).eq('emoji', emoji);
    return { active: !existing, count: count || 0 };
  } catch (error) { console.error('Error in toggleEmojiReaction:', error); return { active: false, count: 0 }; }
}

async function getEmojiCounts(propertyId, userId) {
  try {
    const { data, error } = await supabaseClient.from('emoji_reactions').select('emoji, user_id').eq('property_id', propertyId);
    if (error) { console.error('Error fetching emoji counts:', error); return {}; }
    const counts = {};
    data.forEach(r => {
      if (!counts[r.emoji]) counts[r.emoji] = { count: 0, active: false };
      counts[r.emoji].count++;
      if (r.user_id === userId) counts[r.emoji].active = true;
    });
    return counts;
  } catch (error) { console.error('Error in getEmojiCounts:', error); return {}; }
}

async function postComment(propertyId, text, name, userId) {
  try {
    const { data, error } = await supabaseClient
      .from('comments').insert({ property_id: propertyId, user_id: userId, name, text }).select().single();
    if (error) { console.error('Error posting comment:', error); return null; }
    return data;
  } catch (error) { console.error('Error in postComment:', error); return null; }
}

async function deleteComment(commentId, userId) {
  try {
    dbg('[deleteComment] Starting delete for commentId:', commentId, 'userId:', userId);

    // Verify ownership: fetch comment and check user_id
    const { data: comment, error: fetchError } = await supabaseClient
      .from('comments').select('user_id').eq('id', commentId).single();

    if (fetchError) {
      dbg('[deleteComment] Fetch error:', fetchError);
      console.error('Error fetching comment:', fetchError);
      return false;
    }

    if (!comment) {
      dbg('[deleteComment] Comment not found');
      console.error('Comment not found');
      return false;
    }

    dbg('[deleteComment] Comment fetched, user_id:', comment.user_id, 'current userId:', userId);

    if (comment.user_id !== userId) {
      dbg('[deleteComment] Unauthorized: not comment owner');
      console.error('Unauthorized: not comment owner');
      return false;
    }

    dbg('[deleteComment] Deleting comment ' + commentId);
    const { error } = await supabaseClient.from('comments').delete().eq('id', commentId);

    if (error) {
      dbg('[deleteComment] Delete error:', error);
      console.error('Error deleting comment:', error);
      return false;
    }

    dbg('[deleteComment] Delete successful');
    return true;
  } catch (error) {
    dbg('[deleteComment] Exception:', error);
    console.error('Error in deleteComment:', error);
    return false;
  }
}

async function voteComment(commentId, userId, voteType) {
  try {
    const { data: existing, error: fetchError } = await supabaseClient
      .from('votes').select('*').eq('comment_id', commentId).eq('user_id', userId).maybeSingle();
    if (fetchError) { console.error('Error checking vote:', fetchError); return null; }

    if (existing) {
      if (existing.vote_type === voteType) {
        await supabaseClient.from('votes').delete().eq('id', existing.id);
      } else {
        await supabaseClient.from('votes').update({ vote_type: voteType }).eq('id', existing.id);
      }
    } else {
      await supabaseClient.from('votes').insert({ comment_id: commentId, user_id: userId, vote_type: voteType });
    }
    return getVoteCounts(commentId);
  } catch (error) { console.error('Error in voteComment:', error); return null; }
}

async function getVoteCounts(commentId) {
  try {
    const { data, error } = await supabaseClient.from('votes').select('vote_type').eq('comment_id', commentId);
    if (error) { console.error('Error fetching votes:', error); return { upvotes: 0, downvotes: 0 }; }
    return { upvotes: data.filter(v => v.vote_type === 'up').length, downvotes: data.filter(v => v.vote_type === 'down').length };
  } catch (error) { console.error('Error in getVoteCounts:', error); return { upvotes: 0, downvotes: 0 }; }
}

async function getNeighborhoodComments(currentPropertyId, location, limitPerScope = 3) {
  try {
    if (!location || Object.keys(location).length === 0) return [];

    // region en province worden nooit gevuld; alleen street/neighborhood/city
    const SCOPE_ORDER = ['street', 'neighborhood', 'city'];
    const LOC_COL = { street: 'loc_street', neighborhood: 'loc_neighborhood', city: 'loc_city' };

    const results = [];
    const seenCommentIds = new Set();

    for (const scope of SCOPE_ORDER) {
      if (!location[scope]) continue;
      const col = LOC_COL[scope];

      const { data, error } = await supabaseClient
        .from('comments')
        .select(`*, properties!inner(property_id, address, url, ${col})`)
        .neq('property_id', currentPropertyId)
        .eq(`properties.${col}`, location[scope])
        // Stad-scope: ook filteren op city zodat straat/wijk-queries impliciet al stads-afgebakend zijn
        .eq('properties.loc_city', location.city || '')
        .order('created_at', { ascending: false })
        .limit(limitPerScope * 2);

      if (error) { console.error(`Error fetching ${scope} comments:`, error); continue; }
      if (data?.length) {
        const unique = [];
        for (const c of data) {
          if (seenCommentIds.has(c.id)) continue;
          seenCommentIds.add(c.id);
          unique.push({ ...c, fromAddress: c.properties.address, fromUrl: c.properties.url });
          if (unique.length >= limitPerScope) break;
        }
        if (unique.length) results.push({ scope, comments: unique });
        if (results.reduce((s, g) => s + g.comments.length, 0) >= 3) break;
      }
    }
    return results;
  } catch (error) { console.error('Error in getNeighborhoodComments:', error); return []; }
}

function subscribeToPropertyUpdates(propertyId, userId, onNewComment) {
  console.log('[Funda Reacties] Subscribing to realtime, property:', propertyId, 'userId:', userId);
  const channel = supabaseClient
    .channel('comments-inserts-' + Date.now())
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'comments' }, async (payload) => {
      const c = payload.new;
      console.log('[Funda Reacties] Realtime INSERT — property:', c.property_id, 'expected:', propertyId, 'author:', c.user_id, 'me:', userId);
      if (c.property_id !== propertyId) return;
      if (c.user_id === userId) { console.log('[Funda Reacties] Own comment, ignoring'); return; }

      const { data: userComments } = await supabaseClient.from('comments').select('id').eq('property_id', propertyId).eq('user_id', userId).limit(1);
      const { data: userEmojis }   = await supabaseClient.from('emoji_reactions').select('id').eq('property_id', propertyId).eq('user_id', userId).limit(1);
      const hasReacted = (userComments?.length > 0) || (userEmojis?.length > 0);
      console.log('[Funda Reacties] hasReacted:', hasReacted);
      if (hasReacted) onNewComment(c);
    })
    .subscribe((status, err) => {
      console.log('[Funda Reacties] Realtime status:', status);
      if (err) console.error('[Funda Reacties] Realtime error:', err);
    });
  return channel;
}

function unsubscribeFromPropertyUpdates(channel) {
  if (channel) supabaseClient.removeChannel(channel);
}

// ==========================================================================
// WOZ-waarde opslag en cache
// ==========================================================================

/**
 * Haalt gecachede WOZ-data op uit de database.
 *
 * Cache-strategie:
 *   - WOZ-waarden worden één keer per jaar vastgesteld (voor het vorige jaar).
 *     Zodra we in de DB een rij hebben voor het meest recente peiljaar
 *     (= huidig jaar minus 1), hoeven we de externe API nooit meer te bellen.
 *   - Als we voor dit property_id al rijen hebben EN we peiljaar (huidigJaar-1)
 *     al kennen, is de cache compleet en sturen we de data terug.
 *   - Anders sturen we null → client moet externe API aanroepen.
 *
 * @returns {Array<{ peildatum: string, vastgesteldeWaarde: number }>|null}
 *          in hetzelfde formaat als de externe API, of null als cache leeg/onvolledig is
 */
async function getCachedWozData(propertyId) {
  if (!propertyId) return null;
  try {
    const { data, error } = await supabaseClient
      .from('property_woz_history')
      .select('peiljaar, woz_waarde')
      .eq('property_id', propertyId)
      .order('peiljaar', { ascending: true });
    if (error || !data || data.length === 0) return null;

    // Check of het meest recente peiljaar (vorig jaar) al in de cache zit
    const latestExpected = new Date().getFullYear() - 1;
    const hasLatest = data.some(r => r.peiljaar >= latestExpected);
    if (!hasLatest) return null;  // cache onvolledig — haal vers op

    // Zet om naar het formaat van de externe API
    return data.map(r => ({
      peildatum: `${r.peiljaar}-01-01`,
      vastgesteldeWaarde: r.woz_waarde,
    }));
  } catch (e) {
    console.error('[Funda Reacties] getCachedWozData exception:', e);
    return null;
  }
}

/**
 * Slaat WOZ-data op via de server-side RPC.
 * Input is het ruwe API-formaat: [{ peildatum: 'yyyy-MM-dd', vastgesteldeWaarde: number }]
 * Geeft de opgeslagen data terug in datzelfde formaat.
 * Locatie-informatie voor aggregaties loopt via JOIN op properties.loc_* — geen extra param.
 *
 * @param {string} propertyId
 * @param {Array<{peildatum: string, vastgesteldeWaarde: number}>} wozData
 * @returns {Array<{peildatum: string, vastgesteldeWaarde: number}>|null}
 */
async function saveWozData(propertyId, wozData) {
  if (!propertyId || !wozData || wozData.length === 0) return null;
  try {
    const payload = wozData.map(w => ({
      peiljaar:   parseInt(w.peildatum.slice(0, 4), 10),
      woz_waarde: w.vastgesteldeWaarde,
    }));
    const { data, error } = await supabaseClient.rpc('upsert_woz_history', {
      p_property_id: propertyId,
      p_woz_data:    payload,
    });
    if (error) { console.error('[Funda Reacties] saveWozData fout:', error); return null; }
    // RPC geeft terug: [{ peiljaar, woz_waarde }]
    return (data || []).map(r => ({
      peildatum: `${r.peiljaar}-01-01`,
      vastgesteldeWaarde: r.woz_waarde,
    }));
  } catch (e) {
    console.error('[Funda Reacties] saveWozData exception:', e);
    return null;
  }
}

/**
 * Haalt de gemiddelde jaarlijkse WOZ-groei (CAGR) op voor een stad,
 * voor vergelijking met de groei van een individuele woning.
 *
 * @param {string} city    - lowercase stadsslug, bijv. 'amsterdam'
 * @param {number} years   - hoeveel jaar terug (default 8)
 * @returns {{ cagr_pct, from_jaar, to_jaar, from_avg, to_avg, count } | null}
 */
async function getCityWozGrowth(city, years = 8) {
  if (!city) return null;
  try {
    const { data, error } = await supabaseClient.rpc('get_city_woz_growth', {
      p_city:  city,
      p_years: years,
    });
    if (error) { console.error('[Funda Reacties] getCityWozGrowth fout:', error); return null; }
    if (!data || data.cagr_pct === null) return null;
    return data;
  } catch (e) {
    console.error('[Funda Reacties] getCityWozGrowth exception:', e);
    return null;
  }
}

/**
 * Haalt WOZ-statistieken per peiljaar op voor een stad (popup stadsoverzicht).
 *
 * @param {string} city   - lowercase stadsslug, bijv. 'amsterdam'
 * @param {number} years  - aantal peiljaren terug (default 5)
 * @returns {Array<{ peiljaar, avg_woz, count }>|null}
 */
async function getCityWozStats(city, years = 5) {
  if (!city) return null;
  try {
    const { data, error } = await supabaseClient.rpc('get_city_woz_stats', {
      p_city:  city,
      p_years: years,
    });
    if (error) { console.error('[Funda Reacties] getCityWozStats fout:', error); return null; }
    return data || null;
  } catch (e) {
    console.error('[Funda Reacties] getCityWozStats exception:', e);
    return null;
  }
}

/**
 * Haalt de meest actief becommentarieerde woningen op die de gebruiker heeft bezocht.
 * 'Actief' = meeste recente comments van anderen (niet van de user zelf).
 *
 * @param {string[]} propertyIds  - lijst van bekeken property_ids (uit properties_viewed)
 * @param {number}   limit        - max aantal te tonen (default 3)
 * @returns {Array<{ property_id, address, url, comment_count, latest_comment_at }>|null}
 */
async function getMostActiveViewedProperties(propertyIds, limit = 3) {
  if (!propertyIds || propertyIds.length === 0) return null;
  try {
    const { data, error } = await supabaseClient
      .from('comments')
      .select('property_id, created_at, properties(address, url)')
      .in('property_id', propertyIds)
      .order('created_at', { ascending: false })
      .limit(200);  // ruim ophalen, dan client-side aggregeren
    if (error) { console.error('[Funda Reacties] getMostActiveViewedProperties fout:', error); return null; }
    if (!data || data.length === 0) return null;

    // Aggregeer per property_id: tel comments en onthoud meest recente
    const byProp = {};
    for (const row of data) {
      if (!byProp[row.property_id]) {
        byProp[row.property_id] = {
          property_id: row.property_id,
          address: row.properties?.address || row.property_id,
          url: row.properties?.url || null,
          comment_count: 0,
          latest_comment_at: row.created_at,
        };
      }
      byProp[row.property_id].comment_count++;
    }

    return Object.values(byProp)
      .sort((a, b) => b.comment_count - a.comment_count || b.latest_comment_at.localeCompare(a.latest_comment_at))
      .slice(0, limit);
  } catch (e) {
    console.error('[Funda Reacties] getMostActiveViewedProperties exception:', e);
    return null;
  }
}

// ==========================================================================
// Straat verkooptijd — gem. verkooptijd per straat (via /informatie/)
// ==========================================================================

/**
 * Haalt de gem. verkooptijd op voor een straat:
 * 1. Kijk eerst in de Supabase-cache (needs_refresh == false → geef terug).
 * 2. Zo niet: scrape de /informatie/<city>/<street>/ pagina.
 * 3. Sla het resultaat op via de RPC (max 1x per week).
 *
 * @param {string} city        - lowercase city slug, bijv. 'nijkerk'
 * @param {string} streetSlug  - URL-slug, bijv. 'coltoflaan-van-oldenbarneveldstraat'
 * @returns {{ avgSaleDays: number|null, lastFetchedAt: string|null }}
 */
async function getStreetSaleStats(city, streetSlug) {
  if (!city || !streetSlug) return { avgSaleDays: null, lastFetchedAt: null };

  try {
    // 1. Probeer de DB-cache
    const { data: cached, error: cacheErr } = await supabaseClient.rpc('get_street_sale_stats', {
      p_city:         city,
      p_neighborhood: streetSlug,
    });

    if (!cacheErr && cached && cached.length > 0) {
      const row = cached[0];
      if (!row.out_needs_refresh) {
        dbg('StreetSaleStats: cache hit', city, streetSlug, row.out_avg_sale_days, 'dagen');
        return { avgSaleDays: row.out_avg_sale_days, lastFetchedAt: row.out_last_fetched_at };
      }
      dbg('StreetSaleStats: cache vervallen, refresh nodig');
    }

    // 2. Scrape de /informatie/ pagina
    const infoUrl = `https://www.funda.nl/informatie/${encodeURIComponent(city)}/${encodeURIComponent(streetSlug)}/`;
    dbg('StreetSaleStats: scraping', infoUrl);
    const res = await fetch(infoUrl, { credentials: 'omit', headers: { 'Accept': 'text/html' } });
    if (!res.ok) { dbg('StreetSaleStats: fetch mislukt', res.status); return { avgSaleDays: null, lastFetchedAt: null }; }

    const html = await res.text();

    // Zoek naar het patroon "Gem. verkooptijd" gevolgd door een getal en "dagen"
    // HTML-patroon: <div class="truncate">Gem. verkooptijd</div><div ...>19 dagen</div>
    const match = html.match(/Gem\. verkooptijd[\s\S]{0,200}?(\d+)\s*dagen/i);
    if (!match) {
      dbg('StreetSaleStats: gem. verkooptijd niet gevonden in HTML');
      return { avgSaleDays: null, lastFetchedAt: null };
    }

    const saleDays = parseInt(match[1], 10);
    dbg('StreetSaleStats: gevonden', saleDays, 'dagen voor', city, streetSlug);

    // 3. Sla op via RPC (upsert — alleen als >7 dagen geleden of nieuw)
    const { data: saved, error: saveErr } = await supabaseClient.rpc('upsert_street_sale_stats', {
      p_city:         city,
      p_neighborhood: streetSlug,
      p_sale_days:    saleDays,
    });
    if (saveErr) console.error('[Funda Reacties] upsert_street_sale_stats fout:', saveErr);

    const lastFetchedAt = saved?.[0]?.last_fetched_at || new Date().toISOString();
    return { avgSaleDays: saleDays, lastFetchedAt };
  } catch (e) {
    console.error('[Funda Reacties] getStreetSaleStats exception:', e);
    return { avgSaleDays: null, lastFetchedAt: null };
  }
}

// ==========================================================================
// Account Migratie — koppel anonieme comments aan Funda-account
// ==========================================================================

/**
 * Migreert comments en emoji-reacties van een anoniem user_id naar
 * het Funda-account user_id. Wordt eenmalig aangeroepen direct na
 * login-detectie als er een previousUserId bekend is.
 *
 * Roept de Supabase RPC-functie migrate_anonymous_comments aan,
 * die server-side de UPDATE uitvoert met SECURITY DEFINER.
 *
 * Na succesvolle migratie wordt previousUserId gewist uit storage.
 */
async function migrateAnonymousData(anonId, fundaId, displayName) {
  if (!anonId || !fundaId || anonId === fundaId) return;

  console.log('[Funda Reacties] Migratie start:', anonId, '→', fundaId);

  try {
    const { data, error } = await supabaseClient.rpc('migrate_anonymous_comments', {
      p_anon_id:  anonId,
      p_funda_id: fundaId,
      p_new_name: displayName || '',
    });

    if (error) {
      console.error('[Funda Reacties] Migratie mislukt:', error);
      return;
    }

    console.log('[Funda Reacties] Migratie resultaat:', data);
    chrome.storage.local.remove('previousUserId');
  } catch (e) {
    console.error('[Funda Reacties] Migratie exception:', e);
  }
}

// ==========================================================================
// Whisper Comments — lokaal gegenereerde observaties (geen DB)
// ==========================================================================

/**
 * Genereert plausibele observaties puur op basis van woningdata van de pagina.
 * Wordt volledig lokaal uitgevoerd — er gaat niets naar de database.
 *
 * @param {object} propertyData  - { priceNum, livingArea, pricePerM2, energyLabel,
 *                                   buildYear, daysOnline, city, isMonument, plotArea }
 * @returns {string[]}           - array van observatieteksten
 */
function titleCaseCity(str) {
  if (!str) return str;
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function generateWhisperTexts(propertyData) {
  const { priceNum, livingArea, pricePerM2, energyLabel, buildYear, daysOnline, city: rawCity, isMonument, plotArea,
          wozWaarde, wozJaar, wozGroeiPct, vvePerMaand } = propertyData;
  const city = titleCaseCity(rawCity);
  const texts = [];

  // ---- Monument — altijd tonen als aanwezig ----
  if (isMonument) {
    texts.push('Dit is een monumentaal pand. Verbouwingen zijn aan strenge regels gebonden — controleer of alle benodigde vergunningen aanwezig en geldig zijn voordat je een bod uitbrengt.');
  }

  // ---- VvE servicekosten > €250/mnd ----
  if (vvePerMaand !== null && vvePerMaand > 250) {
    const jaarlasten = Math.round(vvePerMaand * 12).toLocaleString('nl-NL');
    texts.push(`De VvE-bijdrage is €\u00a0${Math.round(vvePerMaand).toLocaleString('nl-NL')} per maand — dat is €\u00a0${jaarlasten} per jaar bovenop je hypotheeklasten. Controleer wat er precies inbegrepen is (verzekering, reservefonds, beheer) en of het reservefonds toereikend is voor toekomstig onderhoud.`);
  }

  // ---- Groot perceel ----
  if (plotArea > 600) {
    texts.push(`Het perceel is ${plotArea} m² — fijn als je van tuinieren houdt, maar houd rekening met de tijd en kosten die een grote tuin met zich meebrengt.`);
  }

  // ---- WOZ-waardeontwikkeling ----
  if (texts.length < 3 && wozWaarde && wozJaar) {
    const wozFmt = `€\u00a0${Math.round(wozWaarde / 1000)}k`;
    if (wozGroeiPct !== null) {
      const groeiStr = wozGroeiPct.toFixed(1).replace('.', ',');
      if (wozGroeiPct > 8) {
        texts.push(`WOZ-waarde (${wozJaar}: ${wozFmt}) is de afgelopen jaren fors gestegen — gem. +${groeiStr}%/jaar. Wijst op een populaire en gewilde omgeving.`);
      } else if (wozGroeiPct < 2) {
        texts.push(`De WOZ-waarde (${wozJaar}: ${wozFmt}) steeg maar beperkt, gem. +${groeiStr}%/jaar. Houd dat in het achterhoofd bij je waardering.`);
      } else {
        texts.push(`WOZ-waarde (${wozJaar}: ${wozFmt}), gem. stijging +${groeiStr}%/jaar. Dat is een solide waardeontwikkeling voor deze omgeving.`);
      }
    } else {
      // Slechts 1 peiljaar beschikbaar
      if (priceNum && wozWaarde > 0) {
        const pct = Math.round(((priceNum - wozWaarde) / wozWaarde) * 100);
        if (Math.abs(pct) >= 2) {
          const richting = pct > 0 ? `${pct}% boven` : `${Math.abs(pct)}% onder`;
          texts.push(`De vraagprijs ligt ${richting} de WOZ-waarde van ${wozJaar} (${wozFmt}). Dat is normaal, maar het geeft een referentiepunt voor je bod.`);
        }
      }
    }
  }

  // ---- Energielabel-commentaar ----
  if (texts.length < 3 && energyLabel) {
    const label = energyLabel.trim().toUpperCase();
    if (['A', 'A+', 'A++', 'A+++', 'A++++'].includes(label)) {
      texts.push(`Energielabel ${label} — dat scheelt flink op de maandlasten. Prettig als de hypotheeknormen toch al krap zijn.`);
    } else if (['F', 'G'].includes(label)) {
      texts.push(`Energielabel ${label}: verwacht hogere stookkosten. Isolatie aanpakken kan de woning flink in waarde laten stijgen, maar reken op een investering.`);
    } else if (['D', 'E'].includes(label)) {
      texts.push(`Label ${label} is niet geweldig. Navragen welke isolatiemaatregelen al gedaan zijn en wat er nog op de planning staat.`);
    }
  }

  // ---- Bouwjaar-commentaar ----
  if (texts.length < 3 && buildYear) {
    const year = parseInt(buildYear, 10);
    if (year < 1960) {
      texts.push(`Bouwjaar ${year} — charme genoeg, maar let op fundering, loodleidingen en elektrische installatie. Een bouwkundige keuring betaalt zichzelf terug.`);
    } else if (year >= 1960 && year < 1985) {
      texts.push(`Jaren '${String(year).slice(2, 4)}-bouw: vaak solide, maar isolatie en kozijnen kunnen verouderd zijn. Controleer of er al dubbel glas in zit.`);
    } else if (year >= 2010) {
      const vveTip = vvePerMaand !== null ? ' Wel goed de VvE-reservering checken.' : '';
      texts.push(`Relatief nieuw (${year}), dus de grote onderhoudsbeurt staat nog niet voor de deur.${vveTip}`);
    }
  }

  // ---- Prijscommentaar ----
  if (texts.length < 3 && pricePerM2 && priceNum) {
    if (pricePerM2 > 6000) {
      texts.push(`Forse vraagprijs voor ${city || 'deze buurt'} — meer dan €${Math.round(pricePerM2 / 100) * 100}/m² is hier aan de hoge kant. Benieuwd of er ruimte zit.`);
    } else if (pricePerM2 < 3000) {
      texts.push(`Opvallend scherp geprijsd voor ${city || 'hier'} — €${Math.round(pricePerM2 / 100) * 100}/m² is aantrekkelijk. Let wel op de staat van onderhoud.`);
    } else {
      texts.push(`Vraagprijs lijkt marktconform voor ${city || 'deze buurt'}. Altijd de moeite waard om te bezichtigen en te vergelijken.`);
    }
  } else if (texts.length < 2 && priceNum) {
    if (priceNum > 750000) {
      texts.push('Stevige vraagprijs. Bij dit budget zijn afwerking en locatie cruciaal — een bouwkundige keuring is zeker aan te raden.');
    } else if (priceNum < 300000) {
      const vveCheck = vvePerMaand !== null ? ' Goed controleren of de VvE gezond is.' : '';
      texts.push(`Interessante startersprijs.${vveCheck}`);
    }
  }

  // ---- Tijd online ----
  if (texts.length < 3 && daysOnline !== null && daysOnline !== undefined) {
    if (daysOnline > 60) {
      texts.push(`Al ${daysOnline} dagen online — vraag gerust waarom het nog niet verkocht is. Soms zit er een verhaal achter, soms is er gewoon onderhandelingsruimte.`);
    } else if (daysOnline <= 3) {
      texts.push('Vers aanbod! Als het interessant is, snel reageren — goede woningen in dit segment gaan tegenwoordig razendsnel.');
    }
  }

  return texts;
}
