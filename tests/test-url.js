// Testet die Netzwerk-Pruefungen gegen den Build in dist/ – kein echter Netzzugriff.
// Vorher "npm run build" ausfuehren. Start: npm test
const path = require('path');
const u = require(path.join(__dirname, '..', 'dist', 'guards', 'urlGuard.js'));

let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${extra ? `  -> ${extra}` : ''}`); }
};

const ERLAUBT = ['example.com', 'docs.deepseek.com'];
const pruefe = url => u.pruefeUrl(url, ERLAUBT);

console.log('\n[1] Freigegebene Domains und ihre Subdomains');
for (const url of [
  'https://example.com',
  'https://example.com/pfad/seite.html?q=1',
  'https://docs.example.com/x',
  'https://docs.deepseek.com/api',
]) {
  const v = pruefe(url);
  check(url, v.ok === true, v.ok ? '' : v.grund);
}

console.log('\n[2] Fremde Domains muessen abgelehnt werden');
for (const url of [
  'https://fremd.tld',
  'https://boese.tld/example.com',
  // Der klassische Suffix-Trick: endet NICHT auf ".example.com"
  'https://example.com.boeser-host.tld',
  'https://notexample.com',
]) {
  const v = pruefe(url);
  check(url, v.ok === false, 'wurde faelschlich erlaubt');
}

console.log('\n[3] Interne Adressen (SSRF) muessen gesperrt sein');
for (const url of [
  'http://localhost:8080/admin',
  'http://127.0.0.1/',
  'http://10.0.0.5/',
  'http://192.168.1.1/',
  'http://172.16.0.1/',
  'http://169.254.169.254/latest/meta-data/',   // Cloud-Metadaten
  'http://intern.local/',
]) {
  const v = u.pruefeUrl(url, [new URL(url).hostname]);   // Domain waere erlaubt …
  check(`${url}  (trotz erlaubter Domain)`, v.ok === false, 'wurde faelschlich erlaubt');
}

console.log('\n[4] Nur http und https');
for (const url of ['file:///etc/passwd', 'ftp://example.com/x', 'gopher://example.com']) {
  const v = u.pruefeUrl(url, ['example.com']);
  check(url, v.ok === false, 'wurde faelschlich erlaubt');
}

console.log('\n[5] Ohne freigegebene Domain geht gar nichts');
{
  const v = u.pruefeUrl('https://example.com', []);
  check('leere Allowlist lehnt ab', v.ok === false);
}

console.log('\n[6] Ungueltige Eingaben');
for (const url of ['kein-url', '', 'https://']) {
  const v = pruefe(url);
  check(JSON.stringify(url), v.ok === false);
}

console.log('\n[7] domainErlaubt: Grenzfaelle');
check('example.com passt auf example.com', u.domainErlaubt('example.com', ['example.com']));
check('a.b.example.com passt auf example.com', u.domainErlaubt('a.b.example.com', ['example.com']));
check('*.example.com wird wie example.com behandelt', u.domainErlaubt('x.example.com', ['*.example.com']));
check('badexample.com passt NICHT', !u.domainErlaubt('badexample.com', ['example.com']));
check('leerer Eintrag erlaubt nichts', !u.domainErlaubt('example.com', ['']));

console.log('\n[8] HTML wird zu Text');
{
  const html = '<html><head><style>b{x}</style><script>alert(1)</script></head>' +
               '<body><h1>Titel</h1><p>Ein Absatz &amp; mehr</p></body></html>';
  const text = u.htmlZuText(html);
  check('Skript entfernt', !text.includes('alert'));
  check('Stil entfernt', !text.includes('b{x}'));
  check('Text erhalten', text.includes('Titel') && text.includes('Ein Absatz'));
  check('Entities aufgeloest', text.includes('&') && !text.includes('&amp;'));
}

console.log(`\n${'='.repeat(50)}`);
console.log(`${pass} bestanden, ${fail} fehlgeschlagen`);
process.exit(fail === 0 ? 0 : 1);
