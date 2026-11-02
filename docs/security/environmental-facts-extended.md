# Umgebungs-Grundtatsachen — Erweiterung: andere Anbieter

**Stand:** 2026-07-23
**Zugehörig:** [environmental-facts.md](./environmental-facts.md) — die Grundfassung
beantwortet dieselbe Frage für DeepSeek
**Praxisprüfung:** [environmental-cleanup-issues.md](./environmental-cleanup-issues.md) —
dieser Mac konkret auf Google/Microsoft/Amazon geprüft

Die Grundfassung klärt: Kann der Anbieter (DeepSeek) von sich aus auf den Rechner zugreifen
und die `/rights`-Regeln umgehen? Nein. Dieses Dokument prüft, ob das auch für **andere
Anbieter** gilt — konkret für Claude. Dabei kann „Claude" zwei verschiedene Dinge meinen,
und die Antworten unterscheiden sich in einem Punkt.

---

## 1. Die Grundtatsachen sind anbieterunabhängig

Jeder Cloud-Anbieter für Sprachmodelle ist gleich gebaut: ein Server, der auf Anfragen
wartet (Request/Response). Die CLI ist immer der Client, der hinauswählt — die Verbindung
geht nur nach aussen, es gibt keinen eingehenden Kanal. Ein Anbieterwechsel ändert am
Vertrauensmodell **nichts**: Die Guards (`securePath()`, die Befehlsprüfung, die
`/rights`-Regeln) sind die Grenze, unabhängig davon, welches Modell antwortet.

Alles aus [environmental-facts.md](./environmental-facts.md) gilt also wortgleich weiter.
Die folgenden Abschnitte zeigen nur, wo Claude eine Nuance hinzufügt.

## 2. Claude als Anbieter in der leaven-cli (hypothetisch)

**Gleiche Antwort wie DeepSeek: Nein**, aus denselben zwei architektonischen Gründen.

Anthropics API ist genauso gebaut wie die von DeepSeek: `POST /v1/messages`,
Request/Response. Würde die CLI Claude einbinden, wäre sie wieder der Client, der hinauswählt
— ausgehend, kein eingehender Kanal. Das Modell gäbe `tool_use`-Blöcke zurück (Anthropics
Entsprechung zu DeepSeeks `tool_calls`) — also **Bitten als JSON, keine Zugriffe**. Deine
`securePath()`-Prüfung, die Guards und die `/rights`-Regeln fingen sie genauso lokal ab.

**Faktum zur Genauigkeit:** Claude ist in der leaven-cli **gar nicht integriert** — das
wurde bewusst entschieden. `API_URL` (`src/index.ts:103`) zeigt nur auf DeepSeek, es gibt
keinen `x-api-key`-Pfad. Dieser Abschnitt ist also hypothetisch („falls du es einbaust").

**Der einzige Unterschied** läge nicht beim Zugriff, sondern beim Rechtsraum: Daten gingen an
Anthropic (USA, EU-Angemessenheit über das Data Privacy Framework) statt nach China. Das
ändert *wohin das Gelesene fliesst*, nicht *ob jemand hereingreifen kann* — beides bleibt
„Nein".

## 3. Claude Code (der Assistent, der jetzt läuft)

Das ist der ehrlichere Teil, denn hier läuft tatsächlich ein Claude auf deiner Maschine mit
echtem Datei- und Befehlszugriff — nicht als ferne API, sondern als Programm.

- **Zugriff ohne Session?** Nein — dasselbe Prinzip. Läuft Claude Code nicht, gibt es keinen
  Client, der hinauswählt; Anthropic hat keinen Weg, hineinzugreifen. Kein eingehender Kanal.
- **Die Regeln umgehen?** Nein — dasselbe Prinzip. Der Assistent gibt Werkzeug-*Anforderungen*
  aus; die Claude-Code-Umgebung (lokaler Code) entscheidet, ob sie ausgeführt werden.
  Belegbar im Alltag: Im Plan-Modus schlägt ein Schreibversuch **fehl**, bis der Modus
  wechselt — das erzwingt lokaler Code, nicht das Wohlverhalten des Modells.

**Der eine echte Unterschied** zur leaven-cli: Hier ist der lokale Türsteher **Anthropics**
Code, nicht deiner. Bei der leaven-cli kannst du `securePath()` und die Guards selbst lesen
— du besitzt und prüfst das Tor. Bei Claude Code vertraust du Anthropics Umgebung so, wie du
jedem installierten Programm vertraust, das du nicht selbst geschrieben hast. Das ist genau
die Kategorie aus [environmental-facts.md](./environmental-facts.md), Abschnitt 4: *„Code und
Abhängigkeiten laufen mit deinen Rechten — Vertrauensfrage an den Code, nicht an den
Anbieter."*

## 4. Auf einen Punkt gebracht

| | „Von allein zugreifen?" | „`/rights` umgehen?" | Wer ist der lokale Türsteher? |
|---|---|---|---|
| DeepSeek (in leaven-cli) | Nein | Nein | **Dein** Code (securePath, Guards) |
| Claude als Anbieter (hypothetisch) | Nein | Nein | **Dein** Code — identisch |
| Claude Code (der Assistent, jetzt) | Nein | Nein | **Anthropics** Umgebung |

Bei allen dreien ist das „Nein" architektonisch erzwungen — es hängt nie am Wohlverhalten des
Anbieters. Die einzigen Achsen, die variieren, sind: *wessen* Code das Tor bewacht und *in
welchem Rechtsraum* die gelesenen Daten landen.
