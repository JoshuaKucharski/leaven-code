# AUFTRAG — LEAVEN-CLI ALS LAUNCHER-BACKEND ANBINDEN (MVP-Integration)

Du arbeitest an der bestehenden Leaven-App (früher SourDough; Laravel 12, Livewire 3,
produktive MySQL-DB). Ziel ist eine MINIMALE, funktionierende Verknüpfung der
hauseigenen CLI `leaven` mit dem Agent-Launcher der App. Dieser Auftrag ist
entscheidungsklar formuliert: Folge den Regeln, erfinde nichts dazu, keine Rückfragen.

## A. SPARSAMKEITS- UND LESE-REGELN (verbindlich, gelten vor allem)

1. KEIN Multi-Agent-Review, KEINE Subagenten, KEIN erhöhtes Thinking.
2. Lese-Whitelist (nur diese Dateien, bei abweichenden Pfaden das Naheliegende):
   `app/Support/LaunchCommandBuilder.php` (o. ä.), die Provisionierungs-Klasse
   (ClaudeSettingsWriter o. ä. — NUR die Stellen, die Dateien ins Workdir schreiben),
   die Livewire-Komponente + View des Agent-Profil-Formulars, die Config-Datei, die
   den Block `path_anchors` enthält (Namespace so lassen, wie vorgefunden),
   `.env.example`, EIN bestehender Builder-Test als Snapshot-Vorlage.
3. VERBOTEN: Quellcode der leaven-CLI lesen (sie wird per Befehl ERKUNDET, Abschnitt C),
   docs/ lesen oder schreiben (Ausnahme: eine CHANGELOG-Zeile), Tests fremder Module,
   Verzeichnis-Rundflüge, git-Historie tiefer als 3 Einträge.
4. Tests: KEINE neuen Testdateien. Ausschließlich die durch den Umbau brechenden
   Builder-/Formular-Tests minimal an die neue Realität anpassen (Snapshots).
   Während der Arbeit nur `php artisan test --filter=...`; die volle Suite GENAU EINMAL
   am Ende. `vendor/bin/pint --dirty --test`.
5. Kein migrate:fresh, keine Migrationen, keine neuen Composer-/npm-Pakete
   (Prozessaufrufe über die in Laravel enthaltene Symfony-Process-Unterstützung).
6. Abschlussreport: max. 10 Zeilen. Git-Commit: `feat(launcher): leaven cli integration`.

## B. ZIEL (MVP-Dreieck — nicht mehr)

1. Das Modell-Dropdown im Agent-Profil zeigt die Modelle, DIE DIE LEAVEN-CLI SELBST
   MELDET (z. B. `opus-4-8`) — eine Quelle, kein Doppel-Pflegen.
2. „Im Terminal starten" startet `leaven` (statt `claude`) im Workdir des Profils,
   mit gewähltem Modell.
3. Der Initial-Auftrag des Profils wird SOFORT und ohne manuelle Eingabe umgesetzt —
   robust gegen Mehrzeiligkeit und Anführungszeichen (Datei-Handoff, Abschnitt F).
Alles darüber hinaus ist ausdrücklich NICHT Teil dieses Auftrags (Abschnitt H).

## C. SCHRITT 1 — SCHNITTSTELLEN-ERKUNDUNG (Befehle ausführen, nichts lesen)

Führe aus und notiere die Antworten knapp für den Report:

```
leaven --version
leaven --help
```

Ermittle daraus drei Fakten:
- **F1 Modell-Listing:** Gibt es ein Kommando, das verfügbare Modelle maschinenlesbar
  listet? Probiere in dieser Reihenfolge, stoppe beim ersten Treffer:
  `leaven models --json` · `leaven models` · `leaven list-models` · `leaven --models`.
- **F2 Modell-Flag:** Wie wird das Modell beim Start gewählt (`--model`, `-m`, …)?
- **F3 Prompt-Mechanik:** Wie nimmt die CLI einen Auftrag entgegen? Prioritäten:
  (a) ein Prompt-Datei-Flag (`--prompt-file`/`--file`), (b) stdin, (c) ein einzelnes
  Positional-/Flag-Argument.
Wenn `--help` eine Frage offenlässt: höchstens ZWEI weitere Probe-Aufrufe, dann die
konservativste funktionierende Variante wählen. Keine Quellcode-Lektüre.

## D. CONFIG-ERWEITERUNG (in der vorgefundenen Config-Datei, Namespace beibehalten)

Neuer Block `cli` (Werte aus .env, alles in `.env.example` mit Kommentar dokumentieren):

```php
'cli' => [
    'binary' => env('LEAVEN_CLI_BIN', 'leaven'),
    // 'command' = Modelle live von der CLI holen; 'env' = statische Liste unten.
    'models_source' => env('LEAVEN_CLI_MODELS_SOURCE', '<command|env — nach F1 setzen>'),
    'models_command' => env('LEAVEN_CLI_MODELS_COMMAND', '<F1-Kommando oder leer>'),
    'models' => array_values(array_filter(array_map('trim',
        explode(',', (string) env('LEAVEN_CLI_MODELS', '<echte Namen aus F1 als Default>'))))),
    'model_flag' => env('LEAVEN_CLI_MODEL_FLAG', '<F2>'),
    'prompt_mode' => env('LEAVEN_CLI_PROMPT_MODE', '<file|stdin|arg — nach F3>'),
    'prompt_flag' => env('LEAVEN_CLI_PROMPT_FLAG', '<F3-Flag oder leer>'),
],
```

Die bestehende alte `models`-Liste (Claude-Aliase) NICHT löschen — sie bleibt einfach
ungenutzt stehen (kein Aufräum-Scope).

## E. MODELL-SYNC IM PROFIL-FORMULAR

Kleiner Service (z. B. `App\Support\LeavenCli`) mit einer Methode `models(): array`:
- Bei `models_source=command`: `models_command` per Prozess ausführen, Ausgabe parsen
  (JSON-Array bevorzugt; sonst eine Modell-ID je Zeile, Leerzeilen/Prosa ignorieren),
  Ergebnis 60 s cachen. Fehler/leere Ausgabe → Fallback auf die `cli.models`-Liste
  plus EIN Log-Hinweis (kein Fehlerwurf ins Formular).
- Bei `models_source=env`: direkt die Liste.
Das Modell-Dropdown des Profil-Formulars speist sich ausschließlich aus diesem Service;
leerer Wert bleibt erlaubt (CLI-Default). Der gespeicherte Modell-String wird 1:1 an
den Startbefehl durchgereicht — KEINE Alias-Übersetzung, keine Normalisierung.
Validierung beim Speichern: gewähltes Modell ∈ Liste oder leer.

## F. STARTBEFEHL & INITIAL-PROMPT (LaunchCommandBuilder + Provisionierung)

1. Builder: Binary aus `cli.binary`; Modell nur anhängen, wenn gesetzt
   (`<model_flag> <wert>`, escaped). Workdir-Wechsel, Token-Export-Zeile und der
   osascript-Weg bleiben UNVERÄNDERT — insbesondere den existierenden Namen der
   Token-Umgebungsvariable exakt beibehalten (nachsehen, nicht raten, nicht umbenennen).
2. **Datei-Handoff (der eigentliche Fix):** Die Provisionierung schreibt den
   `initial_prompt` des Profils zusätzlich als Datei `<workdir>/.leaven/INITIAL_PROMPT.md`
   (Ordner anlegen; idempotent überschreiben; leerer Prompt → Datei entfernen).
3. Prompt-Übergabe im Builder nach `prompt_mode`:
   - `file`: `<prompt_flag> .leaven/INITIAL_PROMPT.md` anhängen — fertig.
   - `stdin`: `< .leaven/INITIAL_PROMPT.md` an den Befehl anhängen.
   - `arg`: als EINZIGES Argument den festen ASCII-Einzeiler übergeben:
     `Read the file .leaven/INITIAL_PROMPT.md and execute the task exactly.`
   In allen drei Modi gilt: Der mehrzeilige User-Prompt läuft NIE durch
   Shell-/AppleScript-Quoting — nur Dateipfade oder der feste Einzeiler.
   Leerer initial_prompt → gar kein Prompt-Anteil im Befehl.
4. Profil-Detailseite: Der angezeigte generierte Startbefehl spiegelt das neue Format.

## G. VERIFIKATION — EIN Live-Durchlauf statt Testorgie

Genau einmal, manuell, im Anschluss: Bestehendes Profil `landingpage-writer` öffnen →
Modell aus der neuen Liste wählen (z. B. `opus-4-8`) → speichern → provisionieren
(✔ `.leaven/INITIAL_PROMPT.md` liegt im Workdir) → „Im Terminal starten" klicken.
Erwartung: Terminal öffnet im Workdir, `leaven` startet mit gewähltem Modell, liest den
Initial-Auftrag OHNE jede manuelle Eingabe und beginnt (im Test-Setup: liest AUFTRAG.md
und meldet in_progress an die Task-API — Board-Karte springt auf den Spinner).
Ergebnis in 3 Zeilen in den Report.

## H. BEWUSST NICHT IN DIESEM AUFTRAG

Keine Anpassung der Session-Ping-Hooks oder der .claude-Settings an die neue CLI
(Session-Logbuch darf vorerst unvollständig sein), kein Thinking-Level-Mapping für
leaven, kein Umbenennen von Env-Variablen oder Config-Namespaces, keine Übersetzung
alter Claude-Modell-Aliase, keine Doku außer einer CHANGELOG-Zeile, keine neuen
Testdateien, keine Änderungen an Buckets/Tasks/API.

## I. ABSCHLUSS

Volle Suite einmal grün, `pint --dirty --test`, Commit, Report (max. 10 Zeilen):
CLI-Version, F1/F2/F3-Befunde, gewählter prompt_mode, Modellquelle (command/env),
Ergebnis des Live-Durchlaufs, angepasste Snapshot-Tests. Ende.
