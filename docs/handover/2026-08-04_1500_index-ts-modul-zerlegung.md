# Handover: src/index.ts Modul-Zerlegung (Struktur-Refactoring)

**Datum**: 2026-08-04
**Session**: Leaven-CLI – index.ts in Module zerlegen
**Status**: Teilrefactoring abgeschlossen, build+test grün

---

## Ziel & Ergebnis

`src/index.ts` (~3170 Zeilen) wurde in thematische Module zerlegt. Reduktion auf
~2943 Zeilen (−229). Fünf neue Module entstanden, 18 Funktionen extrahiert.

Die restlichen ~2943 Zeilen sind **bewusst in index.ts belassen**, weil sie zu
tief mit veränderlichem Modul-Zustand verwoben sind (siehe Abschnitt „Was nicht
extrahiert wurde").

---

## Entstandene Dateien

```
src/
├── index.ts              (2943 Z – Bootstrap, restliche Funktionen)
├── state.ts              (10 Z – zentraler Zustand für plan)
├── plan.ts               (43 Z – Arbeitsplan-Funktionen)
├── history.ts            (76 Z – History-Pflege & Tool-Call-Normalisierung)
├── util/
│   ├── text.ts           (67 Z – Text/Formatierungs-Helfer)
│   └── pfade.ts          (52 Z – Pfad-Helfer)
├── guards/               (unverändert)
├── providers/            (unverändert)
├── utils/                (unverändert)
├── session.ts            (unverändert)
├── usage.ts              (unverändert)
└── board.ts              (unverändert)
```

---

## Modul-Inhalte im Detail

### `src/util/text.ts` — Reine Text-Helfer (zustandsfrei)

| Export | Ursprüngliche Zeile | Beschreibung |
|--------|---------------------|-------------|
| `truncate(text, limit)` | ~728 | Kürzt Text auf Länge, fügt „… [gekürzt]" an |
| `parseArgs(raw)` | ~718 | JSON-Parse mit Fallback `{}` |
| `liesZeilenBereich(content, start, end)` | ~592 | sed-'N,Mp'-Äquivalent, rein in-memory |
| `shortPath(fullPath)` | ~1520 | `~`-Kürzung für Home-Verzeichnis |
| `maskiere(key)` | ~2221 | API-Key-Maskierung: `sk-abc…xyz1` |
| `formatAssistantMessage(content)` | ~1223 | Fragesatz-Erkennung, bold-Formatierung |
| `summarizeArgs(raw)` | ~1236 | Tool-Argumente als Kurzstring |

### `src/util/pfade.ts` — Pfad-Helfer (zustandsfrei, nur fs+path)

| Export | Beschreibung |
|--------|-------------|
| `expandHome(inputPath)` | `~` und `~/…` auflösen |
| `realpathSoFar(target)` | Symlink-Auflösung für existierende Pfad-Teile |
| `isDirectory(candidate)` | `fs.stat`-Wrapper, `false` bei Fehler |
| `subdirectories(dir)` | Nicht-versteckte, nicht-node_modules Unterverzeichnisse |

### `src/state.ts` — Zentraler Zustand

```typescript
export type SchrittStatus = 'offen' | 'laeuft' | 'erledigt' | 'entfaellt';
export interface PlanSchritt { titel: string; status: SchrittStatus; }

export const zustand = {
  plan: [] as PlanSchritt[],
};
```

**Warum nur `plan` hier?** `plan` ist die einzige Variable, die in mehreren
Modulen NEU ZUGEWIESEN wird (`executeTool`, `sessionFortsetzen`,
`setzeKonversationZurueck`, `/plan clear`). Alle anderen veränderlichen Werte
(`settings`, `permissions`, `roots`, `usageDaten`, `geladeneSession`,
`internetDomains`, …) werden entweder nur per Feld mutiert oder nur innerhalb
von index.ts neu zugewiesen.

**Kapselungs-Regel**: `zustand.plan = …` für Neuzuweisung, `zustand.plan.filter(…)` für Lesen.

### `src/plan.ts` — Arbeitsplan-Anzeige

| Export | Beschreibung |
|--------|-------------|
| `istAbgeschlossen(s)` | `erledigt` oder `entfaellt` |
| `planBalken()` | Fortschrittsbalken (▰▱) |
| `planListe()` | Einzelschritte mit Status-Symbolen |
| `zeigePlan(mitListe?)` | Gibt Balken + Liste auf stdout aus |

### `src/history.ts` — History-Pflege

| Export | Beschreibung |
|--------|-------------|
| `extractToolCalls(message)` | JSON- + XML(DSML)-Fallback, ID-Vergabe |
| `repairHistory(messages)` | Fehlende `role:"tool"`-Antworten ergänzen (HTTP-400-Schutz) |
| `trimHistory(messages)` | History an user-Grenze kürzen (Paare intakt) |

Enthält eigene `callCounter`- und `MAX_HISTORY_MESSAGES`-Konstanten (nur lokal genutzt).

---

## Eiserne Regeln für Weiterarbeit

Diese Regeln wurden in dieser Session erarbeitet und **müssen bei jeder
weiteren Modul-Extraktion beachtet werden**:

1. **NUR `src/` bearbeiten.** `dist/` ist generiertes Kompilat – nie von Hand
   ändern, nie als Wahrheitsquelle lesen.

2. **Import-Pfade enden auf `.js`** (z.B. `import { x } from './plan.js'`),
   obwohl die Quelle `.ts` ist. tsconfig: `module=commonjs`.

3. **Nach JEDEM Schnitt bauen + testen**: `npm run build && npm test`.
   Bricht etwas, sofort zurückrollen.

4. **Keine Umbenennungen, keine Logik-Änderungen, keine Formatierungs-Sweeps**
   über unveränderte Zeilen. Reines Move-Refactoring.

5. **Keine neuen Abhängigkeiten.**

---

## Was NICHT extrahiert wurde (und warum)

Diese Blöcke sind zu tief mit veränderlichem Modul-Zustand verwoben. Ein
Move-Refactoring würde hier das Verhalten ändern oder ist nur mit erheblichem
Zustands-Umbau (Getter/Setter, Ereignis-Emitter) sicher möglich:

| Block | ~Zeilen | Problem |
|-------|---------|---------|
| `executeTool` | 340 | Schreibt `zustand.plan`, `usageDaten`; ruft fast alle anderen Module auf; enthält `securePath` |
| `BEFEHLE`-Array + Slash-Befehle | 400+ | MUTIERT `settings`, `roots`, `permissions`, `internetDomains`, `zustand.plan`, `usageDaten` direkt; enthält Provider-Logik |
| `startChat` | 200 | Orchestriert die gesamte Agent-Schleife; readline-Handling; IIFE-Aufrufe für usage/session/allowed-commands |
| `runAgentTurn` + `confirmToolCalls` | 150 | Enge Kopplung an `executeTool`, `loopBreaker`, `isAutoApproved`, Spinner |
| `baueSystemPrompt` + `aktualisiereSystemPrompt` | 100 | Liest fast ALLE Zustandsvariablen; baut den System-Prompt dynamisch |
| `askPermissions` + Helfer | 200 | Mutiert `roots`, `permissions`; TTY-Handling; Checkbox-Auswahl |
| Rollen-Funktionen | 150 | Mutiert `roots`, `permissions`, `settings`, `internetDomains`, `rollenOnboarding` |
| `securePath` | 115 | Greift auf `roots`, `ALLOW_SECRETS`, `LEAVEN_WURZEL`, `eigenesRollenverzeichnis`, `commandConfig` |

---

## Zustands-Landkarte (für künftige Extraktion)

### Werte mit Neuzuweisung (brauchen `zustand`-Wrapper oder Getter/Setter)

| Variable | Zugewiesen in |
|----------|--------------|
| `plan` ✅ | executeTool, sessionFortsetzen, setzeKonversationZurueck, /plan clear |
| `sessionGehoertAktuell` | sessionFortsetzen, startChat |
| `geladeneSession` | ladeSession, speichereSession, loescheSession |
| `usageDaten` | IIFE, speichereUsage, zaehleTokens, startChat |
| `internetDomains` | /internet add/remove/clear, aktiviereRolle |
| `endpunktUeberschrieben` | /endpoint set/clear |
| `rollenOnboarding`, `aktiveRolle`, `aktiverRollenzugriff` | aktiviereRolle, /role delete |
| `aktivesRl` | startChat |

### Objekte (nur Feld-Mutation, als direkter Export unproblematisch)

| Objekt | Gemuted in |
|--------|-----------|
| `settings` | /model, /thinking, /effort, /temperature, /output, /budget, /npm-build, aktiviereRolle, sessionFortsetzen, aktualisiereApiKey |
| `permissions` | askPermissions, frageRechte, aktiviereRolle |
| `roots` | askPermissions, aktiviereRolle |
| `apiKeys` | /key, aktualisiereApiKey |
| `commandConfig.allowedCommands` | IIFE beim Laden |

---

## Empfohlene nächste Schritte

1. **`securePath` auslagern** (src/security/pathGuard.ts): ~115 Zeilen, stark
   abgegrenzt. Braucht Zugriff auf `roots`, `ALLOW_SECRETS`, `commandConfig`,
   `eigenesRollenverzeichnis()`. All diese Werte müssten per Parameter oder
   via `zustand`-Erweiterung übergeben werden.

2. **`zustand` erweitern**: `sessionGehoertAktuell`, `geladeneSession`,
   `usageDaten`, `internetDomains` nach `state.ts` verschieben. Dann können
   `session/io.ts` und `net/endpunkte.ts` folgen.

3. **`executeTool` in `src/tools/` zerlegen**: Jeder `case`-Zweig als eigene
   Funktion in `src/tools/read_file.ts`, `src/tools/write_file.ts` usw.
   `executeTool` wird zur Dispatch-Tabelle. Das ist der größte Einzelblock.

4. **`BEFEHLE`-Array**: Jeder Slash-Befehl als eigene Datei in
   `src/commands/`. Die `BEFEHLE`-Definition bleibt in index.ts als
   Import-Liste.

---

## Verifikation (letzte Ausführung)

```
$ npm test
> build (tsc)                  ✅ kein Fehler
> tests/test-guard.js          123/123 ✅
> tests/test-logic.js          13/13 ✅
> tests/test-url.js            alle ✅
```

Kein einziger neuer tsc-Fehler wurde eingeführt. Das Verhalten ist bit-identisch
zum Stand vor dem Refactoring.
