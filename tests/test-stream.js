// Testet die REINEN Streaming-Funktionen (SSE-Parsing + Message-Assembly) gegen die von
// Fable gefundenen Edge-Cases – ohne Netz. Vorher "npm run build". Start: npm run test:stream
const path = require('path');
const { StringDecoder } = require('string_decoder');
const s = require(path.join(__dirname, '..', 'dist', 'providers', 'openaiStream.js'));

let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${extra ? `  -> ${extra}` : ''}`); }
};
// Baut aus data-JSON-Strings die Chunk-Objekte, wie sie der Assembler bekommt.
const asm = (objs) => s.assembleMessage(objs);
const delta = (d, finish) => ({ choices: [{ delta: d, finish_reason: finish || null }] });

console.log('\n[1] splitSseBuffer: Zeile über Chunk-Grenze');
{
  const a = s.splitSseBuffer('', 'data: {"a":1}\ndata: {"b":');
  check('vollständige Zeile geliefert', a.lines.length === 1 && a.lines[0] === 'data: {"a":1}', JSON.stringify(a));
  check('unvollständiger Rest bleibt', a.rest === 'data: {"b":');
  const b = s.splitSseBuffer(a.rest, '2}\n');
  check('Rest + nächster Chunk ergibt Zeile', b.lines[0] === 'data: {"b":2}', JSON.stringify(b));
}

console.log('\n[2] parseSseLine');
check('data: {json}', JSON.stringify(s.parseSseLine('data: {"x":1}')) === JSON.stringify({ data: '{"x":1}' }));
check('data:{json} ohne Space', JSON.stringify(s.parseSseLine('data:{"x":1}')) === JSON.stringify({ data: '{"x":1}' }));
check('[DONE]', JSON.stringify(s.parseSseLine('data: [DONE]')) === JSON.stringify({ done: true }));
check('Kommentar/keep-alive -> null', s.parseSseLine(': ping') === null);
check('leere Zeile -> null', s.parseSseLine('') === null);
check('\\r wird gestrippt', JSON.stringify(s.parseSseLine('data: {"x":1}\r')) === JSON.stringify({ data: '{"x":1}' }));
check('Nicht-data-Zeile -> null', s.parseSseLine('event: message') === null);

console.log('\n[3] assembleMessage: content + reasoning');
{
  const r = asm([delta({ content: 'Hallo ' }), delta({ content: 'Welt' }, 'stop')]);
  check('content zusammengesetzt', r.message.content === 'Hallo Welt');
  check('finish_reason erfasst', r.finishReason === 'stop');
  check('KEIN reasoning_content-Feld (Phantom-Schutz)', !('reasoning_content' in r.message), JSON.stringify(r.message));
}
{
  const r = asm([delta({ reasoning_content: 'denk ' }), delta({ reasoning_content: 'nach' }), delta({ content: 'Antwort' }, 'stop')]);
  check('reasoning_content nur bei echten Deltas', r.message.reasoning_content === 'denk nach');
  check('content daneben korrekt', r.message.content === 'Antwort');
}

console.log('\n[4] Tool-Call-Assembly (der riskante Teil)');
{
  // Standard: id+name im ersten Fragment, arguments in Stücken
  const r = asm([
    delta({ tool_calls: [{ index: 0, id: 'tu_1', type: 'function', function: { name: 'read_file', arguments: '' } }] }),
    delta({ tool_calls: [{ index: 0, function: { arguments: '{"pa' } }] }),
    delta({ tool_calls: [{ index: 0, function: { arguments: 'th":"x.txt"}' } }] }),
  ], undefined);
  const tc = r.message.tool_calls;
  check('ein Tool-Call', tc && tc.length === 1);
  check('id/name korrekt', tc[0].id === 'tu_1' && tc[0].function.name === 'read_file');
  check('arguments zusammengesetzt', tc[0].function.arguments === '{"path":"x.txt"}');
}
{
  // Kompletter Call in EINEM Delta, OHNE index (DashScope-Fall)
  const r = asm([delta({ tool_calls: [{ id: 'tu_9', function: { name: 'list_files', arguments: '{"path":"."}' } }] }, 'tool_calls')]);
  check('kompletter Call ohne index -> ein Call', r.message.tool_calls.length === 1 && r.message.tool_calls[0].function.name === 'list_files');
}
{
  // id:null in Folgefragmenten darf die echte id NICHT überschreiben; name nicht doppeln
  const r = asm([
    delta({ tool_calls: [{ index: 0, id: 'tu_5', function: { name: 'write_file', arguments: '{"p' } }] }),
    delta({ tool_calls: [{ index: 0, id: null, function: { name: 'write_file', arguments: 'ath":"y"}' } }] }),
  ]);
  const tc = r.message.tool_calls[0];
  check('id bleibt tu_5 (nicht null)', tc.id === 'tu_5');
  check('name NICHT konkateniert', tc.function.name === 'write_file', tc.function.name);
  check('arguments korrekt', tc.function.arguments === '{"path":"y"}');
}
{
  // Zwei parallele Calls, Indizes nicht bei 0 startend / mit Lücke -> kompaktiert, kein undefined
  const r = asm([
    delta({ tool_calls: [{ index: 1, id: 'a', function: { name: 'read_file', arguments: '{}' } }] }),
    delta({ tool_calls: [{ index: 3, id: 'b', function: { name: 'list_files', arguments: '{}' } }] }),
  ]);
  check('zwei Calls, kompaktiert (kein undefined)', r.message.tool_calls.length === 2 && r.message.tool_calls.every(c => c && c.function));
  check('nach Index sortiert', r.message.tool_calls[0].id === 'a' && r.message.tool_calls[1].id === 'b');
}
{
  // Leere arguments (parameterloses Tool) -> {}
  const r = asm([delta({ tool_calls: [{ index: 0, id: 'x', function: { name: 'noop', arguments: '' } }] }, 'tool_calls')]);
  check('leere arguments -> "{}"', r.message.tool_calls[0].function.arguments === '{}');
}
{
  // Kaputte arguments -> MUSS werfen (kein stiller parseArgs->{})
  let threw = false;
  try { asm([delta({ tool_calls: [{ index: 0, id: 'x', function: { name: 'write_file', arguments: '{"content":"unvoll' } }] }, 'length')]); }
  catch { threw = true; }
  check('kaputte arguments werfen (nicht still ausführen)', threw);
}

console.log('\n[5] Robustheit: usage-/leere Chunks, finish_reason');
{
  const r = asm([{ choices: [] }, delta({ content: 'x' }), { choices: [{ delta: {}, finish_reason: 'length' }] }]);
  check('choices:[] und delta:{} überspringen -> content bleibt', r.message.content === 'x');
  check('finish_reason:length erfasst', r.finishReason === 'length');
}

console.log('\n[6b] Fable-Review-Fixes: Index-Interleaving, Phantom, Name-fehlt');
{
  // Bug 1: index=2, dann index=0, dann index-LOSE Fortsetzung -> muss zu Slot 0 (zuletzt), NICHT 2.
  const r = asm([
    delta({ tool_calls: [{ index: 2, id: 'c', function: { name: 'noop', arguments: '' } }] }),
    delta({ tool_calls: [{ index: 0, id: 'a', function: { name: 'foo', arguments: '' } }] }),
    delta({ tool_calls: [{ function: { arguments: '{"x":1}' } }] }),   // ohne index/id -> Fortsetzung von 0
  ], 'tool_calls');
  const foo = r.message.tool_calls.find(c => c.function.name === 'foo');
  const noop = r.message.tool_calls.find(c => c.function.name === 'noop');
  check('index-lose Fortsetzung geht an ZULETZT gesehenen Slot (0=foo)', foo.function.arguments === '{"x":1}', foo.function.arguments);
  check('nicht an den höchsten Slot (2=noop bleibt {})', noop.function.arguments === '{}', noop.function.arguments);
}
{
  // Bug 1b: id-only ohne index nach index=0 -> NEUER Slot (maxKey+1), nicht Fortsetzung
  const r = asm([
    delta({ tool_calls: [{ index: 0, id: 'a', function: { name: 'read_file', arguments: '{}' } }] }),
    delta({ tool_calls: [{ id: 'b', function: { name: 'list_files', arguments: '{}' } }] }),
  ], 'tool_calls');
  check('id-only ohne index -> zwei getrennte Calls', r.message.tool_calls.length === 2);
}
{
  // Bug 3: reasoning_content:'' -> KEIN Feld
  const r = asm([delta({ reasoning_content: '' }), delta({ content: 'hi' }, 'stop')]);
  check("reasoning_content:'' erzeugt KEIN Feld", !('reasoning_content' in r.message), JSON.stringify(r.message));
}
{
  // Bug 2: Slot mit Argumenten aber ohne Namen -> werfen
  let threw = false;
  try { asm([delta({ tool_calls: [{ index: 0, function: { arguments: '{"x":1}' } }] }, 'tool_calls')]); }
  catch { threw = true; }
  check('args ohne name -> wirft (nicht still verwerfen)', threw);
}
check('leeres "data:" -> null (kein JSON.parse-Fehler)', s.parseSseLine('data:') === null);

console.log('\n[6] UTF-8 über Chunk-Grenze (StringDecoder-Ansatz)');
{
  // Chinesisch – wie in Qwen-Reasoning. Bytes mitten im Multibyte-Zeichen zerteilen.
  const original = '思考中';
  const bytes = Buffer.from(original, 'utf8');
  const cut = 4;                                   // mitten im zweiten Zeichen
  const dec = new StringDecoder('utf8');
  const part1 = dec.write(bytes.slice(0, cut));
  const part2 = dec.write(bytes.slice(cut));
  check('StringDecoder setzt Multibyte korrekt zusammen', part1 + part2 + dec.end() === original, JSON.stringify(part1 + part2));
  // Gegenprobe: naives toString je Teil produziert Ersatzzeichen
  const naiv = bytes.slice(0, cut).toString('utf8') + bytes.slice(cut).toString('utf8');
  check('naives toString WÜRDE verstümmeln (Beleg)', naiv !== original);
}

console.log(`\n${'='.repeat(50)}`);
console.log(`${pass} bestanden, ${fail} fehlgeschlagen`);
process.exit(fail === 0 ? 0 : 1);
