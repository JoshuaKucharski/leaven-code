# Architektur

**Stand:** 2026-07-21

## Was das Programm ist

Ein CLI-Agent: Der Nutzer stellt eine Aufgabe, das Modell (DeepSeek) fordert Werkzeuge an,
die CLI führt sie aus und gibt die Ergebnisse zurück — so lange, bis das Modell fertig ist.

## Modulaufbau

```
src/
  index.ts                 Alles ausser den Guards: Werkzeuge, Agent-Schleife,
                           Berechtigungen, Rollen, Plan, TUI, API-Zugriff
  guards/
    commandGuard.ts        Befehlszerlegung, Allowlist, Geheimnis-Erkennung,
                           Umgebungssäuberung — reine Funktionen, gut testbar
    loopBreaker.ts         Erkennung von Wiederholungsschleifen
    urlGuard.ts            Domain-Allowlist, SSRF-Schutz, HTML zu Text
  utils/
    xmlParser.ts           Fallback für DeepSeeks DSML-Format (greift normalerweise nie)
config/
  commands.json            Allowlist, Geheimnis-Muster
  loopBreaker.json         Schwellwerte der Schleifenerkennung
tests/
  test-guard.js           177 Prüfungen zum Befehls-Guard
  test-logic.js            13 Prüfungen zu LoopBreaker und XML-Parser
  test-url.js              31 Prüfungen zu Domain-Allowlist und SSRF-Schutz
  test-anthropic.js        44 Prüfungen zum Anthropic-Adapter (separat: npm run test:anthropic)
  test-stream.js           36 Prüfungen zum SSE-Client (separat)
  test-usage.js            17 Prüfungen zum Tagesbudget (separat)
  test-session.js           8 Prüfungen zur „weiter"-Session (separat)
```

`src/index.ts.backup` ist ein Überbleibsel eines früheren Stands und wird nicht gebaut.

## Die Agent-Schleife

Kern des Programms, `runAgentTurn()` in `src/index.ts`:

```
messages.push({role:'user', content: eingabe})

für iteration = 1 … MAX_ITERATIONS (99 999, siehe unten):
    antwort = callApi(messages, mit_tools = true)
    messages.push(antwort)                        // rohes Objekt, siehe unten

    calls = antwort.tool_calls
    wenn calls leer:  Text ausgeben, fertig

    für jeden call in calls:
        ergebnis = freigegeben ? ausführen : ablehnungstext
        messages.push({role:'tool', tool_call_id: call.id, content: ergebnis})
```

### Zwei Invarianten, die nicht verletzt werden dürfen

**1. `tools` gehört in JEDEN Request.** Fehlt das Feld im Folge-Request, kann das Modell
nach einem `read_file` kein `write_file` mehr anfordern. Der Vorgang endet dann stumm
mitten in der Aufgabe. Genau dieser Fehler existierte ursprünglich: Es gab gar keine
Schleife, sondern einen einzigen Abschluss-Request ohne `tools`.

**2. Jeder `tool_call` braucht genau eine `role:"tool"`-Antwort mit passender
`tool_call_id`** — auch wenn er abgelehnt oder vom Loop-Breaker blockiert wurde. Fehlt
auch nur eine, antwortet die API auf den nächsten Request mit HTTP 400, und die History
ist dauerhaft unbrauchbar.

`repairHistory()` ist das Sicherheitsnetz: Bricht ein Turn mittendrin ab (Netzwerkfehler),
füllt es fehlende Tool-Antworten nach, damit die Sitzung weiterläuft.

**3. Die Assistant-Nachricht wird als rohes Objekt weitergereicht.** Im Thinking-Modus
hängt daran `reasoning_content`, das DeepSeek ab dem ersten Tool-Call in jedem
Folge-Request zurückerwartet. Niemals neu zusammenbauen oder Felder entfernen —
Einzelheiten in [deepseek-api.md](./deepseek-api.md).

### Weitere Schutzmechanismen der Schleife

| Mechanismus | Wert | Zweck |
|---|---|---|
| `MAX_ITERATIONS` | 99 999 | Schritte je Block; bei Erreichen fragt die CLI, ob weitergearbeitet werden soll — bei diesem Wert praktisch nie. Gegen Entgleisen wirken Loop-Breaker, Tool-Call-Backstop (`max_tool_calls`, 9 999) und Tagesbudget; ob ein kleinerer, konfigurierbarer Wert zurückkommt, ist offen (`leavencode-documentation/open-work.md`, D5) |
| `MAX_TOOL_RESULT_CHARS` | 8000 | Werkzeugergebnisse kürzen, Kontext schonen |
| `MAX_HISTORY_MESSAGES` | 60 | `trimHistory()` kürzt an einer user-Grenze, damit `tool_call`/`tool`-Paare heil bleiben |
| `REQUEST_TIMEOUT_MS` | 120 000 | axios-Timeout |
| Retry | 3 Versuche | bei 429 und 5xx mit exponentieller Wartezeit |

## Eingabeverarbeitung

`startChat()` benutzt **kein** `rl.question()`, sondern eine eigene Warteschlange auf
`rl.on('line')`. Grund: Bei gepipter Eingabe trifft der gesamte Text als ein Block ein,
lange bevor der erste Turn fertig ist. Ohne Warteschlange gingen alle Zeilen ausser der
ersten verloren. `rl.on('close')` beendet die Schleife sauber bei Ctrl-D bzw. EOF.

### Mehrzeiliges Einfügen

Ein Terminal schickt eingefügten Text als normale Tastenanschläge inklusive
Zeilenumbruch — readline feuert also **pro Zeile** ein `line`-Ereignis. Gemessen: Ein
Einfüge-Vorgang mit 5 Zeilen erzeugt 5 Ereignisse. Ohne Gegenmassnahme würde ein
100-Zeilen-Prompt zu 100 einzelnen Aufträgen und ebenso vielen API-Aufrufen.

Lösung: Zeilen, die innerhalb von 120 ms eintreffen, werden zu **einem** Prompt
zusammengefasst. Ein Mensch braucht zwischen zwei Enter-Anschlägen deutlich länger, ein
Einfüge-Vorgang liefert alles in wenigen Millisekunden.

**Das gilt nur im echten Terminal** (`process.stdin.isTTY`). Bei gepipter Eingabe bleibt
jede Zeile ein eigener Auftrag — sonst brächen Skripte und die nicht-interaktiven
Testläufe. Verifiziert:

```
TTY  (Einfuegen), 5 Zeilen -> 1 Prompt mit 5 Zeilen
Pipe (Skript),    5 Zeilen -> 5 separate Prompts
```

## Slash-Befehle

Definiert im Array `BEFEHLE` in `src/index.ts`, ausgewertet von `behandleSlashBefehl()`.
Namen englisch, Ausgaben deutsch. Ein neuer Befehl braucht nur einen weiteren Eintrag —
`/help` erzeugt sich daraus selbst.

`/model` und `/thinking` rufen `setzeKonversationZurueck()` auf, wenn bereits ein Gespräch
läuft. Das ist kein Komfortverzicht, sondern notwendig: siehe
[deepseek-api.md](./deepseek-api.md), Abschnitt „Niemals zwei Modelle in einem Gespräch".

## Eingaberahmen und Kurzhinweis

Vor dem Prompt wird ein grauer Kurzhinweis und darunter eine orangene Linie gezeichnet,
nach dem Absenden eine zweite Linie. Die eigene Eingabe steht dadurch im Verlauf sichtbar
abgegrenzt — besonders nützlich bei langen eingefügten Prompts.

Der Kurzhinweis (`/help Hilfe · /status Einstellungen · /rights Rechte · Strg-C beenden`)
steht bewusst **oberhalb** des Rahmens, nicht darunter: Während getippt wird, gehört die
unterste Zeile readline. Alles, was dort stehen soll, müsste bei jedem Tastendruck neu
positioniert werden. `fusszeile()` kürzt auf eine knappere Fassung, wenn das Terminal zu
schmal ist.

Eine echt fixierte Statuszeile (Scrollbereich per `DECSTBM` umdefinieren, wie `htop`) wurde
bewusst nicht gebaut: Bricht das Programm ab, ohne den Bereich zurückzusetzen, bleibt das
Terminal des Nutzers gestört, bis er `reset` eingibt.

Bewusst **kein** dauerhafter Rahmen während des Tippens: Dafür müsste die
Eingabe-Darstellung selbst geschrieben werden statt readline zu nutzen, mit
Cursor-Steuerung und Umbruch-Logik. Genau diese Art Code ist in diesem Projekt schon
mehrfach gebrochen (siehe [troubleshooting.md](./troubleshooting.md)).

Im nicht-interaktiven Betrieb entfallen die Linien.

## Der Freigabe-Dialog

`confirmToolCalls()` schaltet stdin in den Raw-Modus und zeichnet eine Auswahlliste. Zwei
Fallstricke, die dort dokumentiert und behoben sind:

- **`rl.pause()` allein tötet den Prozess.** Ein wartendes Promise hält den Node-Event-Loop
  nicht am Leben. Ohne anschliessendes `process.stdin.resume()` beendet sich das Programm
  in dem Moment, in dem der Dialog erscheint — gemessen: nach 10 ms.
- **`removeAllListeners('keypress')` zerstört readline.** Der readline-Interface hat einen
  eigenen keypress-Listener. Er wird für die Dauer des Dialogs gesichert und danach exakt
  wiederhergestellt.

Enter wird sowohl als `return` (`\r`, echtes Terminal) als auch als `enter` (`\n`, Pipe)
akzeptiert.

## Ausgabemodi

**Stiller Modus** (aktiv, sobald Lesen und Schreiben freigegeben sind, abschaltbar mit
`--verbose`): Zwischentexte und Werkzeugausgaben werden unterdrückt, am Ende erscheinen
ein Aktionsbericht und die Schlussnachricht. Blockierte und abgelehnte Aktionen bleiben
**immer** sichtbar — ein abgewürgter Lauf darf nicht wie ein Erfolg aussehen.

## Weiterführend

- [tools.md](./tools.md) — die Werkzeuge und die Pfadsemantik
- [plan.md](./plan.md) — Arbeitsplan und Fortschrittsbalken
- [permissions-and-scopes.md](./permissions-and-scopes.md) — Lese-/Schreibbereiche
- [deepseek-api.md](./deepseek-api.md) — Modell, Thinking-Modus, `reasoning_content`
- [configuration.md](./configuration.md) — Flags, Umgebungsvariablen, Konfigurationsdateien
