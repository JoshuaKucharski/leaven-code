# leavencode – Sicherheit und Datenschutz im Vergleich zu Claude Code

**Stand:** 2026-11-02 · Belegt am Code in `src/` und `config/`. Aussagen über Claude Code beziehen sich auf dessen öffentlich dokumentiertes Verhalten nach meinem Kenntnisstand; wer sie für eine Entscheidung braucht, prüft sie gegen die aktuelle Claude-Code-Dokumentation.

Die Leitfrage dieses Dokuments: **Was macht leavencode sicherer und datenschutzfreundlicher als die Arbeit mit Claude Code – insbesondere durch Einstellungen und Konstruktionsentscheidungen, die Claude Code zu Beginn nicht anbietet?** Und ebenso ehrlich: Wo ist das nicht der Fall.

---

## 1. Das Vertrauensmodell in drei Sätzen

1. **Die Verbindung geht nur hinaus.** Beide Werkzeuge sind HTTP-Clients ohne eingehenden Kanal; kein Anbieter kann von sich aus auf den Rechner zugreifen, und ohne laufende Sitzung passiert nichts. Für leavencode ist das am Code belegt (`docs/security/environmental-facts.md`): kein `createServer`, kein `listen`.
2. **Das Modell hat keine Hände.** Es schickt Werkzeug-Bitten als JSON; ausgeführt wird lokal, nach lokalen Regeln.
3. **Der Unterschied liegt beim Türsteher.** Bei Claude Code ist der lokale Code, der die Bitten prüft, Anthropics Programm – ein großes npm-Paket, das man installiert und dem man vertraut wie jeder fremden Software. Bei leavencode ist der Türsteher **eigener Code**: rund 5 000 Zeilen TypeScript, fünf Abhängigkeiten, 326 Tests, in einer Stunde lesbar. Das ist der Kern des Sicherheitsarguments – nicht, dass die Regeln klüger wären, sondern dass man sie **besitzt und prüfen kann**.

---

## 2. Ab Werk: der erste Start im Vergleich

| Aspekt | leavencode (Vorgabe) | Claude Code (Vorgabe) |
|---|---|---|
| Wo darf gelesen werden? | genau **ein** Lesebereich, beim Start abgefragt; außerhalb davon ist jeder Zugriff abgelehnt | Arbeitsverzeichnis; Zugriffe außerhalb werden erfragt bzw. per Regeln gesteuert |
| Wo darf geschrieben werden? | nur in angekreuzte Projekte (mehrere möglich), getrennt vom Lesebereich | Arbeitsverzeichnis, Edits mit Rückfrage (Vorgabemodus) |
| `.env`, Schlüssel, `.ssh`, `.aws` | **gesperrt, auch innerhalb erlaubter Bereiche**, auch für `read_file`; aufhebbar nur per `--allow-secrets` beim Start | kein Schutz ab Werk; `Read(./.env)`-Deny-Regeln müssen selbst gesetzt werden |
| Shell | **keine Shell.** Ein Programm je Aufruf, Metazeichen (`; && \| > $( )`) werden abgelehnt; nur zehn lesende Programme laufen ohne Rückfrage, alles andere fragt | echte Shell (`Bash`-Werkzeug) mit Rückfrage; Freigaberegeln arbeiten per Musterabgleich auf dem Befehlstext |
| Umgebung der Kindprozesse | **bereinigt**: `*_KEY`, `*_TOKEN`, `*_SECRET`, `AWS_*` usw. werden nicht vererbt | vollständige Umgebung wird vererbt |
| Netz | **aus.** Kein Web-Werkzeug, bis eine Domain freigegeben ist; Senden nur an eine feste Adresse | `WebFetch`/`WebSearch` vorhanden; `curl` über die Shell möglich, sobald Bash freigegeben ist |
| Datenziel | wählbar: DeepSeek, Anthropic, Qwen – und damit der Rechtsraum | Anthropic (bzw. Bedrock/Vertex im Unternehmen) |
| Schleifen / Kosten | Loop-Breaker und Tool-Call-Backstop immer aktiv; Tagesbudget je Anbieter mit Auto-Stopp zuschaltbar | keine Schleifenerkennung; Kosten-Deckel nur im nicht-interaktiven `-p`-Modus (laut Loop-Breaker-Plugin, das genau diese Lücke füllt) |
| Freigabe-Allowlist | liegt in `~/.leaven/`, **für den Agenten unlesbar und unschreibbar**; nur der Mensch pflegt sie | `settings.json` im Projekt bzw. Home; „immer erlauben" im Dialog |
| Code des Türstehers | eigen, offen, getestet | Anthropic, gebündelt |

Die Tabelle zeigt das Muster: Claude Code bietet die meisten Schutzmechanismen **als Option** (Deny-Regeln, Hooks, Sandbox-Einstellung, Berechtigungsmodi), leavencode bietet sie **als Konstruktion oder als Vorgabe**. Der Unterschied ist nicht akademisch: Was man einschalten muss, wird vergessen; was gar nicht möglich ist, kann nicht vergessen werden.

---

## 3. Die Schutzschichten im Einzelnen

Jede Schicht mit Fundstelle, dem Gegenstück in Claude Code und einer Einordnung.

### 3.1 Keine Shell (`guards/commandGuard.ts`, `execFile` in `index.ts`)

Bis zum 2026-07-21 lief `execute_command` über eine Shell; gemessen wurde, dass `grep localhost /etc/hosts ; echo ZWEITER` den zweiten Befehl ausführte. Seitdem gehen Programm und Argumente getrennt an `execFile`, und `checkCommand()` lehnt jeden Befehl mit Metazeichen ab. Die gesamte Angriffsklasse „Shell-Injektion durch ein Modell, das sich verheddert oder manipuliert wurde" existiert nicht mehr. Preis: keine Pipes, keine Umleitungen, keine Verkettung.

*Claude Code:* Die Shell ist Kernfunktion. Freigaberegeln wie `Bash(npm run *)` prüfen den Befehlstext; ein Shell-String lässt sich per Musterabgleich nicht sicher einsperren (dieselbe Einsicht, die leavencode zum Verzicht auf die Shell geführt hat). Abhilfe dort: die Sandbox-Einstellung für Bash, Hooks, enge Allow-Listen.

*Einordnung:* struktureller Vorteil von leavencode.

### 3.2 Getrennte Lese- und Schreibbereiche, symlink-fest (`securePath`, `util/pfade.ts`)

Ein Lesebereich, mehrere Schreibbereiche; relative Pfade zählen immer ab dem Lesebereich; `realpathSoFar()` löst Symlinks so weit auf, wie der Pfad existiert (ein Link im erlaubten Bereich auf `/tmp` wird abgelehnt – verifiziert); Argumente nicht gelisteter Programme werden gegen den **Schreib**bereich geprüft, damit `rm -rf src/` nicht durchgeht, nur weil `src/` lesbar ist. Auch Pfade in Optionswerten (`grep --file=/pfad`, `-f/pfad`) laufen durch die Prüfung; gesperrte Optionen werden auch gebündelt (`-rS`) und abgekürzt (`--deref`) erkannt.

*Claude Code:* Arbeitsverzeichnis plus `additionalDirectories`; `Read(../)`/`Edit(../)`-Deny-Regeln (so schreibt sie die Leaven-Plattform in `.claude/settings.local.json`). Eine Trennung „breit lesen, eng schreiben" muss man aus Regeln zusammensetzen.

*Einordnung:* Vorteil leavencode in Klarheit und Vorgabe; mit Regeln in Claude Code annähernd erreichbar.

### 3.3 Geheimnis-Sperre auch innerhalb erlaubter Bereiche (`isSecretPath`, `config/commands.json`)

`.env`, `.env.*`, `*.pem`, `*.key`, `id_rsa*`, `.npmrc`, `.netrc`, `.pgpass`, `*.p12`, `*.pfx`, `*.keystore`, `*credentials*`, `*.kdbx` und die Verzeichnisse `.ssh`, `.aws`, `.gnupg`, `.config/gcloud`, `.leaven` sind für **alle** Zugriffe gesperrt – Datei-Werkzeuge, `copy_file`-Quelle, Befehlsargumente. Begründung: Eine `.env` im eigenen Projekt wäre sonst regelkonform lesbar, und ihr Inhalt ginge an die Modell-API. Aufhebbar nur bewusst per `--allow-secrets`, sichtbar in `/status`.

*Claude Code:* keine solche Vorgabe; Deny-Regeln möglich.

*Einordnung:* Vorteil leavencode (Vorgabe statt Option). Grenze: Die Sperre kennt Dateinamen, keine Inhalte – ein Passwort in `config/database.php` erkennt sie nicht.

### 3.4 Umgebungsbereinigung (`scrubEnvironment`)

Nachgewiesen vor dem Einbau: Ein Kindprozess konnte `DEEPSEEK_API_KEY` ausgeben. Seitdem erbt kein Kindprozess Schlüssel, Tokens, Passwörter, `AWS_*`, `GITHUB_TOKEN`, `OPENAI_*`. Dasselbe schützt den Board-Token der Plattform: Die CLI meldet selbst, der Agent sieht den Token nie.

*Claude Code:* Kindprozesse erben die Umgebung.

*Einordnung:* struktureller Vorteil leavencode.

### 3.5 Netz nur konstruktiv begrenzt (`guards/urlGuard.ts`, `fetch_url`, `post_to_endpoint`)

- Lesen: nur GET, nur freigegebene Domains (Subdomains ja, Suffix-Tricks wie `example.com.boese.tld` nein), nur `http`/`https`, interne Adressen inklusive Cloud-Metadaten `169.254.169.254` gesperrt, jede Weiterleitung einzeln geprüft, 100 KB, 20 s.
- Senden: **genau eine** konfigurierte Adresse, vom Modell nicht wählbar; https-Pflicht; Prüfung bei jedem Senden; **keine Weiterleitungen** (307/308 würden den Payload an einen anderen Server tragen); jedes Senden braucht eine Freigabe, auch wenn Lesen und Schreiben frei sind.
- Werkzeuge, die nicht nutzbar sind, werden dem Modell gar nicht angeboten.

*Claude Code:* `WebFetch` fragt je Domain; über die Shell ist `curl -d @datei` möglich, sobald Bash freigegeben ist.

*Einordnung:* Vorteil leavencode. Restkanal: ein GET trägt Daten in der URL hinaus (begrenzt durch URL-Länge und Allowlist); DNS-Rebinding ist nicht abgedeckt.

### 3.6 Allowlist statt Blocklist, Interpreter nie pauschal frei

Nur zehn lesende Programme laufen ohne Rückfrage, je mit gesperrten Optionen (`find -exec`, `grep -S`, `rg --pre` …). `git`, `php`, `node`, `python`, `npm`, `bash` fragen immer – weil ihre Gefahr im ausgeführten Code steckt, nicht in den Argumenten. Zwei enge Ausnahmen: exakt vermerkte Befehle der Registry und der ausführungsfreie Lint `php -l <datei>` (einziges Flag `-l`, kein `-r`, `-f`, `-d`).

*Claude Code:* Allow-Regeln je Befehlspräfix; „immer erlauben" im Dialog schreibt in `settings.json`.

*Einordnung:* vergleichbar im Prinzip; leavencode ist strenger in der Vorgabe und prüft Pfadargumente mit.

### 3.7 Die AI-dichte Zone `~/.leaven` und der Vorschlags-Kreislauf

Registry (`allowed-commands.json`), freigegebene Skripte, Rollen, Session- und Budgetdateien liegen in `~/.leaven`, das auf der Geheimnis-Sperrliste steht: Der Agent kann dort weder lesen noch schreiben. Er kann Befehle und Skripte nur **vorschlagen** (`propose_command` → Eingang `requested-commands/`); freigeben kann nur ein Mensch. Ein in der Registry eingetragenes Shell-Skript zählt nur, wenn es **in** `~/.leaven` liegt – ein Skript im Projekt könnte der Agent umschreiben.

*Claude Code:* Die Freigaben stehen in `.claude/settings.json` im Projekt oder in `~/.claude/settings.json` – Dateien, die der Agent mit seinen Datei-Werkzeugen grundsätzlich erreichen kann, sofern man sie nicht per Regel schützt.

*Einordnung:* struktureller Vorteil leavencode: Die Freigabe-Quelle liegt außerhalb jeder Grenze, die der Agent erreichen kann.

### 3.8 Rollen-Isolation

Jede Rolle darf nur ihr eigenes Onboarding lesen; die Konfiguration anderer Rollen bleibt gesperrt. `rollenzugriff` ist bewusst eine einzelne Eigenschaft und keine allgemeine „zusätzliche Lesepfade"-Liste, damit daraus nie ein Weg wird, `.ssh` freizuschalten.

*Claude Code:* Profile dieser Art gibt es nicht; vergleichbar wären getrennte Projekt-Settings.

### 3.9 Lieferkette

Fünf Laufzeit-Pakete, kein LLM-SDK, 74 Pakete insgesamt. Jede der drei APIs wird als rohes HTTPS gesprochen und ist im Quelltext vollständig nachlesbar.

*Claude Code:* ein großes, gebündeltes Paket mit eigener Update-Mechanik.

*Einordnung:* Vorteil leavencode in Überschaubarkeit; Nachteil: niemand außer dem Besitzer pflegt es.

### 3.10 Entgleisungsschutz und Kosten

Loop-Breaker (identische Aufrufe, Retry-Stürme, Zyklen), Tool-Call-Backstop, Tages-Token-Budget je Anbieter mit Auto-Stopp und sauberer Fortsetzung am nächsten Tag. Alles in der interaktiven Sitzung, nicht nur headless.

*Claude Code:* keine Schleifenerkennung (deshalb existiert das Loop-Breaker-Plugin im Ordner `loop-breaker/`); Dollar-Deckel nur im `-p`-Modus.

*Einordnung:* Vorteil leavencode.

### 3.11 Freigabe-Dialog mit Begründung

Jeder nicht automatische Aufruf erscheint mit Argumenten **und** dem Grund („npm steht nicht auf der Allowlist", „Programm mit Pfadangabe"). Abgelehnte und blockierte Aktionen bleiben auch im stillen Modus sichtbar; der Abschlussbericht listet jede Aktion.

*Claude Code:* vergleichbarer Dialog.

*Einordnung:* gleichwertig; der Schutz ist in beiden Fällen nur so gut wie die Aufmerksamkeit des Menschen.

### 3.12 Rechte nur vor dem Auftrag, nie währenddessen

Festlegung des Projekts: Rechte kommen aus dem Start (Dialog, Flags, Rolle, Launcher-Profil); während eines Laufs gibt es keinen Weg, sie zu erweitern. Das schließt die Kette „Seite abrufen → injizierte Anweisung → Agent fordert Shell-Rechte an → gewährt" aus. `/rights` ist ein bewusster Nutzerakt zwischen Aufträgen, keine Modell-Aktion.

---

## 4. Die Einstellungen, die den Unterschied machen

Das sind die Stellschrauben, mit denen leavencode spürbar enger wird als eine Standard-Claude-Code-Sitzung – und die man bewusst setzen sollte:

| Einstellung | Wie | Wirkung |
|---|---|---|
| Enger Lesebereich | Startdialog oder `--read-root <projekt>` | Was nicht gelesen werden kann, kann nicht an den Anbieter gehen und nicht in eine URL geschrieben werden |
| Nur die Projekte ankreuzen, an denen gearbeitet wird | Checkbox statt „ALLE Verzeichnisse" | Schreibschaden bleibt auf diese Projekte begrenzt – auch für `rm`, `npm`, `git` |
| Shell mit Rückfrage lassen | Vorgabe; nicht per `/rights` lockern | Jeder nicht lesende Befehl ist ein sichtbarer Entscheidungspunkt |
| Netz aus, pro Aufgabe ein | `/internet add <domain>` … `/internet clear` | Prompt-Injection über Webseiten nur im bewussten Zeitfenster, nur von redaktionellen Domains |
| Bei Netzzugriff Schreiben auf Rückfrage | `/rights` | Die Freigabe wird zum Punkt, an dem eine injizierte Absicht auffällt |
| Registry statt Shell-Freigabe | `propose_command` → Mensch trägt in `~/.leaven/allowed-commands.json` ein | Wiederkehrende Befehle ohne Rückfrage, ohne `php`/`npm` pauschal freizugeben |
| `--allow-secrets` nie, `--yes` nie interaktiv | Alltag | Die beiden Flags heben die wirksamsten Schichten auf |
| Tagesbudget + Auto-Stopp | `/budget <anbieter> <n>`, `/budget auto on` | Kein Weiterlaufen über Nacht; sauberer Stopp mit Fortsetzung |
| Backstop passend setzen | `/backstop 500` | Obergrenze für Tool-Calls je Sitzung |
| Rollen für wiederkehrende Setups | `/role new <name>` | Dieselben engen Bereiche jedes Mal, ohne Tippfehler |
| Provider nach Rechtsraum wählen | `/model opus` statt DeepSeek für Sensibleres | USA mit Angemessenheitsrahmen statt China (Abschnitt 5) |
| Anzeige „Schritte an" lassen | `/output steps on` | Man sieht, welche Datei warum angefasst wird |

Claude Code kennt für mehrere dieser Punkte Entsprechungen (Deny-Regeln, Hooks, Sandbox, Berechtigungsmodi, Plan-Modus) – aber als Konfiguration, die man kennen und pflegen muss, und ohne die strukturellen Punkte 3.1, 3.4, 3.5 und 3.7.

---

## 5. Datenschutz: wohin fließt was

### Datenflüsse

| Ziel | Was | Wann |
|---|---|---|
| Modell-Anbieter | **alles, was gelesen wird**: Dateiinhalte, Befehlsausgaben, abgerufene Seiten, die eigene Eingabe, der Systemprompt samt Bereichen und Onboarding-Text | bei jedem Aufruf, Funktionsweise |
| Leaven-Plattform (Board) | Feature-Slugs, Statuswerte, Fortschrittsnotizen („Schritt 2/5: …") | nur mit gesetzten `LEAVEN_BUCKET_*`-Variablen |
| `post_to_endpoint`-Ziel | das vom Modell gebaute Payload | nur mit Freigabe |
| freigegebene Domains | die URL (inklusive Query) | bei `fetch_url` |
| sonst nirgendwohin | keine Telemetrie, keine Update-Prüfung, kein Login, kein Konto – nur API-Schlüssel | – |

### Rechtsraum je Provider

| Provider | Datenverarbeitung | EU-Angemessenheit | Training auf Eingaben |
|---|---|---|---|
| DeepSeek (Standard) | China | nein | keine klare API-Zusage bekannt |
| Anthropic (Opus, Fable) | USA | ja (Data Privacy Framework) | klare Nein-Zusage für die API |
| Qwen über DashScope-intl | China (dieser Endpunkt) | nein | – |

Der Standard-Provider ist damit datenschutzrechtlich der **schwächste** – eine bewusste Entscheidung des Nutzers für eigenen Quellcode ohne Personenbezug. Sobald fremde Kundenprojekte oder personenbezogene Daten in einen Lesebereich geraten, ist `/model opus` (oder künftig ein lokales Modell) die richtige Wahl. Gegenüber Claude Code ist hier nicht der Anbieter der Vorteil, sondern die **Wahlfreiheit** je Aufgabe.

### Was lokal bleibt und was nie das Modell erreicht

- `~/.leaven/session.json` enthält die komplette Konversation einschließlich gelesener Dateiinhalte – im Klartext, für den Agenten gesperrt, jederzeit löschbar. Wurde mit `--allow-secrets` gearbeitet, kann Sensibles darin stehen.
- `~/.leaven/usage.json`, `scopes.json`, `roles.json` – Klartext, unkritisch.
- Der Board-Token, die Prompt-Datei `.leaven/INITIAL_PROMPT.md` (im gesperrten `.leaven`-Ordner) und alles unter `~/.leaven` erreichen die Werkzeuge des Modells nicht; die CLI liest sie selbst.

### Vergleich zu Claude Code

Claude Code sendet ebenfalls alles Gelesene an seinen Anbieter; hinzu kommen Konto, Anmeldung und – je nach Konfiguration – Nutzungsdaten der Anwendung selbst. leavencode hat keine Identität außer dem API-Schlüssel. Der datenschutzrelevante Unterschied ist also: **weniger Kanäle, frei wählbares Datenziel, enger kontrollierbarer Lesebereich** – nicht ein grundsätzlich anderes Prinzip.

---

## 6. Was leavencode NICHT sicherer macht

Ehrlichkeit gehört zur Sicherheitsdoku dieses Projekts („wer nur das Schutz-Dokument liest, bekommt ein zu gutes Gefühl"). Die offenen Punkte, nach Gewicht:

| Risiko | Stand | Wo Claude Code besser oder gleich ist |
|---|---|---|
| **Alles Gelesene geht an einen Cloud-Anbieter** | prinzipbedingt; nur durch engen Lesebereich oder ein lokales Modell (nicht gebaut) zu mildern | gleich |
| **Prompt-Injection** über gelesene Dateien und Webseiten | ungelöst; Verteidigung sind Bereichsgrenzen und Rückfragen | gleich; beide ohne verlässlichen Schutz |
| **Keine OS-Sandbox** | Kindprozesse laufen mit den Rechten des Nutzers; keine Mount-Namespaces, kein Seatbelt, keine Ressourcengrenzen | Claude Code bietet eine Sandbox-Einstellung für Bash; hier ist Claude Code **stärker** |
| **`-y` im Launcher-Betrieb** | Die Plattform startet mit `-y`: alle Werkzeuge ohne Rückfrage, Shell frei, Bereiche = Arbeitsverzeichnis. Bewusst so entschieden („die Plattform ist die einzige Instanz mit 100 % Rechten"), aber der riskanteste Betriebsmodus | ein Headless-Modus, der nur das Profil erlaubt und sonst ablehnt, ist spezifiziert, nicht gebaut |
| Symlinks während der Rekursion eines Kindprozesses | verlässt sich auf Programm-Vorgaben; die erzwingenden Optionen (`grep -S`/`-R`, `find -L`, `rg --follow`) sind gesperrt, auch gebündelt oder abgekürzt | Sandbox hilft dort |
| DNS-Rebinding bei `fetch_url` | Prüfung sieht den Hostnamen, nicht die IP | – |
| Geheimnisse jenseits der Dateinamen-Muster | Inhalte werden nicht geprüft | gleich |
| Kein Audit-Protokoll | nach dem Schließen des Terminals ist nichts mehr nachvollziehbar | Claude Code führt Sitzungsprotokolle |
| Lokale Klartext-Dateien (`session.json`) | nicht verschlüsselt | – |
| Dialog-Ermüdung | der Freigabe-Dialog schützt nur, solange er gelesen wird | gleich |
| Pflege | ein Besitzer, keine Sicherheitsupdates von außen | Claude Code wird vom Hersteller gepflegt |

Kombinationen, die sich gegenseitig verschärfen: Netzzugriff + `--allow-secrets` (lesbare Geheimnisse plus Kanal nach draußen), Netzzugriff + Schreiben ohne Rückfrage (Injektion wirkt ohne Zwischenstopp), Netzzugriff + Shell ohne Rückfrage, breiter Lesebereich + Netzzugriff.

---

## 7. Empfehlung je Situation

| Situation | Lesebereich | Schreibbereiche | Shell | Netz | Modell |
|---|---|---|---|---|---|
| eigenes Projekt, vertrauter Code | Projekt | Projekt | mit Rückfrage | aus | frei |
| mehrere eigene Projekte | Elternverzeichnis | genau die Projekte ankreuzen | mit Rückfrage | aus | frei |
| Recherche in Dokumentation | Projekt | Projekt | mit Rückfrage | nur redaktionelle Domains, danach `clear` | frei |
| fremder Code unbekannter Herkunft | Projekt | Projekt | mit Rückfrage, `--allow-secrets` nie | aus | frei |
| Kundenprojekt, echte Daten | Cloud-API überdenken | | | aus | Anthropic oder lokal |
| unbeaufsichtigter Launcher-Lauf | Arbeitsverzeichnis des Profils | dito | **frei (`-y`)** – nur für vertraute Profile | aus | Profil |

Vor jeder Sitzung eine Sekunde: *Was liegt in meinem Lesebereich, das ich nicht an den Anbieter senden möchte?*

---

## 8. Prüfbarkeit

Wer das Sicherheitsversprechen selbst nachprüfen will, braucht etwa eine Stunde:

1. `src/guards/commandGuard.ts` (425 Zeilen) – Metazeichen, Allowlist, Flag-Abgleich, Optionswerte, Verdicts, Geheimnisse, Umgebung.
2. `securePath()` in `src/index.ts` – Bereiche, Symlinks, Geheimnis-Sperre.
3. `src/guards/urlGuard.ts` (96 Zeilen) – Netz.
4. `isAutoApproved()` in `src/index.ts` – wer ohne Rückfrage läuft.
5. `config/commands.json` – die Listen, mit Begründungen im Klartext.
6. `npm test` plus die vier Provider-Suiten – 326 Prüfungen, darunter 10 Injektionsversuche, Flag-Bündel und -Abkürzungen, Suffix-Tricks bei Domains, SSRF-Adressen, Registry-Umgehungen.

Genau das ist der Punkt, an dem leavencode anders ist als Claude Code: Das Tor ist kein Vertrauensvorschuss, sondern Lektüre.

---

## 9. Verwandte Dokumente

`docs/security/environmental-facts.md` (kann der Anbieter hereingreifen? nein, mit Beleg) · `docs/security/environmental-facts-extended.md` (dasselbe für Claude, als Anbieter und als Claude Code) · `docs/security/leaven-cli-bash-commands-security.md` (Befehlssicherheit) · `docs/security/leaven-cli-critical-issues.md` (Restrisiken mit „was wäre nötig") · `docs/security/command-registration.md` (Vorschlag → Prüfung → Freigabe) · `docs/leaven-cli/privacy-relevant-issues.md` (Datenschutz-Kurzfassung).
