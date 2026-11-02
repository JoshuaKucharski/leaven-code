// Tages-Token-Zähler pro ANBIETER (anthropic / qwen / deepseek), persistent in
// ~/.leaven/usage.json. Pro Anbieter, nicht pro Modell: Claude teilt sich eine Quote über
// Opus + Fable; Qwen (DashScope) und DeepSeek sind je eigene Konten.
//
// Reine, testbare Logik – Datei-I/O liegt in index.ts.

export interface UsageDaten {
  datum: string;                       // YYYY-MM-DD des aktuellen Zählstands
  verbrauch: Record<string, number>;   // Anbieter -> heute verbrauchte Tokens
  limits: Record<string, number>;      // Anbieter -> Tageslimit (0/fehlt = kein Limit)
  autoStopp?: boolean;                 // wird die Grenze erzwungen? (persistiert – überlebt Neustart)
  autoWeiter?: boolean;                // beim Start automatisch fortsetzen? (persistiert)
}

export const ANBIETER = ['anthropic', 'qwen', 'deepseek'];

export function leereUsage(datum: string): UsageDaten {
  return { datum, verbrauch: {}, limits: {}, autoStopp: false, autoWeiter: false };
}

/** Setzt den Verbrauch zurück, wenn ein neuer Tag begonnen hat. Limits + Schalter bleiben. */
export function resetWennNeuerTag(d: UsageDaten, heute: string): UsageDaten {
  if (d && d.datum === heute) return d;
  return {
    datum: heute, verbrauch: {},
    limits: (d && d.limits) || {},
    autoStopp: (d && d.autoStopp) || false,
    autoWeiter: (d && d.autoWeiter) || false,
  };
}

export function addVerbrauch(d: UsageDaten, anbieter: string, tokens: number): void {
  const t = Math.max(0, Math.floor(tokens || 0));
  d.verbrauch[anbieter] = (d.verbrauch[anbieter] || 0) + t;
}

/** Ist das Tageslimit erreicht? Nur wenn ein Limit > 0 gesetzt ist. */
export function ueberBudget(d: UsageDaten, anbieter: string): boolean {
  const limit = d.limits[anbieter] || 0;
  return limit > 0 && (d.verbrauch[anbieter] || 0) >= limit;
}

/** Tokens aus einer usage-Struktur summieren.
 *  OpenAI/DeepSeek/Qwen: total_tokens bzw. prompt_tokens+completion_tokens.
 *  Anthropic: input_tokens+output_tokens. */
export function tokenSumme(usage: any): number {
  if (!usage) return 0;
  if (typeof usage.total_tokens === 'number') return usage.total_tokens;
  const ein = usage.prompt_tokens ?? usage.input_tokens ?? 0;
  const aus = usage.completion_tokens ?? usage.output_tokens ?? 0;
  return (ein || 0) + (aus || 0);
}
