// Testet den Befehls-Guard gegen den Build in dist/ – kein API-Zugriff, keine Kosten.
// Vorher "npm run build" ausfuehren. Start: npm test
const path = require('path');
const g = require(path.join(__dirname, '..', 'dist', 'guards', 'commandGuard.js'));
const config = require(path.join(__dirname, '..', 'config', 'commands.json'));

let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${extra ? `  -> ${extra}` : ''}`); }
};
const verdict = cmd => g.checkCommand(cmd, config);

console.log('\n[1] Shell-Metazeichen muessen ABGELEHNT werden (kind=reject)');
for (const cmd of [
  'grep foo x ; rm -rf y',
  'grep foo x && rm y',
  'grep foo x | sh',
  'grep foo x > /etc/passwd',
  'grep $(whoami) x',
  'grep `whoami` x',
  'ls\nrm -rf /',
  'grep ${HOME} x',
  'ls & rm y',
  'cat < /etc/passwd',
]) {
  const v = verdict(cmd);
  check(JSON.stringify(cmd), v.kind === 'reject', `kind=${v.kind}`);
}

console.log('\n[2] Harmlose Allowlist-Befehle muessen durchgehen (kind=ok)');
for (const cmd of [
  'grep -rn "foo" src/',
  'ls -la',
  'find . -name "*.ts"',
  'wc -l package.json',
  "grep -r 'text mit leerzeichen' src/",
]) {
  const v = verdict(cmd);
  check(JSON.stringify(cmd), v.kind === 'ok', `kind=${v.kind} reason=${v.reason || ''}`);
}

console.log('\n[2b] git steht NICHT mehr auf der Allowlist -> Dialog');
console.log('     (Grund: repo-eigene .git/config startet via diff.external Programme)');
for (const cmd of ['git status', 'git diff HEAD', 'git log', 'git show', 'git blame datei.ts']) {
  const v = verdict(cmd);
  check(JSON.stringify(cmd), v.kind === 'ask', `kind=${v.kind}`);
}

console.log('\n[3] Gefaehrliche Optionen muessen ABGELEHNT werden');
for (const [cmd, warum] of [
  ['find . -delete', 'loescht'],
  ['find . -exec rm {} ;', 'startet Programme'],
  ['grep -S -r foo /', 'folgt Symlinks'],
  ['tail -f datei.log', 'blockiert endlos'],
]) {
  const v = verdict(cmd);
  check(`${cmd}  (${warum})`, v.kind === 'reject', `kind=${v.kind}`);
}

console.log('\n[3b] ACHTUNG: Optionssperren greifen NUR bei Allowlist-Programmen');
console.log('     git ist nicht gelistet -> "git -c core.pager=sh log" wird nicht hart');
console.log('     abgelehnt, sondern landet im Dialog. Dort ist der Mensch der Schutz.');
{
  const v = verdict('git -c core.pager=sh log');
  check('git -c core.pager=sh log -> ask (nicht reject)', v.kind === 'ask', `kind=${v.kind}`);
}

console.log('\n[3c] Regression: harmlose Optionen duerfen nicht mitgesperrt werden');
for (const cmd of ['grep -c muster datei.txt', 'ls -l', 'find . -type f']) {
  const v = verdict(cmd);
  check(JSON.stringify(cmd), v.kind === 'ok', `kind=${v.kind} reason=${v.reason || ''}`);
}

console.log('\n[3d] Sperren greifen auch gebuendelt, abgekuerzt und bei GNU-Varianten');
console.log('     getopt erlaubt -rS statt -r -S und --deref statt --dereference-recursive.');
for (const [cmd, warum] of [
  ['grep -rS foo .', 'Buendel mit -S (folgt Symlinks, macOS)'],
  ['grep -rSn foo .', 'Buendel, -S in der Mitte'],
  ['grep -R foo .', 'GNU: folgt allen Symlinks'],
  ['grep -Rn foo .', 'GNU, gebuendelt'],
  ['grep --dereference-recursive foo .', 'GNU, lange Form'],
  ['grep --deref foo .', 'GNU-Abkuerzung'],
  ['rg -nL foo', 'Buendel mit -L (folgt Symlinks)'],
  ['tail -fn 5 x.log', 'Buendel mit -f (blockiert)'],
  ['tail -F x.log', '-F folgt wie -f'],
  ['tail --f x.log', 'GNU-Abkuerzung von --follow'],
  ['file -C', 'schreibt magic.mgc'],
  ['file -bC x', 'gebuendelt'],
  ['find . -fprint0 out.txt', 'GNU: schreibt Datei'],
]) {
  const v = verdict(cmd);
  check(`${cmd}  (${warum})`, v.kind === 'reject', `kind=${v.kind}`);
}
{
  const v = verdict('grep -R foo .');
  check('  Ablehnung von -R nennt die harmlose Form -r', /-r \(klein\)/.test(v.reason || ''), v.reason || '');
}

console.log('\n[3e] Regression: Buendel ohne gesperrte Buchstaben und aehnliche Optionen bleiben ok');
for (const cmd of [
  'grep -rn foo .', 'grep -rnA3 foo .', 'grep -rni foo src', 'grep --null-data foo x',
  'find . -name x -ls', 'find . -newer x -type f', 'tail -n 20 x.log', 'tail -n5 x.log',
  'file -b x', 'head -5 x', 'ls -la', 'wc -lw x', 'stat -f %z x',
]) {
  const v = verdict(cmd);
  check(JSON.stringify(cmd), v.kind === 'ok', `kind=${v.kind} reason=${v.reason || ''}`);
}

console.log('\n[3f] flagGesperrt: die vier Schreibweisen einzeln');
for (const [arg, flag, soll] of [
  ['-S', '-S', true], ['-rS', '-S', true], ['-Sr', '-S', true], ['-rs', '-S', false],
  ['--follow=name', '--follow', true], ['--fol', '--follow', true], ['--follower', '--follow', false],
  ['--null-data', '--null', false], ['-exec', '-exec', true], ['-execdir', '-exec', false],
  ['-ls', '-L', false], ['-', '-S', false], ['--', '--follow', false],
]) {
  check(`flagGesperrt(${JSON.stringify(arg)}, ${flag}) = ${soll}`, g.flagGesperrt(arg, flag) === soll);
}

console.log('\n[4] Nicht gelistete Programme -> Freigabe-Dialog (kind=ask), nicht heimlich erlaubt');
for (const cmd of ['rm -rf /', 'sudo whoami', 'curl http://x.tld', 'npm run build', 'python3 -c "1"']) {
  const v = verdict(cmd);
  check(JSON.stringify(cmd), v.kind === 'ask', `kind=${v.kind}`);
}

console.log('\n[4b] cp wird auf copy_file umgeleitet (kind=redirect), OHNE Nutzer-Dialog');
for (const cmd of ['cp a b', 'cp datei.blade.php datei.blade.php.bak', 'cp -r src dest']) {
  const v = verdict(cmd);
  check(JSON.stringify(cmd), v.kind === 'redirect', `kind=${v.kind}`);
  check(`  Hinweis nennt copy_file`, v.kind === 'redirect' && /copy_file/.test(v.reason || ''), v.reason || '');
}
// Abgrenzung: mv und ein cp mit Pfadangabe bleiben beim Freigabe-Dialog, nicht Umleitung.
check('"mv a b" -> ask (nicht umgeleitet)', verdict('mv a b').kind === 'ask', `kind=${verdict('mv a b').kind}`);
check('"/bin/cp a b" -> ask (Programmpfad, keine Umleitung)', verdict('/bin/cp a b').kind === 'ask', `kind=${verdict('/bin/cp a b').kind}`);

console.log('\n[4c] Vorregistrierte Befehle (allow) + enger php -l-Lint');
// allowedCommands kommt zur Laufzeit aus ~/.leaven; im Test injizieren wir sie.
const regConfig = Object.assign({}, config, {
  allowedCommands: ['php artisan view:clear', 'php artisan view:cache', 'php artisan julalo'],
});
const rv = cmd => g.checkCommand(cmd, regConfig);

check('registriert: "php artisan view:clear" -> allow', rv('php artisan view:clear').kind === 'allow', `kind=${rv('php artisan view:clear').kind}`);
check('registriert: "php artisan julalo" -> allow', rv('php artisan julalo').kind === 'allow');
check('nicht registriert: "php artisan migrate" -> ask', rv('php artisan migrate').kind === 'ask', `kind=${rv('php artisan migrate').kind}`);
{
  // Beinahe-Treffer: zusaetzliche Flags -> ask MIT Hinweis auf die durchgehende Form.
  const v = rv('php artisan view:clear --env=prod');
  check('registriert + Extra-Flag -> ask', v.kind === 'ask', `kind=${v.kind}`);
  check('  Hinweis nennt die registrierte Form', /vorregistriert/.test(v.reason || '') && /--env=prod/.test(v.reason || ''), v.reason || '');
}
check('php -l datei -> allow', rv('php -l storage/views/x.php').kind === 'allow', `kind=${rv('php -l storage/views/x.php').kind}`);
check('  php -l setzt pruefePfade=true', rv('php -l x.php').pruefePfade === true);
check('registrierter Befehl setzt pruefePfade=false', rv('php artisan view:clear').pruefePfade === false);
// php -r darf NIE allow werden. (Mit ";" im Code greift schon der Metazeichen-Filter
// -> reject; ohne ";" bleibt es beim Dialog -> ask. Beides ist sicher, nie allow.)
check('php -r "phpinfo()" -> ask (Code-Ausfuehrung, NICHT allow)', rv('php -r "phpinfo()"').kind === 'ask', `kind=${rv('php -r "phpinfo()"').kind}`);
check('php -r "echo 1;" -> reject (Metazeichen, NICHT allow)', rv('php -r "echo 1;"').kind === 'reject', `kind=${rv('php -r "echo 1;"').kind}`);
check('php -f skript.php -> ask (fuehrt Datei aus)', rv('php -f skript.php').kind === 'ask');
{
  // ini-Injektion neben -l darf NICHT durchgehen, aber mit Hinweis.
  const v = rv('php -l -d auto_prepend_file=böse.php ziel.php');
  check('php -l + -d ... -> ask (verbotenes Flag)', v.kind === 'ask', `kind=${v.kind}`);
  check('  Hinweis nennt reinen -l-Aufruf', /php -l/.test(v.reason || '') && /-d/.test(v.reason || ''), v.reason || '');
}
check('php -l ohne Pfad -> ask', rv('php -l').kind === 'ask', `kind=${rv('php -l').kind}`);
check('"/usr/local/bin/php -l x.php" -> ask (Pfadangabe, kein allow)', rv('/usr/local/bin/php -l x.php').kind === 'ask', `kind=${rv('/usr/local/bin/php -l x.php').kind}`);
check('"/usr/local/bin/php artisan view:clear" -> ask (Pfadangabe, kein Registry-Treffer)', rv('/usr/local/bin/php artisan view:clear').kind === 'ask', `kind=${rv('/usr/local/bin/php artisan view:clear').kind}`);
// Ohne Registry (Standard-config) darf NICHTS als allow durchgehen ausser dem Lint.
check('ohne Registry: "php artisan view:clear" -> ask', verdict('php artisan view:clear').kind === 'ask', `kind=${verdict('php artisan view:clear').kind}`);

console.log('\n[4d] bash-Skripte: Hinweis + Registry-Validierung (Footgun-Schutz)');
{
  // Unregistriertes bash-Skript -> ask mit Hinweis auf propose_command.
  const v = verdict('bash editor.julalo/_run_view_check.sh');
  check('unregistriertes bash-Skript -> ask', v.kind === 'ask', `kind=${v.kind}`);
  check('  Hinweis nennt propose_command', /propose_command/.test(v.reason || ''), v.reason || '');
}
{
  // Registriertes bash-Skript in der geschützten Zone -> allow (exakter Match).
  const cfg = Object.assign({}, config, { allowedCommands: ['bash ~/.leaven/approved-scripts/check.sh'] });
  check('registriertes geschütztes bash-Skript -> allow', g.checkCommand('bash ~/.leaven/approved-scripts/check.sh', cfg).kind === 'allow', `kind=${g.checkCommand('bash ~/.leaven/approved-scripts/check.sh', cfg).kind}`);
}
// registryEintragErlaubt: nur Skripte in ~/.leaven dürfen ohne Rückfrage laufen.
const HOME = '/Users/myki';
check('erlaubt: bash ~/.leaven/approved-scripts/x.sh', g.registryEintragErlaubt('bash ~/.leaven/approved-scripts/x.sh', HOME) === true);
check('erlaubt: bash /Users/myki/.leaven/scripts/x.sh (absolut)', g.registryEintragErlaubt('bash /Users/myki/.leaven/scripts/x.sh', HOME) === true);
check('VERWORFEN: bash /projekt/x.sh (ausserhalb)', g.registryEintragErlaubt('bash /projekt/x.sh', HOME) === false);
check('VERWORFEN: bash ~/.leaven/../evil.sh (Traversal)', g.registryEintragErlaubt('bash ~/.leaven/../evil.sh', HOME) === false);
check('VERWORFEN: bash ohne Skript', g.registryEintragErlaubt('bash', HOME) === false);
check('normaler Befehl unbeschränkt: php artisan view:clear', g.registryEintragErlaubt('php artisan view:clear', HOME) === true);

console.log('\n[5] Schreibende/netzende git-Unterbefehle -> Dialog');
for (const cmd of ['git push', 'git clean -fdx', 'git reset --hard', 'git checkout main', 'git fetch https://fremd.tld/repo.git']) {
  const v = verdict(cmd);
  check(JSON.stringify(cmd), v.kind === 'ask', `kind=${v.kind}`);
}

console.log('\n[6] Umgehung ueber Programmpfad -> Dialog');
for (const cmd of ['/bin/rm x', './script.sh', '/usr/bin/grep foo x']) {
  const v = verdict(cmd);
  check(JSON.stringify(cmd), v.kind === 'ask', `kind=${v.kind}`);
}

console.log('\n[7] Parser: Anfuehrungszeichen korrekt, keine Shell-Semantik');
{
  const p = g.parseCommand('grep -r "hallo welt" src/');
  check('Argument mit Leerzeichen bleibt EIN Argument',
    p && p.args.length === 3 && p.args[1] === 'hallo welt', JSON.stringify(p));
  const p2 = g.parseCommand('grep "unbalanciert src/');
  check('unbalancierte Anfuehrungszeichen -> null', p2 === null);
  const p3 = g.parseCommand('grep $HOME x');
  check('$HOME wird NICHT expandiert', p3 && p3.args[0] === '$HOME', JSON.stringify(p3));
}

console.log('\n[8] Geheimnis-Erkennung');
const secret = p => g.isSecretPath(p, config);
for (const [p, soll] of [
  ['/Users/myki/develop/projekt/.env', true],
  ['/Users/myki/develop/projekt/.env.production', true],
  ['/Users/myki/.ssh/id_rsa', true],
  ['/Users/myki/.aws/credentials', true],
  ['/Users/myki/develop/zert.pem', true],
  ['/Users/myki/.gnupg/secring.gpg', true],
  ['/Users/myki/develop/projekt/index.ts', false],
  ['/Users/myki/develop/projekt/README.md', false],
  ['/Users/myki/develop/environment.ts', false],
  // Rollen-Isolation: ~/.leaven ist gesperrt, damit eine Rolle nicht die
  // Bereiche und Onboarding-Texte der anderen Rollen lesen kann. Die Ausnahmen
  // (eigenes Rollenverzeichnis, rollenzugriff) sitzen in securePath, nicht hier.
  ['/Users/myki/.leaven/roles.json', true],
  ['/Users/myki/.leaven/roles/.andere/onboarding.md', true],
  ['/Users/myki/.leaven/scopes.json', true],
]) {
  const treffer = secret(p) !== null;
  check(`${p} -> ${soll ? 'gesperrt' : 'frei'}`, treffer === soll, `erkannt als: ${secret(p)}`);
}

console.log('\n[9] Pfad-Erkennung in Argumenten');
console.log('     Bewusst grosszuegig: alles ausser Optionen wird geprueft.');
console.log('     Sonst waeren ".." und "." ungeprueft durchgelaufen (rm -rf ..).');
for (const [arg, soll] of [
  ['/Users/myki/.ssh', true], ['../../.ssh', true], ['~/.aws', true],
  ['./src', true], ['src/index.ts', true],
  ['..', true], ['.', true], ['datei.txt', true], ['suchbegriff', true],
  ['-rn', false], ['--color', false], ['-S', false],
]) {
  check(`${JSON.stringify(arg)} -> ${soll ? 'wird geprueft' : 'Option, uebersprungen'}`,
    g.looksLikePath(arg) === soll);
}

console.log('\n[9b] Eingebettete Pfade in Optionen (--file=/pfad, -f/pfad)');
console.log('     Sie beginnen mit "-" und wuerden sonst ungeprueft beim Kindprozess landen.');
for (const [arg, soll] of [
  ['--file=/Users/myki/.aws/credentials', ['/Users/myki/.aws/credentials']],
  ['--exclude-from=../liste', ['../liste']],
  ['--color=auto', ['auto']],
  ['--include=*.ts', ['*.ts']],
  ['--opt=', []],
  ['-f/etc/passwd', ['/etc/passwd']],
  ['-rf/etc/passwd', ['/etc/passwd', 'f/etc/passwd']],
  ['-fsrc/x', ['/x', 'src/x']],
  ['-rn', []], ['-n5', []], ['--follow', []], ['-', []], ['--', []], ['datei.txt', []],
]) {
  const ist = g.eingebetteteWerte(arg);
  check(`${JSON.stringify(arg)} -> ${JSON.stringify(soll)}`, JSON.stringify(ist) === JSON.stringify(soll), JSON.stringify(ist));
}

console.log('\n[10] Umgebung saeubern');
{
  const clean = g.scrubEnvironment({
    DEEPSEEK_API_KEY: 'sk-geheim', GITHUB_TOKEN: 't', AWS_SECRET_ACCESS_KEY: 's',
    MY_PASSWORD: 'p', DB_SECRET: 'x', PATH: '/usr/bin', HOME: '/Users/myki', LANG: 'de_DE',
  });
  check('DEEPSEEK_API_KEY entfernt', clean.DEEPSEEK_API_KEY === undefined);
  check('GITHUB_TOKEN entfernt', clean.GITHUB_TOKEN === undefined);
  check('AWS_SECRET_ACCESS_KEY entfernt', clean.AWS_SECRET_ACCESS_KEY === undefined);
  check('MY_PASSWORD entfernt', clean.MY_PASSWORD === undefined);
  check('DB_SECRET entfernt', clean.DB_SECRET === undefined);
  check('PATH bleibt erhalten', clean.PATH === '/usr/bin');
  check('HOME bleibt erhalten', clean.HOME === '/Users/myki');
}

console.log('\n[11] sed lese-only Zeilenbereich -> intern (kind=sedread), KEIN sed-Prozess');
{
  // Die sichere Form wird abgefangen und als Zeilen-Read behandelt.
  const v = verdict("sed -n '2200,2262p' src/index.ts");
  check("sed -n '2200,2262p' datei -> sedread", v.kind === 'sedread', `kind=${v.kind}`);
  check('  request nennt Pfad, Start, Ende',
    v.kind === 'sedread' && v.request.path === 'src/index.ts' && v.request.start === 2200 && v.request.end === 2262,
    JSON.stringify(v.request));

  const einzel = verdict("sed -n '5p' datei.txt");
  check("sed -n '5p' -> sedread, start=ende=5",
    einzel.kind === 'sedread' && einzel.request.start === 5 && einzel.request.end === 5, `kind=${einzel.kind}`);

  const bisEnde = verdict("sed -n '10,$p' datei.txt");
  check("sed -n '10,$p' -> sedread, ende=Infinity",
    bisEnde.kind === 'sedread' && bisEnde.request.start === 10 && bisEnde.request.end === Infinity, JSON.stringify(bisEnde.request));

  // Direkter Test der Erkennungsfunktion.
  check('erkenneSedLesebereich direkt', g.erkenneSedLesebereich({ program: 'sed', args: ['-n', '3,7p', 'a.txt'] }) !== null);
}

console.log('\n[11b] Gefaehrliche/andere sed-Formen sind NIEMALS sedread -> Dialog (ask)');
for (const cmd of [
  "sed -i 's/a/b/' datei",          // in-place: schreibt
  "sed 's/a/b/e' datei",            // s///e: fuehrt Shell-Befehl aus
  "sed -n '1e rm -rf ~' datei",     // e-Kommando: startet eine Shell
  "sed -n '1,5d' datei",            // d statt p: kein reiner Lesebereich
  "sed -n 'p' datei",               // keine Zeilennummer
  "sed -f skript.sed datei",        // Skriptdatei
  "sed -n '5,1p' datei",            // Ende < Start
  "sed -n '2200,2262p' -i datei",   // Zusatzflag -i
]) {
  const v = verdict(cmd);
  check(JSON.stringify(cmd), v.kind === 'ask', `kind=${v.kind}`);
}
{
  // Der Dialog-Hinweis nennt die sichere Form.
  const v = verdict("sed -i 's/a/b/' datei");
  check('  Hinweis nennt die lese-only Form', /sed -n/.test(v.reason || ''), v.reason || '');
}

console.log(`\n${'='.repeat(50)}`);
console.log(`${pass} bestanden, ${fail} fehlgeschlagen`);
process.exit(fail === 0 ? 0 : 1);
