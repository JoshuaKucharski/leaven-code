// §F — Selbst-Meldung der CLI an das Leaven-Board.
//
// Der Agent darf seinen Bearer-Token NIE sehen: `scrubEnvironment` entfernt
// LEAVEN_BUCKET_TOKEN aus jedem Tool-Subprozess. Der CLI-Node-Prozess SELBST hat
// ihn aber in process.env – deshalb meldet die CLI hier direkt, statt auf
// Prompt-Gehorsam des Modells zu hoffen (das den Token gar nicht erreichen kann).
//
// Kontrakt (siehe docs/CLI_TASK_CONTRACT.md):
//   1. Session-Start            → in_progress je übernommenem Feature
//   2. je Arbeitsschritt        → erneut in_progress mit note „Schritt n/m: …"
//   3. echter Turn-Abschluss    → done je Feature (der Agent hat die Aufgabe erledigt).
//      Ein Mensch kann später approved/not-approved setzen und zurück auf in_progress.
//   4. Budget-/Schrittlimit-    → NICHTS (Aufgabe nicht fertig; bleibt in_progress)
//      Stopp bzw. Fehler/Abbruch   kein blocked-Automatismus
//
// Alles ist Best-Effort: Ein fehlgeschlagener Report darf die eigentliche
// Aufgabe niemals stören. Fehler werden geschluckt und nur als Info gemeldet.

import axios from 'axios';

const HOST_DEFAULT = 'http://localhost';

const slug = (): string => (process.env.LEAVEN_BUCKET_SLUG ?? '').trim();
const token = (): string => (process.env.LEAVEN_BUCKET_TOKEN ?? '').trim();
const host = (): string => ((process.env.LEAVEN_BOARD_URL ?? HOST_DEFAULT).trim() || HOST_DEFAULT).replace(/\/+$/, '');

/** Ohne Slug UND Token gibt es keinen Kanal – dann bleibt die CLI komplett still. */
export function boardAktiv(): boolean {
  return slug().length > 0 && token().length > 0;
}

export interface MeldeErgebnis {
  aktiv: boolean;      // war überhaupt ein Board-Kanal konfiguriert?
  gemeldet: number;    // wie viele Features erfolgreich gemeldet wurden
  fehler?: string;     // Kurzgrund, falls nichts gemeldet werden konnte
}

// Die übernommenen Feature-Slugs werden einmal ermittelt und gecacht – ein Bucket
// wechselt seine Karten während einer Session nicht, und wir wollen kein GET je Schritt.
let featureCache: string[] | null = null;

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { Authorization: `Bearer ${token()}`, Accept: 'application/json', ...extra };
}

/**
 * „Übernommene" Features = Feature-Terms mit TaskCard, die einen Tier haben und
 * noch nicht done sind. Ohne Tier lehnt die API in_progress ohnehin ab
 * (tier_unassigned) – genau die filtern wir hier vorab weg.
 */
async function ermittleFeatures(): Promise<string[]> {
  if (featureCache !== null) return featureCache;

  try {
    const res = await axios.get(`${host()}/api/v1/buckets/${encodeURIComponent(slug())}`, {
      timeout: 8000,
      headers: authHeaders(),
      validateStatus: (s: number) => s >= 200 && s < 300,
    });

    const terms: any[] = Array.isArray(res.data?.terms) ? res.data.terms : [];
    const slugs: string[] = terms
      .filter((t) => t && t.task && t.task.tier !== null && t.task.tier !== undefined && t.task.status !== 'done')
      .map((t) => String(t.slug || '').trim())
      .filter((s) => s.length > 0);
    featureCache = slugs;
    return slugs;
  } catch {
    // GET fehlgeschlagen (Netz/Token/Host): nicht cachen, damit ein späterer
    // Versuch es erneut probiert. Diese Runde meldet dann nichts.
    return [];
  }
}

async function melde(status: 'in_progress' | 'done', note?: string): Promise<MeldeErgebnis> {
  if (!boardAktiv()) return { aktiv: false, gemeldet: 0 };

  const features = await ermittleFeatures();
  if (features.length === 0) {
    return { aktiv: true, gemeldet: 0, fehler: 'keine übernommene Karte mit Tier gefunden' };
  }

  const updates = features.map((feature) => ({
    feature,
    status,
    ...(note ? { note } : {}),
  }));

  try {
    const res = await axios.post(
      `${host()}/api/v1/buckets/${encodeURIComponent(slug())}/tasks`,
      { updates },
      {
        timeout: 8000,
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        validateStatus: (s: number) => s >= 200 && s < 300,
      },
    );

    const results: any[] = Array.isArray(res.data?.results) ? res.data.results : [];
    const ok = results.filter((r) => r && r.status === 'ok').length;
    if (ok === 0) {
      const grund = results.find((r) => r && r.status && r.status !== 'ok')?.status;
      return { aktiv: true, gemeldet: 0, fehler: grund ? String(grund) : 'keine Karte akzeptiert' };
    }
    return { aktiv: true, gemeldet: ok };
  } catch (error: any) {
    const code = error?.response?.status;
    return { aktiv: true, gemeldet: 0, fehler: code ? `HTTP ${code}` : 'Board nicht erreichbar' };
  }
}

/** §F.1 – einmal je Session: Arbeit hat begonnen → in_progress. */
export async function meldeArbeitBegonnen(note = 'Arbeit gestartet'): Promise<MeldeErgebnis> {
  return melde('in_progress', note);
}

/** §F.2 – je Arbeitsschritt: erneut in_progress mit Fortschritts-note. */
export async function meldeFortschritt(note: string): Promise<MeldeErgebnis> {
  return melde('in_progress', note);
}

/** §F.3 – einmal am Ende: Der Agent hat die Aufgabe abgeschlossen → done.
 *  Wird NUR beim echten Turn-Abschluss ('fertig') aus den unbeaufsichtigten Flows
 *  (Launcher-Auftrag, Session-Resume) gerufen – nicht bei Schrittlimit-Stopp, nicht
 *  bei Budget-Stopp, nicht bei Fehler/Abbruch. Ein Mensch kann später approved/
 *  not-approved setzen und die Karte zurück auf in_progress schicken. */
export async function meldeAbgeschlossen(note = 'Aufgabe abgeschlossen'): Promise<MeldeErgebnis> {
  return melde('done', note);
}
