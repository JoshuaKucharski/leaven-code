import { parseDeepSeekToolCalls, stripDeepSeekToolCalls } from './utils/xmlParser.js';

const MAX_HISTORY_MESSAGES = 60;

let callCounter = 0;

// ============================================
// Tool-Calls normalisieren (JSON + XML-Fallback)
// ============================================
export function extractToolCalls(message: any): any[] {
  let calls: any[] = Array.isArray(message.tool_calls) ? message.tool_calls : [];

  if (calls.length === 0 && typeof message.content === 'string') {
    const parsed = parseDeepSeekToolCalls(message.content);
    if (parsed && parsed.length > 0) {
      calls = parsed;
      message.content = stripDeepSeekToolCalls(message.content);
      // Entscheidend: Die Assistant-Nachricht muss die tool_calls auch tragen.
      // Sonst folgen in der History role:"tool"-Nachrichten auf eine Nachricht
      // ohne tool_calls – die API antwortet darauf mit HTTP 400.
      message.tool_calls = calls;
    }
  }

  for (const call of calls) {
    if (!call.id) call.id = `call_${Date.now()}_${callCounter++}`;
    if (!call.type) call.type = 'function';
  }
  return calls;
}

// ============================================
// History-Pflege
// ============================================
/**
 * Stellt das Invariant der OpenAI-kompatiblen API wieder her: Zu jeder tool_call-id
 * muss genau eine role:"tool"-Nachricht existieren. Wird ein Turn mittendrin
 * abgebrochen (Netzwerkfehler, Ctrl-C), fehlen diese Antworten und JEDER weitere
 * Request der Session scheitert mit HTTP 400. Diese Reparatur füllt die Lücken.
 */
export function repairHistory(messages: any[]): void {
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    if (message.role !== 'assistant' || !Array.isArray(message.tool_calls) || message.tool_calls.length === 0) {
      continue;
    }

    const answered = new Set<string>();
    let insertAt = i + 1;
    while (insertAt < messages.length && messages[insertAt].role === 'tool') {
      answered.add(messages[insertAt].tool_call_id);
      insertAt++;
    }

    const missing = message.tool_calls.filter((call: any) => !answered.has(call.id));
    if (missing.length > 0) {
      const fillers = missing.map((call: any) => ({
        role: 'tool',
        tool_call_id: call.id,
        content: '⚠️ Dieser Tool-Aufruf wurde nicht ausgeführt (Turn abgebrochen).'
      }));
      messages.splice(insertAt, 0, ...fillers);
    }
  }
}

/** Kürzt die History an einer user-Grenze, damit tool_call/tool-Paare intakt bleiben. */
export function trimHistory(messages: any[]): void {
  if (messages.length <= MAX_HISTORY_MESSAGES) return;

  let cut = messages.length - MAX_HISTORY_MESSAGES;
  while (cut < messages.length && messages[cut].role !== 'user') cut++;
  if (cut >= messages.length || cut <= 1) return;

  messages.splice(1, cut - 1);
}
