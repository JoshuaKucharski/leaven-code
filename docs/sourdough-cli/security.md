# security — wie leaven-cli schützt

**Stand:** 2026-07-30. Was hält Dinge drinnen, die drinnen bleiben sollen. Ergänzend:
[../security/leaven-cli-bash-commands-security.md](../security/leaven-cli-bash-commands-security.md),
[../security/leaven-cli-critical-issues.md](../security/leaven-cli-critical-issues.md) (offene Risiken),
[./privacy-relevant-issues.md](./privacy-relevant-issues.md).

## Grundprinzip
**Die Grenzen erzwingt die CLI, nicht das Modell.** Jedes Modell gibt nur Werkzeug-*Anfragen*
als JSON aus; der CLI-Code entscheidet, ob sie ausgeführt werden. Ein Modellwechsel ändert die
Sicherheit **nicht** (modellunabhängig). Siehe [../security/environmental-facts.md](../security/environmental-facts.md).

## Die Schutzschichten
1. **Lese-/Schreibbereiche** (`securePath`) — jeder Datei-/Pfadzugriff wird gegen die Grenze
   geprüft; **symlink-fest** (`realpathSoFar`, weil `path.resolve` Symlinks nicht auflöst).
2. **Geheimnis-Sperre** — auch INNERHALB der Bereiche: `secretPatterns` (`.env`,`*credentials*`,
   `*.pem`,`id_rsa*`,…) und `secretDirectories` (`.ssh`,`.aws`,`.gnupg`,`.config/gcloud`,`.leaven`).
   Abschaltbar nur bewusst mit `--allow-secrets`.
3. **Shell-freie Befehle** — `execFile` statt `exec`: keine Pipes/Umleitungen/Verkettung/Ersetzung;
   Metazeichen werden **abgelehnt**.
4. **Allowlist statt Blocklist** — nur lesende Programme (`grep, rg, find, ls, cat, …`) laufen ohne
   Rückfrage; ihre Pfad-Argumente werden gegen den **Lese**bereich geprüft. Alles andere → Dialog.
   Optionssperren je Programm (z.B. `find -exec`, `grep -S`).
5. **Interpreter nie pauschal frei** — `git`, `php`, `bash` stehen bewusst NICHT auf der Allowlist
   (führen beliebigen Code aus). Enge Ausnahme: `php -l` (reiner Syntax-Check). `cp`→`copy_file`
   (redirect). Registrierte exakte Befehle (`allow`) nur vom Menschen.
6. **AI-unveränderbare Zone `~/.leaven`** — Registry, freigegebene Skripte, Rollen: der Assistent
   kann dort weder lesen noch schreiben. bash-Skripte laufen nur ohne Rückfrage, wenn sie DORT liegen.
7. **Vorschlagen → prüfen → freigeben** (`propose_command`) — der Assistent kann Befehle vorschlagen
   (Eingang), aber nur der Mensch gibt sie frei.
8. **Umgebungsbereinigung** — Kindprozesse erben **keine** API-Keys (`scrubEnvironment`).
9. **Netz-Grenzen** — `fetch_url`: nur GET, nur freigegebene Domains, **SSRF-Sperre** (private IPs).
   `post_to_endpoint`: genau EINE Ziel-URL, **keine Weiterleitungen** (307/308 würden den Payload umleiten).
10. **Loop-Breaker** — begrenzt Endlosschleifen (Schadensbegrenzung), meldet weich zurück.
11. **Keine Fremd-SDKs** — alle Provider über das vorhandene `axios`. Kein `@anthropic-ai/sdk`/`dashscope`/
    `openai`-Paket → keine zusätzliche Lieferketten-Fläche.
12. **Freigabe-Dialog** — die Stelle, an der ein Mensch auf schreibende/unbekannte Aktionen schaut.

## Was das NICHT leistet (bewusst ehrlich)
Die eigentlichen Restrisiken stehen in [../security/leaven-cli-critical-issues.md](../security/leaven-cli-critical-issues.md)
und [./privacy-relevant-issues.md](./privacy-relevant-issues.md): u.a. **alles Gelesene geht an den
Provider**, **Prompt-Injection**, GET-Exfiltration, Geheimnisse jenseits der Muster.

## Was man noch bauen könnte → [./upcoming-tasks.md](./upcoming-tasks.md)
- **Audit-Protokoll** (nachvollziehen, was ausgeführt/gesendet wurde).
- **git kontrolliert** zurückholen ([../security-projects/git-security-feature.md](../security-projects/git-security-feature.md)).
- **`--option=/pfad`** aufspalten und den Pfad mitprüfen.
- **Ausgehende Egress-Kontrolle** dokumentieren (OS-Firewall, nur erlaubte API-Hosts).
- Optional: `session.json`/`usage.json` verschlüsseln (enthalten Konversationsdaten).
