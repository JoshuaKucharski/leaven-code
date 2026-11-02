# glossary — leaven-cli

**Stand:** 2026-07-30. Begriffe des Projekts, alphabetisch.

- **Agent-Loop / `runAgentTurn`** — Die Schleife, die pro Aufgabe wiederholt das Modell ruft,
  Werkzeuge ausführt und Ergebnisse zurückgibt, bis eine finale Antwort kommt. Gibt
  `'fertig' | 'budget'` zurück.
- **allow (Verdict)** — Befehlsprüfungs-Ergebnis: läuft ohne Dialog, weil exakt in der Registry
  vermerkt oder ein enger `php -l`. Nicht dasselbe wie `ok` (Allowlist).
- **allowed-commands.json** — `~/.leaven/`-Datei mit vom Menschen freigegebenen exakten
  Befehlen (AI-unveränderbar).
- **Anbieter / Provider** — DeepSeek, Anthropic (Claude), Qwen. Budget & Keys sind pro Anbieter.
- **approved-scripts/** — `~/.leaven/`-Ordner mit freigegebenen, für die AI unveränderbaren Shell-Skripten.
- **Auto-Fortsetzen / `/resume auto`** — Beim Start automatisch eine unterbrochene Aufgabe fortsetzen (wenn Budget frei).
- **Auto-Stopp / `autoStopp`** — Wenn an, hält die CLI bei erreichtem Tagesbudget vor dem nächsten API-Call an.
- **Bereich (Lese-/Schreibbereich) / roots** — Verzeichnisgrenzen, innerhalb derer gelesen/geschrieben werden darf.
- **capabilities.ts** — Die eine Wahrheit, was ein Modell kann (temperature? effort? thinking? streaming?). Steuert Adapter UND Anzeige.
- **DSML** — Das XML-artige Fallback-Format, in dem manche Modelle Tool-Calls als Text ausgeben; `utils/xmlParser.ts` erkennt es.
- **effort** — Denktiefe bei Anthropic (`low..max`) bzw. DeepSeek (`high/max`). Qwen kennt keinen.
- **execFile (shell-frei)** — Ausführung ohne Shell: keine Pipes/Umleitungen/Verkettung; Metazeichen werden abgelehnt.
- **Fable-Review** — Ein mit Modell **Fable** betriebener Subagent, der Design/Code adversarial gegenprüft (fand mehrfach echte Bugs).
- **include_usage** — `stream_options`-Flag, damit im Stream am Ende die Token-Zahlen kommen.
- **Invariante** — Regel, die nicht brechen darf (z.B. `reasoning_content` unverändert zurückreichen). Siehe development-advices.md.
- **isQuiet / stiller Modus** — „Zwischenschritte aus": nur Endergebnis + Bericht. Jetzt = `!zeigeSchritte`.
- **Loop-Breaker** — Erkennt Endlosschleifen (wiederholte gleiche Tool-Calls) und blockt weich.
- **Manifest (Start-Manifest)** — Der im Systemprompt erzeugte Überblick, was ohne/mit Rückfrage geht.
- **`_providerRaw`** — An einer normalisierten Anthropic-Assistant-Nachricht gespeicherte Original-Blöcke (thinking + tool_use), für die faithful Wiedergabe.
- **`reasoning_content`** — Der Denk-/Reasoning-Text (DeepSeek/Qwen). Muss im Thinking-Modus unverändert zurückgereicht werden (sonst 400).
- **redirect (Verdict)** — Befehl wird nicht ausgeführt, sondern das Modell auf ein besseres Werkzeug gelenkt (z.B. `cp`→`copy_file`).
- **Registry** — `allowed-commands.json`: exakte, freigabefreie Befehle.
- **`securePath()`** — Zentrale Pfadprüfung: Bereichsgrenze, Symlink-Auflösung, Geheimnis-Sperre.
- **secretDirectories / secretPatterns** — Gesperrte Verzeichnisse (`.ssh`,`.aws`,`.leaven`,…) / Dateimuster (`.env`,`*credentials*`,…).
- **session.json** — `~/.leaven/`-Datei mit dem gespeicherten Zustand für „weiter".
- **`~/.leaven`** — Geschützte Zone: für das Modell weder lesbar noch schreibbar. Beherbergt Registry, Skripte, usage/session, Rollen.
- **Streaming (SSE)** — Server-Sent-Events: Antwort tröpfelt Stück für Stück. DeepSeek+Qwen; ermöglicht Live-Reasoning + Qwen-Thinking.
- **usage.json** — `~/.leaven/`-Datei mit Tagesverbrauch, Limits, `autoStopp`, `autoWeiter`.
- **Verdict** — Ergebnis der Befehlsprüfung: `ok | ask | reject | redirect | allow`.
- **„weiter"** — Sonderwort (auch `/resume`), das nach Auto-Stopp die unterbrochene Aufgabe fortsetzt.
- **zeigeGedanken / zeigeSchritte** — Die zwei unabhängigen Anzeige-Schalter (`/output`).
