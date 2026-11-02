# Befehle & Skripte freigabefrei machen: vorschlagen → prüfen → freigeben

**Stand:** 2026-07-23
**Zugehörig:** [leaven-cli-bash-commands-security.md](./leaven-cli-bash-commands-security.md)
· [../permissions-and-scopes.md](../permissions-and-scopes.md) · [../tools.md](../tools.md)

Wie werden Befehle und Shell-Skripte, die man regelmäßig braucht, **ohne Rückfrage**
lauffähig, **ohne** die Sicherheit aufzugeben? Über einen dreistufigen Kreislauf:
**vorschlagen → prüfen → freigeben**.

---

## Die Sicherheits-Invariante

**Im Vorschlags-Eingang zu liegen gewährt NICHTS.** Ein Befehl läuft erst dann ohne
Rückfrage, wenn ein **Mensch** ihn geprüft und in die **AI-unveränderbare** Registry
verschoben hat. Der Assistent kann vorschlagen — nie selbst freigeben.

## Die drei Zonen (unter `~/.leaven`, für das Modell gesperrt)

| Pfad | Der Assistent darf | Zweck |
|---|---|---|
| `~/.leaven/requested-commands/` | **nur vorschlagen** (über das Werkzeug; die CLI schreibt) | Eingang für Vorschläge — gewährt nichts |
| `~/.leaven/allowed-commands.json` | **kennen** (über das Start-Manifest), nicht schreiben | freigegebene Befehle (exakter Abgleich) |
| `~/.leaven/approved-scripts/` | **kennen**, nicht schreiben | freigegebene Shell-Skripte (immutabel) |

`~/.leaven` steht auf der Geheimnis-Sperrliste (`secretDirectories`): Der Assistent kann
dort über seine Datei-Werkzeuge **weder lesen noch schreiben**. Vorschläge laufen deshalb
über ein Werkzeug (die CLI schreibt), Kenntnis über das Manifest im Systemprompt.

---

## Der Ablauf

### 1. Vorschlagen — `propose_command`

Der Assistent ruft das Werkzeug auf, statt Befehle in ein bash-Skript zu bündeln:

```jsonc
propose_command({
  name: "view-check",           // wird streng zu einem Dateinamen sanitisiert
  kind: "command",              // oder "script"
  command: "php artisan view:clear",
  reason: "läuft nach jeder Blade-Änderung"
})
```

Das schreibt `~/.leaven/requested-commands/view-check.json` (bei `kind: "script"`
zusätzlich `view-check.sh` mit dem Skriptinhalt). Es **führt nichts aus** und **gewährt
nichts**. Der Name wird auf `[a-z0-9_-]` reduziert und auf einen Basenamen beschränkt — ein
`name: "../../evil"` kann den Eingang nicht verlassen.

### 2. Prüfen — der Mensch

Du siehst dir den Vorschlag in `~/.leaven/requested-commands/` an. Bei Skripten liest du
den tatsächlichen `.sh`-Inhalt.

### 3. Freigeben — verschieben (nur der Mensch)

- **Befehl:** die exakte Zeile in `~/.leaven/allowed-commands.json` eintragen.
- **Skript:** die `.sh` nach `~/.leaven/approved-scripts/` verschieben und
  `bash ~/.leaven/approved-scripts/<name>.sh` in `allowed-commands.json` eintragen.

Ab dann läuft der Befehl ohne Rückfrage (`allow`-Verdict, exakter Abgleich).

---

## Warum Shell-Skripte nur aus der geschützten Zone

`bash <skript>` führt beliebigen Code aus — es ist genau die Shell, die die CLI sonst
vermeidet. Ein Skript, das der Assistent **schreiben** kann, dürfte niemals ohne Rückfrage
laufen: Er könnte es umschreiben und beliebigen Code unbeaufsichtigt ausführen. Deshalb:

- Ein registriertes `bash <skript>` zählt **nur**, wenn das Skript in `~/.leaven` liegt
  (dort ist der Assistent ausgesperrt). Die Prüfung `registryEintragErlaubt()` läuft **beim
  Start**: ein `bash /projekt/x.sh` in der Registry wird **verworfen + gewarnt**.
- Versucht der Assistent ad-hoc `bash editor/foo.sh`, landet das im Freigabe-Dialog **mit
  Hinweis**, stattdessen `propose_command` zu nutzen.

Das ist der entscheidende Unterschied zu einem vom Assistenten geschriebenen Projekt-Skript:
Nur *du* schreibst und besitzt das freigegebene Skript, an einem für ihn unveränderbaren Ort.

---

## Das Start-Manifest

Beim Sitzungsstart bekommt der Assistent im Systemprompt eine aus dem echten Zustand
erzeugte Übersicht:

- **Was ohne Rückfrage läuft:** Datei-Werkzeuge im Bereich, die lesende Allowlist
  (`grep, ls, …`), `php -l <datei>`, und die aktuell registrierten Befehle/Skripte.
- **Was immer eine Freigabe braucht:** alles andere — bash/Skripte, `npm`, `git`, nicht
  registrierte Programme, Programme mit Pfadangabe.
- **Die Einladung:** Sinnvolles über `propose_command` vorschlagen, statt Befehle in
  bash-Skripte zu bündeln.

So weiß der Assistent, was möglich ist, läuft nicht blind in Rückfragen, und seine Wünsche
landen in einem prüfbaren Eingang statt in einem Skript-Bypass.

---

## Verwandte Bausteine

- Das `allow`-Verdict und die `php -l`-Regel: [leaven-cli-bash-commands-security.md](./leaven-cli-bash-commands-security.md) → „Exakte Registry statt Interpreter-Allowlist".
- Die genauen Pfade und ihre Unveränderbarkeit:
  [../leaven-platform/feature-tasks/create-save-commands-and-scripts-to-secure-guarded-commands-registration-path.md](../leaven-platform/feature-tasks/create-save-commands-and-scripts-to-secure-guarded-commands-registration-path.md).
