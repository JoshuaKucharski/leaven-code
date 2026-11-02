# commands-and-settings — was man im Terminal eingeben & einstellen kann

**Stand:** 2026-07-30. Vollständige Referenz aller Eingaben, Befehle und Einstellungen.
Vertiefung: [../configuration.md](../configuration.md), [./features.md](./features.md).

## Slash-Befehle (während der Sitzung)

| Befehl | Was er macht |
|---|---|
| `/help` | Alle Befehle + Bedienung anzeigen |
| `/status` | Aktueller Stand: Modell, Thinking, Denktiefe/Temperature, Anzeige (Gedanken/Schritte), Budget, Auto-weiter, Bereiche, API-Key |
| `/rights` | Rechte anzeigen/ändern: **Lesen**, **Schreiben**, **Shell-Befehle** (je an/aus). Enter behält den Wert |
| `/model <name>` | Modell wählen. Kurznamen: `opus`, `fable`, `qwen`, `deepseek`, `claude`. Oder voll: `deepseek-v4-pro`, `deepseek-v4-flash`, `claude-opus-5`, `claude-opus-4-8`, `claude-fable-5`, `qwen3.7-max`. Ohne Argument = Auswahl-Menü. **Setzt den Verlauf zurück.** |
| `/thinking on\|off` | Denkmodus des Modells an/aus. Bei **Fable** immer an (nicht abschaltbar). **Setzt den Verlauf zurück.** |
| `/effort <stufe>` | Denktiefe. DeepSeek: `high`, `max`. Anthropic: `low`, `medium`, `high`, `xhigh`, `max` (ohne Thinking sendet der Adapter höchstens `high`). Qwen: nicht einstellbar |
| `/temperature <0.0–2.0>` | Temperatur setzen. Nur **DeepSeek/Qwen** — bei Claude ausgeblendet (Anthropic lehnt es ab) |
| `/output reasoning on\|off` | **Live-Gedankenstrom** (grau) anzeigen/ausblenden |
| `/output steps on\|off` | **Zwischenschritte** anzeigen; aus = nur Endergebnis + Bericht |
| `/output` | (ohne Argument) aktuellen Anzeige-Stand zeigen |
| `/budget` | Tages-Token-Budget + Auto-Stopp anzeigen |
| `/budget <anbieter> <tokens>` | Tageslimit setzen. `<anbieter>` = `anthropic`\|`qwen`\|`deepseek`. `0` = kein Limit |
| `/budget auto on\|off` | **Auto-Stopp**: Grenze erzwingen (an) oder nur zählen (aus). Persistent |
| `/resume` | Unterbrochene Aufgabe **jetzt** fortsetzen (wie „weiter") |
| `/resume auto on\|off` | **Auto-Fortsetzen** beim Start ein/aus (wenn Budget frei). Persistent |
| `/key` | API-Schlüssel maskiert anzeigen oder für die Sitzung wechseln (pro Anbieter) |
| `/plan` | Arbeitsplan/Fortschritt anzeigen |
| `/internet` | Netzzugriff: erlaubte Domains für `fetch_url` anzeigen/setzen |
| `/endpoint` | Ziel für `post_to_endpoint` anzeigen/setzen (genau eine URL) |
| `/role` | Rollen (gespeicherte Arbeits-Setups): anlegen/wählen/wechseln |
| `/clear` | Gesprächsverlauf leeren |
| `/exit` | CLI beenden |

## Sonderwörter (ohne Schrägstrich)

| Eingabe | Wirkung |
|---|---|
| `weiter` / `weitermachen` / `weiterarbeiten` / `continue` / `continue working` | Nach Auto-Stopp die unterbrochene Aufgabe fortsetzen (nur wenn eine gespeichert ist) |
| `exit` / `quit` / `q` | CLI beenden |
| `rechte` | Hinweis auf `/rights` |
| *(alles andere ohne `/`)* | Geht als **Auftrag** an das Modell |

## Tastatur

| Taste | Wirkung |
|---|---|
| `Enter` | Auftrag/Befehl absenden |
| `Strg-C` / `Strg-D` | CLI sofort beenden |
| **Im Freigabe-Dialog:** `↑` `↓` | zwischen Aktionen wechseln |
| `Leertaste` | Aktion an-/abwählen |
| `Enter` | ausgewählte Aktionen ausführen |
| `a` | alle abwählen · `Esc` alle ablehnen |

## Start-Flags (beim Aufruf)

```bash
node dist/index.js [flags]
```
| Flag | Wirkung |
|---|---|
| `--model <name\|kurzname>` | Startmodell (z.B. `--model opus`) |
| `--read-root <pfad>` | Lesebereich (`.` = aktueller Ordner) |
| `--write-root <pfad>` | Schreibbereich |
| `--yes` / `-y` | Alles ohne Rückfrage freigeben |
| `--verbose` | Anzeige: Gedankenstrom **und** Zwischenschritte an |
| `--quiet` | Anzeige: beides aus (nur Endergebnis + Bericht) |
| `--no-thinking` | Denkmodus aus starten |
| `--effort <stufe>` | Denktiefe beim Start |
| `--allow-secrets` | Geheimnis-Sperre lockern (bewusst; `.env` etc. werden lesbar) |
| `--version` / `--help` | Version / Hilfe |

## Was ist einstellbar — und wo es bleibt

| Einstellung | Befehl | Bleibt erhalten? |
|---|---|---|
| Modell / Thinking / Effort / Temperature | `/model` `/thinking` `/effort` `/temperature` | **nur diese Sitzung** |
| Anzeige (Gedanken / Schritte) | `/output` | nur diese Sitzung (bzw. `--verbose`/`--quiet` beim Start) |
| Rechte (Lesen/Schreiben/Shell) | `/rights` | nur diese Sitzung |
| API-Schlüssel (pro Anbieter) | `/key` | nur diese Sitzung (dauerhaft: `~/.zshrc`) |
| **Auto-Stopp** | `/budget auto on\|off` | **persistent** (`~/.leaven/usage.json`) |
| **Tageslimits** (pro Anbieter) | `/budget <anbieter> <n>` | **persistent** (usage.json) |
| **Auto-Fortsetzen** | `/resume auto on\|off` | **persistent** (usage.json) |
| Rollen | `/role` | **persistent** (`~/.leaven`) |
| Netz-Domains / Endpoint | `/internet` / `/endpoint` | Sitzung bzw. `config/commands.json` / Umgebungsvariablen |
| Freigabefreie Befehle/Skripte | *nur der Mensch, per Datei* | **persistent** (`~/.leaven/allowed-commands.json`, `approved-scripts/`) |

## Umgebungsvariablen (dauerhaft, in `~/.zshrc`)
`DEEPSEEK_API_KEY` · `ANTHROPIC_API_KEY` · `QWEN_API_KEY` (oder `DASHSCOPE_API_KEY`). Alle
gleichzeitig gesetzt lassen — `/model` greift den passenden. Optional `DEEPSEEK_MODEL`,
`LEAVEN_API_ENDPOINT`, `LEAVEN_API_TOKEN`.
