// Testet die reine Logik gegen den Build in dist/ – kein API-Zugriff, keine Kosten.
// Vorher "npm run build" ausfuehren. Start: npm test
const path = require('path');
const { LoopBreaker } = require(path.join(__dirname, '..', 'dist', 'guards', 'loopBreaker.js'));
const { parseDeepSeekToolCalls, stripDeepSeekToolCalls } = require(path.join(__dirname, '..', 'dist', 'utils', 'xmlParser.js'));

let pass = 0, fail = 0;
const check = (name, cond) => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}`); }
};

const cfg = { consecutiveThreshold: 5, cycleReps: 4, cycleMaxPeriod: 6, maxToolCalls: 200 };

console.log('\n[1] 8 write_file auf 8 VERSCHIEDENE Dateien → darf NICHT blocken');
{
  const lb = new LoopBreaker(cfg);
  let blocked = null;
  for (let i = 0; i < 8; i++) {
    const r = lb.check({ name: 'write_file', arguments: { path: `datei${i}.txt`, content: 'x' } });
    if (r.blocked) { blocked = r.reason; break; }
  }
  check('kein Fehlalarm bei 8 verschiedenen Dateien', blocked === null);
  if (blocked) console.log(`     → fälschlich geblockt: ${blocked}`);
}

console.log('\n[2] 5x identischer write_file → MUSS blocken');
{
  const lb = new LoopBreaker(cfg);
  let blocked = null;
  for (let i = 0; i < 6; i++) {
    const r = lb.check({ name: 'write_file', arguments: { path: 'same.txt', content: 'x' } });
    if (r.blocked) { blocked = r.reason; break; }
  }
  check('Endlos-Wiederholung wird erkannt', blocked !== null);
  if (blocked) console.log(`     → ${blocked}`);
}

console.log('\n[3] Konsekutiv-Zähler wird bei anderem Call zurückgesetzt');
{
  const lb = new LoopBreaker(cfg);
  let blocked = null;
  // 4x read A, dazwischen immer read B → nie 5 in Folge
  for (let i = 0; i < 12 && !blocked; i++) {
    const p = i % 2 === 0 ? 'a.txt' : 'b.txt';
    const r = lb.check({ name: 'read_file', arguments: { path: p } });
    if (r.blocked) blocked = r.reason;
  }
  check('abwechselnde read-only Calls bleiben erlaubt', blocked === null);
  if (blocked) console.log(`     → fälschlich geblockt: ${blocked}`);
}

console.log('\n[4] Echter Zyklus read→write→read→write (identische Args) → MUSS blocken');
{
  const lb = new LoopBreaker(cfg);
  let blocked = null;
  for (let i = 0; i < 20 && !blocked; i++) {
    const call = i % 2 === 0
      ? { name: 'read_file', arguments: { path: 'x.txt' } }
      : { name: 'write_file', arguments: { path: 'x.txt', content: 'y' } };
    const r = lb.check(call);
    if (r.blocked) blocked = r.reason;
  }
  check('Zyklus wird erkannt', blocked !== null);
  if (blocked) console.log(`     → ${blocked}`);
}

console.log('\n[5] Argument-Reihenfolge egal (stableStringify)');
{
  const lb = new LoopBreaker({ ...cfg, consecutiveThreshold: 3 });
  lb.check({ name: 'write_file', arguments: { path: 'a', content: 'b' } });
  lb.check({ name: 'write_file', arguments: { content: 'b', path: 'a' } });
  const r = lb.check({ name: 'write_file', arguments: { path: 'a', content: 'b' } });
  check('gleiche Args in anderer Reihenfolge zählen als identisch', r.blocked === true);
}

console.log('\n[6] XML-Parser: ohne string="true" Attribut');
{
  const text = `Ok:
<｜｜DSML｜｜tool_calls>
<｜｜DSML｜｜invoke name="edit_file">
<｜｜DSML｜｜parameter name="path">test.txt</｜｜DSML｜｜parameter>
<｜｜DSML｜｜parameter name="old_string">alt</｜｜DSML｜｜parameter>
</｜｜DSML｜｜invoke>
</｜｜DSML｜｜tool_calls>
Fertig.`;
  const calls = parseDeepSeekToolCalls(text);
  check('Tool-Call erkannt', calls && calls.length === 1);
  const args = calls ? JSON.parse(calls[0].function.arguments) : {};
  check('Parameter NICHT verworfen (path)', args.path === 'test.txt');
  check('Parameter NICHT verworfen (old_string)', args.old_string === 'alt');
  check('type:"function" gesetzt', calls && calls[0].type === 'function');
  check('id vorhanden', calls && typeof calls[0].id === 'string');
  const stripped = stripDeepSeekToolCalls(text);
  check('DSML aus Text entfernt', !stripped.includes('DSML') && stripped.includes('Fertig.'));
}

console.log('\n[7] XML-Parser: MIT string="true" (Rückwärtskompatibilität)');
{
  const text = `<｜｜DSML｜｜tool_calls><｜｜DSML｜｜invoke name="read_file"><｜｜DSML｜｜parameter name="path" string="true">a.txt</｜｜DSML｜｜parameter></｜｜DSML｜｜invoke></｜｜DSML｜｜tool_calls>`;
  const calls = parseDeepSeekToolCalls(text);
  check('altes Format funktioniert weiterhin', calls && JSON.parse(calls[0].function.arguments).path === 'a.txt');
}

console.log('\n[8] Kein DSML im Text → null (nativer Pfad bleibt unberührt)');
{
  check('normaler Text ergibt null', parseDeepSeekToolCalls('Hallo, alles erledigt.') === null);
}

console.log(`\n${'='.repeat(46)}`);
console.log(`${pass} bestanden, ${fail} fehlgeschlagen`);
process.exit(fail === 0 ? 0 : 1);
