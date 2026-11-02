# Handover – Board-Auto-`done` (Feature-Abschluss automatisch melden)

**Datum:** 2026-08-08 13:21 CEST
**Thema:** Warum Bucket-Features nie auf „done" springen – und wie es jetzt gelöst ist
**Betroffene Dateien:** `src/board.ts`, `src/index.ts` (Quelltext geändert – **Build ausstehend**)

---

## 1. Ausgangsproblem

Ein Feature/Task, das über das Laravel-Webprojekt **„leaven"** in einen Bucket übernommen
und via **leavencode-CLI** (Launcher-Auftrag) bearbeitet wird, wurde auf dem Board **nie
als „done" markiert**, obwohl der KI-Agent die Aufgabe fertig erledigt hatte.

### Zwei ineinandergreifende Ursachen

**(a) Konstruktionslücke im CLI-Code (behoben im Quelltext):**
Es gab im gesamten Code **keinen `done`-Aufruf**. Der Vertrag in `board.ts` sagte ausdrücklich
„kein Auto-done". Gemeldet wurde ausschließlich `in_progress`:
- `meldeArbeitBegonnen()` beim Launcher-Start (§F.1)
- `meldeFortschritt()` als Heartbeat bei `update_plan` (§F.2)

**(b) Falscher Lösungsansatz in der Prompt-Vorlage (noch offen, Laravel-Seite):**
Die vom Laravel-Projekt generierte `INITIAL_PROMPT.md` (im Ziel-Repo unter
`<projekt>/.leaven/INITIAL_PROMPT.md`) wies den Agenten an, den Abschluss **selbst per
API/curl** zu melden. Das kann in dieser CLI **prinzipiell nicht funktionieren**:
- keine Shell → `curl`, Pipes, `;`, `&&`, `${VAR}`-Expansion werden abgelehnt,
- `printenv LEAVEN_BUCKET_TOKEN` wird ohne Shell nicht expandiert,
- `.leaven/` ist als **Geheimnis** gesperrt (Token darf nie an die Modell-API),
- `propose_command` legt nur einen Freigabe-Vorschlag ab, führt nichts aus.

Der Agent verschwendet damit nur Schritte an einer Sackgasse. Der Abschluss gehört
**in die CLI**, nicht in den Prompt.

---

## 2. Der entscheidende Stolperstein: `dist/` ist der Laufcode

Die CLI läuft aus **`dist/index.js`** (`package.json` → `"bin": {"leaven": "./dist/index.js"}`,
`"main": "dist/index.js"`), **nicht** aus `src/`. Build-Skript: `"build": "tsc"`.

**Konsequenz:** Quelltext-Änderungen in `src/` sind erst nach `npm run build` aktiv.
Zum Zeitpunkt der Session enthielt `dist/index.js` zwar `meldeArbeitBegonnen` (alter
Stand, deshalb erschien „5 Feature(s) auf ‚in Arbeit' gemeldet"), aber **weder**
`meldeAbgeschlossen` **noch** `meldeAbschlussFallsBoard`. Der Build war/ist veraltet.

> **Merke für die Zukunft:** Nach jeder `src/`-Änderung `npm run build` (oder `npm test`,
> baut mit) laufen lassen, sonst testet man weiter den alten `dist/`-Stand. npm ist in der
> Agent-Umgebung freigabepflichtig.

---

## 3. Was geändert wurde (Quelltext)

### `src/board.ts`
- Neue Funktion:
  ```ts
  export async function meldeAbgeschlossen(note = 'Aufgabe abgeschlossen'): Promise<MeldeErgebnis> {
    return melde('done', note);
  }
  ```
  Die `melde('done', …)`-Logik existierte längst intern, wurde nur nie aufgerufen.
- Vertrags-Kommentar im Kopf aktualisiert (Punkt 3 „echter Turn-Abschluss → done",
  Punkt 4 „Budget-/Schrittlimit-Stopp bzw. Fehler → nichts").

### `src/index.ts`
- Import um `meldeAbgeschlossen` erweitert.
- `TurnStatus` erweitert: `'fertig' | 'budget'` → **`'fertig' | 'budget' | 'gestoppt'`**.
  - `'fertig'`   = Modell hat den Auftrag abgeschlossen (keine Tool-Anforderung mehr, `isFinal`).
  - `'gestoppt'` = am **Schrittlimit** angehalten – Aufgabe **nicht** fertig.
  - `'budget'`   = Tages-Token-Budget erreicht – Aufgabe **nicht** fertig.
- Die beiden **Schrittlimit-Notausgänge** in `runAgentTurn` geben jetzt `'gestoppt'` statt
  `'fertig'` zurück (non-TTY-Stopp + „Nutzer bricht ab"). Nur so lässt sich echter
  Abschluss von „am Limit gestoppt" unterscheiden → kein falsches `done`.
- Neue Helferfunktion `meldeAbschlussFallsBoard()` (Best-Effort, wirft/blockiert nie):
  ```ts
  async function meldeAbschlussFallsBoard(): Promise<void> {
    if (!boardAktiv()) return;
    const r = await meldeAbgeschlossen();
    // gibt „↪ Board: n Feature(s) auf „erledigt" gemeldet." aus
  }
  ```
- Aufruf bei `status === 'fertig'` in den **zwei unbeaufsichtigten Flows**:
  1. **Launcher-Auftrag** (INITIAL_PROMPT/PROMPT_FILE, Auto-Start).
  2. **`sessionFortsetzen`** (Resume nach Budget-Stopp).

### Bewusst NICHT gemacht
- **Kein Auto-`done` im interaktiven Chat** (die `runAgentTurn`-Aufrufstelle in `startChat`).
  Dort sitzt ein Mensch, der weiterarbeiten kann – jeder Turn-Abschluss als „done" wäre
  verfrüht. Erweiterbar mit einer Zeile, falls gewünscht.
- **Kein `done`** bei `'budget'`, `'gestoppt'` oder Fehler/Abbruch – Karte bleibt `in_progress`.
- Session-Handhabung (`loescheSession` etc.) für `'gestoppt'` unverändert gegenüber vorher
  (früher gab dieselbe Stelle `'fertig'` zurück, der else-Zweig war identisch) → kein
  Verhaltensbruch.

---

## 4. Fachliche Regel (vom Nutzer bestätigt)

- Der Abschluss **muss** automatisch als `done` gesetzt werden, sobald der KI-Agent die
  Aufgabe abgeschlossen hat.
- Ein Mensch kann **später** ein Label „approved"/„not approved" setzen und die Karte
  zurück auf `in_progress` schicken (**noch nicht gebaut** – zukünftiges Feature).

---

## 5. Offene To-dos für die Weiterarbeit

1. **`npm run build`** in `leavencode/` (Freigabe nötig), damit `dist/` die Auto-`done`-Logik
   enthält. Danach `npm test` zur Gegenprobe (tsc typecheckt beim Build mit; TypeScript lässt
   sich nicht mit `php -l` prüfen).
2. **Laravel-Seite „leaven":** In der Vorlage, die `INITIAL_PROMPT.md` erzeugt, die Anweisung
   „markiere die Aufgabe per API/curl als done" **entfernen**. Die CLI erledigt das jetzt
   automatisch und sicher (Token aus der Umgebung, nie ans Modell). Diese Vorlage liegt
   **außerhalb** des leavencode-Schreibbereichs.
3. **Später:** Human-Review-Feature (approved/not approved → zurück in_progress).
4. **Optional:** Auto-`done` auch im interaktiven Chat, falls fachlich gewünscht.

---

## 6. Verifikation nach dem Build (Erwartung)

Beim Launcher-Lauf sollte nach dem regulären Turn-Abschluss zusätzlich zu
„↪ Board: n Feature(s) auf ‚in Arbeit' gemeldet." am Ende erscheinen:

```
↪ Board: n Feature(s) auf „erledigt" gemeldet.
```

Voraussetzung: Der Agent **beendet seinen Turn regulär** (finale Antwort ohne weiteren
Tool-Call → `isFinal` → `'fertig'`) und `boardAktiv()` ist wahr (Env-Variablen
`LEAVEN_BUCKET_*` gesetzt – das ist im Launcher-Lauf der Fall, siehe „in Arbeit"-Meldung).
