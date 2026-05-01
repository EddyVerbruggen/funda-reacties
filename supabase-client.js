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
async function getUserProfile() {
  const SESSION_KEY = 'funda_reacties_profile';

  // 1. Snelle cache: sessionstorage (per tab, werkt ook in incognito)
  try {
    const cached = sessionStorage.getItem(SESSION_KEY);
    if (cached) {
      const profile = JSON.parse(cached);
      if (profile?.userId) return profile;
    }
  } catch (e) { /* ignore */ }

  return new Promise((resolve) => {
    console.log(">> a");
    chrome.storage.local.get(['userId', 'displayName', 'fundaEmail'], async (stored) => {
      let userId       = stored.userId       || null;
      let displayName  = stored.displayName  || null;
      let fundaEmail   = stored.fundaEmail   || null;
      let source       = 'anonymous';

      // --- Stap 1: Als nog geen Funda-email, probeer via fetch ---
      if (!fundaEmail) {
        const account = await detectFundaAccountFromFetch();

        if (account?.email) {
          if (userId && userId !== `funda:${account.email}`) {
            chrome.storage.local.set({ previousUserId: userId });
          }
          fundaEmail = account.email;
          userId = `funda:${fundaEmail}`;
          source = 'funda-fetch';
          chrome.storage.local.set({ fundaEmail });

          // Gebruik Funda-voornaam als displayName (alleen als nog geen handmatige naam)
          if (account.name && !stored.displayName) {
            displayName = account.name;
          }
        }
      }

      // --- Stap 2: Fallback — anoniem ID ---
      if (!userId) {
        userId = 'user_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        source = 'anonymous-new';
        console.log('[Funda Reacties] Nieuw anoniem userId:', userId);
      }

      // --- Displaynaam bepalen ---
      if (!displayName) {
        // Probeer voornaam alsnog via fetch (als we het emailadres al kennen
        // maar de naam nog niet hebben opgehaald)
        if (fundaEmail && source.startsWith('funda-stored')) {
          const account = await detectFundaAccountFromFetch();
          if (account?.name) displayName = account.name;
        }
        if (!displayName) displayName = generateDefaultName();
      }

      const profile = { userId, displayName, fundaEmail: fundaEmail || null, source };

      // Opslaan
      chrome.storage.local.set({ userId, displayName, fundaEmail: fundaEmail || null });
      try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(profile)); } catch (e) { /* ignore */ }

      console.log('[Funda Reacties] Profiel:', profile);
      resolve(profile);
    });
  });
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
      .upsert({ property_id: propertyId, address, url, location, updated_at: new Date().toISOString() }, { onConflict: 'property_id' })
      .select().single();
    if (error) { console.error('Error upserting property:', error); return null; }
    return data;
  } catch (error) { console.error('Error in upsertProperty:', error); return null; }
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

async function postComment(propertyId, text, name, askingPrice, userId) {
  try {
    const { data, error } = await supabaseClient
      .from('comments').insert({ property_id: propertyId, user_id: userId, name, text, asking_price: askingPrice }).select().single();
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
    const SCOPE_ORDER = ["street", "neighborhood", "city", "region", "province"];
    const results = [];
    const seenCommentIds = new Set();
    for (const scope of SCOPE_ORDER) {
      if (!location[scope]) continue;
      const { data, error } = await supabaseClient
        .from('comments')
        .select(`*, properties!inner(property_id, address, url, location)`)
        .neq('property_id', currentPropertyId)
        .contains('properties.location', { [scope]: location[scope] })
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

  dbg('[migrate] Start migratie:', anonId, '→', fundaId);

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

    dbg('[migrate] Resultaat:', data);

    // Wis previousUserId zodat we niet nogmaals migreren
    chrome.storage.local.remove('previousUserId');
  } catch (e) {
    console.error('[Funda Reacties] Migratie exception:', e);
  }
}
