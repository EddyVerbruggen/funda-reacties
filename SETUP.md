# ⚙️ Supabase Setup Guide

Deze gids helpt je stap voor stap om Supabase correct in te stellen voor de Funda Reacties extensie.

---

## 📋 Checklist

- [ ] Supabase account aangemaakt
- [ ] Project aangemaakt
- [ ] Database schema uitgevoerd
- [ ] Realtime ingeschakeld voor `comments` tabel
- [ ] API credentials in `supabase-client.js` ingevuld
- [ ] Extensie getest met een testcommentaar
- [ ] Notificaties getest in een tweede browser/tab

---

## 1️⃣ Supabase Account & Project

### Account aanmaken

1. Ga naar https://supabase.com
2. Klik **Start your project**
3. Kies **Continue with GitHub** (aanbevolen) of gebruik email
4. Verifieer je email als je email signup gebruikt

### Project aanmaken

1. Klik op **New project** in het dashboard
2. Vul in:
   - **Name:** `funda-reacties` (of een andere naam)
   - **Database Password:** Kies een sterk wachtwoord en sla deze op (je hebt deze later nodig voor directe database toegang)
   - **Region:** `West EU (Amsterdam)` of `Central EU (Frankfurt)` voor snelheid vanuit Nederland
   - **Pricing Plan:** Free (gratis, 500 MB database + 2 GB bandwidth/maand)
3. Klik **Create new project**
4. Wacht 1-2 minuten tot het project klaar is (je ziet een progress indicator)

---

## 2️⃣ Database Schema Installeren

### SQL Script uitvoeren

1. Open je project dashboard
2. Klik op **SQL Editor** in het menu links
3. Klik op **New query** (groene knop rechtsboven)
4. Open het bestand `supabase-schema.sql` in deze repository (gebruik een teksteditor)
5. Kopieer de **volledige** inhoud (Ctrl/Cmd + A, dan Ctrl/Cmd + C)
6. Plak in de SQL Editor (Ctrl/Cmd + V)
7. Klik op **Run** (of druk Ctrl/Cmd + Enter)

### Verificatie

Je zou moeten zien:

```
Success. No rows returned
```

En onderaan een lijst met 4 tabellen:
- `comments`
- `emoji_reactions`
- `properties`
- `votes`

Als je een error ziet:
- Check of je het **hele** script hebt gekopieerd (scroll tot aan het einde in `supabase-schema.sql`)
- Verwijder eventuele comment regels bovenaan als die problemen geven
- Voer de query opnieuw uit

---

## 3️⃣ Realtime Inschakelen

### Stap voor stap

1. Ga naar **Database** > **Replication** in het menu links
2. Je ziet een lijst van tabellen
3. Zoek de rij met `comments`
4. Klik op de toggle onder de kolom **Source** (wordt groen als actief)
5. De tabel zou nu een groen vinkje moeten tonen

### Waarom Realtime?

Zonder Realtime kan de extensie geen live updates ontvangen. Met Realtime krijg je:
- Instant notificaties als iemand een comment plaatst
- Live updates van emoji counts
- Real-time upvote/downvote counts

---

## 4️⃣ API Credentials Ophalen

### URL en Keys

1. Ga naar **Settings** > **API** (onderaan het menu links)
2. Scroll naar de sectie **Project API keys**
3. Kopieer de volgende twee waarden:

**A. Project URL**
```
https://abcdefgh.supabase.co
```
☝️ Dit is je Supabase URL (begint altijd met https:// en eindigt op .supabase.co)

**B. Anon / Public Key**
```
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.ey... (heel lang)
```
☝️ Dit is je publieke API key (begint altijd met `eyJ` en is heel lang)

### Credentials Invullen

1. Open het bestand `supabase-client.js` in de root van deze repository
2. Zoek de regels:
   ```javascript
   const SUPABASE_URL = 'YOUR_SUPABASE_URL';
   const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY';
   ```
3. Vervang `YOUR_SUPABASE_URL` met je Project URL (met quotes eromheen!)
4. Vervang `YOUR_SUPABASE_ANON_KEY` met je Anon key (met quotes eromheen!)
5. Het zou er nu zo uit moeten zien:
   ```javascript
   const SUPABASE_URL = 'https://abcdefgh.supabase.co';
   const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.ey...';
   ```
6. **Sla het bestand op** (Ctrl/Cmd + S)

### ⚠️ Security Opmerking

De `anon` key is veilig om publiek te delen — deze is read-only en beschermd door Row Level Security (RLS) policies. De `service_role` key moet je **NOOIT** in frontend code gebruiken!

---

## 5️⃣ Extensie Laden in Chrome

### Development Mode

1. Open Chrome
2. Ga naar `chrome://extensions/` (plak in de adresbalk)
3. Zet **Developer mode** aan (toggle rechtsboven)
4. Klik **Load unpacked** (knop linksboven)
5. Navigeer naar de `funda-reacties` map op je computer
6. Selecteer de map en klik **Select Folder** / **Open**
7. De extensie verschijnt nu in de lijst!

### Troubleshooting

**Errors bij laden:**
- Check of `manifest.json` aanwezig is in de map
- Kijk naar de error message onder de extensie
- Meest voorkomend: syntax error in een JS bestand — fix en reload

**"Manifest version 2 is deprecated":**
- Negeer deze waarschuwing, we gebruiken Manifest v3

---

## 6️⃣ Testen

### Basis Functionaliteit

1. Ga naar https://www.funda.nl/koop/amsterdam/
2. Klik op een willekeurige woning (scroll en kies er één)
3. Scroll naar beneden op de detail pagina
4. Je zou het **Reacties** paneel moeten zien verschijnen (blauw-oranje design)

**Lukt dit niet?**
- Open de browser console (F12)
- Ga naar het **Console** tab
- Zoek naar foutmeldingen met `[Funda Reacties]` prefix
- Meest voorkomend: Supabase credentials niet correct ingevuld

### Emoji Reactie Testen

1. Klik op een emoji (bijv. 🔥)
2. De emoji zou moeten "highlighten" en een cijfer 1 tonen
3. Klik nogmaals — emoji wordt weer inactive (cijfer verdwijnt)

**Werkt niet?**
- Check de console voor Supabase errors
- Verifieer dat de `emoji_reactions` tabel bestaat (Supabase > Database > Tables)
- Check of RLS policies correct zijn (run `supabase-schema.sql` opnieuw als je twijfelt)

### Commentaar Testen

1. Typ een testbericht in het tekstveld (bijv. "Test 123")
2. Klik **Plaatsen**
3. Het commentaar zou direct onder het tekstveld moeten verschijnen
4. Open een **incognito venster** (Ctrl/Cmd + Shift + N)
5. Ga naar **dezelfde** woningpagina
6. Je zou je commentaar moeten zien verschijnen!

**Werkt niet?**
- Check of het commentaar lokaal verschijnt (in de eerste tab)
- Als lokaal wel maar in incognito niet: Supabase credentials fout
- Als lokaal ook niet: JavaScript error — check console

### Multi-User Testen

1. Open de woningpagina in twee verschillende browsers (bijv. Chrome + Firefox)
   - Of: één normaal venster + één incognito venster
2. Plaats een emoji reactie in browser 1
3. Ververs browser 2
4. De emoji count zou moeten updaten!

### Notificaties Testen

Dit is de belangrijkste test voor de nieuwe functionaliteit!

1. **Tab 1:** Open een woningpagina en plaats een commentaar (zodat je "subscribed" bent)
2. **Tab 2:** Open **dezelfde** woningpagina in een incognito venster
3. **Tab 2:** Plaats een nieuw commentaar
4. **Tab 1:** Je zou een browser notificatie moeten zien verschijnen met tekst ongeveer:
   ```
   💬 Nieuwe reactie
   Iemand heeft gereageerd op [adres]
   ```

**Notificatie verschijnt niet?**
- Check of Chrome notificatie-permissie is gegeven (zie hieronder)
- Open de console in Tab 1 en zoek naar `[Funda Reacties]` logs
- Check of Realtime correct is ingeschakeld (zie stap 3)

### Notificatie Permissie Geven

Als Chrome om permissie vraagt:
1. Klik **Allow** / **Toestaan**

Als je per ongeluk **Block** hebt geklikt:
1. Ga naar `chrome://settings/content/notifications`
2. Zoek naar `funda.nl` in de **Block** lijst
3. Klik op de drie puntjes naast `funda.nl`
4. Klik **Allow**
5. Herlaad de Funda pagina

---

## 7️⃣ Productie Checklist

Als je de extensie wilt distribueren naar anderen:

- [ ] Verwijder alle test comments uit de database (Supabase > Table Editor > `comments` > selecteer en delete)
- [ ] Test op een verse Chrome profiel (of vraag een vriend om te testen)
- [ ] Verifieer dat Supabase Free tier limits OK zijn voor je verwachte gebruik:
  - 500 MB database (ruim voldoende voor duizenden comments)
  - 2 GB bandwidth/maand (check in Supabase > Settings > Usage)
- [ ] Voeg je Supabase project toe aan je GitHub (optioneel, voor version control van schema)
- [ ] Maak een backup van je database password (je hebt deze nodig voor directe SQL toegang)

---

## 🔍 Debugging Tips

### Supabase Logs Bekijken

1. Ga naar je Supabase project
2. Klik op **Logs** in het menu links
3. Kies **Postgres Logs** om database queries te zien
4. Kies **API Logs** om requests van de extensie te zien
5. Gebruik de filter om op tijd of error te zoeken

### Veel voorkomende errors

**Error: "Failed to fetch"**
- Supabase URL of anon key is fout ingevuld
- Check `supabase-client.js` regels 7-8

**Error: "new row violates row-level security policy"**
- RLS policies zijn niet correct geconfigureerd
- Run `supabase-schema.sql` opnieuw (de policies staan onderaan)

**Error: "relation \"comments\" does not exist"**
- Database schema is niet uitgevoerd
- Ga naar Supabase > SQL Editor en run `supabase-schema.sql`

**Notificaties komen niet aan**
- Realtime is niet ingeschakeld op de `comments` tabel
- Check Supabase > Database > Replication

---

## 🎉 Klaar!

Als alle bovenstaande tests slagen, is je Supabase setup compleet! De extensie is nu volledig functioneel en multi-user.

**Volgende stappen:**
- Test grondig op verschillende woningpagina's
- Nodig vrienden uit om te testen
- Monitor je Supabase usage (gratis tier heeft limieten)
- Lees de [README.md](README.md) voor verdere ontwikkeling

**Problemen?**
- Check de Troubleshooting sectie in [README.md](README.md)
- Bekijk de Supabase logs (zie Debugging Tips hierboven)
- Open een issue op GitHub als je vastloopt

Veel succes! 🚀
