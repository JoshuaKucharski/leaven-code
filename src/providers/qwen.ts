// Qwen-Provider (Alibaba DashScope) über den OpenAI-KOMPATIBLEN Endpunkt. Nutzt den
// gemeinsamen SSE-Streaming-Client (openaiStream.ts) – KEIN neues Paket, nur vorhandenes
// axios. Mit Streaming ist Qwens Deep-Thinking (enable_thinking) verfügbar; die Antwort
// kommt bereits in DeepSeek-Form zurück, die Agent-Schleife merkt keinen Unterschied.

import { streamOpenAiCompatible, StreamResult } from './openaiStream.js';

const QWEN_URL = 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions';
const MAX_TOKENS = 8192;

export interface QwenOpts {
  model: string;
  temperature: number;
  thinking: boolean;   // -> enable_thinking (braucht Streaming; ist hier gegeben)
  apiKey: string;
}

/** Streamt den OpenAI-kompatiblen DashScope-Endpunkt. onReasoning bekommt reasoning_content
 *  live. Rückgabe: { message, finishReason } (Message in DeepSeek-Form). */
export async function callQwen(
  messages: any[], tools: any[] | null, opts: QwenOpts, onReasoning?: (d: string) => void,
): Promise<StreamResult> {
  const body: any = {
    model: opts.model,
    messages,
    temperature: opts.temperature,
    max_tokens: MAX_TOKENS,
    enable_thinking: opts.thinking,   // immer explizit setzen (manche Qwen default-ON)
  };
  if (tools && tools.length) {
    body.tools = tools;               // OpenAI-Form – identisch zur DeepSeek-Allowlist
    body.tool_choice = 'auto';
  }
  const headers = { 'Authorization': `Bearer ${opts.apiKey}`, 'Content-Type': 'application/json' };
  return streamOpenAiCompatible(QWEN_URL, headers, body, onReasoning);
}
