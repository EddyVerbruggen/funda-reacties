# 🏠💬 Funda Reacties

**Reageer op woningen op Funda.nl** — lees en deel ervaringen met andere huizenzoekers.

Een Chrome-extensie die een reactiepaneel toevoegt aan woningpagina's op Funda.nl. Denk aan een combinatie van Reddit-achtige comments en snelle emoji-reacties, direct op de pagina van het huis dat je bekijkt.

---

## Features

- 💬 **Tekstreacties** — deel je ervaring met een woning (bezichtiging, buurt, makelaar)
- 🔥 **Emoji quick-reactions** — reageer met één klik (🔥 😍 🤔 💸 📉 🏡)
- 📊 **Auto-inzichten** — automatisch gegenereerde data-chips (dagen online, prijs/m², buurtscore)
- ▲▼ **Upvotes/downvotes** — de meest nuttige reacties komen bovenaan
- 📍 **Buurt-aggregatie** — als er nog geen reacties op deze woning zijn, toon reacties van woningen in de buurt (straat → wijk → stad → regio → provincie), met doorklik naar de andere woning
- 🕵️ **Anoniem** — geen account nodig om te reageren
- 🔄 **SPA-aware** — werkt ook bij client-side navigatie op Funda
- 🔔 **Real-time notificaties** — krijg een melding als iemand reageert op een woning waar jij ook een reactie hebt gegeven
- ☁️ **Multi-user** — reacties worden gedeeld tussen alle gebruikers via Supabase

---

## Installatie

### Stap 1: Supabase Project Opzetten

1. Ga naar [supabase.com](https://supabase.com) en maak een gratis account aan
2. Klik op **New Project**
3. Vul een project naam in (bijv. "funda-reacties")
4. Kies een database password en onthoud deze
5. Selecteer een region (Amsterdam/Frankfurt voor snelheid vanuit NL)
6. Klik **Create new project** en wacht tot het project klaar is (~2 minuten)

### Stap 2: Database Schema Aanmaken

1. Open je Supabase project dashboard
2. Ga naar **SQL Editor** (in het menu links)
3. Klik op **New Query**
4. Open het bestand `supabase-schema.sql` in deze repository
5. Kopieer de volledige inhoud en plak deze in de SQL editor
6. Klik op **Run** (of druk Ctrl/Cmd + Enter)
7. Je zou moeten zien: `Success. No rows returned` en een lijst van 4 tabellen

### Stap 3: Realtime Inschakelen

1. Ga naar **Database** > **Replication** (in het menu links)
2. Zoek de tabel `comments` in de lijst
3. Klik op de toggle naast "Source" om Realtime in te schakelen
4. De tabel zou nu een groen vinkje moeten hebben

### Stap 4: API Credentials Ophalen

1. Ga naar **Settings** > **API** (onderaan het menu links)
2. Zoek de sectie "Project API keys"
3. Kopieer de **URL** (bijv. `https://xxxxx.supabase.co`)
4. Kopieer de **anon/public** key (lange string die begint met `eyJ...`)

### Stap 5: Extensie Configureren

1. Open het bestand `supabase-client.js` in deze repository
2. Vervang `YOUR_SUPABASE_URL` met de URL die je in stap 4 hebt gekopieerd
3. Vervang `YOUR_SUPABASE_ANON_KEY` met de anon key die je in stap 4 hebt gekopieerd
4. Sla het bestand op

### Stap 6: Chrome Extensie Laden

1. Open Chrome → `chrome://extensions/`
2. Zet **Developer mode** aan (rechtsboven)
3. Klik **Load unpacked** en selecteer de `funda-reacties` map
4. De extensie is nu actief!

### Stap 7: Testen

1. Ga naar een woningpagina op Funda.nl (bijv. https://www.funda.nl/koop/amsterdam/)
2. Klik op een willekeurige woning
3. Scroll naar beneden — je zou het reactiepaneel moeten zien
4. Plaats een testcommentaar of emoji reactie
5. Open dezelfde pagina in een incognito venster — je zou je reactie moeten zien!

### Stap 8: Notificaties Permissie

1. Als je een reactie plaatst op een woning, zal Chrome om notificatie-permissie vragen
2. Klik **Allow** om browser notificaties te ontvangen
3. Je ontvangt nu een notificatie als iemand anders ook reageert op een woning waar jij een reactie hebt gegeven

---

## Projectstructuur

```
funda-reacties/
├── manifest.json          # Chrome Extension Manifest V3
├── content.js             # Injecteert het reactiepaneel in Funda pagina's
├── background.js          # Service worker (notificaties, badge)
├── popup.html             # Popup bij klik op extensie-icoon
├── popup.js               # Popup logica
├── db/supabase-client.js     # Supabase API wrapper
├── db/supabase-schema.sql    # Database schema (voer uit in Supabase)
├── styles/panel.css          # Styling voor het geïnjecteerde paneel
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── README.md
```

---

## Architectuur

### v0.5.0 — Multi-user met Supabase (current)

Data wordt opgeslagen in een Supabase PostgreSQL database:

**Database Schema:**
- `properties` — metadata van woningen (adres, URL, locatie)
- `comments` — tekstcommentaren
- `emoji_reactions` — snelle emoji reacties
- `votes` — upvotes/downvotes op comments

**Features:**
- Real-time updates via Supabase Realtime
- Browser notificaties bij nieuwe reacties
- Anonieme user IDs (opgeslagen in chrome.storage.local)
- Row Level Security voor data-bescherming

### Toekomstige features

- [ ] Buurt-aggregatie uitbreiden met regio en provincie
- [ ] Moderatie (rapporteer-knop, automatische spam-detectie)
- [ ] Favorieten-monitoring — notificatie als er een reactie komt op je favoriet
- [ ] Integratie met WOZ-data en CBS-statistieken
- [ ] Export/import van reacties
- [ ] Dark mode
- [ ] Popup: teller voor geplaatste reacties en bekeken woningen
- [ ] Popup: knop om een testnotificatie te versturen

---

## Troubleshooting

### Extensie laadt niet

- Check of Developer Mode aanstaat in `chrome://extensions/`
- Klik op "Errors" bij de extensie om details te zien
- Herlaad de extensie met de refresh knop

### Geen reacties zichtbaar

- Open de browser console (F12) op een Funda pagina
- Kijk naar error messages met `[Funda Reacties]` prefix
- Check of Supabase credentials correct zijn ingevuld in `supabase-client.js`
- Verifieer dat het database schema correct is uitgevoerd (zie Supabase > SQL Editor > Query History)

### Notificaties werken niet

- Check of Chrome notificatie-permissie is gegeven:
  - `chrome://settings/content/notifications`
  - Zoek naar `funda.nl` en zorg dat het op "Allow" staat
- Herlaad de Funda pagina na het geven van permissie

### Database errors

- Ga naar Supabase dashboard > **Logs** > **Postgres Logs**
- Zoek naar foutmeldingen rondom de tijd dat je een actie probeerde
- Meest voorkomend: Row Level Security blokkeert requests
  - Oplossing: Check of de RLS policies correct zijn aangemaakt (zie `db/supabase-schema.sql`)

---

## Privacy & Security

- **Anonimiteit:** Er is geen account nodig. Je krijgt een willekeurige user ID
- **Data opslag:** Alleen je user ID en je reacties worden opgeslagen
- **Geen tracking:** De extensie stuurt geen analytics
- **Open source:** Alle code is inzichtelijk
- **GDPR:** Je kunt je data verwijderen via Supabase dashboard

---

## Ontwikkeling

### Lokaal testen

```bash
# Clone de repository
git clone https://github.com/jouw-username/funda-reacties.git
cd funda-reacties

# Open in VS Code
code .

# Laad de extensie in Chrome (zie installatie-instructies)
```

### Database wijzigingen

Als je het schema wijzigt:
1. Update `db/supabase-schema.sql`
2. Voer de nieuwe SQL uit in Supabase SQL Editor
3. Update `supabase-client.js` als de API calls moeten veranderen
4. Test grondig!

### Versie verhogen

Bij elke wijziging:
1. Update `manifest.json` > `version` (gebruik semantic versioning)
2. Test de extensie lokaal
3. Commit en push

---

## Licentie

MIT — gebruik het, verbeter het, deel het.

---

## Credits

Gemaakt door huizenzoekers, voor huizenzoekers. 🏠❤️
