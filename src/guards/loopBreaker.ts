export interface ToolCall {
  name: string;
  arguments: any;
  id?: string;
}

export interface LoopBreakerConfig {
  consecutiveThreshold?: number;
  structuralDetection?: boolean;
  cycleReps?: number;
  cycleMaxPeriod?: number;
  readOnlyCycleExempt?: boolean;
  maxToolCalls?: number;
  maxEstimatedTokens?: number;
  ignoreTools?: string[];
}

const READ_ONLY_TOOLS = [
  'Read', 'read_file', 'list_files', 'grep', 'ls', 'find', 'git status', 'git diff'
];

export class LoopBreaker {
  private history: ToolCall[] = [];
  private signatures: string[] = [];
  private lastKey: string | null = null;
  private consecutiveCount = 0;
  private totalCalls = 0;
  private estimatedTokens = 0;
  private config: Required<LoopBreakerConfig>;

  constructor(config: LoopBreakerConfig = {}) {
    this.config = {
      consecutiveThreshold: config.consecutiveThreshold ?? 5,
      structuralDetection: config.structuralDetection ?? true,
      cycleReps: config.cycleReps ?? 4,
      cycleMaxPeriod: config.cycleMaxPeriod ?? 6,
      readOnlyCycleExempt: config.readOnlyCycleExempt ?? true,
      maxToolCalls: config.maxToolCalls ?? 0,
      maxEstimatedTokens: config.maxEstimatedTokens ?? 0,
      ignoreTools: config.ignoreTools ?? [],
    };
  }

  check(toolCall: ToolCall): { blocked: boolean; reason?: string } {
    if (this.config.ignoreTools.includes(toolCall.name)) {
      return { blocked: false };
    }

    if (this.config.maxToolCalls > 0 && this.totalCalls >= this.config.maxToolCalls) {
      return {
        blocked: true,
        reason: `💥 Budget-Backstop: ${this.totalCalls} Tool-Calls erreicht (Limit: ${this.config.maxToolCalls})`,
      };
    }

    if (this.config.maxEstimatedTokens > 0 && this.estimatedTokens >= this.config.maxEstimatedTokens) {
      return {
        blocked: true,
        reason: `💥 Token-Backstop: ~${this.estimatedTokens} Tokens erreicht (Limit: ${this.config.maxEstimatedTokens})`,
      };
    }

    const key = this.getCallKey(toolCall);

    // Echt konsekutiv: Sobald ein anderer Aufruf dazwischenkommt, beginnt die
    // Zählung neu. Ein kumulativer Zähler würde denselben read_file irgendwann
    // auch dann blockieren, wenn er über die Session verteilt legitim vorkommt.
    if (key === this.lastKey) {
      this.consecutiveCount++;
    } else {
      this.lastKey = key;
      this.consecutiveCount = 1;
    }

    if (this.consecutiveCount >= this.config.consecutiveThreshold) {
      return {
        blocked: true,
        reason: `🔄 Loop erkannt: ${toolCall.name} wurde ${this.consecutiveCount}x hintereinander mit identischen Argumenten aufgerufen`,
      };
    }

    // Retry-Sturm: gleicher Aufruf immer wieder, aber mit anderen Calls dazwischen.
    // Höhere Schwelle als die konsekutive Prüfung, sonst feuern beide gleichzeitig.
    if (this.config.structuralDetection) {
      const repeats = this.signatures.filter(signature => signature === key).length;
      const threshold = this.config.consecutiveThreshold * 2;
      if (repeats >= threshold) {
        return {
          blocked: true,
          reason: `🔄 Retry-Sturm erkannt: ${toolCall.name} wurde ${repeats + 1}x mit identischen Argumenten aufgerufen`,
        };
      }
    }

    const cycle = this.detectCycle(key);
    if (cycle) {
      return {
        blocked: true,
        reason: `🔄 Zyklus erkannt: ${cycle.join(' → ')} wiederholt sich (${this.config.cycleReps}x)`,
      };
    }

    this.history.push({ ...toolCall });
    this.signatures.push(key);
    this.totalCalls++;
    this.estimatedTokens += Math.ceil(key.length / 4);
    return { blocked: false };
  }

  private getCallKey(call: ToolCall): string {
    return `${call.name}:${this.stableStringify(call.arguments)}`;
  }

  /** Sortiert Objekt-Keys, damit {a,b} und {b,a} dieselbe Signatur ergeben. */
  private stableStringify(value: any): string {
    if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
    if (Array.isArray(value)) return `[${value.map(v => this.stableStringify(v)).join(',')}]`;
    const keys = Object.keys(value).filter(k => !['id', 'timestamp', 'counter', 'retry'].includes(k)).sort();
    return `{${keys.map(k => `${JSON.stringify(k)}:${this.stableStringify(value[k])}`).join(',')}}`;
  }

  /**
   * Sucht ein sich wiederholendes Muster am Ende der Historie – verglichen werden
   * vollständige Signaturen (Name UND Argumente), nicht nur Tool-Namen. Ein
   * Namensvergleich würde z.B. acht write_file-Aufrufe auf acht verschiedene
   * Dateien fälschlich als Zyklus werten.
   */
  private detectCycle(candidateKey: string): string[] | null {
    const sequence = [...this.signatures, candidateKey];
    const names = [...this.history.map(h => h.name), candidateKey.split(':')[0]];

    // Ab Periode 2: Periode 1 wäre exakt derselbe Fall, den bereits die
    // konsekutive Prüfung oben abdeckt.
    for (let period = 2; period <= this.config.cycleMaxPeriod; period++) {
      const needed = period * this.config.cycleReps;
      if (sequence.length < needed) continue;

      const tail = sequence.slice(sequence.length - needed);
      let repeats = true;
      for (let i = period; i < tail.length; i++) {
        if (tail[i] !== tail[i - period]) {
          repeats = false;
          break;
        }
      }
      if (!repeats) continue;

      const cycleNames = names.slice(names.length - needed, names.length - needed + period);
      if (this.config.readOnlyCycleExempt && cycleNames.every(n => READ_ONLY_TOOLS.includes(n))) {
        continue;
      }
      return cycleNames;
    }
    return null;
  }

  reset(): void {
    this.history = [];
    this.signatures = [];
    this.lastKey = null;
    this.consecutiveCount = 0;
    this.totalCalls = 0;
    this.estimatedTokens = 0;
  }

  /** Budget-Backstop zur Laufzeit umschalten. 0 = aus (kein Limit). */
  setMaxToolCalls(n: number): void {
    this.config.maxToolCalls = n > 0 ? Math.floor(n) : 0;
  }

  /** Aktuelles Limit (0 = aus). */
  getMaxToolCalls(): number {
    return this.config.maxToolCalls;
  }

  /** Bisher gezählte (nicht blockierte) Tool-Calls dieser Sitzung. */
  getTotalCalls(): number {
    return this.totalCalls;
  }
}
