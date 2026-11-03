# leavencode – USP: welches Problem es löst, welche Alternativen es gibt, was nur leavencode kann

**Stand:** 2026-11-03 · Aussagen über leavencode sind am Code belegt (`src/`, `config/`, Zahlen von diesem Tag). Aussagen über Claude Code stammen aus dessen eigener Dokumentation (code.claude.com, geprüft am 2026-11-03, Links in Abschnitt 7). Aussagen über andere Werkzeuge beruhen auf deren öffentlichen Unterlagen nach Kenntnisstand Mitte 2026; wo nicht am 2026-11-03 nachgeprüft, steht „(prüfen)". Dieser Markt ändert sich monatlich – vor einer Entscheidung die Links aufrufen.

Die ausführliche Sicherheitsgegenüberstellung steht in [security-and-privacy.md](./security-and-privacy.md), die Nachteile in [pain-points.md](./pain-points.md). Dieses Dokument beantwortet drei Fragen: Welches Problem löst leavencode, das Claude Code nicht löst? Welche Alternativen gibt es? Gibt es etwas, das nur leavencode kann?

---

## 1. Die Antwort in fünf Sätzen

Claude Code und seine Verwandten lösen das Problem „ein Sprachmodell soll in meinem Projekt arbeiten" – so bequem und so umfangreich wie möglich. leavencode löst ein anderes Problem: **„Ein Sprachmodell soll in meinem Projekt arbeiten, und ich will jede Grenze selbst besitzen, lesen und beweisen können – unabhängig davon, welches Modell und welcher Anbieter gerade dran ist."** Konkret heißt das: keine Shell, sondern ein Programm je Aufruf aus einer Allowlist; ein Lesebereich und angekreuzte Schreibbereiche, die auch eine Freigabe nicht aufhebt; Geheimnisse ab Werk gesperrt; Anbieterwechsel zur Laufzeit; keine Identität außer dem API-Schlüssel. Der Preis dafür ist Komfort und Funktionsumfang. Kein einzelner dieser Punkte ist anderswo unmöglich – exklusiv ist, dass sie **Konstruktion statt Konfiguration** sind, und dass diese Konstruktion aus rund 4 800 Zeilen eigenem, getestetem Code besteht.

---

## 2. Das Problem, das Claude Code nicht löst

Claude Code hat 2026 jede Schutzschicht, die man sich wünschen kann – **als Option**: Berechtigungsregeln, eine zuschaltbare Sandbox, einen Auto-Modus mit Klassifikator, Hooks, Deny-Regeln, Plan-Modus. Die Lücke ist kein fehlendes Feature. Es sind vier Eigenschaften des Gesamtsystems, die sich durch Konfiguration nicht ändern lassen.

### 2.1 Das Tor gehört jemand anderem

| | Claude Code | leavencode |
|---|---|---|
| Wer prüft die Werkzeug-Anforderungen des Modells? | Anthropics Programm: geschlossener Quellcode, gebündeltes npm-Paket, Selbst-Update | eigener Code: rund 4 800 Zeilen TypeScript in 17 Dateien, 5 Laufzeitpakete, kein LLM-SDK, 326 Tests |
| Kann man die Regeln vollständig lesen? | nein, nur die Dokumentation | ja: `src/guards/commandGuard.ts` (425 Zeilen), `securePath()` in `src/index.ts`, `src/guards/urlGuard.ts` (96 Zeilen), `config/commands.json` – etwa eine Stunde |
| Wer entscheidet, was sich ändert? | der Hersteller, mit jedem Update | der Besitzer |

Beide Werkzeuge funktionieren gleich: Das Modell gibt Werkzeug-*Anforderungen* als JSON aus, lokaler Code entscheidet. Der Unterschied ist, wessen Code das ist (`docs/security/environmental-facts-extended.md`). Für ein Unternehmen, das seine KI-Werkzeuge auditieren muss, ist das keine Geschmacksfrage.

### 2.2 Die Shell ist das Loch, das sich mit Regeln nicht stopfen lässt

**Claude Code** gibt dem Modell eine echte Shell. Freigaberegeln wie `Bash(npm run *)` prüfen den Befehlstext; Anthropics eigene Dokumentation hält fest, dass eine Deny-Regel nur auf den Befehl passt, *wie er geschrieben ist*, und dass man für eine Durchsetzung, die nicht vom Befehlstext abhängt, die Sandbox braucht. Die Sandbox (macOS Seatbelt, Linux bubblewrap, Netz über einen Proxy mit Allowlist) ist **zuschaltbar**, nicht Vorgabe; ihre Vorgabe erlaubt Schreiben im Arbeitsverzeichnis, aber **Lesen auf fast der ganzen Maschine, einschließlich Credential-Dateien wie `~/.ssh` und `~/.aws/credentials`** (so die Dokumentation wörtlich). Der 2026 eingeführte Auto-Modus ersetzt die menschliche Rückfrage durch einen Klassifikator; Anthropic schreibt dazu, er senke das Risiko, beseitige es aber nicht, und empfiehlt weiterhin isolierte Umgebungen. Kindprozesse erben die vollständige Umgebung, also auch alle Schlüssel in der Shell.

**leavencode** hat keine Shell. Programm und Argumente gehen getrennt an `execFile`; jeder Befehl mit Metazeichen (`; && | > $( )`) wird abgelehnt, bevor irgendetwas läuft. Ohne Rückfrage laufen zehn lesende Programme (`grep, rg, find, ls, cat, head, tail, wc, file, stat`) mit gesperrten Optionen, die auch gebündelt (`-rS`) und abgekürzt (`--deref`) erkannt werden. Jedes pfadartige Argument und jeder Pfad in einem Optionswert (`--file=/pfad`, `-f/pfad`) läuft durch `securePath()`. Kindprozesse bekommen eine bereinigte Umgebung ohne `*_KEY`, `*_TOKEN`, `*_SECRET`, `AWS_*`. Alles andere – `npm`, `git`, `php`, `node` – fragt, und selbst eine Freigabe hebt die Bereichsgrenze nicht auf (verifiziert: eine Datei außerhalb des Schreibbereichs überlebt `rm -rf` unter `--yes`).

**Grenze:** leavencode hat keine OS-Sandbox. Ein freigegebenes `npm test` läuft mit den vollen Rechten des Nutzers. Hier sind Claude Code mit eingeschalteter Sandbox und Codex CLI stärker (Abschnitt 4).

### 2.3 Wohin der Agent springen und was er lesen darf

Das ist der Punkt, an dem leavencode am weitesten vorn liegt – nicht, weil die Regeln klüger wären, sondern weil sie strukturell sind.

| Frage | Claude Code | leavencode |
|---|---|---|
| Wo darf gelesen werden? | im Startordner ohne Rückfrage; außerhalb per Rückfrage oder `--add-dir`; über die Shell `cd ..` und `cat` überall, sobald ein Befehl freigegeben ist | genau **ein** Lesebereich (Startdialog oder `--read-root`); relative Pfade zählen immer ab dort; kein `cd`, weil keine Shell |
| Wo darf geschrieben werden? | Arbeitsverzeichnis, Edits mit Rückfrage (Vorgabemodus) | nur angekreuzte Projekte, getrennt vom Lesebereich – „breit lesen, eng schreiben" ist die Vorgabe |
| Symlink aus dem Bereich hinaus | Sandbox-Sache | `realpathSoFar()` löst Symlinks so weit auf, wie der Pfad existiert; ein Link auf `/tmp` wird abgelehnt (verifiziert) |
| `.env`, Schlüssel, `.ssh`, `.aws`, `.gnupg` | kein Schutz ab Werk; `Read(./.env)`-Deny-Regeln muss man selbst setzen; Sandbox-Lesen schließt Credential-Dateien ein | **gesperrt, auch innerhalb erlaubter Bereiche**, für Datei-Werkzeuge, `copy_file`-Quelle und Befehlsargumente; aufhebbar nur sichtbar per `--allow-secrets` |
| Wo liegen die Freigaben? | `.claude/settings.json` im Projekt oder Home – Dateien, die der Agent mit seinen Werkzeugen erreichen kann, wenn man sie nicht schützt | `~/.leaven/allowed-commands.json` – für den Agenten unlesbar und unschreibbar; er kann nur **vorschlagen** (`propose_command`), freigeben kann nur ein Mensch |
| Rechte während eines Laufs erweitern | Dialog „immer erlauben" schreibt eine Regel | nicht möglich; Rechte kommen aus dem Start, `/rights` ist ein Nutzerakt zwischen Aufträgen |

### 2.4 Datenziel und Identität

| | Claude Code | leavencode |
|---|---|---|
| Modelle | nur Anthropic-Modelle: Anthropic-API, Amazon Bedrock, Google Vertex AI, Microsoft Foundry, LLM-Gateways über `ANTHROPIC_BASE_URL` | DeepSeek (`deepseek-v4-pro`, `-flash`), Anthropic (`claude-opus-5`, `claude-opus-4-8`, `claude-fable-5`), Qwen (`qwen3.7-max`) – drei native Adapter |
| Fremdanbieter | nur über deren Anthropic-kompatible Endpunkte (DeepSeek dokumentiert `https://api.deepseek.com/anthropic`); von Anthropic nicht unterstützt, ein Endpunkt je Konfiguration, kein Wechsel per Befehl | `/model opus`, `/model qwen` zur Laufzeit; Thinking, Denktiefe und Temperatur je Anbieter korrekt abgebildet (`capabilities.ts`) |
| Rechtsraum der gelesenen Daten | USA (bzw. die gewählte Cloud) | je Aufgabe wählbar: China (DeepSeek, DashScope) oder USA (Anthropic) |
| Identität | Claude-Konto mit Login oder API-Schlüssel | nur API-Schlüssel; kein Konto, kein Login |
| Nicht-Modell-Verkehr | Nutzungsmetriken und Fehlerberichte (laut Doku ohne Code, Prompts oder Dateipfade) an Datadog-Hosts, Feature-Flags, Update-Prüfung, `/feedback` sendet Konversationen; abschaltbar per `DISABLE_TELEMETRY`, `DISABLE_ERROR_REPORTING` bzw. gesamt `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` | keiner. Außer den API-Aufrufen gibt es nur zwei **optionale** Kanäle zur eigenen Plattform: Board-Selbstmeldung (`LEAVEN_BUCKET_*`) und `post_to_endpoint` an genau eine konfigurierte Adresse, jedes Senden mit Freigabe |
| Netz für das Modell | `WebFetch`/`WebSearch` vorhanden; `curl` über die Shell, sobald Bash frei ist | aus, bis eine Domain per `/internet add` freigegeben ist; nur GET, SSRF-Sperre, keine Weiterleitung beim Senden |

**Grenze:** Alles, was gelesen wird, geht auch bei leavencode an den gewählten Anbieter. Ein lokales Modell ist heute nicht angebunden (Abschnitt 3).

### 2.5 Entgleisungsschutz in der interaktiven Sitzung

Loop-Breaker (identische Aufrufe, Retry-Stürme, Zyklen), Tool-Call-Backstop und ein Tages-Token-Budget je Anbieter mit Auto-Stopp und Fortsetzen am nächsten Tag laufen in der normalen Terminal-Sitzung. Bei Claude Code gibt es Schritt- und Kostendeckel nach unserem Kenntnisstand nur im nicht-interaktiven Modus und keine Schleifenerkennung – das Loop-Breaker-Plugin im Ordner `loop-breaker/` existiert genau deshalb und war die Vorlage für `src/guards/loopBreaker.ts`.

### 2.6 Eigene Plattform statt fremder Cloud

Der Leaven-Launcher startet leavencode mit Prompt-Datei und Profil, die CLI meldet Fortschritt an das eigene TaskBoard (Laravel), und der Bearer-Token dafür erreicht den Agenten nie (`board.ts`, `scrubEnvironment`). Claude Codes Gegenstücke – Claude Code im Web, Remote Control, Team-Auswertungen – laufen über Anthropics Infrastruktur; ein Export eigener Metriken ist per OpenTelemetry möglich, die Steuerung bleibt beim Hersteller.

---

## 3. Die drei Beispiele aus der Frage, ehrlich beantwortet

| Behauptung | Stimmt sie? | Einschränkung |
|---|---|---|
| **Volle Datenschutzkontrolle** | Über die **Kanäle** (keine Telemetrie, kein Konto, Senden nur an eine Adresse), das **Ziel** (Anbieter und Rechtsraum je Aufgabe) und den **Umfang** (ein enger Lesebereich, Geheimnisse gesperrt): ja. | Über den **Inhalt**: nein. Was gelesen wird, geht an den Anbieter – bei jedem Cloud-Werkzeug. „Voll" wird es erst mit einem lokalen Modell. Der OpenAI-kompatible Pfad (`openaiStream.ts`) würde Ollama oder vLLM tragen; heute sind die Basis-URLs Konstanten, nicht konfigurierbar – eine kleine Änderung, siehe [open-work.md](./open-work.md), Abschnitt B. |
| **Kontrolle, wohin der Agent springen und was er lesen darf** | Ja – das ist der stärkste Punkt, und er ist **strukturell**: kein `cd`, Symlinks aufgelöst, Geheimnisse ab Werk gesperrt, Freigabe-Registry außerhalb der Reichweite, keine Rechteerweiterung während des Laufs. | Keine OS-Sandbox: Ein freigegebener nicht lesender Befehl läuft mit Nutzerrechten. |
| **Wechsel von Modellen und Anbietern** | Ja, drei Anbieter zur Laufzeit per `/model`, mit identischen Rechten – das Tor kennt das Modell nicht. | Ein Wechsel leert den Verlauf (Format-Invariante der Provider); nur drei Anbieter, IDs von Hand gepflegt. Offene Werkzeuge wie OpenCode, Goose oder Aider kennen weit mehr Anbieter – dort hängt die Strenge der Rechte aber nicht am Werkzeug, sondern an der Konfiguration. |

---

## 4. Alternativen

Vier Gruppen. „Echte Shell" bedeutet: Das Modell bekommt `bash`/`zsh` mit Pipes, `cd` und Umleitungen, und die Absicherung besteht aus Rückfrage, Regeln oder einer OS-Sandbox.

| Werkzeug | Quelle / Lizenz | Modelle | Befehle und Sandbox | Konto / Telemetrie | Bemerkung |
|---|---|---|---|---|---|
| **Claude Code** (Anthropic) | geschlossen, npm-Bundle | nur Anthropic-Modelle (API, Bedrock, Vertex, Foundry, Gateways); Fremdanbieter inoffiziell über kompatible Endpunkte | echte Shell; Regeln, zuschaltbare Sandbox (Seatbelt / bubblewrap, Netz-Proxy mit Allowlist), Auto-Modus mit Klassifikator (Preview) | Konto oder API-Key; Telemetrie ab Werk an, abschaltbar | Maßstab für Umfang: MCP, Subagenten, Hooks, Plugins, IDE, Web, Kontextverdichtung |
| **OpenAI Codex CLI** | Apache-2.0 (Rust) | OpenAI; per Konfiguration andere OpenAI-kompatible Endpunkte und lokale Modelle (prüfen) | echte Shell **in einer OS-Sandbox ab Werk**: Seatbelt (macOS), Landlock + seccomp (Linux); Schreiben nur im Workspace, Netz aus (geprüft 2026-11-03) | ChatGPT-Login oder API-Key | die konsequenteste Sandbox-Vorgabe unter den großen Werkzeugen |
| **Gemini CLI** (Google) | Apache-2.0 | Gemini (Google-Konto, API-Key, Vertex) | echte Shell; Sandbox optional (Seatbelt, Docker/Podman) | Google-Konto; Nutzungsstatistik ab Werk an, abschaltbar (prüfen) | großzügiges Gratis-Kontingent, MCP, Erweiterungen |
| **Aider** | Apache-2.0 (Python) | praktisch jeder Anbieter über LiteLLM, lokal über Ollama | **keine Agenten-Shell**: Befehle nur auf Zuruf (`/run`) oder mit Bestätigung; keine Sandbox | kein Konto; Analytics opt-in (prüfen) | git-zentriert, jede Änderung ein Commit; dem Grundgedanken von leavencode am nächsten |
| **OpenCode** (SST / Anomaly) | MIT | über 75 Anbieter einschließlich lokaler | echte Shell; Rechte je Werkzeug als ask/allow/deny konfigurierbar; keine OS-Sandbox | kein Konto nötig | Client/Server-Architektur, Terminal-UI; die verbreitetste offene Mehranbieter-Option |
| **Crush** (Charm) | FSL (quelloffen, nicht OSI) | viele Anbieter einschließlich lokaler | echte Shell; Freigabe je Werkzeug, `--yolo` | kein Konto; Metriken abschaltbar (prüfen) | LSP-Anbindung, MCP |
| **Goose** (Block) | Apache-2.0 (Rust) | viele Anbieter einschließlich lokaler | echte Shell; Modi auto / approve / chat; keine OS-Sandbox | kein Konto | Erweiterungen als MCP-Server, auch als Desktop-App |
| **Qwen Code** (Alibaba) | Apache-2.0 (Fork von Gemini CLI) | Qwen (OAuth-Gratiskontingent) und OpenAI-kompatible Endpunkte | wie Gemini CLI | Qwen-Konto oder Key | für Qwen-Modelle optimiert |
| **Cline CLI**, **Kilo Code CLI** | Apache-2.0 | viele Anbieter, eigener Schlüssel, lokal | echte Shell; Freigaben; keine Sandbox | optional Konto | aus den VS-Code-Erweiterungen hervorgegangen |
| **GitHub Copilot CLI** | geschlossen | Claude, GPT, Gemini über Copilot | echte Shell; Freigabe je Befehl | GitHub-Konto und Abo | tiefe GitHub-Integration |
| **Cursor CLI**, **Amp**, **Factory Droid**, **Warp**, **Kiro CLI** (AWS) | geschlossen | mehrere Modelle über das jeweilige Konto | echte Shell; Freigaben; teils Sandbox (prüfen) | Konto zwingend | Komfort, gebunden an das Anbieterkonto |
| **Kimi CLI** (Moonshot), **Mistral Vibe** | quelloffen | Modelle des Herstellers, teils kompatible | echte Shell; Freigaben | Konto oder Key | Hersteller-CLIs |

**Anthropic-kompatible Endpunkte.** DeepSeek (bestätigt: `https://api.deepseek.com/anthropic`), nach Kenntnisstand auch Moonshot, Zhipu/Z.ai, Alibaba DashScope und MiniMax bieten Endpunkte im Anthropic-Format an, damit Claude Code mit ihren Modellen läuft. Das ersetzt den Anbieter, nicht das Vertrauensmodell: Es bleibt ein Endpunkt je Konfiguration, ohne Zusage von Anthropic, und Thinking- und Denktiefe-Parameter werden nicht sauber abgebildet.

**Das Muster.** Alle Alternativen außer Aider geben dem Modell eine echte Shell und sichern sie mit Rückfrage, Regeln oder OS-Sandbox ab. Nach Kenntnisstand hat keine davon (a) eine feste Programm-Allowlist ohne Shell, (b) eine Pfadprüfung jedes Befehlsarguments gegen getrennte Lese- und Schreibbereiche, (c) eine Geheimnis-Sperre ab Werk auch innerhalb erlaubter Bereiche, (d) eine Freigabequelle außerhalb der Reichweite des Agenten. Dafür haben fast alle eine OS-Sandbox im Angebot, mehr Anbieter, Streaming, MCP und Kontextverdichtung.

---

## 5. Was nur leavencode kann

Ehrlich: **kein einzelnes Merkmal ist technisch exklusiv.** Jeder Punkt ließe sich in einem offenen Werkzeug nachbauen oder in Claude Code per Deny-Regeln, Sandbox und Hooks annähern. Exklusiv ist die Kombination und ihre Form:

1. **Grenzen als Konstruktion, nicht als Konfiguration.** Keine Shell, Allowlist mit gesperrten Optionen, Pfadprüfung jedes Arguments, Geheimnis-Sperre, bereinigte Umgebung, Netz aus, Senden nur an eine Adresse – alles Vorgabe, nichts davon muss man wissen oder einschalten. Was nicht möglich ist, kann nicht vergessen werden.
2. **Modellunabhängig gleich strenge Rechte.** Ein Wechsel von DeepSeek zu Opus zu Qwen ändert nichts am Tor; `securePath()` und `checkCommand()` kennen das Modell nicht.
3. **Eine Vertrauensgrenze, die man in einer Stunde liest.** Fünf Laufzeitpakete, kein SDK, drei APIs als rohes HTTPS, 326 Tests mit Injektions-, Symlink-, SSRF- und Registry-Umgehungsversuchen.
4. **Eine Freigabe-Registry, die der Agent weder lesen noch schreiben kann,** plus ein Vorschlags-Kreislauf (`propose_command` → `~/.leaven/requested-commands/` → Mensch trägt ein).
5. **Keine Identität außer dem Schlüssel.** Kein Konto, kein Login, keine Telemetrie, kein Update-Check, keine Feature-Flags – und die Wahl des Rechtsraums je Aufgabe.
6. **Anbindung an die eigene Plattform** (Launcher, TaskBoard, Rollen) statt an die Cloud eines Herstellers; durchgehend deutsch in Ausgabe, Systemprompt und Dokumentation.

**Was leavencode dafür nicht kann** (vollständig in [pain-points.md](./pain-points.md), Abschnitt 8): OS-Sandbox, MCP, Subagenten, Hooks, Websuche, Bild-Eingabe, Live-Streaming des Antworttexts, Kontextverdichtung, Sitzungen auflisten und fortsetzen, Diff-Ansicht, lokales Modell, Selbst-Update. Und es hat einen Pfleger, keinen Hersteller.

---

## 6. Wann welches Werkzeug

| Situation | Empfehlung |
|---|---|
| Eigene Projekte; Grenzen und Nachvollziehbarkeit wichtiger als Komfort; Anbieter je Aufgabe wählen | **leavencode** |
| Maximaler Komfort und Funktionsumfang; Anthropic als Datenziel in Ordnung | **Claude Code** – mit eingeschalteter Sandbox und eigenen Deny-Regeln für `.env` und Elternverzeichnisse |
| OS-Sandbox ab Werk; OpenAI als Datenziel in Ordnung | **Codex CLI** |
| Viele Anbieter, offener Code, lokale Modelle | **OpenCode**, **Goose**, **Aider** |
| Vollständig offline | **Aider**, **OpenCode** oder **Goose** mit Ollama – leavencode kann das heute nicht |
| Fremder, nicht vertrauenswürdiger Code | Container oder VM – unabhängig vom Werkzeug; keines der genannten ist dafür gebaut, leavencode ausdrücklich nicht |

---

## 7. Belege

**Code (leavencode):** `src/guards/commandGuard.ts` (Allowlist, Metazeichen, `flagGesperrt`, `eingebetteteWerte`, `scrubEnvironment`), `securePath()` und `isAutoApproved()` in `src/index.ts`, `src/guards/urlGuard.ts`, `src/providers/capabilities.ts` (Anbieter, Aliase), `src/board.ts` (Plattform-Kanal), `config/commands.json` (Listen mit Begründungen), `package.json` (fünf Laufzeitpakete), `tests/` (326 Prüfungen).

**Claude Code (geprüft 2026-11-03):**
- Sandbox: https://code.claude.com/docs/en/sandboxing – Seatbelt/bubblewrap, Netz-Proxy mit leerer Allowlist, Lese-Vorgabe „most of the machine, including credential files", Hinweis, dass Deny-Regeln auf den Befehlstext passen und der Klassifikator des Auto-Modus vor dem Lauf entscheidet.
- Berechtigungen: https://code.claude.com/docs/en/permissions · Sicherheit: https://code.claude.com/docs/en/security
- Datenverkehr: https://code.claude.com/docs/en/data-usage und https://code.claude.com/docs/en/env-vars – Nutzungsmetriken, Fehlerberichte, `DISABLE_TELEMETRY`, `DISABLE_ERROR_REPORTING`, `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`, `/feedback`.
- Auto-Modus: Anthropics Ankündigung als Research Preview (März 2026) und https://www.anthropic.com/engineering/claude-code-sandboxing

**Andere (geprüft 2026-11-03):** DeepSeek-Endpunkt im Anthropic-Format: https://api-docs.deepseek.com/guides/anthropic_api · Codex-CLI-Sicherheitsmodell: https://developers.openai.com/codex/security

**Verwandte Dokumente:** [security-and-privacy.md](./security-and-privacy.md) (Schutzschichten im Detail) · [pain-points.md](./pain-points.md) (was fehlt) · [open-work.md](./open-work.md) (was geplant ist) · [full-documentation.md](./full-documentation.md) (wie es funktioniert) · [techstack.md](./techstack.md) (woraus es besteht) · [integration-compatibility.md](./integration-compatibility.md) (Anbindung an eigene Systeme) · `docs/security/environmental-facts-extended.md` (wessen Code das Tor bewacht).
