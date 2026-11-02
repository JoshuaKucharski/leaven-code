# Den leaven-API-Endpunkt nutzen

**Stand:** 2026-07-21
**Zugehörig:** [internet.md](./internet.md) — dort stehen die Sicherheitsgrundlagen

Praktische Anleitung: Wie richtet man die eigene Webinstanz ein, damit die CLI Daten an
sie senden kann?

---

> **Geplante Erweiterung:** Automatische Fortschrittsmeldungen und ein Rückkanal, über den
> die Plattform die Nachfrage nach 40 Schritten beantwortet, sind in
> [leaven-platform-connect/api-docs.md](./leaven-platform-connect/api-docs.md)
> spezifiziert — dort **noch nicht implementiert**.

## 1. Wofür das gedacht ist

`post_to_endpoint` sendet strukturierte Daten an **genau eine** eigene Instanz. Typische
Anwendungen:

- Arbeitsergebnisse oder Berichte einer Sitzung ablegen
- Ereignisse melden (Aufgabe erledigt, Fehler aufgetreten)
- Ein Dashboard mit dem Stand mehrerer Läufe füttern

**Nicht** dafür gedacht: beliebige APIs ansprechen. Das Ziel ist fest konfiguriert und vom
Modell nicht wählbar — genau das ist der Sicherheitsgewinn.

## 2. Einrichten

### In der CLI

```
/endpoint set https://meine-instanz.example.com/api/leaven
/endpoint show
```

Alternativ als Umgebungsvariable oder in `config/commands.json`:

```bash
export LEAVEN_API_ENDPOINT="https://meine-instanz.example.com/api/leaven"
export LEAVEN_API_TOKEN="ein-langes-zufaelliges-geheimnis"
```

```jsonc
{ "apiEndpoint": "https://meine-instanz.example.com/api/leaven" }
```

Vorrang: `/endpoint set` → `LEAVEN_API_ENDPOINT` → `config/commands.json`.

**Der Token gehört in die Umgebung, nicht in die Konfigurationsdatei** — `config/` liegt
im Projekt und landet sonst leicht in einer Versionsverwaltung.

### Abgelehnte Adressen

| Eingabe | Grund |
|---|---|
| `http://…` | Nur https — über http gingen die Daten unverschlüsselt raus |
| `https://localhost/…` | Interne Adressen sind gesperrt |
| `https://192.168.1.5/…` | dito |
| `kaputt` | Keine gültige URL |

Diese Prüfung läuft **bei jedem Senden**, nicht nur beim Einstellen.

## 3. Was die CLI sendet

```http
POST /api/leaven HTTP/1.1
Host: meine-instanz.example.com
Content-Type: application/json
User-Agent: leaven-cli
Authorization: Bearer <LEAVEN_API_TOKEN>     # nur wenn gesetzt

{ … das payload-Objekt des Modells … }
```

Der Rumpf ist genau das `payload`-Objekt aus dem Werkzeugaufruf. Die CLI ergänzt nichts
und prüft den Inhalt nicht — was das Modell hineinschreibt, geht so raus.

Zeitlimit 20 s. Die Antwort wird auf 100 KB begrenzt und dem Modell (gekürzt auf 2000
Zeichen) zurückgegeben.

## 4. Minimale Gegenstelle

Express:

```js
import express from 'express';

const app = express();
app.use(express.json({ limit: '1mb' }));

const TOKEN = process.env.LEAVEN_API_TOKEN;

app.post('/api/leaven', (req, res) => {
  // 1. Authentifizieren – ohne das kann jeder senden, der die URL kennt
  const kopf = req.get('authorization') || '';
  if (!TOKEN || kopf !== `Bearer ${TOKEN}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  // 2. Inhalt prüfen – der Rumpf stammt aus einem Sprachmodell und ist
  //    keine vertrauenswürdige Eingabe
  const payload = req.body;
  if (typeof payload !== 'object' || payload === null) {
    return res.status(400).json({ error: 'payload muss ein Objekt sein' });
  }

  // 3. Verarbeiten
  console.log('Von leaven-cli:', payload);

  // 4. Antworten – NIEMALS mit 3xx (siehe unten)
  res.status(200).json({ ok: true });
});

app.listen(3000);
```

Laravel:

```php
Route::post('/api/leaven', function (Request $request) {
    if (!hash_equals('Bearer '.config('services.leaven.token'),
                     $request->header('Authorization', ''))) {
        return response()->json(['error' => 'unauthorized'], 401);
    }

    $daten = $request->validate([
        'titel'   => 'required|string|max:200',
        'inhalt'  => 'required|string|max:10000',
    ]);

    // verarbeiten …
    return response()->json(['ok' => true]);
});
```

## 5. Wichtig: Antworte niemals mit einer Weiterleitung

Die CLI folgt **keiner** Weiterleitung und bricht bei 3xx ab:

```
❌ Endpunkt antwortete mit einer Weiterleitung (308). Abgebrochen –
   eine Weiterleitung könnte die Daten an einen anderen Server schicken.
```

Das ist Absicht: HTTP 307 und 308 behalten Methode und Rumpf bei, ein blind folgender
Client würde den Payload an das Weiterleitungsziel liefern.

**Häufige Stolperfalle:** Viele Webserver leiten automatisch um —
`example.com` → `www.example.com`, oder ein fehlender abschliessender Schrägstrich.
Trage deshalb die **endgültige** Adresse ein, auf die nicht mehr weitergeleitet wird.

Zum Prüfen:

```bash
curl -s -o /dev/null -w "%{http_code} -> %{redirect_url}\n" \
  -X POST -H "Content-Type: application/json" -d '{}' \
  https://meine-instanz.example.com/api/leaven
```

Kommt dort ein 3xx mit einer `redirect_url`, trage diese ein.

## 6. Ablauf in der Sitzung

```
/endpoint set https://meine-instanz.example.com/api/leaven
  ✔ Sende-Ziel: https://meine-instanz.example.com/api/leaven
    Nur diese eine Adresse. Das Modell kann kein anderes Ziel wählen,
    und Weiterleitungen werden nicht befolgt.

› Fasse zusammen was du geändert hast und schick es an den Endpunkt.

🔧 Diese Aktionen brauchen deine Freigabe:
[x] post_to_endpoint(payload: {"titel": "…", "dateien": […]})
```

**Senden verlangt immer eine Freigabe** — auch wenn Lesen und Schreiben ohne Rückfrage
laufen. `post_to_endpoint` steht bewusst nicht in der Auto-Freigabe-Tabelle.

## 7. Pflichten auf der Gegenstelle

Der Rumpf stammt aus einem Sprachmodell. Behandle ihn wie jede andere fremde Eingabe:

| Punkt | Warum |
|---|---|
| **Authentifizieren** | Ohne Token kann jeder senden, der die URL kennt |
| **Schema prüfen** | Das Modell kann Felder weglassen, erfinden oder falsch typisieren |
| **Grösse begrenzen** | Ein Payload kann beliebig gross werden |
| **Nicht ungefiltert anzeigen** | Der Inhalt kann HTML oder Skripte enthalten → XSS |
| **Nicht in SQL einsetzen** | Vorbereitete Anweisungen benutzen |
| **Ratenbegrenzung** | Eine Fehlschleife im Agenten kann viele Anfragen erzeugen |

Besonders relevant: Wenn der Agent Netzzugriff hat und eine abgerufene Seite
Anweisungen enthält (Prompt-Injection), kann der Payload beeinflusst sein. Die
Freigabe-Rückfrage ist die Stelle, an der ein Mensch das bemerken kann — die Gegenstelle
sollte sich nicht darauf verlassen.

## 8. Fehlerbilder

| Meldung | Ursache |
|---|---|
| `Kein gültiger Endpunkt konfiguriert: Nicht gesetzt` | `/endpoint set …` fehlt |
| `Nur https ist erlaubt` | `http://` eingetragen |
| `Interne Adressen sind gesperrt` | `localhost` oder private IP |
| `Endpunkt antwortete mit einer Weiterleitung` | Server leitet um → endgültige URL eintragen |
| `Status 401` | Token fehlt oder stimmt nicht (`LEAVEN_API_TOKEN`) |
| Werkzeug wird nicht angeboten | Kein Endpunkt konfiguriert — die CLI blendet es dann aus |
