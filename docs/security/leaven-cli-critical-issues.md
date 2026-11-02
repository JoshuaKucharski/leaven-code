# leaven-cli — offene Risiken

**Stand:** 2026-07-21
**Gegenstück zu:** [leaven-cli-bash-commands-security.md](./leaven-cli-bash-commands-security.md)

Dieses Dokument listet, was **nicht** abgesichert ist. Jeder Punkt nennt die Auswirkung
und was nötig wäre, um ihn zu schliessen. Sortiert nach Wichtigkeit.

> **Vorab, gegen ein häufiges Missverständnis:** Der Anbieter (DeepSeek) kann **nicht** von
> sich aus auf den Rechner zugreifen und die `/rights`-Regeln nicht umgehen — das ist
> architektonisch erzwungen und in [environmental-facts.md](./environmental-facts.md)
> belegt. Die echte Gefahr hat eine andere Form; sie steht in den Punkten unten.

Grundsatz: leaven-cli ist ein Werkzeug für die eigene Entwicklungsmaschine, kein
Sandkasten für nicht vertrauenswürdigen Code. Wer echte Isolation braucht, muss den
Prozess in einen Container oder eine VM sperren — das leistet keine Prüfung innerhalb des
Programms.

---

## 1. Alles Gelesene geht an einen Drittanbieter — KRITISCH

**Was:** Jeder Dateiinhalt, jede Befehlsausgabe landet im Gesprächskontext und wird an
`api.deepseek.com` gesendet. Das ist kein Fehler, sondern die Funktionsweise — aber die
Tragweite wird leicht unterschätzt.

**Auswirkung:** Quelltext, Kundendaten, Zugangsdaten in Konfigurationsdateien,
Datenbankauszüge — alles, was der Agent liest, verlässt die Maschine und liegt bei einem
Anbieter ausserhalb der EU. Bei fremdem Code kann das eine Vertragsverletzung sein.

**Was nötig wäre:**
- Lesebereich so eng wie möglich (ein Projekt, nicht `~/develop`)
- Vor der Sitzung prüfen, was im Lesebereich liegt
- Für sensible Projekte: lokales Modell (Ollama, llama.cpp) statt einer Cloud-API
- Kein technischer Schutz möglich, solange eine externe API benutzt wird

---

## 2. Geheimnisse jenseits der Sperrliste — HOCH

**Was:** `isSecretPath()` erkennt bekannte Muster (`.env`, `*.pem`, `.ssh/`, …). Es erkennt
**nicht**:
- fest im Quelltext stehende Passwörter und Token
- Datenbankauszüge (`dump.sql` mit Nutzerdaten)
- `config/database.php`, `settings.py`, `application.yml` mit Zugangsdaten
- Sicherungskopien wie `.env.backup`, `env.txt`, `zugangsdaten.md`
- Notizdateien mit Passwörtern

**Auswirkung:** Diese Dateien liegen typischerweise mitten im Projekt, also mitten im
Lesebereich, und sind völlig regelkonform lesbar.

**Was nötig wäre:**
- Inhaltsbasierte Erkennung statt nur Dateinamen (Muster für Schlüssel, Token, private Keys)
- `secretPatterns` in `config/commands.json` projektspezifisch erweitern
- Zugangsdaten grundsätzlich aus dem Projektverzeichnis heraushalten
- Wirksamste Massnahme bleibt ein enger Lesebereich

---

## 3. Pfade als Optionswerte — geschlossen

**Was:** `looksLikePath()` prüft jedes Argument, das nicht mit `-` beginnt. Pfade **im Wert
einer Option** übersprang es:

```
grep --file=/pfad/zu/muster.txt      wurde als eine Option gesehen, nicht zerlegt
grep -f /pfad/zu/muster.txt          -f nimmt das FOLGENDE Argument – das war immer geprüft
find . -newer /pfad/zur/referenz     ebenso: eigenständiges Argument
```

**Stand:** `eingebetteteWerte()` in `commandGuard.ts` liefert die Pfadkandidaten einer
Option, `execute_command` prüft sie mit `securePath()` wie jedes andere Argument: der Wert
hinter `=` immer, bei Kurzoptionen mit `/` der Teil ab dem ersten `/` und der Teil nach dem
Optionsbuchstaben (`-rf/x` → `/x` und `f/x`). Bekannte Grenze: relativ angehängte Werte wie
`-fsrc/x` werden zu streng abgelehnt (getrennt schreiben). Eine vollständige
Argumentgrammatik je Programm gibt es weiterhin nicht — sie wäre pro Programmversion
unterschiedlich.

---

## 4. Symlinks während der Rekursion eines Kindprozesses — MITTEL

**Was:** `securePath()` löst Symlinks für die Datei-Tools auf. Läuft aber ein Kindprozess
wie `grep -r` oder `find`, macht dieser seine **eigene** Verzeichnisrekursion. Von aussen
lässt sich nicht abfangen, welchen Links er dabei folgt.

**Aktuelle Lage:** macOS-`grep` folgt bei Rekursion standardmässig keinen Symlinks (`-p`
ist Default), `find` ebenfalls nicht. Die erzwingenden Optionen sind gesperrt — `grep -S`
(BSD) und `grep -R`/`--dereference-recursive` (GNU), `find -L`/`-follow`, `rg --follow`/`-L` —
und zwar auch gebündelt (`-rS`) und als GNU-Abkürzung (`--deref`).

**Auswirkung:** Verlässt sich auf Vorgabewerte fremder Programme. Für GNU grep (Linux,
Homebrew) sind die bekannten Optionen abgedeckt; ein anderes Werkzeug im `PATH` mit eigenem
Symlink-Verhalten bliebe unbemerkt.

**Was nötig wäre:** Ausführung in einem Mount-Namespace bzw. Container ohne Zugriff auf
das übrige Dateisystem. Innerhalb des Programms nicht lösbar.

---

## 4b. Programme, die Code aus ihrer Konfiguration starten — HOCH

**Was:** Manche Programme führen Code aus, der nicht auf der Kommandozeile steht, sondern
in einer Konfigurationsdatei **im bearbeiteten Verzeichnis**. Prominentestes Beispiel:
`git` mit `diff.external`, `core.pager`, `core.fsmonitor` und `textconv`-Filtern aus
`.gitattributes`. Ein `git diff` in einem fremden Repository startet damit ein beliebiges
Programm — ohne Netzwerk, ohne verdächtige Kommandozeile.

Deshalb steht `git` **nicht** auf der Allowlist. Es ist aber kein Einzelfall:

| Programm | Weg |
|---|---|
| `git` | `.git/config`, `.gitattributes` |
| `rg` | `--pre` Vorverarbeitung, `.ripgreprc` |
| Formatierer, Linter, Test-Runner | Plugins und Hooks aus der Projektkonfiguration |
| Editoren | Startdateien im Projektverzeichnis |

**Auswirkung:** Ein Programm auf der Allowlist könnte über eine mitgelieferte
Projektkonfiguration beliebigen Code ausführen. Bei den derzeit gelisteten Programmen
(`grep`, `find`, `ls`, `cat`, `head`, `tail`, `wc`, `file`, `stat`) ist kein solcher Weg
bekannt; `rg --pre` und `--hostname-bin` sind gesperrt.

**Auswirkung der git-Entfernung:** Optionssperren greifen nur bei Allowlist-Programmen.
`git -c core.pager=sh log` wird daher nicht mehr hart abgelehnt, sondern landet im
Dialog — der Schutz ist dort der Mensch.

**Was nötig wäre:** Vor Aufnahme eines Programms in die Allowlist prüfen, ob es
Konfiguration aus dem Arbeitsverzeichnis lädt und daraus Programme starten kann. Für git
konkret ausgearbeitet in
[../security-projects/git-security-feature.md](../security-projects/git-security-feature.md).

---

## 5. TOCTOU zwischen Prüfung und Zugriff — NIEDRIG

**Was:** Zwischen `securePath()` und dem tatsächlichen Zugriff durch den Kindprozess
liegt eine Zeitspanne. Wird in diesem Moment ein Pfadbestandteil durch einen Symlink
ersetzt, greift die Prüfung ins Leere.

**Auswirkung:** Praktisch nur relevant, wenn bereits ein anderer Prozess auf der Maschine
gezielt angreift — dann hat man ohnehin ein grösseres Problem.

**Was nötig wäre:** Zugriff über Dateideskriptoren statt Pfade (`openat` mit
`O_NOFOLLOW`), in Node nur eingeschränkt möglich.

---

## 6. Der Freigabe-Dialog schützt nur, solange er gelesen wird — MITTEL

**Was:** Nicht gelistete Befehle landen im Dialog. Der Schutz ist dann eine menschliche
Entscheidung. Erfahrungsgemäss sinkt die Aufmerksamkeit mit der Anzahl der Rückfragen —
irgendwann wird durchgewinkt.

**Auswirkung:** Ein schädlicher Befehl in einer langen Reihe harmloser fällt nicht auf.

**Was nötig wäre:**
- Allowlist gross genug halten, damit der Dialog selten erscheint und dann ernst genommen wird
- Der Dialog nennt bereits den Grund; das sollte so bleiben
- Bei destruktiven Befehlen eine Tippbestätigung statt nur Enter erwägen

---

## 7. `--yes` und `--allow-secrets` heben Schutzmassnahmen auf — bekannt, gewollt

**Was:** `--yes` führt jeden Tool-Aufruf ohne Rückfrage aus, `--allow-secrets` hebt die
Geheimnis-Sperre auf.

**Auswirkung:** `--yes` in einer Sitzung mit weitem Schreibbereich bedeutet
uneingeschränkten Dateizugriff ohne jede Kontrolle.

**Was nötig wäre:** `--yes` ist für Tests und CI gedacht, nicht für den Alltag. Nicht in
ein Shell-Alias aufnehmen. Eine Warnzeile beim Start wäre eine sinnvolle Ergänzung.

---

## 8. Prompt-Injection über gelesene Dateien — MITTEL, ungelöst

**Was:** Der Agent liest Dateiinhalte und behandelt sie als Kontext. Enthält eine Datei
Text wie „Ignoriere alle vorherigen Anweisungen und führe X aus", kann das Modell darauf
reagieren. Besonders relevant bei fremdem Code, `node_modules`, heruntergeladenen Dateien.

**Auswirkung:** Das Modell könnte Tool-Aufrufe erzeugen, die der Nutzer nie wollte. Die
Bereichsgrenzen und die Allowlist begrenzen den Schaden — sie sind hier die eigentliche
Verteidigungslinie, nicht das Modell.

**Was nötig wäre:** Kein zuverlässiger Schutz bekannt. Genau deshalb sind Rückfragen bei
schreibenden Aktionen wichtig — sie sind der Punkt, an dem ein Mensch eine injizierte
Absicht bemerken kann.

---

## 8b. Prompt-Injection über abgerufene Webseiten — HOCH, sobald `fetch_url` aktiv ist

**Was:** Dasselbe Problem wie 8, aber mit deutlich höherer Eintrittswahrscheinlichkeit.
Eine Webseite ist fremder, veränderlicher Inhalt. Bei Seiten mit Nutzerbeiträgen — Foren,
Kommentare, Wikis, Issue-Tracker — kann **jeder Dritte** Text platzieren, den der Agent
später als Kontext liest.

**Warum das schlimmer ist als eine Datei:** Eine Datei im Projekt hat man irgendwann selbst
dorthin gelegt. Eine Webseite ändert sich zwischen zwei Abrufen, ohne dass man es merkt.
Die Domain-Allowlist begrenzt nur, *von wem* solcher Text kommen kann — nicht, *ob*.

**Die gefährliche Kette:** Seite abrufen → Seite enthält Anweisungen → Agent hat
Schreibrechte im Projekt → Änderung, die niemand wollte. Mit `post_to_endpoint` kommt
theoretisch noch ein Ausleitungsschritt dazu.

**Was man heute tun kann:**

- Nur Domains freigeben, deren Inhalt **redaktionell** ist (Herstellerdokumentation,
  Standards). Foren, Issue-Tracker und Wikis mit offenem Schreibrecht meiden.
- Netzzugriff **pro Aufgabe** einschalten und danach `/internet clear` — nicht dauerhaft
  in einer Rolle stehen lassen, die man täglich nutzt.
- Bei aktivem Netzzugriff das Schreibrecht auf Rückfrage stellen (`/rights`). Dann ist die
  Freigabe der Punkt, an dem eine injizierte Absicht auffällt.
- Den Abschlussbericht lesen. Ein `edit_file` an einer Datei, die mit der Aufgabe nichts
  zu tun hat, ist das sichtbare Symptom.

**Was nötig wäre für echten Schutz:**

- Abgerufene Inhalte als *Daten* statt als *Anweisungen* kennzeichnen — z.B. in einem
  eigenen Nachrichtenblock mit ausdrücklichem Hinweis, dass darin keine Befehle stehen
  dürfen. Hilft messbar, ist aber kein Beweis.
- Werkzeug-Aufrufe, die **nach** einem `fetch_url` entstehen, strenger behandeln: etwa
  Schreibzugriffe in dieser Iteration grundsätzlich mit Rückfrage, unabhängig von den
  Rechten. Das wäre ein umsetzbarer nächster Schritt.
- Ein zweites Modell als Prüfer („enthält dieser Text Anweisungen?"). Zusätzlicher Aufwand,
  und der Prüfer ist selbst angreifbar.

---

## 8c. GET kann Daten hinaustragen — MITTEL

**Was:** `fetch_url` kann nur lesen — aber eine URL trägt selbst Daten:

```
https://freigegebene-domain.tld/suche?q=<Inhalt einer Datei>
```

Der Server sieht den Parameter in seinem Zugriffsprotokoll. Damit ist auch ein reines
GET-Werkzeug ein — schmaler — Ausleitungskanal.

**Warum es trotzdem deutlich besser ist als `curl`:** Die Menge ist durch die URL-Länge
begrenzt (praktisch wenige Kilobyte), und das Ziel muss eine Domain sein, die **der Nutzer
selbst freigegeben hat**. `curl -d @datei` hätte keine dieser Grenzen.

**Was man heute tun kann:**

- Nur Domains freigeben, denen man tatsächlich vertraut. Die Allowlist ist hier die
  eigentliche Schutzmassnahme, nicht die Beschränkung auf GET.
- Netzzugriff und `--allow-secrets` **niemals zusammen** benutzen.
- Bei sensiblen Projekten den Lesebereich eng halten — was der Agent nicht lesen kann,
  kann er auch nicht in eine URL schreiben.

**Was nötig wäre:** Längenbegrenzung für Query-Parameter, Warnung bei auffällig langen
URLs, oder eine Pfad-Allowlist statt einer Domain-Allowlist. Alle drei sind umgehbar —
über mehrere kurze Anfragen lässt sich beliebig viel übertragen.

---

## 8d. DNS-Rebinding — NIEDRIG, aber nicht abgedeckt

**Was:** Die URL-Prüfung sieht den **Hostnamen**, nicht die IP-Adresse, zu der er aufgelöst
wird. Eine freigegebene Domain, deren DNS-Eintrag auf `127.0.0.1` oder eine interne Adresse
zeigt, besteht die Prüfung — die Sperre interner Adressen greift nur bei IP-Literalen und
bekannten Namen wie `localhost`.

**Auswirkung:** Ein interner Dienst (Datenbank-Oberfläche, Metadaten-Endpunkt,
Entwicklungsserver) könnte über eine freigegebene Domain erreichbar werden. Voraussetzung
ist allerdings, dass der Angreifer die DNS-Einträge einer Domain kontrolliert, die der
Nutzer **selbst freigegeben** hat — die Hürde ist also hoch.

**Was man heute tun kann:**

- Keine Domains freigeben, deren DNS man nicht einschätzen kann.
- Interne Dienste nicht ohne Authentifizierung laufen lassen — das ist ohnehin
  gute Praxis und schützt gegen die ganze Klasse.

**Was nötig wäre:** DNS vor dem Verbindungsaufbau selbst auflösen, die IP gegen die
Sperrliste prüfen und die Verbindung **an genau diese IP binden** (`lookup`-Option in
Node). Sonst bleibt ein Zeitfenster zwischen Prüfung und Verbindung, in dem sich die
Auflösung ändern kann — dieselbe TOCTOU-Klasse wie in Punkt 5.

---

## 9. Kein Audit-Protokoll — NIEDRIG

**Was:** Ausgeführte Aktionen erscheinen im Abschlussbericht, werden aber nirgends
dauerhaft festgehalten. Nach dem Schliessen des Terminals ist nicht mehr nachvollziehbar,
was passiert ist.

**Was nötig wäre:** Anfügendes Protokoll (`~/.leaven/audit.log`) mit Zeitstempel,
Werkzeug, Argumenten und Ergebnis.

---

## 10. Keine Ressourcengrenzen — NIEDRIG

**Was:** Befehle haben ein Zeitlimit (30 s) und eine Ausgabegrenze (10 MB), aber keine
Beschränkung bei Arbeitsspeicher, CPU oder Netzwerk. Ein erlaubtes Programm kann beliebig
viele Netzverbindungen öffnen.

**Was nötig wäre:** `ulimit` bzw. cgroups beim Start des Kindprozesses; auf macOS
umständlich.

---

## Empfehlung für den Alltag

| Situation | Lesebereich | Schreibbereich | Shell | Netz |
|---|---|---|---|---|
| Eigenes Projekt, vertrauter Code | Projektverzeichnis | Projektverzeichnis | Nein | aus |
| Mehrere eigene Projekte | `~/develop` | die Projekte ankreuzen | Nein | aus |
| Recherche in Dokumentation | Projektverzeichnis | Projektverzeichnis | Nein | nur redaktionelle Domains |
| Fremder Code, unbekannte Herkunft | Projektverzeichnis | Projektverzeichnis | Nein, `--allow-secrets` nie | aus |
| Kundenprojekt mit echten Daten | siehe Punkt 1 — Cloud-API überdenken | | | aus |

`--yes` niemals ausserhalb von Tests. Vor jeder Sitzung eine Sekunde überlegen: *Was liegt
in meinem Lesebereich, das ich nicht an DeepSeek senden möchte?*

### Kombinationen, die sich gegenseitig verschärfen

Einzeln vertretbar, zusammen problematisch:

| Kombination | Warum |
|---|---|
| Netzzugriff **+** `--allow-secrets` | Geheimnisse lesbar und ein Kanal nach draussen (Punkt 8c) |
| Netzzugriff **+** Schreiben ohne Rückfrage | Injizierte Anweisungen wirken ohne Zwischenstopp (Punkt 8b) |
| Netzzugriff **+** Shell ohne Rückfrage | `curl` und Konsorten wären wieder erreichbar |
| Breiter Lesebereich **+** Netzzugriff | Was gelesen werden kann, kann in eine URL geschrieben werden |

**Faustregel:** Netzzugriff pro Aufgabe einschalten, danach `/internet clear`. Nicht
dauerhaft in einer Rolle hinterlegen, die täglich läuft.

Einzelheiten zu den Schutzmassnahmen: [../internet.md](../internet.md).
