# Umgebungs-Grundtatsachen

**Stand:** 2026-07-23
**Zugehörig:** [leaven-cli-critical-issues.md](./leaven-cli-critical-issues.md) —
dort stehen die tatsächlichen Restrisiken im Detail
**Fortsetzung:** [environmental-facts-extended.md](./environmental-facts-extended.md) —
gilt dasselbe auch für andere Anbieter (Claude)?

Dieses Dokument beantwortet eine wiederkehrende Frage:

> Könnte der Anbieter (DeepSeek) von sich aus auf meinen Rechner zugreifen — auch ohne
> gestartete Session — und dabei die `/rights`-Regeln missachten?

**Kurz: Nein.** Aus zwei voneinander unabhängigen Gründen, die beide *architektonisch*
gelten und nicht vom Wohlverhalten des Anbieters abhängen.

---

## 1. Die Verbindung geht nur hinaus

DeepSeek ist ein Server, der auf Anfragen wartet. Die Verbindung läuft immer in eine
Richtung: **deine** CLI wählt sich bei DeepSeek ein und stellt eine Frage, DeepSeek
antwortet auf genau diese offene Verbindung und legt danach auf.

DeepSeek hat keine Adresse zu deinem Rechner — keinen offenen Port, keine Rückrufnummer,
keinen Weg, von sich aus anzuklopfen. Das ist die Bauart einer Request/Response-API, keine
Einstellungssache. Ein Server, den du nicht anrufst, kann dich nicht anrufen.

**Belegt am Code (2026-07-23):** `grep` über `src/` findet keinen eingehenden Kanal — kein
`createServer`, kein `.listen(`, keinen Socket, keinen gebundenen Port. Alle
Netzverbindungen gehen hinaus (`axios.get` / `axios.post`) an genau drei Ziele:

| Ziel | Stelle | Zweck |
|---|---|---|
| DeepSeek-API | `API_URL`, `src/index.ts:103` | Anfrage an das Modell |
| `fetch_url` | `src/index.ts:568` | GET auf erlaubte Domains (nur mit `/internet`) |
| `post_to_endpoint` | `src/index.ts:614` | POST an die eine eigene Instanz |

Alle drei sind ausgehend, und die letzten beiden sind zusätzlich durch Allowlist bzw. feste
Ziel-URL begrenzt.

## 2. Ohne laufende Session passiert nichts

Wenn die CLI nicht läuft, gibt es keinen Client, der hinauswählt. DeepSeek liegt dann da wie
eine Website, die niemand aufruft. Es wartet nicht auf dich und kann dich nicht suchen. Ein
Zugriff „im Hintergrund" oder „von allein" ist nicht möglich, weil es niemanden gibt, der
die Verbindung aufbaut.

## 3. Das Modell führt selbst nichts aus

Das Modell hat keine Hände. Wenn DeepSeek eine Datei lesen „will", *tut* es das nicht — es
schickt deiner CLI einen Text zurück, der sinngemäss sagt: „Bitte führe `read_file` auf
Pfad X aus." Das ist eine **Bitte als JSON**, kein Zugriff.

Was dann geschieht, entscheidet dein Code auf deinem Rechner:

    DeepSeek-Server          │  Dein Rechner (die CLI)
                             │
    "bitte read_file(/x)" ───┼──▶ securePath() prüft: liegt /x im Lesebereich?
                             │    permissions.read gesetzt?  /rights-Regeln?
                             │         │
                             │         ├─ ja  → CLI liest, gibt Inhalt zurück
                             │         └─ nein → CLI lehnt ab

Die `/rights`-Regeln, die Bereichsgrenzen und die Geheimnis-Sperrliste sind Code, der in
**deinem** Prozess läuft. DeepSeeks Server sieht diesen Code nie und kann ihn nicht ändern.
Das Modell kann die Regeln so wenig „missachten", wie ein Anrufer dein Türschloss umgehen
kann, indem er dich am Telefon bittet, ihn hereinzulassen. Die Entscheidung liegt immer
diesseits.

## 4. Wo die Grenze wirklich liegt

Die Zusicherung aus den Abschnitten 1–3 ist nur so gut wie zwei Dinge:

1. **Der CLI-Code selbst** — die Prüfungen müssen korrekt sein. Deshalb gibt es dafür Tests
   (`npm test`, 119 Prüfungen).
2. **Die Abhängigkeiten** — npm-Pakete laufen mit deinen Rechten. Das ist derselbe
   Vertrauensakt wie bei jedem Programm, das du startest.

Die tatsächliche Gefahr hat also eine andere Form als „der Anbieter greift von aussen zu".
Sie ist in [leaven-cli-critical-issues.md](./leaven-cli-critical-issues.md) im Detail
beschrieben; die drei wichtigsten:

| Risiko | Form | Wo im Detail |
|---|---|---|
| **Prompt-Injection** | Eine gelesene Datei/Webseite steuert das Modell — aber nur *während* einer laufenden Session, nie von allein | critical-issues, Punkt 8 |
| **Alles Gelesene geht an DeepSeek** | Normale Funktionsweise, kein „Zugriff" — aber ein zu weiter Lesebereich gibt mehr preis als nötig | critical-issues, Punkt 1 |
| **Code & Abhängigkeiten** | Laufen mit deinen Rechten — Vertrauensfrage an den Code, nicht an den Anbieter | — |

## 5. Zusammengefasst

| Frage | Antwort |
|---|---|
| Kann DeepSeek von sich aus eine Verbindung zu meinem Rechner aufbauen? | Nein — es gibt keinen eingehenden Kanal |
| Passiert etwas, wenn keine Session läuft? | Nein — ohne Client wählt nichts hinaus |
| Kann das Modell die `/rights`-Regeln umgehen? | Nein — es führt nichts aus; deine CLI entscheidet lokal |
| Wovon hängt das Nein ab? | Von der Architektur, nicht vom Wohlverhalten des Anbieters |
| Was ist die eigentliche Vertrauensgrenze? | Der CLI-Code und seine npm-Abhängigkeiten |
