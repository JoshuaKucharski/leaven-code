# Modell-Provider: DeepSeek + Anthropic (Opus, Fable) + Qwen

**Stand:** 2026-07-23
**Code:** `src/providers/capabilities.ts`, `src/providers/anthropic.ts`, `src/providers/qwen.ts`, `callApi()` in `src/index.ts`
**Zugehörig:** [security/environmental-facts.md](./security/environmental-facts.md)

Die CLI spricht drei Anbieter: **DeepSeek** (`deepseek-v4-pro`, `deepseek-v4-flash`),
**Anthropic** (`claude-opus-4-8`, `claude-fable-5`) und **Qwen** (`qwen3.7-max`, Alibaba
DashScope). Umschaltbar zur Laufzeit über `/model`.

---

## Das Wichtigste: Die Rechte-Schicht ist modellunabhängig

Ein Modellwechsel ändert **nichts** an der Sicherheit. Die Grenzen (`securePath`, Guards,
`/rights`, Registry) werden von der **CLI** erzwungen, nicht vom Modell. Jedes Modell gibt nur
**Werkzeug-Anforderungen als JSON** aus; die CLI entscheidet, ob sie ausgeführt werden. Opus
und Fable sind damit **genauso eingegrenzt** wie DeepSeek — das Modell hat keine Hände (siehe
[environmental-facts.md](./security/environmental-facts.md)). Der Adapter liegt **vor** der
Rechte-Schicht und fasst sie nicht an.

## Lieferkette: bewusst kein neues Paket

**Kein Provider bringt ein SDK mit.** Anthropic läuft über rohes HTTPS auf `/v1/messages`,
Qwen über den OpenAI-kompatiblen DashScope-Endpunkt — beide über das **bereits vorhandene
`axios`**. **Keine** neue Abhängigkeit: kein `@anthropic-ai/sdk`, kein `dashscope`, kein
`openai`-Paket. Damit kommt nichts Neues in die Vertrauensgrenze; „genauso sicher wie vorher"
gilt buchstäblich. Begründung: Ein SDK wäre zusätzliche Lieferketten-Fläche (transitive
Pakete, mögliche `postinstall`-Skripte), und die APIs sind einfach genug, um sie direkt und
voll prüfbar zu sprechen.

## Fähigkeiten-Deskriptor (`capabilities.ts`)

Eine Datei ist die **einzige Wahrheit** dafür, was ein Modell kann — sie steuert **beides**,
den API-Adapter *und* die Anzeige:

| | DeepSeek | Opus 4.8 | Fable 5 | Qwen 3.7-max |
|---|---|---|---|---|
| `apiKeyEnv` | `DEEPSEEK_API_KEY` | `ANTHROPIC_API_KEY` | `ANTHROPIC_API_KEY` | `QWEN_API_KEY` (¹) |
| `temperature` | ja | **nein** (400) | **nein** (400) | ja |
| `effortLevels` | high, max | low…max (5) | low…max (5) | — (kein Effort) |
| `thinkingToggle` | ja | ja (adaptive/aus) | **nein** | ja (²) |
| `thinkingAlwaysOn` | nein | nein | **ja** | nein |
| `streaming` | ja | nein (³) | nein (³) | ja |

`providerFor(model)`: `claude-*` → anthropic, `qwen*` → qwen, sonst deepseek.

¹ Gelesen wird `QWEN_API_KEY`, ersatzweise `DASHSCOPE_API_KEY` (DashScope-Konvention) — beide
funktionieren.
² Qwens Deep-Thinking (`enable_thinking:true`) verlangt bei DashScope `stream:true` — mit dem
Streaming (siehe unten) ist es jetzt verfügbar.
³ Anthropic hat ein anderes Event-Modell; Streaming dafür ist Phase 2.

## Provider-abhängige Anzeige

`/help`, `/status`, die Befehle und die Startmeldung richten sich nach dem aktiven Modell:
- **`/temperature`** wird bei Claude **ausgeblendet** (`gilt`-Prädikat) und meldet bei Aufruf
  „nicht verfügbar – nutze /effort".
- **`/thinking`** meldet bei Fable „immer an, nicht abschaltbar".
- **`/effort`** bietet die Stufen des jeweiligen Providers (2 bzw. 5).
- **`/status`** zeigt Provider, Denktiefe statt Temperature (bei Claude), und die passende
  Schlüssel-Variable.

## Beide Schlüssel gleichzeitig

`DEEPSEEK_API_KEY` und `ANTHROPIC_API_KEY` werden beim Start **beide** geladen und nebeneinander
gehalten (`apiKeys`-Speicher). Ein `/model`-Wechsel greift auf den passenden zu — kein
Neu-Exportieren, kein Verlust des anderen. `/key` zeigt beide (der aktive ist markiert) und
schreibt in den Slot des aktiven Providers.

## Der Adapter (`anthropic.ts`)

Normalisiert **intern** auf die DeepSeek/OpenAI-Form; übersetzt nur an der API-Grenze. Die
Agent-Schleife, `executeTool`, `isAutoApproved`, `repairHistory` und der Guard bleiben
unberührt. Reine, testbare Funktionen:

- `zuAnthropicRequest(messages, tools, opts)` → Request-Body:
  - system-Nachrichten → eigenes `system`-Feld
  - assistant → bevorzugt `_providerRaw`-Blöcke (erhält `thinking` + `tool_use` **unverändert**
    — dieselbe Invariante wie DeepSeeks `reasoning_content`)
  - `role:'tool'` → `tool_result`-Blöcke, aufeinanderfolgende in **eine** user-Nachricht gebündelt
  - Werkzeuge: `function.parameters` → `input_schema`
  - **kein** `temperature`; `output_config.effort`; Opus `thinking:{type:'adaptive'}`;
    **Fable: `thinking` weglassen** + `fallbacks:[{model:'claude-opus-4-8'}]`
  - `max_tokens` 16000 (Thinking zählt mit), Zeitlimit 600 s; ohne Thinking wird die Denktiefe
    auf höchstens `high` gekappt – die API nimmt `disabled` nur bis `high` an (Opus 5: sonst HTTP 400)
- `ausAnthropicResponse(data)` → Assistant-Nachricht in DeepSeek-Form (`content`, `tool_calls`,
  `_providerRaw`); `stop_reason:'refusal'` (Fable) → saubere Meldung.
- `finishReasonAus(data)` → `stop_reason` in DeepSeek-Form: `max_tokens` wird zu `'length'`, die
  Schleife zeigt dann dieselbe Längenwarnung wie bei DeepSeek/Qwen.
- `callAnthropic(...)` → `axios.post` auf `api.anthropic.com` mit `x-api-key` +
  `anthropic-version` (+ `anthropic-beta` für Fables Fallbacks), Retry wie im DeepSeek-Pfad.

## Der Qwen-Provider (`qwen.ts`)

DashScope bietet einen **OpenAI-kompatiblen** Endpunkt
(`/compatible-mode/v1/chat/completions`, `Authorization: Bearer`, `choices[0].message` mit
`tool_calls`) — dieselbe Form wie DeepSeek. Deshalb **kein eigener Adapter**: `callQwen`
schickt den OpenAI-Body direkt und gibt die Antwort unverändert in DeepSeek-Form zurück; die
Werkzeuge (`aktiveTools()`) passen ohne Übersetzung. Nur `enable_thinking:false` (v1
Standardmodus, siehe Fußnote ² oben) und die Basis-URL unterscheiden sich.

**Datenschutz-Hinweis:** Der genutzte Endpunkt ist Alibaba DashScope (China). Die Daten gehen
dorthin wie bei DeepSeek — der DSGVO-Vorteil von Qwen käme erst durch EU-Hosting oder lokale
Gewichte. Modellunabhängig gilt: Der Lesebereich begrenzt, was überhaupt gesendet wird.

## Streaming (DeepSeek + Qwen) — `openaiStream.ts`

Die OpenAI-kompatiblen Provider (DeepSeek, Qwen) laufen **streamend** über einen gemeinsamen
SSE-Client `src/providers/openaiStream.ts` (kein neues Paket, nur axios + `string_decoder`).
Anthropic bleibt non-streaming (anderes Event-Modell = Phase 2; `capabilities.streaming=false`).
Streaming bringt: **Qwens Deep-Thinking** (`enable_thinking:true` verlangt bei DashScope
`stream:true`), **Live-Mitlesen** des Reasoning, **keine Timeouts** bei langen Antworten.

**Oberster Vertrag:** Der Client liefert eine **vollständige** Message oder **wirft** — nie
etwas dazwischen. Die Agent-Schleife pusht erst nach Erfolg in die History; so kann keine
halbe Nachricht in die Konversation geraten.

**Fallen, die im Client abgefangen sind** (Fable-Review, doppelt getestet in `test-stream.js`):
- **`reasoning_content:''`-Phantom:** Das Feld wird nur angelegt, wenn *echtes* Reasoning kam —
  ein leeres Feld würde den Non-Thinking-Folge-Request mit **HTTP 400** killen.
- **`content` wird NIE live gedruckt:** nur der Reasoning-Strom läuft live (grau, nur im TTY,
  nicht im quiet-Modus). Grund: der DSML-XML-Fallback strippt Tool-Markup erst nach
  vollständigem `content`, und die „● Frage"-Formatierung braucht den ganzen Text.
- **UTF-8 über Chunk-Grenzen:** `StringDecoder` statt `toString()` je Chunk — sonst
  zerschneidet eine Chunk-Grenze ein chinesisches Reasoning-Zeichen und schreibt `�` in Text
  **und** Tool-Argumente.
- **Tool-Call-Assembly:** Fragmente per Index (Map, nicht Array), kaputte Argumente werfen
  (kein stiller `{}`-Fehlgriff), `id`/`name` nie konkateniert.
- **Idle-Watchdog + Retry:** axios-`timeout` schützt den Stream-Body nicht; ein eigener
  Watchdog bricht hängende Streams ab. Retry nur, solange noch nichts live gedruckt wurde.

`stripReasoningOnSend` (capabilities, default aus) ist ein Sicherheitsventil: falls ein
Provider das zurückgereichte `reasoning_content` doch ablehnt, wird es **nur beim Senden**
entfernt, nie in der History.

## Wichtige Invariante (alle Provider)

Modell **und** Thinking-Format dürfen **nicht mitten in einer Konversation** wechseln —
`thinking`-Blöcke bzw. `reasoning_content` müssen unverändert zurückgereicht werden. `/model`
und `/thinking` setzen die Konversation deshalb zurück.

## Tests

`tests/test-anthropic.js` (44 Prüfungen, **ohne** API) deckt Fähigkeiten, `zuAnthropicRequest`
und `ausAnthropicResponse` ab. Bewusst **nicht** in `npm test`, sondern separat:
`npm run test:anthropic`. Der Live-Test (echte API) braucht `ANTHROPIC_API_KEY`.
