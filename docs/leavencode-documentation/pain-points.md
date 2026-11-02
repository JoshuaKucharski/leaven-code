# leavencode – Pain Points gegenüber Claude Code

**Stand:** 2026-11-02 · Eine nüchterne Bestandsaufnahme dessen, was im Alltag mit leavencode heute weh tut, wenn man Claude Code gewohnt ist. Das Gegenstück – was leavencode besser macht – steht in [security-and-privacy.md](./security-and-privacy.md); die Abhilfen in [open-work.md](./open-work.md).

Zur Einordnung: Verglichen werden rund 5 000 Zeilen eigener Code mit einem Produkt, an dem ein Hersteller mit einem Team arbeitet. Die Liste ist deshalb lang, nicht weil leavencode schlecht wäre, sondern weil Claude Code viel kann. Jeder Punkt nennt, warum er schmerzt und wie schwer er wiegt (● gering · ●● spürbar · ●●● täglich).

---

## 1. Werkzeugumfang

| Gewicht | Pain Point | Warum es schmerzt |
|---|---|---|
| ●●● | **Keine Shell.** Keine Pipes, keine `&&`-Ketten, kein `cd`, keine Umleitung. `npm test 2>&1 \| tail -20` wird abgelehnt | Modelle sind auf Shell-Idiome trainiert und verbrauchen Fehlversuche; der Mensch muss umdenken. Sicherheitsgewinn, aber Komfortverlust |
| ●●● | **Jedes nicht lesende Programm fragt**: `npm`, `git` (auch `git status`), `php`, `node`, `python`, `composer`, `pint`, `phpunit` | Freigabe-Ermüdung; die Registry hilft, verlangt aber Hand-Editieren einer JSON-Datei in `~/.leaven` |
| ●● | **Kein „immer erlauben" im Dialog** – nur der Umweg über `propose_command` und manuelles Eintragen | Claude Code schreibt eine Allow-Regel mit einem Tastendruck |
| ●● | **Kein Glob-, Grep- oder Multi-Edit-Werkzeug** – Suchen laufen über `execute_command` mit `grep`/`find`/`rg` | funktioniert, aber jede Suche ist ein Prozessstart ohne strukturierte Ausgabe |
| ●● | **Keine Erweiterbarkeit**: keine MCP-Server, keine Subagenten, keine Hooks, keine Plugins, keine Skills, keine eigenen Slash-Befehle, keine Hintergrundaufgaben | Claude Code ist eine Plattform; leavencode ist ein Werkzeug mit festem Umfang |
| ●● | **Kein Projektgedächtnis à la `CLAUDE.md`**: leavencode liest weder `CLAUDE.md` noch `.claude/` – obwohl die Leaven-Plattform beides ins Arbeitsverzeichnis schreibt. Onboarding-Texte gibt es nur je Rolle, nicht je Projekt | Projektkonventionen muss man in Rollen oder in den Auftrag packen |
| ● | Keine Bilder, keine PDFs als Eingabe; keine Websuche (nur `fetch_url` auf freigegebene Domains) | – |

## 2. Kontext, Sitzungen, Gedächtnis

| Gewicht | Pain Point | Warum es schmerzt |
|---|---|---|
| ●●● | **Keine Kontextverdichtung**: Ab 60 Nachrichten wird die History hart abgeschnitten, Werkzeugergebnisse bei 8 000 Zeichen gekürzt | Bei langen Aufgaben vergisst der Agent, was er vor zehn Schritten gelesen hat; Claude Code komprimiert automatisch |
| ●●● | **Keine Sitzungsverwaltung**: kein `--resume`, keine Liste früherer Sitzungen, kein Fortsetzen nach `/exit` oder Strg-C. Gesichert wird nur beim Budget-Auto-Stopp, in **einem** globalen Slot | Ein versehentliches Strg-C kostet den ganzen Verlauf |
| ●● | **Modell- oder Thinking-Wechsel löscht den Verlauf** (Format-Invariante der Provider) | Man kann nicht mittendrin „mal Opus fragen" |
| ●● | **Strg-C beendet die CLI**, statt den laufenden Turn abzubrechen | kein kontrollierter Abbruch, kein Nachfragen |
| ● | Rollen sind global (`~/.leaven/roles.json`), nicht projektgebunden; Schreibbereiche werden immerhin je Lesebereich gemerkt | – |

## 3. Ausgabe und Geschwindigkeit

| Gewicht | Pain Point | Warum es schmerzt |
|---|---|---|
| ●●● | **Kein Live-Text**: Der Antworttext wird nie gestreamt, nur der graue Gedankenstrom (und der auch nur bei DeepSeek/Qwen). Bei Claude gar kein Streaming, Zeitlimit 600 s | Lange Pausen mit Spinner; Claude Code zeigt Text sofort |
| ●● | **Kein Diff** vor oder nach `edit_file`, keine farbige Vorschau, kein Rückgängig | Man sieht „1 Stelle ersetzt", nicht was |
| ●● | **Terminal-UI ist selbst gebaut** und erwiesenermaßen fragil: Raw-Modus, Listener sichern/wiederherstellen, Zeilen zählen für das Neuzeichnen – jede dieser Stellen hat schon eine Fehlersuche gekostet (`docs/troubleshooting.md`) | Jede UI-Änderung ist riskant |
| ● | Keine Statuszeile, keine Mehrzeilen-Eingabe mit Editor, Paste-Erkennung per 120-ms-Heuristik statt Bracketed Paste (bewusst) | – |
| ● | Kosten nur in Tokens je Tag, nie in Währung, nie je Sitzung | – |

## 4. Modelle

| Gewicht | Pain Point | Warum es schmerzt |
|---|---|---|
| ●● | **Standardmodell DeepSeek** mit schwächerem Werkzeug-Gehorsam als Claude (DSML-Fallback existiert aus gutem Grund) und Datenverarbeitung in China | Für Sensibles muss man aktiv umschalten |
| ●● | **Modell-IDs von Hand pflegen** an drei Stellen in `capabilities.ts`; falsche IDs geben HTTP 400 ohne hilfreiche Meldung | Claude Code kennt seine Modelle |
| ● | Fable: Thinking nicht abschaltbar, `refusal` möglich, 30-Tage-Retention vorausgesetzt | Besonderheiten des Modells, nicht der CLI |
| ● | Nur drei Anbieter, kein lokales Modell | – |

## 5. Plattform-Integration

| Gewicht | Pain Point | Warum es schmerzt |
|---|---|---|
| ●●● | **Launcher läuft mit `-y`**: alles ohne Rückfrage, Shell frei. Der sicherste Agent des Hauses läuft ausgerechnet unbeaufsichtigt im unsichersten Modus, weil ein Headless-Modus mit Profilrechten fehlt | Risiko und Widerspruch zur eigenen Philosophie |
| ●● | **Einbahnstraße während des Laufs**: Die Web-UI sieht Board-Status und Notizen, aber keine Ausgabe, keine Fragen, keine Freigaben; steuern kann sie den Lauf nicht | Rückkanal ist Entwurf |
| ●● | **Session-Logbuch bleibt leer**: Die `started`/`ended`-Pings kommen aus Claude-Code-Hooks, die leavencode nicht ausführt; Launcher-Sessions bleiben auf `launched` | stille Inkonsistenz |
| ●● | **Terminal-Start nur auf macOS** (osascript, Terminal.app) | Linux-Server müssen den Befehl kopieren |
| ● | Modell-Liste doppelt gepflegt (Plattform-Config und `capabilities.ts`), weil ein Listing-Kommando fehlt | – |

## 6. Wartung, Verteilung, Qualität

| Gewicht | Pain Point | Warum es schmerzt |
|---|---|---|
| ●●● | **Bis heute kein Git-Repository** – keine Historie, kein Diff, kein Rollback, kein zweiter Rechner | wird mit dieser Dokumentation behoben |
| ●●● | **`dist/` muss manuell gebaut werden**; läuft der alte Build, scheinen neue Funktionen zu fehlen (schon passiert) | Claude Code aktualisiert sich selbst |
| ●● | **Ein Monolith**: `src/index.ts` mit fast 3 000 Zeilen und geteiltem veränderlichem Zustand; Refactoring begonnen, aber die großen Blöcke (Werkzeuge, Slash-Befehle, `securePath`) sind verwoben | jede Änderung berührt viel |
| ●● | **Doku-Drift**: Dateinamen noch `sourdough-*`, rund 60 kaputte relative Links, veraltete Zahlen (Schrittgrenze 40 vs. 99 999, Backstop 200 vs. 9 999, Testzahlen) | man muss dem Code trauen, nicht der Doku |
| ●● | **Keine End-to-End-Tests**: Schleife, Freigabe und Streaming gegen die echte API sind manuelle, kostenpflichtige Prüfungen | Regressionen fallen spät auf |
| ● | Installation per Shell-Alias auf einen festen Pfad; kein Paket, keine Versionierung, README leer | – |
| ● | Ein Pfleger, keine Sicherheitsupdates von außen; Linux ungetestet, Windows nicht vorgesehen | – |

## 7. Sicherheit – wo sie selbst zum Pain Point wird

| Gewicht | Pain Point | Warum es schmerzt |
|---|---|---|
| ●● | **Keine OS-Sandbox**: Kindprozesse laufen mit vollen Nutzerrechten; Claude Code bietet dafür eine Sandbox-Einstellung | die eine Schicht, die Claude Code voraus hat |
| ●● | **Prompt-Injection ungemildert** – wie überall, aber ohne „Inhalte als Daten kennzeichnen" | – |
| ● | Kein Audit-Protokoll; `session.json` im Klartext | – |
| ● | `git` komplett hinter dem Dialog – richtig begründet, im Alltag lästig | Plan existiert, groß |

---

## 8. Was Claude Code kann und leavencode nicht

Zusammenfassung als Checkliste für Entscheidungen:

Shell mit Sandbox · MCP-Server · Subagenten · Hooks · Plugins/Skills · Websuche · Bild- und PDF-Eingabe · automatische Kontextverdichtung · Sitzungen auflisten und fortsetzen · Live-Streaming aller Antworten · Diff-Ansicht · `CLAUDE.md`-Projektgedächtnis · Worktrees · Hintergrundaufgaben · IDE-Integrationen · Selbst-Updates · Cloud-Ausführung · Sitzungsprotokolle.

## 9. Was dennoch für leavencode spricht

Damit die Liste nicht in die Irre führt: keine Shell, getrennte Lese-/Schreibbereiche, Geheimnis-Sperre, bereinigte Umgebung, Netz nur konstruktiv begrenzt, AI-dichte Freigabe-Registry, Provider- und Rechtsraumwahl, Loop-Breaker und Tagesbudget in der interaktiven Sitzung, fünf Abhängigkeiten, ein in einer Stunde lesbarer Türsteher – und vollständige Kontrolle über jede Zeile. Für eigene Projekte mit klaren Grenzen ist das kein schlechter Tausch.

## 10. Die billigsten Abhilfen

Wenn nur ein Nachmittag Zeit ist, diese fünf (alle in [open-work.md](./open-work.md) beschrieben):

1. Session bei `/exit` und Strg-C sichern, SIGINT-Handler (D1, D3).
2. „Immer erlauben" als geführter Registry-Eintrag im Dialog (D7).
3. `started`/`ended`-Pings aus der CLI (A5) – schließt die stille Inkonsistenz im Logbuch.
4. `ora` aus `package.json`, `index.ts.backup` und die leeren Ordner entfernen (E4, E5).
5. Warnzeile unter `--yes` (C9).
