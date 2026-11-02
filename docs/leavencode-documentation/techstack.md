# leavencode – Techstack

**Stand:** 2026-11-02 · Geprüft gegen `src/`, `package.json`, `tsconfig.json`, den aktuellen Build in `dist/` und die Entwicklungsmaschine (macOS, Apple Silicon). Alle Zahlen stammen aus dem Code dieses Tages, nicht aus älteren Dokumenten.

leavencode ist der Quellcode der hauseigenen Terminal-KI (npm-Paket `leaven-cli`, Befehl `leaven`). Diese Datei beschreibt, **woraus** das Programm besteht: Sprache, Laufzeit, Abhängigkeiten, Dateien, Schnittstellen, Plattformen. Was es **tut**, steht in [full-documentation.md](./full-documentation.md).

---

## 1. Kurzprofil

| | |
|---|---|
| Paketname / Verzeichnis | `leaven-cli` / `leavencode` (früherer Name `sourdough-cli`, einige Dateinamen in `docs/` tragen ihn noch) |
| Befehl | `leaven` (`package.json` → `bin`, zeigt auf `dist/index.js`) |
| Version / Lizenz | 1.0.0 / MIT |
| Sprache | TypeScript im `strict`-Modus, kompiliert zu CommonJS-JavaScript |
| Laufzeit | Node.js; verifiziert mit v24.3.0 (npm 11.4.2). Der Code nutzt nur Standard-APIs (`readline`, `fs/promises`, `child_process.execFile`, `string_decoder`, `for await` über Streams), also sollte jede aktuelle LTS-Version ab 18 genügen – getestet ist nur 24 |
| Umfang | 4.934 Zeilen TypeScript in `src/`, davon 2.959 in `src/index.ts` |
| Abhängigkeiten | 5 Laufzeit-Pakete, 3 Entwicklungs-Pakete, 74 Pakete insgesamt in `node_modules/` |
| Konfiguration | `config/commands.json`, `config/loopBreaker.json`, Zustand in `~/.leaven/` |
| Versionsverwaltung | bis zum 2026-11-02 **kein** Git-Repository (wird mit dieser Dokumentation angelegt und veröffentlicht) |

---

## 2. Sprache, Compiler, Build

### tsconfig.json

```jsonc
{
  "target": "ES2020", "module": "commonjs", "lib": ["ES2020"],
  "rootDir": "./src", "outDir": "./dist",
  "strict": true, "esModuleInterop": true, "skipLibCheck": true,
  "forceConsistentCasingInFileNames": true, "resolveJsonModule": false
}
```

Folgen dieser Einstellungen:

- **Imports enden auf `.js`** (`import … from './plan.js'`), obwohl die Quelle `.ts` ist. Für den CommonJS-Output ist das unschädlich und für einen späteren ESM-Umstieg vorbereitet.
- **JSON-Konfiguration wird per `require()` geladen** (`config/commands.json`, `config/loopBreaker.json`), weil `resolveJsonModule` aus ist. Wer auf ESM umstellt, muss diese beiden Stellen ersetzen.
- `strict: true` gilt für den gesamten Code; `npm run typecheck` ist am 2026-11-02 fehlerfrei.

### npm-Skripte

| Skript | Befehl | Zweck |
|---|---|---|
| `build` | `tsc` | kompiliert `src/` nach `dist/` – **`dist/` ist der Laufcode** |
| `dev` | `ts-node src/index.ts` | Start ohne Build (langsamer Start, für Entwicklung) |
| `start` | `node dist/index.js` | Start des Kompilats |
| `typecheck` | `tsc --noEmit` | Typprüfung ohne Schreiben |
| `test` | Build + `test-guard`, `test-logic`, `test-url` | Kern-Suite, kein API-Zugriff |
| `test:anthropic` / `test:stream` / `test:usage` / `test:session` | Build + je eine Suite | Provider- und Feature-Suiten, kein API-Zugriff |
| `postinstall` | `npm run build` | `npm install` erzeugt `dist/` automatisch |

Eine Änderung in `src/` ist **erst nach `npm run build` aktiv**. Das war schon einmal Ursache einer Fehlersuche (Handover vom 2026-08-08): Der Build lag hinter dem Quelltext, und eine neue Funktion schien nicht zu existieren.

---

## 3. Abhängigkeiten

### Laufzeit

| Paket | Version | Wofür |
|---|---|---|
| `axios` | ^1.7.9 | **einziger HTTP-Client** – alle drei Modell-Provider, die Board-Meldung, `fetch_url`, `post_to_endpoint`; auch als Stream-Client (`responseType: 'stream'`) für SSE |
| `chalk` | ^4.1.2 | Terminalfarben. Bewusst Version 4: ab 5 ist chalk ESM-only und passt nicht zum CommonJS-Build |
| `commander` | ^12.1.0 | Kommandozeilen-Flags und `--help`/`--version` |
| `dotenv` | ^16.4.7 | lädt `.env`; vorhandene Shell-Variablen werden **nicht** überschrieben |
| `ora` | ^5.4.1 | **deklariert, aber in `src/` nicht mehr benutzt** – der Spinner ist eine eigene Klasse in `index.ts`; `ora` wird nur noch in der toten Datei `src/index.ts.backup` importiert. Kandidat zum Entfernen |

### Entwicklung

| Paket | Version | Wofür |
|---|---|---|
| `typescript` | ^5.7.2 | Compiler |
| `ts-node` | ^10.9.2 | `npm run dev` |
| `@types/node` | ^22.10.5 | Typen der Node-APIs |

### Bewusst nicht enthalten: ein LLM-SDK

Es gibt **kein** `@anthropic-ai/sdk`, kein `openai`-Paket, kein `dashscope`. Alle Provider werden als rohes HTTPS über `axios` gesprochen. Begründung aus dem Projekt: Jedes zusätzliche Paket vergrößert die Lieferkette (transitive Pakete, mögliche `postinstall`-Skripte), und die drei APIs sind einfach genug, um sie direkt und vollständig prüfbar zu bedienen. Die Vertrauensgrenze bleibt damit bei fünf Paketen plus Node selbst.

### Genutzte Node-Bordmittel

`readline` (Eingabe, Raw-Modus für den Freigabe-Dialog), `child_process.execFile` (Befehle **ohne Shell**), `fs`/`fs/promises`, `path`, `os`, `string_decoder` (UTF-8-sichere Chunk-Grenzen im Stream), `util.promisify`.

---

## 4. Dateien und Verzeichnisse

```
leavencode/
├── package.json · package-lock.json · tsconfig.json
├── .env                         nur ein Platzhalter-Schlüssel (echte Keys liegen in der Shell) – nie committen
├── index.ts                     leer (1 Byte), Überbleibsel
├── zusammenfassung.txt          Kurzbeschreibung der package.json
├── example-auto-stopp-auto-continute.md   Dummy-Ausgabe eines Testlaufs (Auto-Stopp/Fortsetzen)
│
├── src/                         Quelltext (Zeilen am 2026-11-02)
│   ├── index.ts           2959  Einstieg: Flags, Startdialog, Agent-Schleife, Werkzeuge, securePath,
│   │                            Slash-Befehle, Rechte, Rollen, Persistenz, Launcher-Modus
│   ├── index.ts.backup     240  alte Fassung mit Shell-`exec` – wird nicht gebaut, reine Historie
│   ├── board.ts            130  Selbst-Meldung an das Leaven-Board (in_progress / Fortschritt / done)
│   ├── history.ts           76  Tool-Call-Normalisierung (JSON + DSML-Fallback), repairHistory, trimHistory
│   ├── plan.ts              43  Fortschrittsbalken und Planliste
│   ├── session.ts           28  Struktur und Validierung der „weiter"-Session
│   ├── state.ts             10  gemeinsamer Zustand (der Arbeitsplan)
│   ├── usage.ts             52  Tages-Token-Budget – reine, getestete Logik
│   ├── guards/
│   │   ├── commandGuard.ts 375  Befehlszerlegung ohne Shell, Allowlist, Verdicts, Geheimnis-Erkennung,
│   │   │                        Registry-Abgleich, sed-Lesebereich, Umgebungssäuberung
│   │   ├── loopBreaker.ts  180  Wiederholungs-, Retry-Sturm- und Zyklus-Erkennung, Tool-Call-Backstop
│   │   └── urlGuard.ts      96  Domain-Allowlist, SSRF-Sperre, HTML→Text
│   ├── providers/
│   │   ├── capabilities.ts  90  Provider-Erkennung, Fähigkeiten je Modell, Modellliste, Kurznamen
│   │   ├── anthropic.ts    161  Adapter für die Anthropic Messages-API (non-streaming)
│   │   ├── openaiStream.ts 272  gemeinsamer SSE-Client für OpenAI-kompatible Provider (DeepSeek, Qwen)
│   │   └── qwen.ts          36  DashScope-Aufruf über den SSE-Client
│   ├── util/pfade.ts        52  expandHome, realpathSoFar (Symlinks), isDirectory, subdirectories
│   ├── util/text.ts         67  truncate, parseArgs, liesZeilenBereich (sed-Äquivalent), maskiere, Formatierung
│   ├── utils/xmlParser.ts   67  Fallback-Parser für DeepSeeks DSML-Tool-Calls im Text
│   └── include_functions/       leer
│
├── dist/                        Kompilat (tsc), spiegelt src/ – der tatsächliche Laufcode
├── config/
│   ├── commands.json        59  Allowlist lesender Programme, forbidFlags, redirects, phpLint,
│   │                            secretPatterns, secretDirectories, apiEndpoint
│   └── loopBreaker.json     12  Schwellen des Loop-Breakers
├── tests/                       7 reine Node-Skripte (kein Test-Framework), laufen gegen dist/, kein API-Zugriff
├── docs/                        Fachdokumentation (Architektur, Sicherheit, Provider, Handover …)
│   └── leavencode-documentation/   diese sechs Dateien
├── loop-breaker/                eigenes Git-Repository (Upstream github.com/sakshya73/loop-breaker, v0.1.2, MIT):
│                                das Claude-Code-Plugin „Loop Breaker" (Python-PreToolUse-Hook). Vorlage und
│                                Namensgeber für src/guards/loopBreaker.ts; wird als Git-Submodul geführt
├── skills/                      leer
└── active-order-prompt/         Auftragstexte für die Laravel-Plattform (Launcher-Anbindung, Board-Kreislauf)
```

### Was wovon abhängt

```
dist/index.js  (commander → startChat)
 ├─ providers/capabilities    providerFor(), capabilitiesFor(), ALLE_MODELLE, MODELL_ALIASE
 ├─ providers/anthropic       callAnthropic() ── axios ──────────▶ api.anthropic.com/v1/messages
 ├─ providers/qwen ─┐
 │                  └─ providers/openaiStream  streamOpenAiCompatible() ── axios(stream) ──▶ api.deepseek.com
 │                                                                                           dashscope-intl.aliyuncs.com
 ├─ guards/commandGuard       checkCommand(), isSecretPath(), scrubEnvironment(), registryEintragErlaubt()
 ├─ guards/urlGuard           pruefeUrl(), htmlZuText()
 ├─ guards/loopBreaker        LoopBreaker.check()
 ├─ history ── utils/xmlParser
 ├─ usage · session · state · plan · board
 └─ util/text · util/pfade
```

Die Provider-Schicht liegt **vor** der Rechte-Schicht und berührt sie nicht: Jeder Provider liefert am Ende dieselbe interne Nachrichtenform (`{role, content, reasoning_content?, tool_calls?}`); `securePath`, die Guards und die Freigabe arbeiten modellunabhängig.

`src/index.ts` ist bewusst groß geblieben. Ein Refactoring am 2026-08-04 hat 18 Funktionen in `state.ts`, `plan.ts`, `history.ts`, `util/text.ts` und `util/pfade.ts` ausgelagert; der Rest (Werkzeuge, Slash-Befehle, Startdialog, Rollen, `securePath`) teilt sich veränderlichen Zustand und wurde nicht angefasst. Die Landkarte dafür steht in `docs/handover/2026-08-04_1500_index-ts-modul-zerlegung.md`.

---

## 5. Externe Schnittstellen

leavencode ist ausschließlich **HTTP-Client**. In `src/` gibt es keinen `createServer`, kein `listen`, keinen gebundenen Port – nichts kann von außen hereinrufen.

### Modell-Provider

| Provider | Endpunkt | Auth | Format | Streaming |
|---|---|---|---|---|
| DeepSeek (Standard) | `https://api.deepseek.com/v1/chat/completions` | `Authorization: Bearer` | OpenAI-kompatibel, `thinking:{type}` + `reasoning_effort` | ja (SSE, `stream_options.include_usage`) |
| Anthropic | `https://api.anthropic.com/v1/messages` | `x-api-key` + `anthropic-version: 2023-06-01` | eigenes Format (Adapter: `system`-Feld, `input_schema`, `tool_use`/`tool_result`, `thinking`-Blöcke, `output_config.effort`) | nein (Phase 2); Timeout 300 s |
| Qwen | `https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions` | `Authorization: Bearer` | OpenAI-kompatibel, `enable_thinking` | ja |

Retry-Politik überall: 3 Versuche bei 429/5xx/Verbindungsabriss mit exponentieller Wartezeit; beim Streaming nur, solange noch nichts live ausgegeben wurde.

### Eigene Plattform

| Kanal | Richtung | Wann | Konfiguration |
|---|---|---|---|
| Board-Selbstmeldung (`board.ts`) | CLI → Plattform | automatisch im Launcher- und Resume-Betrieb | `LEAVEN_BUCKET_SLUG`, `LEAVEN_BUCKET_TOKEN`, `LEAVEN_BOARD_URL` (Standard `http://localhost`) |
| `post_to_endpoint` | Modell → eine feste Adresse | nur mit Freigabe, nur https, keine Weiterleitungen | `/endpoint set`, `LEAVEN_API_ENDPOINT`, `LEAVEN_API_TOKEN` |
| `fetch_url` | Modell → freigegebene Domains | nur GET, Allowlist, SSRF-Sperre | `/internet add <domain>` oder Rolle |

---

## 6. Konfiguration und persistente Daten

### Kommandozeilen-Flags

| Flag | Wirkung |
|---|---|
| `-y`, `--yes` | alle Werkzeuge ohne Rückfrage; Bereiche = Arbeitsverzeichnis (oder Flags); auch per `LEAVEN_AUTO_APPROVE=1` |
| `--model <name\|kurzname>` | Startmodell (Standard `deepseek-v4-pro`; Kurznamen `deepseek`, `opus`, `claude`, `fable`, `qwen`) |
| `--no-thinking` | Thinking aus |
| `--effort <stufe>` | Denktiefe (Standard `high`) |
| `--read-root <pfad>` | Lesebereich, überspringt die Startfrage |
| `--write-root <pfade>` | Schreibbereiche, kommagetrennt |
| `--verbose` / `--quiet` | Gedankenstrom und Zwischenschritte an / beides aus |
| `--allow-secrets` | Geheimnis-Sperre aufheben |
| `--prompt-file <pfad>` | Initial-Auftrag aus Datei beim Start sofort ausführen (Launcher-Anbindung) |

### Umgebungsvariablen

| Variable | Zweck |
|---|---|
| `DEEPSEEK_API_KEY`, `ANTHROPIC_API_KEY`, `QWEN_API_KEY` (oder `DASHSCOPE_API_KEY`) | Schlüssel; alle werden gleichzeitig geladen, `/model` greift den passenden |
| `DEEPSEEK_MODEL` | Startmodell (von `--model` überstimmt) |
| `LEAVEN_AUTO_APPROVE=1` | wie `--yes` |
| `LEAVEN_API_ENDPOINT`, `LEAVEN_API_TOKEN` | Sende-Ziel und Bearer-Token für `post_to_endpoint` |
| `LEAVEN_BUCKET_SLUG`, `LEAVEN_BUCKET_TOKEN`, `LEAVEN_BOARD_URL` | Board-Selbstmeldung (setzt der Launcher der Plattform) |

### Konfigurationsdateien im Projekt

- `config/commands.json` – welche Programme ohne Rückfrage laufen (`grep`, `rg`, `find`, `ls`, `cat`, `head`, `tail`, `wc`, `file`, `stat`) samt gesperrter Optionen; `redirects` (`cp` → `copy_file`); die enge `php -l`-Regel; `secretPatterns` und `secretDirectories`; `apiEndpoint`.
- `config/loopBreaker.json` – `consecutive_threshold` 5, `structural_detection`, `cycle_reps` 4, `cycle_max_period` 6, `read_only_cycle_exempt`, `max_tool_calls` 9999, `max_estimated_tokens` 0, `ignore_tools` `["list_files"]`. Der Schlüssel `mode` wird vom Code nicht gelesen.

### Zustand unter `~/.leaven/` (für das Modell gesperrt)

| Datei / Ordner | Inhalt | Schreibt |
|---|---|---|
| `usage.json` | Tagesverbrauch je Anbieter, Limits, `autoStopp`, `autoWeiter` | CLI |
| `session.json` | kompletter Zustand einer per Auto-Stopp unterbrochenen Aufgabe | CLI |
| `scopes.json` | gemerkte Schreibbereich-Auswahl je Lesebereich | CLI |
| `roles.json`, `roles/.<name>/onboarding.md` | Rollen und ihre Onboarding-Texte | CLI / Mensch |
| `allowed-commands.json` | Registry exakter Befehle, die ohne Rückfrage laufen | **nur der Mensch** |
| `approved-scripts/` | freigegebene Shell-Skripte | **nur der Mensch** |
| `requested-commands/` | Vorschläge des Assistenten (`propose_command`) | CLI (Eingang, gewährt nichts) |
| `tokens/<bucket-slug>` | Bucket-Tokens der Plattform (liest der Launcher, nicht die CLI) | Mensch |

Daneben existiert auf dieser Maschine noch `~/.sourdough/` aus der Zeit vor der Umbenennung; der aktuelle Code liest es nicht.

---

## 7. Plattformen

### macOS – entwickelt und betrieben

Entwicklungs- und Betriebsumgebung ist ein MacBook mit Apple Silicon (Darwin 25.6.0, arm64), zsh, Terminal.app. Der Befehl `leaven` ist in `~/.zshrc` als Alias auf `node ~/develop/platforms/leaven/leavencode/dist/index.js` eingerichtet; zusätzlich zeigt im globalen npm-Verzeichnis ein Symlink `leaven-cli` auf das Projekt. Der Terminal-Launcher der Leaven-Plattform öffnet Terminal.app per `osascript`.

### Linux – lauffähig, aber ungetestet

Der CLI-Code enthält **keine** macOS-spezifische API: Pfade über `path`, Home über `os.homedir()`, Prozesse über `execFile`, kein `osascript`. Er sollte unter Linux unverändert bauen und laufen. Drei Punkte sind dort zu prüfen, bevor man sich auf die Schutzschichten verlässt:

1. **GNU grep vs. BSD grep.** Die gesperrte Option `grep -S` (Symlinks folgen) ist ein BSD/macOS-Flag. GNU grep folgt Symlinks mit `-R` (groß) – dieses Flag steht **nicht** in `forbidFlags`. Für Linux gehört `-R` und `--dereference-recursive` ergänzt, sonst kann ein erlaubtes `grep -R` über einen Symlink aus dem Lesebereich hinauslesen.
2. **GNU find** kennt `-L` und `-follow` ebenfalls; beide sind gesperrt. `-delete`, `-exec`, `-execdir`, `-ok`, `-okdir`, `-fls`, `-fprint`, `-fprintf` ebenso.
3. **sed** ist unkritisch: Die einzige freigabefreie Form (`sed -n 'N,Mp' datei`) startet **kein** sed, sondern liest die Zeilen intern – GNU-/BSD-Unterschiede spielen keine Rolle.

Der Terminal-Launcher der Plattform ist macOS-only; unter Linux gibt die Plattform den Startbefehl zum Kopieren aus (`MacTerminalLauncher` wirft eine entsprechende Meldung).

### Windows – nicht vorgesehen

Die Allowlist besteht aus POSIX-Werkzeugen, der Freigabe-Dialog braucht einen TTY-Raw-Modus, und die Bereichsprüfungen sind für POSIX-Pfade gedacht. Nicht getestet, nicht geplant.

### Terminal-Anforderungen

- **Interaktiv (TTY):** Freigabe-Dialog und Checkbox-Auswahl (Pfeiltasten, Leertaste, Enter, Esc), Live-Gedankenstrom, Spinner, Paste-Zusammenfassung (Zeilen innerhalb von 120 ms = ein Auftrag).
- **Ohne TTY (Pipe, CI, Cron):** jede Eingabezeile ist ein eigener Auftrag, `exit` beendet; der Spinner wird zu einfachen Statuszeilen; **schreibende Werkzeuge ohne Freigabe werden übersprungen** (es gibt niemanden, der zustimmen könnte) – außer mit `--yes`. Nicht existierende `--read-root`/`--write-root` beenden mit Exit-Code 1.

---

## 8. Tests und Qualitätssicherung

Alle Suiten laufen gegen `dist/`, ohne Netz, ohne Kosten. Stand 2026-11-02 (gegen den vorhandenen Build ausgeführt):

| Suite | Prüfungen | Prüft |
|---|---|---|
| `tests/test-guard.js` | 123 | Metazeichen-Ablehnung, Allowlist, gesperrte Optionen, `redirect`/`allow`/`sedread`-Verdicts, `php -l`, Registry-Abgleich, Geheimnis-Erkennung, Pfaderkennung, Umgebungssäuberung |
| `tests/test-logic.js` | 13 | Loop-Breaker (Fehlalarme, echte Schleifen, Zyklen, Argumentreihenfolge), DSML-Parser |
| `tests/test-url.js` | 31 | Domain-Allowlist, Suffix-Tricks, SSRF-Sperre, Protokolle, HTML→Text |
| `tests/test-anthropic.js` | 36 | Fähigkeiten aller Modelle, Request-/Response-Übersetzung, Fable-Sonderfälle |
| `tests/test-stream.js` | 36 | SSE-Zeilenpuffer, Tool-Call-Assembler, UTF-8 über Chunk-Grenzen, `reasoning_content`-Phantom |
| `tests/test-usage.js` | 17 | Token-Summe, Tagesreset, Budgetprüfung |
| `tests/test-session.js` | 8 | Session-Validierung |
| **Summe** | **264** | alle bestanden; `npm run typecheck` fehlerfrei |

Es gibt **kein** Test-Framework (keine Jest-/Vitest-Abhängigkeit): Jede Suite ist ein Skript mit einer `check()`-Funktion, zählt `bestanden/fehlgeschlagen` und setzt den Exit-Code. Live-Prüfungen gegen die echten APIs (Agent-Schleife, `securePath` im Echtlauf, Streaming) sind manuell und in `docs/testing.md` als Prüfliste beschrieben.

---

## 9. Installation und Start

```bash
cd ~/develop/platforms/leaven/leavencode
npm install                      # installiert und baut (postinstall → tsc)
export DEEPSEEK_API_KEY="…"      # und/oder ANTHROPIC_API_KEY, QWEN_API_KEY – dauerhaft in ~/.zshrc
node dist/index.js               # oder: leaven (Alias) · npm start · npm run dev (ts-node)
npm test                         # Kern-Suite; test:anthropic, test:stream, test:usage, test:session separat
```

Global installierbar wäre das Paket über `npm link` (nutzt den `bin`-Eintrag). Beachte: Die `.env` im Projekt enthält nur einen Platzhalter; wer sie in der Shell sourct, überschreibt den echten Schlüssel und bekommt „Authentication Fails".

---

## 10. Nachbarsystem: die Leaven-Plattform

leavencode ist das CLI-Glied einer kleinen Systemfamilie. Im Geschwisterverzeichnis `../leaven` liegt die Web-Plattform **Leaven** (Laravel 12, Livewire 3, Tailwind 4, MySQL, PHP 8.2+): ein Terminologie-Betriebssystem mit Agent-Profilen, Token-geschützten Wissens-Buckets, TaskBoard und einem Launcher, der leavencode in Terminal.app startet (`LaunchCommandBuilder`, `MacTerminalLauncher`, `ClaudeSettingsWriter`). Die CLI selbst hat **keine** PHP- oder Datenbank-Abhängigkeit; die Kopplung besteht aus Umgebungsvariablen, einer Prompt-Datei im Arbeitsverzeichnis und HTTP-Aufrufen an die Bucket-API. Einzelheiten in [integration-compatibility.md](./integration-compatibility.md).
