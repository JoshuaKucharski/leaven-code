# Arbeitsplan und Fortschrittsbalken

**Stand:** 2026-07-21
**Umgesetzt in:** `update_plan`, `planBalken()`, `planListe()` in `src/index.ts`

Bei mehrstufigen Aufgaben gliedert das Modell die Arbeit in Schritte und hält den Stand
fest. Die CLI zeigt daraus einen Balken und die Liste.

```
▰▰▰▱▱▱  3/6 Schritten
  ✓ Verzeichnis herz-rein anlegen
  ✓ index.html mit Kopf-, Haupt- und Fussbereich erstellen
  ✓ css/style.css erstellen
  ▸ js/main.js mit Menü-Umschalter erstellen
    Platzhalterbild als SVG unter img/ ablegen
    README.md mit Beschreibung erstellen
```

Der Plan erscheint nach jeder Aktualisierung und noch einmal direkt über dem
Eingaberahmen — beim Tippen sieht man also, was offen ist.

## Zustände

| Zeichen | Status | Bedeutung |
|---|---|---|
| (nichts) | `offen` | noch nicht begonnen |
| `▸` | `laeuft` | wird gerade bearbeitet |
| `✓` | `erledigt` | fertig |
| `⊘` | `entfaellt` | hat sich erübrigt |

**`entfaellt` ist der wichtigste der vier.** Ohne ihn bleibt der Balken hängen, sobald sich
unterwegs herausstellt, dass ein Schritt gar nicht nötig war — etwa weil eine Datei schon
existierte. Sowohl `erledigt` als auch `entfaellt` zählen als abgeschlossen.

Verifiziert: Ein Plan mit vier Schritten, von denen einer entfiel, erreichte 4/4.

## Wann ein Plan entsteht

Der Systemprompt weist an: **ab etwa drei Schritten**, bei einfachen Fragen nicht. Das ist
Absicht — ein Planungs-Vorspann bei „wie viele Zeilen hat die Datei?" kostet bei jedem
Aufruf Zeit und Geld.

Gemessen: Eine Aufgabe mit zwei Dateien erzeugte keinen Plan, eine mit sechs Punkten
erzeugte einen.

`update_plan` läuft immer ohne Rückfrage — es liest nichts, schreibt nichts und verlässt
den Prozess nicht.

## Befehle

| Befehl | Wirkung |
|---|---|
| `/plan` | aktuellen Plan anzeigen |
| `/plan clear` | Plan löschen |

`/clear` und ein Rollenwechsel mit Modellwechsel löschen den Plan mit — ohne
Gesprächsverlauf ergibt er keinen Sinn mehr.

## Warum kein Prozentwert

Bewusst `3/6 Schritten` statt `50,0 %`. Zwei Gründe:

**Der Nenner ist geraten.** Das Modell weiss zu Beginn nicht, wie viele Schritte es
braucht. Ergänzt es unterwegs welche, wächst der Nenner — bei einer Prozentanzeige
springt der Wert dann zurück (70 % → 40 %). Bei `3/6 → 3/9` ist sofort erkennbar, dass der
Plan gewachsen ist, statt dass Fortschritt verloren scheint.

**„Erledigt" ist eine Selbstauskunft.** Nur das Modell kann melden, dass ein Schritt fertig
ist — die CLI kann aus `edit_file X` nicht ableiten, welcher Schritt damit abgeschlossen
wäre. Modelle sind dabei eher optimistisch. Eine Zahl wie „87,5 %" behauptet eine
Messgenauigkeit, die hier nicht existiert.

**Der Balken zeigt den geplanten Fortschritt, nicht den tatsächlichen.** Er ersetzt nicht,
den Abschlussbericht zu lesen.

## Grenzen

- Ein Schritt kann als `erledigt` gemeldet werden, obwohl das Ergebnis fehlerhaft ist.
- Der Plan wird nicht gegen die tatsächlich ausgeführten Werkzeugaufrufe geprüft. Eine
  Gegenprüfung („behauptet erledigt, aber keine Datei geschrieben") wäre möglich, ist aber
  nicht gebaut.
- Bei mehr als 24 Schritten wird der Balken auf 24 Segmente gestaucht; der Zähler bleibt
  exakt.
