# development-advices — so arbeitet man an leaven-cli

**Stand:** 2026-07-30. Für den nächsten Assistenten: was trägt, was schiefgeht.

## Die NICHT verletzbaren Invarianten (jede hat schon Schaden gemacht)
1. **`reasoning_content`/`thinking` unverändert zurückreichen**; Modell/Thinking **nicht** mitten
   in einer Konversation wechseln → HTTP 400. `/model` und `/thinking` **resetten** deshalb den
   Verlauf. Wer Einstellungen ergänzt, die das Antwortformat ändern, muss dasselbe tun.
2. **Rohes Antwortobjekt in die History pushen** — nie neu zusammenbauen, keine Felder entfernen.
   Streaming-Rückgabe ist **strikt** `{role, content, reasoning_content?, tool_calls?}` (keine
   Hilfsfelder wie usage/finish_reason – sie würden mitgesendet).
3. **Pfade zählen IMMER ab dem Lesebereich** (auch beim Schreiben, auch für Befehlsargumente).
   `securePath` ist symlink-fest.
4. **Jeder `tool_call` bekommt genau eine `role:'tool'`-Antwort** — sonst 400. Auch bei Ablehnung/
   Loop-Breaker. `repairHistory` ist das Netz.
5. **Rechte modellunabhängig** — nie versuchen, sie „ins Modell" zu verlagern.
6. **Streaming:** vollständige Message ODER werfen (nie halbe in die History). `content` NIE live
   drucken (DSML-Fallback + Formatierung brauchen den ganzen Text) — nur Reasoning live.
7. **`~/.leaven` bleibt AI-dicht.** Neue Zustandsdateien dorthin, nie in den Lesebereich.

## Sprache & Stil
- **Befehlsnamen englisch, alles andere deutsch** (Ausgaben, Kommentare, Doku). Nicht verhandelbar.
- **Belegt statt behauptet:** Vermutungen **messen**, bevor man sie als Ursache benennt. In dieser
  Codebasis waren mehrere Diagnosen erst nach einem Experiment richtig.
- Ehrlich zwischen „behoben" und „gemildert" unterscheiden; eigene Regressionen benennen.
- **Führender Schrägstrich** in Nutzer-Pfaden = projektrelativ.

## Werkzeuge, die sich bewährt haben
- **Fable-Subagent als Reviewer** für heikle/riskante Teile (Streaming-Parser, Persistenz): fand
  mehrfach echte Bugs, die Tests nicht abdeckten. Muster: Design-Review VOR dem Bauen, Code-Review
  des Diffs DANACH.
- **Reine Funktionen + Fixture-Tests** für den Risikokern (SSE-Parser, Assembler, Budget-/Session-
  Logik). Kein API-Zugriff, alle Edge-Cases als Fixtures.
- Neue Provider = OpenAI-kompatibel? → über `openaiStream.ts` / den DeepSeek-Pfad wiederverwenden,
  **kein SDK**. Anthropic-artig? → eigener Adapter wie `anthropic.ts`.

## Terminal-Fallen (gemessen, nicht vermutet)
- `rl.pause()` beendet den Prozess nach ~10 ms (offenes Promise hält die Event-Loop nicht am Leben)
  → `process.stdin.resume()`.
- `setRawMode(false)` schaltet Echo wieder ein → Doppeldruck. Ausgangszustand merken.
- `removeAllListeners('keypress')` zerstört readline → Listener sichern/wiederherstellen.
- Mehrzeiliges Einfügen = N Zeilen-Events (Coalescing-Fenster). **Bracketed-Paste bewusst NICHT
  gebaut** (heikel, Nutzer wollte es nicht).

## Testen
`npm test` (Kern, 153) + `npm run test:{anthropic,stream,usage,session}` (separat, bewusst schlank
gehalten). Alle ohne API. **`.env` enthält nur Platzhalter** — echte Keys in `~/.zshrc`; `. ./.env`
zerschiesst den echten Key beim Testen. Nach dem Bauen `dist/` testen.

## Verifikations-Reihenfolge bei jeder Änderung
`npm run typecheck` → `npm run build` → betroffene Test-Suiten → (bei Provider/Streaming) Live-Test
mit dem Nutzer (Keys nur in dessen Shell — er startet, du gibst die Anleitung mit `!`-Präfix nur
für read-only-Kommandos).
