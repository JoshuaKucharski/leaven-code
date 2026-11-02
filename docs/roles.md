# Rollen

**Stand:** 2026-07-21
**Umgesetzt in:** `befehlRolle()`, `aktiviereRolle()`, `baueSystemPrompt()` in `src/index.ts`

Eine Rolle ist ein gespeichertes Arbeits-Setup: Bereiche, Rechte, Modelleinstellungen und
ein optionaler Onboarding-Text. Statt bei jedem Start die Pfade neu zu wählen, aktiviert
man die passende Rolle.

## Befehle

| Befehl | Wirkung |
|---|---|
| `/role` | Auswahl aus den vorhandenen Rollen (Checkbox) |
| `/role list` | Alle Rollen mit Bereichen, Rechten und Modell anzeigen |
| `/role use <name>` | Rolle aktivieren |
| `/role new <name>` | Neue Rolle anlegen — fragt Bereiche und Rechte ab |
| `/role edit <name>` | Bereiche und Rechte einer Rolle ändern |
| `/role delete <name>` | Rolle löschen (das Verzeichnis bleibt bestehen) |

## Was eine Rolle speichert

```jsonc
{
  "leaven-cli-engineer": {
    "read": "/Users/myki/develop/platforms/leaven/leaven",
    "write": ["/Users/myki/develop/platforms/leaven/leaven"],
    "permissions": { "read": true, "write": true, "exec": false },
    "settings": { "model": "deepseek-v4-pro", "thinking": true,
                  "effort": "high", "temperature": 0.3 },
    "rollenzugriff": true
  }
}
```

Abgelegt in `~/.leaven/roles.json`. Die Pfade sind absolut, eine Rolle funktioniert
also aus jedem Arbeitsverzeichnis heraus.

### Modellwechsel setzt den Verlauf zurück

Bringt eine Rolle ein anderes Modell oder einen anderen Thinking-Modus mit, wird beim
Aktivieren der Gesprächsverlauf gelöscht — mit sichtbarem Hinweis. Das ist zwingend: Eine
History mit `reasoning_content` wird von einem Non-Thinking-Modell abgelehnt und umgekehrt
(siehe [deepseek-api.md](./deepseek-api.md)).

## Onboarding-Texte

Jede Rolle hat ein eigenes **verstecktes** Verzeichnis:

```
~/.leaven/
  roles.json
  roles/
    .doku/
      onboarding.md
    .leaven-cli-engineer/
      onboarding.md
```

Beim Anlegen entsteht eine Vorlage. Der Inhalt wird beim Aktivieren an den Systemprompt
angehängt:

```
--- Rollenbeschreibung "doku" ---
<Inhalt der onboarding.md>
```

Damit lassen sich Aufgabe, Konventionen und Projektwissen einmal hinterlegen, statt sie
jedes Mal zu erklären.

**Die Datei liest die CLI selbst**, nicht der Agent über `read_file`. Sie umgeht
`securePath()` bewusst — sie ist Konfiguration, nicht Agentendaten.

## Isolation der Rollen

`~/.leaven` steht auf der Geheimnis-Sperrliste (`config/commands.json`). Ohne diese
Sperre könnte eine Rolle die Bereiche und Onboarding-Texte **aller anderen** Rollen lesen,
sobald der Lesebereich bis `~` reicht.

Zwei Ausnahmen, beide ausschliesslich **lesend**:

| Ausnahme | Umfang |
|---|---|
| Eigenes Rollenverzeichnis | `~/.leaven/roles/.<aktive-rolle>/` — jede Rolle darf ihr eigenes Onboarding lesen |
| `rollenzugriff: true` | ganz `~/.leaven` — nur für Rollen, die an der CLI selbst arbeiten |

Verifiziert mit aktiver Rolle `doku`:

```
/Users/myki/.leaven/roles/.doku/onboarding.md      -> lesbar
/Users/myki/.leaven/roles/.andere/onboarding.md    -> gesperrt
/Users/myki/.leaven/roles.json                     -> gesperrt
```

Und mit `rollenzugriff: true`:

```
/Users/myki/.leaven/roles.json                     -> lesbar
/Users/myki/.leaven/roles/.andere/onboarding.md    -> lesbar
/Users/myki/.ssh/id_rsa                               -> weiterhin GESPERRT
```

`rollenzugriff` ist bewusst eine eigene Eigenschaft und **keine** allgemeine
„zusätzliche Lesepfade"-Liste. Eine solche Liste wäre schnell auch ein Weg, `.ssh` oder
`.aws` freizuschalten — genau das soll sie nicht sein.

Schreiben nach `~/.leaven` ist in keinem Fall erlaubt; Rollen werden über `/role`
geändert, nicht durch den Agenten.

## Systemprompt bleibt aktuell

`aktualisiereSystemPrompt()` schreibt `messages[0]` nach jeder Bereichsänderung neu —
sowohl nach `/rights` als auch nach einem Rollenwechsel.

Das war vorher ein Fehler: Der Prompt wurde nur einmal beim Start gebaut. Nach einem
`/rights` glaubte das Modell weiter an die alten Bereiche, während `securePath()` die
neuen erzwang — es bekam also Ablehnungen für genau die Pfade, die ihm vorgegeben waren.

## Typische Rollen

| Rolle | Lesen | Schreiben | Shell | Zweck |
|---|---|---|---|---|
| `doku` | Projekt | Projekt | nein | Dokumentation pflegen |
| `leaven-cli-engineer` | `~/develop/platforms/leaven/leaven` | dito | nein | an der CLI selbst arbeiten, mit `rollenzugriff` |
| `frontend` | `~/develop` | ein Projekt | nein | breiter Überblick, enger Schreibbereich |
