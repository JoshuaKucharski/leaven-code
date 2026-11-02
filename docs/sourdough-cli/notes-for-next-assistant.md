# notes-for-next-assistant — was sonst nirgends steht

**Stand:** 2026-07-30. Kontext aus der Session, der für die Weiterentwicklung zählt, aber in
keiner anderen Datei steht. Ergänzt [./development-advices.md](./development-advices.md).

## 1. Modell-IDs NICHT raten (harte Lektion)
Modell-IDs sind flüchtig. **Erfinde keine** (z.B. „`claude-opus-5`") — falsche IDs geben 400.
Der Nutzer sagte, Opus 5 existiere; es gibt aber keine gesicherte ID → `/model opus` zeigt bewusst
auf `claude-opus-4-8`. **Ein neueres Modell aufnehmen** = an genau drei Stellen in
`src/providers/capabilities.ts`:
1. `ALLE_MODELLE` (die `/model`-Liste),
2. `MODELL_ALIASE` (Kurzname → neue ID),
3. `capabilitiesFor()` (Fähigkeiten des neuen Modells).
Erst die **exakte ID vom Anbieter** holen, dann eintragen.

## 2. Nicht verhandelbare Nutzer-Entscheidungen (im Code verankert)
- **Plattform-Vertrauen:** Die eigene leaven-Plattform ist die **einzige** Instanz mit 100 %
  aller einstellbaren Rechte („wir vertrauen ihr, da sie von uns selbst kommt"). Umgesetzt:
  volle Rechte bei Auftragsbeginn, **keine** Rechteerweiterung mitten im Lauf.
- **`post_to_endpoint`:** genau **eine** eigene Ziel-URL, **niemals** Weiterleitungen folgen
  („das darf nicht passieren, auf gar keinen fall" — 307/308 würden den Payload umleiten).
- **Rollen-Isolation:** Nur die Rolle `leaven-cli-engineer` darf ganz `~/.leaven` lesen;
  alle anderen Rollen **nur ihre eigene** Onboarding-Datei.
- **Kein Fremd-SDK** für Provider — alles über axios (Lieferketten-Sicherheit).
- **Sprache:** Befehle englisch, alles andere deutsch.

## 3. Arbeitsstil des Nutzers
- Will **belegte** Aussagen (messen, nicht behaupten) und **ehrliche** Einordnung
  („behoben" vs. „gemildert", eigene Fehler benennen).
- Bei Anleitungen: **idiotensicher, Schritt für Schritt**, mit exakten Copy-&-Paste-Befehlen und
  „was du sehen solltest". Er nutzt knappe Bestätigungen (z.B. „1 = ja").
- **Globale Nutzer-Vorgabe** (aus der CLAUDE.md): *„ja bitte mit seeder! wir haben einen neuen
  seeder."* → wenn du Laravel-/DB-Code generierst, **mit Seeder**.
- Live-Tests laufen bei **ihm** (API-Keys nur in seiner Shell). Du gibst die Anleitung; das
  `!`-Präfix in der CLI nur für **read-only**-Kommandos vorschlagen. Keys nie in den Chat holen.

## 4. Doku-Navigation & Fallstricke
- **Autoritativ ist der neue Stand:** `docs/handover/2026-07-30_…md` +
  `docs/leaven-cli/*` + `docs/readme_handover.md`. Ältere `*.handover_*.md` sind **historisch**.
- **Zahlen sind Momentaufnahmen:** Test-Zählungen (109/36/…) und Zeilennummern in der Doku driften,
  sobald Code dazukommt. Im Zweifel dem **Code** trauen, nicht der Zahl.
- `.env` = nur Platzhalter; echte Keys in `~/.zshrc`. `. ./.env` beim Testen zerschiesst den Key.

## 5. Für Anthropic-Streaming (Phase 2)
Es gibt eine gebündelte **`claude-api`-Skill** — nutze sie für Anthropic-Spezifika, statt zu raten:
Event-Modell (`message_start`/`content_block_delta`/…), `thinking`-Blöcke im Stream,
`stop_reason:'refusal'` (Fable), server-side `fallbacks`, `budget_tokens` ist bei 4.8/5 **400**.
Das OpenAI-Streaming (`openaiStream.ts`) hilft NICHT direkt — Anthropic braucht einen eigenen
Stream-Parser. Fundament (Live-Reasoning-Anzeige, der „vollständige Message oder werfen"-Vertrag)
lässt sich aber übernehmen.

## 6. Dogfooding-Kontext
Der Nutzer **benutzt** diese CLI an seinem echten Projekt `~/mykispace/julalo-platform`
(Laravel; `editor.julalo/`-Prüfskripte; DashScope/Qwen). Deshalb sind die Prüfroutinen
(`php artisan view:clear/cache`, `php -l`, Playwright-Messläufe) und die Befehls-Registry real
motiviert, nicht theoretisch.

## 7. Zwei getrennte Konzepte, die man leicht verwechselt
- **`/thinking`** = *ob das Modell denkt* (an der API). **`/output reasoning`** = *ob wir das
  Denken anzeigen*. Verschiedene Dinge.
- **`redirect`** (cp→copy_file, kein Dialog, Modell bekommt Hinweis) vs. **`allow`** (exakt
  vermerkter Befehl, läuft) vs. **`ok`** (lesende Allowlist). Drei verschiedene Verdicts.
