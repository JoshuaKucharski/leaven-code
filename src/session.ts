// Konversations-Persistenz für „weiter": Wird der Agent per Auto-Stopp (Tagesbudget)
// mitten in einer Aufgabe angehalten, speichert die CLI den vollständigen Zustand nach
// ~/.leaven/session.json. Am nächsten Tag setzt "weiter" genau dort fort.
//
// Reine Struktur + Validierung – Datei-I/O liegt in index.ts.

export interface SessionDaten {
  datum: string;      // Tag der Unterbrechung (YYYY-MM-DD)
  label: string;      // erste Nutzer-Aufgabe, gekürzt – nur für die Anzeige
  model: string;      // MUSS beim Fortsetzen wiederhergestellt werden (Format-Invariante)
  thinking: boolean;
  effort: string;
  messages: any[];    // komplette History inkl. _providerRaw/reasoning_content
  plan: any[];        // update_plan-Zustand
}

/** Ist ein geladenes Objekt eine brauchbare Session? Streng: fehlt z.B. `thinking`, würde ein
 *  DeepSeek-Request `thinking:{type:'disabled'}` bei reasoning_content-History senden → 400. */
export function sessionGueltig(obj: any): obj is SessionDaten {
  return !!obj
    && typeof obj === 'object'
    && typeof obj.model === 'string' && obj.model.length > 0
    && typeof obj.thinking === 'boolean'
    && typeof obj.effort === 'string'
    && typeof obj.label === 'string'
    && Array.isArray(obj.messages) && obj.messages.length > 0
    && Array.isArray(obj.plan);
}
