# Projektübergabe leaven-cli

**Erstellt:** 2026-07-21, 11:16
**Erstellt von:** Claude Opus 4.8
**Für:** den nächsten KI-Assistenten, der an diesem Projekt weiterarbeitet

---

## 1. Was das Projekt ist

`leaven-cli` ist ein CLI-Agent für die DeepSeek-API. Der Nutzer stellt eine Aufgabe,
das Modell fordert Werkzeuge an (Dateien lesen, ändern, Befehle ausführen), die CLI führt
sie aus und gibt die Ergebnisse zurück — bis die Aufgabe erledigt ist.

Der Nutzer hat das Projekt ursprünglich mit DeepSeek selbst gebaut. Die erklärte
Zielsetzung war: **eine Datei ändern können, ohne dass die CLI abbricht oder ins Leere
läuft.** Dieses Ziel ist erreicht und gegen die echte API verifiziert.

Sprache im Projekt: **Deutsch** — Kommentare, Fehlermeldungen, Dokumentation, Systemprompt.
Bitte beibehalten.

## 2. Aktueller Zustand

**Funktionsfähig und getestet.** `npm run typecheck` und `npm run build` sind sauber,
`npm test` liefert 85 bestandene Prüfungen (72 Guard, 13 Logik) ohne API-Zugriff.

Kein git-Repository — es gibt keine Versionsgeschichte. `src/index.ts.backup` ist ein
Überbleibsel eines frühen Stands und wird nicht gebaut.

### Was in den bisherigen Runden gemacht wurde

| Bereich | Ergebnis |
|---|---|
| Agent-Schleife | Existiert jetzt überhaupt erst; `tools` in jedem Request, Iterations-Cap 25 |
| Message-Invariant | Jeder `tool_call` bekommt eine Antwort; `repairHistory()` als Netz |
| Modell | `deepseek-v4-pro` mit Thinking, eine einzige `MODEL`-Konstante |
| Loop-Breaker | Weicher Block statt Abbruch; Fehlalarme behoben |
| Bereiche | Getrennte Lese-/Schreibbereiche, symlink-fest, mit Existenzprüfung |
| Befehle | Ohne Shell (`execFile`), Allowlist, Optionssperren, Pfadprüfung |
| Geheimnisse | Sperrliste für `.env`, Schlüssel, Zugangsdaten — auch innerhalb der Bereiche |
| Umgebung | API-Schlüssel wird nicht mehr an Kindprozesse vererbt |
| Ausgabe | Stiller Modus mit Abschlussbericht |
| Bedienung | Slash-Befehle (`/help`, `/rights`, `/model`, `/thinking`, `/effort`, `/temperature`, `/key`, `/status`, `/clear`, `/exit`) |
| Eingabe | Mehrzeiliges Einfügen wird zu einem Prompt zusammengefasst (nur im Terminal) |
| Start | Fragt **nur** Lesebereich und Schreibprojekte ab. Rechte-Vorgaben: Lesen/Schreiben ohne Rückfrage, Shell mit Rückfrage — änderbar über `/rights` |

**Sprachregelung:** Befehlsnamen englisch (international auffindbar), sämtliche Ausgaben,
Kommentare und Dokumentation deutsch. Bitte beibehalten.

**Fallstrick bei neuen Befehlen:** `/model` und `/thinking` setzen den Gesprächsverlauf
zurück. Das ist zwingend — eine History mit `reasoning_content` wird von einem
Non-Thinking-Modell abgelehnt und umgekehrt. Wer weitere Einstellungen ergänzt, die das
Antwortformat beeinflussen, muss dasselbe tun.

## 3. Womit du anfangen solltest

**Lies zuerst [deepseek-api.md](./deepseek-api.md).** Die beiden häufigsten Arten, dieses
Projekt kaputt zu machen, stehen dort:

1. Zwei verschiedene Modelle in einer Konversation → HTTP 400 zu `reasoning_content`
2. Eine Assistant-Nachricht neu zusammenbauen statt das rohe Antwortobjekt weiterzureichen
   → dasselbe

Danach [architecture.md](./architecture.md), Abschnitt „Zwei Invarianten, die nicht
verletzt werden dürfen".

## 4. Themenübersicht — wo steht was

### Funktionsweise

| Thema | Dokument |
|---|---|
| Agent-Schleife, Modulaufbau, Invarianten | [architecture.md](./architecture.md) |
| Eingabeverarbeitung, Freigabe-Dialog, Ausgabemodi | [architecture.md](./architecture.md) |
| Die fünf Werkzeuge, `edit_file` vs `write_file` | [tools.md](./tools.md) |
| **Pfadsemantik** (relative Pfade zählen ab dem Lesebereich) | [tools.md](./tools.md) |
| `securePath()`, Symlink-Auflösung | [tools.md](./tools.md) |
| Lese-/Schreibbereiche, Startdialog, Verzeichniswahl | [permissions-and-scopes.md](./permissions-and-scopes.md) |
| Wer läuft ohne Rückfrage, stiller Modus | [permissions-and-scopes.md](./permissions-and-scopes.md) |
| Modellnamen, Thinking-Modus, `reasoning_content` | [deepseek-api.md](./deepseek-api.md) |
| Flags, Umgebungsvariablen, `config/*.json`, Build | [configuration.md](./configuration.md) |
| Tests, manuelle Prüfliste, Testumgebung | [testing.md](./testing.md) |
| Bekannte Fehlerbilder mit Ursache und Schutz | [troubleshooting.md](./troubleshooting.md) |

### Sicherheit — vollständige Referenz

| Thema | Dokument | Abschnitt |
|---|---|---|
| Shell-Injektion, warum Textprüfung nicht trägt | [security/…-bash-commands-security.md](./security/leaven-cli-bash-commands-security.md) | 1 |
| Allowlist statt Blocklist | dito | 2 |
| Verbotene Optionen je Programm | dito | 3 |
| Pfad-Argumente, Lese- vs Schreibmassstab | dito | 4 |
| Geheimnis-Sperrliste | dito | 5 |
| Umgebung des Kindprozesses | dito | 6 |
| Lese-/Schreibbereiche, Symlinks | dito | 7 |
| Freigabestufen | dito | 8 |
| Loop-Breaker als Schadensbegrenzung | dito | 9 |
| Testabdeckung | dito | 10 |
| **Warum `git` nicht auf der Allowlist steht** | dito | Abschnitt in 2 |
| Drittanbieter-Offenlegung (alles Gelesene geht an DeepSeek) | [security/…-critical-issues.md](./security/leaven-cli-critical-issues.md) | 1 |
| Geheimnisse jenseits der Sperrliste | dito | 2 |
| Pfade als Optionswerte ungeprüft | dito | 3 |
| Symlinks bei Kindprozess-Rekursion | dito | 4 |
| Programme mit Konfigurations-Ausführungspfad | dito | 4b |
| TOCTOU | dito | 5 |
| Grenzen des Freigabe-Dialogs | dito | 6 |
| `--yes` und `--allow-secrets` | dito | 7 |
| Prompt-Injection über gelesene Dateien | dito | 8 |
| Kein Audit-Protokoll | dito | 9 |
| Keine Ressourcengrenzen | dito | 10 |
| Empfehlung für den Alltag | dito | Schluss |
| Offene Aufgabe: git kontrolliert zurückholen | [security-projects/git-security-feature.md](./security-projects/git-security-feature.md) | ganzes Dokument |

**Wichtig:** Die beiden Sicherheitsdokumente gehören zusammen. Wer nur das erste liest,
bekommt ein zu gutes Gefühl. Die drei gewichtigsten offenen Risiken:

1. **Alles Gelesene geht an DeepSeek.** Nicht technisch lösbar, solange eine Cloud-API
   benutzt wird — nur durch einen engen Lesebereich zu mildern.
2. **Prompt-Injection** über gelesene Dateien. Kein verlässlicher Schutz bekannt; die
   Bereichsgrenzen und die Rückfragen sind die eigentliche Verteidigungslinie.
3. **Geheimnisse jenseits der Muster** — Passwörter im Quelltext, `dump.sql`,
   `config/database.php`. Die Sperrliste kennt Dateinamen, keine Inhalte.

## 5. Offene Aufgaben

| Aufgabe | Umfang | Wo beschrieben |
|---|---|---|
| git kontrolliert auf die Allowlist zurückholen | gross, eigene Arbeitseinheit | [security-projects/git-security-feature.md](./security-projects/git-security-feature.md) |
| `--option=/pfad` aufspalten und den Wert mitprüfen | klein, lohnt sich | critical-issues, Punkt 3 |
| Audit-Protokoll | klein | critical-issues, Punkt 9 |
| Warnzeile beim Start unter `--yes` | sehr klein | critical-issues, Punkt 7 |
| `mode`-Schlüssel aus `config/loopBreaker.json` entfernen oder auswerten | trivial | wird derzeit ignoriert |
| `src/index.ts.backup` löschen | trivial | totes Überbleibsel |

**Nicht gemacht und bewusst offen:** Die ursprüngliche Aufgabe des Nutzers (Footer,
Brand-Titel und `.env`-Anpassungen in `~/develop/templates/julalo-ui-components`) wurde
nie ausgeführt. Beachte: Die `.env`-Änderung wird von der Geheimnis-Sperre blockiert;
dafür wäre `--allow-secrets` nötig — das sollte der Nutzer bewusst entscheiden.

## 6. Arbeitsweise, die sich bewährt hat

Der Nutzer legt Wert auf **belegte statt behauptete** Aussagen. Was sich als sinnvoll
erwiesen hat:

- Vermutungen messen, bevor man sie als Ursache benennt. Mehrere Diagnosen in diesem
  Projekt waren erst nach einem gezielten Experiment richtig (`rl.pause()` beendet den
  Prozess nach 10 ms; `\n` erzeugt `key.name === 'enter'`, nicht `return`; der API-Key war
  tatsächlich im Kindprozess sichtbar).
- Eigene Fehler benennen, statt sie zu überspielen. Zwei Regressionen sind erst beim
  Nachtesten aufgefallen und wurden zurückgenommen.
- Bei Sicherheitsfragen ehrlich zwischen „behoben" und „gemildert" unterscheiden. Der
  Nutzer hat mehrfach die sicherere Option gewählt, wenn man ihm die Abwägung offenlegte.
- Vor Änderungen an sicherheitsrelevantem Code die Tests erweitern, nicht danach.

### Zwei wiederkehrende Fallen in der Kommunikation

**Führender Schrägstrich.** Der Nutzer schreibt Pfade wie `/docs/security/…` und meint
damit „vom Projekt aus", nicht die Systemwurzel. Das hat einmal zu einer kaputten
Sitzungskonfiguration geführt. Im Zweifel projektrelativ interpretieren und es dazusagen.

**Tippfehler in Dateinamen** (`sourgough`, `sourdouch`). Korrigiert übernehmen und darauf
hinweisen.

## 7. Wichtige Stolperfalle beim Testen

Die Datei `.env` im Projekt enthält **nur einen Platzhalter**. Der echte API-Schlüssel
liegt in der Shell-Umgebung. dotenv überschreibt vorhandene Variablen nicht, deshalb
funktioniert die CLI trotzdem.

Wer beim Testen `. ./.env` sourct, überschreibt den echten Schlüssel mit dem Platzhalter
und bekommt „Authentication Fails" — das sieht wie ein ungültiger Schlüssel aus, ist aber
nur die `.env`. Direkt `$DEEPSEEK_API_KEY` verwenden.

## 8. Sofort einsatzbereit

```bash
cd ~/develop/platforms/leaven/leaven
npm test                      # 85 Prüfungen, kostenlos, kein API-Zugriff
npm run build && node dist/index.js
```

Nicht-interaktiver Testlauf:

```bash
printf 'Aufgabe\nexit\n' | node dist/index.js --yes --verbose \
  --read-root ~/develop/platforms/leaven/leaven \
  --write-root ~/develop/platforms/leaven/leaven/sandbox
```

Vollständige Prüfliste in [testing.md](./testing.md).
