# DeepSeek-API: Eigenheiten, die man kennen muss

**Stand:** 2026-07-21
**Endpunkt:** `https://api.deepseek.com/v1/chat/completions` (OpenAI-kompatibel)

Dieses Dokument sammelt die Fallstricke, die beim Bau dieser CLI tatsächlich zu Fehlern
geführt haben. Wer daran weiterarbeitet, sollte es vor der ersten Änderung an `callApi()`
oder der History-Verwaltung gelesen haben.

---

## 1. Modellnamen

Verfügbar (per `GET https://api.deepseek.com/models` geprüft am 2026-07-21):

```
deepseek-v4-flash    schnell, günstig
deepseek-v4-pro      stärker, langsamer, teurer   <- aktueller Standard
```

**`deepseek-chat` und `deepseek-reasoner` existieren nicht mehr.** Sie waren Aliase für
den Non-Thinking- bzw. Thinking-Modus von `deepseek-v4-flash` und wurden zum 2026/07/24
abgekündigt; auf diesem Konto sind sie bereits verschwunden. Code, der sie noch verwendet,
scheitert.

Eingestellt über `MODEL` in `src/index.ts`, überschreibbar per `--model` oder
`DEEPSEEK_MODEL`.

## 2. Niemals zwei Modelle in einem Gespräch

Das war der ursprüngliche Absturz dieses Projekts. Der erste Request ging an
`deepseek-chat`, der zweite an `deepseek-v4-pro`. Ergebnis:

```
HTTP 400 — The `reasoning_content` in the thinking mode must be passed back to the API.
```

Ursache: Ein Non-Thinking-Modell liefert kein `reasoning_content`. Der zweite Request ging
an ein Thinking-Modell, das genau dieses Feld in der History erwartet — und dort fehlte es,
weil die Nachricht von einem anderen Modell stammte.

**Deshalb gibt es genau eine `MODEL`-Konstante und keinen zweiten Modellnamen im Code.**
Wer hier etwas ändert, muss sicherstellen, dass alle Requests einer Sitzung dasselbe
Modell verwenden.

## 3. Thinking-Modus und `reasoning_content`

Aktiviert über den Request-Body:

```jsonc
{
  "thinking": { "type": "enabled" },   // oder "disabled"
  "reasoning_effort": "high"           // "high" (Standard) oder "max"
}
```

Die Antwort enthält dann ein zusätzliches Feld neben `content`:

```jsonc
{ "role": "assistant", "content": "391", "reasoning_content": "…Gedankengang…" }
```

**Regel laut DeepSeek-Doku:**

> *„for turns that do perform tool calls, the `reasoning_content` must be fully passed back
> to the API in all subsequent requests."*
> *„Every assistant message in the history needs the field once a tool call has occurred in
> the conversation — not just the latest one."*
> *„Pass it back unmodified. Truncating or summarizing the reasoning also triggers
> rejection on some model versions."*

**Wie die CLI das erfüllt:** `messages.push(message)` legt das **rohe Antwortobjekt** in die
History. Damit bleibt `reasoning_content` automatisch erhalten. Es gibt keine Stelle, die
Assistant-Nachrichten neu zusammenbaut.

**Gefahrenstellen bei künftigen Änderungen:**

| Stelle | Worauf zu achten ist |
|---|---|
| `extractToolCalls()` | verändert `message.content` (XML-Fallback) — `reasoning_content` nicht anfassen |
| `trimHistory()` | entfernt ganze Nachrichten; **niemals** einzelne Felder |
| `repairHistory()` | fügt nur `role:"tool"`-Nachrichten ein; Assistant-Nachrichten bleiben unberührt |
| jede neue Serialisierung | wenn irgendwo `{role, content, tool_calls}` von Hand gebaut wird, ist der Fehler zurück |

`reasoning_content` wird **nicht** im Chat ausgegeben. Die CLI druckt nur `message.content`.
Das ist Absicht und sollte so bleiben.

`max_tokens` steht auf 8192, weil die Reasoning-Tokens mit ins Completion-Budget zählen.

## 4. Das Message-Invariant

Wie bei allen OpenAI-kompatiblen APIs: **Zu jeder `tool_call`-id muss genau eine
`role:"tool"`-Nachricht mit passender `tool_call_id` existieren**, bevor der nächste
Request rausgeht. Sonst HTTP 400.

Das trifft besonders diese Fälle:

- Loop-Breaker blockiert einen Aufruf → trotzdem eine Tool-Antwort mit dem Blockgrund
- Nutzer lehnt im Dialog ab → trotzdem eine Tool-Antwort mit dem Ablehnungstext
- XML-Fallback greift → `message.tool_calls` muss gesetzt werden, sonst folgen
  `role:"tool"`-Nachrichten auf eine Nachricht ohne `tool_calls`

Die Tücke: Der Fehler wird abgefangen und rot gedruckt, die Sitzung läuft scheinbar weiter
— schickt aber bei jeder Folgefrage dieselbe kaputte History erneut. `repairHistory()`
fängt das ab.

## 5. Fehlerbehandlung

- `timeout: 120_000` — ohne Timeout hängt ein toter Request ewig
- Retry bei 429 und 5xx, drei Versuche, Wartezeit 1 s / 2 s
- `response.data.choices[0].message` ist gegen leere Antworten abgesichert

## 6. Kosten und Geschwindigkeit

`deepseek-v4-pro` mit Thinking denkt vor jeder Werkzeugentscheidung. Eine mehrstufige
Aufgabe (lesen → ändern → prüfen) dauert entsprechend. Für schnelle Läufe:

```bash
node dist/index.js --model deepseek-v4-flash --no-thinking
```

## 7. Der DSML-XML-Fallback

`src/utils/xmlParser.ts` erkennt ein XML-artiges Werkzeugformat
(`<｜｜DSML｜｜tool_calls>`), falls das Modell sein internes Format in den Text
durchreicht. Bei korrekt konfiguriertem Function-Calling greift dieser Pfad **nie** — er
ist reines Netz. Die Regex ist bewusst tolerant gegenüber zusätzlichen Attributen; eine
frühere Fassung verlangte strikt `string="true"` und verwarf sonst still alle Parameter,
sodass das Werkzeug mit leeren Argumenten aufgerufen wurde.
