-- ============================================================================
-- Funda Reacties Database Schema
-- Supabase PostgreSQL — v0.8.6
-- ============================================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- Properties Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS properties (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  property_id TEXT NOT NULL UNIQUE,
  address TEXT,
  url TEXT,
  location JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_properties_property_id ON properties(property_id);
CREATE INDEX IF NOT EXISTS idx_properties_location ON properties USING GIN(location);

-- ============================================================================
-- Comments Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS comments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  property_id TEXT NOT NULL REFERENCES properties(property_id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  text TEXT NOT NULL,
  asking_price TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_comments_property_id ON comments(property_id);
CREATE INDEX IF NOT EXISTS idx_comments_user_id ON comments(user_id);
CREATE INDEX IF NOT EXISTS idx_comments_created_at ON comments(created_at DESC);

-- ============================================================================
-- Emoji Reactions Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS emoji_reactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  property_id TEXT NOT NULL REFERENCES properties(property_id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  emoji TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(property_id, user_id, emoji)
);

CREATE INDEX IF NOT EXISTS idx_emoji_reactions_property_id ON emoji_reactions(property_id);
CREATE INDEX IF NOT EXISTS idx_emoji_reactions_user_id ON emoji_reactions(user_id);

-- ============================================================================
-- Votes Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS votes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  comment_id UUID NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  vote_type TEXT NOT NULL CHECK (vote_type IN ('up', 'down')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(comment_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_votes_comment_id ON votes(comment_id);
CREATE INDEX IF NOT EXISTS idx_votes_user_id ON votes(user_id);

-- ============================================================================
-- Row Level Security (RLS) Policies
-- ============================================================================

ALTER TABLE properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE emoji_reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE votes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Properties are viewable by everyone"    ON properties FOR SELECT USING (true);
CREATE POLICY "Properties can be inserted by everyone" ON properties FOR INSERT WITH CHECK (true);
CREATE POLICY "Properties can be updated by everyone"  ON properties FOR UPDATE USING (true);

CREATE POLICY "Comments are viewable by everyone"      ON comments FOR SELECT USING (true);
CREATE POLICY "Comments can be inserted by everyone"   ON comments FOR INSERT WITH CHECK (true);

CREATE POLICY "Emoji reactions are viewable by everyone"    ON emoji_reactions FOR SELECT USING (true);
CREATE POLICY "Emoji reactions can be inserted by everyone" ON emoji_reactions FOR INSERT WITH CHECK (true);
CREATE POLICY "Emoji reactions can be deleted by everyone"  ON emoji_reactions FOR DELETE USING (true);

CREATE POLICY "Votes are viewable by everyone"    ON votes FOR SELECT USING (true);
CREATE POLICY "Votes can be inserted by everyone" ON votes FOR INSERT WITH CHECK (true);
CREATE POLICY "Votes can be updated by everyone"  ON votes FOR UPDATE USING (true);
CREATE POLICY "Votes can be deleted by everyone"  ON votes FOR DELETE USING (true);

-- ============================================================================
-- Functions & Triggers
-- ============================================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $func$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$func$ LANGUAGE plpgsql;

DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'update_properties_updated_at'
  ) THEN
    CREATE TRIGGER update_properties_updated_at
      BEFORE UPDATE ON properties
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();
  END IF;
END
$do$;

-- ============================================================================
-- Views
-- ============================================================================

CREATE OR REPLACE VIEW comments_with_votes AS
SELECT
  c.*,
  COALESCE(COUNT(v.id) FILTER (WHERE v.vote_type = 'up'), 0)   AS upvotes,
  COALESCE(COUNT(v.id) FILTER (WHERE v.vote_type = 'down'), 0) AS downvotes
FROM comments c
LEFT JOIN votes v ON v.comment_id = c.id
GROUP BY c.id;

CREATE OR REPLACE VIEW emoji_counts AS
SELECT property_id, emoji, COUNT(*) as count
FROM emoji_reactions
GROUP BY property_id, emoji;

-- ============================================================================
-- Email Notifications Table (v0.8.4)
-- Rijen worden hier ingevoegd door de trigger hieronder.
-- De Database Webhook pikt elke INSERT op en roept de Edge Function aan,
-- die de email verstuurt via SendGrid en sent=true zet.
-- ============================================================================

CREATE TABLE IF NOT EXISTS email_notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  recipient_email TEXT NOT NULL,
  reaction_type TEXT NOT NULL CHECK (reaction_type IN ('comment', 'emoji')),
  reactor_name TEXT,
  reactor_email TEXT,
  emoji TEXT,
  comment_text TEXT,
  property_id TEXT NOT NULL REFERENCES properties(property_id) ON DELETE CASCADE,
  property_address TEXT,
  property_url TEXT,
  sent BOOLEAN DEFAULT false,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_sent ON email_notifications(sent);

ALTER TABLE email_notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Email notifications niet leesbaar voor clients"
  ON email_notifications FOR SELECT USING (false);

-- ============================================================================
-- notify_on_reaction (v0.8.6)
--
-- Slaat een rij op in email_notifications als een ANDERE gebruiker (niet Eddy)
-- reageert. De Database Webhook triggert vervolgens de Edge Function die de
-- email verstuurt. SECURITY DEFINER zodat de INSERT RLS omzeilt.
-- ============================================================================

CREATE OR REPLACE FUNCTION notify_on_reaction()
RETURNS TRIGGER AS $func$
DECLARE
  v_property_address TEXT;
  v_property_url     TEXT;
  v_reactor_email    TEXT;
  v_eddy_email       TEXT := 'eddyverbruggen@gmail.com';
BEGIN
  -- Haal email op uit user_id (formaat: funda:email@domain.com)
  IF NEW.user_id LIKE 'funda:%' THEN
    v_reactor_email := SUBSTRING(NEW.user_id FROM 7);
  END IF;

  -- Alleen doorgaan als het NIET Eddy is
  IF v_reactor_email IS NULL OR v_reactor_email != v_eddy_email THEN
    SELECT address, url INTO v_property_address, v_property_url
    FROM properties WHERE property_id = NEW.property_id;

    IF TG_TABLE_NAME = 'comments' THEN
      INSERT INTO email_notifications (
        recipient_email, reaction_type, reactor_name, reactor_email,
        comment_text, property_id, property_address, property_url
      ) VALUES (
        v_eddy_email, 'comment', NEW.name, v_reactor_email,
        NEW.text, NEW.property_id, v_property_address, v_property_url
      );

    ELSIF TG_TABLE_NAME = 'emoji_reactions' THEN
      INSERT INTO email_notifications (
        recipient_email, reaction_type, reactor_name, reactor_email,
        emoji, property_id, property_address, property_url
      ) VALUES (
        v_eddy_email, 'emoji', NULL, v_reactor_email,
        NEW.emoji, NEW.property_id, v_property_address, v_property_url
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trigger_notify_on_comment ON comments;
CREATE TRIGGER trigger_notify_on_comment
  AFTER INSERT ON comments
  FOR EACH ROW EXECUTE FUNCTION notify_on_reaction();

DROP TRIGGER IF EXISTS trigger_notify_on_emoji ON emoji_reactions;
CREATE TRIGGER trigger_notify_on_emoji
  AFTER INSERT ON emoji_reactions
  FOR EACH ROW EXECUTE FUNCTION notify_on_reaction();

-- ============================================================================
-- migrate_anonymous_comments (v0.8.9)
--
-- Koppelt anonieme comments en emoji-reacties aan een Funda-account.
-- Wordt aangeroepen vanuit de client na login-detectie.
--
-- Parameters:
--   p_anon_id   : het oude anonieme user_id (bijv. 'user_1234_abc')
--   p_funda_id  : het nieuwe Funda user_id  (bijv. 'funda:eddy@gmail.com')
--   p_new_name  : de weergavenaam van het Funda-account
--
-- Geeft terug: aantal gemigreerde comments + emoji_reactions
-- ============================================================================

CREATE OR REPLACE FUNCTION migrate_anonymous_comments(
  p_anon_id  TEXT,
  p_funda_id TEXT,
  p_new_name TEXT
)
RETURNS JSONB AS $func$
DECLARE
  v_comments_updated  INT;
  v_emojis_updated    INT;
BEGIN
  -- Sanity checks
  IF p_anon_id IS NULL OR p_anon_id = '' THEN RETURN jsonb_build_object('error', 'p_anon_id is leeg'); END IF;
  IF p_funda_id IS NULL OR p_funda_id = '' THEN RETURN jsonb_build_object('error', 'p_funda_id is leeg'); END IF;
  -- Voorkom dat een Funda-account zichzelf overschrijft
  IF p_anon_id = p_funda_id THEN RETURN jsonb_build_object('comments', 0, 'emojis', 0); END IF;

  -- Update comments: user_id en naam
  UPDATE comments
     SET user_id = p_funda_id,
         name    = COALESCE(NULLIF(p_new_name, ''), name)
   WHERE user_id = p_anon_id;
  GET DIAGNOSTICS v_comments_updated = ROW_COUNT;

  -- Update emoji_reactions: user_id
  -- Bij een conflict (zelfde emoji al als Funda-user gezet) verwijder de dubbele anonieme rij.
  UPDATE emoji_reactions
     SET user_id = p_funda_id
   WHERE user_id = p_anon_id
     AND NOT EXISTS (
       SELECT 1 FROM emoji_reactions e2
        WHERE e2.property_id = emoji_reactions.property_id
          AND e2.emoji       = emoji_reactions.emoji
          AND e2.user_id     = p_funda_id
     );
  GET DIAGNOSTICS v_emojis_updated = ROW_COUNT;

  -- Verwijder eventuele duplicate anonieme emoji-rijen die niet geupdatet konden worden
  DELETE FROM emoji_reactions
   WHERE user_id = p_anon_id;

  RETURN jsonb_build_object('comments', v_comments_updated, 'emojis', v_emojis_updated);
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER;

-- RLS-beleid: iedereen mag de functie aanroepen (SECURITY DEFINER regelt rechten)
-- Geen extra GRANT nodig voor RPC-aanroepen via de anon key.

-- Verify
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_type = 'BASE TABLE'
  AND table_name IN ('properties', 'comments', 'emoji_reactions', 'votes', 'email_notifications')
ORDER BY table_name;
