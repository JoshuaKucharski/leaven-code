# techstack — leaven-cli

**Stand:** 2026-07-30

## Laufzeit & Sprache
- **Node.js** (modernes; nutzt `for await` über Streams, `StringDecoder`, global verfügbare APIs).
- **TypeScript**, kompiliert mit `tsc` (`npm run build` → `dist/`). ES-Module (Imports mit `.js`-Endung).

## Abhängigkeiten (bewusst schlank — Lieferketten-Sicherheit)
| Paket | Zweck |
|---|---|
| `axios` | **einziger** HTTP-Client — für ALLE Provider (DeepSeek, Anthropic, Qwen) |
| `chalk` | Terminal-Farben |
| `commander` | CLI-Flags |
| `dotenv` | `.env` laden (enthält nur Platzhalter) |
| `ora` | Spinner |
Node-Bordmittel: `string_decoder` (UTF-8-sichere Chunk-Grenzen im Stream), `readline`, `fs`, `child_process` (execFile).

**KEIN LLM-SDK.** Kein `@anthropic-ai/sdk`, kein `dashscope`, kein `openai`-Paket. Grund:
jede Abhängigkeit ist Lieferketten-Fläche; die APIs sind einfach genug, um sie direkt und
prüfbar über axios zu sprechen. Siehe [security.md](./security.md) und [../providers.md](../providers.md).

## Provider-APIs
| Provider | Endpunkt | Auth | Format |
|---|---|---|---|
| DeepSeek | `api.deepseek.com/v1/chat/completions` | `Authorization: Bearer` | OpenAI-kompatibel, streamend |
| Anthropic | `api.anthropic.com/v1/messages` | `x-api-key` + `anthropic-version` | eigenes Format (Adapter), non-streaming |
| Qwen | `dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions` | `Authorization: Bearer` | OpenAI-kompatibel, streamend |

Anthropic-Besonderheiten: `system`-Feld, `input_schema`, `tool_use`/`tool_result`-Blöcke,
`thinking`-Blöcke, kein `temperature` (400), Fable: thinking always-on + `fallbacks`.
Qwen: `enable_thinking` braucht `stream:true`; Key ersatzweise `DASHSCOPE_API_KEY`.

## Streaming
Eigener SSE-Parser in `openaiStream.ts` (kein SDK): Zeilen-Buffer über Chunk-Grenzen,
UTF-8-sichere Dekodierung, Tool-Call-Assembler (Map je Index), `stream_options.include_usage`
für die Token-Zählung.

## Tests
Reine Node-Skripte in `tests/` (kein Test-Framework), laufen gegen `dist/`, **kein** API-Zugriff:
`npm test` (Kern), `npm run test:{anthropic,stream,usage,session}` (separat). Siehe
[../testing.md](../testing.md).

## Persistenz
Reine JSON-Dateien in `~/.leaven/` (Datei-I/O über `fs`, synchron beim Start; Modell hat
keinen Zugriff). Keine Datenbank.
