// Anthropic-Adapter – über das VORHANDENE axios, KEIN neues Paket. Übersetzt die interne
// (OpenAI/DeepSeek-förmige) History an der API-Grenze in die Anthropic Messages-API und die
// Antwort zurück in dieselbe Form, die die Agent-Schleife schon kennt. Die Rechte-Schicht
// (securePath, Guards, /rights) bleibt unberührt – sie liegt hinter dem Modell.

import axios from 'axios';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const FABLE_BETA = 'server-side-fallback-2026-06-01';
// Thinking-Tokens zählen mit ins max_tokens-Budget. Mit 8192 endete ein langer Denkschritt
// bei Opus/Fable still per stop_reason max_tokens. 16000 ist der empfohlene Wert für
// non-streaming Requests; das Zeitlimit wächst mit (lange Antworten dauern länger).
const MAX_TOKENS = 16000;
const REQUEST_TIMEOUT_MS = 600_000;   // non-streaming; Thinking kann dauern

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export interface AnthropicOpts {
  model: string;
  effort: string;
  thinking: boolean;   // interner Schalter; bei Fable ignoriert (immer an)
  apiKey: string;
}

/** Text aus content ziehen – String oder Block-Array. */
function textOf(content: any): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.filter(b => b?.type === 'text').map(b => b.text).join('');
  return '';
}

/** tool_call.arguments (String oder Objekt) zu einem Objekt normalisieren. */
function parseInput(raw: any): any {
  if (raw && typeof raw === 'object') return raw;
  if (typeof raw === 'string') { try { return JSON.parse(raw); } catch { return {}; } }
  return {};
}

/**
 * Interne History -> Anthropic-Request-Body. Reine Funktion (testbar ohne API).
 * - system-Nachrichten wandern ins eigene `system`-Feld
 * - assistant bevorzugt die exakt gespeicherten Blöcke (_providerRaw) – erhält thinking +
 *   tool_use unverändert, wie es Anthropic für Folge-Requests verlangt
 * - role:'tool' -> tool_result-Blöcke, aufeinanderfolgende in EINE user-Nachricht gebündelt
 * - KEIN temperature/top_p (Anthropic lehnt sie ab); Fable: thinking-Feld weglassen
 */
export function zuAnthropicRequest(messages: any[], tools: any[] | null, opts: AnthropicOpts): any {
  const istFable = opts.model === 'claude-fable-5';

  const systemTexte = messages.filter(m => m.role === 'system').map(m => textOf(m.content)).filter(Boolean);
  const system = systemTexte.join('\n\n');

  const anthroMessages: any[] = [];
  for (const m of messages) {
    if (m.role === 'system') continue;

    if (m.role === 'user') {
      anthroMessages.push({ role: 'user', content: textOf(m.content) });

    } else if (m.role === 'assistant') {
      if (Array.isArray(m._providerRaw)) {
        anthroMessages.push({ role: 'assistant', content: m._providerRaw });
      } else {
        const content: any[] = [];
        if (m.content && String(m.content).trim()) content.push({ type: 'text', text: String(m.content) });
        for (const call of m.tool_calls || []) {
          content.push({ type: 'tool_use', id: call.id, name: call.function?.name, input: parseInput(call.function?.arguments) });
        }
        anthroMessages.push({ role: 'assistant', content });
      }

    } else if (m.role === 'tool') {
      const block = { type: 'tool_result', tool_use_id: m.tool_call_id, content: String(m.content ?? '') };
      const letzte = anthroMessages[anthroMessages.length - 1];
      const istToolResultTurn = letzte && letzte.role === 'user' && Array.isArray(letzte.content)
        && letzte.content.every((b: any) => b.type === 'tool_result');
      if (istToolResultTurn) letzte.content.push(block);
      else anthroMessages.push({ role: 'user', content: [block] });
    }
  }

  // Ohne Thinking akzeptiert die API nur Denktiefen bis "high" (Opus 5: HTTP 400 bei
  // xhigh/max). Die Denktiefe wirkt ohne Thinking ohnehin nicht – also kappen statt scheitern.
  const thinkingAktiv = istFable || opts.thinking;
  const effort = !thinkingAktiv && (opts.effort === 'xhigh' || opts.effort === 'max') ? 'high' : opts.effort;

  const body: any = {
    model: opts.model,
    max_tokens: MAX_TOKENS,
    messages: anthroMessages,
    output_config: { effort },
  };
  if (system) body.system = system;

  // Thinking: Fable immer an -> Feld weglassen. Opus: adaptive (an) bzw. disabled (aus).
  if (!istFable) {
    body.thinking = opts.thinking ? { type: 'adaptive' } : { type: 'disabled' };
  }

  if (tools && tools.length) {
    body.tools = tools.map(t => ({
      name: t.function.name,
      description: t.function.description,
      input_schema: t.function.parameters,
    }));
    body.tool_choice = { type: 'auto' };
  }

  // Fable: server-seitige Fallbacks auf Opus (empfohlen; braucht 30-Tage-Retention).
  if (istFable) body.fallbacks = [{ model: 'claude-opus-4-8' }];

  return body;
}

/**
 * Anthropic-Antwort -> normalisierte Assistant-Nachricht in DeepSeek-Form. Reine Funktion.
 * _providerRaw hält die Original-Blöcke (thinking + tool_use) für den nächsten Request.
 */
export function ausAnthropicResponse(data: any): any {
  const bloecke = Array.isArray(data?.content) ? data.content : [];
  const text = bloecke.filter((b: any) => b?.type === 'text').map((b: any) => b.text).join('');
  const tool_calls = bloecke
    .filter((b: any) => b?.type === 'tool_use')
    .map((b: any) => ({
      id: b.id,
      type: 'function',
      function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) },
    }));

  const message: any = { role: 'assistant', content: text, _providerRaw: bloecke };
  if (tool_calls.length) message.tool_calls = tool_calls;

  // Fable kann mit stop_reason 'refusal' antworten – sauber melden statt Absturz.
  if (data?.stop_reason === 'refusal') {
    message.content = text || '⚠️ Das Modell hat die Anfrage abgelehnt (refusal).';
  }
  return message;
}

/** stop_reason -> finish_reason in DeepSeek-Form: max_tokens heisst dort 'length'. So zeigt
 *  die Agent-Schleife für alle Provider dieselbe Warnung, wenn eine Antwort abgeschnitten ist. */
export function finishReasonAus(data: any): string | null {
  const grund = data?.stop_reason;
  if (!grund) return null;
  return grund === 'max_tokens' ? 'length' : String(grund);
}

/** Ruft die Anthropic Messages-API über axios auf (mit Retry wie im DeepSeek-Pfad).
 *  Gibt { message, usage, finishReason } zurück – usage für die Tages-Token-Zählung,
 *  finishReason 'length', wenn max_tokens die Antwort abgeschnitten hat. */
export async function callAnthropic(messages: any[], tools: any[] | null, opts: AnthropicOpts): Promise<{ message: any; usage: any; finishReason: string | null }> {
  const body = zuAnthropicRequest(messages, tools, opts);
  const headers: any = {
    'x-api-key': opts.apiKey,
    'anthropic-version': ANTHROPIC_VERSION,
    'content-type': 'application/json',
  };
  if (opts.model === 'claude-fable-5') headers['anthropic-beta'] = FABLE_BETA;

  let lastError: any;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await axios.post(ANTHROPIC_URL, body, { headers, timeout: REQUEST_TIMEOUT_MS });
      return { message: ausAnthropicResponse(response.data), usage: response.data?.usage, finishReason: finishReasonAus(response.data) };
    } catch (error: any) {
      lastError = error;
      const status = error.response?.status;
      const retryable = status === 429 || (status >= 500 && status < 600) || error.code === 'ECONNABORTED';
      if (!retryable || attempt === 2) break;
      await sleep(1000 * 2 ** attempt);
    }
  }
  // Anthropic-Fehler tragen die Meldung in error.response.data.error.message – sichtbar machen.
  const detail = lastError?.response?.data?.error?.message;
  if (detail) lastError.message = `Anthropic ${lastError.response?.status}: ${detail}`;
  throw lastError;
}
