-- ============================================================================
-- Funda Reacties — RLS Policy Migratie (v0.5.1 → v0.5.2)
--
-- Probleem: De oude DELETE/UPDATE policies gebruikten JWT claims
--           (current_setting('request.jwt.claims')), maar we gebruiken
--           geen Supabase Auth. Daardoor faalden deletes stilletjes
--           en konden emoji's niet uitgevinkt worden.
--
-- Fix:     Vervang de restrictieve policies door open policies.
--
-- Voer dit uit in Supabase > SQL Editor
-- ============================================================================

-- ---- Comments: voeg DELETE policy toe ----
DROP POLICY IF EXISTS "Comments can be deleted by everyone" ON comments;
CREATE POLICY "Comments can be deleted by everyone"
  ON comments FOR DELETE USING (true);

-- ---- Emoji Reactions: verwijder oude policy, maak open policy ----
DROP POLICY IF EXISTS "Users can delete their own emoji reactions" ON emoji_reactions;
CREATE POLICY "Emoji reactions can be deleted by everyone"
  ON emoji_reactions FOR DELETE USING (true);

-- ---- Votes: verwijder oude policies, maak open policies ----
DROP POLICY IF EXISTS "Users can update their own votes" ON votes;
DROP POLICY IF EXISTS "Users can delete their own votes" ON votes;

CREATE POLICY "Votes can be updated by everyone"
  ON votes FOR UPDATE USING (true);
CREATE POLICY "Votes can be deleted by everyone"
  ON votes FOR DELETE USING (true);

-- Verify: toon alle policies
SELECT tablename, policyname, cmd
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, cmd;
