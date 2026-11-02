// Testet den Anthropic-Adapter (reine Übersetzungsfunktionen) und die Fähigkeiten – ohne
// API-Zugriff, keine Kosten. Vorher "npm run build". Start: npm test
const path = require('path');
const a = require(path.join(__dirname, '..', 'dist', 'providers', 'anthropic.js'));
const c = require(path.join(__dirname, '..', 'dist', 'providers', 'capabilities.js'));

let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${extra ? `  -> ${extra}` : ''}`); }
};

console.log('\n[1] Fähigkeiten pro Modell');
check("providerFor('claude-opus-4-8') = anthropic", c.providerFor('claude-opus-4-8') === 'anthropic');
check("providerFor('claude-fable-5') = anthropic", c.providerFor('claude-fable-5') === 'anthropic');
check("providerFor('deepseek-v4-pro') = deepseek", c.providerFor('deepseek-v4-pro') === 'deepseek');
{
  const opus = c.capabilitiesFor('claude-opus-4-8');
  check('Opus: temperature=false', opus.temperature === false);
  check('Opus: 5 Effort-Stufen', opus.effortLevels.length === 5 && opus.effortLevels.includes('xhigh'));
  check('Opus: thinkingToggle=true, alwaysOn=false', opus.thinkingToggle === true && opus.thinkingAlwaysOn === false);
  check('Opus: apiKeyEnv=ANTHROPIC_API_KEY', opus.apiKeyEnv === 'ANTHROPIC_API_KEY');
  const fable = c.capabilitiesFor('claude-fable-5');
  check('Fable: thinkingAlwaysOn=true, toggle=false', fable.thinkingAlwaysOn === true && fable.thinkingToggle === false);
  const ds = c.capabilitiesFor('deepseek-v4-pro');
  check('DeepSeek: temperature=true', ds.temperature === true);
  check('DeepSeek: apiKeyEnv=DEEPSEEK_API_KEY', ds.apiKeyEnv === 'DEEPSEEK_API_KEY');
  // Qwen (DashScope, OpenAI-kompatibel)
  check("providerFor('qwen3.7-max') = qwen", c.providerFor('qwen3.7-max') === 'qwen');
  const qwen = c.capabilitiesFor('qwen3.7-max');
  check('Qwen: temperature=true', qwen.temperature === true);
  check('Qwen: apiKeyEnv=QWEN_API_KEY', qwen.apiKeyEnv === 'QWEN_API_KEY');
  check('Qwen: keine Effort-Stufen', qwen.effortLevels.length === 0);
  check('Qwen: streaming=true, thinkingToggle=true (Deep-Thinking via Streaming)', qwen.streaming === true && qwen.thinkingToggle === true);
  check('Qwen: thinkingAlwaysOn=false', qwen.thinkingAlwaysOn === false);
  check('DeepSeek: streaming=true', ds.streaming === true);
  check('Anthropic: streaming=false (Phase 2)', c.capabilitiesFor('claude-opus-4-8').streaming === false);
  check("'qwen3.7-max' in der Modell-Liste", c.ALLE_MODELLE.includes('qwen3.7-max'));
}

console.log('\n[2] zuAnthropicRequest: Format-Übersetzung');
const tools = [{ type: 'function', function: { name: 'read_file', description: 'liest', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } } }];
const history = [
  { role: 'system', content: 'Du bist hilfreich.' },
  { role: 'user', content: 'Lies x.txt' },
  { role: 'assistant', content: '', tool_calls: [{ id: 'tu_1', type: 'function', function: { name: 'read_file', arguments: '{"path":"x.txt"}' } }] },
  { role: 'tool', tool_call_id: 'tu_1', content: 'Inhalt von x' },
  { role: 'tool', tool_call_id: 'tu_2', content: 'noch was' },
];
{
  const body = a.zuAnthropicRequest(history, tools, { model: 'claude-opus-4-8', effort: 'high', thinking: true });
  check('system ins eigene Feld gezogen', body.system === 'Du bist hilfreich.');
  check('KEINE system-Nachricht in messages', body.messages.every(m => m.role !== 'system'));
  check('KEIN temperature im Body', !('temperature' in body));
  check('output_config.effort gesetzt', body.output_config && body.output_config.effort === 'high');
  check('Opus: thinking adaptive', body.thinking && body.thinking.type === 'adaptive');
  check('tools -> input_schema', body.tools[0].input_schema && body.tools[0].name === 'read_file' && !('parameters' in body.tools[0]));
  // assistant tool_calls -> tool_use-Block
  const assistant = body.messages.find(m => m.role === 'assistant');
  const toolUse = assistant.content.find(b => b.type === 'tool_use');
  check('assistant enthält tool_use-Block', toolUse && toolUse.id === 'tu_1' && toolUse.name === 'read_file' && toolUse.input.path === 'x.txt');
  // zwei aufeinanderfolgende tool-Ergebnisse -> EINE user-Nachricht mit zwei tool_result-Blöcken
  const lastUser = body.messages[body.messages.length - 1];
  check('tool-Ergebnisse gebündelt in EINER user-Nachricht', lastUser.role === 'user' && Array.isArray(lastUser.content) && lastUser.content.length === 2);
  check('tool_result trägt tool_use_id', lastUser.content[0].type === 'tool_result' && lastUser.content[0].tool_use_id === 'tu_1');
}
{
  // Fable: KEIN thinking-Feld, dafür fallbacks; Thinking-Schalter wird ignoriert.
  const body = a.zuAnthropicRequest(history, tools, { model: 'claude-fable-5', effort: 'max', thinking: false });
  check('Fable: KEIN thinking-Feld', !('thinking' in body));
  check('Fable: fallbacks auf Opus', Array.isArray(body.fallbacks) && body.fallbacks[0].model === 'claude-opus-4-8');
}
{
  // Ohne Thinking akzeptiert die API nur bis "high" (Opus 5: 400 bei xhigh/max) -> kappen.
  const aus = a.zuAnthropicRequest(history, tools, { model: 'claude-opus-5', effort: 'max', thinking: false });
  check('Opus ohne Thinking: max -> high gekappt', aus.output_config.effort === 'high' && aus.thinking.type === 'disabled');
  const an = a.zuAnthropicRequest(history, tools, { model: 'claude-opus-5', effort: 'max', thinking: true });
  check('Opus mit Thinking: max bleibt max', an.output_config.effort === 'max' && an.thinking.type === 'adaptive');
  const niedrig = a.zuAnthropicRequest(history, tools, { model: 'claude-opus-5', effort: 'low', thinking: false });
  check('Opus ohne Thinking: low bleibt low', niedrig.output_config.effort === 'low');
  const fable = a.zuAnthropicRequest(history, tools, { model: 'claude-fable-5', effort: 'max', thinking: false });
  check('Fable (Thinking immer an): max bleibt max', fable.output_config.effort === 'max');
  check('max_tokens 16000 (Thinking zählt mit ins Budget)', aus.max_tokens === 16000);
}
{
  // _providerRaw wird bevorzugt (erhält thinking-Blöcke unverändert).
  const raw = [{ type: 'thinking', thinking: '…' }, { type: 'text', text: 'hi' }];
  const h = [{ role: 'user', content: 'x' }, { role: 'assistant', content: 'hi', _providerRaw: raw }];
  const body = a.zuAnthropicRequest(h, null, { model: 'claude-opus-4-8', effort: 'high', thinking: true });
  const asst = body.messages.find(m => m.role === 'assistant');
  check('_providerRaw wird unverändert übernommen', asst.content === raw);
}

console.log('\n[3] ausAnthropicResponse: Antwort -> DeepSeek-Form');
{
  const resp = {
    stop_reason: 'tool_use',
    content: [
      { type: 'thinking', thinking: 'denke…' },
      { type: 'text', text: 'Ich lese die Datei.' },
      { type: 'tool_use', id: 'tu_9', name: 'read_file', input: { path: 'a.txt' } },
    ],
  };
  const msg = a.ausAnthropicResponse(resp);
  check('role assistant', msg.role === 'assistant');
  check('Text aus text-Blöcken', msg.content === 'Ich lese die Datei.');
  check('tool_calls in DeepSeek-Form', msg.tool_calls[0].id === 'tu_9' && msg.tool_calls[0].function.name === 'read_file' && JSON.parse(msg.tool_calls[0].function.arguments).path === 'a.txt');
  check('_providerRaw hält Original-Blöcke (inkl. thinking)', Array.isArray(msg._providerRaw) && msg._providerRaw.length === 3);
}
{
  // Fable-Refusal sauber behandeln.
  const msg = a.ausAnthropicResponse({ stop_reason: 'refusal', content: [] });
  check('refusal -> Meldung statt leer', typeof msg.content === 'string' && /refusal|abgelehnt/i.test(msg.content));
}
{
  // max_tokens -> 'length' wie bei DeepSeek/Qwen, damit die Schleife dieselbe Warnung zeigt.
  check('finishReasonAus: max_tokens -> length', a.finishReasonAus({ stop_reason: 'max_tokens' }) === 'length');
  check('finishReasonAus: end_turn bleibt', a.finishReasonAus({ stop_reason: 'end_turn' }) === 'end_turn');
  check('finishReasonAus: ohne stop_reason -> null', a.finishReasonAus({}) === null);
}

console.log(`\n${'='.repeat(50)}`);
console.log(`${pass} bestanden, ${fail} fehlgeschlagen`);
process.exit(fail === 0 ? 0 : 1);
