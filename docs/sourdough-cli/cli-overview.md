# cli-overview — leaven-cli auf einen Blick

**Stand:** 2026-07-30

Deutschsprachiger CLI-Agent für mehrere LLM-Provider. Aufgabe stellen → das Modell fordert
Werkzeuge an → die CLI führt sie **innerhalb von Lese-/Schreibbereichen und Befehls-Freigaben**
aus, mit Schleifenerkennung. Bedienung über Slash-Befehle (`/help`).

## Architektur (Kern)
```
Nutzer-Eingabe ─▶ startChat (Eingabeschleife, src/index.ts)
                   ├─ Slash-Befehle (BEFEHLE-Array) / „weiter" / „/resume"
                   └─ Aufgabe ─▶ runAgentTurn  (der Agent-Loop)
                                   ├─ callApi(messages, tools, onReasoning)
                                   │    ├─ anthropic → callAnthropic (non-streaming)
                                   │    ├─ qwen/deepseek → streamOpenAiCompatible (SSE)
                                   │    └─ verbucht Tokens (zaehleTokens)
                                   ├─ extractToolCalls → Freigabe (isAutoApproved / Dialog)
                                   ├─ executeTool (securePath / commandGuard)
                                   └─ Budget-Auto-Stopp (am Schleifenkopf)
```
Die Provider-Unterschiede leben in `src/providers/` (capabilities, anthropic, qwen,
openaiStream). Die Rechte-/Ausführungs-Schicht (securePath, Guards) liegt **hinter** dem
Modell und ist modellunabhängig.

## Dateien (src/)
| Datei | Zweck |
|---|---|
| `index.ts` | Alles Zentrale: Agent-Loop, Werkzeuge, Slash-Befehle, securePath, Persistenz, Startdialog |
| `providers/capabilities.ts` | Provider-Erkennung, Fähigkeiten-Deskriptor, Modell-Liste + Kurznamen |
| `providers/anthropic.ts` | Anthropic-Adapter (Format-Übersetzung, non-streaming) |
| `providers/qwen.ts` | Qwen/DashScope (OpenAI-kompatibel, streamend) |
| `providers/openaiStream.ts` | Gemeinsamer SSE-Client (DeepSeek + Qwen): Parser + Tool-Call-Assembler |
| `usage.ts` | Tages-Token-Budget-Logik (rein) |
| `session.ts` | „weiter"-Session-Validierung (rein) |
| `guards/commandGuard.ts` | Shell-freie Befehlsprüfung, Allowlist, Verdicts |
| `guards/urlGuard.ts` | fetch_url: SSRF-Sperre, Domain-Allowlist |
| `guards/loopBreaker.ts` | Schleifenerkennung |
| `utils/xmlParser.ts` | DSML-XML-Fallback für Tool-Calls |
| `config/commands.json` | Allowlist, redirects, phpLint, secretPatterns/Directories |

## Persistente Daten (`~/.leaven/`, für das Modell gesperrt)
`allowed-commands.json` (Registry) · `approved-scripts/` (immutable) · `requested-commands/`
(Vorschlags-Eingang) · `usage.json` (Budget + autoStopp + autoWeiter) · `session.json`
(„weiter") · `roles.json`/`scopes.json`/`roles/` (Rollen).

## Provider & Modelle
- **DeepSeek** `deepseek-v4-pro` (Standard), `deepseek-v4-flash` — streamend.
- **Anthropic** `claude-opus-4-8`, `claude-fable-5` — eigener Adapter, non-streaming.
- **Qwen** `qwen3.7-max` (DashScope) — streamend.
- Kurznamen: `/model opus|fable|qwen|deepseek|claude`.

## Slash-Befehle
`/help /status /rights /model /thinking /effort /temperature /output /budget /resume /key
/plan /internet /endpoint /role /clear /exit` — plus „weiter" (Sonderwort nach Auto-Stopp).

## Start-Flags
`--model <name|kurzname>`, `--read-root <pfad>`, `--write-root <pfad>`, `--yes`,
`--verbose` (Anzeige alles an), `--quiet` (alles aus), `--no-thinking`, `--effort`,
`--allow-secrets`.

Details je Thema: [features.md](./features.md), [techstack.md](./techstack.md),
[security.md](./security.md), [glossary.md](./glossary.md).
**Alle Terminal-Eingaben & Einstellungen:** [commands-and-settings.md](./commands-and-settings.md).
