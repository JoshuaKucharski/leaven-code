# Feature: git kontrolliert auf die Allowlist zurückholen

**Status:** offen, nicht umgesetzt
**Angelegt:** 2026-07-21
**Betrifft:** `config/commands.json`, `src/guards/commandGuard.ts`, `src/index.ts`

Dieses Dokument steht für sich allein — es setzt keine Kenntnis des Gesprächs voraus, aus
dem es entstanden ist.

---

## Ausgangslage

`git` stand kurzzeitig auf der Allowlist (lief also ohne Rückfrage), beschränkt auf
lesende Unterbefehle: `status diff log show branch ls-files rev-parse blame shortlog`.
Es wurde am 2026-07-21 wieder entfernt. git funktioniert weiterhin, jede Ausführung geht
aber über den Freigabe-Dialog.

## Warum git entfernt wurde

**Nicht** wegen Netzwerkzugriffs. Die freigegebenen Unterbefehle können kein Netzwerk —
`fetch`, `pull`, `push`, `clone`, `remote` und `submodule` waren nie freigegeben. Die
naheliegende Sorge („verbindet sich mit fremden Repositories, schickt Code hinaus") war
mit dieser Liste nicht erreichbar.

Der Grund ist ein anderer. Aus `git help config`:

> **diff.external**
> If this config variable is set, diff generation is not performed using the internal
> diff machinery, but using the given command.

Diese Variable steht in der **repository-eigenen** `.git/config`. Ein `git diff`,
`git show` oder `git blame` in einem fremden oder manipulierten Repository startet damit
ein beliebiges Programm — **ohne jede Netzwerkverbindung**. Dieselbe Wirkung haben
`core.pager` und `textconv`-Filter aus `.gitattributes`.

Das Sperren der Option `-c` auf der Kommandozeile half nicht: Die Konfiguration kommt
nicht von der Kommandozeile, sondern aus dem Repository.

## Warum eine Remote-Allowlist allein nicht genügt

Eine Liste erlaubter Remote-URLs adressiert Abfluss und fremde Repositories — also genau
das, was man zuerst befürchtet. Sie adressiert **nicht** `diff.external`, weil dort kein
Netzwerk im Spiel ist.

Würde git allein wegen einer Remote-Allowlist zurück auf die Allowlist geholt, bliebe das
eigentliche Loch offen und das Ergebnis wäre gefährlicher als der jetzige Zustand: eine
Schutzmassnahme, die Sicherheit suggeriert, ohne den relevanten Weg zu schliessen.

**Alle fünf Bausteine unten gehören zusammen. Teilumsetzung genügt nicht.**

---

## Baustein 1 — Härtungsflags, von der CLI injiziert

Die Flags müssen von leaven-cli in die Argumentliste eingefügt werden, **bevor**
`execFile` aufgerufen wird. Sie dürfen nicht vom Modell erwartet werden — ein Modell, das
sie vergisst oder ein Angreifer, der sie weglässt, hebt den Schutz sonst auf.

Belegt in der git-Dokumentation (git 2.49.0):

| Flag | Wirkung laut Doku |
|---|---|
| `git --no-pager` (`-P`) | kein Pager, damit `core.pager` nicht greift |
| `git diff --no-ext-diff` | „Disallow external diff drivers." |
| `git diff --no-textconv` | „disallow external text conversion filters to be run" |

`--no-ext-diff` und `--no-textconv` gelten für `diff`, `show`, `log -p` und `blame`.
Für jeden freigegebenen Unterbefehl ist zu prüfen, welche der Flags er akzeptiert —
ein nicht unterstütztes Flag lässt git mit Fehler abbrechen.

**Abnahme:** Ein Testrepository mit `diff.external = /bin/echo PWNED` in `.git/config`
darf bei `git diff` kein `PWNED` erzeugen.

## Baustein 2 — Umgebung

Ergänzt `scrubEnvironment()` in `src/guards/commandGuard.ts`:

```
GIT_CONFIG_NOSYSTEM = 1          System-Konfiguration ignorieren
GIT_CONFIG_GLOBAL   = /dev/null  Benutzer-Konfiguration ignorieren
GIT_EXTERNAL_DIFF   entfernen    Umgebungs-Variante von diff.external
GIT_PAGER           entfernen    Umgebungs-Variante von core.pager
GIT_ATTR_NOSYSTEM   = 1          systemweite gitattributes ignorieren
```

Die repository-lokale `.git/config` lässt sich damit **nicht** abschalten — dafür sind
Baustein 1 und 5 zuständig.

**Abnahme:** `GIT_EXTERNAL_DIFF=/bin/echo git diff` darf keine Wirkung zeigen.

## Baustein 3 — Unterbefehl-Filter

Wie zuvor, über `allowSubcommands` in `config/commands.json`:

```
status diff log show branch ls-files rev-parse blame shortlog
```

Alles andere → Freigabe-Dialog. Der Mechanismus existiert bereits in `checkCommand()`
und muss nur wieder befüllt werden.

**Abnahme:** `git push`, `git clean -fdx`, `git checkout` landen im Dialog.

## Baustein 4 — Remote-Allowlist

Erlaubte URLs in `config/commands.json`, z.B.:

```jsonc
"git": {
  "allowedRemotes": ["https://github.com/meinname/", "git@github.com:meinname/"]
}
```

Zu prüfen sind **zwei** Wege, sonst ist die Liste wirkungslos:

1. **Konfigurierte Remotes** des Repositories (`.git/config`, Abschnitte `[remote "…"]`).
2. **URLs in den Argumenten** — `git fetch https://fremd.tld/repo.git` umgeht die
   konfigurierten Remotes vollständig. Jedes Argument, das wie eine URL oder ein
   SSH-Ziel aussieht (`schema://…`, `user@host:pfad`), muss gegen die Liste laufen.

Zusätzlich gesperrt bleiben: `remote add`, `remote set-url`, `submodule` (eigene URLs in
`.gitmodules`), `clone`.

Netzwerk-Unterbefehle bleiben ausserhalb von `allowSubcommands`, solange dieser Baustein
nicht steht — die Allowlist ist die Voraussetzung dafür, `fetch`/`pull` überhaupt je
freizugeben.

**Abnahme:** `git fetch https://fremd.tld/x.git` wird abgelehnt, auch wenn ein erlaubtes
Remote konfiguriert ist.

## Baustein 5 — Repository-Konfiguration prüfen

Vor jeder git-Ausführung die `.git/config` des betroffenen Repositories lesen und bei
folgenden Schlüsseln ablehnen:

```
diff.external
core.pager
core.fsmonitor
core.sshCommand
filter.*.clean / filter.*.smudge / filter.*.process
diff.*.textconv / diff.*.command
credential.helper
```

Ablehnung mit klarer Begründung, damit erkennbar ist, dass das **Repository** die Ursache
ist, nicht die CLI.

**Abnahme:** Repository mit `core.fsmonitor = /bin/sh` → jeder git-Aufruf wird abgelehnt.

---

## Offene Punkte für die Umsetzung

- **`.gitattributes`** kann `textconv`-Filter pro Dateimuster setzen. Baustein 1 sollte
  das abdecken (`--no-textconv`), ist aber gegenzuprüfen — auch für `git log -p` und
  `git blame`, wo das Flag möglicherweise anders heisst oder fehlt.
- **Worktrees und Submodule** haben eigene Konfigurationsdateien. Baustein 5 muss den
  tatsächlich wirksamen Konfigurationspfad ermitteln (`git rev-parse --git-dir`) — was
  wiederum ein git-Aufruf ist. Henne-Ei-Problem: Der Ermittlungsaufruf selbst muss mit
  vollständiger Härtung laufen.
- **Version:** Flagnamen und Konfigurationsschlüssel können sich zwischen git-Versionen
  unterscheiden. Beim Start einmal `git --version` prüfen und bei unbekannt neuen oder
  sehr alten Versionen konservativ auf den Dialog zurückfallen.
- **Andere Programme mit demselben Muster.** git ist nicht der Einzelfall — `rg --pre`,
  Editoren, Formatierer und Test-Runner laden ebenfalls Konfiguration mit
  Ausführungspfaden. Die hier entwickelte Prüflogik sollte wiederverwendbar sein.

## Aufwandseinschätzung

Grob: Baustein 1–3 sind je überschaubar (Argumentaufbau, Umgebung, vorhandene
Konfiguration). Baustein 4 und 5 sind der Hauptteil, weil sie git-Interna lesen und
mehrere Umgehungswege abdecken müssen. Realistisch eine eigene Arbeitseinheit mit
Testrepositories für jeden Angriffsweg.

## Bis dahin

git bleibt von der Allowlist gestrichen. Jeder git-Aufruf erscheint im Freigabe-Dialog
mit dem vollständigen Befehl. Der Schutz ist damit der Mensch davor — was für
gelegentliche git-Nutzung angemessen ist, aber nicht für einen Agenten, der viel mit git
arbeiten soll.
