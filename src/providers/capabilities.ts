// Provider-Fähigkeiten: die EINE Wahrheit dafür, was ein Modell kann. Steuert sowohl den
// API-Adapter als auch die Anzeige (Leiste, /help, welche Befehle gelten). Bewusst ohne
// Abhängigkeiten – reine Daten und Zuordnung.

export type ProviderId = 'deepseek' | 'anthropic' | 'qwen';

export interface Capabilities {
  provider: ProviderId;
  apiKeyEnv: string;            // Umgebungsvariable für den API-Schlüssel
  temperature: boolean;        // ist /temperature anwendbar?
  effortLevels: string[];      // Stufen für /effort
  thinkingToggle: boolean;     // lässt sich Thinking an/aus schalten?
  thinkingAlwaysOn: boolean;   // Thinking immer an (Fable)?
  streaming: boolean;          // SSE-Streaming (OpenAI-kompatible Provider)?
  stripReasoningOnSend: boolean; // reasoning_content beim Senden entfernen (Sicherheitsventil, nur falls Provider es ablehnt)
}

// Provider am Modellnamen erkennen: claude-* = Anthropic, qwen* = Qwen (DashScope),
// alles andere = DeepSeek.
export function providerFor(model: string): ProviderId {
  if (model.startsWith('claude-')) return 'anthropic';
  if (model.startsWith('qwen')) return 'qwen';
  return 'deepseek';
}

const ANTHROPIC_EFFORT = ['low', 'medium', 'high', 'xhigh', 'max'];
const DEEPSEEK_EFFORT = ['high', 'max'];

export function capabilitiesFor(model: string): Capabilities {
  if (providerFor(model) === 'qwen') {
    return {
      provider: 'qwen',
      apiKeyEnv: 'QWEN_API_KEY',
      temperature: true,           // OpenAI-kompatibel – temperature erlaubt
      effortLevels: [],            // Qwen kennt kein reasoning_effort
      thinkingToggle: true,        // mit Streaming ist Deep-Thinking (enable_thinking) verfügbar
      thinkingAlwaysOn: false,
      streaming: true,
      stripReasoningOnSend: false, // DashScope ignoriert reasoning_content in der History; falls doch 400 -> auf true
    };
  }
  if (providerFor(model) === 'anthropic') {
    const istFable = model === 'claude-fable-5';
    return {
      provider: 'anthropic',
      apiKeyEnv: 'ANTHROPIC_API_KEY',
      temperature: false,          // Anthropic lehnt temperature mit HTTP 400 ab
      effortLevels: ANTHROPIC_EFFORT,
      thinkingToggle: !istFable,   // Fable: Thinking immer an, nicht abschaltbar
      thinkingAlwaysOn: istFable,
      streaming: false,            // Anthropic hat ein anderes Event-Modell -> Phase 2
      stripReasoningOnSend: false,
    };
  }
  return {
    provider: 'deepseek',
    apiKeyEnv: 'DEEPSEEK_API_KEY',
    temperature: true,
    effortLevels: DEEPSEEK_EFFORT,
    thinkingToggle: true,
    thinkingAlwaysOn: false,
    streaming: true,
    stripReasoningOnSend: false,
  };
}

// Liste für /model – DeepSeek zuerst (Standard), dann Claude, dann Qwen.
export const ALLE_MODELLE = [
  'deepseek-v4-pro',
  'deepseek-v4-flash',
  'claude-opus-5',
  'claude-opus-4-8',
  'claude-fable-5',
  'qwen3.7-max',
];

// Kurznamen: "/model opus" wählt das jeweils neueste/Standard-Modell des Anbieters.
// (Neueste ID pro Anbieter – wird hier gepflegt, sobald ein neueres Modell dazukommt.)
export const MODELL_ALIASE: Record<string, string> = {
  deepseek: 'deepseek-v4-pro',
  opus: 'claude-opus-5',       // neuestes Opus IN UNSERER LISTE
  fable: 'claude-fable-5',
  claude: 'claude-opus-5',     // "claude" -> Opus als Standard (neueste Version)
  qwen: 'qwen3.7-max',
};

/** Löst einen Kurznamen (opus, qwen, …) zum vollen Modellnamen auf; sonst unverändert. */
export function aufloesenModell(eingabe: string): string {
  return MODELL_ALIASE[eingabe.toLowerCase().trim()] || eingabe;
}
