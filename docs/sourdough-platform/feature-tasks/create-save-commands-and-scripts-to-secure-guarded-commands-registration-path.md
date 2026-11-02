# Gesicherte Befehls-/Skript-Registrierung — die Pfade

**Stand:** 2026-07-23
**Feature:** [../../security/command-registration.md](../../security/command-registration.md)

Dieses Dokument hält die **Pfade** fest, an denen die freigabefreien Befehle und Skripte
liegen — und die Regel, dass der KI-Assistent sie zwar **kennt**, aber **nicht überschreiben,
verschieben oder ändern** kann.

---

## Die Pfade

Alle liegen unter `~/.leaven` — einem Verzeichnis auf der Geheimnis-Sperrliste
(`config/commands.json` → `secretDirectories`). Über seine Datei-Werkzeuge (`read_file`,
`write_file`, `edit_file`, `copy_file`) kommt der Assistent dort **weder lesend noch
schreibend** hinein; `securePath()` lehnt jeden Zugriff ab.

| Pfad | Inhalt | Assistent |
|---|---|---|
| `~/.leaven/allowed-commands.json` | freigegebene vollständige Befehle (exakter Abgleich) | **kennt** (Manifest), ändert nicht |
| `~/.leaven/approved-scripts/` | freigegebene Shell-Skripte, unveränderbar | **kennt**, ändert nicht |
| `~/.leaven/requested-commands/` | Vorschläge des Assistenten (Eingang) | schlägt vor (über Werkzeug), gewährt nichts |

## Warum der Assistent sie kennt, aber nicht ändern kann

- **Kennen:** Der Systemprompt enthält ein aus dem echten Zustand erzeugtes **Manifest** —
  welche Befehle/Skripte ohne Rückfrage laufen. Der Assistent muss die Dateien also nicht
  lesen, um sie zu kennen.
- **Nicht ändern:** `~/.leaven` ist gesperrt. Der einzige schreibende Weg für den
  Assistenten ist das Werkzeug `propose_command`, und das schreibt **ausschließlich** in
  `requested-commands/` — den Eingang, der **nichts** freigibt. Die **CLI** führt diesen
  Schreibvorgang aus (voller Dateizugriff), nicht das Modell; der übergebene Name wird streng
  sanitisiert, sodass kein Ausbruch aus dem Eingang möglich ist.

## Die Freigabe bleibt beim Menschen

Ein Vorschlag wird erst wirksam, wenn **du** ihn prüfst und verschiebst:

```
~/.leaven/requested-commands/<name>.json   (Vorschlag)
        │  du prüfst
        ▼
Befehl → Zeile in ~/.leaven/allowed-commands.json
Skript → Datei nach ~/.leaven/approved-scripts/<name>.sh
         + Zeile "bash ~/.leaven/approved-scripts/<name>.sh" in allowed-commands.json
```

## Footgun-Schutz beim Laden

Beim Start prüft `registryEintragErlaubt()` jeden Eintrag: Ein registriertes Shell-Skript
(`bash`/`sh`/`zsh`/`dash`/`ksh`) wird nur akzeptiert, wenn das Skript **innerhalb**
`~/.leaven` liegt. Ein versehentlich eingetragenes `bash /projekt/x.sh` (das der Assistent
umschreiben könnte) wird **verworfen und gewarnt** — es läuft dann weiter nur mit Freigabe.

## Beispiel `allowed-commands.json`

```jsonc
[
  "php artisan view:clear",
  "php artisan view:cache",
  "php artisan julalo",
  "bash ~/.leaven/approved-scripts/full-check.sh"
]
```
