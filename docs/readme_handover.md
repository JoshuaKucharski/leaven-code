# readme_handover — Wegweiser durch die leaven-cli-Doku

**Stand:** 2026-07-29
**Für:** den nächsten KI-Assistenten (oder Menschen), der an leaven-cli arbeitet.

Diese Datei ist der **Einstieg**. Sie beschreibt jedes `.md` in `docs/` mit **Pfad + einer
Zeile Inhalt**, damit du gezielt nur das liest, was für deine Rolle oder Aufgabe zählt —
statt alles zu öffnen. Reihenfolge: (1) Pflichtlektüre, (2) nach Aufgabe gebündelt,
(3) vollständiges Verzeichnis, (4) Invarianten, die nicht brechen dürfen, (5) Konventionen.

Kurz, was leaven-cli **ist**: ein CLI-Agent für mehrere LLM-Provider (DeepSeek, Claude
Opus/Fable, Qwen). Der Nutzer stellt eine Aufgabe, das Modell fordert Werkzeuge an (Dateien
lesen/ändern/kopieren, Befehle ausführen, Web abrufen), die CLI führt sie **innerhalb harter
Grenzen** aus. Sprache: **Befehle englisch, alle Ausgaben/Kommentare/Doku deutsch.**

---

## 1. Pflichtlektüre (zuerst, in dieser Reihenfolge)

| Pfad | Warum zuerst |
|---|---|
| [./architecture.md](./architecture.md) | Wie das Programm läuft: Agent-Schleife, Module, die **Invarianten**, die nicht verletzt werden dürfen. |
| [./deepseek-api.md](./deepseek-api.md) | Die zwei häufigsten Arten, die CLI kaputtzumachen (`reasoning_content`, Modell mischen → HTTP 400). |
| [./tools.md](./tools.md) | Die Werkzeuge und die **Pfadsemantik** (relative Pfade zählen IMMER ab dem Lesebereich) + `securePath()`. |
| [./permissions-and-scopes.md](./permissions-and-scopes.md) | Lese-/Schreibbereiche, Startdialog, wer ohne Rückfrage läuft, `/rights`. |
| [./providers.md](./providers.md) | Drei Provider, der Adapter, Streaming, und **warum die Rechte modellunabhängig sind**. |

---

## 2. Nach Aufgabe / Rolle

**Du arbeitest am Kern / an der Agent-Schleife**
→ [./architecture.md](./architecture.md) · [./tools.md](./tools.md) · [./deepseek-api.md](./deepseek-api.md) · [./troubleshooting.md](./troubleshooting.md)

**Du arbeitest an Modellen / Providern / Streaming**
→ [./providers.md](./providers.md) · [./deepseek-api.md](./deepseek-api.md) · [./configuration.md](./configuration.md)
(Code: `src/providers/{capabilities,anthropic,qwen,openaiStream}.ts`)

**Du arbeitest an Sicherheit / Rechten / Befehlsausführung**
→ [./permissions-and-scopes.md](./permissions-and-scopes.md) · [./security/leaven-cli-bash-commands-security.md](./security/leaven-cli-bash-commands-security.md) · [./security/leaven-cli-critical-issues.md](./security/leaven-cli-critical-issues.md) · [./security/command-registration.md](./security/command-registration.md)
**Diese gehören zusammen** — die critical-issues nennen, was *nicht* geschützt ist; nur bash-commands-security zu lesen vermittelt ein zu gutes Gefühl.

**Du beantwortest „kann jemand auf meinen Rechner zugreifen?"**
→ [./security/environmental-facts.md](./security/environmental-facts.md) · [./security/environmental-facts-extended.md](./security/environmental-facts-extended.md) · [./security/environmental-cleanup-issues.md](./security/environmental-cleanup-issues.md)

**Du arbeitest an Netz / eigener Plattform-Anbindung**
→ [./internet.md](./internet.md) · [./leaven-api-endpoint-usage.md](./leaven-api-endpoint-usage.md) · [./leaven-platform-connect/api-docs.md](./leaven-platform-connect/api-docs.md)

**Du kümmerst dich um Bedienung / Konfiguration / Setup**
→ [./configuration.md](./configuration.md) · [./plan.md](./plan.md) · [./roles.md](./roles.md)

**Du testest oder suchst einen Fehler**
→ [./testing.md](./testing.md) · [./troubleshooting.md](./troubleshooting.md)

**Du übernimmst offene Aufgaben**
→ [./security-projects/git-security-feature.md](./security-projects/git-security-feature.md) · [./leaven-platform-connect/api-docs.md](./leaven-platform-connect/api-docs.md) (Entwurf, noch nicht gebaut)

**Du willst den letzten Projektstand**
→ [./2026-07-21_2008_cli-development_next-ai-agent-handover.md](./2026-07-21_2008_cli-development_next-ai-agent-handover.md) (aktuellster Zustandsbericht)

---

## 3. Vollständiges Verzeichnis (jede Datei, eine Zeile)

### Kern & Bedienung
| Pfad | Inhalt |
|---|---|
| [./README.md](./README.md) | Leichter Einstiegs-Index für Menschen (Kurzform dieser Datei). |
| [./architecture.md](./architecture.md) | Agent-Schleife, Modulaufbau, Eingabe-/Freigabe-/Ausgabe-Fluss, die zwei nicht verletzbaren Invarianten. |
| [./tools.md](./tools.md) | Die Werkzeuge (read/write/edit/**copy_file**/list/execute/**propose_command**/fetch/post/update_plan), Pfadsemantik, `securePath()`, `cp`→`copy_file`, `php -l`. |
| [./permissions-and-scopes.md](./permissions-and-scopes.md) | Getrennte Lese-/Schreibbereiche, Startdialog, Rechte-Vorgaben, „wer läuft ohne Rückfrage" (inkl. `allow`-Verdict), `/rights`. |
| [./configuration.md](./configuration.md) | Flags (`--model`, `--verbose`/`--quiet`, …), Umgebungsvariablen & **alle API-Schlüssel** (DeepSeek/Anthropic/Qwen), Slash-Befehle inkl. **`/model`-Kurznamen** (opus/fable/qwen/deepseek), **`/output`** (Gedanken/Schritte getrennt), **`/budget`** (Tages-Token-Budget pro Anbieter + Auto-Stopp), **„weiter" / `/resume`** (Aufgabe nach Auto-Stopp fortsetzen, `~/.leaven/session.json`; `/resume auto on\|off` = automatisch beim Start), `config/*.json`, Build. |
| [./plan.md](./plan.md) | `update_plan`-Werkzeug und der Fortschrittsbalken bei mehrstufigen Aufgaben. |
| [./roles.md](./roles.md) | Gespeicherte Arbeits-Setups (Bereiche, Rechte, Onboarding-Texte), Rollen-Isolation. |

### Provider & API
| Pfad | Inhalt |
|---|---|
| [./providers.md](./providers.md) | **DeepSeek + Claude (Opus/Fable) + Qwen**: Provider-Erkennung, Fähigkeiten-Deskriptor, Adapter (kein SDK, nur axios), **Streaming** (SSE-Client, Live-Reasoning, die Fallen), warum Rechte modellunabhängig sind. |
| [./deepseek-api.md](./deepseek-api.md) | DeepSeek-Eigenheiten, Thinking-Modus, `reasoning_content`-Invariante, häufige 400er. |

### Sicherheit
| Pfad | Inhalt |
|---|---|
| [./security/leaven-cli-bash-commands-security.md](./security/leaven-cli-bash-commands-security.md) | Shell-freie Ausführung, Allowlist statt Blocklist, Optionssperren, Geheimnis-Sperrliste, Umgebungsbereinigung, die Verdicts `ok/ask/reject/redirect/allow`, warum `git` nicht gelistet ist. |
| [./security/leaven-cli-critical-issues.md](./security/leaven-cli-critical-issues.md) | Was **nicht** geschützt ist, je mit „was wäre nötig": Drittanbieter-Offenlegung, Prompt-Injection, GET-Exfiltration, DNS-Rebinding, TOCTOU, Geheimnisse jenseits der Muster. |
| [./security/command-registration.md](./security/command-registration.md) | Kreislauf **vorschlagen → prüfen → freigeben**: `propose_command`, die drei Zonen unter `~/.leaven`, warum bash-Skripte nur aus der geschützten Zone laufen, das Start-Manifest. |
| [./security/environmental-facts.md](./security/environmental-facts.md) | Grundtatsachen: Kann der Anbieter (DeepSeek) von sich aus zugreifen / `/rights` umgehen? Nein — mit Code-Beleg (kein eingehender Kanal). |
| [./security/environmental-facts-extended.md](./security/environmental-facts-extended.md) | Dasselbe für Claude — als Anbieter und als Claude Code; wo der Türsteher liegt und welcher Rechtsraum. |
| [./security/environmental-cleanup-issues.md](./security/environmental-cleanup-issues.md) | Prüfung *dieses* Macs auf Google/Microsoft/Amazon: Befund (kein aktiver Fremdzugriff) + Aufräum-Punkte (AWS-Key, Playwright-Cache). |

### Netz & Plattform
| Pfad | Inhalt |
|---|---|
| [./internet.md](./internet.md) | `fetch_url`: Domain-Allowlist, SSRF-Sperre, HTML→Text, Sende-Endpunkt-Grundlagen. |
| [./leaven-api-endpoint-usage.md](./leaven-api-endpoint-usage.md) | Eigene Webinstanz anbinden: `post_to_endpoint`, genau EIN Ziel, keine Weiterleitungen, Pflichten der Gegenstelle. |
| [./leaven-platform-connect/api-docs.md](./leaven-platform-connect/api-docs.md) | ⚠️ **Entwurf, nicht gebaut:** Fortschrittsmeldung + Rückkanal (Weiterarbeiten nach N Schritten). |
| [./leaven-platform/feature-tasks/create-save-commands-and-scripts-to-secure-guarded-commands-registration-path.md](./leaven-platform/feature-tasks/create-save-commands-and-scripts-to-secure-guarded-commands-registration-path.md) | Die **Pfade** der gesicherten, AI-unveränderbaren Befehls-/Skript-Registrierung; „kennt sie, kann sie nicht ändern". |

### Testen, Fehler, offene Aufgaben
| Pfad | Inhalt |
|---|---|
| [./testing.md](./testing.md) | `npm test` (Guard/Logik/URL), separate Suiten (`test:anthropic`, `test:stream`), manuelle Prüfliste, Testumgebung. |
| [./troubleshooting.md](./troubleshooting.md) | Bekannte Fehlerbilder mit Ursache und Schutz (Terminal-Fallen, Pfad-Verwechslungen, ENOENT u.v.m.). |
| [./security-projects/git-security-feature.md](./security-projects/git-security-feature.md) | **Offene Aufgabe:** git kontrolliert auf die Allowlist zurückholen (warum es heikel ist, was nötig wäre). |

### Zustandsübergaben (Verlauf, nicht Referenz)
| Pfad | Inhalt |
|---|---|
| [./2026-07-21_2008_cli-development_next-ai-agent-handover.md](./2026-07-21_2008_cli-development_next-ai-agent-handover.md) | **Aktuellster** Zustandsbericht: was fertig/offen ist, Fallstricke, im Code verankerte Nutzer-Festlegungen. |
| [./ai-assistent-leaven-project.handover_2026-07-21_1116_opus-4-8.md](./ai-assistent-leaven-project.handover_2026-07-21_1116_opus-4-8.md) | Ältere Übergabe (11:16 Uhr) — in Teilen veraltet, nur als Verlauf. |

---

## 4. Invarianten, die NICHT brechen dürfen (mit Fundstelle)

1. **`reasoning_content` / `thinking`-Blöcke unverändert zurückreichen**; Modell/Thinking nicht mitten in einer Konversation wechseln → [./deepseek-api.md](./deepseek-api.md), [./providers.md](./providers.md).
2. **Rohes Antwortobjekt in die History pushen**, nie neu zusammenbauen → [./architecture.md](./architecture.md).
3. **Pfadsemantik:** relative Pfade zählen IMMER ab dem Lesebereich; `securePath()` ist symlink-fest → [./tools.md](./tools.md).
4. **Rechte sind modellunabhängig** — die CLI erzwingt sie, nicht das Modell → [./providers.md](./providers.md), [./security/environmental-facts.md](./security/environmental-facts.md).
5. **Streaming-Vertrag:** vollständige Message ODER werfen; `content` nie live drucken → [./providers.md](./providers.md).
6. **`~/.leaven` ist AI-dicht**; nur der Mensch gibt Befehle/Skripte frei (vorschlagen→prüfen→freigeben) → [./security/command-registration.md](./security/command-registration.md).
7. **Interpreter (`php`, `git`, `bash`) kommen nie pauschal auf die Allowlist**; nur exakte, vermerkte Befehle bzw. der enge `php -l` → [./security/leaven-cli-bash-commands-security.md](./security/leaven-cli-bash-commands-security.md).
8. **`post_to_endpoint`:** genau eine Ziel-URL, keine Weiterleitungen → [./leaven-api-endpoint-usage.md](./leaven-api-endpoint-usage.md).

---

## 5. Konventionen

- **Sprache:** Slash-Befehlsnamen englisch (international auffindbar), sämtliche Ausgaben, Kommentare und Doku **deutsch**.
- **Keine neuen Abhängigkeiten** für Provider/Netz: alles über das vorhandene `axios` (kein Anbieter-SDK) — Lieferketten-Sicherheit. Siehe [./providers.md](./providers.md).
- **Belegt statt behauptet:** Vermutungen messen, bevor man sie als Ursache benennt; ehrlich zwischen „behoben" und „gemildert" unterscheiden. Siehe die Arbeitsweise im [Handover](./2026-07-21_2008_cli-development_next-ai-agent-handover.md).
- **Führender Schrägstrich** in Nutzer-Pfaden (`/docs/…`) meint projektrelativ, nicht die Systemwurzel.
- **Testen ohne Kosten:** `npm test` läuft ohne API-Zugriff; Provider-Suiten (`test:anthropic`, `test:stream`) sind bewusst separat.
