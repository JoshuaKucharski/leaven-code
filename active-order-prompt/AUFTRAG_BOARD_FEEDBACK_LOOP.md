# AUFTRAG — BOARD-KREISLAUF REPARIEREN & FORTSCHRITT SICHTBAR MACHEN (MVP)

Du arbeitest an der bestehenden Leaven-App (früher SourDough; Laravel 12, Livewire 3,
produktive MySQL-DB). Der Agent-Launcher startet inzwischen die hauseigene CLI `leaven`.
Dieser Auftrag ist diagnose-geführt und entscheidungsklar: Folge ihm exakt, erfinde
nichts dazu, keine Rückfragen.

## A. SPARSAMKEITS- UND LESE-REGELN (verbindlich)

1. KEIN Multi-Agent-Review, KEINE Subagenten, KEIN erhöhtes Thinking.
2. Lese-Whitelist (nur diese, bei abweichenden Pfaden das Naheliegende): Task-API-
   Controller/Action (POST /api/v1/buckets/{slug}/tasks), TaskCard-Model, Board-
   Livewire-Komponente + Blade-View, LaunchCommandBuilder (NUR die Token-Export-Zeilen),
   Provisionierungs-Stelle, die `.leaven/INITIAL_PROMPT.md` schreibt, EIN bestehender
   Task-API-Test als Vorlage.
3. VERBOTEN: docs/ lesen/schreiben (Ausnahme: eine CHANGELOG-Zeile), CLI-Quellcode
   lesen (Ausnahme: Abschnitt F, nur falls das CLI-Repo im Zugriff liegt), fremde
   Modul-Tests, Verzeichnis-Rundflüge.
4. Tests: KEINE neuen Testdateien außer den GENAU ZWEI Regressionstests aus §G;
   brechende bestehende Tests minimal anpassen. Während der Arbeit nur
   `php artisan test --filter=...`; volle Suite GENAU EINMAL am Ende.
   `vendor/bin/pint --dirty --test`.
5. Keine Migrationen erwartet — `task_cards.status_note` existiert bereits (verifiziere
   per Schema-Blick; NUR falls es wider Erwarten fehlt: eine additive Migration).
6. Report max. 12 Zeilen. Commit: `fix(board): task feedback loop & progress notes`.

## B. SYSTEMKONTEXT (gegeben — nicht neu erforschen)

So ist der Kreislauf GEBAUT und getestet: Agent meldet per
`POST /api/v1/buckets/{slug}/tasks` (Bearer-Token, write_enabled-Pflicht) →
Übergänge open→in_progress→done|blocked; wiederholtes in_progress ist idempotent und
aktualisiert NUR last_heartbeat_at (bewusst kein Event-Spam); done bleibt unbestätigt
(amber) bis zum Admin-Klick; das Board pollt via wire:poll alle ~10 s; das Session-Ende
setzt verwaiste in_progress-Karten auf open zurück.
**Daraus folgt:** Eine Karte, die auf open verharrt, ist KEIN View-Fehler — es kommen
keine (gültigen) Meldungen an. Erst Diagnose (§C), dann Fix (§D), dann Sichtbarkeit (§E).
**Verfassungsregel (unverhandelbar):** KEIN automatisches done aus Schrittzählung,
Exit-Codes oder Testläufen — done ist immer eine explizite Meldung, bestätigt wird vom
Menschen. Die „Schritte"-Anzeige ist reine Sichtbarkeit (§E), keine Abschluss-Logik.

## C. PHASE 0 — DIAGNOSE (fünf Minuten, Befunde in den Report)

1. Kamen Meldungen an? 
   `mysql -u root <dbname> -e "SELECT tc.status, tc.status_note, tc.last_heartbeat_at, e.to_status, e.actor_label, e.created_at FROM task_cards tc LEFT JOIN task_card_events e ON e.task_card_id=tc.id ORDER BY e.created_at DESC LIMIT 10;"`
2. Token-Export vs. Auftragstext: Welchen Env-Variablennamen exportiert der
   LaunchCommandBuilder aktuell (grep nach `export`), und welchen Namen verwenden die
   curl-Zeilen im tatsächlich genutzten Auftragstext des Test-Workdirs
   (`cat <workdir>/.leaven/INITIAL_PROMPT.md` und ggf. `<workdir>/AUFTRAG.md`)?
   Stimmen sie NICHT überein → Befund D1.
3. 401/403-Spuren: `grep -i "buckets/.*/tasks" storage/logs/laravel.log | tail -20`
   bzw. Rate-/Auth-Fehler; zusätzlich prüfen: `write_enabled` des betroffenen Buckets.
4. Enthält der tatsächlich genutzte Auftragstext überhaupt eine Meldepflicht
   (in_progress/done-curls)? Fehlt sie → Befund D2.

## D. FIXES NACH BEFUND (nur zutreffende Zweige umsetzen)

**D1 — Variablen-Mismatch (wahrscheinlichster Fall):** Der Builder exportiert den
Bucket-Token künftig unter BEIDEN Namen auf denselben Wert (Alias-Export, eine Zeile):
`LEAVEN_BUCKET_TOKEN` und `LEAVEN_BUCKET_TOKEN`. Zusätzlich NEU exportieren:
`LEAVEN_BUCKET_SLUG=<slug des Profil-Buckets>` (Grundlage für §F). Bestehende
Builder-Snapshot-Tests entsprechend anpassen.

**D2 — Meldepflicht fehlt im gelieferten Prompt:** Die Provisionierung hängt beim
Schreiben von `.leaven/INITIAL_PROMPT.md` automatisch diese Fußzeile an (Slug konkret
einsetzen; Wortlaut übernehmen):

```
--- MELDEPFLICHT (automatisch angehängt) ---
Dein Bucket-Token liegt in $LEAVEN_BUCKET_TOKEN (identisch: $LEAVEN_BUCKET_TOKEN).
VOR Arbeitsbeginn melde in_progress, WÄHREND der Arbeit alle paar Minuten erneut
in_progress mit note "Schritt n/m: <kurz>", NACH Abschluss done mit kurzer note:
curl -s -X POST https://leaven.test/api/v1/buckets/{SLUG}/tasks -H "Authorization: Bearer $LEAVEN_BUCKET_TOKEN" -H "Content-Type: application/json" -d '{"updates":[{"feature":"<feature-slug>","status":"in_progress","note":"Schritt 1/4: Start"}]}'
Die Feature-Slugs stehen im Bucket (GET .../buckets/{SLUG}, task-Block). done NIE bei
Fehlern melden — bei Abbruch einfach nichts (das System räumt selbst auf).
```

(Host ggf. an die real verlinkte Domain anpassen — aus bestehender Doku/Config ablesen,
nicht raten.) Fußzeile idempotent: bei erneutem Provisionieren ersetzen, nicht stapeln.

**D3 — write_enabled aus / sonstiger Befund:** Schalter dokumentieren bzw. den in §C
gefundenen konkreten Fehler minimal beheben; nichts darüber hinaus.

## E. FORTSCHRITT SICHTBAR MACHEN (kleiner, systemkonformer Ausbau)

**E1 — API:** Beim idempotenten wiederholten `in_progress` wird eine mitgesendete
`note` künftig in `task_cards.status_note` übernommen (Heartbeat wie bisher, WEITERHIN
kein Event — die Event-Historie bleibt Statuswechseln vorbehalten). Echte Übergänge
(open→in_progress, →done, →blocked) verhalten sich exakt wie bisher.

**E2 — Board-Karte:** Unter dem Feature-Namen rendert die Karte ab jetzt die
`status_note` (auf ~80 Zeichen gekürzt, voller Text im title-Attribut) plus eine kleine
Zeitangabe „zuletzt gemeldet vor X min" aus last_heartbeat_at. Gilt für in_progress UND
done (amber) — so sieht der Mensch bei der Abnahme die Abschluss-Note. KEIN neues
Polling einführen (wire:poll existiert), KEINE Websockets.

**E3 — Optionaler Mini-Bonus (NUR wenn ≤ 30 Zeilen inkl. Test-Anpassung):** Beginnt die
note mit dem Muster `n/m` (z. B. „3/7: …"), zeige zusätzlich ein schlichtes Badge
„3/7" auf der Karte. Kein Fortschrittsbalken, keine Prozentrechnung, kein Schema.

## F. CLI-KONTRAKT (deterministische Dauerlösung — Umfang je nach Zugriff)

Die robusteste Zukunft: Die leaven-CLI meldet SELBST, statt auf Prompt-Gehorsam zu
hoffen. Der Kontrakt (Env-Variablen liefert der Launcher ab D1):
1. Bei Session-Start: `in_progress` je übernommenem Feature.
2. Periodisch (alle 3–5 Min bzw. je Arbeitsschritt): erneut `in_progress` mit
   note „Schritt n/m: <kurz>".
3. Bei erfolgreichem Abschluss: `done` mit kurzer note. Bei Fehler/Abbruch: NICHTS
   melden (kein done, kein blocked-Automatismus).
Alle Calls: `POST https://<host>/api/v1/buckets/$LEAVEN_BUCKET_SLUG/tasks`,
Bearer `$LEAVEN_BUCKET_TOKEN`.
— Liegt das CLI-Repo in deinem Zugriff: implementiere GENAU diese drei Punkte dort,
minimal. Liegt es NICHT im Zugriff: lege den Kontrakt wortgleich als Datei
`docs/CLI_TASK_CONTRACT.md` ins App-Repo (einzige erlaubte Doku-Datei) und erwähne im
Report, dass er in einer CLI-Session umzusetzen ist.

## G. VERIFIKATION — genau zwei Tests + ein Live-Durchlauf

Tests (die einzigen neuen): (1) Wiederholtes in_progress MIT note aktualisiert
status_note + Heartbeat und erzeugt KEIN Event (die gehärtete Idempotenz darf nicht
still brechen). (2) Board-View rendert status_note einer in_progress-Karte.
Live: Bestehendes Profil starten → Board: Karte springt ≤ 10 s nach Start auf
in_progress; Fortschritts-note erscheint nach Meldung; nach Abschluss amber done mit
note; „Bestätigen" → grün; Dashboard-Kennzahl zählt. Ergebnis in 3 Zeilen im Report.

## H. AUSDRÜCKLICH NICHT

Kein Auto-done aus Schritten/Exit-Codes, keine Websockets/Echo/Reverb, kein
Schritt-Schema oder Balken-Rendering über E3 hinaus, kein Reopen über die API, keine
Umbenennungen von Env-Variablen (nur der Alias-Doppel-Export aus D1), keine Änderungen
an Buckets/Expand/Import, keine neuen Pakete, keine Doku außer CHANGELOG-Zeile und
ggf. docs/CLI_TASK_CONTRACT.md.

## I. ABSCHLUSS

Volle Suite einmal grün, pint --dirty --test, Commit, Report (max. 12 Zeilen):
§C-Befunde (1–4), umgesetzte Zweige (D1/D2/D3), E-Umfang inkl. ob E3, F-Weg
(implementiert vs. Kontrakt-Datei), Live-Ergebnis. Ende.
