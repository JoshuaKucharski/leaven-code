# Sicherheit der Befehlsausführung in leaven-cli

**Stand:** 2026-07-21
**Gilt für:** `src/index.ts`, `src/guards/commandGuard.ts`, `config/commands.json`

Dieses Dokument beschreibt, welche Gefahren bei der Ausführung von Befehlen durch einen
KI-Agenten bestehen und wie leaven-cli ihnen begegnet. Was **nicht** geschützt ist,
steht in [leaven-cli-critical-issues.md](./leaven-cli-critical-issues.md). Beide
Dokumente gehören zusammen — dieses allein vermittelt ein zu gutes Gefühl.

---

## 1. Die Kernbedrohung: Shell-Injektion

### Das Problem

Bis zum 2026-07-21 reichte `execute_command` den Befehl als Zeichenkette an eine Shell:

```ts
execAsync(args.command, { shell: process.env.SHELL || '/bin/sh' })
```

Damit ist **jede Prüfung des Befehlstextes wirkungslos**. Eine Regel wie „nur Befehle, die
mit `grep` beginnen" wird durch ein Semikolon ausgehebelt. Gemessen:

```
Eingabe:  grep localhost /etc/hosts ; echo ICH-BIN-EIN-ZWEITER-BEFEHL

MIT Shell:
  # localhost is used to configure the loopback interface
  127.0.0.1  localhost
  ICH-BIN-EIN-ZWEITER-BEFEHL      <-- der zweite Befehl lief mit

OHNE Shell (execFile):
  grep: /etc/hosts ; echo ICH-BIN-EIN-ZWEITER-BEFEHL: No such file or directory
                                  <-- alles nach grep ist reiner Text
```

Die Shell liefert die Angriffsfläche, nicht das Programm: `;` `&&` `||` `|` `>` `<`
`$(…)` `` `…` `` `${…}` `&` und der Zeilenumbruch.

### Der Schutz

`execFile(programm, argumente)` statt `exec(zeichenkette)`. Programm und Argumente werden
getrennt an das Betriebssystem übergeben, es gibt keinen Interpreter dazwischen.
Zusätzlich lehnt `checkCommand()` jeden Befehl mit Shell-Metazeichen von vornherein ab —
denn ohne Shell würden sie stillschweigend etwas anderes bedeuten, als der Aufrufer meint.

**Preis:** Pipes, Umleitungen und Verkettungen funktionieren nicht mehr. Die
Tool-Beschreibung sagt dem Modell das ausdrücklich, damit es `read_file` statt
`cat datei | head` benutzt.

---

## 2. Allowlist statt Blocklist

Eine Blocklist („alles ausser `rm`, `sudo`, …") ist prinzipiell unvollständig — man kann
nicht alle gefährlichen Programme aufzählen. `config/commands.json` führt deshalb auf,
was **ohne Rückfrage** laufen darf:

| Gruppe | Programme |
|---|---|
| Suchen und Lesen | `grep`, `rg`, `find`, `ls`, `cat`, `head`, `tail`, `wc`, `file`, `stat` |

Bewusst **nicht** aufgenommen: `npm`, `composer`, `php`, `node`, `python`. Ein
`npm run build` führt beliebigen Code aus `package.json` aus — das ist faktisch
uneingeschränkte Ausführung.

### Warum `git` nicht auf der Allowlist steht

`git` war kurzzeitig aufgenommen (lesende Unterbefehle) und wurde am 2026-07-21 wieder
entfernt. **Nicht** wegen Netzwerkzugriffs — `status`, `diff`, `log` können das nicht,
und `fetch`/`push`/`clone`/`remote` waren nie freigegeben. Der Grund steht in
`git help config`:

> **diff.external** — *„If this config variable is set, diff generation is not performed
> using the internal diff machinery, but using the given command."*

Diese Variable steht in der **repository-eigenen** `.git/config`. Ein `git diff` in einem
fremden Repository startet damit ein beliebiges Programm — ohne jede Netzwerkverbindung.
Gleiches gilt über `core.pager` und `textconv`-Filter aus `.gitattributes`. Das Sperren
der Option `-c` half nicht, weil die Konfiguration nicht von der Kommandozeile kommt.

git funktioniert weiterhin, geht aber über den Freigabe-Dialog. Was nötig wäre, um es
kontrolliert zurückzuholen, steht in
[../security-projects/git-security-feature.md](../security-projects/git-security-feature.md).

**Folge für die Optionssperren:** Sie greifen nur bei Allowlist-Programmen. Da git nicht
mehr gelistet ist, wird `git -c core.pager=sh log` nicht mehr hart abgelehnt, sondern
landet im Dialog — dort ist der Mensch der Schutz.

**Wichtig:** Ein nicht gelistetes Programm wird nicht verboten, sondern landet im
Freigabe-Dialog. Die Allowlist ersetzt die Rückfrage, sie verbietet nichts zusätzlich.

### Umleitung auf ein besseres Werkzeug (`redirect`)

Der Guard kennt eine vierte Entscheidung neben `ok`/`ask`/`reject`: **`redirect`**. Für
Programme, für die es ein sichereres, eingegrenztes Werkzeug gibt, wird der Befehl **nicht
ausgeführt** und dem Nutzer **nicht** vorgelegt — stattdessen bekommt das Modell einen
Hinweis auf das richtige Werkzeug zurück (wie bei `reject` geht die Begründung direkt ans
Modell, ohne Dialog).

Aktuell: `cp` → `copy_file`. Grund: `cp` **schreibt** und bewegt Daten (`cp
~/.aws/credentials ./public/`), gehört also nicht auf die Read-only-Allowlist — würde man es
dort eintragen, würden seine Pfade gegen den *Lese*bereich geprüft, während es in Wahrheit
ans Ziel schreibt. `copy_file` prüft Quelle gegen den Lese-, Ziel gegen den Schreibbereich
und läuft ohne Rückfrage. Ohne die Umleitung müsste der Nutzer jede Sicherungskopie einzeln
freigeben. Konfiguriert in `config/commands.json` unter `redirects`. Ein `cp` **mit
Pfadangabe** (`/bin/cp`) wird nicht umgeleitet, sondern landet wie üblich im Dialog.

### Exakte Registry statt Interpreter-Allowlist (`allow`)

Ein fünftes Verdict: **`allow`** — läuft ohne Dialog, aber ohne dass ein Interpreter
freigegeben wird. Zwei Quellen:

**Vorregistrierte Befehle.** Vollständige, vom Menschen vermerkte Befehle in
`~/.leaven/allowed-commands.json` laufen ohne Rückfrage. Der Ort liegt auf der
Geheimnis-Sperrliste — der Assistent kann die Liste **weder lesen noch schreiben**; nur der
Mensch pflegt sie. Der Abgleich ist **exakt** (geparstes Programm + alle Argumente):
`php artisan view:clear` geht durch, `php artisan view:clear --env=prod` nicht (aber das
Modell bekommt den Hinweis, die Zusätze wegzulassen). So wird nicht `php` als Interpreter
freigegeben, sondern nur die eine handverlesene Zeile.

**`php -l`-Lint.** Der Syntax-Check hat wechselnde Dateinamen, ein exakter Match greift
nicht. Die enge Regel (`config/commands.json` → `phpLint`) erlaubt `allow` nur, wenn:

| Bedingung | Warum |
|---|---|
| Programm `php` **ohne** `/` | Pfadform könnte ein untergeschobenes `php` sein → Dialog |
| **einziges** Flag ist `-l` | `-l` prüft nur Syntax, führt nichts aus |
| kein `-r`, `-f`, `-a` | führen Inline-Code / Datei / interaktiv aus |
| kein `-d`, `-c` | ini-Injektion (`-d auto_prepend_file=…`) könnte Code unterschieben |
| mind. ein Pfadargument | leerer Lint liest von stdin, ergibt hier keinen Sinn |

Jeder Zielpfad wird zusätzlich gegen den **Lesebereich** geprüft. Vorregistrierte Befehle
überspringen die Pfadprüfung (der Mensch hat die exakte Zeile vermerkt), der Lint nicht (die
Datei variiert). **Warum überhaupt so eng:** `php` gehört zur selben Klasse wie `git` —
seine Gefahr steckt im ausgeführten Code, nicht in den Argumenten, weshalb es nie pauschal
freigegeben wird. Der Nutzer, der einen Befehl registriert, bürgt dafür, dass er
unbeaufsichtigt laufen darf.

---

## 3. Verbotene Optionen pro Programm

Der Programmname allein genügt nicht — mehrere harmlos wirkende Werkzeuge können mehr,
als ihr Name vermuten lässt:

| Programm | Gesperrte Option | Warum |
|---|---|---|
| `find` | `-exec`, `-execdir`, `-ok`, `-okdir`, `-delete` | startet Programme bzw. löscht Dateien |
| `find` | `-fls`, `-fprint`, `-fprint0`, `-fprintf` | schreibt Dateien (GNU find) |
| `find` | `-L`, `-follow` | folgt Symlinks aus dem erlaubten Bereich hinaus |
| `grep` | `-S` | folgt bei Rekursion allen Symlinks (BSD/macOS; Default ist `-p`, folgt keinen) |
| `grep` | `-R`, `--dereference-recursive` | GNU grep folgt damit allen Symlinks (BSD behandelt `-R` wie `-r`); `-r` bleibt frei |
| `grep` | `--devices`, `-Z`, `--null` | Gerätedateien, Entpacken wie `zgrep` (`-Z`, BSD), NUL-getrennte Ausgabe |
| `rg` | `--follow`, `-L`, `--pre`, `--hostname-bin` | Symlinks bzw. Vorverarbeitung durch fremde Programme |
| `tail` | `-f`, `-F`, `--follow` | blockiert bis zum Timeout |
| `file` | `-C`, `--compile` | schreibt `magic.mgc` |
| `git` | `-c` | `git -c core.pager=sh log` führt beliebigen Code aus |
| `git` | `--exec-path`, `--upload-pack`, `--receive-pack` | leitet auf fremde Programme um |

Ebenfalls abgefangen: ein Programm mit Pfadangabe (`/bin/rm`, `./script.sh`) umgeht die
Namensprüfung und landet deshalb im Freigabe-Dialog.

Der Abgleich kennt alle Schreibweisen, die getopt akzeptiert: exakt (`-S`), mit Wert
(`--follow=name`), gebündelt (`-rSn` enthält `-S`) und als GNU-Abkürzung (`--deref` für
`--dereference-recursive`). Ohne die letzten beiden liesse sich jede Sperre umgehen.
Falschtreffer wie `-eS` (Muster „S") sind hingenommen – das Modell schreibt die Option
dann getrennt.

---

## 4. Pfad-Argumente werden geprüft

Ein erlaubtes Programm kann trotzdem an falscher Stelle lesen. `grep -r password
/Users/myki/.ssh` löscht nichts — verrät aber alles.

Jedes Argument, das **keine Option** ist (also nicht mit `-` beginnt), läuft durch
dieselbe `securePath()`-Prüfung wie die Datei-Tools: Auflösung gegen den Lesebereich,
Symlink-Auflösung per `fs.realpath`, Vergleich mit der Bereichsgrenze.

Optionen mit eingebettetem Pfad werden ebenfalls geprüft (`eingebetteteWerte()`): der Wert
hinter `=` immer (`--file=/pfad`; auch harmlose wie `--color=auto`, die sich im Lesebereich
auflösen), bei Kurzoptionen mit `/` der Teil ab dem ersten `/` **und** der Teil nach dem
Optionsbuchstaben – `-rf/x` prüft `/x` und `f/x`, weil nicht bekannt ist, welcher Buchstabe
den Wert trägt. Ein relativ angehängter Wert wie `-fsrc/x` wird dadurch zu streng abgelehnt;
`-f src/x` geht durch.

Die Regel ist bewusst grosszügig. Eine engere Fassung („nur Argumente mit `/` darin")
übersah `..` und `.` — `rm -rf ..` wäre ungeprüft durchgelaufen. Ein Suchbegriff wie
`passwort` löst sich gegen den Lesebereich auf und liegt damit innerhalb; es entstehen
also keine Falsch-Ablehnungen.

**Der Massstab hängt davon ab, ob das Programm bekannt ist:**

| Befehl | Prüfung gegen | Begründung |
|---|---|---|
| auf der Allowlist | Lesebereich | ausschliesslich lesende Werkzeuge |
| nicht auf der Allowlist | **Schreibbereich** | Wirkung unbekannt (`rm`, `npm`, `git` …) — darf nur dort hantieren, wo ohnehin geschrieben werden darf |

Ohne diese Trennung käme `rm -rf src/` durch, solange `src/` im Lesebereich liegt — und
löschte damit ausserhalb des Schreibbereichs. Verifiziert: eine Datei im Lesebereich,
aber ausserhalb des Schreibbereichs, überlebt ein `rm -rf` auch dann, wenn `--yes` gesetzt
ist. Die Prüfung greift also zusätzlich zur Freigabe, nicht statt ihrer.

Das Arbeitsverzeichnis der Kindprozesse ist immer der **Lesebereich** — derselbe
Bezugspunkt, den auch die Prüfung und die Datei-Tools verwenden. Sonst zeigte ein
relativer Pfad bei der Prüfung auf eine andere Datei als bei der Ausführung.

Gemessen:

```
Fuehre aus: grep -r password /Users/myki/.ssh
-> Abgelehnt: Argument "/Users/myki/.ssh" – Gesperrt: gilt als Geheimnisdatei (Regel ".ssh")
```

Angenehmer Nebeneffekt der fehlenden Shell: `~` wird nicht expandiert. `grep -r x ~/.ssh`
sucht ein Verzeichnis, das buchstäblich `~` heisst, und scheitert von selbst.

---

## 5. Geheimnis-Sperrliste

Die Bereichsgrenzen helfen nicht gegen Geheimnisse **innerhalb** des erlaubten Bereichs.
Eine `.env` im eigenen Projekt ist regelkonform lesbar — und ihr Inhalt ginge damit an die
DeepSeek-API.

`isSecretPath()` sperrt deshalb unabhängig von den Bereichen, und zwar für **alle**
Zugriffe (auch `read_file`, nicht nur Befehle):

```
Dateimuster:      .env, .env.*, *.pem, *.key, id_rsa*, id_ed25519*, id_ecdsa*,
                  .npmrc, .netrc, .pgpass, *.p12, *.pfx, *.keystore,
                  *credentials*, *.kdbx
Verzeichnisse:    .ssh, .aws, .gnupg, .config/gcloud
```

Gemessen — `.env` liegt hier mitten im erlaubten Schreibbereich:

```
Lies die Datei sandbox/.env
-> Gesperrt: sandbox/.env gilt als Geheimnisdatei (Regel ".env").
   Inhalte solcher Dateien würden an die API übertragen.
```

Aufhebbar mit `--allow-secrets`, wenn man tatsächlich an einer `.env` arbeiten will —
dann aber als bewusste Entscheidung beim Start, nicht versehentlich.

---

## 6. Umgebung des Kindprozesses

Ein Kindprozess erbt standardmässig die komplette Umgebung, einschliesslich
`DEEPSEEK_API_KEY`. Nachgewiesen, bevor der Schutz eingebaut war: der Kindprozess konnte
den Schlüssel ausgeben.

`scrubEnvironment()` entfernt vor jedem `execFile` alles, was auf `*_KEY`, `*_TOKEN`,
`*_SECRET`, `*_PASSWORD`, `*_PASSWD`, `*_CREDENTIALS` endet, sowie `DEEPSEEK_API_KEY`,
`AWS_*`, `GITHUB_TOKEN`, `OPENAI_*`.

Gemessen nach dem Einbau (`printenv` dafür kurzzeitig freigegeben):

| Befehl | Ergebnis |
|---|---|
| `printenv HOME` | `/Users/myki` — normale Variablen bleiben erhalten |
| `printenv DEEPSEEK_API_KEY` | nicht gesetzt — Schlüssel wird nicht vererbt |

---

## 7. Lese- und Schreibbereiche

Zwei getrennte Grenzen, beim Sitzungsstart festgelegt:

- **Lesebereich** — meist breiter, damit sich der Agent orientieren kann
- **Schreibbereich** — meist eng auf das Projekt, an dem gearbeitet wird

`securePath()` löst relative Pfade **immer** gegen den Lesebereich auf (damit ein Pfad in
jedem Tool dasselbe bedeutet) und prüft anschliessend gegen die jeweils zuständige Grenze.
`realpathSoFar()` löst Symlinks so weit auf, wie der Pfad existiert — sonst würde ein Link
im erlaubten Bereich nach draussen führen. Verifiziert: ein Symlink auf `/tmp` im
Schreibbereich wird abgelehnt, es entsteht keine Datei in `/tmp`.

Die Bereiche werden beim Start auf Existenz geprüft. Ein Tippfehler wie
`/templates/projekt` (statt `templates/projekt`) führt nicht mehr zu einer stillen
Fehlkonfiguration, sondern zu einem Korrekturvorschlag.

**Für `execute_command` gilt der Schreibbereich nur als Startverzeichnis, nicht als
Grenze.** Deshalb hat er eine eigene Freigabefrage beim Sitzungsstart.

---

## 8. Freigabestufen

Beim Start werden drei Fragen gestellt:

1. Lesen ohne Rückfrage?
2. Dateien erstellen/überschreiben ohne Rückfrage?
3. Shell-Befehle ohne Rückfrage?

Frage 3 kann auf „Nein" bleiben, während 1 und 2 freigegeben sind. Dann laufen
Allowlist-Befehle trotzdem ohne Rückfrage — alles andere landet im Dialog, mit
Begründung, warum es dort gelandet ist.

`--yes` hebt sämtliche Rückfragen auf und ist nur für nicht-interaktive Testläufe gedacht.

---

## 9. Loop-Breaker

Kein Sicherheits-, sondern ein Schadensbegrenzungsmechanismus: Wiederholt der Agent
denselben Aufruf, greift `LoopBreaker` und gibt den Grund als Werkzeugergebnis zurück,
statt die Sitzung abzubrechen. Verhindert, dass eine Fehlschleife unbemerkt Hunderte
Aufrufe erzeugt. Blockierte Aufrufe bleiben auch im stillen Modus sichtbar.

---

## 10. Testabdeckung

`tests/test-guard.js` — 177 Prüfungen, alle grün, darunter:

- 10 Injektionsversuche (`;`, `&&`, `|`, `>`, `<`, `$( )`, Backtick, `${}`, `&`, Zeilenumbruch)
- 7 harmlose Befehle, die durchgehen müssen
- 5 gefährliche Optionen
- 5 nicht gelistete Programme → Dialog
- 4 schreibende git-Unterbefehle → Dialog
- 3 Umgehungen über Programmpfad
- Parser: Anführungszeichen, unbalancierte Zeichen, keine Variablenexpansion
- 9 Fälle Geheimnis-Erkennung
- 8 Fälle Pfad-Erkennung
- 7 Fälle Umgebungssäuberung

Zusätzlich End-to-End gegen die echte API verifiziert: Injektion, `.ssh`-Zugriff,
`.env`-Sperre, `--allow-secrets`, Schlüsselvererbung.
