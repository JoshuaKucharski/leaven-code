# privacy-relevant-issues — Datenschutz-Gefahren

**Stand:** 2026-07-30. Was datenschutzseitig zu beachten ist. Schutz-Gegenstück:
[./security.md](./security.md). Grundtatsachen: [../security/environmental-facts.md](../security/environmental-facts.md)
+ [-extended](../security/environmental-facts-extended.md).

## Die zentrale, nicht technisch lösbare Tatsache
**Alles, was die CLI liest, geht als Teil der Anfrage an den aktiven Provider.** Bei einem
Werkzeug, das Quelltext liest, ist das keine Fußnote: jede gelesene Datei, jedes `grep`-Ergebnis,
jede `.env` (mit `--allow-secrets`) verlässt die Maschine. **Milderung:** Lesebereich so **eng**
wie möglich (ein Projekt, nicht `~`). Für sehr Sensibles: lokales Modell statt Cloud.

## Rechtsraum je Provider (wichtig für DSGVO)
| Provider | Datenfluss | EU-Angemessenheit | Training auf Eingaben |
|---|---|---|---|
| DeepSeek | China | **nein** | unklare API-Zusage |
| Anthropic (Opus/Fable) | USA | **ja** (Data Privacy Framework) | **klare** Nein-Zusage (API) |
| Qwen / DashScope | China (dieser Endpunkt) | **nein** | — |

Für **personenbezogene** Daten ist die Provider-Wahl damit auch eine Rechtsraum-Wahl. Der
DSGVO-Vorteil von Qwen käme erst durch EU-Hosting/lokale Gewichte — der genutzte DashScope-
Endpunkt liegt in China. **Der Nutzer setzt die CLI ausschließlich für eigenen Quellcode ohne
Personenbezug ein** — damit ist die DSGVO-Frage für ihn erledigt; das aber im Blick behalten,
falls je fremde Kundenprojekte in den Lesebereich geraten (Geschäftsgeheimnis ≠ Personenbezug).

## Weitere Gefahren (Details: [../security/leaven-cli-critical-issues.md](../security/leaven-cli-critical-issues.md))
- **Prompt-Injection** über gelesene Dateien/Webseiten — kann Modell steuern, aber nur *während*
  einer laufenden Sitzung. Verteidigung: enger Bereich + Freigabe-Rückfragen.
- **GET als Exfiltrationskanal** — `fetch_url` kann Daten in der URL nach aussen tragen (Punkt 8c).
- **DNS-Rebinding** — SSRF-Prüfung greift beim Auflösen, nicht beim Verbinden (Punkt 8d).
- **Geheimnisse jenseits der Muster** — Passwörter im Quelltext, `dump.sql`: die Sperrliste kennt
  Dateinamen, keine Inhalte.
- **Lokale Klartext-Dateien** — `session.json` (Konversation, evtl. gelesene Datei-Inhalte) und
  `usage.json` liegen in `~/.leaven` (für die AI gesperrt, aber Klartext auf der Platte). Wurde
  mit `--allow-secrets` gearbeitet, kann Sensibles in `session.json` stehen. Löschbar.

## Kein eingehender Zugriff (beruhigend, belegt)
Kein Provider (auch nicht Apple/OS/andere Apps) kann von sich aus „hereingreifen": die CLI hat
**keinen eingehenden Kanal**, sie wählt nur hinaus. Ohne laufende Sitzung passiert nichts.
Details + Beleg: [../security/environmental-facts.md](../security/environmental-facts.md),
[../security/environmental-facts-extended.md](../security/environmental-facts-extended.md),
[../security/environmental-cleanup-issues.md](../security/environmental-cleanup-issues.md).

## Was man verbessern könnte → [./upcoming-tasks.md](./upcoming-tasks.md)
Audit-Protokoll · Egress-Firewall auf erlaubte API-Hosts · Verschlüsselung der lokalen
Zustandsdateien · Warnung, welche sensiblen Dateien im Lesebereich liegen.
