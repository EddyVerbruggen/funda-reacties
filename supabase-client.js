// ==========================================================================
// Funda Reacties — Supabase Client
// Handles all database communication with Supabase
// ==========================================================================

const SUPABASE_URL = 'https://xjniqvdfwnsvsuuteakt.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhqbmlxdmRmd25zdnN1dXRlYWt0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc0NDgxNjIsImV4cCI6MjA5MzAyNDE2Mn0.Dr-t4SIBaZMYu2nn1553S1VzaSCm2bcnxCcAzue_xKo';

const { createClient } = supabase;
const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

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

    if (propError && propError.code !== 'PGRST116') {
      console.error('Error fetching property:', propError);
      return null;
    }

    return property;
  } catch (error) {
    console.error('Error in getReactions:', error);
    return null;
  }
}

async function upsertProperty(propertyId, address, url, location) {
  try {
    const { data, error } = await supabaseClient
      .from('properties')
      .upsert({
        property_id: propertyId,
        address,
        url,
        location,
        updated_at: new Date().toISOString()
      })
      .select()
      .single();

    if (error) {
      console.error('Error upserting property:', error);
      return null;
    }

    return data;
  } catch (error) {
    console.error('Error in upsertProperty:', error);
    return null;
  }
}

async function toggleEmojiReaction(propertyId, emoji, userId) {
  try {
    const { data: existing, error: fetchError } = await supabaseClient
      .from('emoji_reactions')
      .select('*')
      .eq('property_id', propertyId)
      .eq('emoji', emoji)
      .eq('user_id', userId)
      .maybeSingle();

    if (fetchError) {
      console.error('Error checking emoji:', fetchError);
      return { active: false, count: 0 };
    }

    if (existing) {
      const { error: deleteError } = await supabaseClient
        .from('emoji_reactions')
        .delete()
        .eq('id', existing.id);

      if (deleteError) {
        console.error('Error deleting emoji:', deleteError);
        return { active: true, count: 0 };
      }
    } else {
      const { error: insertError } = await supabaseClient
        .from('emoji_reactions')
        .insert({
          property_id: propertyId,
          emoji,
          user_id: userId
        });

      if (insertError) {
        console.error('Error inserting emoji:', insertError);
        return { active: false, count: 0 };
      }
    }

    const { count, error: countError } = await supabaseClient
      .from('emoji_reactions')
      .select('*', { count: 'exact', head: true })
      .eq('property_id', propertyId)
      .eq('emoji', emoji);

    if (countError) {
      console.error('Error counting emoji:', countError);
    }

    return {
      active: !existing,
      count: count || 0
    };
  } catch (error) {
    console.error('Error in toggleEmojiReaction:', error);
    return { active: false, count: 0 };
  }
}

async function getEmojiCounts(propertyId, userId) {
  try {
    const { data, error } = await supabaseClient
      .from('emoji_reactions')
      .select('emoji, user_id')
      .eq('property_id', propertyId);

    if (error) {
      console.error('Error fetching emoji counts:', error);
      return {};
    }

    const counts = {};
    data.forEach(reaction => {
      if (!counts[reaction.emoji]) {
        counts[reaction.emoji] = { count: 0, active: false };
      }
      counts[reaction.emoji].count++;
      if (reaction.user_id === userId) {
        counts[reaction.emoji].active = true;
      }
    });

    return counts;
  } catch (error) {
    console.error('Error in getEmojiCounts:', error);
    return {};
  }
}

async function postComment(propertyId, text, name, askingPrice, userId) {
  try {
    const { data, error } = await supabaseClient
      .from('comments')
      .insert({
        property_id: propertyId,
        user_id: userId,
        name,
        text,
        asking_price: askingPrice
      })
      .select()
      .single();

    if (error) {
      console.error('Error posting comment:', error);
      return null;
    }

    return data;
  } catch (error) {
    console.error('Error in postComment:', error);
    return null;
  }
}

async function voteComment(commentId, userId, voteType) {
  try {
    const { data: existing, error: fetchError } = await supabaseClient
      .from('votes')
      .select('*')
      .eq('comment_id', commentId)
      .eq('user_id', userId)
      .maybeSingle();

    if (fetchError) {
      console.error('Error checking vote:', fetchError);
      return null;
    }

    if (existing) {
      if (existing.vote_type === voteType) {
        const { error: deleteError } = await supabaseClient
          .from('votes')
          .delete()
          .eq('id', existing.id);

        if (deleteError) {
          console.error('Error deleting vote:', deleteError);
        }
      } else {
        const { error: updateError } = await supabaseClient
          .from('votes')
          .update({ vote_type: voteType })
          .eq('id', existing.id);

        if (updateError) {
          console.error('Error updating vote:', updateError);
        }
      }
    } else {
      const { error: insertError } = await supabaseClient
        .from('votes')
        .insert({
          comment_id: commentId,
          user_id: userId,
          vote_type: voteType
        });

      if (insertError) {
        console.error('Error inserting vote:', insertError);
      }
    }

    return getVoteCounts(commentId);
  } catch (error) {
    console.error('Error in voteComment:', error);
    return null;
  }
}

async function getVoteCounts(commentId) {
  try {
    const { data, error } = await supabaseClient
      .from('votes')
      .select('vote_type')
      .eq('comment_id', commentId);

    if (error) {
      console.error('Error fetching votes:', error);
      return { upvotes: 0, downvotes: 0 };
    }

    return {
      upvotes: data.filter(v => v.vote_type === 'up').length,
      downvotes: data.filter(v => v.vote_type === 'down').length
    };
  } catch (error) {
    console.error('Error in getVoteCounts:', error);
    return { upvotes: 0, downvotes: 0 };
  }
}

/**
 * Haal comments op van properties in de buurt.
 *
 * FIX: We zoeken nu alleen op het meest specifieke scope dat matcht
 * (street → neighborhood → city), en als dat al genoeg resultaten geeft
 * stoppen we. Daarnaast dedupliceren we op comment-ID zodat een comment
 * nooit dubbel verschijnt als het bij meerdere scopes matcht.
 */
async function getNeighborhoodComments(currentPropertyId, location, limitPerScope = 3) {
  try {
    if (!location || Object.keys(location).length === 0) {
      return [];
    }

    const SCOPE_ORDER = ["street", "neighborhood", "city", "region", "province"];
    const results = [];
    const seenCommentIds = new Set(); // deduplicatie

    for (const scope of SCOPE_ORDER) {
      if (!location[scope]) continue;

      const { data, error } = await supabaseClient
        .from('comments')
        .select(`
          *,
          properties!inner(property_id, address, url, location)
        `)
        .neq('property_id', currentPropertyId)
        .contains('properties.location', { [scope]: location[scope] })
        .order('created_at', { ascending: false })
        .limit(limitPerScope * 2); // fetch extra voor dedup marge

      if (error) {
        console.error(`Error fetching ${scope} comments:`, error);
        continue;
      }

      if (data && data.length > 0) {
        // Filter duplicaten
        const unique = [];
        for (const c of data) {
          if (seenCommentIds.has(c.id)) continue;
          seenCommentIds.add(c.id);
          unique.push({
            ...c,
            fromAddress: c.properties.address,
            fromUrl: c.properties.url
          });
          if (unique.length >= limitPerScope) break;
        }

        if (unique.length > 0) {
          results.push({ scope, comments: unique });
        }

        // Stop zodra we genoeg hebben
        const total = results.reduce((sum, g) => sum + g.comments.length, 0);
        if (total >= 3) break;
      }
    }

    return results;
  } catch (error) {
    console.error('Error in getNeighborhoodComments:', error);
    return [];
  }
}

async function getUserId() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['userId'], (result) => {
      if (result.userId) {
        resolve(result.userId);
      } else {
        const userId = 'user_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        chrome.storage.local.set({ userId }, () => {
          resolve(userId);
        });
      }
    });
  });
}

function subscribeToPropertyUpdates(propertyId, userId, onNewComment) {
  const channel = supabaseClient
    .channel(`property:${propertyId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'comments',
        filter: `property_id=eq.${propertyId}`
      },
      async (payload) => {
        const newComment = payload.new;

        if (newComment.user_id === userId) return;

        const { data: userComments } = await supabaseClient
          .from('comments')
          .select('id')
          .eq('property_id', propertyId)
          .eq('user_id', userId)
          .limit(1);

        const { data: userEmojis } = await supabaseClient
          .from('emoji_reactions')
          .select('id')
          .eq('property_id', propertyId)
          .eq('user_id', userId)
          .limit(1);

        if (userComments?.length > 0 || userEmojis?.length > 0) {
          onNewComment(newComment);
        }
      }
    )
    .subscribe();

  return channel;
}

function unsubscribeFromPropertyUpdates(channel) {
  if (channel) {
    supabaseClient.removeChannel(channel);
  }
}
