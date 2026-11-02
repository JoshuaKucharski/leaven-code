# Testen

**Stand:** 2026-07-30

## Automatisierte Tests

```bash
npm test            # Kern-Suite (Guard, Logik, URL) – baut vorher, kein API-Zugriff
```

Die **Kern-Suite** läuft gegen `dist/`, braucht **keinen** API-Zugriff und kostet nichts. Die
neueren Provider-/Feature-Suiten laufen bewusst **separat** (schlanke Kern-Suite, gezielter
Start) – ebenfalls ohne API:

```bash
npm run test:anthropic   # Anthropic-Adapter + Provider-Fähigkeiten
npm run test:stream      # SSE-Streaming: Parser + Tool-Call-Assembler (Edge-Cases)
npm run test:usage       # Tages-Token-Budget-Logik
npm run test:session     # „weiter"-Session-Validierung
```

| Datei | Umfang | Prüft |
|---|---|---|
| `tests/test-guard.js` | 177 | Befehlszerlegung, Allowlist, Optionssperren (auch gebündelt, abgekürzt, GNU-Varianten), eingebettete Optionswerte, `redirect`/`allow`/`sedread`-Verdicts, `php -l`, Geheimnis-Erkennung, Umgebungssäuberung |
| `tests/test-logic.js` | 13 | LoopBreaker (Fehlalarme, echte Schleifen, Zyklen), DSML-Parser |
| `tests/test-url.js` | 31 | URL-Guard: SSRF, Domain-Allowlist, HTML→Text |
| `tests/test-anthropic.js` | 44 | Provider-Fähigkeiten (alle Modelle), `zuAnthropicRequest`/`ausAnthropicResponse`, Denktiefe ohne Thinking, `finishReasonAus`, Qwen |
| `tests/test-stream.js` | 36 | SSE-Parsing, Tool-Call-Assembly, UTF-8-Chunk-Grenzen, `reasoning_content`-Phantom |
| `tests/test-usage.js` | 17 | Token-Summe, Tages-Reset, Budget-Prüfung |
| `tests/test-session.js` | 8 | `sessionGueltig` (gültig/ungültig, Format-Invariante) |

Jede Suite gibt `N bestanden, M fehlgeschlagen` aus und setzt den Exit-Code entsprechend.

### Was `test-guard.js` abdeckt

- 10 Injektionsversuche: `;` `&&` `|` `>` `<` `$( )` Backtick `${}` `&` Zeilenumbruch
- harmlose Allowlist-Befehle, die durchgehen müssen
- git-Befehle → müssen im Dialog landen (nicht mehr auf der Allowlist)
- gefährliche Optionen: `find -delete`, `find -exec`, `grep -S`, `tail -f` – auch gebündelt (`grep -rS`, `tail -fn 5`), abgekürzt (`--deref`, `--f`) und in GNU-Form (`grep -R`, `tail -F`, `file -C`, `find -fprint0`)
- eingebettete Optionswerte (`--file=/pfad`, `-f/pfad`, `-rf/pfad`) werden als Pfadkandidaten erkannt
- Regression: harmlose Optionen wie `grep -c` dürfen nicht mitgesperrt werden
- nicht gelistete Programme → Dialog, nicht heimlich erlaubt
- Umgehung über Programmpfad (`/bin/rm`, `./script.sh`) → Dialog
- Parser: Anführungszeichen, unbalancierte Zeichen, keine Variablenexpansion
- Geheimnis-Erkennung inkl. Gegenproben (`environment.ts` darf **nicht** greifen)
- Pfaderkennung inkl. `..` und `.`
- Umgebungssäuberung inkl. Gegenprobe (`PATH`, `HOME` müssen bleiben)

## Manuelle Prüfungen mit API-Zugriff

Diese kosten Geld. Nach Änderungen an der Agent-Schleife, an `securePath()` oder an
`callApi()` lohnen sie sich trotzdem.

Nicht-interaktiv über eine Pipe, mit `--yes`:

```bash
printf 'Aufgabe\nexit\n' | node dist/index.js --yes --verbose \
  --read-root ~/develop/platforms/leaven/leaven \
  --write-root ~/develop/platforms/leaven/leaven/sandbox
```

### Prüfliste

| Nr | Prüfung | Erwartung |
|---|---|---|
| 1 | Aufgabe „lies X und ersetze Y durch Z" | `read_file` → `edit_file` → Bericht, **eine** durchgehende Schleife |
| 2 | direkt danach eine Folgefrage | kein HTTP 400 — beweist, dass `reasoning_content` und das Message-Invariant halten |
| 3 | Schreibversuch ausserhalb des Schreibbereichs | abgelehnt, Datei unverändert — auch mit `--yes` |
| 4 | Symlink im Schreibbereich, der nach `/tmp` zeigt | abgelehnt, nichts in `/tmp` |
| 5 | `read_file` auf eine `.env` im erlaubten Bereich | gesperrt; mit `--allow-secrets` erlaubt |
| 6 | Befehl mit `;` oder `\|` | abgelehnt, zweiter Teil läuft nicht |
| 7 | `grep -r password /Users/…/.ssh` | abgelehnt |
| 8 | „lies dieselbe Datei 10 mal" | Loop-Breaker greift ab dem 5., Modell antwortet trotzdem sinnvoll |
| 9 | Werkzeug im Dialog ablehnen | Modell fragt nach, kein 400er |

### Testumgebung aufbauen

```bash
cd ~/develop/platforms/leaven/leaven
mkdir -p sandbox && printf 'FARBE hier\n' > sandbox/drin.txt
printf 'ausserhalb\n' > draussen.txt
ln -s /tmp sandbox/link-nach-tmp          # für den Symlink-Test
printf 'DB_PASSWORD=geheim\n' > sandbox/.env   # für den Geheimnis-Test
```

Danach wieder aufräumen: `rm -rf sandbox draussen.txt`.

## Den interaktiven Dialog testen

Der Freigabe-Dialog braucht ein echtes TTY. Eine Pipe reicht nicht — dort greift der
Zweig „kein interaktives Terminal", der schreibende Werkzeuge überspringt.

`script -q /dev/null node dist/index.js` erzeugt ein Pseudo-Terminal, ist aber unzuverlässig:
Die Eingabe wird sofort geechot und EOF beendet den Prozess vorzeitig. Für den Dialog
selbst empfiehlt sich eine manuelle Prüfung im Terminal.

Prüfpunkte:

1. Dialog erscheint **und der Prozess bleibt am Leben** (früher beendete er sich sofort,
   weil `rl.pause()` ohne `process.stdin.resume()` den Event-Loop leer laufen liess)
2. Enter führt aus, danach funktioniert der `Du:`-Prompt weiterhin (früher zerstörte
   `removeAllListeners('keypress')` den readline-Listener)
3. Lange Argumente werden auf eine Zeile gekürzt, nicht umgebrochen
4. Auswahlbalken ist dunkelblau, nicht schwarz

## Nützliche Einzelprüfungen

Verfügbare Modelle abfragen:

```bash
curl -s -H "Authorization: Bearer $DEEPSEEK_API_KEY" https://api.deepseek.com/models
```

Prüfen, ob der Thinking-Modus tatsächlich `reasoning_content` liefert:

```bash
curl -s https://api.deepseek.com/v1/chat/completions \
  -H "Authorization: Bearer $DEEPSEEK_API_KEY" -H "Content-Type: application/json" \
  -d '{"model":"deepseek-v4-pro","messages":[{"role":"user","content":"Was ist 17*23?"}],
       "thinking":{"type":"enabled"},"max_tokens":2048}' \
  | python3 -c "import sys,json; m=json.load(sys.stdin)['choices'][0]['message']; print(list(m.keys()))"
```
