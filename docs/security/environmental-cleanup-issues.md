# Umgebungsprüfung — Aufräum-Punkte

**Stand:** 2026-07-23
**Gerät:** MacBook, Apple Silicon (Homebrew unter `/opt/homebrew`, arm64)
**Zugehörig:** [environmental-facts.md](./environmental-facts.md) ·
[environmental-facts-extended.md](./environmental-facts-extended.md)

Ergebnis einer Prüfung, ob Software von **Google, Microsoft oder Amazon** auf diesem Mac
Zugriff hat oder installiert ist. Alle Prüfungen waren rein lesend.

---

## Gesamturteil

**Keiner der drei Anbieter hat einen aktiven Hintergrund-Zugriff.** Kein Auto-Updater, kein
Dämon, kein Fernsteuerungs-Agent, kein laufender Prozess. Auf der Landkarte aus
`environmental-facts-extended.md` steht in der Kategorie „gewährt mit Hintergrund-Foothold"
**niemand**.

Die `/Applications`-Auswahl ist bewusst privatsphärenfreundlich (DuckDuckGo, Firefox,
Mullvad Browser, Mullvad VPN, LibreOffice, Thunderbird) — also die Alternativen zu genau den
gesuchten Google-/Microsoft-Produkten.

Es bleiben **drei Aufräum-Punkte**, davon nur einer sicherheitsrelevant.

---

## Punkt 1 — AWS-Zugangsdaten in `~/.aws` (sicherheitsrelevant)

| | |
|---|---|
| **Fundstelle** | `~/.aws/config`, `~/.aws/credentials` (Rechte `0600`, datiert 2025-06-27) |
| **Was es ist** | **Deine** langlebigen Schlüssel *zu* AWS — nicht Amazons Kanal zu dir. Die Richtung ist umgekehrt. |
| **Warum trotzdem relevant** | Langlebige Zugangsdaten als Datei. `0600` schützt nur vor *anderen* Benutzern, nicht vor Prozessen, die als du laufen (siehe [environmental-facts.md](./environmental-facts.md), Abschnitt 4). |
| **Entlastung** | `.aws` steht auf der Geheimnis-Sperrliste der leaven-cli (`config/commands.json` → `secretDirectories`). Die CLI liest und sendet diese Dateien **nicht**. |
| **Empfehlung** | Prüfen, ob die Schlüssel noch gebraucht werden. Falls alt/ungenutzt: in der AWS-Konsole **rotieren oder deaktivieren** und die Dateien entfernen. Für Dauerbetrieb besser kurzlebige Anmeldungen (SSO/`aws sso login`) statt statischer Schlüssel. |

Das ist der **einzige** Punkt mit echter Sicherheitsrelevanz.

## Punkt 2 — Playwrights „Chrome for Testing" (Aufräumen optional)

| | |
|---|---|
| **Fundstelle** | `~/Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app` |
| **Was es ist** | Automatisierungs-Browser, den ein **Playwright**-npm-Paket in einem deiner Projekte heruntergeladen hat. Der einzige Google-Code auf der Platte. |
| **Verhalten** | Läuft **nur**, wenn ein Test ihn startet. Kein Updater, kein Hintergrundbetrieb, kein Launch-Agent. |
| **Empfehlung** | Kein Handlungsbedarf. Wer wirklich null Google-Code will: `~/Library/Caches/ms-playwright` löschen — wird aber vom nächsten Playwright-Lauf neu geholt. Dauerhaft nur durch Entfernen der Playwright-/Puppeteer-Abhängigkeit im betreffenden Projekt. |

## Punkt 3 — Google-Datenreste (Aufräumen optional)

| | |
|---|---|
| **Fundstelle** | `~/Library/Application Support/Google/` → `Chrome`, `Chrome Beta`, `Chrome Canary`, `Chrome Dev`, `Chrome for Testing`, `RLZ` |
| **Was es ist** | **Profil-/Datenreste** früherer Testläufe. Es gibt **kein** installiertes Chrome in `/Applications`, das diese Ordner nutzt. |
| **Empfehlung** | Kann entfernt werden (reine Datenreste). Kein Sicherheitsrisiko, nur Ordnung. |

---

## Was ausdrücklich KEIN Problem ist

Damit die Prüfung ehrlich bleibt — das wurde geprüft und ist **sauber**:

| Geprüft | Ergebnis |
|---|---|
| Microsoft (Office, MAU-Updater, Container, App-Daten) | **Nichts vorhanden** |
| Google Keystone (`GoogleSoftwareUpdate`) — Benutzer & systemweit | **Nicht vorhanden** |
| Amazon-Apps (Prime, Alexa, Kindle) | **Nicht vorhanden** |
| AWS SSM-Agent (`amazon-ssm-agent`, `/opt/aws`) — Fernsteuerung | **Nicht vorhanden** |
| Google-Cloud-CLI (`gcloud`, `gsutil`, `~/.config/gcloud`) | **Nicht vorhanden** |
| Launch-Agents/Dämonen von Google/Microsoft/Amazon | **Keine** |
| Laufende Prozesse von Google/Microsoft/Amazon | **Keine** |
| `aws`-CLI | Vorhanden, aber Kategorie „du rufst an" — kein Hintergrunddienst |

---

## Prüfmethode (zum Nachvollziehen)

Alle Befehle rein lesend:

```bash
# Installierte Apps
ls -1 /Applications

# Google Keystone (Auto-Updater)
ls -la ~/Library/Google/GoogleSoftwareUpdate /Library/Google/GoogleSoftwareUpdate

# Microsoft AutoUpdate
ls -la "/Library/Application Support/Microsoft/MAU2.0"

# AWS-Werkzeuge & Fernsteuerung
command -v aws gcloud gsutil amazon-ssm-agent; ls -la /opt/aws ~/.aws

# Hintergrund-Agenten
ls -1 ~/Library/LaunchAgents /Library/LaunchAgents /Library/LaunchDaemons

# Laufende Prozesse
ps -Ao comm | grep -iE "google|keystone|microsoft|amazon|aws|ssm|onedrive"
```
