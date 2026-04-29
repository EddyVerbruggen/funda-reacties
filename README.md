# 🏠💬 Funda Reacties

**Reageer op woningen op Funda.nl** — lees en deel ervaringen met andere huizenzoekers.

Een Chrome-extensie die een reactiepaneel toevoegt aan woningpagina's op Funda.nl. Denk aan een combinatie van Reddit-achtige comments en snelle emoji-reacties, direct op de pagina van het huis dat je bekijkt.

---

## Features

- 💬 **Tekstreacties** — deel je ervaring met een woning (bezichtiging, buurt, makelaar)
- 🔥 **Emoji quick-reactions** — reageer met één klik (🔥 😍 🤔 💸 📉 🏡)
- 📊 **Auto-inzichten** — automatisch gegenereerde data-chips (dagen online, prijs/m², buurtscore)
- ▲▼ **Upvotes/downvotes** — de meest nuttige reacties komen bovenaan
- 🕵️ **Anoniem** — geen account nodig om te reageren
- 🔄 **SPA-aware** — werkt ook bij client-side navigatie op Funda

---

## Installatie (development)

1. Clone of download deze map
2. Open Chrome → `chrome://extensions/`
3. Zet **Developer mode** aan (rechtsboven)
4. Klik **Load unpacked** en selecteer de `funda-reacties` map
5. Ga naar een woningpagina op funda.nl — het reactiepaneel verschijnt onderaan

---

## Projectstructuur

```
funda-reacties/
├── manifest.json          # Chrome Extension Manifest V3
├── content.js             # Injecteert het reactiepaneel in Funda pagina's
├── background.js          # Service worker (API communicatie, badge)
├── popup.html             # Popup bij klik op extensie-icoon
├── popup.js               # Popup logica
├── styles/
│   └── panel.css          # Styling voor het geïnjecteerde paneel
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── README.md
```

---

## Architectuur & Roadmap

### Huidige versie (v0.1 — lokaal)

Data wordt opgeslagen in `localStorage` van de Funda-pagina. Dit betekent dat reacties alleen op je eigen browser zichtbaar zijn. Perfect om de UX te testen.

### Volgende stap (v0.2 — gedeeld)

Voeg een backend toe zodat reacties gedeeld worden tussen alle gebruikers:

**Optie A: Supabase (aanbevolen voor snelle start)**
- Gratis tier, realtime subscriptions, ingebouwde auth
- Tabel `reactions` met kolommen: `property_id`, `user_id`, `text`, `emoji`, `upvotes`, `created_at`
- Row Level Security voor spam-bescherming

**Optie B: Firebase**
- Firestore collection per property ID
- Anonymous auth (laagste drempel)

**Optie C: Eigen API**
- Node.js/Express + PostgreSQL
- Meer controle, meer werk

### Toekomstige features

- [ ] Google Sign-In (optioneel, voor persistent profiel)
- [ ] Mogelijk maken een nieuwe emoji-reactie te geven (nu kun je alleen bestaande emoji aanklikken)
- [ ] Sla op wat de vraagprijs was ten tijde van het plaatsen van een comment en toon dat bij de comment, mocht het afwijken van de huidige vraagprijs
- [ ] Buurt-aggregatie (toon reacties van nabijgelegen woningen als deze woning geen reacties heeft)
- [ ] Moderatie (rapporteer-knop, automatische spam-detectie)
- [ ] Notificaties ("iemand reageerde op een woning die je hebt bekeken")
- [ ] Firefox-versie
- [ ] Integratie met WOZ-data en CBS-statistieken (à la Betrap de Makelaar)

---

## Laagdrempeligheid-strategie

| Drempel | Oplossing |
|---------|-----------|
| Account aanmaken | Niet nodig — anoniem reageren |
| Extensie installeren | Enige drempel, maar éénmalig |
| Lege pagina's | Auto-inzichten vullen de leegte |
| "Niemand reageert" | Emoji-reacties zijn laagdrempeliger dan tekst |
| Angst om te posten | Anoniem + voorbeeldtekst in placeholder |

---

## Licentie

MIT — gebruik het, verbeter het, deel het.
