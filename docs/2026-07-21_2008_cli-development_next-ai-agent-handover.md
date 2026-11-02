# Projektübergabe leaven-cli — Abschluss der Entwicklungssitzung

**Erstellt:** 2026-07-21, 20:08
**Erstellt von:** Claude Opus 4.8
**Für:** den nächsten KI-Assistenten, der an diesem Projekt weiterarbeitet
**Ersetzt:** [handover_2026-07-21_1116](./ai-assistent-leaven-project.handover_2026-07-21_1116_opus-4-8.md)
— jenes Dokument beschreibt nur den Stand von 11:16 Uhr; danach kam etwa die Hälfte der
heutigen Arbeit dazu. Es bleibt als Verlaufsdokument liegen, ist aber in mehreren Zahlen
veraltet (u.a. 85 statt 119 Tests, Iterationsgrenze 25 statt 40).

---

## 1. Was das Projekt ist

`leaven-cli` ist ein CLI-Agent für die DeepSeek-API. Der Nutzer stellt eine Aufgabe, das
Modell fordert Werkzeuge an (Dateien lesen, ändern, Befehle ausführen, Web abrufen), die CLI
führt sie aus und gibt die Ergebnisse zurück — bis die Aufgabe erledigt ist.

Der Nutzer hat das Projekt ursprünglich mit DeepSeek selbst gebaut. Das erklärte Ziel war:
**eine Datei ändern können, ohne dass die CLI abbricht oder ins Leere läuft.** Das ist
erreicht und gegen die echte API verifiziert.

**Verwendungszweck laut Nutzer:** ausschliesslich Quellcode-Entwicklung. Keine
personenbezogenen Daten. Diese Festlegung ist für die Datenschutzbewertung relevant
(siehe Abschnitt 7).

**Sprachregelung — bitte beibehalten:**
Befehlsnamen **englisch** (international auffindbar), sämtliche Ausgaben, Kommentare und
Dokumentation **deutsch**. Der Nutzer hat das ausdrücklich so festgelegt.

---

## 2. Ist-Zustand (geprüft am 2026-07-21, 20:08)

| Prüfung | Ergebnis |
|---|---|
| `npm run typecheck` | sauber |
| `npm run build` | sauber |
| `npm test` | **119 bestanden**, 0 fehlgeschlagen (75 Guard + 13 Logik + 31 URL) |

Kein git-Repository — es gibt keine Versionsgeschichte. `src/index.ts` ist ~2370 Zeilen.
`src/index.ts.backup` ist ein totes Überbleibsel und wird nicht gebaut.

### Umfang

**10 Werkzeuge:** `read_file`, `write_file`, `edit_file`, `copy_file`, `list_files`,
`update_plan`, `fetch_url`, `post_to_endpoint`, `execute_command`, `propose_command`
(`copy_file` + `propose_command` ergänzt am 2026-07-23; `cp` → `copy_file` umgeleitet.
`propose_command` schlägt Befehle/Skripte zur menschlichen Freigabe vor — siehe
[security/command-registration.md](./security/command-registration.md).)

**Drei Provider** (ergänzt 2026-07-23): DeepSeek, Anthropic (Opus 4.8, Fable 5) **und** Qwen
(`qwen3.7-max`, DashScope) in `/model`. Adapter in `src/providers/{anthropic,qwen}.ts` über
das **vorhandene axios** (bewusst **kein** SDK — nicht `@anthropic-ai/sdk`, nicht `dashscope`,
nicht `openai` — Lieferketten-Sicherheit). Qwen ist OpenAI-kompatibel und reused den
DeepSeek-Pfad. `capabilities.ts` steuert Adapter **und** Anzeige (provider-abhängiges
`/help`, `/temperature` nur DeepSeek/Qwen, Fable Thinking immer an, Qwen v1 Standardmodus da
Deep-Thinking Streaming braucht). Alle API-Schlüssel werden gleichzeitig gehalten.
**Wichtig:** Die Rechte-Schicht ist modellunabhängig — Claude/Qwen sind genauso eingegrenzt
wie DeepSeek. Details: [providers.md](./providers.md). Adapter-Tests separat:
`npm run test:anthropic` (36) und `npm run test:stream` (36), beide ohne API.

**Streaming Phase 1** (ergänzt 2026-07-29): DeepSeek + Qwen streamen über den gemeinsamen
SSE-Client `src/providers/openaiStream.ts` (kein neues Paket). Schaltet Qwens Deep-Thinking
frei, zeigt den Reasoning-Strom live, vermeidet Timeouts. **Zweifach Fable-reviewed**
(Design + Code) — die reinen Funktionen (SSE-Parser, Tool-Call-Assembler) sind in
`test-stream.js` gegen alle Edge-Cases geprüft (UTF-8-Chunk-Grenzen, `reasoning_content:''`-
Phantom, Index-Interleaving, kaputte Argumente). Oberster Vertrag: **vollständige Message
ODER werfen**. `content` wird NIE live gedruckt (nur Reasoning). Anthropic-Streaming = Phase 2.

**Befehls-Freigabe, vier Verdicts** (`commandGuard.ts`, ergänzt 2026-07-23): `ok`
(Allowlist), `ask` (Dialog), `reject` (nie), `redirect` (auf besseres Werkzeug, z.B. `cp`→
`copy_file`), `allow` (ohne Dialog). `allow` speist sich aus zwei Quellen: der vom Menschen
gepflegten, AI-gesperrten Registry `~/.leaven/allowed-commands.json` (exakter Abgleich
vollständiger Befehle) und der engen `php -l`-Lint-Regel. Damit laufen Dauerbefehle wie
`php artisan view:clear` ohne Rückfrage, **ohne** `php` als Interpreter freizugeben. Siehe
[security/…bash-commands-security.md](./security/leaven-cli-bash-commands-security.md) →
„Exakte Registry statt Interpreter-Allowlist".

**Slash-Befehle:** `/help`, `/status`, `/rights`, `/model` (mit Kurznamen opus/fable/qwen/
deepseek), `/thinking`, `/effort`, `/temperature`, `/output` (Gedanken/Schritte getrennt
an/aus), `/budget` (Tages-Token-Budget pro Anbieter + Auto-Stopp), `/key`, `/plan`,
`/internet`, `/endpoint`, `/role`, `/clear`, `/exit`

**Tages-Token-Budget** (ergänzt 2026-07-29): pro **Anbieter** (anthropic/qwen/deepseek — Claude
teilt eine Quote über Opus+Fable), Zählung aus `usage` (Streaming: `include_usage`), Stand +
`autoStopp` persistent in `~/.leaven/usage.json`, Reset bei Datumswechsel. `/budget auto on`
erzwingt die Grenze (Auto-Stopp vor dem API-Call). Reine Logik in `src/usage.ts` (`test:usage`, 15).

**„weiter" / Konversations-Persistenz** (ergänzt 2026-07-30): Auto-Stopp sichert den vollen
Zustand (messages + plan + model/thinking/effort) nach `~/.leaven/session.json`; „weiter"
setzt am nächsten Tag an derselben Aufgabe fort. `src/session.ts` (`sessionGueltig`, `test:session`,
8). **Zweifach-Fable-reviewed** (7 Bugs gefixt: geladeneSession spiegelt die Datei; `sessionGehoertAktuell`
verhindert Löschen fremder Sessions; Datei erst nach Erfolg löschen; Systemprompt beim Resume
auffrischen; `autoStopp`/Validierung). **Runtime-Vertrag:** `runAgentTurn` gibt `'fertig'|'budget'`
zurück; nur `'budget'` (Auto-Stopp am Schleifenkopf, History dort immer gültig) speichert.
Resume-Logik zentral in `sessionFortsetzen()`, genutzt von „weiter", `/resume` und dem Auto-Start.

**Auto-Fortsetzen** (ergänzt 2026-07-30): `/resume auto on|off` (persistent in `usage.json`).
Beim Start setzt der Assistent selbst fort, wenn eine Session vorliegt UND das Budget frei ist
(sonst nur Hinweis, kein Sofort-Wieder-Stopp). `/resume` ohne Argument = manuelles Fortsetzen
(wie „weiter"). Vorgabe aus (opt-in).

**Zentrale Konstanten** (`src/index.ts`):

```ts
const permissions = { read: true, write: true, exec: false };   // Zeile 56
const API_URL = 'https://api.deepseek.com/v1/chat/completions'; // Zeile 103
settings.model = 'deepseek-v4-pro'                              // Zeile 117
const MAX_ITERATIONS = 40;                                      // Zeile 129
```

---

## 3. Was in dieser Sitzung entstanden ist

Chronologisch, mit Verweis auf die jeweilige Fachdokumentation.

| Bereich | Ergebnis | Dokument |
|---|---|---|
| Agent-Schleife | Existierte vorher gar nicht; `tools` in jedem Request | [architecture.md](./architecture.md) |
| Message-Invariant | Jeder `tool_call` bekommt genau eine Antwort; `repairHistory()` als Netz | [architecture.md](./architecture.md) |
| Modell | `deepseek-v4-pro` mit Thinking, **eine einzige** Konstante | [deepseek-api.md](./deepseek-api.md) |
| Bereiche | Getrennte Lese-/Schreibbereiche, symlink-fest, mit Existenzprüfung | [permissions-and-scopes.md](./permissions-and-scopes.md) |
| Befehle | Ohne Shell (`execFile`), Allowlist, Optionssperren, Pfadprüfung | [security/…bash-commands-security.md](./security/leaven-cli-bash-commands-security.md) |
| Geheimnisse | Sperrliste für `.env`, Schlüssel, Zugangsdaten — auch innerhalb der Bereiche | dito, Abschnitt 5 |
| Umgebung | API-Schlüssel wird nicht mehr an Kindprozesse vererbt (`scrubEnvironment`) | dito, Abschnitt 6 |
| Bedienung | Slash-Befehle, orangener Eingaberahmen, Begrüssung, fester `/help`-Hinweis | [configuration.md](./configuration.md) |
| Projektauswahl | Checkbox-Dialog (`mehrfachAuswahl()`) für die Schreibbereiche | [permissions-and-scopes.md](./permissions-and-scopes.md) |
| Rollen | Gespeicherte Setups mit **Isolation je Rolle** | [roles.md](./roles.md) |
| Netzzugriff | `fetch_url` mit Domain-Allowlist und SSRF-Sperre | [internet.md](./internet.md) |
| Sende-Endpunkt | `post_to_endpoint` an **genau eine** eigene Instanz, keine Weiterleitungen | [leaven-api-endpoint-usage.md](./leaven-api-endpoint-usage.md) |
| Fortschritt | `update_plan` + Fortschrittsbalken über dem Eingaberahmen | [plan.md](./plan.md) |
| Plattform-Anbindung | Spezifikation für Fortschrittsmeldung und Rückkanal — **Entwurf, nicht gebaut** | [leaven-platform-connect/api-docs.md](./leaven-platform-connect/api-docs.md) |
| Startdialog | Fragt **nur** Bereiche ab; Rechte über `/rights` änderbar | [permissions-and-scopes.md](./permissions-and-scopes.md) |
| Iterationsgrenze | 25 → 40, und als **Checkpoint statt Wand** (fragt nach, statt abzubrechen) | [troubleshooting.md](./troubleshooting.md) |

### Vier Festlegungen des Nutzers, die im Code verankert sind

Diese sind nicht verhandelbar und dürfen nicht stillschweigend aufgeweicht werden:

1. **Die Plattform ist die einzige Instanz mit 100 % aller einstellbaren Rechte.**
   Begründung des Nutzers: „wir vertrauen ihr, da sie von uns selbst kommt, genauso wie
   diese cli hier." Umgesetzt als: volle Rechte bei Auftragsbeginn, **keine
   Rechteerweiterung mitten im Lauf**.

2. **Nur eine einzige eigene Webinstanz darf POSTs empfangen.** Das Ziel ist fest
   konfiguriert und vom Modell nicht wählbar.

3. **Weiterleitungen dürfen den Payload niemals woanders hin tragen.** Wörtlich: „das darf
   nicht passieren, auf gar keinen fall." Umgesetzt: Die CLI folgt **keiner** 3xx-Antwort
   und bricht ab. Grund: HTTP 307/308 behalten Methode und Rumpf bei.

4. **Rollen-Isolation.** Nur die Rolle `leaven-cli-engineer` darf `~/.leaven` lesen —
   sie entwickelt die CLI mit. Alle anderen Rollen dürfen **ausschliesslich ihre eigene**
   Onboarding-Datei lesen, nicht die der anderen.

---

## 4. Womit du anfangen solltest

**Lies zuerst [deepseek-api.md](./deepseek-api.md).** Die beiden häufigsten Arten, dieses
Projekt kaputt zu machen, stehen dort:

1. Zwei verschiedene Modelle in einer Konversation → HTTP 400 zu `reasoning_content`
2. Eine Assistant-Nachricht neu zusammenbauen statt das rohe Antwortobjekt weiterzureichen
   → dasselbe

Danach [architecture.md](./architecture.md), Abschnitt „Zwei Invarianten, die nicht verletzt
werden dürfen".

**Fallstrick bei neuen Befehlen:** `/model` und `/thinking` setzen den Gesprächsverlauf
zurück. Das ist zwingend — eine History mit `reasoning_content` wird von einem
Non-Thinking-Modell abgelehnt und umgekehrt. Wer weitere Einstellungen ergänzt, die das
Antwortformat beeinflussen, muss dasselbe tun.

Die vollständige Themenübersicht steht in [README.md](./README.md).

---

## 5. Terminal-Fallen, die Zeit gekostet haben

Diese sind alle gemessen, nicht vermutet. Wer an `mehrfachAuswahl()` oder am
Eingabe-Handling arbeitet, sollte sie kennen — jede einzelne hat eine Fehlersuche gekostet.

| Falle | Was wirklich passiert | Lösung im Code |
|---|---|---|
| `rl.pause()` beendet den Prozess nach 10 ms | Ein offenes Promise hält die Event-Loop **nicht** am Leben | `process.stdin.resume()` |
| `removeAllListeners('keypress')` zerstört readline | Nachgemessen: 1 Listener → 0 | Listener sichern und wiederherstellen |
| Doppeltes Echo nach einem Dialog | `setRawMode(false)` schaltet das Terminal-Echo wieder ein | Ausgangszustand merken (`stdin.isRaw`) und zurücksetzen |
| Titel erscheint mehrfach im Dialog | Ein eingebettetes `\n` sind 2 Bildschirmzeilen, aber 1 Array-Eintrag | Echte Bildschirmzeilen zählen (Zeilenumbruch einrechnen) |
| Mehrzeiliges Einfügen | readline liefert N einzelne Zeilen-Ereignisse | Zusammenfassen zu einem Prompt (nur im Terminal) |

---

## 6. Offene Aufgaben

| Aufgabe | Umfang | Wo beschrieben |
|---|---|---|
| **git kontrolliert auf die Allowlist zurückholen** | gross, eigene Arbeitseinheit | [security-projects/git-security-feature.md](./security-projects/git-security-feature.md) |
| Plattform-Rückkanal implementieren | mittel, Spezifikation liegt vor | [leaven-platform-connect/api-docs.md](./leaven-platform-connect/api-docs.md) |
| `--option=/pfad` aufspalten und den Wert mitprüfen | klein, lohnt sich | critical-issues, Punkt 3 |
| Audit-Protokoll | klein | critical-issues, Punkt 9 |
| Warnzeile beim Start unter `--yes` | sehr klein | critical-issues, Punkt 7 |
| `mode`-Schlüssel aus `config/loopBreaker.json` entfernen oder auswerten | trivial | wird derzeit ignoriert |
| `src/index.ts.backup` löschen | trivial | totes Überbleibsel |

**Der Nutzer hat zu git gesagt:** „da will ich dich später mitnehmen, aber das besprechen
wir später." Also **nicht eigenmächtig anfangen** — erst ansprechen.

**Nicht gemacht und bewusst offen:** Die ursprüngliche Aufgabe des Nutzers (Footer,
Brand-Titel und `.env`-Anpassungen in `~/develop/templates/julalo-ui-components`) wurde nie
ausgeführt. Beachte: Die `.env`-Änderung wird von der Geheimnis-Sperre blockiert; dafür wäre
`--allow-secrets` nötig — das sollte der Nutzer bewusst entscheiden.

---

## 7. Entscheidung zu weiteren Anbietern (Stand dieser Sitzung)

Der Nutzer hat gefragt, ob Claude-Modelle (Opus 4.8, Fable 5) in `/model` aufgenommen werden
könnten. **Ergebnis: vorerst nicht.** Die Begründung ist dokumentiert, damit sie nicht neu
erarbeitet werden muss.

### Warum das ein Adapter wäre, kein Listeneintrag

Die beiden APIs unterscheiden sich in jeder strukturellen Dimension:

| | DeepSeek | Anthropic |
|---|---|---|
| Endpunkt | `/v1/chat/completions` | `/v1/messages` |
| Auth | `Authorization: Bearer` | `x-api-key` + `anthropic-version` |
| Systemprompt | `messages[0]` | eigenes Feld `system` |
| Werkzeug-Schema | `function.parameters` | `input_schema` |
| Werkzeugaufruf | `message.tool_calls[]` | Content-Block `type:'tool_use'` |
| Werkzeugergebnis | `{role:'tool', tool_call_id}` | User-Nachricht mit `tool_result`-Blöcken |
| Denken | `reasoning_content` (String) | `thinking`-Blöcke |

**Übertragbare Erkenntnis:** Anthropic hat dieselbe Invariante wie DeepSeek — Thinking-Inhalte
müssen unverändert zurückgegeben werden. Die hier bereits gelernte Lektion gilt dort genauso.

**Zwei nicht offensichtliche Hürden**, falls das später doch kommt:
- `temperature`, `top_p` und `top_k` werden von Opus 4.8 und Fable 5 mit **HTTP 400**
  abgelehnt. Der bestehende Befehl `/temperature` würde brechen; Steuerung läuft dort über
  `effort` (`low` … `max`).
- Fable 5 setzt 30-Tage-Datenspeicherung voraus und ist bei Zero-Data-Retention gar nicht
  verfügbar — dann scheitert **jede** Anfrage mit 400, unabhängig vom Code.

### Stattdessen: Qwen, später

Der Nutzer will später Qwen aufnehmen. Zwei Punkte dazu:

1. **Technisch der kleinere Umbau.** Die meisten Qwen-Anbieter sprechen ein
   OpenAI-kompatibles Format — also genau die Form, die diese CLI schon spricht
   (`/chat/completions`, `tool_calls[]`, `role:'tool'`). Im günstigsten Fall reichen eine
   andere Basis-URL und ein anderer Schlüssel.

2. **Der Datenschutzvorteil kommt nicht vom Anbieter, sondern von den offenen Gewichten.**
   Alibabas eigene Endpunkte (DashScope) liegen standardmässig ebenfalls in China. Qwen ist
   aber offen verfügbar und damit lokal oder EU-gehostet betreibbar — dann verlassen die
   Daten den Rechtsraum gar nicht. **Die entscheidende Frage ist also nicht „Qwen oder
   nicht", sondern welcher Endpunkt.**

### Datenschutz-Einordnung DeepSeek

DeepSeek verarbeitet auf Servern in der Volksrepublik China; es gibt keinen
EU-Angemessenheitsbeschluss. Eine klare API-Zusage „kein Training auf Eingaben" existiert
nach derzeitigem Kenntnisstand nicht in der Form, wie Anthropic und OpenAI sie geben.

**Der Nutzer hat das bewertet und entschieden:** Die CLI wird ausschliesslich für eigene
Quellcode-Entwicklung ohne Personenbezug eingesetzt. Damit ist die DSGVO-Frage für ihn
erledigt. Diese Entscheidung nicht ungefragt neu aufrollen — aber im Hinterkopf behalten,
falls jemals fremde Kundenprojekte in den Lesebereich geraten (Geschäftsgeheimnis ist eine
andere Kategorie als Personenbezug).

---

## 8. Sicherheit — was gilt und was nicht

Die vollständige Referenz steht in zwei Dokumenten, die **zusammengehören**:

- [security/…bash-commands-security.md](./security/leaven-cli-bash-commands-security.md)
  — Bedrohungen und was dagegen unternommen wird
- [security/…critical-issues.md](./security/leaven-cli-critical-issues.md)
  — was **nicht** geschützt ist, je mit „was wäre nötig"

**Wer nur das erste liest, bekommt ein zu gutes Gefühl.**

Die gewichtigsten offenen Risiken, jeweils mit Gegenmassnahmen in critical-issues:

1. **Alles Gelesene geht an DeepSeek.** Nicht technisch lösbar, solange eine Cloud-API
   benutzt wird — nur durch einen engen Lesebereich zu mildern. (Punkt 1)
2. **Prompt-Injection** über gelesene Dateien und abgerufene Webseiten. Kein verlässlicher
   Schutz bekannt; Bereichsgrenzen und Rückfragen sind die eigentliche Verteidigungslinie.
   (Punkt 8)
3. **GET als Exfiltrationskanal** — `fetch_url` kann Daten in der URL nach aussen tragen.
   (Punkt 8c)
4. **DNS-Rebinding** — die SSRF-Prüfung greift beim Auflösen, nicht beim Verbinden. (Punkt 8d)
5. **Geheimnisse jenseits der Muster** — Passwörter im Quelltext, `dump.sql`,
   `config/database.php`. Die Sperrliste kennt Dateinamen, keine Inhalte. (Punkt 2)

---

## 9. Arbeitsweise, die sich bewährt hat

Der Nutzer legt Wert auf **belegte statt behauptete** Aussagen. Was sich als sinnvoll
erwiesen hat:

- **Vermutungen messen, bevor man sie als Ursache benennt.** Mehrere Diagnosen in diesem
  Projekt waren erst nach einem gezielten Experiment richtig: `rl.pause()` beendet den
  Prozess nach 10 ms; `\n` erzeugt `key.name === 'enter'`, nicht `return`; der API-Key war
  tatsächlich im Kindprozess sichtbar; `.leaven` war tatsächlich lesbar.
- **Eigene Fehler benennen, statt sie zu überspielen.** In dieser Sitzung sind zwei
  Regressionen erst beim Nachtesten aufgefallen und wurden zurückgenommen — darunter eine,
  bei der `rm -rf datei.txt` Erfolg meldete, ohne etwas zu tun.
- **Auch die eigene Testmethodik prüfen.** Zwei Tests waren zunächst wertlos: einer verglich
  die falsche Ausgabe, bei einem anderen verweigerte das Modell von sich aus, sodass gar
  nichts geprüft wurde.
- **Bei Sicherheitsfragen ehrlich zwischen „behoben" und „gemildert" unterscheiden.** Der
  Nutzer hat mehrfach die sicherere Option gewählt, wenn man ihm die Abwägung offenlegte.
- **Vor Änderungen an sicherheitsrelevantem Code die Tests erweitern, nicht danach.**
- **Nachfragen, bevor man den Umfang ausweitet.** Der Nutzer korrigiert klar und begründet;
  wenn er eine Einschränkung nennt, hat sie einen Grund.

### Zwei wiederkehrende Fallen in der Kommunikation

**Führender Schrägstrich.** Der Nutzer schreibt Pfade wie `/docs/security/…` und meint damit
„vom Projekt aus", nicht die Systemwurzel. Das hat einmal zu einer kaputten
Sitzungskonfiguration geführt. Im Zweifel projektrelativ interpretieren und es dazusagen.

**Tippfehler in Dateinamen** (`sourgough`, `sourdouch`). Korrigiert übernehmen und darauf
hinweisen.

---

## 10. Stolperfalle beim Testen

Die Datei `.env` im Projekt enthält **nur einen Platzhalter**. Der echte API-Schlüssel liegt
in der Shell-Umgebung. dotenv überschreibt vorhandene Variablen nicht, deshalb funktioniert
die CLI trotzdem.

Wer beim Testen `. ./.env` sourct, überschreibt den echten Schlüssel mit dem Platzhalter und
bekommt „Authentication Fails" — das sieht wie ein ungültiger Schlüssel aus, ist aber nur die
`.env`. Direkt `$DEEPSEEK_API_KEY` verwenden.

---

## 11. Sofort einsatzbereit

```bash
cd ~/develop/platforms/leaven/leaven
npm test                      # 119 Prüfungen, kostenlos, kein API-Zugriff
npm run build && node dist/index.js
```

Nicht-interaktiver Testlauf:

```bash
printf 'Aufgabe\nexit\n' | node dist/index.js --yes --verbose \
  --read-root ~/develop/platforms/leaven/leaven \
  --write-root ~/develop/platforms/leaven/leaven/sandbox
```

Vollständige Prüfliste in [testing.md](./testing.md).
