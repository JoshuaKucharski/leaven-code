# Werkzeuge und Pfadsemantik

**Stand:** 2026-07-23
**Definiert in:** `src/index.ts`, Array `tools` und Funktion `executeTool()`

## Die Werkzeuge

| Werkzeug | Parameter | Bereich | Freigabe über |
|---|---|---|---|
| `read_file` | `path` | Lesebereich | Leserecht |
| `list_files` | `path` | Lesebereich | Leserecht |
| `write_file` | `path`, `content` | Schreibbereich | Schreibrecht |
| `edit_file` | `path`, `old_string`, `new_string`, `replace_all?` | Schreibbereich | Schreibrecht |
| `copy_file` | `source`, `dest`, `overwrite?` | Quelle: Lesebereich · Ziel: Schreibbereich | Schreibrecht |
| `execute_command` | `command` | siehe unten | Shell-Recht **oder** Allowlist |
| `propose_command` | `name`, `kind`, `command?`, `script_content?`, `reason` | Vorschlags-Eingang | immer ohne Rückfrage (führt nichts aus) |
| `update_plan` | `schritte[]` | — | immer ohne Rückfrage ([plan.md](./plan.md)) |
| `fetch_url` | `url` | Domain-Allowlist | Leserecht ([internet.md](./internet.md)) |
| `post_to_endpoint` | `payload` | fester Endpunkt | **immer** Rückfrage |

### `write_file` legt Verzeichnisse mit an

Fehlt das Zielverzeichnis, wird es angelegt (`recursive`). Ohne das scheiterte `write_file`
mit einem rohen `ENOENT`, und das Modell wiederholte denselben Aufruf, bis der Loop-Breaker
griff — typisch beim Anlegen eines neuen Projektverzeichnisses.

Der Pfad ist von `securePath()` bereits auf den Schreibbereich geprüft; das Anlegen kann
nicht ausbrechen. `mkdir` gehört deshalb **nicht** auf die Befehls-Allowlist: Deren
Argumente werden gegen den *Lese*bereich geprüft, weil sie nur lesende Werkzeuge enthält.
Ein schreibendes Programm dort könnte überall dort Verzeichnisse anlegen, wo gelesen werden
darf.

### `edit_file` statt `write_file`

`write_file` schreibt die Datei komplett neu — bei grossen Dateien schneidet `max_tokens`
den Inhalt ab und zerstört die Datei. `edit_file` ersetzt einen Textabschnitt und ist für
Änderungen an bestehenden Dateien vorgesehen. Der Systemprompt weist das Modell darauf hin.

Verhalten von `edit_file`:

- `old_string` nicht gefunden → Fehler mit der Aufforderung, die Datei erneut zu lesen
- mehrfach gefunden und `replace_all` nicht gesetzt → Fehler mit Anzahl der Treffer
- Ersetzung über `split`/`join`, damit `$`-Muster im neuen Text nicht als
  Ersetzungsplatzhalter interpretiert werden

### `copy_file` — Kopieren ohne `cp`

Kopiert **eine** Datei: `source` wird aus dem Lesebereich gelesen, `dest` in den
Schreibbereich geschrieben. Zwei getrennte Grenzen, beide von `securePath()` erzwungen —
inklusive Symlink-Auflösung und **Geheimnis-Sperre**: Eine `.env` oder `*credentials*` als
Quelle wird abgelehnt, es lässt sich also kein Geheimnis in einen ausgelieferten Ordner
kopieren. Fehlende Zielverzeichnisse werden angelegt (wie `write_file`).

Verhalten:

- Ziel existiert und `overwrite` ist nicht gesetzt → Fehler mit Hinweis auf `overwrite: true`
- Quelle ist ein Verzeichnis → Fehler (`copy_file` kopiert einzelne Dateien, kein `cp -R`)
- Läuft unter dem **Schreibrecht ohne Rückfrage** — gedacht für Sicherungskopien vor
  Änderungen (`datei.blade.php` → `datei.blade.php.bak`).

**`cp` wird automatisch auf `copy_file` umgeleitet.** Ruft das Modell `execute_command`
mit `cp …` auf, greift die neue Guard-Entscheidung `redirect` (siehe
[security/leaven-cli-bash-commands-security.md](./security/leaven-cli-bash-commands-security.md)):
Der Befehl wird **nicht** ausgeführt und dem Nutzer **nicht** vorgelegt, stattdessen bekommt
das Modell den Hinweis auf `copy_file` zurück und wiederholt damit. So entfällt die
Freigabe-Rückfrage bei jedem Backup. Konfiguriert in `config/commands.json` unter
`redirects` — dort liesse sich später `mv` o.ä. ergänzen. `cp` bleibt bewusst von der
Allowlist fern (es schreibt und bewegt Daten, gehört also nicht zu den lesenden Befehlen).

### `execute_command`

Läuft **ohne Shell** über `execFile(programm, argumente)`. Konsequenzen:

- Keine Pipes (`|`), Umleitungen (`>`), Verkettungen (`;`, `&&`), Ersetzungen (`$(…)`)
- Befehle mit solchen Zeichen werden abgelehnt, nicht etwa still anders ausgeführt
- `~` wird nicht expandiert
- Ein Befehl pro Aufruf

Für Dateiinhalte soll das Modell `read_file` benutzen, nicht `cat datei | head`.
Einzelheiten zur Freigabe in [security/leaven-cli-bash-commands-security.md](./security/leaven-cli-bash-commands-security.md).

### Befehle ohne Rückfrage: Registry + `php -l`-Lint

Interpreter wie `php` stehen bewusst **nicht** auf der Allowlist (`php -r "…"` führt
beliebigen Code aus). Damit die ständig gebrauchten Prüf-Befehle trotzdem nicht bei jedem
Lauf nachfragen, gibt es zwei enge Mechanismen — beide liefern das neue Guard-Verdict
`allow` (läuft ohne Dialog):

**1. Exakte Befehls-Registry** — `~/.leaven/allowed-commands.json`, eine vom Menschen
gepflegte Liste vollständiger Befehle. Sie liegt in `~/.leaven` (auf der
Geheimnis-Sperrliste) und ist für das Modell **unlesbar und unschreibbar**; die CLI lädt sie
beim Start direkt. Der Abgleich ist **exakt** (Programm + alle Argumente) — angehängte Flags
gehen nicht mit durch.

```jsonc
// ~/.leaven/allowed-commands.json  – nur der Mensch pflegt das
["php artisan view:clear", "php artisan view:cache", "php artisan julalo"]
```

Ruft das Modell einen registrierten Befehl **mit** Zusatz-Flags auf, kommt eine Rückmeldung
mit der durchgehenden Form („lass die zusätzlichen Argumente weg"), statt ihn nur zur
Freigabe vorzulegen. Registrieren heißt: du bürgst dafür, dass der Befehl jederzeit
unbeaufsichtigt laufen darf — bei Cache/Lint unkritisch, bei eigenen Befehlen mit
Nebenwirkungen bewusst abwägen.

**2. Enge `php -l`-Regel** (`config/commands.json` → `phpLint`) — für den Syntax-Check über
wechselnde Dateinamen, den ein exakter Match nicht abdecken kann. Bedingung: Programm `php`
**ohne** Pfadangabe, das **einzige** Flag ist `-l`, mindestens ein Pfadargument. Jedes andere
Flag (`-r`, `-f`, `-a`, `-d`, `-c` …) verhindert die Freigabe. Der Zielpfad wird weiter gegen
den **Lesebereich** geprüft (Lint liest nur). `-l` prüft nur die Syntax und führt nichts aus.

Zwei Absicherungen gelten für beide: ein Programm **mit Pfadangabe**
(`/usr/local/bin/php …`) matcht nie (Schutz gegen untergeschobene Binaries) und landet im
Dialog; und alles **nicht** Vermerkte fragt weiter nach. Details in
[security/leaven-cli-bash-commands-security.md](./security/leaven-cli-bash-commands-security.md).

### `propose_command` — Befehle/Skripte zur Freigabe vorschlagen

Statt Befehle in ein `bash`-Skript zu bündeln (was die Sicherheitsgrenzen umginge), kann der
Assistent sinnvolle Befehle über `propose_command` **vorschlagen**. Der Vorschlag landet in
`~/.leaven/requested-commands/` — er **führt nichts aus** und **gewährt nichts**. Ein
Mensch prüft ihn und verschiebt gute Vorschläge in die AI-unveränderbare Registry; erst dann
laufen sie ohne Rückfrage. Der ganze Kreislauf (vorschlagen → prüfen → freigeben), die drei
Zonen und der `bash`-Footgun-Schutz stehen in
[security/command-registration.md](./security/command-registration.md).

---

## Pfadsemantik — die wichtigste Regel

**Relative Pfade beziehen sich IMMER auf den Lesebereich. Auch beim Schreiben. Auch bei
Befehlsargumenten. Auch für das Arbeitsverzeichnis der Kindprozesse.**

Ein Pfad, eine Bedeutung. Geprüft wird anschliessend gegen die jeweils zuständige Grenze:

```
Lesebereich    ~/develop
Schreibbereich ~/develop/templates/projekt

read_file  "templates/projekt/x.php"   -> ~/develop/templates/projekt/x.php   OK
edit_file  "templates/projekt/x.php"   -> dieselbe Datei                      OK
edit_file  "andere-app/y.php"          -> ~/develop/andere-app/y.php          VERWEIGERT
read_file  "andere-app/y.php"          -> dieselbe Datei                      OK
```

### Warum das so wichtig ist

Zwei Fehler in der Entwicklungsgeschichte hatten dieselbe Ursache — ein Pfad bedeutete je
nach Kontext etwas anderes:

1. Relative Pfade wurden beim Schreiben gegen den Schreibbereich aufgelöst. Das Modell las
   `projekt/datei.txt` erfolgreich und änderte danach eine *andere* Datei bzw. bekam
   `ENOENT`. Es verbrauchte zwei Fehlversuche pro Datei.
2. Das Arbeitsverzeichnis der Kindprozesse lag auf dem Schreibbereich. `rm -rf datei.txt`
   meldete Erfolg und löschte nichts — der Pfad zeigte woanders hin als der, den das Modell
   gelesen hatte.

Beide behoben. Wer die Auflösung anfasst, sollte beide Fälle nachtesten.

### Hinweis im Systemprompt

Der Systemprompt enthält ein konkretes Beispiel mit den tatsächlichen Bereichen der
Sitzung. Ohne dieses Beispiel schrieb das Modell einen blossen Dateinamen, der ab dem
Lesebereich zählte und damit ausserhalb des Schreibbereichs landete — ein Fehlversuch pro
Datei. Mit Beispiel: kein Fehlversuch.

---

## `securePath()` — die zentrale Prüfung

```ts
securePath(inputPath, mode: 'read' | 'write', base = roots.read): Promise<string>
```

Ablauf:

1. `~` expandieren, gegen `base` auflösen (`path.resolve` normalisiert `..` korrekt)
2. **Geheimnis-Sperre** — greift auch innerhalb der erlaubten Bereiche
3. **Symlink-Auflösung** über `realpathSoFar()`: läuft zum nächsten existierenden Vorfahren
   hoch, löst diesen per `fs.realpath` auf und hängt den Rest wieder an. Ohne diesen
   Schritt führt ein Symlink im erlaubten Bereich nach draussen vorbei, weil
   `path.resolve` Symlinks nicht auflöst.
4. Vergleich mit der Bereichsgrenze (`===` oder Präfix mit `path.sep`)

Fehlermeldungen sind nach Ursache getrennt:

- Bereich existiert nicht → Konfigurationsproblem, Hinweis auf den Befehl `/rights`
- Grenze verletzt, alternative Schreibweise wäre gültig → nennt die richtige Schreibweise
  (nur wenn das Zielverzeichnis existiert, sonst entstünden unsinnige Vorschläge)
- Grenze verletzt beim **Schreiben** → zusätzlich der Hinweis, dem Nutzer den Befehl
  `/rights` anzubieten. Ohne diesen Zusatz gibt das Modell auf und liefert Code zum
  manuellen Einfügen, obwohl oft nur der Schreibbereich auf das falsche Projekt zeigt.
- sonst → Grenzverletzung, mit dem Hinweis, es nicht mit einem anderen relativen Pfad zu
  versuchen

`read_file` prüft vorab, ob der Pfad ein Verzeichnis ist, und verweist dann auf
`list_files` — statt die rohe Node-Meldung `EISDIR` durchzureichen.

## Werkzeugergebnisse

Auf `MAX_TOOL_RESULT_CHARS` (8000) gekürzt, mit sichtbarem Vermerk. Im ausführlichen Modus
zeigt die CLI zusätzlich eine Kurzvorschau der ersten Zeilen.
