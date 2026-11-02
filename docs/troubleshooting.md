# Fehlerbilder und ihre Ursachen

**Stand:** 2026-07-21

Alle hier aufgeführten Fehler sind in diesem Projekt tatsächlich aufgetreten und behoben.
Die Liste dient zwei Zwecken: schnelle Diagnose bei einem Rückfall, und Warnung davor,
einen Fehler beim Umbau erneut einzubauen.

---

## „Die CLI hängt / reagiert nicht mehr"

**Ursache A — Spinner läuft weiter.** Ein Spinner, der im Fehlerfall nicht gestoppt wird,
überschreibt endlos den `Du:`-Prompt. Die CLI wartet in Wahrheit auf Eingabe, man sieht es
nur nicht. Im Screenshot damals: 362,9 Sekunden.

*Schutz:* `withSpinner()` mit `try/finally`. Jeder neue Spinner muss darüber laufen.

**Ursache B — Prozess ist tot.** Erscheint der Freigabe-Dialog und das Programm beendet
sich sofort: `rl.pause()` pausiert stdin, und ein wartendes Promise hält den
Node-Event-Loop nicht am Leben. Gemessen: Beendigung nach 10 ms.

*Schutz:* `process.stdin.resume()` nach `setRawMode(true)` in `confirmToolCalls()`.

## „Nach dem ersten Dialog nimmt die CLI keine Eingaben mehr an"

`process.stdin.removeAllListeners('keypress')` entfernt auch den Listener, den
`readline.createInterface()` selbst registriert hat. Danach ist `rl.question()` tot.

*Schutz:* Die vorhandenen Listener werden vor dem Dialog gesichert und danach exakt
wiederhergestellt.

## HTTP 400 — „reasoning_content in the thinking mode must be passed back"

Zwei verschiedene Modelle in einem Gespräch, oder eine Assistant-Nachricht wurde neu
zusammengebaut und hat dabei `reasoning_content` verloren.

*Schutz:* Genau eine `MODEL`-Konstante; Assistant-Nachrichten werden als rohes Objekt in
die History gelegt. Einzelheiten in [deepseek-api.md](./deepseek-api.md).

## HTTP 400 nach einem Werkzeugaufruf, danach bei jeder Folgefrage

Ein `tool_call` ohne zugehörige `role:"tool"`-Antwort. Die History ist dauerhaft
unbrauchbar, weil sie bei jedem weiteren Request erneut geschickt wird.

*Schutz:* Jeder Aufruf bekommt eine Antwort — auch abgelehnte und blockierte.
`repairHistory()` füllt Lücken nach einem abgebrochenen Turn.

## „Der Agent liest eine Datei und macht dann nichts mehr"

Die Agent-Schleife fehlt oder der Folge-Request übergibt kein `tools`. Ohne `tools` kann
das Modell nach einem `read_file` kein `write_file` anfordern.

*Schutz:* `callApi(messages, true)` in jeder Iteration.

## „Zugriff verweigert" obwohl der Pfad richtig aussieht

**Fall A — Bereich existiert nicht.** Häufigster Auslöser: führender Schrägstrich.
`/templates/projekt` ist ein Pfad ab Systemwurzel, nicht relativ zum Projekt.

*Schutz:* Existenzprüfung beim Start plus Korrekturvorschlag. Die Fehlermeldung
unterscheidet Fehlkonfiguration von echter Grenzverletzung.

**Fall B — falscher Bezugspunkt.** Relative Pfade zählen **immer** ab dem Lesebereich.
Ein blosser Dateiname landet daher im Lesebereich, nicht im Schreibbereich.

*Schutz:* Der Systemprompt enthält ein konkretes Beispiel mit den Bereichen der Sitzung;
die Fehlermeldung nennt die richtige Schreibweise, sofern das Zielverzeichnis existiert.

## „Ich kann nur in X schreiben" — Agent gibt Code zum Einfügen aus

Der Schreibbereich zeigt auf ein **anderes Projekt** als das, an dem gearbeitet werden
soll. Typisch nach einem Projektwechsel, wenn der Bereich aus Gewohnheit übernommen wurde.

*Behebung:* In der laufenden Sitzung `/rights` eingeben und den Schreibbereich ändern. Oder
beim Start `--write-root <richtiges-verzeichnis>`.

*Schutz:* Die Ablehnungsmeldung weist das Modell ausdrücklich darauf hin, dem Nutzer den
Befehl `/rights` anzubieten, statt nur Code auszugeben. Ohne diesen Zusatz gab das Modell
auf und lieferte den Code zum manuellen Einfügen — technisch korrekt, aber unnötig, weil
die Ursache in zehn Sekunden behebbar ist.

## „EISDIR: illegal operation on a directory"

`read_file` wurde auf ein Verzeichnis angewandt. Die rohe Node-Meldung sagt dem Modell
nicht, dass es schlicht das falsche Werkzeug benutzt hat.

*Schutz:* `read_file` prüft vorab auf Verzeichnis und antwortet mit dem Hinweis auf
`list_files`. Das Modell korrigiert sich dann im nächsten Schritt selbst.

## „spawn /bin/zsh ENOENT"

Sieht aus, als fehle die Shell. Tatsächlich existiert das Arbeitsverzeichnis nicht.

*Schutz:* `cwd` wird auf Existenz geprüft, mit Rückfall auf `process.cwd()`. Die Shell
kommt aus `process.env.SHELL` — allerdings wird ohnehin ohne Shell ausgeführt.

## „Befehl meldet Erfolg, tut aber nichts"

Trat auf, als das Arbeitsverzeichnis der Kindprozesse auf dem Schreibbereich lag:
`rm -rf datei.txt` zielte auf eine andere Datei als die, die das Modell gelesen hatte —
und `rm -rf` meldet für nicht vorhandene Dateien Erfolg.

*Schutz:* `cwd` ist immer der Lesebereich, derselbe Bezugspunkt wie bei Prüfung und
Datei-Werkzeugen.

## „Maximale Schrittzahl erreicht" mitten in der Aufgabe

Die Schrittgrenze war mit 25 zu knapp. **Gemessen:** Eine Landingpage aus sechs Dateien
braucht mit Planpflege bereits 17 Schritte — jeder `update_plan`-Aufruf ist eine eigene
Iteration. Mit Fehlversuchen und Dialogen ist 25 schnell erreicht.

*Schutz:* Grenze auf 40 erhöht, und wichtiger: Sie **beendet den Vorgang nicht mehr**.
Bei Erreichen erscheint der Bericht, der Plan und die Frage
`Weitere 40 Schritte ausführen? [Y/n]`. Damit ist sie ein Haltepunkt statt einer Wand.

Ohne TTY wird gestoppt, aber mit dem Hinweis, dass eine Folgeeingabe fortsetzt.

*Falls es doch abbricht:* Der Verlauf bleibt in jedem Fall erhalten. Eine Eingabe wie
„mach weiter" setzt die Arbeit mit vollem Kontext fort — verifiziert.

*Warum nicht einfach 150:* Die Grenze ist ein Notaus gegen Endlosschleifen. Bei 150 mit
`deepseek-v4-pro` und Thinking läuft ein entgleister Vorgang lange und teuer, bevor jemand
eingreift. Die Nachfrage alle 40 Schritte erreicht dasselbe, ohne die Kontrolle abzugeben.

**Zweite Grenze beachten:** `max_tool_calls` in `config/loopBreaker.json` ist ein Budget
für die **gesamte Sitzung**, nicht pro Auftrag. Es stand auf 200 und wurde auf 500 erhöht.
Wird es erreicht, sieht die Meldung wie eine Schleifenerkennung aus, obwohl nur das Budget
alle ist. Zur Laufzeit lässt es sich mit `/backstop off` abschalten oder mit
`/backstop 500` neu setzen (`/backstop` zeigt Stand und Verbrauch).

## Loop-Breaker blockt zu früh

Zwei historische Fehlalarme:

- Der Zähler war kumulativ statt konsekutiv — derselbe `read_file` wurde nach fünf über
  die Sitzung verteilten Aufrufen blockiert.
- Die Zyklus-Erkennung verglich nur Werkzeug**namen**. Acht `write_file` auf acht
  **verschiedene** Dateien galten als Endlosschleife.

*Schutz:* Zähler wird bei Aufrufwechsel zurückgesetzt; Zyklen werden über vollständige
Signaturen (Name **und** Argumente) erkannt. Beides ist in `tests/test-logic.js` abgedeckt.

## Ein eingefügter Mehrzeilen-Prompt wird zu vielen Einzelaufträgen

Das Terminal schickt eingefügten Text als normale Tastenanschläge; readline feuert pro
Zeile ein `line`-Ereignis. 100 eingefügte Zeilen wurden dadurch zu 100 Aufträgen.

*Schutz:* Zeilen innerhalb von 120 ms werden zu einem Prompt zusammengefasst — nur im
echten Terminal, damit gepipte Skripte weiterhin zeilenweise arbeiten.

*Falls es zurückkommt:* Prüfen, ob `interaktiv` (aus `process.stdin.isTTY`) korrekt
ermittelt wird und der Sammel-Timer nicht versehentlich umgangen wird.

## Bei gepipter Eingabe wird nur die erste Zeile verarbeitet

Eine Pipe liefert den gesamten Text als einen Block, lange bevor der erste Turn fertig
ist. Ohne Pufferung gehen alle weiteren Zeilen verloren.

*Schutz:* Eigene Warteschlange auf `rl.on('line')` statt `rl.question()`.

## Enter im Dialog bewirkt nichts

Ein Terminal sendet bei Enter `\r` → `key.name === 'return'`. Pipes und manche
Terminal-Konfigurationen senden `\n` → `key.name === 'enter'`.

*Schutz:* Beide Namen werden akzeptiert.

## Auswahlliste zeichnet sich fehlerhaft neu / Überschrift vervielfältigt sich

Das Neuzeichnen springt mit `moveCursor` um eine Zeilenzahl zurück. Stimmt diese nicht mit
den tatsächlich belegten **Bildschirmzeilen** überein, bleiben Reste stehen — sichtbar
daran, dass sich die Überschrift bei jedem Tastendruck wiederholt.

Drei Ursachen, alle aufgetreten:

1. **Zeilenumbruch.** Eine zu lange Zeile belegt zwei Bildschirmzeilen, zählt aber als ein
   Array-Eintrag.
2. **Eingebettetes `\n`.** Ein Titel wie `'\n  Überschrift'` ist ein Array-Eintrag, belegt
   aber zwei Zeilen. Genau das liess die Überschrift durchlaufen.
3. **Ungekürzte Titel- und Fusszeile.** Gekürzt wurden anfangs nur die Einträge.

*Schutz:* `mehrfachAuswahl()` splittet Titel und Fusszeile an `\n` in eigene Einträge,
kürzt **alle** Zeilen auf die Terminalbreite und berechnet `printedLines` aus den
tatsächlich belegten Zeilen (ANSI-Codes werden dabei herausgerechnet, sie zählen nicht zur
sichtbaren Breite).

*Prüfen:* Im `script`-Mitschnitt muss jeder Rücksprung `ESC[<N>A` zur Zeilenzahl des
**vorherigen** Renders passen.

## Eingabe erscheint doppelt, nachdem ein Dialog beantwortet wurde

readline hält stdin im **Raw-Modus**, solange es die Eingabe verwaltet. Beim Aufräumen des
Freigabe-Dialogs stand pauschal `setRawMode(false)` — damit schaltete sich das
Terminal-Echo wieder ein, und jedes Zeichen erschien zweimal: einmal vom Terminal, einmal
von readline.

*Schutz:* Der vorherige Zustand wird gemerkt (`process.stdin.isRaw`) und exakt
wiederhergestellt.

*Nachgewiesen* durch A/B-Vergleich im Terminal-Mitschnitt: altes Verhalten 2 Treffer für
denselben Eingabetext, neues Verhalten 1 Treffer.

## `write_file` schlägt mehrfach mit ENOENT fehl, Loop-Breaker greift

Das Zielverzeichnis existiert nicht. `fs.writeFile` legt keine Elternverzeichnisse an und
meldet das rohe `ENOENT: no such file or directory` — daraus liest das Modell nicht heraus,
dass nur der Ordner fehlt. Es wiederholt denselben Aufruf, bis der Loop-Breaker greift.

Typisch bei „lege ein neues Projektverzeichnis mit einer Landingpage an".

*Schutz:* `write_file` legt fehlende Elternverzeichnisse mit an
(`fs.mkdir(..., { recursive: true })`). Der Pfad ist von `securePath()` bereits auf den
Schreibbereich geprüft, das Anlegen kann also nicht ausbrechen. Die Rückmeldung nennt es:
„Verzeichnis wurde mit angelegt".

### Warum `mkdir` trotzdem nicht auf die Allowlist kommt

Naheliegend wäre, `mkdir` freizugeben. Das wäre aber ein Bruch der Konstruktion:
**Argumente von Allowlist-Programmen werden gegen den LESEbereich geprüft**, weil die
Allowlist ausschliesslich lesende Werkzeuge enthält. Ein schreibendes Programm dort könnte
Verzeichnisse überall dort anlegen, wo gelesen werden darf — die Schreibgrenze wäre
ausgehebelt.

`write_file` erledigt das Anlegen innerhalb der geprüften Grenze. `mkdir` wird dadurch
überflüssig.

## Checkbox: Enter kreuzt nichts an

Enter **bestätigt**, angekreuzt wird mit der **Leertaste**. Früher fiel Enter ohne Auswahl
wortlos auf die Pfadeingabe zurück — wer Enter zum Ankreuzen benutzt hatte, stand plötzlich
vor einem anderen Dialog.

*Schutz:* Enter ohne Auswahl zeigt jetzt einen Hinweis und lässt den Dialog offen. Esc ist
der Weg zur Pfadeingabe, die Fusszeile nennt das.

## „Authentication Fails, Your api key: ****-key is invalid"

Die `.env` enthält nur einen Platzhalter; der echte Schlüssel liegt in der Shell-Umgebung.
Wer `. ./.env` sourct, überschreibt den echten Schlüssel.

*Schutz:* keiner im Code — dotenv überschreibt vorhandene Variablen absichtlich nicht.
Beim Testen `$DEEPSEEK_API_KEY` direkt verwenden.

## Text auf dunklem Terminal unlesbar

`chalk.black.bold` auf dunklem Hintergrund. Ebenso war `chalk.inverse` für den
Auswahlbalken schwarz.

*Schutz:* Standardfarbe bzw. `chalk.bgBlue.whiteBright`.
