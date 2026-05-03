-- ============================================================================
-- Funda Reacties Database Schema
-- Supabase PostgreSQL — v1.3.2
-- ============================================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- Drop everything (views, triggers, functions, tables) voor een schone start
-- Volgorde: views → triggers → tabellen (omgekeerde FK-volgorde)
-- ============================================================================

DROP VIEW IF EXISTS comments_with_votes;
DROP VIEW IF EXISTS emoji_counts;

DROP TRIGGER IF EXISTS trigger_notify_on_comment   ON comments;
DROP TRIGGER IF EXISTS trigger_notify_on_emoji     ON emoji_reactions;
DROP TRIGGER IF EXISTS update_properties_updated_at ON properties;

DROP FUNCTION IF EXISTS notify_on_reaction();
DROP FUNCTION IF EXISTS update_updated_at_column();
DROP FUNCTION IF EXISTS track_property_view(TEXT, TEXT, BOOLEAN, TEXT);
DROP FUNCTION IF EXISTS migrate_anonymous_comments(TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS get_price_per_m2_comparison(TEXT);
DROP FUNCTION IF EXISTS record_price_if_changed(TEXT, TEXT, INTEGER, INTEGER);
DROP FUNCTION IF EXISTS record_price_if_changed(TEXT, INTEGER, INTEGER);
DROP FUNCTION IF EXISTS upsert_woz_history(TEXT, TEXT, JSONB);
DROP FUNCTION IF EXISTS upsert_woz_history(TEXT, TEXT, JSONB, TEXT);

DROP TABLE IF EXISTS email_notifications    CASCADE;
DROP TABLE IF EXISTS votes                  CASCADE;
DROP TABLE IF EXISTS property_price_history CASCADE;
DROP TABLE IF EXISTS property_woz_history   CASCADE;
DROP TABLE IF EXISTS emoji_reactions        CASCADE;
DROP TABLE IF EXISTS comments               CASCADE;
DROP TABLE IF EXISTS properties             CASCADE;
DROP TABLE IF EXISTS users                  CASCADE;

-- ============================================================================
-- Users Table (v0.9.0)
-- Centrale gebruikerstabel. user_id = 'funda:email' of 'user_xxxx'.
-- properties_viewed: JSONB array van unieke property_id strings.
-- comment_count wordt NIET opgeslagen — realtime via COUNT op comments.
-- ============================================================================

CREATE TABLE IF NOT EXISTS users (
  user_id           TEXT PRIMARY KEY,
  display_name      TEXT NOT NULL,
  is_anonymous      BOOLEAN NOT NULL DEFAULT true,
  properties_viewed JSONB NOT NULL DEFAULT '[]'::jsonb,
  first_seen_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_is_anonymous ON users(is_anonymous);
CREATE INDEX IF NOT EXISTS idx_users_last_seen    ON users(last_seen_at DESC);

-- ============================================================================
-- Properties Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS properties (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  property_id TEXT NOT NULL UNIQUE,
  address TEXT,
  url TEXT,
  -- loc_* kolommen vervangen het oude JSONB location-veld (v1.2.1)
  loc_street       TEXT,
  loc_neighborhood TEXT,
  loc_city         TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_properties_property_id   ON properties(property_id);
CREATE INDEX IF NOT EXISTS idx_properties_loc_street    ON properties(loc_city, loc_street);
CREATE INDEX IF NOT EXISTS idx_properties_loc_hood      ON properties(loc_city, loc_neighborhood);
CREATE INDEX IF NOT EXISTS idx_properties_loc_city      ON properties(loc_city);

-- ============================================================================
-- Comments Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS comments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  property_id TEXT NOT NULL REFERENCES properties(property_id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  text TEXT NOT NULL,
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
-- Property WOZ History Table (v1.3.1)
--
-- Slaat WOZ-waarden op per woning per peiljaar.
-- Één rij per (property_id, peiljaar) — WOZ-waarden veranderen nooit achteraf.
-- loc_city is gedenormaliseerd voor efficiënte stadsgemiddeld-queries.
-- fetched_at geeft aan wanneer de data voor het laatst opgehaald is,
-- zodat we de externe API niet vaker aanroepen dan nodig.
-- ============================================================================

CREATE TABLE IF NOT EXISTS property_woz_history (
  id            UUID     PRIMARY KEY DEFAULT uuid_generate_v4(),
  property_id   TEXT     NOT NULL REFERENCES properties(property_id) ON DELETE CASCADE,
  peiljaar      SMALLINT NOT NULL,           -- bijv. 2024
  woz_waarde    INTEGER  NOT NULL,           -- vastgesteldeWaarde in hele euros
  fetched_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_woz_property_peiljaar UNIQUE (property_id, peiljaar)
);

CREATE INDEX IF NOT EXISTS idx_woz_history_property_id
  ON property_woz_history(property_id);

-- Aggregatie per stad/wijk/straat loopt via JOIN op properties.loc_*
-- Geen gedenormaliseerde loc_city nodig: properties heeft al alle loc_-kolommen
-- met bestaande indices op (loc_city), (loc_city, loc_neighborhood), etc.

ALTER TABLE property_woz_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "WOZ history leesbaar voor iedereen"              ON property_woz_history;
DROP POLICY IF EXISTS "WOZ history kan worden ingevoegd door iedereen"  ON property_woz_history;
DROP POLICY IF EXISTS "WOZ history kan worden bijgewerkt door iedereen" ON property_woz_history;
CREATE POLICY "WOZ history leesbaar voor iedereen"
  ON property_woz_history FOR SELECT USING (true);
CREATE POLICY "WOZ history kan worden ingevoegd door iedereen"
  ON property_woz_history FOR INSERT WITH CHECK (true);
CREATE POLICY "WOZ history kan worden bijgewerkt door iedereen"
  ON property_woz_history FOR UPDATE USING (true);

-- ============================================================================
-- Property Price History Table (v1.1.4)
-- Bijhoudt de vraagprijshistorie per woning.
-- Er wordt alleen een nieuwe rij ingevoegd als de prijs veranderd is
-- t.o.v. de vorige bekende prijs (via de record_price_if_changed RPC).
-- ============================================================================

CREATE TABLE IF NOT EXISTS property_price_history (
  id            UUID  PRIMARY KEY DEFAULT uuid_generate_v4(),
  property_id   TEXT  NOT NULL REFERENCES properties(property_id) ON DELETE CASCADE,
  recorded_at   DATE  NOT NULL DEFAULT CURRENT_DATE,
  price         INTEGER,
  price_per_m2  INTEGER
);

CREATE INDEX IF NOT EXISTS idx_price_history_property_id
  ON property_price_history(property_id);

CREATE INDEX IF NOT EXISTS idx_price_history_recorded_at
  ON property_price_history(property_id, recorded_at DESC);

ALTER TABLE property_price_history
  ADD CONSTRAINT uq_price_history_property_date UNIQUE (property_id, recorded_at);

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

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE emoji_reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE votes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users zijn leesbaar voor iedereen"  ON users;
DROP POLICY IF EXISTS "Users kunnen worden aangemaakt"     ON users;
DROP POLICY IF EXISTS "Users kunnen worden bijgewerkt"     ON users;
CREATE POLICY "Users zijn leesbaar voor iedereen"  ON users FOR SELECT USING (true);
CREATE POLICY "Users kunnen worden aangemaakt"     ON users FOR INSERT WITH CHECK (true);
CREATE POLICY "Users kunnen worden bijgewerkt"     ON users FOR UPDATE USING (true);

DROP POLICY IF EXISTS "Properties are viewable by everyone"    ON properties;
DROP POLICY IF EXISTS "Properties can be inserted by everyone" ON properties;
DROP POLICY IF EXISTS "Properties can be updated by everyone"  ON properties;
CREATE POLICY "Properties are viewable by everyone"    ON properties FOR SELECT USING (true);
CREATE POLICY "Properties can be inserted by everyone" ON properties FOR INSERT WITH CHECK (true);
CREATE POLICY "Properties can be updated by everyone"  ON properties FOR UPDATE USING (true);

DROP POLICY IF EXISTS "Comments are viewable by everyone"      ON comments;
DROP POLICY IF EXISTS "Comments can be inserted by everyone"   ON comments;
DROP POLICY IF EXISTS "Comments can be deleted by owner"       ON comments;
CREATE POLICY "Comments are viewable by everyone"      ON comments FOR SELECT USING (true);
CREATE POLICY "Comments can be inserted by everyone"   ON comments FOR INSERT WITH CHECK (true);
CREATE POLICY "Comments can be deleted by owner"       ON comments FOR DELETE USING (true);

DROP POLICY IF EXISTS "Emoji reactions are viewable by everyone"    ON emoji_reactions;
DROP POLICY IF EXISTS "Emoji reactions can be inserted by everyone" ON emoji_reactions;
DROP POLICY IF EXISTS "Emoji reactions can be deleted by everyone"  ON emoji_reactions;
CREATE POLICY "Emoji reactions are viewable by everyone"    ON emoji_reactions FOR SELECT USING (true);
CREATE POLICY "Emoji reactions can be inserted by everyone" ON emoji_reactions FOR INSERT WITH CHECK (true);
CREATE POLICY "Emoji reactions can be deleted by everyone"  ON emoji_reactions FOR DELETE USING (true);

DROP POLICY IF EXISTS "Votes are viewable by everyone"    ON votes;
DROP POLICY IF EXISTS "Votes can be inserted by everyone" ON votes;
DROP POLICY IF EXISTS "Votes can be updated by everyone"  ON votes;
DROP POLICY IF EXISTS "Votes can be deleted by everyone"  ON votes;
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

DROP VIEW IF EXISTS comments_with_votes;
CREATE VIEW comments_with_votes AS
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

ALTER TABLE property_price_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Price history leesbaar voor iedereen"              ON property_price_history;
DROP POLICY IF EXISTS "Price history kan worden ingevoegd door iedereen"  ON property_price_history;
CREATE POLICY "Price history leesbaar voor iedereen"
  ON property_price_history FOR SELECT USING (true);

CREATE POLICY "Price history kan worden ingevoegd door iedereen"
  ON property_price_history FOR INSERT WITH CHECK (true);

ALTER TABLE email_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Email notifications niet leesbaar voor clients" ON email_notifications;
CREATE POLICY "Email notifications niet leesbaar voor clients"
  ON email_notifications FOR SELECT USING (false);

-- ============================================================================
-- upsert_woz_history (v1.3.2)
--
-- Slaat de WOZ-waarden van een woning op in de database.
-- Locatie-informatie voor aggregaties (stad, wijk, straat) loopt via JOIN
-- op de bestaande properties.loc_* kolommen — geen dubbele opslag nodig.
--
-- Parameters:
--   p_property_id : de Funda property ID
--   p_woz_data    : JSONB array van { peiljaar: int, woz_waarde: int }
--
-- Geeft terug: JSONB array van { peiljaar, woz_waarde } (alle opgeslagen rijen)
-- ============================================================================

CREATE OR REPLACE FUNCTION upsert_woz_history(
  p_property_id TEXT,
  p_woz_data    JSONB
)
RETURNS JSONB AS $func$
DECLARE
  v_item     JSONB;
  v_peiljaar SMALLINT;
  v_waarde   INTEGER;
BEGIN
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_woz_data)
  LOOP
    v_peiljaar := (v_item->>'peiljaar')::SMALLINT;
    v_waarde   := (v_item->>'woz_waarde')::INTEGER;

    INSERT INTO property_woz_history
      (property_id, peiljaar, woz_waarde, fetched_at)
    VALUES
      (p_property_id, v_peiljaar, v_waarde, NOW())
    ON CONFLICT (property_id, peiljaar)
      DO UPDATE SET fetched_at = NOW();   -- waarde zelf nooit overschrijven
  END LOOP;

  -- Stuur alle bekende jaren terug (gesorteerd)
  RETURN (
    SELECT jsonb_agg(
      jsonb_build_object('peiljaar', peiljaar, 'woz_waarde', woz_waarde)
      ORDER BY peiljaar ASC
    )
    FROM property_woz_history
    WHERE property_id = p_property_id
  );
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- record_price_if_changed (v1.1.4)
--
-- Controleert server-side of de meegegeven vraagprijs afwijkt van de
-- laatste bekende prijs voor deze woning. Zo ja, voegt een nieuwe rij in.
-- Server-side om race conditions te voorkomen (twee tabs tegelijk).
--
-- Geeft terug: { inserted: bool, previous_price_num: int|null }
-- ============================================================================

CREATE OR REPLACE FUNCTION record_price_if_changed(
  p_property_id  TEXT,
  p_price        INTEGER,
  p_price_per_m2 INTEGER
)
RETURNS JSONB AS $func$
DECLARE
  v_prev_price  INTEGER;
  v_inserted    BOOLEAN;
BEGIN
  -- Haal de meest recente prijs op van een VORIGE dag (niet vandaag)
  SELECT price
    INTO v_prev_price
    FROM property_price_history
   WHERE property_id = p_property_id
     AND recorded_at < CURRENT_DATE
   ORDER BY recorded_at DESC
   LIMIT 1;

  -- Upsert voor vandaag: maak aan of overschrijf als de prijs veranderd is.
  -- ON CONFLICT op (property_id, recorded_at) zodat er per dag max 1 rij bestaat.
  INSERT INTO property_price_history (property_id, recorded_at, price, price_per_m2)
    VALUES (p_property_id, CURRENT_DATE, p_price, p_price_per_m2)
  ON CONFLICT (property_id, recorded_at) DO UPDATE
    SET price        = EXCLUDED.price,
        price_per_m2 = EXCLUDED.price_per_m2
  WHERE property_price_history.price IS DISTINCT FROM EXCLUDED.price;

  v_inserted := FOUND;

  RETURN jsonb_build_object(
    'inserted',       v_inserted,
    'previous_price', v_prev_price
  );
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER;

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
-- track_property_view (v0.9.0)
--
-- Registreert dat een gebruiker een woning heeft bekeken.
-- Doet een upsert van de users-rij en voegt property_id toe aan de
-- properties_viewed JSONB array — maar alleen als die er nog niet in zit.
--
-- Parameters:
--   p_user_id      : het user_id van de kijker
--   p_display_name : weergavenaam (voor upsert bij nieuwe gebruikers)
--   p_is_anonymous : true = anoniem, false = Funda-account
--   p_property_id  : de bekeken woning
--
-- Geeft terug: { user_id, properties_viewed_count }
-- ============================================================================

CREATE OR REPLACE FUNCTION track_property_view(
  p_user_id      TEXT,
  p_display_name TEXT,
  p_is_anonymous BOOLEAN,
  p_property_id  TEXT
)
RETURNS JSONB AS $func$
BEGIN
  -- Upsert de user-rij. Bij conflict:
  --   - altijd display_name en last_seen_at bijwerken
  --   - property_id alleen toevoegen als die nog niet in de array zit
  --     (atomaire check+write, geen aparte SELECT nodig)
  INSERT INTO users (user_id, display_name, is_anonymous, properties_viewed, last_seen_at)
    VALUES (p_user_id, p_display_name, p_is_anonymous, jsonb_build_array(p_property_id), NOW())
  ON CONFLICT (user_id) DO UPDATE
    SET display_name      = EXCLUDED.display_name,
        is_anonymous      = EXCLUDED.is_anonymous,
        last_seen_at      = NOW(),
        properties_viewed = CASE
          WHEN users.properties_viewed @> jsonb_build_array(p_property_id)
          THEN users.properties_viewed                                          -- al aanwezig: niet toevoegen
          ELSE users.properties_viewed || jsonb_build_array(p_property_id)      -- nieuw: toevoegen
        END;

  RETURN jsonb_build_object(
    'user_id', p_user_id,
    'properties_viewed_count', jsonb_array_length(
      (SELECT properties_viewed FROM users WHERE user_id = p_user_id)
    )
  );
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER;

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

  -- Migreer ook de users-rij: kopieer properties_viewed van anoniem naar Funda-account
  INSERT INTO users (user_id, display_name, is_anonymous, properties_viewed, first_seen_at, last_seen_at)
    SELECT
      p_funda_id,
      CASE WHEN p_new_name != '' THEN p_new_name ELSE display_name END,
      false,
      properties_viewed,
      first_seen_at,
      NOW()
    FROM users
    WHERE user_id = p_anon_id
  ON CONFLICT (user_id) DO UPDATE
    SET display_name      = CASE WHEN p_new_name != '' THEN p_new_name ELSE users.display_name END,
        is_anonymous      = false,
        -- Voeg bekeken woningen samen (union, duplicaten verwijderd)
        properties_viewed = (
          SELECT jsonb_agg(DISTINCT pid)
          FROM (
            SELECT jsonb_array_elements_text(users.properties_viewed) AS pid
            UNION
            SELECT jsonb_array_elements_text(
              COALESCE(
                (SELECT properties_viewed FROM users WHERE user_id = p_anon_id),
                '[]'::jsonb
              )
            ) AS pid
          ) sub
        ),
        last_seen_at      = NOW();

  -- Verwijder de anonieme gebruikersrij
  DELETE FROM users WHERE user_id = p_anon_id;

  RETURN jsonb_build_object('comments', v_comments_updated, 'emojis', v_emojis_updated);
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER;

-- RLS-beleid: iedereen mag de functie aanroepen (SECURITY DEFINER regelt rechten)
-- Geen extra GRANT nodig voor RPC-aanroepen via de anon key.

-- ============================================================================
-- get_price_per_m2_comparison (v1.2.0)
--
-- Vergelijkt de meest recente price_per_m2 van een woning met het gemiddelde
-- van ANDERE woningen in dezelfde straat, wijk of stad (hiërarchische fallback).
--
-- Gebruikt de gedenormaliseerde loc_* kolommen op properties voor een
-- efficiënte index-scan i.p.v. JSONB-operatoren.
--
-- Geeft terug:
--   scope             : 'street' | 'neighborhood' | 'city' | null
--   pct_diff          : percentage t.o.v. gemiddelde (negatief = goedkoper)
--   own_price_per_m2  : de eigen prijs per m²
--   avg_price_per_m2  : het gemiddelde van de vergelijkingsgroep
--   count             : aantal woningen in de vergelijkingsgroep
-- ============================================================================

CREATE OR REPLACE FUNCTION get_price_per_m2_comparison(p_property_id TEXT)
RETURNS JSONB AS $func$
DECLARE
  v_street   TEXT;
  v_hood     TEXT;
  v_city     TEXT;
  v_own_pm2  INTEGER;
  v_avg_pm2  NUMERIC;
  v_count    INTEGER;
  v_scope    TEXT;
BEGIN
  -- Haal locatie en meest recente price_per_m2 van de woning op
  SELECT p.loc_street, p.loc_neighborhood, p.loc_city, h.price_per_m2
    INTO v_street, v_hood, v_city, v_own_pm2
    FROM properties p
    JOIN property_price_history h ON h.property_id = p.property_id
   WHERE p.property_id = p_property_id
   ORDER BY h.recorded_at DESC
   LIMIT 1;

  IF v_own_pm2 IS NULL THEN
    RETURN jsonb_build_object('scope', null, 'pct_diff', null,
                              'own_price_per_m2', null, 'avg_price_per_m2', null, 'count', 0);
  END IF;

  -- ---- Straat (+ stad als disambiguatie) ----
  IF v_street IS NOT NULL AND v_city IS NOT NULL THEN
    SELECT AVG(last.price_per_m2), COUNT(*)
      INTO v_avg_pm2, v_count
      FROM properties p
      -- Haal per woning alleen de meest recente price_per_m2 op
      JOIN LATERAL (
        SELECT price_per_m2
          FROM property_price_history
         WHERE property_id = p.property_id
           AND price_per_m2 IS NOT NULL
         ORDER BY recorded_at DESC
         LIMIT 1
      ) last ON true
     WHERE p.property_id    != p_property_id
       AND p.loc_street      = v_street
       AND p.loc_city        = v_city;
    IF v_count >= 1 THEN v_scope := 'street'; END IF;
  END IF;

  -- ---- Wijk ----
  IF v_scope IS NULL AND v_hood IS NOT NULL AND v_city IS NOT NULL THEN
    SELECT AVG(last.price_per_m2), COUNT(*)
      INTO v_avg_pm2, v_count
      FROM properties p
      JOIN LATERAL (
        SELECT price_per_m2
          FROM property_price_history
         WHERE property_id = p.property_id
           AND price_per_m2 IS NOT NULL
         ORDER BY recorded_at DESC
         LIMIT 1
      ) last ON true
     WHERE p.property_id       != p_property_id
       AND p.loc_neighborhood   = v_hood
       AND p.loc_city           = v_city;
    IF v_count >= 1 THEN v_scope := 'neighborhood'; END IF;
  END IF;

  -- ---- Stad ----
  IF v_scope IS NULL AND v_city IS NOT NULL THEN
    SELECT AVG(last.price_per_m2), COUNT(*)
      INTO v_avg_pm2, v_count
      FROM properties p
      JOIN LATERAL (
        SELECT price_per_m2
          FROM property_price_history
         WHERE property_id = p.property_id
           AND price_per_m2 IS NOT NULL
         ORDER BY recorded_at DESC
         LIMIT 1
      ) last ON true
     WHERE p.property_id != p_property_id
       AND p.loc_city     = v_city;
    IF v_count >= 1 THEN v_scope := 'city'; END IF;
  END IF;

  IF v_scope IS NULL OR v_avg_pm2 IS NULL OR v_avg_pm2 = 0 THEN
    RETURN jsonb_build_object('scope', null, 'pct_diff', null,
                              'own_price_per_m2', v_own_pm2, 'avg_price_per_m2', null, 'count', 0);
  END IF;

  RETURN jsonb_build_object(
    'scope',            v_scope,
    'pct_diff',         ROUND(((v_own_pm2 - v_avg_pm2) / v_avg_pm2 * 100)::NUMERIC, 1),
    'own_price_per_m2', v_own_pm2,
    'avg_price_per_m2', ROUND(v_avg_pm2),
    'count',            v_count
  );
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER;

-- Verify
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_type = 'BASE TABLE'
  AND table_name IN ('users', 'properties', 'comments', 'emoji_reactions', 'votes', 'email_notifications', 'property_price_history', 'property_woz_history')
ORDER BY table_name;
