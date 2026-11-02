# leaven-cli — Dokumentation

**Stand:** 2026-07-29

Ein CLI-Agent für mehrere LLM-Provider (DeepSeek, Claude Opus/Fable, Qwen): Aufgabe stellen,
das Modell fordert Werkzeuge an, die CLI führt sie aus — mit Bereichsgrenzen,
Befehlsfreigabe und Schleifenerkennung. Bedienung über Slash-Befehle (`/help`).

> **Vollständiger Wegweiser für KI-Assistenten:** [readme_handover.md](./readme_handover.md)
> — listet **jedes** Dokument mit Pfad + Kurzbeschreibung, nach Rolle/Aufgabe gebündelt.
> Wenn du gezielt das Richtige finden willst, fang dort an.

## Einstieg

Wer neu dazukommt, liest in dieser Reihenfolge:

1. **[architecture.md](./architecture.md)** — wie das Programm funktioniert, insbesondere
   die Agent-Schleife und ihre drei Invarianten
2. **[deepseek-api.md](./deepseek-api.md)** — Modellnamen, Thinking-Modus,
   `reasoning_content`. Pflichtlektüre vor Änderungen an `callApi()` oder der History
3. **[tools.md](./tools.md)** — die fünf Werkzeuge und die Pfadsemantik
4. **[permissions-and-scopes.md](./permissions-and-scopes.md)** — Lese-/Schreibbereiche,
   Startdialog, stiller Modus

## Nachschlagen

| Dokument | Inhalt |
|---|---|
| [providers.md](./providers.md) | Modell-Provider (DeepSeek + Claude), Adapter, warum die Rechte modellunabhängig sind |
| [plan.md](./plan.md) | Arbeitsplan und Fortschrittsbalken bei mehrstufigen Aufgaben |
| [roles.md](./roles.md) | Gespeicherte Arbeits-Setups: Bereiche, Rechte, Onboarding-Texte |
| [internet.md](./internet.md) | Netzzugriff: `fetch_url`, Domain-Allowlist, Sende-Endpunkt |
| [leaven-api-endpoint-usage.md](./leaven-api-endpoint-usage.md) | Eigene Webinstanz anbinden — Beispiele und Pflichten der Gegenstelle |
| [leaven-platform-connect/api-docs.md](./leaven-platform-connect/api-docs.md) | ⚠️ **Entwurf:** Fortschrittsmeldung und Rückkanal zur Plattform — noch nicht gebaut |
| [configuration.md](./configuration.md) | Flags, Umgebungsvariablen, `config/*.json`, Build |
| [testing.md](./testing.md) | `npm test`, manuelle Prüfliste, Testumgebung |
| [troubleshooting.md](./troubleshooting.md) | Fehlerbilder mit Ursache und Schutz |

## Sicherheit

| Dokument | Inhalt |
|---|---|
| [security/leaven-cli-bash-commands-security.md](./security/leaven-cli-bash-commands-security.md) | Bedrohungen und was dagegen unternommen wird |
| [security/leaven-cli-critical-issues.md](./security/leaven-cli-critical-issues.md) | Was **nicht** geschützt ist, je mit „was wäre nötig" |
| [security/environmental-facts.md](./security/environmental-facts.md) | Grundtatsachen: kann der Anbieter von sich aus zugreifen? (Nein — mit Beleg) |
| [security/environmental-facts-extended.md](./security/environmental-facts-extended.md) | Erweiterung: gilt das auch für Claude? (als Anbieter und als Claude Code) |
| [security/environmental-cleanup-issues.md](./security/environmental-cleanup-issues.md) | Prüfung dieses Macs auf Google/Microsoft/Amazon — Befund und Aufräum-Punkte |
| [security-projects/git-security-feature.md](./security-projects/git-security-feature.md) | Offene Aufgabe: git kontrolliert zurückholen |

Die beiden Sicherheitsdokumente gehören zusammen. Das erste allein vermittelt ein zu gutes
Gefühl.

## Übergabe

**Aktuell:** [2026-07-21_2008_cli-development_next-ai-agent-handover.md](./2026-07-21_2008_cli-development_next-ai-agent-handover.md)
— Zustandsbericht für einen anderen KI-Assistenten: was fertig ist, was offen ist, welche
Fallstricke bekannt sind, und welche Festlegungen des Nutzers im Code verankert sind.

Ältere Übergaben (`ai-assistent-leaven-project.handover_*.md`) bleiben als Verlauf
liegen, sind aber in Teilen veraltet.

## Schnellstart

```bash
npm run build
export DEEPSEEK_API_KEY="sk-…"
node dist/index.js
npm test        # 221 Prüfungen, ohne API-Zugriff
```
