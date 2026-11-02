// Gemeinsamer SSE-Streaming-Client für OpenAI-kompatible Provider (DeepSeek + Qwen).
// KEIN neues Paket – nur das vorhandene axios + Node-Bordmittel (string_decoder).
//
// Vertrag (nicht verhandelbar): liefert eine VOLLSTÄNDIGE Message ODER wirft – nie etwas
// dazwischen. Assemblierung passiert in lokalem State; der Aufrufer pusht erst NACH Erfolg
// in die History. So kann keine halbe Nachricht in die Konversation geraten.
//
// Die zwei Kernfunktionen (parseSseLine, assembleMessage) sind REIN und werden in
// tests/test-stream.js gegen alle Edge-Cases geprüft (Fable-Review).

import axios from 'axios';
import { StringDecoder } from 'string_decoder';

const CONNECT_TIMEOUT_MS = 60_000;
const IDLE_TIMEOUT_MS = 90_000;   // axios-timeout schützt den Stream NICHT – eigener Watchdog

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export interface StreamResult {
  message: any;              // { role, content, reasoning_content?, tool_calls? }
  finishReason: string | null;
  usage?: any;               // { prompt_tokens, completion_tokens, total_tokens } via include_usage
}

// ---------------------------------------------------------------------------
// REIN: SSE-Zeilen puffern (über Chunk-Grenzen hinweg)
// ---------------------------------------------------------------------------
/** Fügt neuen Text an den Buffer, gibt vollständige Zeilen + Rest (unvollständige letzte
 *  Zeile) zurück. Der Rest bleibt für den nächsten Chunk im Buffer. */
export function splitSseBuffer(buffer: string, text: string): { lines: string[]; rest: string } {
  const parts = (buffer + text).split('\n');
  const rest = parts.pop() ?? '';
  return { lines: parts, rest };
}

/** REIN: eine SSE-Zeile deuten. null = ignorieren (leer/Kommentar/keep-alive/kein data). */
export function parseSseLine(line: string): { data?: string; done?: boolean } | null {
  const t = line.replace(/\r$/, '');
  if (t === '' || t.startsWith(':')) return null;      // leer / Kommentar / ": ping"
  if (!t.startsWith('data:')) return null;             // nur data-Zeilen interessieren
  const payload = t.slice(5).replace(/^ /, '');        // "data: X" und "data:X"
  if (payload === '') return null;                     // legale leere data-Zeile: ignorieren
  if (payload === '[DONE]') return { done: true };
  return { data: payload };
}

// ---------------------------------------------------------------------------
// REIN: die gesammelten Chunk-Objekte zur vollständigen Message zusammensetzen
// ---------------------------------------------------------------------------
/** Nimmt die geparsten `data`-JSON-Objekte und baut die Message in DeepSeek/OpenAI-Form.
 *  Wirft bei kaputten Tool-Argumenten (verhindert stillen parseArgs→{}-Fehlgriff). */
export function assembleMessage(chunks: any[]): StreamResult {
  let content = '';
  let reasoning = '';
  let sawReasoning = false;
  let finishReason: string | null = null;
  // Tool-Calls per Index (Map, nicht Array – Löcher/nicht-bei-0-startende Indizes wären fatal)
  const calls = new Map<number, { id?: string; name?: string; args: string }>();
  let maxKey = -1;      // höchster je vergebener Slot – für NEUE id-only-Calls ohne index
  let lastKey = -1;     // ZULETZT angefasster Slot – für index-lose Fortsetzungen

  for (const chunk of chunks) {
    const choice = chunk?.choices?.[0];
    if (!choice) continue;                             // usage-only Chunk (choices:[])
    if (choice.finish_reason) finishReason = choice.finish_reason;
    const delta = choice.delta;
    if (!delta) continue;

    if (typeof delta.content === 'string') content += delta.content;
    // Feld-Phantom vermeiden: leere reasoning-Deltas ('') dürfen sawReasoning NICHT setzen,
    // sonst entsteht reasoning_content:'' und killt den Non-Thinking-Folge-Request (400).
    if (typeof delta.reasoning_content === 'string' && delta.reasoning_content !== '') {
      reasoning += delta.reasoning_content;
      sawReasoning = true;
    }

    if (Array.isArray(delta.tool_calls)) {
      for (const tc of delta.tool_calls) {
        // Index bestimmen: vorhanden → nehmen; fehlt + neue id → neuer Slot (maxKey+1);
        // fehlt ohne id → Fortsetzung des ZULETZT gesehenen Slots (nicht des höchsten!).
        // DashScope liefert manche Calls komplett in einem Delta, teils ohne index.
        let key: number;
        if (typeof tc.index === 'number') key = tc.index;
        else if (tc.id) key = maxKey + 1;
        else key = lastKey < 0 ? 0 : lastKey;
        lastKey = key;
        if (key > maxKey) maxKey = key;

        let slot = calls.get(key);
        if (!slot) { slot = { args: '' }; calls.set(key, slot); }

        // id/name NUR setzen wenn leer, NIE konkatenieren (schützt gegen id:null-Überschreiben
        // und wiederholten name → "read_fileread_file").
        if (tc.id != null && slot.id == null) slot.id = tc.id;
        const fn = tc.function;
        if (fn) {
          if (fn.name != null && slot.name == null) slot.name = fn.name;
          if (fn.arguments != null) slot.args += fn.arguments;   // != null: "" ist legitim
        }
      }
    }
  }

  const message: any = { role: 'assistant', content };
  // Feld NUR anlegen, wenn wirklich Reasoning kam – sonst killt reasoning_content:'' den
  // Non-Thinking-Folge-Request mit HTTP 400.
  if (sawReasoning) message.reasoning_content = reasoning;

  if (calls.size) {
    const alle = [...calls.entries()].sort((a, b) => a[0] - b[0]).map(([, c]) => c);
    // Ein Slot mit Argumenten aber ohne Namen ist ein unvollständiger/fehlgeleiteter Call –
    // NICHT still verwerfen (verletzt den Vertrag), sondern werfen. Nur wirklich leere Slots
    // (kein name, keine args) dürfen lautlos wegfallen.
    for (const c of alle) {
      if (!c.name && c.args.trim()) {
        throw new Error(`Tool-Call im Stream ohne Namen, aber mit Argumenten – unvollständig: ${c.args.slice(0, 80)}`);
      }
    }
    const geordnet = alle.filter(c => c.name);
    const toolCalls: any[] = [];
    for (const c of geordnet) {
      const argStr = c.args && c.args.trim() ? c.args : '{}';
      try { JSON.parse(argStr); }                      // kaputte args → NICHT ausführen
      catch { throw new Error(`Kaputte Tool-Argumente im Stream für ${c.name}: ${argStr.slice(0, 80)}`); }
      toolCalls.push({
        // leere id ergänzt extractToolCalls später; nur setzen, wenn vorhanden
        ...(c.id ? { id: c.id } : {}),
        type: 'function',
        function: { name: c.name, arguments: argStr },
      });
    }
    if (toolCalls.length) message.tool_calls = toolCalls;
  }

  return { message, finishReason };
}

// ---------------------------------------------------------------------------
// Netzwerk: ein Versuch (Konsum KOMPLETT im try, damit Retry greift)
// ---------------------------------------------------------------------------
async function streamOnce(
  url: string, headers: any, body: any, onReasoning?: (d: string) => void,
): Promise<StreamResult> {
  // stream_options.include_usage: liefert am Ende einen Chunk mit den Token-Zahlen
  // (choices:[] + usage). Für die Tages-Budget-Zählung.
  const response = await axios.post(url, { ...body, stream: true, stream_options: { include_usage: true } }, {
    headers, responseType: 'stream', timeout: CONNECT_TIMEOUT_MS,
  });
  const stream = response.data;                        // Node Readable
  const decoder = new StringDecoder('utf8');           // UTF-8-sicher über Chunk-Grenzen
  let buffer = '';
  const chunks: any[] = [];
  let done = false;

  let idleTimer: NodeJS.Timeout;
  const resetIdle = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => stream.destroy(new Error('Stream idle timeout')), IDLE_TIMEOUT_MS);
  };

  try {
    resetIdle();
    for await (const raw of stream) {
      resetIdle();
      const text = decoder.write(raw as Buffer);
      if (!text) continue;
      const split = splitSseBuffer(buffer, text);
      buffer = split.rest;
      for (const line of split.lines) {
        const evt = parseSseLine(line);
        if (!evt) continue;
        if (evt.done) { done = true; continue; }
        let obj: any;
        try { obj = JSON.parse(evt.data!); }
        catch { throw new Error(`Kaputte SSE-Zeile: ${evt.data!.slice(0, 80)}`); }
        chunks.push(obj);
        const rc = obj?.choices?.[0]?.delta?.reasoning_content;
        if (typeof rc === 'string' && rc && onReasoning) onReasoning(rc);
      }
    }
    const tail = buffer + decoder.end();               // letzter Rest ohne \n
    if (tail.trim()) {
      const evt = parseSseLine(tail);
      if (evt?.done) done = true;
      else if (evt?.data) {
        try {
          const obj = JSON.parse(evt.data);
          chunks.push(obj);
          const rc = obj?.choices?.[0]?.delta?.reasoning_content;
          if (typeof rc === 'string' && rc && onReasoning) onReasoning(rc);
        } catch { /* unvollständiger Rest am Stream-Ende */ }
      }
    }
  } finally {
    clearTimeout(idleTimer!);
  }

  const result = assembleMessage(chunks);
  // Abgerissen, kein Erfolg: kein finish_reason UND (nicht [DONE] ODER die Message ist leer).
  // Ein sauber geschlossener Stream ohne jeden Inhalt ist ebenfalls ein Abriss.
  const leer = !result.message.content && !result.message.reasoning_content && !result.message.tool_calls;
  if (!result.finishReason && (!done || leer)) {
    throw new Error('Stream unvollständig (kein finish_reason / [DONE]).');
  }
  // usage kommt via include_usage im letzten Chunk (top-level, nicht in choices).
  const usage = chunks.map(c => c?.usage).filter(Boolean).pop() || null;
  return { ...result, usage };
}

function isRetryable(error: any): boolean {
  const status = error?.response?.status;
  if (status === 429 || (status >= 500 && status < 600)) return true;
  const code = error?.code;
  if (['ECONNABORTED', 'ECONNRESET', 'ERR_STREAM_PREMATURE_CLOSE'].includes(code)) return true;
  // "Stream unvollständig" = transienter Abriss (Proxy stirbt mittendrin) → retrybar.
  return /socket hang up|idle timeout|premature close|ECONNRESET|unvollständig/i.test(String(error?.message || ''));
}

/** HTTP-Fehler bei responseType:'stream' tragen den Body als Readable – drainen, damit die
 *  echte Fehlermeldung (inkl. der 400-Invarianten-Diagnose) sichtbar wird. */
async function beschreibeFehler(error: any): Promise<any> {
  const data = error?.response?.data;
  let detail: string | undefined;
  if (data && typeof data.on === 'function') {         // Readable
    let raw = '';
    // Mit Timeout + Größen-Cap drainen – sonst kann ein offen gehaltener Fehler-Body
    // unbegrenzt hängen (axios-timeout schützt den Body-Konsum nicht).
    const timer = setTimeout(() => data.destroy(new Error('drain timeout')), 5000);
    try {
      for await (const c of data) {
        raw += c.toString('utf8');
        if (raw.length > 65536) { data.destroy(); break; }
      }
    } catch { /* destroyed/abgebrochen – raw enthält, was bis dahin kam */ }
    finally { clearTimeout(timer); }
    try { const j = JSON.parse(raw); detail = j?.error?.message || j?.message; }
    catch { detail = raw.slice(0, 200); }
  } else if (data) {
    detail = data?.error?.message || data?.message;
  }
  if (detail && error?.response?.status) error.message = `HTTP ${error.response.status}: ${detail}`;
  return error;
}

// ---------------------------------------------------------------------------
// Öffentlich: streamen mit Retry
// ---------------------------------------------------------------------------
/** Streamt einen OpenAI-kompatiblen Request. onReasoning bekommt reasoning_content-Deltas
 *  live (für die Anzeige). Retry nur, solange noch NICHTS live gedruckt wurde – danach wird
 *  geworfen (die History bleibt sauber, weil der Aufrufer erst nach Erfolg pusht). */
export async function streamOpenAiCompatible(
  url: string, headers: any, body: any, onReasoning?: (d: string) => void,
): Promise<StreamResult> {
  let printed = false;
  const cb = onReasoning ? (d: string) => { printed = true; onReasoning(d); } : undefined;

  let lastError: any;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await streamOnce(url, headers, body, cb);
    } catch (error) {
      lastError = error;
      if (printed) break;                              // schon live gedruckt → nicht neu drucken
      if (!isRetryable(error) || attempt === 2) break;
      // Wird retryt: den Fehler-Body dieses Versuchs freigeben (sonst bleibt der Socket
      // belegt). Der FINALE Fehler behält seinen Body für beschreibeFehler().
      (error as any)?.response?.data?.destroy?.();
      await sleep(1000 * 2 ** attempt);
    }
  }
  throw await beschreibeFehler(lastError);
}
