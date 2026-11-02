// Testet die reine Token-Budget-Logik (usage.ts) – ohne Netz, ohne Datei-I/O.
// Vorher "npm run build". Start: npm run test:usage
const path = require('path');
const u = require(path.join(__dirname, '..', 'dist', 'usage.js'));

let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${extra ? `  -> ${extra}` : ''}`); }
};

console.log('\n[1] tokenSumme');
check('OpenAI total_tokens', u.tokenSumme({ total_tokens: 123, prompt_tokens: 100, completion_tokens: 23 }) === 123);
check('OpenAI ohne total -> prompt+completion', u.tokenSumme({ prompt_tokens: 100, completion_tokens: 40 }) === 140);
check('Anthropic input+output', u.tokenSumme({ input_tokens: 200, output_tokens: 50 }) === 250);
check('kein usage -> 0', u.tokenSumme(null) === 0 && u.tokenSumme(undefined) === 0);

console.log('\n[2] resetWennNeuerTag');
{
  const d = { datum: '2026-07-28', verbrauch: { anthropic: 999 }, limits: { anthropic: 500000 }, autoStopp: true, autoWeiter: true };
  const gleich = u.resetWennNeuerTag(d, '2026-07-28');
  check('gleicher Tag -> unverändert', gleich.verbrauch.anthropic === 999);
  const neu = u.resetWennNeuerTag(d, '2026-07-29');
  check('neuer Tag -> Verbrauch zurückgesetzt', (neu.verbrauch.anthropic || 0) === 0);
  check('neuer Tag -> Limit BLEIBT', neu.limits.anthropic === 500000);
  check('neuer Tag -> Datum aktualisiert', neu.datum === '2026-07-29');
  check('neuer Tag -> autoStopp BLEIBT', neu.autoStopp === true);
  check('neuer Tag -> autoWeiter BLEIBT', neu.autoWeiter === true);
}

console.log('\n[3] addVerbrauch');
{
  const d = u.leereUsage('2026-07-29');
  u.addVerbrauch(d, 'qwen', 100);
  u.addVerbrauch(d, 'qwen', 250);
  check('summiert pro Anbieter', d.verbrauch.qwen === 350);
  u.addVerbrauch(d, 'qwen', -50);   // negativ wird ignoriert
  check('negative Tokens ignoriert', d.verbrauch.qwen === 350);
}

console.log('\n[4] ueberBudget');
{
  const d = { datum: '2026-07-29', verbrauch: { anthropic: 500, qwen: 100 }, limits: { anthropic: 500, qwen: 0 } };
  check('erreicht (>=) -> true', u.ueberBudget(d, 'anthropic') === true);
  check('Limit 0 (kein Limit) -> false', u.ueberBudget(d, 'qwen') === false);
  check('kein Eintrag -> false', u.ueberBudget(d, 'deepseek') === false);
  d.verbrauch.anthropic = 499;
  check('unter Limit -> false', u.ueberBudget(d, 'anthropic') === false);
}

console.log('\n[5] ANBIETER-Liste');
check('drei Anbieter', JSON.stringify(u.ANBIETER) === JSON.stringify(['anthropic', 'qwen', 'deepseek']));

console.log(`\n${'='.repeat(50)}`);
console.log(`${pass} bestanden, ${fail} fehlgeschlagen`);
process.exit(fail === 0 ? 0 : 1);
