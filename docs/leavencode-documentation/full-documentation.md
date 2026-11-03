# leavencode – Vollständige Dokumentation

**Stand:** 2026-11-02 · Bezieht sich auf `src/` dieses Tages. Wo ältere Dokumente in `docs/` andere Zahlen nennen (z. B. „40 Schritte", „200 Tool-Calls"), gilt der Code; die Abweichungen sind in [open-work.md](./open-work.md) vermerkt.

---

## 1. Was leavencode ist

leavencode (npm-Paket `leaven-cli`, Befehl `leaven`) ist ein **deutschsprachiger KI-Agent für das Terminal**, der Programmieraufgaben an einem lokalen Projekt erledigt: Der Mensch stellt eine Aufgabe, ein Sprachmodell fordert Werkzeuge an (Dateien lesen, ändern, kopieren, Befehle ausführen, Webseiten abrufen), die CLI führt diese Werkzeuge aus und gibt die Ergebnisse zurück – so lange, bis das Modell fertig ist.

Das Besondere ist nicht die Schleife, sondern **wer die Grenzen zieht**: nicht das Modell, sondern der eigene, lesbare Code der CLI. Jedes Modell gibt nur Werkzeug-*Anforderungen* als JSON aus; ob sie ausgeführt werden, entscheidet `securePath()`, die Befehlsprüfung und die Freigabe-Logik auf dem eigenen Rechner. Ein Modellwechsel ändert daran nichts.

### Herkunft und Einordnung

- Der Nutzer hat das Projekt ursprünglich mit DeepSeek selbst gebaut; erklärtes Ziel war, **eine Datei ändern zu können, ohne dass die CLI abbricht oder ins Leere läuft**. Danach wurde es in mehreren Sitzungen mit Claude Opus 4.8 und Fable ausgebaut (Agent-Schleife, Guards, Rechte, Provider, Streaming, Budget, Board). Die Handover-Dokumente in `docs/` halten diese Geschichte fest.
- Früherer Name: `sourdough-cli`. Der heutige Name ordnet es der **Leaven-Plattform** zu (Laravel-App im Geschwisterverzeichnis), die leavencode als Launcher-Backend startet.
- Sprache: **Befehlsnamen englisch** (`/rights`, `/model` …), **alles andere deutsch** – Ausgaben, Kommentare, Systemprompt, Dokumentation. Das ist eine ausdrückliche Festlegung.
- Einsatzzweck laut Nutzer: ausschließlich eigene Quellcode-Entwicklung ohne personenbezogene Daten.

### Was es nicht ist

Kein Sandkasten für fremden, nicht vertrauenswürdigen Code (dafür braucht es Container oder VM), kein Chat-Client ohne Werkzeuge, keine IDE-Erweiterung, kein Hintergrund-Dienst – es läuft nur, solange jemand (oder der Launcher) es gestartet hat.

---

## 2. Das Grundprinzip in einem Bild

```
Mensch / Launcher
   │  Auftrag (Eingabe oder --prompt-file)
   ▼
startChat()  ── Startdialog: Lesebereich, Schreibbereiche (Checkbox), Rechte-Vorgaben
   │
   ▼
runAgentTurn()  ───────────────────────────────────────────────────────────────┐
   │  1. Budget prüfen (Auto-Stopp?)                                           │
   │  2. callApi(messages, tools)  → DeepSeek | Anthropic | Qwen               │
   │  3. Antwort roh in die History, Tool-Calls extrahieren                    │
   │  4. keine Tool-Calls? → Endtext ausgeben, fertig                          │
   │  5. je Tool-Call: isAutoApproved? sonst Freigabe-Dialog                   │
   │  6. Loop-Breaker prüfen                                                   │
   │  7. executeTool()  → securePath() / checkCommand() / urlGuard             │
   │  8. Ergebnis als role:"tool" in die History (immer, auch bei Ablehnung)   │
   └── weiter bei 1. ──────────────────────────────────────────────────────────┘
```

Alle Grenzen (Bereiche, Geheimnis-Sperre, Befehlsprüfung, Domain-Allowlist) greifen in Schritt 7, **nach** der Freigabe und unabhängig von ihr: Auch ein im Dialog freigegebener oder per `--yes` durchgewinkter Aufruf kann die Bereichsgrenze nicht verlassen (verifiziert: eine Datei außerhalb des Schreibbereichs überlebt `rm -rf` mit `--yes`).

---

## 3. Was es kann – Überblick

| Bereich | Fähigkeit |
|---|---|
| Modelle | DeepSeek (`deepseek-v4-pro`, `deepseek-v4-flash`), Anthropic (`claude-opus-5`, `claude-opus-4-8`, `claude-fable-5`), Qwen (`qwen3.7-max`); Wechsel zur Laufzeit per `/model` |
| Werkzeuge | 10: `read_file`, `list_files`, `write_file`, `edit_file`, `copy_file`, `execute_command`, `propose_command`, `update_plan`, `fetch_url`, `post_to_endpoint` |
| Bereiche | ein Lesebereich, beliebig viele Schreibbereiche, symlink-fest, Checkbox-Auswahl mit Gedächtnis |
| Rechte | Lesen / Schreiben / Shell je ohne oder mit Rückfrage; Freigabe-Dialog mit Mehrfachauswahl |
| Befehle | ohne Shell (`execFile`), Allowlist lesender Programme, gesperrte Optionen, Umleitung `cp`→`copy_file`, interne `sed -n`-Form, `php -l`, menschlich gepflegte Registry, Vorschlags-Eingang |
| Geheimnisse | `.env`, Schlüssel, Zugangsdaten, `.ssh`, `.aws`, `.gnupg`, `.config/gcloud`, `~/.leaven` gesperrt – auch innerhalb erlaubter Bereiche |
| Netz | kein Netz per Vorgabe; `fetch_url` nur GET auf freigegebene Domains mit SSRF-Sperre; `post_to_endpoint` an genau eine Adresse |
| Steuerung | Thinking an/aus, Denktiefe, Temperatur (nur wo der Provider sie kennt), Anzeige des Gedankenstroms und der Zwischenschritte |
| Planung | `update_plan` mit Fortschrittsbalken über der Eingabe |
| Kosten | Tages-Token-Budget je Anbieter, Auto-Stopp, Session-Sicherung und Fortsetzen am nächsten Tag |
| Schutz vor Entgleisen | Loop-Breaker (gleiche Aufrufe, Retry-Stürme, Zyklen), Tool-Call-Backstop |
| Rollen | gespeicherte Setups aus Bereichen, Rechten, Modell, Domains und Onboarding-Text |
| Plattform | Start durch den Leaven-Launcher per Prompt-Datei; automatische Statusmeldungen ans TaskBoard |
| Betrieb | interaktiv im Terminal, oder nicht-interaktiv per Pipe/Flags |

---

## 4. Die Komponenten im Einzelnen

### 4.1 Sitzung und Eingabe (`startChat`)

- Beim Start werden die API-Schlüssel aller drei Anbieter aus der Umgebung geladen und nebeneinander gehalten; fehlt der Schlüssel des aktiven Modells, bricht der Start mit dem Namen der nötigen Variable ab.
- Die Eingabe läuft über eine eigene Warteschlange auf `rl.on('line')`, nicht über `rl.question()`. Grund: Bei gepipter Eingabe trifft der ganze Text als ein Block ein, lange bevor der erste Turn fertig ist – ohne Puffer gingen alle Zeilen bis auf die erste verloren.
- **Mehrzeiliges Einfügen** wird im echten Terminal zu **einem** Auftrag zusammengefasst (Zeilen innerhalb von 120 ms). Bei gepipter Eingabe bleibt jede Zeile ein eigener Auftrag, damit Skripte funktionieren. Bracketed Paste wurde bewusst nicht gebaut.
- Über dem Eingabefeld stehen der Arbeitsplan (falls vorhanden), ein Kurzhinweis auf `/help`, `/status`, `/rights` und eine blaue Linie; nach dem Absenden eine zweite Linie. Die eigene Eingabe ist dadurch im Verlauf abgegrenzt.
- `Strg-C` beendet die CLI sofort (kein SIGINT-Handler), `Strg-D` ebenso.

### 4.2 Startdialog: Bereiche

Beim Start werden **nur die Bereiche** erfragt, keine Rechte:

| Bereich | Anzahl | Bedeutung |
|---|---|---|
| Lesebereich | genau einer | Darin darf gelesen und gesucht werden. Relative Pfade zählen **immer** ab hier – auch beim Schreiben, auch für Befehlsargumente, auch als Arbeitsverzeichnis der Kindprozesse |
| Schreibbereiche | beliebig viele | Darin darf geändert werden. Typisch: die Projekte, an denen gerade gearbeitet wird |

Die Schreibbereiche werden per **Checkbox** über die Unterverzeichnisse des Lesebereichs gewählt (versteckte Ordner und `node_modules` ausgeblendet). Die Auswahl wird in `~/.leaven/scopes.json` **pro Lesebereich** gemerkt und beim nächsten Start als Vorauswahl angeboten („zuletzt gewählt"). Der Eintrag „ALLE Verzeichnisse" setzt den Lesebereich selbst als Schreibbereich – inklusive später entstehender Ordner. Esc wechselt zur Pfadeingabe, die erst zurückkehrt, wenn das Verzeichnis existiert; `?` öffnet eine nummerierte Navigation. Ein Schreibbereich außerhalb des Lesebereichs muss ausdrücklich bestätigt werden. `--read-root`/`--write-root` überspringen den Dialog.

Die Trennung ist bewusst: Ein breiter Lesebereich gibt dem Agenten Überblick, die engen Schreibbereiche verhindern, dass er außerhalb der aktuellen Projekte etwas kaputt macht. Dass Lesen nur **ein** Verzeichnis ist, hat einen Grund: Relative Pfade brauchen genau einen Bezugspunkt – eine Liste hat in diesem Projekt zweimal zu Fehlern geführt.

### 4.3 Rechte

Drei Schalter, Vorgaben beim Start:

| Recht | Vorgabe | Begründung |
|---|---|---|
| Lesen | ohne Rückfrage | nur Lesen, auf den Lesebereich begrenzt |
| Schreiben | ohne Rückfrage | die Checkbox-Auswahl der Projekte **ist** die bewusste Zustimmung |
| Shell-Befehle | mit Rückfrage | Shell-Befehle lassen sich nicht auf ein Verzeichnis begrenzen; Allowlist-Befehle laufen ohnehin ohne Rückfrage |

`/rights` stellt die drei Fragen (Enter behält immer den aktuellen Wert) und erlaubt, Bereiche zu ändern. „Mit Rückfrage" heißt: Der Freigabe-Dialog erscheint. Es heißt **nicht** „verboten" – und umgekehrt hebt „ohne Rückfrage" die Bereichsgrenzen nie auf.

**Wer ohne Rückfrage läuft** (`isAutoApproved`):

```
--yes / LEAVEN_AUTO_APPROVE=1         → alles
update_plan, propose_command           → immer (führen nichts aus, gewähren nichts)
read_file, list_files, fetch_url       → Leserecht
write_file, edit_file, copy_file       → Schreibrecht
execute_command
   Shell-Recht an                       → ja
   Verdict ok / sedread (lesender Befehl) → wie read_file: Leserecht
   Verdict allow (Registry, php -l)     → ja
   Verdict reject / redirect            → kein Dialog; Begründung geht ans Modell
   exakt "npm run build" + /npm-build on → ja
   sonst (ask)                          → Freigabe-Dialog
post_to_endpoint                       → immer Dialog (bewusst nicht in der Tabelle)
unbekanntes Werkzeug                   → immer Dialog
```

**Der Freigabe-Dialog** zeigt alle anstehenden Aufrufe als Checkbox-Liste mit Kurzargumenten und – bei Befehlen – dem Grund, warum sie nicht automatisch laufen. Pfeiltasten wechseln, Leertaste wählt ab/an, Enter führt die gewählten aus, `a` wählt alle ab, Esc lehnt alle ab. Abgelehnte Aufrufe bekommen trotzdem eine Tool-Antwort („Der Nutzer hat diesen Tool-Aufruf abgelehnt …"), damit die History gültig bleibt. Ohne TTY gibt es keinen Dialog: Schreibende Aufrufe werden dann mit Warnung übersprungen.

### 4.4 Die Agent-Schleife (`runAgentTurn`)

Pro Auftrag läuft die Schleife aus Abschnitt 2. Wichtige Eigenschaften:

- **`tools` werden in jedem Request mitgegeben.** Fehlten sie im Folge-Request, könnte das Modell nach einem `read_file` kein `write_file` mehr anfordern und der Vorgang endete stumm. Angeboten werden nur nutzbare Werkzeuge: `fetch_url` nur mit freigegebener Domain, `post_to_endpoint` nur mit gültigem Endpunkt.
- **Jeder `tool_call` bekommt genau eine `role:"tool"`-Antwort** – auch bei Ablehnung und Loop-Breaker-Block. Sonst lehnt die API jeden weiteren Request ab (HTTP 400). `repairHistory()` füllt Lücken nach einem abgebrochenen Turn.
- **Die Assistant-Nachricht wandert roh in die History.** Im Thinking-Modus hängt daran `reasoning_content` (DeepSeek/Qwen) bzw. `_providerRaw` mit `thinking`-Blöcken (Anthropic), das die APIs in Folge-Requests unverändert zurückerwarten. Deshalb setzen `/model` und `/thinking` den Verlauf zurück: Modell und Thinking-Format dürfen nicht mitten in einer Konversation wechseln.
- **Rückgabewert** `'fertig'` (Modell hat abgeschlossen), `'budget'` (Tagesbudget erreicht → Session wird gesichert) oder `'gestoppt'` (Schrittgrenze, Aufgabe nicht fertig).
- **Schrittgrenze:** `MAX_ITERATIONS` steht im Code auf 99 999 – der frühere Haltepunkt „Weitere 40 Schritte ausführen?" ist damit praktisch abgeschaltet. Als Notaus wirken heute der Loop-Breaker und der Tool-Call-Backstop.
- **Kürzungen:** Werkzeugergebnisse werden auf 8 000 Zeichen gekürzt (sichtbar vermerkt); die History wird ab 60 Nachrichten an einer `user`-Grenze beschnitten, damit `tool_call`/`tool`-Paare heil bleiben. Eine Zusammenfassung alter Nachrichten gibt es nicht.
- **Anzeige:** Jeder Werkzeugaufruf erscheint als Zeile mit Kurzvorschau; am Ende (oder im stillen Modus) ein Bericht „Ausgeführt (n Aktionen)" mit Symbolen: 👁 gelesen, ✎ geschrieben, ⚠️ fehlgeschlagen, ⏭ abgelehnt, 🛑 vom Loop-Breaker blockiert. Blockierte und abgelehnte Aktionen sind **immer** sichtbar, auch im stillen Modus.

### 4.5 Werkzeuge

| Werkzeug | Parameter | Grenze | Besonderheiten |
|---|---|---|---|
| `read_file` | `path` | Lesebereich | erkennt Verzeichnisse und verweist auf `list_files` |
| `list_files` | `path` | Lesebereich | Ordner 📁 / Dateien 📄 |
| `write_file` | `path`, `content` | Schreibbereich | legt fehlende Elternverzeichnisse an |
| `edit_file` | `path`, `old_string`, `new_string`, `replace_all?` | Schreibbereich | exakter Textersatz per `split`/`join` (keine `$`-Platzhalter); Fehler bei 0 oder >1 Treffern ohne `replace_all` |
| `copy_file` | `source`, `dest`, `overwrite?` | Quelle Lese-, Ziel Schreibbereich | ersetzt `cp`; Geheimnis-Sperre gilt für die Quelle |
| `execute_command` | `command` | siehe 4.6 | **ein** Programm, keine Shell, 30 s Zeitlimit, 10 MB Ausgabe, gesäuberte Umgebung |
| `propose_command` | `name`, `kind`, `command?`, `script_content?`, `reason` | Eingang `~/.leaven/requested-commands/` | führt nichts aus, gewährt nichts |
| `update_plan` | `schritte[]` | – | Arbeitsplan setzen/aktualisieren |
| `fetch_url` | `url` | Domain-Allowlist | nur GET, 100 KB, 20 s, höchstens 3 einzeln geprüfte Weiterleitungen, HTML→Text |
| `post_to_endpoint` | `payload` | fester Endpunkt | https, Bearer-Token aus Umgebung, keine Weiterleitungen |

**Pfadsemantik – die wichtigste Regel:** Relative Pfade beziehen sich **immer** auf den Lesebereich. Der Systemprompt enthält ein konkretes Beispiel mit den echten Bereichen der Sitzung, weil das Modell sonst bloße Dateinamen schreibt, die im Lesebereich statt im Schreibbereich landen.

**`securePath(inputPath, 'read'|'write', base)`** ist die zentrale Prüfung: `~` expandieren, gegen den Lesebereich auflösen, Symlinks so weit auflösen, wie der Pfad existiert (`realpathSoFar`), Geheimnis-Sperre anwenden (auch innerhalb erlaubter Bereiche), dann die Grenze prüfen. Die Fehlermeldungen sind nach Ursache getrennt (Bereich existiert nicht ≠ Grenzverletzung) und nennen dem Modell die richtige Schreibweise oder den Hinweis, dem Nutzer `/rights` anzubieten – statt dass es aufgibt und Code zum manuellen Einfügen ausgibt.

### 4.6 Befehlsprüfung (`commandGuard`)

`execute_command` kennt keine Shell: Programm und Argumente gehen getrennt an `execFile`. Vorher entscheidet `checkCommand()` mit einem von sechs **Verdicts**:

| Verdict | Bedeutung | Dialog? |
|---|---|---|
| `reject` | Shell-Metazeichen (`; && \| > < $( ) ` ${}` Zeilenumbruch), unzerlegbar, oder gesperrte Option eines Allowlist-Programms | nein – Begründung geht ans Modell |
| `ok` | Programm auf der Allowlist (`grep`, `rg`, `find`, `ls`, `cat`, `head`, `tail`, `wc`, `file`, `stat`) ohne gesperrte Option | nein, wenn Leserecht |
| `sedread` | genau die Form `sed -n 'N,Mp' <datei>` (auch `Np`, `N,$p`) – wird **nicht** als Prozess gestartet, sondern intern als Zeilen-Read ausgeführt, byte-gleich zu sed | nein, wenn Leserecht |
| `redirect` | Programm mit besserem Werkzeug (`cp` → `copy_file`) – nicht ausführen, Hinweis ans Modell | nein |
| `allow` | exakt in `~/.leaven/allowed-commands.json` vermerkter Befehl **oder** reiner Lint `php -l <datei>` (einziges Flag `-l`) | nein |
| `ask` | alles andere: `npm`, `git`, `php`, `node`, `python`, `bash`, Programme mit Pfadangabe (`/bin/rm`) … | **ja** |

Weitere Regeln:

- **Gesperrte Optionen** je Allowlist-Programm: `find -exec/-execdir/-ok/-okdir/-delete/-L/-follow/-fls/-fprint/-fprint0/-fprintf`, `grep -S/-R/--dereference-recursive/--devices/-Z/--null`, `rg --follow/-L/--pre/--hostname-bin`, `tail -f/-F/--follow`, `file -C/--compile`. Eine Sperre greift exakt, mit Wert (`--follow=name`), **gebündelt** (`-rS` enthält `-S`) und als **GNU-Abkürzung** (`--deref`) – getopt akzeptiert alle vier Schreibweisen, also muss der Guard sie alle kennen. Falschtreffer wie `-eS` (Muster „S") sind hingenommen; das Modell schreibt die Option dann getrennt.
- **Pfad-Argumente** (alles, was nicht mit `-` beginnt) laufen durch `securePath`: bei Allowlist-/Lint-Befehlen gegen den **Lese**bereich, bei allen anderen gegen den **Schreib**bereich – sonst käme `rm -rf src/` durch, solange `src/` im Lesebereich liegt. **Optionswerte** zählen mit (`eingebetteteWerte`): der Wert hinter `=` immer (`--file=/pfad`; auch `--color=auto`, das sich harmlos im Lesebereich auflöst), bei Kurzoptionen mit `/` der Teil ab dem ersten `/` und der Teil nach dem Optionsbuchstaben (`-rf/x` → `/x` und `f/x`, beide müssen im Bereich liegen; `-fsrc/x` wird deshalb zu streng abgelehnt – getrennt schreiben). Vorregistrierte Befehle überspringen die Argumentprüfung (der Mensch hat die exakte Zeile vermerkt).
- **Arbeitsverzeichnis** der Kindprozesse ist immer der Lesebereich – derselbe Bezugspunkt wie bei Prüfung und Datei-Werkzeugen.
- **Umgebung** wird gesäubert (`scrubEnvironment`): alles auf `_KEY`, `_TOKEN`, `_SECRET`, `_PASSWORD`, `_PASSWD`, `_CREDENTIALS`, `API_KEY` sowie `DEEPSEEK_API_KEY`, `AWS_*`, `GITHUB_TOKEN`, `OPENAI_*` erreicht den Kindprozess nicht.
- **Warum `git` nicht auf der Allowlist steht:** Die repo-eigene `.git/config` kann über `diff.external`, `core.pager`, `textconv`-Filter beliebige Programme starten – ohne Netz, ohne verdächtige Kommandozeile. Ein Plan, git kontrolliert zurückzuholen, steht in `docs/security-projects/git-security-feature.md`.
- **Beinahe-Treffer** bekommen einen Hinweis: ein registrierter Befehl mit Zusatz-Flag, `php -l` mit weiteren Flags, ein unregistriertes Shell-Skript – jeweils mit der Form, die ohne Rückfrage durchginge.

**Der Freigabe-Kreislauf** für wiederkehrende Befehle: Der Assistent schlägt mit `propose_command` einen Befehl oder ein Skript vor → die CLI legt ihn in `~/.leaven/requested-commands/<name>.json` (+ `.sh`) ab → ein Mensch prüft und trägt die Zeile in `~/.leaven/allowed-commands.json` ein bzw. verschiebt das Skript nach `~/.leaven/approved-scripts/`. Erst dann läuft er ohne Rückfrage. Shell-Skripte zählen in der Registry nur, wenn sie **innerhalb** `~/.leaven` liegen – ein `bash /projekt/x.sh` würde beim Laden verworfen und gewarnt, weil der Assistent es umschreiben könnte. Das Start-Manifest im Systemprompt sagt dem Modell, was ohne und was mit Rückfrage geht.

### 4.7 Provider und Modelle

`src/providers/capabilities.ts` ist die eine Wahrheit darüber, was ein Modell kann – sie steuert den API-Adapter **und** die Anzeige (`/help` blendet `/temperature` bei Claude aus, `/status` zeigt Denktiefe statt Temperatur usw.).

| | DeepSeek | Claude Opus | Claude Fable | Qwen |
|---|---|---|---|---|
| Modelle | `deepseek-v4-pro` (Standard), `deepseek-v4-flash` | `claude-opus-5`, `claude-opus-4-8` | `claude-fable-5` | `qwen3.7-max` |
| Schlüssel | `DEEPSEEK_API_KEY` | `ANTHROPIC_API_KEY` | `ANTHROPIC_API_KEY` | `QWEN_API_KEY` / `DASHSCOPE_API_KEY` |
| Temperatur | ja (Standard 0.3) | nein (API lehnt ab) | nein | ja |
| Denktiefe | `high`, `max` | `low` … `max` (5 Stufen) | `low` … `max` | – |
| Thinking | an/aus | adaptive/aus | immer an | an/aus (`enable_thinking`, braucht Streaming) |
| Streaming | ja | nein (Phase 2) | nein | ja |

Kurznamen für `/model`: `deepseek` → `deepseek-v4-pro`, `opus` und `claude` → `claude-opus-5`, `fable` → `claude-fable-5`, `qwen` → `qwen3.7-max`. Ein neues Modell wird an genau drei Stellen in `capabilities.ts` eingetragen (`ALLE_MODELLE`, `MODELL_ALIASE`, `capabilitiesFor`). Modell-IDs nicht raten – eine falsche ID ergibt HTTP 400.

**Anthropic-Adapter** (`anthropic.ts`): übersetzt die interne OpenAI-förmige History an der API-Grenze (System-Nachrichten → `system`, `tool_calls` → `tool_use`, `role:"tool"` → gebündelte `tool_result`-Blöcke, `parameters` → `input_schema`), bevorzugt gespeicherte `_providerRaw`-Blöcke, setzt `output_config.effort` (ohne Thinking höchstens `high`, weil die API `disabled` nur bis `high` annimmt – Opus 5 antwortet sonst mit HTTP 400), bei Opus `thinking: adaptive|disabled`, bei Fable kein `thinking`-Feld, dafür `fallbacks: [claude-opus-4-8]` mit dem Beta-Header `server-side-fallback-2026-06-01`; `max_tokens` 16000 (Thinking zählt mit), Zeitlimit 600 s; `stop_reason: 'refusal'` wird als Meldung statt Absturz behandelt, `max_tokens` löst dieselbe Längenwarnung aus wie bei DeepSeek/Qwen.

**Streaming** (`openaiStream.ts`, DeepSeek + Qwen): eigener SSE-Parser mit Zeilenpuffer über Chunk-Grenzen, UTF-8-sicherem `StringDecoder`, Tool-Call-Assembler je Index, Idle-Watchdog (90 s) zusätzlich zum Verbindungs-Timeout (60 s). Oberster Vertrag: **vollständige Message oder Fehler – nie etwas dazwischen**; die Schleife pusht erst nach Erfolg in die History. Nur der Reasoning-Strom wird live (grau) angezeigt; `content` nie, weil der DSML-Fallback und die Formatierung den ganzen Text brauchen.

**DSML-Fallback** (`utils/xmlParser.ts`): Reicht ein Modell sein internes XML-artiges Tool-Format als Text durch, erkennt der Parser es und baut daraus normale `tool_calls`. Bei korrektem Function-Calling greift der Pfad nie.

### 4.8 Anzeige und Ausgabe

Zwei unabhängige Schalter, zur Laufzeit per `/output`, beim Start per `--verbose`/`--quiet`:

| Schalter | Vorgabe | Wirkung |
|---|---|---|
| Gedankenstrom (`/output reasoning on\|off`) | aus | Reasoning live in Grau (nur Streaming-Provider, nur im TTY) |
| Zwischenschritte (`/output steps on\|off`) | an | Werkzeugzeilen und Zwischentexte; aus = nur Endergebnis + Bericht |

Dazu ein Spinner mit Sekundenzähler („DeepSeek denkt nach… (4.2s)"), der bei Fehlern garantiert gestoppt wird (`withSpinner` mit `finally`), und eine Formatierung, die eine Schlussfrage des Modells hervorhebt.

### 4.9 Arbeitsplan

Bei mehrstufigen Aufgaben (ab etwa drei Schritten, Anweisung im Systemprompt) ruft das Modell `update_plan` mit der vollständigen Schrittliste auf. Zustände: `offen`, `laeuft` (▸), `erledigt` (✓), `entfaellt` (⊘ – zählt als abgeschlossen, damit der Balken nicht hängen bleibt). Anzeige als Balken `▰▰▰▱▱▱ 3/6 Schritten` plus Liste, nach jeder Aktualisierung und dauerhaft über dem Eingabefeld. Bewusst kein Prozentwert: Der Nenner ist geraten und wächst, und „erledigt" ist eine Selbstauskunft des Modells. `/plan` zeigt, `/plan clear` löscht. Im Board-Betrieb löst jede Aktualisierung eine Fortschrittsmeldung „Schritt n/m: …" aus.

### 4.10 Rollen

Eine Rolle ist ein gespeichertes Arbeits-Setup in `~/.leaven/roles.json`: Lesebereich, Schreibbereiche, die drei Rechte, Modell/Thinking/Effort/Temperatur, freigegebene Internet-Domains, optional `rollenzugriff`. Jede Rolle hat ein verstecktes Verzeichnis `~/.leaven/roles/.<name>/` mit `onboarding.md`, dessen Inhalt beim Aktivieren an den Systemprompt angehängt wird – Aufgabe, Konventionen, Projektwissen einmal hinterlegen statt jedes Mal erklären.

`/role` (Auswahl), `/role list|use|new|edit|delete <name>`. Bringt eine Rolle ein anderes Modell oder Thinking mit, wird der Verlauf zurückgesetzt (Format-Invariante).

**Isolation:** `~/.leaven` ist gesperrt; eine Rolle darf ausschließlich ihr eigenes Rollenverzeichnis lesen. Nur Rollen mit `rollenzugriff: true` (gedacht für die Arbeit an der CLI selbst) dürfen ganz `~/.leaven` lesen – `.ssh` und `.aws` bleiben auch dann gesperrt. Schreiben nach `~/.leaven` ist dem Agenten in keinem Fall erlaubt.

### 4.11 Netz

Per Vorgabe hat die CLI **keinen** Netzzugriff; `fetch_url` und `post_to_endpoint` werden dem Modell gar nicht erst angeboten, solange nichts freigegeben ist.

- **`fetch_url`** – `/internet add <domain>` gibt eine Domain inklusive Subdomains frei (`/internet list|remove|clear`). Nur `http`/`https`, nur GET; interne Adressen (`localhost`, `127.*`, `10.*`, `192.168.*`, `172.16–31.*`, `169.254.*`, `*.local`, `*.internal`, IPv6-Pendants) sind gesperrt, auch wenn die Domain freigegeben wäre; jede Weiterleitung wird einzeln geprüft. Warum kein `curl`: `curl -d @datei` kann senden – die Gefahr ist konstruktiv ausgeschlossen, nicht per Sperrliste.
- **`post_to_endpoint`** – sendet das `payload`-Objekt des Modells an **genau eine** konfigurierte Adresse (`/endpoint set <url>`, `LEAVEN_API_ENDPOINT`, `config/commands.json`). Das Modell kann das Ziel nicht wählen; nur https; interne Adressen gesperrt; Prüfung bei **jedem** Senden; 3xx-Antworten werden nicht befolgt (307/308 würden den Body mitnehmen); **immer** mit Freigabe-Dialog. Der Token `LEAVEN_API_TOKEN` geht nur an diese eine Adresse.

### 4.12 Budget, Auto-Stopp, Session, Fortsetzen

- Die CLI **zählt** die Tokens jedes Aufrufs aus der `usage`-Angabe der API (beim Streaming per `include_usage`) **pro Anbieter** (`anthropic` teilt eine Quote über Opus und Fable; `qwen`, `deepseek` getrennt) und legt den Tagesstand in `~/.leaven/usage.json` ab; beim Datumswechsel wird der Verbrauch zurückgesetzt, Limits bleiben.
- `/budget` zeigt; `/budget <anbieter> <tokens>` setzt ein Tageslimit (0 = keins); `/budget auto on|off` schaltet den **Auto-Stopp** (persistent). Nur mit Auto-Stopp wird die Grenze erzwungen: Die Schleife prüft vor jedem API-Aufruf und hält sauber an.
- Beim Auto-Stopp mitten in einer Aufgabe wird der **komplette Zustand** (History, Plan, Modell/Thinking/Effort) nach `~/.leaven/session.json` gesichert. Beim nächsten Start weist die CLI darauf hin; `weiter` (auch `weitermachen`, `weiterarbeiten`, `continue`, `continue working`) oder `/resume` setzt genau dort fort – mit demselben Modell. `/resume auto on` lässt sie beim Start von selbst fortsetzen, sofern das Budget frei ist (persistent, opt-in). Ist die Aufgabe fertig, wird die Session verworfen; eine fremde, nie fortgesetzte Session bleibt unangetastet.
- Gesichert wird **nur** beim Budget-Stopp (und nach einem Fehler, wenn die Session zur laufenden Konversation gehört). `/exit` mitten in einer Aufgabe sichert nichts.

### 4.13 Loop-Breaker und Backstop

Vor jedem freigegebenen Werkzeugaufruf prüft `LoopBreaker.check()` (Vorlage: das Claude-Code-Plugin im Ordner `loop-breaker/`):

| Erkennung | Schwelle (Vorgabe) | Beispiel |
|---|---|---|
| identische Aufrufe hintereinander | 5 | derselbe `write_file` mit denselben Argumenten fünfmal |
| Retry-Sturm (identisch, aber mit anderen Aufrufen dazwischen) | 10 (= 2 × Schwelle) | – |
| Zyklus (Signaturen aus Name **und** Argumenten) | 4 Wiederholungen, Periode bis 6 | `read x → write x → read x → write x …`; reine Lesezyklen ausgenommen |
| Tool-Call-Backstop | 9 999 je Sitzung (`/backstop on|off|<zahl>`) | harte Obergrenze |

`list_files` ist von der Zählung ausgenommen. Der Block ist **weich**: Der Grund geht als Tool-Ergebnis zurück ans Modell („Wiederhole diesen Aufruf nicht …"), der Turn läuft weiter, und ein anderer nächster Aufruf entschärft sofort. Zwei historische Fehlalarme (kumulativer statt konsekutiver Zähler; Zyklusvergleich nur über Namen) sind behoben und getestet.

### 4.14 Board-Anbindung (`board.ts`)

Wenn `LEAVEN_BUCKET_SLUG` **und** `LEAVEN_BUCKET_TOKEN` gesetzt sind (das tut der Launcher der Plattform), meldet die **CLI selbst** – nicht das Modell – den Stand an `POST {LEAVEN_BOARD_URL}/api/v1/buckets/{slug}/tasks`:

1. Beim Start eines Launcher-Auftrags: `in_progress` je „übernommenem Feature" (Terms des Buckets mit TaskCard, die einen Tier haben und nicht `done` sind; einmal per GET ermittelt und gecacht).
2. Bei jedem `update_plan`: erneut `in_progress` mit `note` „Schritt n/m: …" (Heartbeat, fire-and-forget).
3. Beim echten Abschluss (`'fertig'`) eines Launcher-Auftrags oder einer fortgesetzten Session: `done`. **Nicht** bei Budget-Stopp, Schrittlimit, Fehler oder Abbruch, und **nicht** im interaktiven Chat.

Alles ist Best-Effort mit 8 s Timeout: Ein fehlgeschlagener Report stört die Aufgabe nie. Der Bearer-Token erreicht das Modell nicht – `scrubEnvironment` entfernt ihn aus jedem Kindprozess, und `~/.leaven` ist für die Datei-Werkzeuge gesperrt.

### 4.15 Launcher-Modus

`leaven -y --model <m> --prompt-file .leaven/INITIAL_PROMPT.md` (so baut es der Launcher): Die CLI liest die Datei **direkt** (nicht über `read_file`, deshalb stört die Sperre des `.leaven`-Ordners nicht), zeigt „Initial-Auftrag … – ich beginne automatisch", stellt den Inhalt als erste Nutzer-Nachricht ein und läuft los – ohne Rückfrage, ohne Bestätigung. Der mehrzeilige Prompt läuft nie durch Shell-Quoting, nur der Dateipfad. Danach fällt die Sitzung in die normale Schleife; im Terminal kann der Mensch zusehen und weiterarbeiten. Mit `-y` gelten: Bereiche = Arbeitsverzeichnis, alle drei Rechte ohne Rückfrage.

### 4.16 Systemprompt

Wird aus dem **tatsächlichen Zustand** gebaut und nach jeder Bereichsänderung (`/rights`, Rolle, `/internet`, `/endpoint`) neu gesetzt: Lesebereich, Schreibbereiche, die Pfadregel mit konkretem Beispiel, die verfügbaren Werkzeuge, das Manifest (was ohne/mit Rückfrage läuft, registrierte Befehle und Skripte, die Einladung zu `propose_command` statt Skript-Bündelung), die Planungsanweisung, Netz- und Endpunkt-Hinweise, zuletzt der Onboarding-Text der aktiven Rolle.

---

## 5. Bedienung

### Slash-Befehle

| Befehl | Wirkung |
|---|---|
| `/help` | Befehle, Tastatur, Bereiche |
| `/status` | Modell, Thinking, Denktiefe/Temperatur, Schlüssel (maskiert), Bereiche, Rechte, Befehlsstatus, npm build, Geheimnisse, Anzeige, Budget, Auto-weiter, Backstop |
| `/rights` | Bereiche und die drei Rechte ändern |
| `/model [name\|kurzname]` | Modell wählen – setzt den Verlauf zurück |
| `/thinking [on\|off]` | Thinking – setzt den Verlauf zurück; bei Fable immer an |
| `/effort [stufe]` | Denktiefe je Provider |
| `/temperature [wert]` | 0.0–2.0, nur DeepSeek/Qwen (bei Claude ausgeblendet) |
| `/output [reasoning\|steps on\|off]` | Anzeige |
| `/npm-build on\|off` | exakt `npm run build` ohne Rückfrage (Vorgabe aus) |
| `/budget [anbieter tokens \| auto on\|off]` | Tagesbudget und Auto-Stopp |
| `/backstop [on\|off\|zahl]` | Tool-Call-Obergrenze der Sitzung |
| `/resume [auto on\|off]` | Session fortsetzen / Auto-Fortsetzen |
| `/key [wert]` | Schlüssel anzeigen oder für die Sitzung setzen |
| `/plan [clear]` | Arbeitsplan |
| `/internet [list\|add\|remove\|clear]` | Domains für `fetch_url` |
| `/endpoint [show\|set <url>\|clear]` | Ziel für `post_to_endpoint` |
| `/role [list\|use\|new\|edit\|delete <name>]` | Rollen |
| `/clear` | Verlauf löschen, Einstellungen behalten |
| `/exit` | beenden (auch `exit`, `quit`, `q`) |

Argumente können direkt mitgegeben werden (`/model fable`, `/thinking off`); ohne Argument erscheint eine Auswahl. Alles ohne führenden Schrägstrich geht als Auftrag an das Modell; `weiter` ist nur dann ein Sonderwort, wenn eine unterbrochene Session vorliegt.

### Was bleibt, was nicht

| Einstellung | Gilt |
|---|---|
| Modell, Thinking, Effort, Temperatur, Anzeige, Rechte, Schlüssel per `/key`, Domains, Endpunkt | nur diese Sitzung |
| Tageslimits, Auto-Stopp, Auto-Fortsetzen | persistent (`usage.json`) |
| Rollen, gemerkte Schreibbereiche | persistent (`roles.json`, `scopes.json`) |
| Registry und freigegebene Skripte | persistent, nur vom Menschen gepflegt |

### Ein typischer Ablauf

```
$ leaven
  Lesebereich  [~/develop/platforms/leaven] (? = Auswahl): ⏎
  Welche Projekte sollen SCHREIBRECHTE bekommen?
  [x] leavencode   (zuletzt gewählt)
  [ ] leaven
  Ergebnis: Lesen ~/develop/platforms/leaven ohne Rückfrage · Schreiben …/leavencode ohne Rückfrage · Shell mit Rückfrage

› Ergänze in src/usage.ts eine Funktion restVerbrauch() und schreibe einen Test dafür.
⠋ DeepSeek denkt nach… (3.1s)
🔧 update_plan: ✅ Plan aktualisiert: 0 von 3 Schritten abgeschlossen.
🔧 read_file: Datei leavencode/src/usage.ts: …
🔧 edit_file: ✅ leavencode/src/usage.ts: 1 Stelle ersetzt.
🔧 write_file: ✅ Datei leavencode/tests/test-rest.js wurde geschrieben.
🔧 Diese Aktionen brauchen deine Freigabe:
[x] execute_command(command: npm run build)        ⚠️ npm steht nicht auf der Allowlist
⏎
📋 Ausgeführt (5 Aktionen): …
Fertig: restVerbrauch() ergänzt, Test grün.
```

---

## 6. Konfigurationsdateien

**`config/commands.json`** – `allowed` (Programm → `forbidFlags`, optional `allowSubcommands`), `redirects`, `phpLint`, `secretPatterns` (`.env`, `.env.*`, `*.pem`, `*.key`, `id_rsa*`, `id_ed25519*`, `id_ecdsa*`, `.npmrc`, `.netrc`, `.pgpass`, `*.p12`, `*.pfx`, `*.keystore`, `*credentials*`, `*.kdbx`), `secretDirectories` (`.ssh`, `.aws`, `.gnupg`, `.config/gcloud`, `.leaven`), `apiEndpoint`. Die Datei enthält ausführliche `_hinweis`-Kommentare zu jeder Entscheidung. **Bevor ein Programm aufgenommen wird:** prüfen, ob es Konfiguration aus dem Arbeitsverzeichnis lädt und daraus Programme starten kann (das ist der git-Fall).

**`config/loopBreaker.json`** – siehe 4.13. `max_tool_calls` ist ein Budget für die **gesamte Sitzung**, nicht pro Auftrag.

**`~/.leaven/`** – siehe [techstack.md](./techstack.md), Abschnitt 6.

---

## 7. Tests

`npm test` baut und führt die Kern-Suite aus (Guard 177, Logik 13, URL 31); `npm run test:anthropic` (44), `test:stream` (36), `test:usage` (17), `test:session` (8) laufen separat. Alle ohne API-Zugriff. Was nur live prüfbar ist (Schleife, Streaming gegen die echte API, Freigabe-Dialog im TTY), steht als Prüfliste in `docs/testing.md`.

---

## 8. Begriffe

- **Bereich / roots** – Lese- und Schreibgrenzen der Sitzung.
- **Verdict** – Ergebnis der Befehlsprüfung: `ok`, `ask`, `reject`, `redirect`, `sedread`, `allow`.
- **Registry** – `~/.leaven/allowed-commands.json`, exakte freigabefreie Befehle, nur vom Menschen gepflegt.
- **Manifest** – der im Systemprompt erzeugte Überblick, was ohne/mit Rückfrage läuft.
- **Invariante** – Regel, die nicht brechen darf (Thinking-Inhalte unverändert zurückreichen; jeder Tool-Call eine Antwort; Pfade ab Lesebereich; vollständige Message oder Fehler).
- **`_providerRaw` / `reasoning_content`** – vom Provider gelieferte Denk- und Werkzeugblöcke, die für Folge-Requests erhalten bleiben müssen.
- **Auto-Stopp / weiter** – Budgetgrenze erzwingen und am nächsten Tag an derselben Aufgabe fortsetzen.
- **Board / Bucket / TaskCard** – Begriffe der Leaven-Plattform: Token-geschütztes Wissenspaket, Umsetzungsstand eines Feature-Terms.

---

## 9. Weiterführende Dokumente

| Thema | Datei |
|---|---|
| Architektur und Invarianten | `docs/architecture.md`, `docs/deepseek-api.md` |
| Werkzeuge und Pfadsemantik | `docs/tools.md` |
| Bereiche und Rechte | `docs/permissions-and-scopes.md` |
| Provider und Streaming | `docs/providers.md` |
| Befehlssicherheit, Restrisiken, Registrierung | `docs/security/leaven-cli-bash-commands-security.md`, `docs/security/leaven-cli-critical-issues.md`, `docs/security/command-registration.md` |
| Netz | `docs/internet.md`, `docs/leaven-api-endpoint-usage.md` |
| Plattform-Rückkanal (Entwurf) | `docs/leaven-platform-connect/api-docs.md` |
| Konfiguration, Tests, Fehlerbilder | `docs/configuration.md`, `docs/testing.md`, `docs/troubleshooting.md` |
| Kompakte Referenz | `docs/leaven-cli/*.md` |
| USP, Alternativen, Einordnung am Markt | [usp.md](./usp.md) |
| Übergaben | `docs/handover/*.md`, `docs/2026-07-21_2008_*.md` |

Mehrere dieser Dateien verlinken sich gegenseitig noch unter den alten `leaven-*`-Namen und laufen deshalb ins Leere – siehe [open-work.md](./open-work.md).
