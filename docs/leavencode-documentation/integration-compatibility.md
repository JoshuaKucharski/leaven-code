# leavencode – Integration in eigene UI-Systeme, Kompatibilität und Perspektive

**Stand:** 2026-11-02 · Belegt am Code von leavencode (`src/index.ts`, `src/board.ts`) und der Leaven-Plattform (`../leaven/app/Services/LaunchCommandBuilder.php`, `MacTerminalLauncher.php`, `ClaudeSettingsWriter.php`, `app/Http/Controllers/Api/TaskStatusController.php`, `app/Services/TaskStatusProcessor.php`, `app/Livewire/Tasks/TaskBoard.php`).

Drei Fragen beantwortet dieses Dokument: **Was funktioniert heute nachweislich** zwischen einer Web-Oberfläche und der Terminal-KI? **Welche Schnittstellen** bietet leavencode einem selbst entwickelten UI-System? Und **was lässt sich daraus** perspektivisch an Agenten-Pipelines mit interaktivem Interface bauen?

---

## 1. Was heute nachweislich funktioniert

Die Leaven-Plattform (Laravel 12, Livewire 3) startet leavencode aus dem Browser heraus und bekommt während der Arbeit Statusmeldungen zurück. Der Kreislauf ist gebaut, getestet und live beobachtet (Handover 2026-08-08: „5 Feature(s) auf ‚in Arbeit' gemeldet").

### Ablauf

```
Browser (/agents/<profil>)            Laravel (leaven)                         Terminal.app                 leavencode             Board (/board)
 │ „Im Terminal starten"                │                                        │                            │                       │
 ├──────────────────────────────────────▶ AgentShow::launch()                     │                            │                       │
 │                                      ├─ Vorbedingungen: Anchor, Workdir, Token-Datei                       │                       │
 │                                      ├─ ClaudeSettingsWriter::provision()                                  │                       │
 │                                      │    schreibt <workdir>/.leaven/INITIAL_PROMPT.md (+ .claude/*, CLAUDE.md)                    │
 │                                      ├─ LaunchCommandBuilder::buildCommandString()                         │                       │
 │                                      ├─ MacTerminalLauncher::launch()  ── osascript ─▶ öffnet Fenster,       │                       │
 │                                      │                                                 führt Befehl aus ──▶ leaven -y --model … --prompt-file …
 │                                      ├─ AgentSession „launched" ins Logbuch           │                    ├─ liest Prompt-Datei   │
 │                                      │                                                 │                    ├─ meldet in_progress ──▶ Karte „in Arbeit"
 │                                      │                                                 │                    ├─ update_plan → „Schritt n/m" ─▶ Notiz + Badge
 │                                      │                                                 │                    ├─ arbeitet (Werkzeuge im Workdir)
 │                                      │                                                 │                    └─ Abschluss → done ──▶ Karte amber „done"
 │ Board pollt alle ~10 s (wire:poll) ◀─────────────────────────────────────────────────────────────────────────────────────────────── │
 │ Mensch bestätigt „done" → grün                                                                                                       │
```

### Der erzeugte Startbefehl

```bash
cd '<workdir>' \
 && export LEAVEN_BUCKET_TOKEN=$(cat ~/.leaven/tokens/<bucket-slug>) \
 && export LEAVEN_BUCKET_SLUG='<bucket-slug>' \
 && export LEAVEN_BOARD_URL='https://leaven.test' \
 && leaven -y --model '<modell>' --prompt-file '.leaven/INITIAL_PROMPT.md'
```

Entscheidende Konstruktionsmerkmale:

- **Der Auftrag läuft nie durch Shell- oder AppleScript-Quoting.** Der mehrzeilige Prompt steht in einer Datei; übergeben wird nur der Pfad (`prompt_mode=file`; `stdin` und `arg` sind als Alternativen konfigurierbar).
- **Der Token steht nie im Befehl, nie im Repo, nie im Browser.** Er liegt lokal unter `~/.leaven/tokens/<slug>` (Datei-Inhalt = Token, `chmod 600`); die Plattform speichert nur den sha256-Hash. Die CLI meldet selbst (`board.ts`), das Modell bekommt den Token nicht zu sehen (`scrubEnvironment`, `~/.leaven` gesperrt).
- **Die Prompt-Datei liegt im gesperrten `.leaven`-Ordner.** Die CLI liest sie direkt beim Start; die Werkzeuge des Modells können sie nicht öffnen oder verändern.
- **Automatisch angehängte „Meldepflicht"-Fußzeile** im Prompt (für den prompt-getriebenen Weg mit `curl`) ist mit leavencode wirkungslos – es gibt keine Shell, `curl` steht nicht auf der Allowlist, `$LEAVEN_BUCKET_TOKEN` wird nicht expandiert. Deshalb meldet die CLI selbst (§F-Kontrakt in `../leaven/docs/CLI_TASK_CONTRACT.md`).

### Der Board-Kontrakt (CLI → Plattform)

`POST {LEAVEN_BOARD_URL}/api/v1/buckets/{slug}/tasks`, `Authorization: Bearer <token>`, Body `{"updates":[{"feature":"<term-slug>","status":"in_progress|done","note":"…"}]}`. Vorher `GET …/buckets/{slug}` zur Ermittlung der „übernommenen Features" (Terms mit TaskCard, Tier gesetzt, nicht `done`).

| Zeitpunkt | Meldung | Wirkung im Board |
|---|---|---|
| Start des Launcher-Auftrags | `in_progress` je Feature | Karte springt von `open` auf „in Arbeit" |
| jedes `update_plan` | `in_progress` mit `note` „Schritt n/m: <Titel>" | Heartbeat: `status_note` und `last_heartbeat_at`, Badge `n/m`, „zuletzt gemeldet vor X min"; kein Event |
| echter Abschluss (`'fertig'`) | `done` | Karte amber, unbestätigt – ein Mensch bestätigt |
| Budget-Stopp, Schrittlimit, Fehler, Abbruch | nichts | Karte bleibt `in_progress`; ohne Heartbeat > 10 min zeigt das Board „stale" |

Plattformregeln, die dabei gelten: Bucket braucht `write_enabled`; die API legt nie Karten an; `tier_unassigned` wird abgelehnt; Übergänge `open→in_progress`, `in_progress→done|blocked|open`, `blocked→in_progress|open`; `done` ist für die API terminal; ein Agenten-`done` ist eine Meldung, keine Wahrheit. Rate-Limit 60 Anfragen je Minute und Token.

### Grenzen des heutigen Stands

| Grenze | Folge |
|---|---|
| **Einbahnstraße während des Laufs** | Die Web-UI sieht Status und Notizen, aber keine Ausgabe, keine Zwischenfragen, keine Freigaben; sie kann den Lauf nicht stoppen oder lenken |
| **`-y` im Launcher** | alles ohne Rückfrage, Shell frei, Bereiche = Arbeitsverzeichnis; ein Headless-Modus mit Profilrechten ist spezifiziert, nicht gebaut |
| **Session-Pings fehlen** | `started`/`ended` an `/api/v1/agent-sessions/ping` kommen aus Claude-Code-Hooks, die leavencode nicht ausführt → Logbuch bleibt auf `launched`, verwaiste Karten werden beim Sitzungsende nicht zurückgesetzt |
| **Terminal-Start nur macOS** | `MacTerminalLauncher` wirft auf anderen Systemen und verweist auf „Befehl kopieren" |
| **Modell-Liste doppelt** | leavencode hat kein `models`-Kommando; die Plattform pflegt die IDs statisch in `config/leaven.php` |

---

## 2. Schnittstellen-Katalog für eigene UI-Systeme

Alles, woran ein selbst entwickeltes System andocken kann – unabhängig von Laravel.

### 2.1 Prozess-Schnittstelle

| Kanal | Verhalten |
|---|---|
| **Flags** | `-y`, `--model`, `--no-thinking`, `--effort`, `--read-root`, `--write-root a,b`, `--verbose`/`--quiet`, `--allow-secrets`, `--prompt-file`, `--help`, `--version` |
| **Umgebung** | Schlüssel (`DEEPSEEK_API_KEY`, `ANTHROPIC_API_KEY`, `QWEN_API_KEY`), `LEAVEN_AUTO_APPROVE=1`, `LEAVEN_API_ENDPOINT`/`LEAVEN_API_TOKEN`, `LEAVEN_BUCKET_SLUG`/`LEAVEN_BUCKET_TOKEN`/`LEAVEN_BOARD_URL`, `DEEPSEEK_MODEL` |
| **stdin** | im Terminal: Zeilen innerhalb von 120 ms = ein Auftrag; über eine Pipe: **jede Zeile ein Auftrag**, `exit`/`quit`/`q` beendet, EOF beendet nach Abarbeitung der gepufferten Zeilen |
| **stdout** | menschenlesbarer Text mit ANSI-Farben; ohne TTY keine Spinner-Animation, keine Linien, keine Dialoge; blockierte/abgelehnte Aktionen immer sichtbar; `--quiet` reduziert auf Endergebnis + Aktionsbericht |
| **TTY-Abhängigkeit** | Freigabe-Dialog und Checkbox brauchen ein TTY. Ohne TTY werden **schreibende Aufrufe ohne Freigabe übersprungen** (mit Warnung) – unbeaufsichtigt also nur mit `-y` oder mit einem PTY |
| **Exit-Codes** | 1 bei nicht existierenden `--read-root`/`--write-root`; sonst 0 – ein fehlgeschlagener Auftrag ist am Exit-Code **nicht** erkennbar (Ausgabe oder Board auswerten) |
| **Kein Daemon** | kein Port, kein Socket, keine Steuerung von außen während des Laufs |

### 2.2 Ausgehende HTTP-Kanäle

| Kanal | Wer löst aus | Freigabe | Format |
|---|---|---|---|
| Board-Statusmeldung | die CLI, automatisch | keine | siehe Abschnitt 1 |
| `post_to_endpoint` | das Modell | **immer** Dialog (interaktiv) bzw. `-y` | `POST <endpoint>`, `Content-Type: application/json`, `User-Agent: leaven-cli`, `Authorization: Bearer <LEAVEN_API_TOKEN>`, Body = `payload`-Objekt des Modells; https-Pflicht, keine Weiterleitungen, Antwort bis 100 KB, ans Modell gekürzt auf 2 000 Zeichen |
| `fetch_url` | das Modell | Leserecht + Domain-Allowlist | GET, Text zurück ans Modell |

Pflichten der Gegenstelle (aus `docs/sourdough-api-endpoint-usage.md`): authentifizieren, Schema prüfen (der Body stammt aus einem Sprachmodell), Größe begrenzen, nichts ungefiltert anzeigen, keine 3xx-Antworten, Ratenbegrenzung. Referenzimplementierungen in Express und Laravel stehen dort.

### 2.3 Dateien als Schnittstelle

| Pfad | Richtung | Nutzen für ein UI |
|---|---|---|
| `<workdir>/.leaven/INITIAL_PROMPT.md` | UI → CLI | Auftragsübergabe ohne Quoting; idempotent überschreiben, leer = löschen |
| `~/.leaven/requested-commands/*.json` (+ `.sh`) | CLI → Mensch/UI | **Vorschlags-Eingang**: ein UI kann die Vorschläge anzeigen (`name`, `kind`, `command`, `reason`, `vorgeschlagen_am`) und per Klick freigeben = Zeile in `allowed-commands.json` eintragen bzw. Skript nach `approved-scripts/` verschieben |
| `~/.leaven/allowed-commands.json`, `approved-scripts/` | Mensch/UI → CLI | Registry; wird **beim Start** geladen (laufende Sitzung sieht Änderungen nicht) |
| `~/.leaven/usage.json` | CLI → UI | Tagesverbrauch je Anbieter, Limits, Schalter – für Budget-Anzeigen |
| `~/.leaven/session.json` | CLI → UI | gesicherte Aufgabe (Label, Datum, Modell) – für „Fortsetzen"-Hinweise; **enthält die Konversation**, nicht ins Netz geben |
| `~/.leaven/scopes.json`, `roles.json`, `roles/.<name>/onboarding.md` | beidseitig | ein UI kann Rollen anlegen und Onboarding-Texte pflegen; die CLI liest sie beim Aktivieren |
| `~/.leaven/tokens/<slug>` | UI-Konvention | Ablage der Bucket-Tokens, die der Launcher in die Umgebung exportiert |

### 2.4 Was es (noch) nicht gibt

Keine eingehende API, kein maschinenlesbarer Ausgabemodus (JSON-Zeilen), kein Ereignisstrom, keine Sitzungs-Kennung, kein Fragen/Antworten-Kanal, kein Abbruch von außen, kein Modell-Listing. Jede davon ist in [open-work.md](./open-work.md) (A1–A8) beschrieben; der Entwurf steht in `docs/sourdough-platform-connect/api-docs.md`.

---

## 3. Kompatibilität

| Gegenstand | Stand |
|---|---|
| **`CLAUDE.md`** im Projekt | wird **nicht** gelesen (die Plattform schreibt es für Claude Code; leavencode ignoriert es) |
| **`.claude/settings.local.json`** (permissions, hooks) | nicht gelesen, Hooks nicht ausgeführt |
| **`.claude/agents/<rolle>.md`** | nicht gelesen; Entsprechung in leavencode ist `~/.leaven/roles/.<name>/onboarding.md` |
| **MCP-Server, Subagenten, Plugins, Skills** | nicht unterstützt |
| **Claude-Code-Flags** (`--permission-mode`, `--allowedTools`, `-p`) | nicht vorhanden; Entsprechungen: `-y`, `--read-root`/`--write-root`, Registry; nicht-interaktiv = Pipe + `-y` |
| **Loop-Breaker-Plugin** (`loop-breaker/`) | Claude-Code-Plugin, läuft **nicht** in leavencode; leavencode hat die Logik nativ in `src/guards/loopBreaker.ts` |
| **OpenAI-kompatible Provider** (lokale Server, EU-Hosting, andere Anbieter) | passen auf den DeepSeek-/Qwen-Pfad: Basis-URL, Schlüssel und Fähigkeiten in `capabilities.ts` eintragen, kein SDK nötig |
| **Anthropic-artige Provider** | eigener Adapter wie `anthropic.ts` |
| **macOS** | entwickelt und betrieben (Terminal.app, zsh); Launcher per osascript |
| **Linux** | CLI lauffähig (reines Node), ungetestet; Launcher muss den Befehl anders starten (tmux, Terminal-Emulator, PTY); `grep -R` zusätzlich sperren |
| **Windows** | nicht vorgesehen |
| **tmux / screen / iTerm / Terminal.app** | funktionieren (TTY vorhanden) |
| **CI / Cron** | nur mit `-y` sinnvoll; Ausgabe mitschneiden; Board als Statusquelle |
| **Leaven-Plattform** | Bucket-Token-Middleware (sha256-Bearer), `write_enabled`, Tiers, `wire:poll` ~10 s – alles ohne Websockets |

---

## 4. Integrationsmuster – wie man es anbindet

### 4.1 Start aus einer eigenen Web-Oberfläche

1. Vorbedingungen prüfen: Arbeitsverzeichnis existiert, Token-Datei vorhanden, Schlüssel in der Umgebung des zu startenden Prozesses.
2. Auftrag als Datei schreiben (`<workdir>/.leaven/INITIAL_PROMPT.md`), nie als Shell-Argument.
3. Befehl bauen – Werte **escaped**, Token aus Datei: wie in Abschnitt 1.
4. Sichtbar starten: macOS per `osascript` (`tell application "Terminal" to do script "…"`, Argument-Array, kein Shell-String; einmalige Automation-Berechtigung nötig); Linux per `tmux new-window -d '…'` oder `x-terminal-emulator -e …`; oder unsichtbar in einem PTY (4.2).
5. Session protokollieren (`launched`) und den Board-Kanal (`LEAVEN_BUCKET_*`) als Rückmeldung nutzen.

### 4.2 Web-Terminal: volle Interaktion im Browser

Für „mit dem Terminal-Assistenten über eine Weboberfläche kommunizieren" ist das der direkte Weg: ein **Pseudo-Terminal** auf dem Server (`node-pty`) mit `xterm.js` im Browser (fertige Varianten: `ttyd`, `gotty`, `wetty`). Weil ein PTY ein echtes TTY ist, funktionieren Freigabe-Dialog, Checkbox-Auswahl, Live-Gedankenstrom und Paste-Zusammenfassung unverändert – der Mensch gibt Werkzeugaufrufe im Browser frei und stellt Folgeaufträge, ohne `-y`.

```js
// Skizze: ein PTY je Sitzung, über WebSocket an xterm.js
import pty from 'node-pty';
const sitzung = pty.spawn('leaven', ['--read-root', workdir, '--write-root', workdir, '--model', modell], {
  cwd: workdir, env: { ...process.env, LEAVEN_BUCKET_SLUG: slug, LEAVEN_BUCKET_TOKEN: token, LEAVEN_BOARD_URL: boardUrl },
});
sitzung.onData(chunk => ws.send(chunk));      // Terminal-Ausgabe → Browser
ws.on('message', keys => sitzung.write(keys)); // Tastatur ← Browser
```

Sicherheitsregeln dafür: nur an `localhost` binden oder hinter Authentifizierung; ein PTY je Benutzer und Sitzung; die Schlüssel in die Umgebung des PTY, nie in den Browser; die Guards der CLI gelten unverändert – das Web-Terminal fügt keine Rechte hinzu.

### 4.3 Headless-Schritt in einer Pipeline (heute)

```bash
leaven -y --quiet --model deepseek-v4-flash \
  --read-root /srv/projekt --write-root /srv/projekt/app \
  --prompt-file /srv/projekt/.leaven/INITIAL_PROMPT.md < /dev/null > lauf.log 2>&1
```

Bis der Headless-Modus existiert, bedeutet `-y` volle Rechte. Milderung: engen `--read-root`/`--write-root`, eigener Benutzer oder Container, `--quiet`, Ausgabe mitschneiden, Board als Statusquelle, Tagesbudget mit Auto-Stopp (`/budget auto on` einmal interaktiv setzen – persistent). Kein Exit-Code für „Aufgabe gescheitert" – den Bericht auswerten.

### 4.4 Ergebnisse empfangen

- **Board**: Status, Notizen, Abschluss (Abschnitt 1).
- **`post_to_endpoint`**: strukturierte Ergebnisse, vom Modell gebaut – mit Schema-Validierung auf der Gegenstelle; interaktiv mit Freigabe, headless automatisch.
- **Artefakte**: alles, was im Schreibbereich entsteht; ein UI kann den Bereich nach dem Lauf lesen.
- **Mitschnitt**: `stdout` – der Aktionsbericht am Ende listet jede ausgeführte, abgelehnte oder blockierte Aktion.

### 4.5 Vorschläge im UI freigeben

Ein kleines, sofort nützliches UI-Feature: Die Einträge aus `~/.leaven/requested-commands/` als Liste rendern (Name, Befehl oder Skriptinhalt, Begründung, Datum), ein Mensch klickt „freigeben" → das UI trägt die exakte Zeile in `~/.leaven/allowed-commands.json` ein bzw. verschiebt die `.sh` nach `~/.leaven/approved-scripts/` und trägt `bash ~/.leaven/approved-scripts/<name>.sh` ein. Beim nächsten CLI-Start läuft der Befehl ohne Rückfrage. Die Sicherheitsregel bleibt gewahrt: Die Freigabe erteilt ein Mensch, der Assistent kann nur vorschlagen.

### 4.6 Lenken während des Laufs

Heute nur über das Terminal: Nach Abschluss eines Turns nimmt die CLI den nächsten Auftrag entgegen (Eingabewarteschlange); ein Web-Terminal (4.2) reicht ihn durch. Ein Stopp oder eine Freigabe „von außen" braucht den Rückkanal aus der Spezifikation (Abschnitt 5).

---

## 5. Perspektive: Agenten-Pipelines mit interaktivem Interface

### 5.1 Zielbild

```
┌──────────────── Web-UI (Livewire oder beliebig) ────────────────┐
│ Profile · Aufträge · Live-Plan ▰▰▱▱ · Aktionslog · Freigabe-   │
│ Karten · Chat-Eingabe · Budget · Sitzungen · Vorschlags-Eingang │
└───────────────▲───────────────────────────────▲─────────────────┘
                │ Ereignisse (POST /events)      │ Fragen/Antworten (POST /fragen, GET /fragen/{id})
┌───────────────┴───────────────────────────────┴─────────────────┐
│ Orchestrator / Session-Daemon (Node): startet Worker, hält      │
│ Sitzungs-IDs, Budgets, Zeitlimits, Audit-Log, Warteschlangen     │
└──────┬──────────────────┬──────────────────┬─────────────────────┘
       │ PTY oder headless│                  │
   leaven #1          leaven #2          leaven #3      ← je Profil: Rolle, Bucket, Bereiche, Rechte, Modell
   (Architekt)        (Implementierer)   (Reviewer)
       └────────── Buckets = gemeinsames Vokabular · TaskCards = Zustandsmaschine ──────────┘
```

### 5.2 Das Protokoll (Entwurf aus `docs/sourdough-platform-connect/api-docs.md`, erweitert)

**Ereignisse** (`POST {endpoint}/events`, ohne Freigabe, 2–3 s Timeout, Fehler still, nie blockierend):

```jsonc
{ "typ": "plan.aktualisiert", "sitzung": "01JD7…", "zeit": "2026-11-02T10:12:00Z", "rolle": "implementierer",
  "plan": { "gesamt": 6, "abgeschlossen": 3, "schritte": [ { "titel": "…", "status": "laeuft" } ] },
  "schritte_verbraucht": 17 }
```

Typen: `sitzung.start`, `auftrag.start`, `plan.aktualisiert`, `schritt.ausgefuehrt` (mit `werkzeug`, `ziel`, `ergebnis` ok|fehler|abgelehnt|blockiert), `auftrag.ende` (mit Abschlusstext und Aktionsliste), `sitzung.ende`.

**Fragen** (`POST {endpoint}/fragen`, dann `GET {endpoint}/fragen/{frage_id}` alle 3 s, Zeitlimit z. B. 900 s → `stopp`):

| Frage-Typ | Wann | Antwort |
|---|---|---|
| `weiterarbeiten` | Schrittgrenze erreicht | `weiter` · `stopp` · `warten` |
| `freigabe` (Erweiterung) | Werkzeugaufrufe, die ein Mensch sehen soll – derselbe Inhalt wie der Terminal-Dialog: Werkzeug, Argumente, Begründung | Liste freigegebener IDs, `stopp`, `warten` |
| `rueckfrage` (Erweiterung) | das Modell stellt eine Frage | Freitext |

Regeln, die aus der Spezifikation übernommen werden: Antworten sind an eine `frage_id` gebunden und einmalig; **nur** das Feld `antwort` wird gelesen – ein `rechte`-Feld in einer Antwort ändert nichts; bei Unklarheit, Zeitüberschreitung oder unbekannter Frage gilt `stopp`; nur die konfigurierte Adresse, https, keine Weiterleitungen.

**Headless** (`--headless`): keine Dialoge; nicht freigegebene Werkzeuge werden abgelehnt statt erfragt – oder, mit Rückkanal, als `freigabe`-Frage an das UI gegeben. Rechte kommen **einmalig** beim Start aus dem Profil; `~/.leaven/platform-limits.json` begrenzt lokal, was eine Plattform höchstens vergeben darf.

**Tokens:** getrennt für Empfang (Ereignisse) und Steuerung (Auftragsstart, Antworten) – ein Leck im Empfangsteil darf keine Steuerung bedeuten.

### 5.3 UI-Bausteine, die daraus entstehen

| Baustein | Quelle | Bemerkung |
|---|---|---|
| Live-Plan mit Balken `3/6` | `plan.aktualisiert` | bewusst kein Prozentwert – der Nenner wächst |
| Aktionslog | `schritt.ausgefuehrt` | Werkzeug, Ziel, Ergebnis; Grundlage für Audit und Replay |
| Freigabe-Karten | `fragen` vom Typ `freigabe` | der Terminal-Dialog im Browser; Begründung anzeigen, nicht nur den Befehl |
| Chat-Eingabe | Warteschlange des Orchestrators → nächste Nutzer-Nachricht der CLI | Folgeaufträge zwischen Turns; „weiter" nach Budget-Stopp |
| Budget-Anzeigen | `usage.json` bzw. Ereignisse mit `usage` | je Anbieter, je Sitzung, je Pipeline |
| Sitzungsliste | `sitzung.start`/`.ende`, Session-Logbuch | mehrere parallele Läufe mit Kennung |
| Vorschlags-Eingang | `requested-commands/` | Freigabe per Klick (4.5) |
| Profil-Editor | `--read-root`, `--write-root`, Rechte, Modell, Domains, Rolle | heute: Agent-Profile der Plattform |

### 5.4 Pipelines

Eine Pipeline ist eine Folge von Agent-Profilen über derselben Zustandsmaschine, die es schon gibt – den TaskCards (`open → in_progress → done → bestätigt`):

1. **Architekt** (Rolle, Lesen breit, Schreiben nur `docs/`) erzeugt Plan und Schnittstellen → `done` → Mensch bestätigt.
2. **Implementierer** (Lesen Projekt, Schreiben `app/`, Registry mit `php -l`, Build-Befehl) setzt um → `done` → Review-Stufe.
3. **Reviewer** (Lesen Projekt, Schreiben nichts, anderes Modell) prüft; eine beanstandete Karte geht zurück auf `in_progress` (Human-Review-Feature, offen).

Was die vorhandene Konstruktion dafür bereits liefert: Rollen als Rechteprofile, Buckets als gemeinsames Vokabular (jede Stufe spricht dieselben Begriffe), das Board als Sichtbarkeit und menschliches Tor, Loop-Breaker und Budget als Schutz je Lauf, `propose_command` als Lernschleife für wiederkehrende Prüfläufe. Modell-Routing je Stufe liegt nahe – günstige Modelle für Gerüstarbeit, Opus oder Fable für Review; genau so wurde leavencode selbst entwickelt („Fable-Subagent als Reviewer fand mehrfach echte Bugs"). Übergaben zwischen Stufen laufen über den Schreibbereich (Artefakte), `post_to_endpoint` (strukturierte Ergebnisse) oder die Buckets (Begriffe). Parallele Läufe werden durch Sitzungs-Kennungen getrennt; je Lauf ein Budget und ein Zeitlimit.

**Verfassungsregel der Plattform, die jede Pipeline einhält:** Ein `done` kommt nie aus Schrittzählung, Exit-Codes oder Testläufen, sondern aus einer expliziten Meldung – und bestätigt wird von Menschen.

### 5.5 Invarianten für jede Erweiterung

- Rechte werden **vor** dem Auftrag gesetzt, nie während des Laufs erweitert – die Kette „Seite abrufen → Injektion → Rechte anfordern → gewährt" bleibt geschlossen.
- Der Steuerungs-Token ist ein Generalschlüssel für den Entwicklungsrechner: getrennt vom Empfangs-Token, nur in der Umgebung, regelmäßig wechseln, Plattform mit Zwei-Faktor-Anmeldung.
- Genau eine Plattform-Adresse, https, keine Weiterleitungen; unbekannte Felder in Antworten werden ignoriert.
- Keine Shell, `~/.leaven` bleibt AI-dicht, Freigaben erteilt ein Mensch.
- Bei Zeitüberschreitung oder Unklarheit: `stopp`, nie weiterarbeiten. Der Verlauf bleibt erhalten; Fortsetzen ist jederzeit möglich.

### 5.6 Stufenplan

| Stufe | Baut | Ergebnis |
|---|---|---|
| **1 – Lücken schließen** | Session-Pings aus der CLI, `models`-Kommando, Audit-Log, Headless-Modus mit Profilrechten | Launcher ohne `-y`, konsistentes Logbuch, nachvollziehbare Läufe |
| **2 – Sprechen und Hören** | Ereignis-Versand, Fragen-Kanal mit `freigabe`, Web-Terminal (PTY) | Freigaben, Plan, Aktionen und Folgeaufträge im Browser; Linux-tauglicher Start |
| **3 – Orchestrieren** | Session-Daemon mit Sitzungs-IDs, Warteschlangen, Budgets je Lauf, Modell-Routing, Human-Review auf dem Board, Replay aus dem Audit-Log | mehrstufige Pipelines mit menschlichen Toren, parallel, überwacht |

Die Reihenfolge ist so gewählt, dass jede Stufe für sich nützlich ist und keine die Sicherheitsinvarianten lockert.

---

## 6. Verwandte Dokumente

`docs/sourdough-platform-connect/api-docs.md` (Spezifikation von Ereignissen, Rückkanal, Headless, Gegenstelle) · `docs/sourdough-api-endpoint-usage.md` (`post_to_endpoint`, Pflichten der Gegenstelle) · `docs/internet.md` (Netzgrundlagen) · `../leaven/docs/AGENTS.md`, `../leaven/docs/API.md`, `../leaven/docs/CLI_TASK_CONTRACT.md` (Plattformseite) · `active-order-prompt/` (die Aufträge, mit denen Launcher-Anbindung und Board-Kreislauf gebaut wurden).
