# Plattform-Anbindung: API-Spezifikation

**Stand:** 2026-07-21
**Status:** ⚠️ **Entwurf — noch nicht implementiert.** Dieses Dokument beschreibt, wie die
Anbindung aussehen soll, nicht wie sie ist.

Zugehörig: [../leaven-api-endpoint-usage.md](../leaven-api-endpoint-usage.md) (der
heute vorhandene Sendeweg), [../internet.md](../internet.md) (Sicherheitsgrundlagen),
[../plan.md](../plan.md) (Arbeitsplan und Fortschritt).

---

## 1. Was heute existiert — und was nicht

| | Stand |
|---|---|
| Senden an eine feste Adresse (`post_to_endpoint`) | ✅ vorhanden |
| Token-Authentifizierung (`LEAVEN_API_TOKEN`) | ✅ vorhanden |
| Arbeitsplan mit Schritten und Status | ✅ vorhanden, aber nur lokal |
| **Automatische Fortschrittsmeldung** | ❌ fehlt — heute sendet nur das Modell, bewusst und mit Freigabe |
| **Rückkanal (Plattform antwortet der CLI)** | ❌ fehlt — es gibt keinen Weg, eine Antwort entgegenzunehmen |
| **Start der CLI durch die Plattform** | ❌ fehlt |

Der heutige Sendeweg ist **einseitig und modellgesteuert**: Das Modell ruft
`post_to_endpoint` auf, der Nutzer gibt frei, die Antwort der Plattform geht als Text
zurück ans Modell. Für Fortschrittsmeldungen ist das ungeeignet — sie sollen automatisch
und ohne Freigabe fliessen.

---

## 2. Fortschrittsmeldungen

### Wann gesendet wird

Ein Ereignis bei jeder Zustandsänderung, die für die Plattform sichtbar sein soll:

| Ereignis | Auslöser |
|---|---|
| `sitzung.start` | CLI startet, Bereiche und Rolle stehen fest |
| `auftrag.start` | Nutzereingabe entgegengenommen |
| `plan.aktualisiert` | `update_plan` wurde aufgerufen |
| `schritt.ausgefuehrt` | ein Werkzeug lief (Erfolg oder Fehler) |
| `auftrag.ende` | Turn abgeschlossen, mit Abschlusstext |
| `sitzung.ende` | CLI beendet |

### Rumpf

```jsonc
{
  "typ": "plan.aktualisiert",
  "sitzung": "01JD7…",            // pro CLI-Start erzeugt, stabil über die Sitzung
  "zeit": "2026-07-21T17:40:12Z",
  "rolle": "julalo-frontend",     // null wenn keine Rolle aktiv

  "plan": {
    "gesamt": 6,
    "abgeschlossen": 3,           // erledigt + entfaellt
    "schritte": [
      { "titel": "Verzeichnis anlegen", "status": "erledigt" },
      { "titel": "index.html erstellen", "status": "erledigt" },
      { "titel": "css/style.css",        "status": "erledigt" },
      { "titel": "js/main.js",           "status": "laeuft"   },
      { "titel": "Platzhalterbild",      "status": "offen"    },
      { "titel": "README.md",            "status": "offen"    }
    ]
  },

  "schritte_verbraucht": 17,      // Iterationen im aktuellen Auftrag
  "schritte_grenze": 40
}
```

Bei `schritt.ausgefuehrt` zusätzlich:

```jsonc
{
  "werkzeug": "write_file",
  "ziel": "templates/herz-rein.de/index.html",
  "ergebnis": "ok",               // "ok" | "fehler" | "abgelehnt" | "blockiert"
  "meldung": "Datei wurde geschrieben (Verzeichnis wurde mit angelegt)."
}
```

**`abgeschlossen` zählt `erledigt` UND `entfaellt`.** Ein Schritt, der sich erübrigt hat,
ist erledigt — sonst bleibt die Anzeige hängen. Siehe [../plan.md](../plan.md).

**Keine Prozentwerte im Protokoll.** Die Plattform kann `abgeschlossen/gesamt` selbst
darstellen. Ein vorberechneter Prozentwert verdeckt, dass der Nenner wachsen kann.

### Zustellung

`POST {endpoint}/events`, Rumpf wie oben, Header wie beim vorhandenen Sendeweg:

```http
Content-Type: application/json
Authorization: Bearer <LEAVEN_API_TOKEN>
User-Agent: leaven-cli
```

**Fortschrittsmeldungen dürfen den Vorgang nie blockieren.** Ist die Plattform nicht
erreichbar oder langsam, läuft die CLI weiter. Zeitlimit kurz (2–3 s), Fehler still ins
Protokoll, kein Wiederholungssturm.

---

## 3. Der Rückkanal: Nachfrage nach 40 Schritten

Hier liegt der schwierige Teil. Alle bisherigen Wege sind **einseitig** — die CLI sendet.
Für die Weiterarbeiten-Frage braucht sie eine **Antwort**.

### Ablauf

```
CLI                                          Plattform
 │  40 Schritte erreicht                          │
 │─── POST /fragen ──────────────────────────────▶│
 │    { typ: "weiterarbeiten", frage_id, plan }   │  Frage anzeigen,
 │                                                 │  auf Mensch warten
 │◀── 200 { antwort: "warten" } ──────────────────│
 │                                                 │
 │  … Abstand 3 s …                                │
 │─── GET /fragen/{frage_id} ────────────────────▶│
 │◀── 200 { antwort: "warten" } ──────────────────│
 │                                                 │
 │─── GET /fragen/{frage_id} ────────────────────▶│
 │◀── 200 { antwort: "weiter" } ──────────────────│
 │  weitere 40 Schritte                            │
```

Antwortwerte: `"weiter"` · `"stopp"` · `"warten"`.

### Warum Polling und nicht Long-Polling

Long-Polling (die Plattform hält die Anfrage offen, bis ein Mensch antwortet) spart
Anfragen, hat aber zwei Nachteile: Proxys und Lastverteiler brechen lange Verbindungen ab,
und ein hängengebliebener Request ist von einem wartenden nicht zu unterscheiden. Kurzes
Polling ist robuster und leichter zu debuggen.

### Zeitüberschreitung — der wichtigste Teil

**Antwortet niemand, wird gestoppt.** Nicht weitergearbeitet.

```jsonc
{ "frageZeitlimit": 900, "beiZeitueberschreitung": "stopp" }
```

Begründung: Die Frage existiert, weil ein Vorgang aus dem Ruder laufen kann. Bei
Zeitüberschreitung weiterzumachen würde genau den Fall unbeaufsichtigt lassen, für den die
Grenze gedacht ist. Der Verlauf bleibt erhalten — später fortsetzen ist jederzeit möglich.

---

## 4. Sicherheit: Der Rückkanal kehrt die Vertrauensrichtung um

Bis hierher gilt: Die Plattform **empfängt**. Sobald sie Fragen **beantwortet**, steuert
sie die CLI. Das ist ein grundlegender Unterschied.

**Festlegung:** Die Plattform ist eigene Software und gilt als vertrauenswürdig. Sie darf
den vollen Rechteumfang bestimmen — genau das ist die Voraussetzung dafür, Aufträge
überhaupt von dort aus zu starten.

Daraus folgt aber nicht, dass jede Rechteänderung zu jedem Zeitpunkt zulässig ist. Die
Trennlinie verläuft nicht zwischen „Plattform" und „CLI", sondern zwischen **vor** und
**während** eines Auftrags.

### Die Regel: Rechte beim Start, nicht während des Laufs

| Zeitpunkt | Was die Plattform darf |
|---|---|
| **Beim Start eines Auftrags** | Alles: Bereiche, Lese-/Schreib-/Shell-Rechte, Rolle, Modell, Netzfreigaben, Geheimnis-Sperre |
| **Während des Laufs** | Nur `weiter` / `stopp` auf die Schrittfrage |

**Warum diese Linie:** Beim Start hat der Agent noch nichts gelesen. Die Rechte stammen
aus einer Entscheidung von euch, unbeeinflusst von irgendwelchen Inhalten.

Während des Laufs kann er Dateien und Webseiten gelesen haben. Könnte er dann Rechte
anfordern und die Plattform sie gewähren, entstünde diese Kette:

```
Seite abrufen → injizierte Anweisung im Text → Agent fordert Shell-Rechte an
              → Plattform gewährt → Anweisung wirkt
```

Genau diesen Weg schliesst die Regel. Sie kostet nichts an Funktionalität: Wer weiss, dass
ein Auftrag Shell-Rechte braucht, gibt sie beim Start mit.

Konkret: Die CLI nimmt **keine** Rechteangaben in einer Antwort auf `/fragen` entgegen.
Rechte kommen ausschliesslich aus dem Auftrags-Start (Abschnitt 5) und aus der lokal
eingerichteten Rolle.

### Was der Token jetzt bedeutet

Mit dieser Befugnis ist der Plattform-Token kein Sende-Token mehr, sondern ein
**Generalschlüssel für den Entwicklungsrechner**: Wer ihn hat, kann Aufträge mit
Schreibzugriff und Shell starten. Daraus folgen strengere Pflichten als in
[../leaven-api-endpoint-usage.md](../leaven-api-endpoint-usage.md):

- **Getrennte Token** für Empfang (Ereignisse) und Steuerung (Auftragsstart, Rückkanal).
  Ein Leck im reinen Empfangsteil darf keine Steuerung bedeuten.
- **Nur in der Umgebung**, nie in `config/` oder einer Versionsverwaltung.
- **Regelmässig wechseln**, und bei jedem Verdacht sofort.
- **Die Plattform selbst absichern**: Ihre Übernahme ist die Übernahme jedes verbundenen
  Rechners. Zwei-Faktor-Anmeldung, keine offene Registrierung, Abhängigkeiten aktuell.

### Weitere Anforderungen an den Rückkanal

- **Antworten binden an eine `frage_id`.** Eine Antwort ohne passende, offene Frage wird
  verworfen. Sonst kann eine vorbereitete Antwort eine spätere Frage beantworten.
- **Einmalige Verwendung.** Nach dem Einlösen ist die `frage_id` ungültig.
- **Nur die konfigurierte Adresse.** Es gilt dieselbe Prüfung wie bei
  `post_to_endpoint`: eine Domain, nur `https`, keine internen Adressen, keine
  Weiterleitungen. Siehe [../internet.md](../internet.md).
- **Unbekannte Felder werden ignoriert.** Eine Antwort, die neben `antwort` noch
  `rechte` oder `bereiche` enthält, wird nicht etwa abgelehnt — die Felder werden
  schlicht nicht gelesen. So kann eine spätere Erweiterung der Plattform nicht
  versehentlich zur Rechteerhöhung führen.

---

## 5. Start durch die Plattform

Für den Betrieb ohne Terminal braucht die CLI einen Modus, in dem niemand vor dem
Bildschirm sitzt.

```bash
leaven --headless \
          --platform https://meine-instanz.tld/api \
          --auftrag "Landingpage nach Vorlage aufbauen" \
          --role julalo-frontend
```

Die Plattform kann die Rechte auch direkt im Auftrag mitgeben, statt sich auf eine lokal
eingerichtete Rolle zu stützen:

```jsonc
// Antwort der Plattform auf den Auftrags-Abruf
{
  "auftrag": "Landingpage nach Vorlage aufbauen",
  "rechte": {
    "read":  "/Users/myki/develop",
    "write": ["/Users/myki/develop/templates/herz-rein.de"],
    "permissions": { "read": true, "write": true, "exec": false },
    "internet": ["docs.example.com"],
    "allowSecrets": false
  },
  "settings": { "model": "deepseek-v4-pro", "thinking": true, "effort": "high" }
}
```

**Das ist der einzige Zeitpunkt, an dem Rechte von aussen gesetzt werden.** Danach sind
sie für die Dauer des Auftrags festgeschrieben — siehe Abschnitt 4.

Verhalten in `--headless`:

| Punkt | Verhalten |
|---|---|
| Werkzeug-Freigaben | **keine Dialoge** — es gilt, was der Auftrag bzw. die Rolle mitbringt |
| Nicht freigegebene Werkzeuge | werden abgelehnt, nicht erfragt |
| Nachfrage nach 40 Schritten | geht über den Rückkanal an die Plattform |
| Fortschritt | wird laufend gesendet |
| Ende | `auftrag.ende` mit Abschlusstext und Aktionsliste |

**`--headless` ist nicht dasselbe wie `--yes`.** `--yes` gibt pauschal alles frei, auch
was nie vorgesehen war. Headless gibt nichts zusätzlich frei — es unterdrückt die Dialoge
und lehnt ab, was der Auftrag nicht ausdrücklich erlaubt. Der Unterschied wird wichtig,
sobald ein Auftrag ohne Shell-Recht startet: Mit `--yes` liefe ein `rm` durch, headless
wird es abgelehnt.

**Lokale Obergrenze empfohlen.** Eine Datei wie `~/.leaven/platform-limits.json` kann
festlegen, was die Plattform höchstens vergeben darf — etwa „niemals Shell-Rechte",
„niemals ausserhalb von `~/develop`", „niemals `--allow-secrets`". Das schützt nicht gegen
euch selbst, sondern gegen einen Fehler in der Plattform oder einen geleakten Token.
Optional, aber billig.

---

## 6. Gegenstelle: Mindestumfang

```js
import express from 'express';
const app = express();
app.use(express.json({ limit: '1mb' }));

const TOKEN = process.env.LEAVEN_API_TOKEN;
const auth = (req, res, next) =>
  req.get('authorization') === `Bearer ${TOKEN}` ? next() : res.status(401).end();

const fragen = new Map();   // frage_id -> { antwort, erstellt }

// Fortschritt: annehmen, schnell antworten, nie blockieren
app.post('/api/events', auth, (req, res) => {
  speichereEreignis(req.body);
  res.status(204).end();          // niemals 3xx – die CLI folgt keiner Weiterleitung
});

// Frage eintragen
app.post('/api/fragen', auth, (req, res) => {
  const { frage_id } = req.body;
  fragen.set(frage_id, { antwort: 'warten', erstellt: Date.now() });
  benachrichtigeMenschen(req.body);
  res.json({ antwort: 'warten' });
});

// Antwort abholen
app.get('/api/fragen/:id', auth, (req, res) => {
  const eintrag = fragen.get(req.params.id);
  if (!eintrag) return res.json({ antwort: 'stopp' });   // unbekannt -> sicherer Wert
  if (eintrag.antwort !== 'warten') fragen.delete(req.params.id);  // einmalig
  res.json({ antwort: eintrag.antwort });
});
```

**Bei Unklarheit immer `stopp`.** Unbekannte Frage, abgelaufene Frage, Fehler in der
Datenbank — der sichere Wert ist anhalten, nicht weitermachen.

Es gelten dieselben Pflichten wie beim vorhandenen Sendeweg: authentifizieren, Schema
prüfen, Grösse begrenzen, nichts ungefiltert anzeigen, Ratenbegrenzung. Siehe
[../leaven-api-endpoint-usage.md](../leaven-api-endpoint-usage.md), Abschnitt 7.

---

## 7. Was gebaut werden muss

In sinnvoller Reihenfolge — jeder Punkt ist für sich nützlich:

1. **Ereignis-Versand** (`sendeEreignis()`): eigener Weg neben `post_to_endpoint`, ohne
   Freigabe, mit kurzem Zeitlimit, Fehler still. Auslöser an den sechs Stellen aus
   Abschnitt 2.
2. **Sitzungs-Kennung** je CLI-Start.
3. **Iterationszähler nach aussen geben** — liegt heute nur lokal in `runAgentTurn()`.
4. **Rückkanal**: `frageplattform()` mit Polling, Zeitüberschreitung → `stopp`. Einbau an
   der Stelle, an der heute `frageJaNein('Weitere … Schritte…')` steht (`MAX_ITERATIONS`, derzeit 99 999).
   Dabei **nur** das Feld `antwort` auswerten, alle anderen ignorieren.
5. **Auftrags-Start**: Rechte aus der Plattform-Antwort übernehmen — einmalig, vor dem
   ersten Modellaufruf.
6. **`--headless`**: Dialoge unterdrücken, nicht freigegebene Werkzeuge ablehnen.
7. **Getrennte Token** für Empfang und Steuerung.
8. **Lokale Obergrenze** (`platform-limits.json`), optional.
9. **Tests**: Zeitüberschreitung führt zu `stopp`; eine Antwort ohne passende `frage_id`
   wird verworfen; ein nicht erreichbarer Ereignis-Endpunkt hält den Vorgang nicht auf;
   **eine Antwort mit `rechte`-Feld erhöht die Rechte nicht**.

## 8. Offene Fragen

- **Mehrere gleichzeitige Sitzungen** auf demselben Rechner: Die Sitzungs-Kennung trennt
  sie im Protokoll. Ob die Plattform sie auch steuern können soll, ist offen.
- **Abbruch von aussen** („stopp jetzt", nicht erst bei der nächsten Frage) würde ein
  Abfragen zwischen jedem Schritt erfordern. Nicht in Abschnitt 7 enthalten.
- **Rückwirkung auf die Kosten:** Ein Polling alle 3 Sekunden über 15 Minuten sind 300
  Anfragen je Frage. Für eine eigene Instanz unkritisch, bei einem gehosteten Dienst nicht.
