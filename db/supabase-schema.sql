-- ============================================================================
-- Funda Reacties Database Schema
-- Supabase PostgreSQL
-- ============================================================================
--
-- Instructies:
-- 1. Open je Supabase project dashboard
-- 2. Ga naar SQL Editor
-- 3. Maak een nieuwe query aan
-- 4. Plak dit volledige script
-- 5. Voer het uit
--
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
--
-- We gebruiken anonieme user IDs (geen Supabase Auth), dus we kunnen geen
-- JWT claims gebruiken voor ownership checks. Alle operaties zijn open.
-- Beveiliging gebeurt op applicatieniveau (client stuurt eigen user_id mee).
-- ============================================================================

ALTER TABLE properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE emoji_reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE votes ENABLE ROW LEVEL SECURITY;

-- Properties: volledig open
CREATE POLICY "Properties are viewable by everyone"
  ON properties FOR SELECT USING (true);
CREATE POLICY "Properties can be inserted by everyone"
  ON properties FOR INSERT WITH CHECK (true);
CREATE POLICY "Properties can be updated by everyone"
  ON properties FOR UPDATE USING (true);

-- Comments: volledig open
CREATE POLICY "Comments are viewable by everyone"
  ON comments FOR SELECT USING (true);
CREATE POLICY "Comments can be inserted by everyone"
  ON comments FOR INSERT WITH CHECK (true);

-- Emoji reactions: volledig open (inclusief delete voor toggle)
CREATE POLICY "Emoji reactions are viewable by everyone"
  ON emoji_reactions FOR SELECT USING (true);
CREATE POLICY "Emoji reactions can be inserted by everyone"
  ON emoji_reactions FOR INSERT WITH CHECK (true);
CREATE POLICY "Emoji reactions can be deleted by everyone"
  ON emoji_reactions FOR DELETE USING (true);

-- Votes: volledig open (inclusief update/delete voor toggle)
CREATE POLICY "Votes are viewable by everyone"
  ON votes FOR SELECT USING (true);
CREATE POLICY "Votes can be inserted by everyone"
  ON votes FOR INSERT WITH CHECK (true);
CREATE POLICY "Votes can be updated by everyone"
  ON votes FOR UPDATE USING (true);
CREATE POLICY "Votes can be deleted by everyone"
  ON votes FOR DELETE USING (true);

-- ============================================================================
-- Realtime
-- ============================================================================

-- Handmatig in Supabase dashboard:
-- Database > Replication > comments tabel > Enable Realtime

-- ============================================================================
-- Functions & Triggers
-- ============================================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
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
$$;

-- ============================================================================
-- Views
-- ============================================================================

CREATE OR REPLACE VIEW comments_with_votes AS
SELECT
  c.*,
  COALESCE(COUNT(v.id) FILTER (WHERE v.vote_type = 'up'), 0) AS upvotes,
  COALESCE(COUNT(v.id) FILTER (WHERE v.vote_type = 'down'), 0) AS downvotes
FROM comments c
LEFT JOIN votes v ON v.comment_id = c.id
GROUP BY c.id;

CREATE OR REPLACE VIEW emoji_counts AS
SELECT
  property_id,
  emoji,
  COUNT(*) as count
FROM emoji_reactions
GROUP BY property_id, emoji;

-- Verify
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_type = 'BASE TABLE'
  AND table_name IN ('properties', 'comments', 'emoji_reactions', 'votes')
ORDER BY table_name;
