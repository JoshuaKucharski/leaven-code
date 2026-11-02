import * as path from 'path';

export interface CommandRule {
  forbidFlags?: string[];
  allowSubcommands?: string[];
}

export interface PhpLintRule {
  program: string;      // erwartetes Programm, z.B. "php"
  onlyFlag: string;     // das EINZIGE erlaubte Options-Argument, z.B. "-l"
  requirePathArg: boolean;
}

export interface CommandConfig {
  allowed: Record<string, CommandRule>;
  secretPatterns: string[];
  secretDirectories: string[];
  // Programme, die auf ein besseres Werkzeug umgeleitet werden (z.B. cp → copy_file).
  // Der Wert ist der Hinweis, der ans Modell zurückgeht. Kein Nutzer-Dialog.
  redirects?: Record<string, string>;
  // Vom Menschen gepflegte, für das Modell unveränderbare Liste vollständiger Befehle,
  // die ohne Rückfrage laufen dürfen. Wird aus ~/.leaven/allowed-commands.json geladen.
  allowedCommands?: string[];
  // Enge Ausnahme für den ausführungsfreien Syntax-Check (php -l). Siehe checkCommand.
  phpLint?: PhpLintRule;
}

export interface ParsedCommand {
  program: string;
  args: string[];
}

// Anfrage für die lese-only Zeilenbereich-Form von sed. Wird NICHT als Prozess
// ausgeführt, sondern intern als Zeilen-Lesen behandelt (siehe erkenneSedLesebereich).
export interface SedReadRequest {
  path: string;
  start: number;
  end: number;   // Number.POSITIVE_INFINITY = bis Dateiende (sed-Adresse $)
}

export type GuardVerdict =
  | { kind: 'ok'; parsed: ParsedCommand }
  | { kind: 'reject'; reason: string }        // niemals ausführen
  | { kind: 'ask'; parsed: ParsedCommand; reason: string }   // Freigabe-Dialog
  | { kind: 'redirect'; reason: string }      // nicht ausführen, dem Modell die bessere Alternative nennen
  // sed in der lese-only Form (sed -n 'N,Mp' datei): KEIN sed-Prozess, sondern
  // intern die Zeilen lesen und exakt sed-gleich zurückgeben. Ohne Dialog.
  | { kind: 'sedread'; parsed: ParsedCommand; request: SedReadRequest }
  // vom Menschen vermerkt bzw. enger Lint – ohne Dialog.
  // pruefePfade: false = vorregistrierter EXAKTER Befehl, dem Menschen vertraut, keine
  //              weitere Argumentprüfung. true = Lint, dessen Zielpfad noch gegen den
  //              Lesebereich geprüft werden muss (die Datei variiert, ist nicht vermerkt).
  | { kind: 'allow'; parsed: ParsedCommand; pruefePfade: boolean };

// Zeichen, die nur eine Shell interpretiert. Da wir ohne Shell ausführen, wären sie
// entweder wirkungslos (und der Befehl täte etwas anderes als gedacht) oder ein
// Versuch, mehrere Befehle unterzubringen. Beides wird abgelehnt.
const SHELL_METACHARACTERS = /[;&|<>`\n\r]|\$\(|\$\{/;

// Shell-Interpreter: Ein Skript-Aufruf hierüber (bash x.sh) umgeht die No-Shell-Grenze und
// wird zum sicheren Weg (propose_command) gelenkt. Nur zur Hinweis-Erkennung.
const SHELL_PROGRAMME = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh']);

/**
 * Zerlegt einen Befehlsstring in Programm und Argumente – bewusst OHNE Shell-Semantik.
 * Es werden ausschliesslich Anführungszeichen berücksichtigt, damit Argumente mit
 * Leerzeichen funktionieren. Keine Expansion von Variablen, Globs oder Tilde.
 */
export function parseCommand(input: string): ParsedCommand | null {
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let hasContent = false;

  for (let i = 0; i < input.length; i++) {
    const char = input[i];

    if (quote) {
      if (char === quote) quote = null;
      else current += char;
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      hasContent = true;
      continue;
    }

    if (char === ' ' || char === '\t') {
      if (current || hasContent) { tokens.push(current); current = ''; hasContent = false; }
      continue;
    }

    current += char;
  }

  if (quote) return null;                      // unbalancierte Anführungszeichen
  if (current || hasContent) tokens.push(current);
  if (tokens.length === 0) return null;

  return { program: tokens[0], args: tokens.slice(1) };
}

/**
 * Sieht das Argument nach einem Pfad aus? Bewusst grosszügig: alles, was keine Option
 * ist, gilt als möglicher Pfad.
 *
 * Eine engere Regel (nur mit "/" darin) übersah ".." und "." – `rm -rf ..` wäre
 * ungeprüft durchgelaufen. Ein Suchbegriff wie "passwort" löst sich gegen den
 * Lesebereich auf und liegt damit innerhalb, verursacht also keine Falsch-Ablehnung.
 */
export function looksLikePath(arg: string): boolean {
  if (arg.startsWith('-')) return false;
  return arg.length > 0;
}

/**
 * Pfadartige Werte, die in einer Option stecken und die looksLikePath übersieht, weil das
 * Argument mit "-" beginnt:
 *   --file=/pfad, --exclude-from=liste   -> der Wert hinter "="
 *   -f/pfad, -rf/pfad                    -> angehängter Wert einer Kurzoption
 * Ohne diese Prüfung läse "grep --file=~/.aws/credentials -r ." eine Geheimnisdatei als
 * Musterliste – ausserhalb des Lesebereichs, ohne Dialog. Werte hinter "=" werden immer
 * geliefert (auch "auto" oder "*.ts"): Sie lösen sich gegen den Lesebereich auf und stören
 * dort nicht – dieselbe Grosszügigkeit wie bei looksLikePath. Bei Kurzoptionen nur, wenn ein
 * "/" vorkommt; weil nicht bekannt ist, welcher Buchstabe den Wert trägt (-rf/x: r oder f?),
 * kommen beide Lesarten zurück – der Teil ab dem ersten "/" und der Teil nach dem ersten
 * Buchstaben. Lieber einmal zu streng (-fsrc/x besser als "-f src/x" schreiben) als eine Lücke.
 */
export function eingebetteteWerte(arg: string): string[] {
  if (!arg.startsWith('-') || arg === '-' || arg === '--') return [];
  const gleich = arg.indexOf('=');
  if (gleich >= 0) {
    const wert = arg.slice(gleich + 1);
    return wert ? [wert] : [];
  }
  if (arg.startsWith('--')) return [];
  const slash = arg.indexOf('/');
  if (slash < 0) return [];
  return [...new Set([arg.slice(slash), arg.slice(2)])].filter(Boolean);
}

/**
 * Trifft eine gesperrte Option auf ein Argument zu? Vier Schreibweisen, die getopt alle
 * akzeptiert – ohne 3 und 4 liesse sich jede Sperre umgehen:
 *   1. exakt                       -S             ist -S
 *   2. lange Option mit Wert       --follow=name  beginnt mit "--follow="
 *   3. gebündelte Kurzoptionen     -rSn           enthält S
 *   4. GNU-Abkürzung               --deref        ist Anfang von --dereference-recursive
 * Falschtreffer sind möglich (-eS meint das Muster "S") und bewusst hingenommen: Das Modell
 * bekommt eine klare Ablehnung und schreibt die Option getrennt.
 */
export function flagGesperrt(arg: string, forbidden: string): boolean {
  if (arg === forbidden || arg.startsWith(`${forbidden}=`)) return true;
  const kurzesFlag = /^-[^-]$/.test(forbidden);
  if (kurzesFlag && /^-[^-]/.test(arg) && arg.length > 2 && arg.includes(forbidden[1])) return true;
  if (forbidden.startsWith('--') && arg.startsWith('--') && arg.length > 2
      && arg.length < forbidden.length && forbidden.startsWith(arg)) return true;
  return false;
}

function matchesGlob(name: string, pattern: string): boolean {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`, 'i').test(name);
}

/**
 * Ist der Pfad eine Geheimnisdatei? Prüft Dateinamen gegen Muster und jeden
 * Verzeichnisbestandteil gegen die Liste gesperrter Verzeichnisse.
 */
export function isSecretPath(fullPath: string, config: CommandConfig): string | null {
  const segments = fullPath.split(path.sep).filter(Boolean);
  const name = segments[segments.length - 1] || '';

  for (const dir of config.secretDirectories) {
    const parts = dir.split('/');
    for (let i = 0; i + parts.length <= segments.length; i++) {
      if (parts.every((part, k) => segments[i + k] === part)) return dir;
    }
  }

  for (const pattern of config.secretPatterns) {
    if (matchesGlob(name, pattern)) return pattern;
  }
  return null;
}

/**
 * Darf ein Registry-Eintrag ohne Rückfrage laufen? Für Shell-Skripte (bash x.sh) nur, wenn
 * das Skript in der geschützten Zone ~/.leaven liegt – sonst könnte der Assistent es
 * umschreiben und unbeaufsichtigt ausführen. Andere Programme sind hier unbeschränkt (der
 * Mensch hat die exakte Zeile vermerkt); die Ausführungsgrenzen greifen separat.
 */
export function registryEintragErlaubt(zeile: string, homeVerzeichnis: string): boolean {
  const parsed = parseCommand(zeile);
  if (!parsed) return false;
  if (!SHELL_PROGRAMME.has(parsed.program)) return true;
  const skript = parsed.args.find(a => !a.startsWith('-'));
  if (!skript) return false;
  const wurzel = path.join(homeVerzeichnis, '.leaven');
  const expandiert = skript.startsWith('~/') ? path.join(homeVerzeichnis, skript.slice(2)) : skript;
  const real = path.resolve(expandiert);
  return real === wurzel || real.startsWith(wurzel + path.sep);
}

/** Programm gleich und Argumente elementweise gleich – für den Registry-Abgleich. */
export function gleicheBefehle(a: ParsedCommand, b: ParsedCommand): boolean {
  return a.program === b.program
    && a.args.length === b.args.length
    && a.args.every((wert, i) => wert === b.args[i]);
}

/**
 * Ist der Befehl ein reiner, ausführungsfreier Syntax-Check (php -l <pfad>)?
 * Streng: das EINZIGE Options-Argument ist onlyFlag, kein weiteres Flag (verhindert
 * `-r`, `-f`, `-a` und die ini-Injektion `-d auto_prepend_file=…`), und es gibt einen Pfad.
 */
function istReinerLint(parsed: ParsedCommand, rule: PhpLintRule): boolean {
  if (parsed.program !== rule.program) return false;
  const optionen = parsed.args.filter(a => a.startsWith('-'));
  const pfade = parsed.args.filter(a => !a.startsWith('-'));
  if (optionen.length !== 1 || optionen[0] !== rule.onlyFlag) return false;
  if (rule.requirePathArg && pfade.length < 1) return false;
  return true;
}

/**
 * Hinweis für einen „Beinahe-Treffer": Das Modell hat einen vorregistrierten Befehl oder
 * den Lint mit zusätzlichen Flags/Argumenten aufgerufen, sodass er nicht ohne Rückfrage
 * durchgeht. Die Rückmeldung nennt die durchgehende Form, damit das Modell es ohne die
 * Zusätze erneut versucht. Nur ein Hinweis – die Sicherheit bleibt unberührt.
 */
function naeherTreffer(parsed: ParsedCommand, config: CommandConfig): string | null {
  // 1. Ein vorregistrierter Befehl, dem nur zusätzliche Argumente angehängt wurden.
  for (const eintrag of config.allowedCommands ?? []) {
    const r = parseCommand(eintrag);
    if (r && r.program === parsed.program
        && r.args.length < parsed.args.length
        && r.args.every((wert, i) => wert === parsed.args[i])) {
      const extra = parsed.args.slice(r.args.length).join(' ');
      return `Der Befehl "${eintrag}" ist vorregistriert und läuft OHNE Rückfrage. ` +
        `Lass die zusätzlichen Argumente (${extra}) weg, dann braucht es keine Freigabe.`;
    }
  }
  // 2. php-Lint mit zusätzlichen Flags neben -l.
  const lint = config.phpLint;
  if (lint && parsed.program === lint.program
      && parsed.args.includes(lint.onlyFlag)
      && parsed.args.some(a => !a.startsWith('-'))) {
    const extraFlags = parsed.args.filter(a => a.startsWith('-') && a !== lint.onlyFlag);
    if (extraFlags.length > 0) {
      return `Ein reiner Syntax-Check "php ${lint.onlyFlag} <datei>" läuft OHNE Rückfrage. ` +
        `Entferne die zusätzlichen Flags (${extraFlags.join(' ')}) – sie können Code ausführen und sind gesperrt.`;
    }
  }
  // 3b. sed ausserhalb der lese-only Zeilenbereich-Form: auf die sichere Form hinweisen.
  if (parsed.program === 'sed' && !erkenneSedLesebereich(parsed)) {
    return `Von sed läuft nur die lese-only Form "sed -n 'START,ENDp' <datei>" ohne ` +
      `Rückfrage (z.B. sed -n '2200,2262p' src/index.ts) – sie liest genau diesen ` +
      `Zeilenbereich. Andere sed-Aufrufe (-i, s///e, -f, w/r …) können Dateien ` +
      `verändern oder Programme starten und brauchen eine Freigabe.`;
  }
  // 3. Shell-Skript (bash/sh …) ausserhalb der Registry: zum sicheren Weg lenken.
  if (SHELL_PROGRAMME.has(parsed.program) && parsed.args.some(a => !a.startsWith('-'))) {
    return `Shell-Skripte umgehen die Sicherheitsgrenzen und laufen nicht ohne Freigabe. ` +
      `Bündle Befehle nicht in ein Skript, um die Rückfrage zu umgehen. Brauchst du einen ` +
      `festen Prüflauf regelmäßig, schlage ihn mit propose_command vor – nach menschlicher ` +
      `Freigabe liegt das Skript in ~/.leaven/approved-scripts/ und läuft ohne Rückfrage. ` +
      `Bis dahin führe die Befehle einzeln aus.`;
  }
  return null;
}

/**
 * Erkennt AUSSCHLIESSLICH die nachweislich lese-only Form von sed:
 *   sed -n 'START,ENDp' <pfad>     (Zeilenbereich)
 *   sed -n 'STARTp'     <pfad>     (Einzelzeile)
 *   sed -n 'START,$p'   <pfad>     (ab START bis Dateiende)
 * Genau drei Argumente: -n, das reine Druckskript, ein Pfad. Alles andere trifft
 * NICHT zu und fällt in die normale Prüfung (Freigabe-Dialog): sed -i (schreibt),
 * s///e und das e-Kommando (führen Shell-Befehle aus), -f (Skriptdatei), w/r
 * (schreiben/lesen), mehrere Skripte oder Zusatzflags.
 *
 * Sinn: Diese Form liest nur einen Zeilenbereich. Der Aufrufer führt dafür KEIN
 * sed aus, sondern liest die Zeilen selbst – kein Prozess, keine Shell, kein -i,
 * kein e-Kommando. Die gesamte Angriffsfläche von sed entfällt, das Ergebnis ist
 * identisch mit dem, was `sed -n 'N,Mp'` ausgegeben hätte.
 */
export function erkenneSedLesebereich(parsed: ParsedCommand): SedReadRequest | null {
  if (parsed.program !== 'sed') return null;
  if (parsed.args.length !== 3) return null;
  if (parsed.args[0] !== '-n') return null;
  const skript = parsed.args[1];
  const pfad = parsed.args[2];
  if (pfad.startsWith('-')) return null;
  // START[,END]p – END ist eine Zahl oder $ (Dateiende). Keine weiteren Kommandos.
  const m = /^(\d+)(?:,(\d+|\$))?p$/.exec(skript);
  if (!m) return null;
  const start = parseInt(m[1], 10);
  if (!Number.isFinite(start) || start < 1) return null;
  let end: number;
  if (m[2] === undefined) end = start;                 // Einzelzeile
  else if (m[2] === '$') end = Number.POSITIVE_INFINITY; // bis Dateiende
  else end = parseInt(m[2], 10);
  if (end < start) return null;
  return { path: pfad, start, end };
}

/**
 * Prüft einen Befehl gegen die Allowlist.
 *
 * Wichtig: Ein nicht gelistetes Programm wird NICHT abgelehnt, sondern landet im
 * Freigabe-Dialog. Die Allowlist ersetzt die Rückfrage, sie verbietet nicht zusätzlich.
 */
export function checkCommand(command: string, config: CommandConfig): GuardVerdict {
  if (SHELL_METACHARACTERS.test(command)) {
    return {
      kind: 'reject',
      reason: 'Befehle werden ohne Shell ausgeführt. Verkettung (;, &&), Pipes (|), ' +
              'Umleitungen (>, <) und Ersetzungen ($(…), `…`) sind nicht möglich. ' +
              'Formuliere einen einzelnen Befehl – für Dateiinhalte nutze read_file.',
    };
  }

  const parsed = parseCommand(command);
  if (!parsed) {
    return { kind: 'reject', reason: 'Befehl konnte nicht zerlegt werden (unbalancierte Anführungszeichen?).' };
  }

  // Ein Programm mit Pfadangabe umgeht die Namensprüfung – nicht zulassen.
  if (parsed.program.includes('/')) {
    return { kind: 'ask', parsed, reason: `Programm mit Pfadangabe: ${parsed.program}` };
  }

  // sed in der lese-only Zeilenbereich-Form (sed -n 'N,Mp' datei) wird NICHT als
  // Prozess gestartet, sondern intern als Zeilen-Lesen behandelt. So bekommt das
  // Modell dasselbe Ergebnis, ohne dass sed mit seinen gefährlichen Fähigkeiten
  // (-i schreibt, e-Kommando startet eine Shell) je läuft. Nur diese strenge Form
  // greift; jeder andere sed-Aufruf läuft weiter in den Freigabe-Dialog.
  const sedRead = erkenneSedLesebereich(parsed);
  if (sedRead) return { kind: 'sedread', parsed, request: sedRead };

  // Umleitung: Für manche Programme gibt es ein sichereres, eingegrenztes Werkzeug
  // (cp → copy_file). Statt den Nutzer bei jedem Backup zu fragen, bekommt das Modell
  // direkt den Hinweis auf das richtige Werkzeug zurück – ohne Ausführung, ohne Dialog.
  const umleitung = config.redirects?.[parsed.program];
  if (umleitung) {
    return { kind: 'redirect', reason: umleitung };
  }

  // Vom Menschen vorregistrierte, vollständige Befehle laufen ohne Rückfrage. Der EXAKTE
  // Vergleich (Programm + alle Argumente) verhindert, dass angehängte Flags mit durchgehen.
  // pruefePfade: false – der Mensch hat genau diese Zeile vermerkt, ihr wird vertraut.
  if (config.allowedCommands?.some(eintrag => {
    const r = parseCommand(eintrag);
    return r !== null && gleicheBefehle(r, parsed);
  })) {
    return { kind: 'allow', parsed, pruefePfade: false };
  }

  // Enge Ausnahme: php -l <pfad> ist ein ausführungsfreier Syntax-Check. Der Zielpfad wird
  // beim Ausführen weiterhin gegen den Lesebereich geprüft (pruefePfade: true).
  if (config.phpLint && istReinerLint(parsed, config.phpLint)) {
    return { kind: 'allow', parsed, pruefePfade: true };
  }

  const rule = config.allowed[parsed.program];
  if (!rule) {
    // Beinahe-Treffer? Dann dem Modell die durchgehende Form nennen, statt nur zu fragen.
    const hinweis = naeherTreffer(parsed, config);
    return {
      kind: 'ask',
      parsed,
      reason: hinweis
        ? `${parsed.program} steht nicht auf der Allowlist. ${hinweis}`
        : `${parsed.program} steht nicht auf der Allowlist`,
    };
  }

  for (const arg of parsed.args) {
    for (const forbidden of rule.forbidFlags ?? []) {
      // exakt, mit Wert (--file=x), gebündelt (-rS) und als GNU-Abkürzung (--deref)
      if (flagGesperrt(arg, forbidden)) {
        // grep -R ist unter GNU gefährlich, die harmlose Form nur einen Buchstaben entfernt.
        const tipp = parsed.program === 'grep' && (forbidden === '-R' || forbidden === '--dereference-recursive')
          ? ' Rekursiv ohne Symlinks: -r (klein).'
          : '';
        const wo = arg === forbidden ? '' : ` (in "${arg}")`;
        return {
          kind: 'reject',
          reason: `Option ${forbidden} ist für ${parsed.program} gesperrt${wo} – sie kann Dateien verändern, ` +
                  `Programme starten oder Symlinks aus dem erlaubten Bereich hinausführen.${tipp}`,
        };
      }
    }
  }

  if (rule.allowSubcommands) {
    const sub = parsed.args.find(a => !a.startsWith('-'));
    if (!sub) {
      return { kind: 'ask', parsed, reason: `${parsed.program} ohne Unterbefehl` };
    }
    if (!rule.allowSubcommands.includes(sub)) {
      return {
        kind: 'ask',
        parsed,
        reason: `${parsed.program} ${sub} ist nicht freigegeben (erlaubt: ${rule.allowSubcommands.join(', ')})`,
      };
    }
  }

  return { kind: 'ok', parsed };
}

/** Entfernt Zugangsdaten aus der Umgebung des Kindprozesses. */
export function scrubEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const cleaned: NodeJS.ProcessEnv = {};
  const sensitive = /(_KEY|_TOKEN|_SECRET|_PASSWORD|_PASSWD|_CREDENTIALS|API_KEY)$|^(DEEPSEEK_API_KEY|AWS_|GITHUB_TOKEN|OPENAI_)/i;

  for (const [name, value] of Object.entries(env)) {
    if (!sensitive.test(name)) cleaned[name] = value;
  }
  return cleaned;
}
