# Konfiguration, Flags und Betrieb

**Stand:** 2026-07-21

## Start

```bash
cd ~/develop/platforms/leaven/leaven
npm run build
node dist/index.js
```

`npm run dev` startet über ts-node ohne Build. `npm start` entspricht
`node dist/index.js`.

## API-Schlüssel

```bash
export DEEPSEEK_API_KEY="sk-…"        # für die DeepSeek-Modelle
export ANTHROPIC_API_KEY="sk-ant-…"   # für Claude (Opus/Fable)
export QWEN_API_KEY="sk-…"            # für Qwen (DashScope); DASHSCOPE_API_KEY geht auch
```

**Beide Schlüssel dürfen gleichzeitig gesetzt sein** — die CLI lädt sie beim Start beide und
`/model` greift auf den passenden zu (siehe [providers.md](./providers.md)). Nur der
Schlüssel des **aktiven** Modells muss vorhanden sein; fehlt er, nennt die CLI die richtige
Variable. `/key` zeigt beide und kann sie pro Provider für die Sitzung überschreiben.

**Achtung, Stolperfalle in diesem Projekt:** Die Datei `.env` enthält nur einen
Platzhalter. Der echte Schlüssel liegt in der Shell-Umgebung. Das funktioniert, weil
dotenv vorhandene `process.env`-Variablen standardmässig **nicht** überschreibt.

Wer beim Testen `. ./.env` sourct, überschreibt damit den echten Schlüssel mit dem
Platzhalter und bekommt „Authentication Fails" — das sieht wie ein kaputter Schlüssel aus,
ist aber nur die `.env`.

## Kommandozeilen-Flags

| Flag | Wirkung |
|---|---|
| `-y`, `--yes` | Alle Tool-Aufrufe ohne Rückfrage. Nur für Tests und CI. |
| `--model <name>` | Modell überschreiben (Standard `deepseek-v4-pro`) |
| `--no-thinking` | Thinking-Modus aus — schneller und günstiger |
| `--effort <stufe>` | `reasoning_effort`: `high` (Standard) oder `max` |
| `--read-root <pfad>` | Lesebereich setzen, überspringt die Startfrage |
| `--write-root <pfade>` | Schreibbereiche setzen, mehrere durch Komma getrennt; überspringt die Startfrage |
| `--verbose` | Anzeige: Gedankenstrom **und** Zwischenschritte an |
| `--quiet` | Anzeige: beides aus – nur Endergebnis und Abschlussbericht |
| `--allow-secrets` | Sperre für `.env`, Schlüssel und Zugangsdaten aufheben |

Ein nicht existierender Pfad bei `--read-root`/`--write-root` führt zu einem harten
Abbruch mit Exit-Code 1, nicht zu einer stillen Fehlkonfiguration.

## Slash-Befehle zur Laufzeit

Befehlsnamen sind englisch (international auffindbar), die Ausgaben bleiben deutsch.
`/help` zeigt die Liste in der CLI.

| Befehl | Wirkung |
|---|---|
| `/help` | Übersicht aller Befehle |
| `/status` | aktuelle Einstellungen, Bereiche, Berechtigungen |
| `/rights` | Bereiche **und** Rechte einstellen — die Rechtefragen gibt es nur hier |
| `/model` | Modell wählen (`deepseek-v4-pro`, `deepseek-v4-flash`, `claude-opus-4-8`, `claude-fable-5`, `qwen3.7-max`) |
| `/thinking` | Thinking-Modus `on` / `off` |
| `/effort` | Denktiefe `high` / `max` |
| `/temperature` | Temperatur 0.0–2.0 |
| `/key` | API-Schlüssel maskiert anzeigen oder für die Sitzung wechseln |
| `/output` | Anzeige getrennt schalten: `reasoning on\|off` (Live-Gedankenstrom), `steps on\|off` (Zwischenschritte). Ohne Argument: Stand anzeigen. |
| `/budget` | Tages-Token-Budget **pro Anbieter** setzen/anzeigen; Auto-Stopp an/aus. Kurzname `opus`/`fable` etc. bei `/model`. |
| `/backstop` | Budget-Backstop (harte Obergrenze an Tool-Calls pro Sitzung) `on` / `off` / Zahl. Ohne Argument: Stand anzeigen. |
| `/resume` | Unterbrochene Aufgabe fortsetzen (wie „weiter"); `/resume auto on\|off` schaltet das automatische Fortsetzen beim Start. |
| `/plan` | Arbeitsplan anzeigen · `clear` löscht ihn — siehe [plan.md](./plan.md) |
| `/internet` | Domains für `fetch_url` freigeben — siehe [internet.md](./internet.md) |
| `/endpoint` | Sende-Ziel für `post_to_endpoint` — siehe [leaven-api-endpoint-usage.md](./leaven-api-endpoint-usage.md) |
| `/role` | Rollen: Auswahl · `use|new|edit|list|delete <name>` — siehe [roles.md](./roles.md) |
| `/clear` | Gesprächsverlauf löschen, Einstellungen behalten |
| `/exit` | beenden |

Argumente können direkt mitgegeben werden: `/model deepseek-v4-flash`, `/thinking off`,
`/temperature 0.7`. Ohne Argument erscheint eine Auswahl.

`exit`, `quit`, `q` funktionieren weiterhin. Das frühere `rechte` wird noch angenommen,
weist aber auf `/rights` hin.

`/help` zeigt neben den Befehlen auch die Terminal-Bedienung (Enter, mehrzeiliges
Einfügen, Strg-C, Strg-D), die Tasten im Freigabe-Dialog und die aktuellen Bereiche.
Über dem Eingaberahmen steht dauerhaft ein Kurzhinweis auf `/help`.

**Der Start fragt keine Rechte mehr ab.** Vorgaben: Lesen und Schreiben ohne Rückfrage,
Shell-Befehle mit Rückfrage. Änderbar über `/rights`, wo die eckigen Klammern immer den
aktuellen Wert als Vorgabe zeigen (`[Y/n]` bzw. `[y/N]`) — Enter ändert dort nie etwas.
Einzelheiten in [permissions-and-scopes.md](./permissions-and-scopes.md).

**Strg-C beendet die CLI sofort** — es gibt keinen SIGINT-Handler, ein laufender Auftrag
wird also mit abgebrochen. Das ist der Node-Standard und in `/help` so dokumentiert.

### Wichtig: `/model` und `/thinking` setzen den Verlauf zurück

Ein Wechsel mitten in einer Konversation ist genau das, woran dieses Projekt ursprünglich
gescheitert ist: Eine History mit `reasoning_content` wird von einem Non-Thinking-Modell
abgelehnt, und umgekehrt verlangt ein Thinking-Modell das Feld in Nachrichten, die es nicht
haben. Deshalb löschen beide Befehle den Gesprächsverlauf und melden das sichtbar:

```
  ✔ Modell: deepseek-v4-flash
  ↺ Gesprächsverlauf zurückgesetzt (Modellwechsel).
```

Einstellungen und Bereiche bleiben dabei erhalten.

### `/temperature` — nur DeepSeek

`/temperature` gilt **nur für die DeepSeek-Modelle**. Die Anthropic-API lehnt `temperature`
mit HTTP 400 ab; bei aktivem Claude-Modell blendet die CLI den Befehl in `/help` aus und
meldet beim Aufruf „nicht verfügbar – nutze `/effort`". Die Denktiefe wird bei Claude über
`/effort` gesteuert (Stufen `low, medium, high, xhigh, max`); bei Fable ist Thinking immer an.

Bei DeepSeek gilt weiter: Die API nimmt `temperature` auch bei aktivem Thinking an, ohne
Fehler; ob der Wert dort wirkt, ist nicht zugesichert.

### `/model` — Kurznamen

Statt des vollen Namens gehen Kurznamen für das jeweils neueste/Standard-Modell des Anbieters:

| Kurzname | wählt |
|---|---|
| `/model deepseek` | `deepseek-v4-pro` |
| `/model opus` (auch `claude`) | `claude-opus-4-8` |
| `/model fable` | `claude-fable-5` |
| `/model qwen` | `qwen3.7-max` |

Gepflegt in `src/providers/capabilities.ts` (`MODELL_ALIASE`) — kommt ein neueres Modell dazu,
wird der Kurzname dort umgehängt.

### Tages-Token-Budget (`/budget`)

Ein Tageslimit **pro Anbieter** (nicht pro Modell): Claude teilt sich eine Quote über Opus
**und** Fable; Qwen (DashScope) und DeepSeek sind je eigene Konten. Die CLI **zählt** die
Tokens jedes Aufrufs (aus der `usage`-Angabe der API; beim Streaming via
`stream_options.include_usage`) und legt den Tagesstand in **`~/.leaven/usage.json`** ab.
Der Tag wird beim Datumswechsel automatisch zurückgesetzt; Limits bleiben erhalten.

```
/budget                       Stand + Auto-Stopp anzeigen
/budget anthropic 500000      Tageslimit für Anthropic (0 = kein Limit)
/budget qwen 1000000
/budget deepseek 2000000
/budget auto on               Auto-Stopp AN – die Grenze wird erzwungen
/budget auto off              Auto-Stopp AUS – es wird nur gezählt, nie gestoppt
```

**Auto-Stopp** entscheidet, ob die Grenze *wirkt*: Ist er **an**, prüft die CLI vor jedem
API-Aufruf das Tagesbudget des aktiven Anbieters und **hält den Lauf an**, sobald es erreicht
ist. Ist er **aus** (Vorgabe), wird nur gezählt (sichtbar in `/budget` und `/status`), aber nie
gestoppt. Der Auto-Stopp-Zustand ist **persistent** (in `usage.json`) – er überlebt einen
Neustart.

### „weiter" — Aufgabe nach Auto-Stopp fortsetzen

Hält der Auto-Stopp mitten in einer Aufgabe an, **sichert** die CLI den vollständigen Zustand
(Nachrichten-History, Arbeitsplan, Modell/Thinking/Effort) nach **`~/.leaven/session.json`**.
Beim nächsten Start weist sie darauf hin:

```
⏸  Unterbrochene Aufgabe vom 2026-07-29: „lege drei Dateien an …"
    Tippe „weiter", um dort fortzusetzen (Modell: deepseek-v4-pro).
```

Ein `weiter` (auch `weitermachen`, `continue`, `continue working`) lädt den Stand und macht
**an derselben Aufgabe** weiter — mit demselben Modell (nötig für die `reasoning_content`-
Invariante). Am nächsten Tag ist das Budget frisch, der Lauf geht also durch. Ist die Aufgabe
fertig, wird die Session verworfen; wird sie erneut vom Budget gestoppt, wird sie neu gesichert.

**Wichtig zur Sicherheit:** `session.json` liegt in `~/.leaven` (Geheimnis-Sperrliste) – der
Assistent kann sie **nicht** lesen. Sie enthält die Konversation (inkl. gelesener
Datei-Inhalte); wurde mit `--allow-secrets` gearbeitet, kann Sensibles darin stehen. Löschbar
jederzeit. Ohne geladene Session ist „weiter" ein normaler Prompt ans Modell.

**Automatisch fortsetzen (`/resume`):** Statt „weiter" zu tippen, kann der Assistent beim Start
von selbst fortsetzen.

```
/resume auto on      automatisches Fortsetzen beim Start EINSCHALTEN (persistent)
/resume auto off     ausschalten (Vorgabe)
/resume              jetzt sofort fortsetzen (wie „weiter")
```

Ist `auto` an **und** liegt beim Start eine unterbrochene Aufgabe vor **und** das Tagesbudget
des Modells ist frei (neuer Tag), läuft der Assistent von selbst weiter. Wäre das Budget noch
erschöpft (gleicher Tag), setzt er **nicht** automatisch fort (das liefe sofort wieder in den
Stopp) — dann wartet er auf „weiter". Vorgabe ist **aus** (opt-in), der Schalter ist persistent
(in `usage.json`). Der Zustand steht in `/status` (`Auto-weiter an/aus`).

## Umgebungsvariablen

| Variable | Wirkung |
|---|---|
| `DEEPSEEK_API_KEY` | Pflicht für DeepSeek-Modelle |
| `ANTHROPIC_API_KEY` | Pflicht für Claude-Modelle (Opus/Fable) |
| `QWEN_API_KEY` / `DASHSCOPE_API_KEY` | Pflicht für Qwen (eine von beiden) |
| `DEEPSEEK_MODEL` | Modell, wird von `--model` überstimmt |
| `LEAVEN_AUTO_APPROVE=1` | wie `--yes` |
| `LEAVEN_API_ENDPOINT` | Sende-Ziel für `post_to_endpoint` |
| `LEAVEN_API_TOKEN` | wird als `Authorization: Bearer` mitgesendet |

## `config/commands.json`

Steuert die Befehlsfreigabe und die Geheimnis-Erkennung.

```jsonc
{
  "allowed": {
    "grep": { "forbidFlags": ["-S", "--devices", "-Z", "--null"] },
    "find": { "forbidFlags": ["-exec", "-delete", "-L", …] },
    …
  },
  "secretPatterns":    [".env", "*.pem", "id_rsa*", …],
  "secretDirectories": [".ssh", ".aws", ".gnupg", ".config/gcloud", ".leaven"]
}
```

`.leaven` steht auf der Liste, damit eine Rolle nicht die Konfiguration der anderen
Rollen lesen kann. Zwei lesende Ausnahmen — das eigene Rollenverzeichnis und Rollen mit
`rollenzugriff` — sind in [roles.md](./roles.md) beschrieben.

- `forbidFlags` — Optionen, die für dieses Programm gesperrt sind. Greifen **nur** bei
  Programmen, die auf der Allowlist stehen.
- `allowSubcommands` — optional; erstes Nicht-Options-Argument muss enthalten sein.
  Derzeit von keinem Eintrag genutzt (war für `git` gedacht).

**Bevor ein Programm aufgenommen wird:** prüfen, ob es Konfiguration aus dem
Arbeitsverzeichnis lädt und daraus Programme starten kann. Genau deshalb steht `git`
nicht darauf — siehe
[security-projects/git-security-feature.md](./security-projects/git-security-feature.md).

## `config/loopBreaker.json`

```jsonc
{
  "consecutive_threshold": 5,     // gleicher Aufruf hintereinander
  "structural_detection": true,   // Retry-Sturm, Schwelle = threshold * 2
  "cycle_reps": 4,                // Wiederholungen eines Musters
  "cycle_max_period": 6,          // maximale Musterlänge
  "read_only_cycle_exempt": true, // reine Lesezyklen nicht blocken
  "max_tool_calls": 200,          // Budget-Backstop pro Sitzung
  "max_estimated_tokens": 0,      // 0 = aus
  "ignore_tools": ["list_files"]
}
```

Der Schlüssel `mode` in der Datei wird vom Code **nicht** ausgewertet — Überbleibsel.

Der Loop-Breaker blockt „weich": Der Grund geht als Werkzeugergebnis an das Modell zurück,
statt den Turn abzubrechen. So kann das Modell seinen Ansatz korrigieren.

### Budget-Backstop zur Laufzeit schalten (`/backstop`)

`max_tool_calls` ist der **Startwert** aus `config/loopBreaker.json` (Vorgabe 200; `0` = aus).
Er lässt sich pro Sitzung ohne Neustart umschalten:

```
/backstop            Stand + Verbrauch anzeigen
/backstop off        Backstop aus – kein Tool-Call-Limit mehr
/backstop on         Backstop wieder an (Startwert aus der Config, sonst 9999)
/backstop 500        eigenes Limit setzen (0 = aus)
```

Das betrifft **nur** die harte Obergrenze („💥 Budget-Backstop … erreicht"). Die
Loop-, Retry-Sturm- und Zyklus-Erkennung bleiben immer aktiv. Die Umschaltung gilt für die
laufende Sitzung; beim nächsten Start greift wieder der Config-Wert. `/status` zeigt den
aktuellen Zustand.

## Bauen und Testen

```bash
npm run typecheck    # tsc --noEmit
npm run build        # tsc -> dist/
npm test             # Build + 75 Guard- + 13 Logik- + 31 URL-Prüfungen
```

`npm test` läuft ohne API-Zugriff und kostet nichts. Einzelheiten in
[testing.md](./testing.md).

## TypeScript-Aufbau

`tsconfig.json`: Ziel ES2020, Module **CommonJS**, `strict: true`,
`resolveJsonModule: false`. Die Konfigurationsdateien werden per `require()` geladen — das
funktioniert wegen CommonJS. Die `.js`-Endungen in den Imports sind für den CJS-Output
unschädlich.

Wer auf ESM umstellt, muss `require()` für die JSON-Dateien ersetzen.
