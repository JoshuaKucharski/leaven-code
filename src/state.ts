// Zentraler Zustand – Werte, die in mehreren Modulen neu zugewiesen werden.
// Objekte, die nur per Feld mutiert werden, bleiben als direkte Exporte in index.ts
// und werden von dort importiert.

export type SchrittStatus = 'offen' | 'laeuft' | 'erledigt' | 'entfaellt';
export interface PlanSchritt { titel: string; status: SchrittStatus; }

export const zustand = {
  plan: [] as PlanSchritt[],
};
