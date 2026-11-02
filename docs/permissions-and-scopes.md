# Berechtigungen und Bereiche

**Stand:** 2026-07-21
**Umgesetzt in:** `askPermissions()`, `askForRoot()`, `isAutoApproved()` in `src/index.ts`

## Zwei getrennte Bereiche

| Bereich | Anzahl | Zweck | Typisch |
|---|---|---|---|
| **Lesebereich** | genau einer | worin gelesen und gesucht werden darf | breiter, z.B. `~/develop` |
| **Schreibbereiche** | beliebig viele | worin geändert werden darf | die Projekte, an denen gearbeitet wird |

Die Trennung erlaubt es, dem Agenten Überblick zu geben, ohne dass er ausserhalb der
aktuellen Projekte etwas kaputt machen kann.

**Warum Lesen nur ein Verzeichnis ist:** Relative Pfade werden gegen den Lesebereich
aufgelöst. Bei einer Liste gäbe es keinen eindeutigen Bezugspunkt — und genau diese
Mehrdeutigkeit hat in diesem Projekt schon zweimal Fehler verursacht (siehe
[tools.md](./tools.md), Abschnitt Pfadsemantik).

**Warum Schreiben mehrere sind:** Wer an zwei Projekten arbeitet, musste sonst das
gemeinsame Elternverzeichnis freigeben — und damit auch alles andere darunter. Eine
Mehrfachauswahl ist also **restriktiver** als der frühere Behelf, nicht lockerer.

## Projektauswahl per Checkbox

Beim Start erscheint eine Auswahlliste über die Unterverzeichnisse des Lesebereichs:

```
  Welche Projekte sollen SCHREIBRECHTE bekommen?
[x] config   (zuletzt gewählt)
[ ] dist
[x] docs   (zuletzt gewählt)
[ ] src
[ ] — ALLE Verzeichnisse (inkl. Dateien direkt darin) —
    ⚠️  Gibt auch Verzeichnisse frei, die später entstehen
────────────────────────────────────────────────────────────
↑↓ navigieren · Leertaste an/aus · ⏎ bestätigen · a alle abwählen · leer = Pfad tippen
```

Versteckte Verzeichnisse und `node_modules` werden ausgeblendet. Ohne Auswahl (Enter bei
leerer Liste) fällt die CLI auf die Pfadeingabe mit `askForRoot()` zurück — inklusive
Existenzprüfung, Korrekturvorschlag und `?`-Navigation.

Der Eintrag **ALLE Verzeichnisse** setzt den Lesebereich selbst als Schreibbereich. Das
schliesst Dateien direkt darin ein und auch Unterverzeichnisse, die später entstehen — die
breite Option, nicht eine Abkürzung für „die, die ich gerade sehe".

### Gemerkte Auswahl

Die Auswahl wird in `~/.leaven/scopes.json` gespeichert, **pro Arbeitsverzeichnis**:

```json
{
  "/Users/myki/develop/platforms/leaven/leaven": ["config", "docs"]
}
```

Beim nächsten Start sind dieselben Projekte vorausgewählt und mit `(zuletzt gewählt)`
markiert; darüber steht „Vorauswahl aus der letzten Sitzung geladen". So werden nie
unbemerkt Schreibrechte übernommen.

Nicht-interaktiv nimmt `--write-root` mehrere Pfade, durch Komma getrennt:

```bash
node dist/index.js --read-root ~/develop --write-root projekt-a,projekt-b
```

## Der Startdialog

Beim Start werden **nur die Bereiche** abgefragt — keine Rechtefragen:

```
   Bei Pfaden übernimmt Enter den Vorschlag in [Klammern], "?" zeigt eine Auswahl.

  Lesebereich   [~/develop/projekt] (? = Auswahl): _

  Welche Projekte sollen SCHREIBRECHTE bekommen?   (Checkbox-Auswahl, siehe oben)

  Ergebnis:
    Lesen     ~/develop/projekt            ohne Rückfrage
    Schreiben ~/develop/projekt/projekt-a  ohne Rückfrage
    Shell                                  mit Rückfrage
```

### Vorgaben

| Recht | Vorgabe | Begründung |
|---|---|---|
| Lesen | **ohne Rückfrage** | Nur Lesen, auf den Lesebereich begrenzt |
| Schreiben | **ohne Rückfrage** | Die Checkbox-Auswahl der Projekte *ist* die bewusste Zustimmung |
| Shell-Befehle | **mit Rückfrage** | Nicht auf ein Verzeichnis begrenzbar; Allowlist-Befehle laufen ohnehin ohne |

Nichts wird still gesetzt: Die Zusammenfassung zeigt die geltenden Rechte vor der ersten
Eingabe.

## `/rights` — Rechte ändern

`/rights` stellt zusätzlich zu den Bereichen die drei Rechtefragen. Die Vorgabe in eckigen
Klammern ist immer der **aktuelle** Wert, Enter ändert also nie etwas:

```
  → Alles LESEN ab hier ohne Rückfrage? [Y/n]:
  → Dateien ERSTELLEN und ÜBERSCHREIBEN ohne Rückfrage? [Y/n]:

  Lesende Befehle (grep, rg, find, …) laufen immer ohne Rückfrage –
  sie werden ohne Shell gestartet und auf den Lesebereich begrenzt.

  ⚠️  Diese Frage betrifft ALLE ÜBRIGEN Befehle (rm, npm, curl, git …).
      Deren Wirkung lässt sich nicht zuverlässig begrenzen.
  → Auch diese ohne Rückfrage ausführen? [y/N]:
```

Akzeptiert werden `y`/`yes` und `j`/`ja` bzw. `n`/`no`/`nein`.

Damit lassen sich Shell-Rechte gezielt für die Dauer einer Aufgabe einschalten und
danach wieder abschalten, statt sie bei jedem Start zu bestätigen.

### Wichtig: „Nein" heisst „vorher fragen", nicht „verboten"

Die drei Antworten steuern nur, ob **gefragt** wird. Die Bereichsgrenzen gelten immer —
auch für einen Aufruf, den man im Dialog freigegeben hat, und auch bei `--yes`.
Verifiziert: eine Datei ausserhalb des Schreibbereichs überlebt ein `rm -rf`, obwohl
`--yes` gesetzt war.

## Verzeichniswahl

`askForRoot()` kehrt erst zurück, wenn ein **existierendes Verzeichnis** feststeht.

**Existenzprüfung.** Ein nicht existierendes Verzeichnis wurde früher kommentarlos
übernommen; jeder spätere Schreibzugriff scheiterte dann unerklärlich. Das ist der Grund
für diese Prüfung.

**Korrekturvorschlag** beim häufigsten Tippfehler — führender Schrägstrich:

```
Schreibbereich [~/develop] (? = Auswahl): /templates/projekt

  ✗ /templates/projekt existiert nicht.
    Meintest du ~/develop/templates/projekt? [Y/n]:
```

**Auswahlliste** mit `?`, schrittweise navigierbar:

```
Schreibbereich [~/develop] (? = Auswahl): ?
      1) leaven-cli
      2) templates
  Nummer (Enter = ~/develop): 2
      1) julalo-ui-components
  Nummer (Enter = ~/develop/templates): 1
```

Versteckte Verzeichnisse und `node_modules` werden ausgeblendet, ab 30 Einträgen wird
gekürzt und das vermerkt.

**Relative Eingaben zählen ab dem angezeigten Vorschlag**, nicht ab `process.cwd()`.
Andernfalls verspricht der Prompt etwas anderes, als der Code tut.

**Schreibbereich ausserhalb des Lesebereichs** verlangt eine ausdrückliche Bestätigung.
Eine blosse Warnzeile ging im Startgetümmel unter.

## Wer läuft ohne Rückfrage?

`isAutoApproved(call)` entscheidet:

```
--yes gesetzt                       -> alles
read_file, list_files               -> Leserecht
write_file, edit_file, copy_file    -> Schreibrecht
execute_command                     -> Shell-Recht ODER Programm auf der Allowlist
update_plan, propose_command        -> immer ohne Rückfrage (führen nichts aus)
unbekanntes Werkzeug                -> immer fragen
```

`propose_command` schlägt nur einen Befehl/ein Skript zur Freigabe vor (Eingang
`~/.leaven/requested-commands/`) — es führt nichts aus und gewährt nichts, daher die
Auto-Freigabe. Die eigentliche Freigabe erteilt ein Mensch durch Verschieben in die Registry;
siehe [security/command-registration.md](./security/command-registration.md).

`copy_file` liegt auf der **Schreib**-Achse (es liest die Quelle und schreibt das Ziel;
`securePath` prüft beides). **Kopieren gehört damit zum Schreibrecht, nicht zur Shell-Achse.**
Das ist der Grund, warum `cp` — ein Shell-Befehl — bisher bei jedem Backup nachfragte:
`cp` läuft über `execute_command` und damit über das Shell-Recht. Neu wird ein `cp`-Aufruf
automatisch auf `copy_file` umgeleitet und braucht keine Rückfrage mehr (siehe
[tools.md](./tools.md) → `copy_file`).

Bei `execute_command` gilt zusätzlich: Ein Befehl, der ohnehin abgelehnt (`reject`) oder auf
ein besseres Werkzeug umgeleitet wird (`redirect`, z.B. `cp` → `copy_file`), geht **nicht**
in den Dialog — die Begründung bzw. der Hinweis wandert direkt ans Modell zurück, statt den
Nutzer mit einer Frage zu behelligen.

Ebenfalls ohne Dialog läuft das Verdict **`allow`**: vom Menschen in
`~/.leaven/allowed-commands.json` **vorregistrierte** vollständige Befehle (exakter
Abgleich) sowie der enge, ausführungsfreie `php -l`-Syntax-Check. Beides gibt es, damit die
ständig gebrauchten Prüf-Befehle nicht bei jedem Lauf nachfragen, **ohne** einen Interpreter
wie `php` pauschal freizugeben. Die Registry liegt bewusst in `~/.leaven` (für das Modell
gesperrt) — nur der Mensch pflegt sie. Details in
[security/leaven-cli-bash-commands-security.md](./security/leaven-cli-bash-commands-security.md).

## Prüfmassstab für Befehlsargumente

| Befehl | Argumente geprüft gegen | Begründung |
|---|---|---|
| auf der Allowlist | Lesebereich | ausschliesslich lesende Werkzeuge |
| nicht auf der Allowlist | **einen der Schreibbereiche** | Wirkung unbekannt (`rm`, `npm`, `git` …) |

Ohne diese Trennung käme `rm -rf src/` durch, solange `src/` im Lesebereich liegt.

## Rollen statt wiederholtem Setup

Wer dieselben Bereiche regelmässig braucht, speichert sie als Rolle und aktiviert sie mit
`/role use <name>`. Siehe [roles.md](./roles.md).

## Geheimnis-Sperre

Unabhängig von den Bereichen gesperrt, konfiguriert in `config/commands.json`:

```
.env, .env.*, *.pem, *.key, id_rsa*, id_ed25519*, id_ecdsa*, .npmrc, .netrc,
.pgpass, *.p12, *.pfx, *.keystore, *credentials*, *.kdbx
Verzeichnisse: .ssh, .aws, .gnupg, .config/gcloud, .leaven
```

Gilt für **alle** Zugriffe, auch `read_file`. Grund: Eine `.env` im eigenen Projekt ist
sonst regelkonform lesbar — und ihr Inhalt ginge an die DeepSeek-API. Aufhebbar mit
`--allow-secrets` als bewusste Entscheidung beim Start.

## Stiller Modus

Aktiv, sobald Lesen **und** Schreiben freigegeben sind. Abschaltbar mit `--verbose`.

Unterdrückt Zwischentexte und Werkzeugausgaben, zeigt am Ende:

```
📋 Ausgeführt (3 Aktionen):
   👁 read_file       templates/projekt/home.blade.php
   ✎ edit_file       templates/projekt/layout.blade.php
   ⏭ write_file      abgelehnt

<Abschlussbericht des Modells>
```

Blockierte (`🛑`) und abgelehnte (`⏭`) Aktionen erscheinen **immer**, auch im stillen
Modus.

## Empfehlung

| Situation | Lesebereich | Schreibbereiche | Shell |
|---|---|---|---|
| eigenes Projekt | Projektverzeichnis | Projektverzeichnis | n |
| mehrere eigene Projekte | Elternverzeichnis | genau die Projekte ankreuzen | n |
| fremder Code | Projektverzeichnis | Projektverzeichnis | n, `--allow-secrets` nie |

Bei mehreren Projekten die Checkbox-Auswahl nutzen statt „ALLE Verzeichnisse" — sonst ist
alles darunter freigegeben, auch was später entsteht.

`--yes` niemals ausserhalb von Tests.
