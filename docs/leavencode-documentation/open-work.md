# leavencode – Offene Weiterentwicklungen

**Stand:** 2026-11-02 · Zusammengeführt aus `docs/leaven-cli/upcoming-tasks.md`, `docs/security/leaven-cli-critical-issues.md`, `docs/leaven-platform-connect/api-docs.md`, den Handover-Dokumenten und einer eigenen Prüfung des Codes an diesem Tag. Jeder Punkt nennt Stand, Umfang und Fundstelle. Reihenfolge innerhalb der Abschnitte nach Nutzen.

Legende Umfang: **S** = Stunden · **M** = ein bis wenige Tage · **L** = eigene Arbeitseinheit mit Tests.

---

## A. Plattform, Pipeline, Fernsteuerung

| # | Aufgabe | Stand | Umfang | Fundstelle |
|---|---|---|---|---|
| A1 | **Headless-Modus** (`--headless`): keine Dialoge, nicht freigegebene Werkzeuge werden **abgelehnt statt erfragt**; Rechte kommen einmalig aus dem Profil/Auftrag. Ersetzt das heutige `-y` des Launchers, das pauschal alles freigibt | spezifiziert, nicht gebaut | M | `docs/leaven-platform-connect/api-docs.md` §5 |
| A2 | **Ereignis-Versand** an die Plattform: `sitzung.start`, `auftrag.start`, `plan.aktualisiert`, `schritt.ausgefuehrt`, `auftrag.ende`, `sitzung.ende` – eigener Weg neben `post_to_endpoint`, ohne Freigabe, kurzes Timeout, Fehler still | spezifiziert; heute gibt es nur die Board-Statusmeldung in `board.ts` | M | dito §2, §7 |
| A3 | **Rückkanal** („Fragen"): CLI stellt eine Frage mit `frage_id`, pollt die Antwort (`weiter` / `stopp` / `warten`), Zeitüberschreitung → `stopp`; nur das Feld `antwort` wird gelesen, nie Rechte | spezifiziert, nicht gebaut | M–L | dito §3, §4 |
| A4 | **Freigabe im Browser**: den Freigabe-Dialog als Frage-Typ über den Rückkanal abbilden, damit ein Mensch Werkzeugaufrufe aus der Web-UI heraus freigibt statt im Terminal | Idee, folgt aus A3 | M | [integration-compatibility.md](./integration-compatibility.md) |
| A5 | **Session-Pings aus der CLI** (`started`/`ended` an `POST /api/v1/agent-sessions/ping`): Die Plattform erwartet sie von Claude-Code-Hooks in `.claude/settings.local.json`; leavencode führt diese Hooks nicht aus. Folge heute: Launcher-Sessions bleiben im Logbuch auf `launched`, und das Zurücksetzen verwaister `in_progress`-Karten beim `ended`-Ping greift nicht | Lücke, nicht dokumentiert gewesen | S | `../leaven/app/Services/ClaudeSettingsWriter.php` (`pingCommand`), `src/board.ts` |
| A6 | **Modell-Listing-Kommando** (`leaven models --json`): Die Plattform kann Modelle live von der CLI holen (`models_source=command`), pflegt sie mangels Kommando aber statisch in `config/leaven.php` | Plattform vorbereitet, CLI fehlt | S | `../leaven/app/Support/LeavenCli.php`, `src/providers/capabilities.ts` |
| A7 | **Getrennte Tokens** für Empfang (Ereignisse) und Steuerung (Auftragsstart, Rückkanal); **lokale Obergrenze** `~/.leaven/platform-limits.json` („nie Shell", „nie außerhalb ~/develop", „nie `--allow-secrets`") | spezifiziert | S–M | api-docs §4, §5 |
| A8 | **Sitzungs-Kennung** je CLI-Start und Iterationszähler nach außen (heute nur lokal in `runAgentTurn`) | offen | S | api-docs §7 |
| A9 | **Human-Review** auf dem Board: `approved` / `not approved` setzen und die Karte zurück auf `in_progress` schicken | Plattform-Seite, offen | M | `docs/handover/2026-08-08_1321_board-auto-done.md` |
| A10 | **Auto-`done` im interaktiven Chat** (heute nur Launcher- und Resume-Flow) | optional, eine Zeile | S | dito |
| A11 | **Web-Terminal** (xterm.js + node-pty oder ttyd) statt Terminal.app, plattformunabhängig und im Browser bedienbar | Idee | M | integration-compatibility.md |
| A12 | Der Bereich „Leavencode CLI UI" in der Laravel-App (`/leavencode-ui`) ist ein Platzhalter; die Seitenleiste verweist auf eine Route `leavencode-sessions.index`, die es nicht gibt | Stub | – | `../leaven/resources/views/partials/leavencode-ui-sidebar-content.blade.php` |

## B. Provider und Modelle

| # | Aufgabe | Stand | Umfang | Fundstelle |
|---|---|---|---|---|
| B1 | **Anthropic-Streaming (Phase 2)**: eigener Parser für `message_start` / `content_block_delta` / `thinking`-Deltas; Live-Reasoning und der Vertrag „vollständige Message oder Fehler" lassen sich aus `openaiStream.ts` übernehmen, der Parser nicht | offen; Opus/Fable laufen non-streaming mit 600 s Zeitlimit | M | `docs/providers.md`, `docs/leaven-cli/notes-for-next-assistant.md` §5 |
| B2 | **Lokales Modell** (Ollama, llama.cpp, EU-gehostetes Qwen) als vierter Provider – der einzige Weg, bei dem Gelesenes den Rechner nicht verlässt. OpenAI-kompatible Endpunkte passen auf den DeepSeek-Pfad | offen | M | critical-issues Punkt 1 |
| B3 | **Neuere Modell-IDs aufnehmen** (`claude-opus-5-5`, `claude-fable-5-1`): ein Upgrade mit Bruchstellen, kein Bugfix – Opus 5.5 lässt Thinking nicht mehr abschalten, Fable 5.1 verlangt einen nur angehängten Verlauf (das Kürzen der History bräche Thinking-Blöcke). Die heutigen IDs `claude-opus-5`, `claude-opus-4-8`, `claude-fable-5` sind gültig und werden bedient | geprüft 2026-11-02, Upgrade offen | M | `src/providers/capabilities.ts`, `src/history.ts` |
| B4 | **Qwen `include_usage`** im Stream live bestätigen (Budgetzählung) | zu verifizieren | S | upcoming-tasks |
| B5 | `stripReasoningOnSend` ist ein Sicherheitsventil ohne Nutzer; dokumentiert lassen oder entfernen | trivial | S | `capabilities.ts` |

## C. Sicherheit und Datenschutz

| # | Aufgabe | Stand | Umfang | Fundstelle |
|---|---|---|---|---|
| C1 | **git kontrolliert zurückholen** – fünf Bausteine, die zusammengehören: Härtungsflags (`--no-pager`, `--no-ext-diff`, `--no-textconv`) von der CLI injiziert, Umgebung (`GIT_CONFIG_NOSYSTEM`, `GIT_CONFIG_GLOBAL=/dev/null` …), Unterbefehl-Filter, Remote-Allowlist (Konfig **und** Argumente), Prüfung der `.git/config` auf `diff.external`, `core.pager`, `core.fsmonitor`, `credential.helper` … Nutzerwunsch: vorher besprechen, nicht eigenmächtig | geplant | L | `docs/security-projects/git-security-feature.md` |
| C4 | **Audit-Protokoll** `~/.leaven/audit.log`: Zeitstempel, Werkzeug, Argumente, Ergebnis, Freigabe-Entscheidung – auch Grundlage für A2 | offen | S | critical-issues Punkt 9 |
| C5 | **Prompt-Injection mildern**: abgerufene Inhalte als Daten kennzeichnen (eigener Block mit Hinweis), Schreibzugriffe in der Iteration **nach** einem `fetch_url` grundsätzlich mit Rückfrage | offen | S–M | critical-issues 8b |
| C6 | **DNS-Pinning** für `fetch_url`: selbst auflösen, IP gegen die Sperrliste prüfen, Verbindung an diese IP binden (`lookup`-Option) | offen | S | critical-issues 8d |
| C7 | **Inhaltsbasierte Geheimnis-Erkennung** (Schlüssel-/Token-Muster im Dateiinhalt) zusätzlich zu Dateinamen; Warnung beim Start, welche sensiblen Dateien im Lesebereich liegen | offen | M | critical-issues Punkt 2 |
| C8 | **Lokale Zustandsdateien verschlüsseln** (`session.json` enthält die Konversation) | offen | M | privacy-relevant-issues |
| C9 | **Warnzeile beim Start unter `--yes`** | sehr klein | S | critical-issues Punkt 7 |
| C10 | **Egress-Kontrolle dokumentieren** (OS-Firewall nur auf erlaubte API-Hosts) | offen | S | security.md |
| C11 | **Ressourcengrenzen** für Kindprozesse (CPU, Speicher, Netz) – auf macOS umständlich; realistisch nur per Container/Sandbox | offen | L | critical-issues Punkt 10 |
| C12 | **Tippbestätigung** statt Enter bei destruktiven Befehlen (`rm -rf`, `git reset --hard`) gegen Dialog-Ermüdung | Idee | S | critical-issues Punkt 6 |

C2 (Pfade in Optionswerten) und C3 (GNU-Sperren, Flag-Bündel und -Abkürzungen) sind erledigt – Stand in [full-documentation.md](./full-documentation.md) §4.6.

## D. Bedienung und Robustheit

| # | Aufgabe | Stand | Umfang | Fundstelle |
|---|---|---|---|---|
| D1 | **Session bei `/exit` oder Strg-C sichern** – heute speichert nur der Budget-Auto-Stopp; `speichereSession` existiert bereits | offen, klein | S | upcoming-tasks |
| D2 | **Mehrere Sessions / pro Projekt** – „weiter" hat genau einen globalen Slot (`session.json`) | offen | S–M | upcoming-tasks |
| D3 | **SIGINT-Handler**: Strg-C soll den laufenden Turn abbrechen und die History reparieren, statt die CLI zu beenden | offen | S | `docs/configuration.md` |
| D4 | **Kontextverdichtung**: Die History wird ab 60 Nachrichten hart beschnitten, Werkzeugergebnisse bei 8 000 Zeichen – eine Zusammenfassung älterer Teile fehlt | offen | M | `src/history.ts` |
| D5 | **Schrittgrenze entscheiden**: `MAX_ITERATIONS` steht auf 99 999, der Haltepunkt „Weitere n Schritte?" ist damit außer Kraft (die Doku sagt das inzwischen so). Entscheiden: bewusst so lassen oder einen sinnvollen Wert konfigurierbar machen (`--max-steps`) | Entscheidung offen | S | `src/index.ts` |
| D6 | **Kostenanzeige in Währung** zusätzlich zu Tokens; Verbrauch je Sitzung, nicht nur je Tag | offen | S | `src/usage.ts` |
| D7 | **„Immer erlauben" im Dialog** als geführter Weg in die Registry (schreibt den Vorschlag, Mensch bestätigt im Terminal) | Idee | S | `confirmToolCalls` |
| D8 | **Diff-Vorschau** vor `edit_file`/`write_file` und ein Rückgängig | offen | M | – |
| D9 | **Bracketed Paste** | bewusst **nicht** gebaut (Nutzerentscheidung) | – | upcoming-tasks |
| D10 | Loop-Breaker-Parität mit der Python-Vorlage: `mode: warn|off`, Ausblenden flüchtiger Felder (UUIDs, Zeitstempel) beim strukturellen Vergleich; die Lese-Ausnahmeliste enthält noch Claude-Werkzeugnamen (`Read`) | offen | S | `src/guards/loopBreaker.ts` vs. `loop-breaker/hooks/loop_breaker.py` |

## E. Code-Hygiene, Doku, Verteilung

E1 (Repository), E2 (Links nach der Umbenennung) und E3 (driftende Zahlen in den lebenden Dokumenten) sind erledigt; die datierten Handover-Dateien bleiben bewusst Momentaufnahmen.

| # | Aufgabe | Stand | Umfang | Fundstelle |
|---|---|---|---|---|
| E4 | **Tote Dateien**: `src/index.ts.backup`, leeres `index.ts` im Wurzelverzeichnis, leere Ordner `skills/` und `src/include_functions/`, `.DS_Store`-Dateien | offen | S | – |
| E5 | **`ora` aus `package.json` entfernen** (ungenutzt) | offen | S | `package.json` |
| E6 | **`mode` in `config/loopBreaker.json`** auswerten oder entfernen | trivial | S | `src/index.ts` |
| E7 | **Modularisierung fortsetzen**: `securePath` → `src/security/pathGuard.ts`; `zustand` um `usageDaten`, `geladeneSession`, `internetDomains` erweitern; `executeTool` in `src/tools/*`; Slash-Befehle in `src/commands/*` | Plan liegt vor | M–L | `docs/handover/2026-08-04_1500_index-ts-modul-zerlegung.md` |
| E8 | **Paketierung**: `npm link`/globale Installation testen, `files`-Feld in `package.json`, ggf. npm-Veröffentlichung; README im Wurzelverzeichnis ist leer (`_README.md`) | offen | S | `package.json`, `_README.md` |
| E9 | **`~/.sourdough/`** – Altlast der Umbenennung, kann nach Prüfung gelöscht werden | lokal | S | – |

## F. Tests

| # | Aufgabe | Stand | Umfang |
|---|---|---|---|
| F1 | **End-to-End-Tests mit gemocktem HTTP** (Agent-Schleife, Freigabe, `securePath` im Echtlauf) statt nur reiner Funktionen – heute sind diese Prüfungen manuell und kostenpflichtig | offen | M |
| F2 | **Linux-CI** (GitHub Actions): Build, Typecheck, alle Suiten – der erste echte Linux-Lauf; prüft die GNU-Sperren (`grep -R`, `find -fprint0`) auf einem echten System | offen, naheliegend | S |
| F3 | Tests für A1–A3: Zeitüberschreitung führt zu `stopp`; Antwort ohne passende `frage_id` wird verworfen; ein `rechte`-Feld in einer Antwort erhöht nichts | offen, in der Spezifikation benannt | S |

---

## Nie ausgeführt

Die allererste Nutzeraufgabe (Footer, Brand-Titel und `.env`-Anpassungen in `~/develop/templates/julalo-ui-components`) wurde nie umgesetzt; die `.env`-Änderung bräuchte `--allow-secrets` und damit eine bewusste Entscheidung.

## Empfohlene Reihenfolge

1. C9, A5, A6, D1 – Warnzeile unter `--yes`, Session-Pings, Modell-Kommando, Session sichern (kleine Lücken mit sofortigem Nutzen für Launcher und Alltag).
2. F2 – Linux-CI, damit Build und GNU-Sperren auf einem zweiten System laufen.
3. A1 + A2 + C4 – Headless-Modus, Ereignisse, Audit: die Grundlage jeder Pipeline.
4. A3 + A4 – Rückkanal und Freigabe im Browser: ab hier ist leavencode aus einer Web-UI steuerbar.
5. B1, B2 – Streaming für Anthropic, lokales Modell.
6. C1 – git, als eigene Einheit, nach Absprache.
