-- ============================================================================
-- Funda Inzicht — Debug Email Flow
-- Voer elke stap apart uit in Supabase SQL Editor
-- ============================================================================

-- ----------------------------------------------------------------------------
-- STAP 1: Triggers OK? (O = enabled, D = disabled)
-- Verwacht: tgenabled = 'O' voor beide — dat is goed!
-- ----------------------------------------------------------------------------
SELECT tgname, tgenabled, tgrelid::regclass AS tabel
FROM pg_trigger
WHERE tgname IN ('trigger_notify_on_comment', 'trigger_notify_on_emoji');

-- ----------------------------------------------------------------------------
-- STAP 2: Wat staat er in email_notifications?
-- Kijk naar sent=true/false en of er recent iets is binnengekomen
-- ----------------------------------------------------------------------------
SELECT id, reaction_type, reactor_name, property_address, sent, sent_at, created_at
FROM email_notifications
ORDER BY created_at DESC
LIMIT 10;

-- ----------------------------------------------------------------------------
-- STAP 3: Test de trigger met een directe INSERT
-- Vervang 'PROPERTY_ID' met een echte waarde uit stap 4
-- ----------------------------------------------------------------------------

-- Zoek eerst een bestaand property_id:
SELECT property_id, address FROM properties LIMIT 5;

-- Voer dan dit uit:
-- INSERT INTO comments (property_id, user_id, name, text)
-- VALUES ('PROPERTY_ID', 'user_debug_test', 'Debug Persoon', 'Trigger test');

-- ----------------------------------------------------------------------------
-- STAP 4: Is er een nieuwe rij in email_notifications na de INSERT?
-- ----------------------------------------------------------------------------
SELECT id, reaction_type, reactor_name, comment_text, sent, created_at
FROM email_notifications
WHERE reactor_name = 'Debug Persoon'
ORDER BY created_at DESC;

-- Als hier een rij staat met sent=false:
--   → Trigger werkt, maar webhook/Edge Function doet het niet
-- Als hier geen rij staat:
--   → Trigger zelf werkt niet, functie opnieuw uitvoeren

-- ----------------------------------------------------------------------------
-- STAP 5: Handmatig sent=false rijen opnieuw aanbieden aan de webhook
-- Dit werkt NIET rechtstreeks via SQL, maar je kunt de Edge Function
-- handmatig aanroepen via curl (zie STAP 6)
-- ----------------------------------------------------------------------------

-- ----------------------------------------------------------------------------
-- STAP 6: Edge Function direct aanroepen via curl (in je terminal)
-- Vervang PROJECT_REF en ANON_KEY met je eigen waarden
-- ----------------------------------------------------------------------------
-- curl -X POST \
--   https://PROJECT_REF.supabase.co/functions/v1/send-notification-email \
--   -H "Authorization: Bearer ANON_KEY" \
--   -H "Content-Type: application/json" \
--   -d '{
--     "type": "INSERT",
--     "table": "email_notifications",
--     "record": {
--       "id": "00000000-0000-0000-0000-000000000001",
--       "reaction_type": "comment",
--       "reactor_name": "Test Persoon",
--       "reactor_email": null,
--       "comment_text": "Dit is een testmail",
--       "property_address": "Teststraat 1, Amsterdam",
--       "property_url": "https://www.funda.nl",
--       "sent": false
--     }
--   }'

-- Verwacht: {"ok":true}
-- Als je een error krijgt, staat de oorzaak in de response

-- ----------------------------------------------------------------------------
-- STAP 7: Opruimen testdata
-- ----------------------------------------------------------------------------
-- DELETE FROM comments        WHERE user_id = 'user_debug_test';
-- DELETE FROM email_notifications WHERE reactor_name = 'Debug Persoon';
