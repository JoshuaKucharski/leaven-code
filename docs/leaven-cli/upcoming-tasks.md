# upcoming-tasks — offene Aufgaben

**Stand:** 2026-07-30; Gesamtliste mit Stand 2026-11-02: [../leavencode-documentation/open-work.md](../leavencode-documentation/open-work.md). Was noch aussteht, nach Wichtigkeit.

## Features / Ausbau
| Aufgabe | Umfang | Wo/Notiz |
|---|---|---|
| **git kontrolliert** auf die Allowlist zurückholen | groß, eigene Einheit | [../security-projects/git-security-feature.md](../security-projects/git-security-feature.md). Heikel: repo-eigene `.git/config` startet über textconv/pager beliebige Programme. |
| **Anthropic-Streaming (Phase 2)** | mittel | Opus/Fable streamen dann auch. Anderes Event-Modell (`content_block_delta` etc.) als der OpenAI-Pfad — eigener Parser. Fundament (openaiStream.ts, Live-Reasoning) steht. |
| **Plattform-Rückkanal** implementieren | mittel | Spezifikation liegt vor: [../leaven-platform-connect/api-docs.md](../leaven-platform-connect/api-docs.md) (**Entwurf, nicht gebaut**). |
| **Save-on-`/exit`-mitten-in-der-Aufgabe** | klein | Aktuell speichert nur der Budget-Auto-Stopp die Session; `/exit` mitten drin könnte gleich `speichereSession` nutzen. |
| **Mehrere Sessions / pro Projekt** | klein–mittel | „weiter" hat aktuell genau einen globalen Slot (`session.json`). |

## Sicherheit / Datenschutz (siehe [./security.md](./security.md), [./privacy-relevant-issues.md](./privacy-relevant-issues.md))
| Aufgabe | Umfang | Notiz |
|---|---|---|
| **Audit-Protokoll** | klein | Nachvollziehen, was ausgeführt/gesendet wurde. In critical-issues Punkt 9. |
| **Egress-Kontrolle dokumentieren** | klein | OS-Firewall nur auf erlaubte API-Hosts. |
| **Lokale Zustandsdateien verschlüsseln** | mittel | `session.json`/`usage.json` liegen im Klartext (in `~/.leaven`, AI-gesperrt). |
| **Warnzeile beim Start unter `--yes`** | sehr klein | critical-issues Punkt 7. |

## Aufräumen / trivial
| Aufgabe | Notiz |
|---|---|
| `mode`-Schlüssel aus `config/loopBreaker.json` | wird derzeit ignoriert – auswerten oder entfernen. |
| `src/index.ts.backup` löschen | totes Überbleibsel. |

## Live noch zu bestätigen (kostet nur der Nutzer, Keys in seiner Shell)
- **Qwen include_usage im Stream** — der Budget-Test zeigte für DeepSeek echte Zahlen; Qwens
  Stream-Usage analog beiläufig prüfen (`/budget` nach einem Qwen-Lauf). Fehlt sie, anders holen.

## Bewusst NICHT gebaut
- **Bracketed Paste** (Einfügen ohne Sofort-Absenden) — heikler Terminal-Bereich; Nutzer wollte es
  ausdrücklich **nicht**.

## Nie ausgeführt (Ursprungsaufgabe)
Die allererste Nutzer-Aufgabe (Footer/Brand-Titel/`.env` in `~/develop/templates/julalo-ui-
components`) wurde nie umgesetzt. Die `.env`-Änderung bräuchte `--allow-secrets`.
