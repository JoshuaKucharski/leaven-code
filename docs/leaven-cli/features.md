# features — alle Funktionen von leaven-cli

**Stand:** 2026-07-30. Vertiefung je Thema in den verlinkten Dokumenten.

## Werkzeuge (10) — [../tools.md](../tools.md)
| Werkzeug | Wirkung | Freigabe |
|---|---|---|
| `read_file` / `list_files` | Lesen im Lesebereich | Leserecht |
| `write_file` / `edit_file` | Schreiben im Schreibbereich | Schreibrecht |
| `copy_file` | Datei kopieren (Quelle=Lese, Ziel=Schreib); ersetzt `cp` | Schreibrecht |
| `execute_command` | EIN Programm, **ohne Shell** (execFile) | Shell-Recht / Allowlist / Registry |
| `propose_command` | Befehl/Skript zur menschlichen Freigabe vorschlagen | immer (führt nichts aus) |
| `fetch_url` | GET auf freigegebene Domains (SSRF-Sperre) | Leserecht |
| `post_to_endpoint` | POST an EINE feste Instanz, keine Weiterleitungen | immer Rückfrage |
| `update_plan` | Arbeitsplan/Fortschrittsbalken | immer |

## Provider & Modelle — [./techstack.md](./techstack.md), [../providers.md](../providers.md)
- DeepSeek, Anthropic (Opus/Fable), Qwen. **Kein SDK**, alles über axios.
- `/model`-Kurznamen (opus/fable/qwen/deepseek). Alle 3 API-Keys gleichzeitig gehalten.
- `capabilities.ts` steuert Adapter **und** Anzeige (was gilt je Modell).

## Streaming (DeepSeek + Qwen) — [../providers.md](../providers.md)
Gemeinsamer SSE-Client `openaiStream.ts`. Schaltet Qwen-Deep-Thinking frei, zeigt den
**Reasoning-Strom live** (grau), vermeidet Timeouts. Anthropic bleibt non-streaming (Phase 2).
Vertrag: vollständige Message oder werfen; `content` nie live (nur Reasoning).

## Rechte & Bereiche — [../permissions-and-scopes.md](../permissions-and-scopes.md)
Getrennte Lese-/Schreibbereiche, Checkbox-Projektauswahl, `/rights`. Start-Vorgaben: Lesen/
Schreiben ohne Rückfrage, Shell mit Rückfrage.

## Befehls-Sicherheit — [../security/leaven-cli-bash-commands-security.md](../security/leaven-cli-bash-commands-security.md)
Shell-frei (execFile), Allowlist (nur lesende Befehle), Verdicts **ok/ask/reject/redirect/
allow**. `cp`→`copy_file` (redirect). Enge `php -l`-Lint-Regel. Exakte Befehls-Registry
(`~/.leaven/allowed-commands.json`). bash-Skripte nur aus `~/.leaven`.

## Befehls-Registrierung — [../security/command-registration.md](../security/command-registration.md)
`propose_command` → Eingang `~/.leaven/requested-commands/` → Mensch prüft → verschiebt in
`allowed-commands.json`/`approved-scripts/`. Start-Manifest sagt dem Modell, was ohne/mit
Rückfrage geht.

## Anzeige-Schalter `/output` — [../configuration.md](../configuration.md)
Zwei **unabhängige** Schalter (von Rechten entkoppelt): `/output reasoning on|off`
(Live-Gedankenstrom), `/output steps on|off` (Zwischenschritte). `--verbose`=beides an,
`--quiet`=aus. Vorgabe: Gedanken aus, Schritte an.

## Tages-Token-Budget `/budget` — [../configuration.md](../configuration.md)
Pro **Anbieter** (anthropic/qwen/deepseek). Zählung aus `usage` (Streaming: `include_usage`),
persistent in `~/.leaven/usage.json`, Reset bei Datumswechsel. `/budget auto on` = Grenze
erzwingen (Auto-Stopp vor dem API-Call). `autoStopp` persistent.

## „weiter" / Persistenz + Auto-Fortsetzen — [../configuration.md](../configuration.md)
Auto-Stopp sichert den vollen Zustand nach `~/.leaven/session.json`; „weiter" (oder
`/resume`) setzt an derselben Aufgabe fort (gleiches Modell — Invariante). `/resume auto on`
= automatisch beim Start fortsetzen, **wenn Budget frei** (persistent, opt-in).

## Netz & Plattform
`fetch_url` (Domain-Allowlist, SSRF) — [../internet.md](../internet.md). `post_to_endpoint`
(eine Instanz) — [../leaven-api-endpoint-usage.md](../leaven-api-endpoint-usage.md).
Plattform-Rückkanal — [../leaven-platform-connect/api-docs.md](../leaven-platform-connect/api-docs.md) (**Entwurf**).

## Weiteres
Rollen ([../roles.md](../roles.md)), Arbeitsplan/Fortschritt ([../plan.md](../plan.md)),
Loop-Breaker, stiller Modus, orangener Eingaberahmen, Begrüssung, Geheimnis-Sperre,
Umgebungsbereinigung (Keys nicht an Kindprozesse).
