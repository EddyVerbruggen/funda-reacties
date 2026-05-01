# Privacy Policy — Funda Reacties

*Laatst bijgewerkt: mei 2026*

## Samenvatting

Funda Reacties is een open source Chrome-extensie waarmee gebruikers anoniem reacties kunnen plaatsen op woningpagina's van Funda.nl. We verzamelen zo min mogelijk data en verkopen nooit iets aan derden.

---

## Welke data we opslaan

### Lokaal op jouw apparaat (via `chrome.storage.local`)
- Een willekeurig gegenereerde gebruikers-ID (bijv. `user_1234_abc`) — automatisch aangemaakt, geen naam of account vereist
- Je weergavenaam (standaard automatisch gegenereerd, optioneel aanpasbaar)
- Je Funda e-mailadres, **alleen als je bent ingelogd op funda.nl** — wordt gebruikt als stabiele gebruikers-ID
- Aantal geplaatste reacties en bekeken woningen (lokale teller)

### In onze gedeelde database (Supabase)
- Je gebruikers-ID (anoniem of gekoppeld aan Funda-e-mail)
- Je weergavenaam
- De tekstreacties en emoji-reacties die je plaatst
- De URL en het adres van de woning waarop je reageert
- Tijdstempel van je reactie

## Wat we NIET opslaan
- Wachtwoorden
- Betalingsinformatie
- Browsergeschiedenis
- Andere persoonsgegevens dan bovenstaande

---

## Hoe we data gebruiken

De data wordt uitsluitend gebruikt om:
- Reacties te tonen aan andere gebruikers op dezelfde woningpagina
- Je een melding te sturen als iemand reageert op een woning waarop jij ook reageerde
- Anonieme reacties te koppelen aan je Funda-account als je later inlogt

We gebruiken de data **niet** voor advertenties, profilering of commerciële doeleinden.

---

## Derden

We maken gebruik van [Supabase](https://supabase.com) als database. Supabase is GDPR-compliant en host data in de EU (Frankfurt). Zie hun [privacybeleid](https://supabase.com/privacy) voor details.

Er worden verder geen data gedeeld met derden.

---

## Jouw rechten (AVG/GDPR)

Je hebt recht op:
- **Inzage** — stuur een verzoek via GitHub Issues
- **Verwijdering** — je reacties zijn gekoppeld aan je gebruikers-ID; stuur een verwijderverzoek via GitHub Issues met je gebruikers-ID (te vinden in de extensie-popup)
- **Bezwaar** — je kunt de extensie op elk moment verwijderen; lokale data wordt dan gewist

---

## Contact

Vragen of verzoeken? Open een issue op GitHub:  
[github.com/jouw-gebruikersnaam/funda-reacties/issues](https://github.com/jouw-gebruikersnaam/funda-reacties/issues)

---

## Wijzigingen

Wezenlijke wijzigingen in dit beleid worden vermeld in de changelog van de extensie. De datum bovenaan dit document wordt bijgehouden.
