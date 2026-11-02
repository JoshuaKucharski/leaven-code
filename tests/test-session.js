// Testet die reine Session-Validierung (session.ts) – ohne Netz, ohne Datei-I/O.
// Vorher "npm run build". Start: npm run test:session
const path = require('path');
const s = require(path.join(__dirname, '..', 'dist', 'session.js'));

let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${extra ? `  -> ${extra}` : ''}`); }
};

const gut = {
  datum: '2026-07-30', label: 'lege 3 Dateien an', model: 'deepseek-v4-pro',
  thinking: true, effort: 'high',
  messages: [{ role: 'system', content: 'x' }, { role: 'user', content: 'y' }],
  plan: [],
};

console.log('\n[1] sessionGueltig');
check('vollständige Session -> gültig', s.sessionGueltig(gut) === true);
check('null -> ungültig', s.sessionGueltig(null) === false);
check('kein Objekt -> ungültig', s.sessionGueltig('x') === false);
check('fehlendes model -> ungültig', s.sessionGueltig({ ...gut, model: undefined }) === false);
check('leeres model -> ungültig', s.sessionGueltig({ ...gut, model: '' }) === false);
check('messages kein Array -> ungültig', s.sessionGueltig({ ...gut, messages: 'nope' }) === false);
check('leere messages -> ungültig', s.sessionGueltig({ ...gut, messages: [] }) === false);
check('plan kein Array -> ungültig', s.sessionGueltig({ ...gut, plan: 5 }) === false);

console.log(`\n${'='.repeat(50)}`);
console.log(`${pass} bestanden, ${fail} fehlgeschlagen`);
process.exit(fail === 0 ? 0 : 1);
