#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as readline from 'readline';
import axios from 'axios';
import dotenv from 'dotenv';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { LoopBreaker } from './guards/loopBreaker.js';
import {
  checkCommand, isSecretPath, looksLikePath, scrubEnvironment, registryEintragErlaubt, CommandConfig
} from './guards/commandGuard.js';
import { pruefeUrl, htmlZuText } from './guards/urlGuard.js';
import { providerFor, capabilitiesFor, ALLE_MODELLE, aufloesenModell } from './providers/capabilities.js';
import { callAnthropic } from './providers/anthropic.js';
import { callQwen } from './providers/qwen.js';
import { streamOpenAiCompatible } from './providers/openaiStream.js';
import {
  UsageDaten, ANBIETER, leereUsage, resetWennNeuerTag, addVerbrauch, ueberBudget, tokenSumme
} from './usage.js';
import { SessionDaten, sessionGueltig } from './session.js';
import { boardAktiv, meldeArbeitBegonnen, meldeFortschritt, meldeAbgeschlossen } from './board.js';
import { truncate, parseArgs, liesZeilenBereich, shortPath, maskiere, formatAssistantMessage, summarizeArgs } from './util/text.js';
import { expandHome, realpathSoFar, isDirectory, subdirectories } from './util/pfade.js';
import { zustand, PlanSchritt, SchrittStatus } from './state.js';
import { istAbgeschlossen, planBalken, planListe, zeigePlan } from './plan.js';
import { extractToolCalls, repairHistory, trimHistory } from './history.js';

const config = require('../config/loopBreaker.json');

dotenv.config();

const execFileAsync = promisify(execFile);

const commandConfig: CommandConfig = require('../config/commands.json');

// Wurzel der geschützten Zone. ~/.leaven steht auf der Geheimnis-Sperrliste – der
// Assistent kann hier weder lesen noch schreiben. Die Registry und freigegebene Skripte
// liegen deshalb hier, für das Modell unveränderbar.
const LEAVEN_ROOT = path.join(os.homedir(), '.leaven');
const REQUESTED_DIR = path.join(LEAVEN_ROOT, 'requested-commands');

// ---- Tages-Token-Budget (pro Anbieter, persistent) ----
const USAGE_DATEI = path.join(LEAVEN_ROOT, 'usage.json');
const heutigesDatum = () => new Date().toISOString().slice(0, 10);
let usageDaten: UsageDaten = leereUsage(heutigesDatum());
(() => {
  try {
    const roh = JSON.parse(require('fs').readFileSync(USAGE_DATEI, 'utf-8'));
    if (roh && typeof roh === 'object') usageDaten = roh;
  } catch { /* keine Datei – frisch */ }
  usageDaten = resetWennNeuerTag(usageDaten, heutigesDatum());
})();
function speichereUsage(): void {
  try {
    require('fs').mkdirSync(LEAVEN_ROOT, { recursive: true });
    require('fs').writeFileSync(USAGE_DATEI, JSON.stringify(usageDaten, null, 2), 'utf-8');
  } catch { /* nicht schreibbar – Zählung bleibt in-memory */ }
}
/** Verbrauch eines Aufrufs verbuchen (Tageswechsel wird dabei berücksichtigt). */
function zaehleTokens(anbieter: string, usage: any): void {
  const t = tokenSumme(usage);
  if (t <= 0) return;
  usageDaten = resetWennNeuerTag(usageDaten, heutigesDatum());
  addVerbrauch(usageDaten, anbieter, t);
  speichereUsage();
}

// ---- Konversations-Persistenz für „weiter" (nach Auto-Stopp) ----
const SESSION_DATEI = path.join(LEAVEN_ROOT, 'session.json');
let geladeneSession: SessionDaten | null = null;   // beim Start aus session.json geladen

/** Beim Start laden – nur, wenn die Datei existiert UND gültig ist. */
function ladeSession(): void {
  try {
    const roh = JSON.parse(require('fs').readFileSync(SESSION_DATEI, 'utf-8'));
    if (sessionGueltig(roh)) geladeneSession = roh;
  } catch { /* keine/kaputte Session – ignorieren */ }
}
/** Unterbrochene Aufgabe sichern (kompletter Zustand). Hält geladeneSession = Spiegel der Datei. */
function speichereSession(messages: any[], label: string): void {
  const daten: SessionDaten = {
    datum: heutigesDatum(),
    label,
    model: settings.model,
    thinking: settings.thinking,
    effort: settings.effort,
    messages,
    plan: zustand.plan,
  };
  try {
    require('fs').mkdirSync(LEAVEN_ROOT, { recursive: true });
    require('fs').writeFileSync(SESSION_DATEI, JSON.stringify(daten, null, 2), 'utf-8');
    geladeneSession = daten;   // In-Memory-Spiegel: "weiter" trifft immer den echten Dateistand
  } catch { /* nicht schreibbar – dann eben kein Fortsetzen */ }
}
/** Gespeicherte Session verwerfen (Aufgabe erledigt). Löscht Datei UND Spiegel. */
function loescheSession(): void {
  try { require('fs').rmSync(SESSION_DATEI, { force: true }); } catch { /* egal */ }
  geladeneSession = null;
}
/** Kurzes Label für die Anzeige: die ZULETZT gestellte Nutzer-Aufgabe, gekürzt. */
function aktuellesLabel(messages: any[]): string {
  const letzte = [...messages].reverse().find(m => m && m.role === 'user' && typeof m.content === 'string');
  const text = (letzte?.content || 'Aufgabe').replace(/\s+/g, ' ').trim();
  return text.length > 60 ? `${text.slice(0, 60)}…` : text;
}
// Gehört session.json der AKTUELLEN Konversation? Nur dann darf ihr Abschluss die Datei löschen –
// eine beim Start geladene, nie fortgesetzte fremde Session bleibt sonst unangetastet (Bug 2).
let sessionGehoertAktuell = false;

/** §F.3 – Abschluss ans Board melden. Nur bei echtem Turn-Abschluss ('fertig') aus den
 *  unbeaufsichtigten Flows aufrufen. Best-Effort: schluckt Fehler, blockiert nie. */
async function meldeAbschlussFallsBoard(): Promise<void> {
  if (!boardAktiv()) return;
  const r = await meldeAbgeschlossen();
  if (r.gemeldet > 0) console.log(chalk.gray(`  ↪ Board: ${r.gemeldet} Feature(s) auf „erledigt" gemeldet.`));
  else if (r.fehler) console.log(chalk.gray(`  ↪ Board-Abschluss übersprungen (${r.fehler}).`));
}

/** Setzt eine gespeicherte Session fort: Zustand wiederherstellen und den Turn laufen lassen.
 *  Wird von „weiter", /resume und dem Auto-Start genutzt. */
async function sessionFortsetzen(rl: readline.Interface, messages: any[], readLine: Ask, s: SessionDaten): Promise<void> {
  messages.length = 0;                 // History durch den gespeicherten Stand ersetzen
  messages.push(...s.messages);
  zustand.plan = s.plan;
  settings.model = s.model;            // Format-Invariante: dasselbe Modell/Thinking wieder
  settings.thinking = s.thinking;
  settings.effort = s.effort;
  aktualisiereApiKey();               // Schlüssel des (evtl. anderen) Providers ziehen
  aktualisiereSystemPrompt(messages); // Systemprompt an die AKTUELLEN Bereiche anpassen
  sessionGehoertAktuell = true;       // diese Konversation besitzt jetzt den gespeicherten Slot
  console.log(chalk.gray(`  ↻ Fortsetzen: „${s.label}" (Modell ${s.model}).`));
  try {
    const status = await runAgentTurn(rl, messages, readLine);
    if (status === 'budget') speichereSession(messages, s.label);
    else {
      if (status === 'fertig') await meldeAbschlussFallsBoard();
      loescheSession(); sessionGehoertAktuell = false;
    }
  } catch (error: any) {
    console.log(chalk.red(`\n❌ ${error.response?.data?.error?.message || error.message}`));
    repairHistory(messages);
    speichereSession(messages, s.label);  // Fortschritt gültig sichern, nicht verlieren
  }
  trimHistory(messages);
}

// Vom Menschen gepflegte Liste vollständiger Befehle, die OHNE Rückfrage laufen dürfen.
// Liegt in ~/.leaven (secretDirectories) – für das Modell unlesbar/unschreibbar. Die
// CLI liest sie direkt (nicht über securePath, das nur Modell-Tool-Aufrufe gated). Fehlt
// die Datei oder ist sie fehlerhaft, bleibt die Liste leer – dann fragt alles wie bisher.
(() => {
  try {
    const datei = path.join(LEAVEN_ROOT, 'allowed-commands.json');
    const roh = JSON.parse(require('fs').readFileSync(datei, 'utf-8'));
    if (!Array.isArray(roh)) return;
    const gueltig: string[] = [];
    for (const zeile of roh) {
      if (typeof zeile !== 'string' || !zeile.trim()) continue;
      // Footgun-Schutz: Ein registriertes Shell-Skript (bash/sh …) läuft nur ohne Rückfrage,
      // wenn das Skript in der geschützten Zone liegt. Sonst könnte der Assistent es
      // umschreiben und beliebigen Code unbeaufsichtigt ausführen.
      if (!registryEintragErlaubt(zeile, os.homedir())) {
        process.stderr.write(
          `⚠️  Registry-Eintrag ignoriert (Shell-Skript ausserhalb ~/.leaven): "${zeile}"\n` +
          `    Nur Skripte in ~/.leaven/approved-scripts/ dürfen ohne Rückfrage laufen.\n`);
        continue;
      }
      gueltig.push(zeile);
    }
    commandConfig.allowedCommands = gueltig;
  } catch { /* keine Registry vorhanden – nichts läuft ohne Rückfrage durch */ }
})();

// Geheimnisdateien sind auch innerhalb der erlaubten Bereiche gesperrt. Bewusst
// abschaltbar, damit man an einer .env arbeiten kann – dann aber sichtbar.
const ALLOW_SECRETS = process.argv.includes('--allow-secrets');

// Getrennte Grenzen: Der Lesebereich darf breiter sein als die Schreibbereiche.
//
// Lesen ist bewusst EIN Verzeichnis: Relative Pfade werden dagegen aufgelöst –
// bei einer Liste gäbe es keinen eindeutigen Bezugspunkt, und genau diese
// Mehrdeutigkeit hat hier schon zweimal Fehler verursacht.
//
// Schreiben ist eine LISTE: Wer an zwei Projekten arbeitet, musste sonst das
// gemeinsame Elternverzeichnis freigeben – und damit auch alles andere darunter.
const roots = { read: process.cwd(), write: [process.cwd()] as string[] };

/** Liegt der Pfad in einem der Schreibbereiche? */
function imSchreibbereich(pfad: string): boolean {
  return roots.write.some(w => pfad === w || pfad.startsWith(w + path.sep));
}

const schreibbereicheText = () => roots.write.map(shortPath).join(', ');

// Was ohne Rückfrage laufen darf. Vorgaben, damit der Start ohne Rechtefragen
// auskommt – umstellbar über /rights.
//
//   read:  nur Lesen, auf den Lesebereich begrenzt
//   write: die Checkbox-Auswahl der Projekte IST die bewusste Zustimmung
//   exec:  aus, weil Shell-Befehle sich nicht auf ein Verzeichnis begrenzen lassen;
//          Allowlist-Befehle laufen ohnehin ohne Rückfrage
const permissions = { read: true, write: true, exec: false };

// Freigegebene Domains für fetch_url. Leer = kein Netzzugriff. Wird von Rollen
// gesetzt oder zur Laufzeit über /internet.
let internetDomains: string[] = [];

const MAX_SEITE_BYTES = 100_000;
const MAX_WEITERLEITUNGEN = 3;

// Der einzige erlaubte Sende-Endpunkt. Zur Laufzeit über /endpoint änderbar.
let endpunktUeberschrieben: string | null = null;
const apiEndpunkt = (): string | null =>
  endpunktUeberschrieben ?? process.env.LEAVEN_API_ENDPOINT ?? (commandConfig as any).apiEndpoint ?? null;

/**
 * Prüft den Sende-Endpunkt. Läuft bei JEDEM Senden, nicht nur beim Einstellen –
 * sonst genügte eine editierte Konfigurationsdatei, um das Ziel umzubiegen.
 */
function pruefeEndpunkt(roh: string | null): { ok: true; url: URL } | { ok: false; grund: string } {
  if (!roh) {
    return { ok: false, grund: 'Nicht gesetzt. Der Nutzer kann ihn mit "/endpoint set <url>" festlegen.' };
  }
  // Genau eine Domain: dieselbe Prüfung wie bei fetch_url, mit der Endpunkt-Domain
  // als einziger Allowlist – inklusive Sperre interner Adressen.
  let url: URL;
  try { url = new URL(roh); } catch { return { ok: false, grund: `Keine gültige URL: ${roh}` }; }
  const verdict = pruefeUrl(url.toString(), [url.hostname]);
  if (!verdict.ok) return { ok: false, grund: verdict.grund };
  if (url.protocol !== 'https:') {
    return { ok: false, grund: 'Nur https ist erlaubt – über http gingen die Daten unverschlüsselt raus.' };
  }
  return { ok: true, url };
}

const TOOL_PERMISSION: Record<string, 'read' | 'write' | 'exec'> = {
  read_file: 'read',
  list_files: 'read',
  write_file: 'write',
  edit_file: 'write',
  // copy_file liest die Quelle UND schreibt das Ziel – wie edit_file gilt die engere
  // Grenze (Schreibrecht). Die Lese-Grenze der Quelle prüft securePath zusätzlich.
  copy_file: 'write',
  execute_command: 'exec',
  // Nur Lesen, und ausschliesslich von Domains, die der Nutzer selbst freigegeben hat.
  fetch_url: 'read',
  // post_to_endpoint steht BEWUSST nicht hier: Nicht gelistete Werkzeuge landen
  // immer im Freigabe-Dialog. Daten nach draussen zu senden soll jedes Mal eine
  // bewusste Entscheidung sein.
};

const API_URL = 'https://api.deepseek.com/v1/chat/completions';

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

// EIN Modell für ALLE Requests einer Konversation. Werden hier zwei verschiedene
// Modelle gemischt (z.B. ein Non-Thinking- und ein Thinking-Modell), lehnt DeepSeek
// den Folge-Request ab: "The `reasoning_content` in the thinking mode must be passed
// back to the API." Deshalb genau eine Konstante, kein zweiter Modellname im Code.
// Zur Laufzeit über Slash-Befehle änderbar. Modell und Thinking-Modus dürfen NICHT
// mitten in einer Konversation wechseln – siehe wechsleModell() weiter unten.
const settings = {
  model: argValue('--model') || process.env.DEEPSEEK_MODEL || 'deepseek-v4-pro',
  thinking: !process.argv.includes('--no-thinking'),
  effort: argValue('--effort') || 'high',
  temperature: 0.3,
  apiKey: '',
  // Zwei UNABHÄNGIGE Anzeige-Schalter (zur Laufzeit über /output umstellbar):
  //   zeigeGedanken – der graue Live-Gedankenstrom (Standard: aus)
  //   zeigeSchritte – die Zwischenschritte; aus = nur Endergebnis + Abschlussbericht (Standard: an)
  // --verbose = beides an, --quiet = beides aus.
  zeigeGedanken: process.argv.includes('--verbose'),
  zeigeSchritte: process.argv.includes('--verbose') || !process.argv.includes('--quiet'),
  // Tages-Token-Budget nur erzwingen, wenn Auto-Stopp an ist (sonst wird nur gezählt).
  // Persistiert in usage.json – überlebt Neustart (usageDaten ist hier bereits geladen).
  autoStopp: usageDaten.autoStopp ?? false,
  // Beim Start automatisch fortsetzen (ohne „weiter"), wenn eine Session vorliegt + Budget frei.
  autoWeiter: usageDaten.autoWeiter ?? false,
  // Genau der Befehl "npm run build" läuft ohne Rückfrage, wenn dies an ist. Bewusst eng
  // (nur dieser eine Befehl) und Default AUS – per "/npm-build on|off" zur Laufzeit umstellbar.
  npmBuild: false,
};

// BEIDE Schlüssel gleichzeitig halten: DeepSeek und Anthropic werden beim Start aus der
// Umgebung geladen und bleiben nebeneinander liegen. Ein /model-Wechsel greift dann einfach
// auf den passenden zu – ohne neu zu exportieren, ohne den anderen zu verlieren.
const apiKeys: Record<string, string> = {
  DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY || '',
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || '',
  // Qwen/DashScope: die offizielle Doku nutzt DASHSCOPE_API_KEY, der Nutzer hat QWEN_API_KEY
  // gesetzt – wir akzeptieren beide, damit es so oder so funktioniert.
  QWEN_API_KEY: process.env.QWEN_API_KEY || process.env.DASHSCOPE_API_KEY || '',
};
// settings.apiKey spiegelt den Schlüssel des AKTIVEN Providers (Cache für alle Aufrufer).
function aktualisiereApiKey(): void {
  settings.apiKey = apiKeys[capabilitiesFor(settings.model).apiKeyEnv] || '';
}
aktualisiereApiKey();

const MODELLE = ALLE_MODELLE;

// Schritte je Nachfrage-Block. Gemessen: Eine Landingpage aus sechs Dateien braucht
// mit Planpflege bereits 17 Schritte – 25 war zu knapp. Die Grenze beendet den
// Vorgang nicht mehr, sondern fragt nach; sie wirkt also als Haltepunkt.
const MAX_ITERATIONS = 99999;
const REQUEST_TIMEOUT_MS = 120_000;
const COMMAND_TIMEOUT_MS = 30_000;

// Alles ohne Rückfrage ausführen (nicht-interaktive Läufe, Tests, CI).
const AUTO_APPROVE_ALL =
  process.argv.includes('--yes') ||
  process.argv.includes('-y') ||
  process.env.LEAVEN_AUTO_APPROVE === '1';

// Initial-Auftrag aus einer Datei (Launcher-Anbindung): Ist die Option gesetzt, wird der
// Inhalt beim Start SOFORT als erste Nutzer-Nachricht ausgeführt – ohne auf eine Eingabe
// zu warten und ohne Bestätigung. So kann die Leaven-Webanwendung eine Terminal-Session
// starten, in der der Agent den Auftrag direkt beginnt. Der mehrzeilige Prompt läuft dabei
// NIE durch Shell-/AppleScript-Quoting – nur der Dateipfad wird übergeben.
const PROMPT_FILE = argValue('--prompt-file');

/** „Still" = Zwischenschritte aus: nur Spinner, Endergebnis und Abschlussbericht.
 *  Entkoppelt von den Rechten – wird allein über settings.zeigeSchritte (/output) gesteuert. */
function isQuiet(): boolean {
  return !settings.zeigeSchritte;
}

/** Ist das Urteil GENAU der Befehl "npm run build" (kein anderes npm-Kommando)? */
function istNpmBuild(verdict: ReturnType<typeof checkCommand>): boolean {
  if (verdict.kind !== 'ask') return false;
  const p = verdict.parsed;
  return p.program === 'npm' && p.args.length === 2 && p.args[0] === 'run' && p.args[1] === 'build';
}

function isAutoApproved(call: any): boolean {
  if (AUTO_APPROVE_ALL) return true;
  const name = call.function?.name;

  // Der Arbeitsplan ist reine Buchführung – er liest nichts, schreibt nichts und
  // verlässt den Prozess nicht. Eine Rückfrage dafür wäre nur lästig.
  if (name === 'update_plan') return true;

  // Ein Vorschlag führt nichts aus und gewährt nichts – er landet nur im Prüf-Eingang.
  // Freigabe erteilt der Mensch später durch Verschieben in die Registry.
  if (name === 'propose_command') return true;

  if (name === 'execute_command') {
    if (permissions.exec) return true;
    const verdict = checkCommand(String(parseArgs(call.function.arguments).command || ''), commandConfig);
    // 'ok'       -> Allowlist-Lesebefehle (cat, head, tail, grep, ls, find, wc, file,
    //               stat, …). Sie LESEN Dateiinhalt/Metadaten und werden deshalb wie
    //               read_file behandelt: ohne Rückfrage nur, wenn Leserecht besteht.
    // 'sedread'  -> lese-only sed (sed -n 'N,Mp' datei), intern als Zeilen-Read
    //               behandelt (kein Prozess) – ebenfalls ein Read, also an dasselbe
    //               Leserecht gekoppelt. Die Bereichs-/Geheimnisgrenze prüft securePath
    //               beim Ausführen zusätzlich.
    // 'allow'    -> vom Menschen vorregistrierter Befehl bzw. enger php -l-Lint:
    //               bewusst freigegeben, unabhängig vom Leserecht.
    // 'reject'   -> wird ohnehin abgelehnt; den Nutzer damit nicht behelligen,
    //               die Begründung geht direkt ans Modell zurück.
    // 'redirect' -> ebenso ohne Dialog: das Modell bekommt den Hinweis auf das
    //               bessere Werkzeug (z.B. copy_file statt cp) zurück.
    if (verdict.kind === 'ok' || verdict.kind === 'sedread') return permissions.read;
    // /npm-build on: der EXAKTE Befehl "npm run build" läuft ohne Rückfrage. Bewusst eng –
    // nur genau dieses Programm samt Argumenten, kein anderes npm-Kommando. Default aus.
    if (settings.npmBuild && istNpmBuild(verdict)) return true;
    return verdict.kind === 'allow'
      || verdict.kind === 'reject' || verdict.kind === 'redirect';
  }

  const key = TOOL_PERMISSION[name];
  return key ? permissions[key] : false;   // unbekannte Tools immer nachfragen
}

// ============================================
// Loop Breaker
// ============================================
const loopBreaker = new LoopBreaker({
  consecutiveThreshold: config.consecutive_threshold || 5,
  structuralDetection: config.structural_detection !== false,
  cycleReps: config.cycle_reps || 4,
  cycleMaxPeriod: config.cycle_max_period || 6,
  readOnlyCycleExempt: config.read_only_cycle_exempt !== false,
  maxToolCalls: config.max_tool_calls ?? 200,
  maxEstimatedTokens: config.max_estimated_tokens || 0,
  ignoreTools: config.ignore_tools || [],
});

// ============================================
// Tool-Definitionen
// ============================================
const tools = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Liest den Inhalt einer Datei.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relativer Pfad zur Datei' }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Schreibt eine Datei komplett neu. Für Änderungen an bestehenden Dateien ist edit_file besser geeignet.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relativer Pfad zur Datei' },
          content: { type: 'string', description: 'Der zu schreibende Inhalt' }
        },
        required: ['path', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'edit_file',
      description: 'Ersetzt einen Textabschnitt in einer bestehenden Datei. Bevorzuge dieses Tool gegenüber write_file, wenn du nur einen Teil einer Datei änderst.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relativer Pfad zur Datei' },
          old_string: { type: 'string', description: 'Der exakte Text, der ersetzt werden soll (inkl. Einrückung)' },
          new_string: { type: 'string', description: 'Der neue Text' },
          replace_all: { type: 'boolean', description: 'Alle Vorkommen ersetzen (Standard: false)' }
        },
        required: ['path', 'old_string', 'new_string']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'copy_file',
      description: 'Kopiert eine Datei. Quelle wird aus dem Lesebereich gelesen, das Ziel in den ' +
        'Schreibbereich geschrieben – ohne Shell. Für Sicherungskopien (z.B. datei.blade.php → ' +
        'datei.blade.php.bak); ersetzt "cp".',
      parameters: {
        type: 'object',
        properties: {
          source: { type: 'string', description: 'Relativer Pfad zur Quelldatei (Lesebereich)' },
          dest: { type: 'string', description: 'Relativer Pfad zum Ziel (Schreibbereich)' },
          overwrite: { type: 'boolean', description: 'Vorhandenes Ziel überschreiben (Standard: false)' }
        },
        required: ['source', 'dest']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_files',
      description: 'Listet Dateien und Ordner in einem Verzeichnis auf.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Pfad zum Verzeichnis (relativ oder absolut)' }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'update_plan',
      description: 'Legt den Arbeitsplan an oder aktualisiert ihn. Nur bei mehrstufigen Aufgaben (ab etwa drei Schritten) benutzen – bei einfachen Fragen nicht. Immer die VOLLSTÄNDIGE Liste übergeben, auch die bereits erledigten Schritte. Schritte dürfen später ergänzt werden.',
      parameters: {
        type: 'object',
        properties: {
          schritte: {
            type: 'array',
            description: 'Die vollständige Schrittliste in Reihenfolge',
            items: {
              type: 'object',
              properties: {
                titel: { type: 'string', description: 'Kurze Beschreibung, ein paar Wörter' },
                status: {
                  type: 'string',
                  enum: ['offen', 'laeuft', 'erledigt', 'entfaellt'],
                  description: '"entfaellt" für Schritte, die sich erübrigt haben'
                }
              },
              required: ['titel', 'status']
            }
          }
        },
        required: ['schritte']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'fetch_url',
      description: 'Ruft eine Webseite ab und liefert ihren Text. Nur GET, nur freigegebene Domains. Hochladen oder Senden von Daten ist nicht möglich.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Vollständige URL, beginnend mit https://' }
        },
        required: ['url']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'post_to_endpoint',
      description: 'Sendet Daten per POST an die konfigurierte leaven-cli-Instanz. Das Ziel steht fest und kann nicht gewählt werden.',
      parameters: {
        type: 'object',
        properties: {
          payload: { type: 'object', description: 'Die zu sendenden Daten als JSON-Objekt' }
        },
        required: ['payload']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'execute_command',
      description: 'Führt EIN einzelnes Programm aus. Es gibt keine Shell: Pipes (|), Umleitungen (>), Verkettungen (; &&) und Ersetzungen ($(…)) funktionieren nicht und werden abgelehnt. Für Dateiinhalte nutze read_file statt cat.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Der auszuführende Befehl' }
        },
        required: ['command']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'propose_command',
      description: 'Schlägt einen Befehl oder ein Shell-Skript zur Aufnahme in die freigabefreie ' +
        'Registry vor. Führt NICHTS aus und gewährt NICHTS – der Vorschlag landet in einem ' +
        'Eingang, den ein Mensch prüft und erst dann freigibt. Nutze das für Befehle, die du ' +
        'regelmäßig brauchst (statt sie in bash-Skripte zu bündeln).',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Kurzer Name (wird zum Dateinamen, nur Buchstaben/Ziffern/-/_)' },
          kind: { type: 'string', enum: ['command', 'script'], description: '"command" = einzelne Befehlszeile, "script" = Shell-Skript' },
          command: { type: 'string', description: 'Bei kind=command: die exakte Befehlszeile (z.B. "php artisan view:clear")' },
          script_content: { type: 'string', description: 'Bei kind=script: der vollständige Skriptinhalt' },
          reason: { type: 'string', description: 'Warum sinnvoll – für die menschliche Prüfung' }
        },
        required: ['name', 'kind', 'reason']
      }
    }
  }
];

// ============================================
// Sicherheits-Helfer
// ============================================


async function securePath(
  inputPath: string,
  mode: 'read' | 'write',
  base: string = roots.read
): Promise<string> {
  // Relative Pfade werden gegen `base` aufgelöst – für die Datei-Tools ist das
  // immer der Lesebereich. Sonst bedeutet derselbe Pfad je nach Tool eine andere
  // Datei: "projekt/x.txt" wäre beim Lesen <lese>/projekt/x.txt, beim Schreiben
  // aber <schreib>/projekt/x.txt.
  //
  // execute_command übergibt hier bewusst das Arbeitsverzeichnis, mit dem der
  // Kindprozess startet – sonst prüfen wir eine andere Datei, als das Programm
  // später öffnet.
  const target = path.resolve(base, expandHome(inputPath || '.'));
  const real = await realpathSoFar(target);

  // ~/.leaven steht auf der Geheimnis-Sperrliste, damit eine Rolle nicht die
  // Bereiche und Onboarding-Texte der anderen Rollen einsehen kann. Zwei
  // Ausnahmen, beide nur LESEND:
  //   1. Das eigene Rollenverzeichnis – jede Rolle darf ihr Onboarding lesen.
  //   2. Rollen mit "rollenzugriff" – für die Arbeit an der CLI selbst.
  const eigenes = eigenesRollenverzeichnis();
  const inSourdough = real === LEAVEN_WURZEL || real.startsWith(LEAVEN_WURZEL + path.sep);
  const inEigenerRolle = mode === 'read' && (
    (eigenes !== null && (real === eigenes || real.startsWith(eigenes + path.sep)))
    || (aktiverRollenzugriff && inSourdough)
  );

  // Zuerst die Geheimnis-Sperre: Sie gilt auch INNERHALB der erlaubten Bereiche.
  // Ohne sie wäre eine .env im Projekt völlig regelkonform lesbar – und ihr Inhalt
  // ginge damit an die DeepSeek-API.
  if (!ALLOW_SECRETS && !inEigenerRolle) {
    const secret = isSecretPath(real, commandConfig);
    if (secret) {
      // Den aufgelösten Pfad mitgeben, wenn er sich von der Eingabe unterscheidet:
      // Ein "~/" das versehentlich weggelassen wurde, löst gegen den Lesebereich auf
      // und trifft dann eine ganz andere Datei – ohne den Vollpfad ist das nicht
      // erkennbar.
      const wo = real === inputPath ? inputPath : `${inputPath} (aufgelöst: ${real})`;
      throw new Error(
        `Gesperrt: ${wo} gilt als Geheimnisdatei (Regel "${secret}"). ` +
        `Inhalte solcher Dateien würden an die API übertragen. ` +
        `Frage den Nutzer, ob er die CLI mit --allow-secrets starten möchte.`
      );
    }
  }

  const erlaubt = mode === 'write'
    ? imSchreibbereich(real)
    : real === roots.read || real.startsWith(roots.read + path.sep) || inEigenerRolle;

  if (!erlaubt) {
    const was = mode === 'write' ? 'Schreib' : 'Lese';
    const bereiche = mode === 'write' ? schreibbereicheText() : shortPath(roots.read);

    // Existiert kein einziger der Bereiche, ist das eine Fehlkonfiguration und keine
    // Bereichsverletzung. Der Unterschied ist wichtig: Sonst rät die Meldung dem
    // Modell aufzugeben, obwohl der Nutzer das Problem in Sekunden beheben kann.
    const zuPruefen = mode === 'write' ? roots.write : [roots.read];
    const vorhanden = await Promise.all(zuPruefen.map(isDirectory));
    if (!vorhanden.some(Boolean)) {
      throw new Error(
        `Der ${was}bereich ist falsch konfiguriert: ${bereiche} existiert nicht. ` +
        `Das ist kein Rechteproblem. Sag dem Nutzer, er soll "/rights" eingeben und den ` +
        `${was}bereich korrigieren – vermutlich fehlt ein Präfix wie ${shortPath(roots.read)}.`
      );
    }

    // Häufiger Fall: Das Modell gibt einen Pfad relativ zu einem Schreibbereich an,
    // aufgelöst wird aber ab dem Lesebereich. Statt es raten zu lassen, direkt
    // die richtige Schreibweise nennen – das spart einen Fehlversuch pro Datei.
    if (!path.isAbsolute(expandHome(inputPath || '.'))) {
      for (const bereich of zuPruefen) {
        const alternative = path.resolve(bereich, expandHome(inputPath || '.'));
        const inRange = mode === 'write'
          ? imSchreibbereich(alternative)
          : alternative === roots.read || alternative.startsWith(roots.read + path.sep);
        // Nur vorschlagen, wenn das Zielverzeichnis existiert. Sonst entsteht aus
        // "leaven-cli/x.txt" der unsinnige Vorschlag "<schreibbereich>/leaven-cli/x.txt"
        // für ein Verzeichnis, das es gar nicht gibt.
        if (inRange && await isDirectory(path.dirname(alternative))) {
          throw new Error(
            `Zugriff verweigert: ${inputPath} liegt ausserhalb des ${was}bereichs (${bereiche}). ` +
            `Relative Pfade zählen ab dem Lesebereich ${roots.read}. ` +
            `Gemeint war vermutlich "${path.relative(roots.read, alternative)}" – benutze diese Schreibweise.`
          );
        }
      }
    }

    // Der Hinweis auf "/rights" ist wichtig: Ohne ihn gibt das Modell auf und gibt
    // dem Nutzer den Code zum manuellen Einfügen – obwohl die Ursache oft nur ein
    // Schreibbereich ist, der auf ein anderes Projekt zeigt.
    const ausweg = mode === 'write'
      ? ` Falls die Datei zu einem Projekt gehört, an dem gearbeitet werden soll, fehlt es ` +
        `in der Freigabe: Sag dem Nutzer, er kann "/rights" eingeben und das Projekt ` +
        `zusätzlich freigeben. Biete das an, statt nur Code auszugeben.`
      : '';

    throw new Error(
      `Zugriff verweigert: ${inputPath} liegt ausserhalb des ${was}bereichs (${bereiche}). ` +
      `Versuche es nicht mit einem anderen relativen Pfad – die Grenze gilt für die Datei, ` +
      `nicht für die Schreibweise.${ausweg}`
    );
  }
  return target;
}



// ============================================
// Tool-Ausführungen
// ============================================
async function executeTool(toolCall: any): Promise<string> {
  const func = toolCall.function || toolCall;
  const name = func.name;
  const args = parseArgs(func.arguments);

  try {
    switch (name) {
      case 'read_file': {
        const fullPath = await securePath(args.path, 'read');
        // Ohne diese Prüfung kommt die rohe Node-Meldung "EISDIR: illegal operation
        // on a directory" zurück – daraus liest das Modell nicht heraus, dass es
        // schlicht das falsche Werkzeug benutzt hat.
        if (await isDirectory(fullPath)) {
          return `❌ ${args.path} ist ein Verzeichnis, keine Datei. Nutze list_files, um den Inhalt aufzulisten.`;
        }
        const content = await fs.readFile(fullPath, 'utf-8');
        return `Datei ${args.path}:\n\`\`\`\n${content}\n\`\`\``;
      }
      case 'write_file': {
        const fullPath = await securePath(args.path, 'write');

        // Fehlende Elternverzeichnisse anlegen. Ohne das scheitert write_file mit
        // einem rohen "ENOENT: no such file or directory" – das Modell erkennt daran
        // nicht, dass nur das Verzeichnis fehlt, und wiederholt denselben Aufruf,
        // bis der Loop-Breaker greift. Der Pfad ist von securePath bereits auf den
        // Schreibbereich geprüft, das Anlegen kann also nicht ausbrechen.
        const ordner = path.dirname(fullPath);
        const neuAngelegt = !(await isDirectory(ordner));
        await fs.mkdir(ordner, { recursive: true });

        await fs.writeFile(fullPath, args.content ?? '', 'utf-8');
        return neuAngelegt
          ? `✅ Datei ${args.path} wurde geschrieben (Verzeichnis wurde mit angelegt).`
          : `✅ Datei ${args.path} wurde geschrieben.`;
      }
      case 'edit_file': {
        // 'write': edit_file liest zwar auch, verändert aber – es gilt die engere Grenze.
        const fullPath = await securePath(args.path, 'write');
        const needle = args.old_string;
        if (!needle) return '❌ Fehler: old_string fehlt.';

        const content = await fs.readFile(fullPath, 'utf-8');
        const parts = content.split(needle);
        const hits = parts.length - 1;

        if (hits === 0) {
          return `❌ Text nicht gefunden in ${args.path}. Lies die Datei erneut und verwende den exakten Wortlaut inklusive Einrückung.`;
        }
        if (hits > 1 && !args.replace_all) {
          return `❌ Der Text kommt ${hits}x in ${args.path} vor. Nimm mehr Kontext dazu, damit er eindeutig ist – oder setze replace_all: true.`;
        }

        const replacement = args.new_string ?? '';
        // split/join statt String.replace: verhindert, dass $-Muster im neuen Text
        // als Ersetzungs-Platzhalter interpretiert werden.
        const updated = args.replace_all
          ? parts.join(replacement)
          : parts[0] + replacement + parts.slice(1).join(needle);

        await fs.writeFile(fullPath, updated, 'utf-8');
        return `✅ ${args.path}: ${hits > 1 ? `${hits} Stellen` : '1 Stelle'} ersetzt.`;
      }
      case 'copy_file': {
        // Zwei getrennte Grenzen: Quelle gegen den Lese-, Ziel gegen den Schreibbereich.
        // securePath erzwingt beide – inkl. Symlink-Auflösung (realpathSoFar) und der
        // Geheimnis-Sperre. Eine .env oder *credentials* als Quelle wird abgelehnt, es
        // lässt sich also kein Geheimnis in einen ausgelieferten Ordner kopieren.
        const quelle = await securePath(args.source, 'read');
        const ziel = await securePath(args.dest, 'write');

        if (await isDirectory(quelle)) {
          return `❌ ${args.source} ist ein Verzeichnis. copy_file kopiert einzelne Dateien.`;
        }

        const zielDa = await fs.access(ziel).then(() => true).catch(() => false);
        if (zielDa && !args.overwrite) {
          return `❌ ${args.dest} existiert bereits. Setze overwrite: true, um es zu ersetzen.`;
        }

        // Wie bei write_file: fehlende Elternverzeichnisse anlegen. Der Zielpfad ist von
        // securePath bereits auf den Schreibbereich geprüft, das Anlegen kann nicht ausbrechen.
        const ordner = path.dirname(ziel);
        const neuAngelegt = !(await isDirectory(ordner));
        await fs.mkdir(ordner, { recursive: true });

        await fs.copyFile(quelle, ziel);
        return neuAngelegt
          ? `✅ ${args.source} → ${args.dest} kopiert (Verzeichnis wurde mit angelegt).`
          : `✅ ${args.source} → ${args.dest} kopiert.`;
      }
      case 'list_files': {
        const fullPath = await securePath(args.path || '.', 'read');
        const entries = await fs.readdir(fullPath, { withFileTypes: true });
        const items = entries.map(e => `${e.isDirectory() ? '📁' : '📄'} ${e.name}`);
        return `📂 ${args.path}:\n${items.join('\n')}`;
      }
      case 'update_plan': {
        const roh = Array.isArray(args.schritte) ? args.schritte : [];
        if (roh.length === 0) return '❌ Die Schrittliste ist leer.';

        const erlaubt: SchrittStatus[] = ['offen', 'laeuft', 'erledigt', 'entfaellt'];
        zustand.plan = roh
          .filter((s: any) => s && typeof s.titel === 'string' && s.titel.trim())
          .map((s: any) => ({
            titel: String(s.titel).trim(),
            status: erlaubt.includes(s.status) ? s.status : 'offen',
          }));

        zeigePlan();
        const fertig = zustand.plan.filter(istAbgeschlossen).length;

        // §F.2 – Fortschritt ans Board: erneutes in_progress mit „Schritt n/m: …".
        // Hebt eine noch offene Karte auf „in Arbeit" und aktualisiert die
        // status_note (idempotenter Heartbeat, kein Event-Spam). Fire-and-forget:
        // Best-Effort, darf die Tool-Antwort nie verzögern und wirft nie.
        if (boardAktiv() && zustand.plan.length > 0) {
          const laufIdx = zustand.plan.findIndex(s => s.status === 'laeuft');
          const idx = laufIdx >= 0 ? laufIdx : Math.min(fertig, zustand.plan.length - 1);
          void meldeFortschritt(`Schritt ${idx + 1}/${zustand.plan.length}: ${zustand.plan[idx]?.titel ?? 'Arbeit'}`);
        }

        return `✅ Plan aktualisiert: ${fertig} von ${zustand.plan.length} Schritten abgeschlossen.`;
      }

      case 'fetch_url': {
        const verdict = pruefeUrl(String(args.url || ''), internetDomains);
        if (!verdict.ok) return `❌ Abgelehnt: ${verdict.grund}`;

        let ziel = verdict.url;
        for (let sprung = 0; sprung <= MAX_WEITERLEITUNGEN; sprung++) {
          const antwort = await axios.get(ziel.toString(), {
            timeout: 20_000,
            maxRedirects: 0,                      // jeden Sprung selbst prüfen
            maxContentLength: MAX_SEITE_BYTES,
            responseType: 'text',
            transformResponse: [(d: any) => d],
            headers: { 'User-Agent': 'leaven-cli', 'Accept': 'text/html,text/plain,application/json' },
            validateStatus: s => (s >= 200 && s < 400),
          });

          if (antwort.status >= 300 && antwort.status < 400) {
            const ort = antwort.headers?.location;
            if (!ort) return `❌ Weiterleitung ohne Ziel (Status ${antwort.status}).`;
            // Jede Weiterleitung neu gegen die Allowlist prüfen. Sonst führt ein
            // freigegebener Server per Redirect auf eine beliebige fremde Domain.
            const naechste = pruefeUrl(new URL(ort, ziel).toString(), internetDomains);
            if (!naechste.ok) return `❌ Weiterleitung abgelehnt: ${naechste.grund}`;
            ziel = naechste.url;
            continue;
          }

          const roh = String(antwort.data ?? '');
          const typ = String(antwort.headers?.['content-type'] || '');
          const text = typ.includes('html') ? htmlZuText(roh) : roh;
          return `Inhalt von ${ziel.toString()} (${typ.split(';')[0] || 'unbekannt'}):\n\n${text}`;
        }
        return `❌ Zu viele Weiterleitungen (mehr als ${MAX_WEITERLEITUNGEN}).`;
      }

      case 'post_to_endpoint': {
        // Das Ziel kommt AUSSCHLIESSLICH aus der Konfiguration – niemals aus den
        // Argumenten des Modells. Genau das ist der Unterschied zwischen "sendet an
        // die eigene Instanz" und "sendet beliebige Daten irgendwohin".
        const pruefung = pruefeEndpunkt(apiEndpunkt());
        if (!pruefung.ok) return `❌ Kein gültiger Endpunkt konfiguriert: ${pruefung.grund}`;

        // Ohne Token könnte jeder, der die URL kennt, den Endpunkt beschicken.
        // Der Token geht NUR an die konfigurierte Adresse – es gibt keinen Pfad,
        // auf dem er woandershin gelangen könnte.
        const kopf: Record<string, string> = {
          'Content-Type': 'application/json',
          'User-Agent': 'leaven-cli',
        };
        const token = process.env.LEAVEN_API_TOKEN;
        if (token) kopf['Authorization'] = `Bearer ${token}`;

        const antwort = await axios.post(pruefung.url.toString(), args.payload ?? {}, {
          timeout: 20_000,
          maxRedirects: 0,                        // 307/308 würde den Body mitnehmen
          maxContentLength: MAX_SEITE_BYTES,
          headers: kopf,
          validateStatus: () => true,
        });

        if (antwort.status >= 300 && antwort.status < 400) {
          return `❌ Endpunkt antwortete mit einer Weiterleitung (${antwort.status}). ` +
                 `Abgebrochen – eine Weiterleitung könnte die Daten an einen anderen Server schicken.`;
        }
        const rueck = typeof antwort.data === 'string' ? antwort.data : JSON.stringify(antwort.data);
        return `✅ Gesendet an ${pruefung.url.origin} (Status ${antwort.status}):\n${truncate(rueck, 2000)}`;
      }

      case 'execute_command': {
        const verdict = checkCommand(String(args.command || ''), commandConfig);
        if (verdict.kind === 'reject') return `❌ Abgelehnt: ${verdict.reason}`;
        // Umleitung auf ein besseres Werkzeug (cp → copy_file): nicht ausführen,
        // sondern dem Modell den Hinweis zurückgeben. Es wiederholt dann mit copy_file.
        if (verdict.kind === 'redirect') return `ℹ️ ${verdict.reason}`;

        // sed in der lese-only Form (sed -n 'N,Mp' datei): KEIN sed-Prozess. Wir lesen
        // die Zeilen intern und geben exakt das zurück, was sed nach stdout geschrieben
        // hätte. Der Zielpfad wird wie beim Lesen geprüft – Lesebereich UND Geheimnis-
        // Sperre (securePath, mode 'read'). Dadurch entfällt die gesamte Angriffsfläche
        // von sed (-i schreibt, e-Kommando startet eine Shell), das Ergebnis bleibt gleich.
        if (verdict.kind === 'sedread') {
          let leseCwd = roots.read;
          if (!(await isDirectory(leseCwd))) leseCwd = process.cwd();
          let ziel: string;
          try {
            ziel = await securePath(verdict.request.path, 'read', leseCwd);
          } catch (error: any) {
            return `❌ Abgelehnt: Argument "${verdict.request.path}" – ${error.message}`;
          }
          if (await isDirectory(ziel)) {
            return `❌ ${verdict.request.path} ist ein Verzeichnis, keine Datei.`;
          }
          const inhalt = await fs.readFile(ziel, 'utf-8');
          const ausschnitt = liesZeilenBereich(inhalt, verdict.request.start, verdict.request.end);
          return ausschnitt || '✅ Befehl ausgeführt';
        }

        // Ein vorregistrierter EXAKTER Befehl (allow, pruefePfade=false) wurde vom
        // Menschen genau so vermerkt – ihm wird vertraut, keine weitere Argumentprüfung.
        const registriert = verdict.kind === 'allow' && !verdict.pruefePfade;

        // Pfad-Argumente prüfen. Der Massstab hängt davon ab, ob wir das Programm
        // kennen:
        //   Allowlist / php -l  -> lesend, also Lesebereich.
        //   sonst               -> Wirkung unbekannt (rm, npm, git …). Ein solcher Befehl
        //                          darf nur dort hantieren, wo ohnehin geschrieben wird.
        // Ohne diese Trennung käme "rm -rf src/" durch, solange src/ im Lesebereich
        // liegt – und löschte damit ausserhalb des Schreibbereichs.
        const scope: 'read' | 'write' =
          (verdict.kind === 'ok' || verdict.kind === 'allow') ? 'read' : 'write';

        // Arbeitsverzeichnis IMMER der Lesebereich – genau wie bei den Datei-Tools,
        // damit ein relativer Pfad überall dasselbe bedeutet. Prüfung und
        // Ausführung haben so denselben Bezugspunkt.
        //
        // Mit cwd = Schreibbereich zeigte "rm -rf datei.txt" auf eine ANDERE Datei
        // als die, die das Modell zuvor gelesen hatte: Der Befehl meldete Erfolg
        // und löschte nichts. Lieber eine klare Ablehnung als ein stiller Fehlgriff.
        //
        // cwd muss existieren, sonst scheitert der Start mit einer irreführenden
        // ENOENT-Meldung, die aussieht, als fehle das Programm.
        let cwd = roots.read;
        if (!(await isDirectory(cwd))) cwd = process.cwd();

        // Registrierte Befehle überspringen die Argumentprüfung (der Mensch hat die exakte
        // Zeile vermerkt). Der php -l-Lint (allow, pruefePfade=true) wird weiter geprüft:
        // sein Zielpfad muss im Lesebereich liegen.
        if (!registriert) {
          for (const arg of verdict.parsed.args) {
            if (!looksLikePath(arg)) continue;
            try {
              await securePath(arg, scope, cwd);
            } catch (error: any) {
              const hinweis = scope === 'write'
                ? ` (${verdict.parsed.program} steht nicht auf der Allowlist – Argumente müssen deshalb im Schreibbereich liegen)`
                : '';
              return `❌ Abgelehnt: Argument "${arg}" – ${error.message}${hinweis}`;
            }
          }
        }

        try {
          // Kein shell: Option – Metazeichen bleiben dadurch wirkungsloser Text.
          // env gesäubert, damit der Kindprozess den API-Key nicht erbt.
          const { stdout, stderr } = await execFileAsync(verdict.parsed.program, verdict.parsed.args, {
            cwd,
            timeout: COMMAND_TIMEOUT_MS,
            maxBuffer: 10 * 1024 * 1024,
            env: scrubEnvironment(process.env)
          });
          return stdout + stderr || '✅ Befehl ausgeführt';
        } catch (error: any) {
          if (error.code === 'ENOENT') return `❌ Programm nicht gefunden: ${verdict.parsed.program}`;
          return `❌ Fehler: ${(error.stderr || error.message || '').trim()}`;
        }
      }
      case 'propose_command': {
        // Reiner Vorschlag: schreibt in den Prüf-Eingang, führt NICHTS aus, gewährt NICHTS.
        // Die CLI schreibt (voller fs-Zugriff); der Assistent fasst ~/.leaven nie direkt
        // an. Freigabe erteilt der Mensch später durch Verschieben in die Registry.
        const roh = String(args.name || '').toLowerCase();
        // Streng sanitisieren: nur [a-z0-9_-], danach basename – kein Path-Traversal über
        // name: "../../evil". Leerer Rest -> Ablehnung.
        const sane = path.basename(roh.replace(/[^a-z0-9_-]/g, '-')).replace(/^-+|-+$/g, '');
        if (!sane) return '❌ Ungültiger Name. Nutze Buchstaben, Ziffern, - oder _.';
        if (args.kind !== 'command' && args.kind !== 'script') {
          return '❌ kind muss "command" oder "script" sein.';
        }
        if (args.kind === 'command' && !String(args.command || '').trim()) {
          return '❌ Bei kind=command fehlt die Befehlszeile (command).';
        }
        if (args.kind === 'script' && !String(args.script_content || '').trim()) {
          return '❌ Bei kind=script fehlt der Skriptinhalt (script_content).';
        }

        try {
          const fsSync = require('fs');
          fsSync.mkdirSync(REQUESTED_DIR, { recursive: true });
          const vorschlag = {
            name: sane,
            kind: args.kind,
            command: args.kind === 'command' ? String(args.command) : `bash ~/.leaven/approved-scripts/${sane}.sh`,
            reason: String(args.reason || ''),
            vorgeschlagen_am: new Date().toISOString().slice(0, 10),
          };
          fsSync.writeFileSync(path.join(REQUESTED_DIR, `${sane}.json`), JSON.stringify(vorschlag, null, 2), 'utf-8');
          if (args.kind === 'script') {
            fsSync.writeFileSync(path.join(REQUESTED_DIR, `${sane}.sh`), String(args.script_content), 'utf-8');
          }
        } catch (error: any) {
          return `❌ Vorschlag konnte nicht abgelegt werden: ${error.message}`;
        }

        const wohin = args.kind === 'script'
          ? `~/.leaven/approved-scripts/${sane}.sh verschieben und "bash ~/.leaven/approved-scripts/${sane}.sh" eintragen`
          : `die Zeile in ~/.leaven/allowed-commands.json eintragen`;
        return `✅ Vorschlag "${sane}" abgelegt in ~/.leaven/requested-commands/. ` +
          `Er läuft NICHT ohne Prüfung – ein Mensch prüft ihn und kann ${wohin}. ` +
          `Bis dahin brauchst du für diesen Befehl weiterhin eine Freigabe.`;
      }
      default:
        return `❌ Unbekanntes Tool: ${name}`;
    }
  } catch (error: any) {
    return `❌ Fehler: ${error.message}`;
  }
}

// ============================================
// Spinner
// ============================================
class Spinner {
  private frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  private interval: NodeJS.Timeout | null = null;
  private message: string = '';
  private startTime: number = 0;

  start(msg: string) {
    if (!process.stdout.isTTY) {
      console.log(chalk.gray(msg));
      return;
    }
    this.message = msg;
    this.startTime = Date.now();
    let i = 0;
    this.interval = setInterval(() => {
      const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(1);
      const frame = this.frames[i % this.frames.length];
      process.stdout.cursorTo(0);
      process.stdout.write(`${chalk.yellow(frame)} ${chalk.gray(this.message)} (${elapsed}s)`);
      i++;
    }, 80);
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    if (process.stdout.isTTY) {
      process.stdout.clearLine(0);
      process.stdout.cursorTo(0);
    }
  }
}

// Garantiert, dass der Spinner auch bei einem Fehler gestoppt wird. Ohne das
// finally läuft er nach einer fehlgeschlagenen Anfrage endlos weiter und
// überschreibt den Eingabe-Prompt – die CLI wirkt dann eingefroren.
async function withSpinner<T>(message: string, fn: () => Promise<T>): Promise<T> {
  const spinner = new Spinner();
  spinner.start(message);
  try {
    return await fn();
  } finally {
    spinner.stop();
  }
}

// Ruft callApi mit LIVE-Anzeige des Reasoning-Stroms – nur bei Streaming-Providern, im TTY,
// nicht im quiet-Modus. Der Spinner läuft, bis das erste reasoning-Delta live gedruckt wird;
// danach fließt der Gedankenstrom grau in stdout. `content` wird NIE live gedruckt (der
// DSML-XML-Fallback strippt Markup erst nach vollständigem Text, und die "● Frage"-
// Formatierung braucht den ganzen Text) – er läuft danach wie bisher über formatAssistantMessage.
async function callMitAnzeige(label: string, messages: any[]): Promise<any> {
  const caps = capabilitiesFor(settings.model);
  // Live-Gedankenstrom: eigener Schalter (zeigeGedanken), unabhängig von den Zwischenschritten.
  const live = caps.streaming && process.stdout.isTTY && settings.zeigeGedanken;
  if (!live) {
    // Streamt intern (falls Streaming-Provider), zeigt aber nur den Spinner – z.B. quiet/Pipe.
    return withSpinner(label, () => callApi(messages, true));
  }
  const spinner = new Spinner();
  spinner.start(label);
  let gedruckt = false;
  const onReasoning = (delta: string) => {
    if (!gedruckt) { spinner.stop(); gedruckt = true; }   // erste Live-Ausgabe: Spinner weg
    process.stdout.write(chalk.gray(delta));
  };
  try {
    return await callApi(messages, true, onReasoning);
  } finally {
    spinner.stop();
    if (gedruckt) process.stdout.write('\n');              // Zeilenumbruch nach dem Reasoning
  }
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// ============================================
// API-Zugriff
// ============================================
/**
 * Nur die Werkzeuge anbieten, die auch nutzbar sind. Ein angebotenes fetch_url ohne
 * freigegebene Domain würde das Modell nur zu Fehlversuchen verleiten.
 */
function aktiveTools(): any[] {
  return tools.filter(t => {
    if (t.function.name === 'fetch_url') return internetDomains.length > 0;
    if (t.function.name === 'post_to_endpoint') return pruefeEndpunkt(apiEndpunkt()).ok;
    return true;
  });
}

async function callApi(messages: any[], withTools: boolean, onReasoning?: (d: string) => void): Promise<any> {
  const caps = capabilitiesFor(settings.model);

  // Anthropic (Opus/Fable): eigener Adapter, non-streaming (Streaming = Phase 2).
  if (caps.provider === 'anthropic') {
    const { message, usage } = await callAnthropic(messages, withTools ? aktiveTools() : null, {
      model: settings.model,
      effort: settings.effort,
      thinking: settings.thinking,
      apiKey: settings.apiKey,
    });
    zaehleTokens('anthropic', usage);
    return message;
  }

  // Sicherheitsventil: reasoning_content vor dem Senden entfernen, falls ein Provider das
  // Zurückreichen ablehnt (default aus). Betrifft NUR den Request, nie die History.
  const sende = caps.stripReasoningOnSend
    ? messages.map(m => {
        if (m && m.reasoning_content !== undefined) { const { reasoning_content, ...rest } = m; return rest; }
        return m;
      })
    : messages;

  const warnLength = (fr: string | null) => {
    if (fr === 'length') console.log(chalk.yellow('⚠️  Antwort wurde wegen des Längenlimits abgeschnitten.'));
  };

  // Qwen (DashScope): OpenAI-kompatibel, streamend. Mit Streaming ist Deep-Thinking möglich.
  if (caps.provider === 'qwen') {
    const { message, finishReason, usage } = await callQwen(sende, withTools ? aktiveTools() : null, {
      model: settings.model,
      temperature: settings.temperature,
      thinking: settings.thinking,
      apiKey: settings.apiKey,
    }, onReasoning);
    zaehleTokens('qwen', usage);
    warnLength(finishReason);
    return message;
  }

  // DeepSeek: OpenAI-kompatibel, streamend über den gemeinsamen Client.
  const body: any = {
    model: settings.model,
    messages: sende,
    temperature: settings.temperature,
    max_tokens: 8192,
    thinking: { type: settings.thinking ? 'enabled' : 'disabled' },
  };
  if (settings.thinking) body.reasoning_effort = settings.effort;
  if (withTools) { body.tools = aktiveTools(); body.tool_choice = 'auto'; }
  const headers = { 'Authorization': `Bearer ${settings.apiKey}`, 'Content-Type': 'application/json' };
  const { message, finishReason, usage } = await streamOpenAiCompatible(API_URL, headers, body, onReasoning);
  zaehleTokens('deepseek', usage);
  warnLength(finishReason);
  return message;
}



function printToolResult(name: string, result: string): void {
  const firstLine = result.split('\n').slice(0, 3).join('\n');
  const preview = firstLine.length > 240 ? `${firstLine.slice(0, 240)}…` : firstLine;
  console.log(chalk.gray(`🔧 ${name}: ${preview}`));
}

// ============================================
// Interaktive Freigabe
// ============================================
/**
 * Hinweis auf auffällige Shell-Befehle. AUSDRÜCKLICH nur ein Hinweis: Eine Shell
 * lässt sich nicht per Musterabgleich einsperren. Fehlender Hinweis heisst nicht,
 * dass der Befehl harmlos ist.
 */
function shellWarning(call: any): string | null {
  if (call.function.name !== 'execute_command') return null;
  const verdict = checkCommand(String(parseArgs(call.function.arguments).command || ''), commandConfig);
  // 'ok', 'allow' und 'sedread' laufen ohne Dialog – keine Warnzeile. Nur
  // reject/ask/redirect tragen eine Begründung, die angezeigt wird.
  if (verdict.kind === 'sedread') return null;
  return (verdict.kind === 'ok' || verdict.kind === 'allow') ? null : verdict.reason;
}

export interface AuswahlEintrag {
  /** Haupttext der Zeile */
  text: string;
  /** optionale Warn- oder Hinweiszeile darunter */
  hinweis?: string | null;
  /** anfangs angehakt? */
  vorausgewaehlt?: boolean;
}

/**
 * Wiederverwendbare Checkbox-Auswahl. Enthält die stdin-Behandlung, die für den
 * Freigabe-Dialog erarbeitet wurde: readline-Listener sichern und wiederherstellen,
 * stdin nach rl.pause() wieder aufnehmen, Zeilen auf Terminalbreite kürzen.
 *
 * Rückgabe: Indizes der ausgewählten Einträge, oder null bei Abbruch (Esc/Ctrl-C).
 */
function mehrfachAuswahl(
  rl: readline.Interface,
  titel: string,
  eintraege: AuswahlEintrag[],
  fusszeileText = '↑↓ navigieren · Leertaste umschalten · ⏎ bestätigen · a alle abwählen'
): Promise<number[] | null> {
  return new Promise((resolve) => {
    if (!process.stdin.isTTY || eintraege.length === 0) {
      resolve(null);
      return;
    }

    const selected = eintraege.map(e => e.vorausgewaehlt === true);
    let index = 0;
    let printedLines = 0;
    let meldung: string | null = null;

    const render = () => {
      if (printedLines > 0) {
        readline.moveCursor(process.stdout, 0, -printedLines);
        readline.clearScreenDown(process.stdout);
      }

      const width = Math.max(20, (process.stdout.columns || 80) - 1);

      // ANSI-Codes zählen nicht zur sichtbaren Breite. Ohne diese Bereinigung
      // würde eine eingefärbte Zeile fälschlich als zu lang gelten.
      const sichtbar = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, '');

      // Harte Kürzung auf die Terminalbreite. Eine umbrechende Zeile belegt zwei
      // Bildschirmzeilen, wodurch das moveCursor beim nächsten Render verrutscht
      // und Teile der alten Ausgabe stehen bleiben – genau so vervielfältigte sich
      // früher die Überschrift.
      const clip = (text: string) => (text.length > width ? `${text.slice(0, width - 1)}…` : text);

      const lines: string[] = [];
      // Titel darf mehrzeilig sein – jede Zeile muss aber ein eigener Eintrag sein,
      // sonst stimmt die Zeilenzahl nicht.
      titel.split('\n').forEach(t => lines.push(clip(t)));

      eintraege.forEach((eintrag, i) => {
        const line = clip(`${selected[i] ? '[x]' : '[ ]'} ${eintrag.text}`);
        if (i === index) lines.push(chalk.bgBlue.whiteBright(line));
        else if (selected[i]) lines.push(line);
        else lines.push(chalk.gray(line));

        if (eintrag.hinweis) lines.push(chalk.red(clip(`    ⚠️  ${eintrag.hinweis}`)));
      });
      lines.push(chalk.gray('─'.repeat(Math.min(60, width))));
      if (meldung) lines.push(chalk.yellow(clip(meldung)));
      fusszeileText.split('\n').forEach(f => lines.push(chalk.gray(clip(f))));

      process.stdout.write(`${lines.join('\n')}\n`);

      // Tatsächlich belegte Bildschirmzeilen zählen, nicht Array-Einträge. Sollte
      // eine Zeile die Kürzung überstehen und doch umbrechen, bleibt die Rechnung
      // dadurch korrekt.
      printedLines = lines.reduce(
        (summe, zeile) => summe + Math.max(1, Math.ceil(sichtbar(zeile).length / width)),
        0
      );
    };

    const onKeypress = (str: string, key: any) => {
      if (!key) return;

      if (key.name === 'up') {
        index = (index - 1 + eintraege.length) % eintraege.length;
        render();
      } else if (key.name === 'down') {
        index = (index + 1) % eintraege.length;
        render();
      } else if (key.name === 'space') {
        selected[index] = !selected[index];
        render();
      } else if (str === 'a' || str === 'A') {
        selected.fill(false);
        render();
      } else if (key.name === 'return' || key.name === 'enter' || key.name === 'escape' || (key.ctrl && key.name === 'c')) {
        // Ein Terminal sendet bei Enter "\r" (-> return), Pipes und manche
        // Terminal-Konfigurationen senden "\n" (-> enter). Beides muss gelten.
        const abbruch = key.name !== 'return' && key.name !== 'enter';
        const gewaehlt = selected.map((an, i) => (an ? i : -1)).filter(i => i >= 0);

        // Enter ohne Auswahl fiel früher wortlos auf die Pfadeingabe zurück. Wer
        // Enter zum Ankreuzen benutzt hat, stand dann ohne Erklärung vor einem
        // anderen Dialog. Jetzt gibt es einen Hinweis, Esc bleibt der Ausweg.
        if (!abbruch && gewaehlt.length === 0) {
          meldung = 'Nichts ausgewählt. Mit der LEERTASTE ankreuzen, dann Enter. (Esc = stattdessen Pfad eingeben)';
          render();
          return;
        }

        cleanup();
        resolve(abbruch ? null : gewaehlt);
      }
    };

    // readline hat einen eigenen keypress-Listener. Er wird für die Dauer des
    // Dialogs abgehängt (sonst verarbeitet readline die Tasten zusätzlich als
    // Zeileneingabe) und danach exakt wiederhergestellt. Ein pauschales
    // removeAllListeners('keypress') würde ihn dauerhaft löschen – danach
    // reagiert die Eingabeaufforderung nie wieder.
    const rlListeners = process.stdin.listeners('keypress') as ((...args: any[]) => void)[];

    // readline hält stdin im Raw-Modus, solange es die Eingabe verwaltet. Ein
    // pauschales setRawMode(false) beim Aufräumen schaltet das Terminal-Echo wieder
    // ein – dann echot das Terminal UND readline, und jede weitere Eingabe erscheint
    // DOPPELT. Deshalb den vorherigen Zustand merken und genau den wiederherstellen.
    const warRaw = process.stdin.isRaw === true;

    const cleanup = () => {
      process.stdin.off('keypress', onKeypress);
      rlListeners.forEach(listener => process.stdin.on('keypress', listener));
      if (process.stdin.isTTY) process.stdin.setRawMode(warRaw);
      rl.resume();
    };

    rlListeners.forEach(listener => process.stdin.off('keypress', listener));
    rl.pause();
    readline.emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    process.stdin.on('keypress', onKeypress);

    // ENTSCHEIDEND: rl.pause() pausiert auch den stdin-Stream. Ein wartendes
    // Promise hält den Node-Event-Loop nicht am Leben – ohne dieses resume()
    // beendet sich der Prozess sofort, sobald dieser Dialog erscheint.
    process.stdin.resume();
    render();
  });
}

/** Freigabe-Dialog für Tool-Aufrufe – setzt auf mehrfachAuswahl() auf. */
async function confirmToolCalls(rl: readline.Interface, calls: any[]): Promise<Set<string>> {
  // Ohne TTY (Pipe, CI) gibt es keine Tastatureingabe – dann nichts ausführen,
  // statt ungefragt zu schreiben.
  if (!process.stdin.isTTY) {
    console.log(chalk.yellow('⚠️ Kein interaktives Terminal – schreibende Tools werden übersprungen.'));
    return new Set();
  }

  const eintraege: AuswahlEintrag[] = calls.map(call => ({
    text: `${call.function.name}(${summarizeArgs(call.function.arguments)})`,
    hinweis: shellWarning(call),
    vorausgewaehlt: true,
  }));

  const gewaehlt = await mehrfachAuswahl(
    rl,
    chalk.yellow('🔧 Diese Aktionen brauchen deine Freigabe:'),
    eintraege,
    '↑↓ navigieren · Leertaste umschalten · ⏎ ausführen · a alle abwählen'
  );

  if (gewaehlt === null) return new Set();
  return new Set(gewaehlt.map(i => calls[i].id));
}

// ============================================
// Berechtigungen
// ============================================
type Ask = () => Promise<string>;

/** Schrittweise durch Unterverzeichnisse navigieren, bis der Nutzer Enter drückt. */
async function browseForDirectory(start: string, ask: Ask): Promise<string> {
  let current = start;

  for (;;) {
    const dirs = await subdirectories(current);
    if (dirs.length === 0) {
      console.log(chalk.gray(`     (keine Unterverzeichnisse in ${shortPath(current)})`));
      return current;
    }

    const shown = dirs.slice(0, 30);
    shown.forEach((name, i) => console.log(chalk.gray(`     ${String(i + 1).padStart(2)}) ${name}`)));
    if (dirs.length > shown.length) {
      console.log(chalk.gray(`     … ${dirs.length - shown.length} weitere ausgeblendet`));
    }

    process.stdout.write(chalk.green(`  Nummer (Enter = ${shortPath(current)}): `));
    const answer = (await ask()).trim();
    if (!answer) return current;

    const index = Number(answer);
    if (Number.isInteger(index) && index >= 1 && index <= shown.length) {
      current = path.join(current, shown[index - 1]);
    } else {
      console.log(chalk.red(`     Ungültige Nummer: ${answer}`));
    }
  }
}

/**
 * Fragt nach einem Verzeichnis und kehrt erst zurück, wenn es wirklich existiert.
 * Vorher wurde ein nicht existierender Pfad kommentarlos übernommen – dann scheiterte
 * jeder spätere Schreibzugriff, ohne dass die Ursache erkennbar war.
 */
async function askForRoot(label: string, base: string, ask: Ask): Promise<string> {
  const yes = (answer: string) => !['n', 'nein', 'no'].includes(answer.trim().toLowerCase());

  for (;;) {
    process.stdout.write(chalk.green(`  ${label} [${shortPath(base)}] (? = Auswahl): `));
    const raw = (await ask()).trim();

    if (!raw) return base;
    if (raw === '?') return await browseForDirectory(base, ask);

    // Relative Eingaben gegen die angezeigte Basis auflösen – nicht gegen
    // process.cwd(). Sonst bedeutet der Prompt etwas anderes, als er anzeigt.
    const candidate = path.resolve(base, expandHome(raw));
    if (await isDirectory(candidate)) return await fs.realpath(candidate);

    console.log(chalk.red(`\n  ✗ ${candidate} existiert nicht.`));

    // Häufiger Fall: führender "/" gemeint als "relativ zur Basis".
    if (path.isAbsolute(expandHome(raw))) {
      const nested = path.resolve(base, `.${expandHome(raw)}`);
      if (await isDirectory(nested)) {
        process.stdout.write(chalk.yellow(`    Meintest du ${shortPath(nested)}? [Y/n]: `));
        if (yes(await ask())) return await fs.realpath(nested);
      }
    }
    console.log('');
  }
}

// ============================================
// Schreibbereiche per Checkbox wählen
// ============================================
// Die Checkbox-Auswahl braucht das readline-Interface. askPermissions() wird sowohl
// beim Start als auch über /rights aufgerufen – statt es durch beide Wege zu reichen,
// hält startChat() hier eine Referenz.
let aktivesRl: readline.Interface | null = null;

const SCOPE_DATEI = path.join(os.homedir(), '.leaven', 'scopes.json');
const ALLE_MARKE = '— ALLE Verzeichnisse (inkl. Dateien direkt darin) —';

async function ladeGemerkteAuswahl(basis: string): Promise<string[]> {
  try {
    const roh = JSON.parse(await fs.readFile(SCOPE_DATEI, 'utf-8'));
    const eintrag = roh?.[basis];
    return Array.isArray(eintrag) ? eintrag : [];
  } catch {
    return [];
  }
}

async function merkeAuswahl(basis: string, namen: string[]): Promise<void> {
  try {
    let roh: Record<string, string[]> = {};
    try { roh = JSON.parse(await fs.readFile(SCOPE_DATEI, 'utf-8')) || {}; } catch { /* neu */ }
    roh[basis] = namen;
    await fs.mkdir(path.dirname(SCOPE_DATEI), { recursive: true });
    await fs.writeFile(SCOPE_DATEI, JSON.stringify(roh, null, 2), 'utf-8');
  } catch (error: any) {
    console.log(chalk.gray(`  (Auswahl konnte nicht gemerkt werden: ${error.message})`));
  }
}

/**
 * Lässt die Unterverzeichnisse der Basis per Checkbox auswählen. Mehrere Projekte
 * sind bewusst möglich: Sonst müsste man das gemeinsame Elternverzeichnis freigeben
 * und damit auch alles andere darunter.
 *
 * Rückgabe: null, wenn keine Auswahl möglich war (kein TTY, keine Unterverzeichnisse,
 * Abbruch) – dann übernimmt die Pfadeingabe.
 */
async function waehleSchreibbereiche(basis: string, rl: readline.Interface): Promise<string[] | null> {
  if (!process.stdin.isTTY) return null;

  const unterordner = await subdirectories(basis);
  if (unterordner.length === 0) return null;

  const gemerkt = await ladeGemerkteAuswahl(basis);
  const eintraege: AuswahlEintrag[] = unterordner.map(name => ({
    text: gemerkt.includes(name) ? `${name}${chalk.gray('   (zuletzt gewählt)')}` : name,
    vorausgewaehlt: gemerkt.includes(name),
  }));
  eintraege.push({
    text: chalk.yellow(ALLE_MARKE),
    hinweis: 'Gibt auch Verzeichnisse frei, die später entstehen',
    vorausgewaehlt: gemerkt.includes(ALLE_MARKE),
  });

  if (gemerkt.length > 0) {
    console.log(chalk.gray('\n  Vorauswahl aus der letzten Sitzung geladen.'));
  }

  const gewaehlt = await mehrfachAuswahl(
    rl,
    chalk.blue('  Welche Projekte sollen SCHREIBRECHTE bekommen?'),
    eintraege,
    'Leertaste ankreuzen · ↑↓ navigieren · ⏎ bestätigen · Esc Pfad eingeben'
  );

  if (gewaehlt === null || gewaehlt.length === 0) return null;

  const alleIndex = eintraege.length - 1;
  if (gewaehlt.includes(alleIndex)) {
    await merkeAuswahl(basis, [ALLE_MARKE]);
    return [basis];
  }

  const namen = gewaehlt.map(i => unterordner[i]);
  await merkeAuswahl(basis, namen);

  const pfade: string[] = [];
  for (const name of namen) {
    try { pfade.push(await fs.realpath(path.join(basis, name))); }
    catch { pfade.push(path.join(basis, name)); }
  }
  return pfade;
}

/**
 * Ja/Nein-Frage, deren Vorgabe der aktuelle Wert ist. Zeigt [Y/n] wenn aktuell true,
 * sonst [y/N] – Enter behält damit immer den Ist-Zustand, statt ihn versehentlich
 * umzuschalten.
 */
async function frageJaNein(text: string, aktuell: boolean, ask: Ask): Promise<boolean> {
  process.stdout.write(chalk.green(`  → ${text} ${aktuell ? '[Y/n]' : '[y/N]'}: `));
  const antwort = (await ask()).trim().toLowerCase();
  if (!antwort) return aktuell;
  if (['y', 'yes', 'j', 'ja'].includes(antwort)) return true;
  if (['n', 'no', 'nein'].includes(antwort)) return false;
  return aktuell;
}

async function askPermissions(ask: Ask, mitRechtefragen = false): Promise<void> {
  const yes = (answer: string) => ['j', 'ja', 'y', 'yes'].includes(answer.trim().toLowerCase());

  // Flags erlauben das Überspringen der Fragen.
  const flagRead = argValue('--read-root');
  const flagWrite = argValue('--write-root');

  // Nicht-interaktiv: Ein nicht existierender Pfad ist ein harter Fehler. Vorher
  // lief die Sitzung weiter und jeder Schreibzugriff scheiterte unerklärlich.
  const fromFlag = async (flag: string | undefined, name: string, fallback: string) => {
    if (!flag) return fallback;
    const candidate = path.resolve(fallback, expandHome(flag));
    if (!(await isDirectory(candidate))) {
      console.log(chalk.red(`❌ ${name}: ${candidate} existiert nicht oder ist kein Verzeichnis.`));
      process.exit(1);
    }
    return await fs.realpath(candidate);
  };

  if (AUTO_APPROVE_ALL || (flagRead && flagWrite)) {
    roots.read = await fromFlag(flagRead, '--read-root', process.cwd());
    // --write-root nimmt mehrere Pfade, durch Komma getrennt.
    roots.write = flagWrite
      ? await Promise.all(flagWrite.split(',').map(p => fromFlag(p.trim(), '--write-root', roots.read)))
      : [roots.read];
    // --yes hebt alles auf. Ohne --yes bleiben die Vorgaben stehen; ein Skript darf
    // hier auf keinen Fall an einer Frage hängen bleiben.
    if (AUTO_APPROVE_ALL) permissions.read = permissions.write = permissions.exec = true;
    return;
  }

  if (mitRechtefragen) {
    console.log(chalk.blue('\n🔐 Berechtigungen für diese Sitzung'));
    console.log(chalk.gray('   y = yes, n = no · Grossbuchstabe ist die Vorgabe (Enter behält den aktuellen Wert)'));
  }
  console.log(chalk.gray('   Bei Pfaden übernimmt Enter den Vorschlag in [Klammern], "?" zeigt eine Auswahl.\n'));

  roots.read = flagRead
    ? await fromFlag(flagRead, '--read-root', process.cwd())
    : await askForRoot('Lesebereich  ', process.cwd(), ask);

  console.log('');
  for (;;) {
    if (flagWrite) {
      roots.write = await Promise.all(
        flagWrite.split(',').map(p => fromFlag(p.trim(), '--write-root', roots.read))
      );
      break;
    }

    // Zuerst die Checkbox-Auswahl über die Unterverzeichnisse. Liefert sie nichts
    // (kein TTY, keine Unterordner, Abbruch), bleibt die Pfadeingabe als Weg.
    const perAuswahl = aktivesRl ? await waehleSchreibbereiche(roots.read, aktivesRl) : null;
    roots.write = perAuswahl ?? [await askForRoot('Schreibbereich', roots.read, ask)];

    const draussen = roots.write.filter(
      w => w !== roots.read && !w.startsWith(roots.read + path.sep)
    );
    if (draussen.length === 0) break;

    // Früher nur eine gelbe Zeile, die im Startgetümmel unterging. Jetzt muss
    // ein Bereich ausserhalb des Lesebereichs bewusst bestätigt werden.
    console.log(chalk.yellow(`\n  ⚠️  Liegt NICHT im Lesebereich ${shortPath(roots.read)}:`));
    draussen.forEach(w => console.log(chalk.yellow(`      ${shortPath(w)}`)));
    console.log(chalk.yellow(`      Der Agent könnte dort schreiben, aber nichts lesen.`));
    process.stdout.write(chalk.green(`      Trotzdem so übernehmen? [y/N]: `));
    if (yes(await ask())) break;
    console.log('');
  }

  if (mitRechtefragen) await frageRechte(ask);
  zeigeRechteZusammenfassung();
}

/** Die drei Rechtefragen – nur über /rights, nicht beim Start. */
async function frageRechte(ask: Ask): Promise<void> {
  console.log('');
  permissions.read = await frageJaNein('Alles LESEN ab hier ohne Rückfrage?', permissions.read, ask);
  permissions.write = await frageJaNein('Dateien ERSTELLEN und ÜBERSCHREIBEN ohne Rückfrage?', permissions.write, ask);

  const gelistet = Object.keys(commandConfig.allowed).join(', ');
  console.log(chalk.gray(`\n  Lesende Befehle (${gelistet}) lesen Dateiinhalt/Metadaten und folgen`));
  console.log(chalk.gray(`  derselben LESEN-Regel wie read_file – ohne Rückfrage nur bei freigegebenem`));
  console.log(chalk.gray(`  Lesen. Sie werden ohne Shell gestartet und auf den Lesebereich begrenzt.`));
  console.log(chalk.yellow(`\n  ⚠️  Diese Frage betrifft ALLE ÜBRIGEN Befehle (rm, npm, curl, git …).`));
  console.log(chalk.yellow(`      Deren Wirkung lässt sich nicht zuverlässig begrenzen.`));
  permissions.exec = await frageJaNein('Auch diese ohne Rückfrage ausführen?', permissions.exec, ask);
}

function zeigeRechteZusammenfassung(): void {
  const flag = (granted: boolean) => (granted ? chalk.green('ohne Rückfrage') : chalk.gray('mit Rückfrage'));
  console.log(chalk.blue('\n  Ergebnis:'));
  console.log(`    Lesen     ${chalk.bold(roots.read)}  ${flag(permissions.read)}`);
  roots.write.forEach((w, i) => {
    const label = i === 0 ? '    Schreiben' : '             ';
    console.log(`${label} ${chalk.bold(w)}${i === 0 ? `  ${flag(permissions.write)}` : ''}`);
  });
  console.log(`    Shell     ${flag(permissions.exec)}`);
  const g = settings.zeigeGedanken ? 'an' : 'aus';
  const sch = settings.zeigeSchritte ? 'an' : 'aus';
  console.log(chalk.gray(`\n  📺 Anzeige: Gedanken ${g} · Zwischenschritte ${sch}  (umstellen mit /output)`));
}

// ============================================
// Agent-Schleife
// ============================================
interface Action { symbol: string; tool: string; detail: string; }

function describeTarget(call: any): string {
  const args = parseArgs(call.function.arguments);
  const raw = args.path || args.command || '';
  const text = String(raw).replace(/\n/g, ' ');
  return text.length > 70 ? `…${text.slice(-69)}` : text;
}

function printReport(actions: Action[]): void {
  if (actions.length === 0) return;
  console.log(chalk.blue(`\n📋 Ausgeführt (${actions.length} ${actions.length === 1 ? 'Aktion' : 'Aktionen'}):`));
  for (const action of actions) {
    console.log(`   ${action.symbol} ${chalk.gray(action.tool.padEnd(15))} ${action.detail}`);
  }
  console.log('');
}

// Status: 'fertig' = Turn abgeschlossen (oder vom Nutzer/Schrittlimit beendet); 'budget' =
// per Tagesbudget-Auto-Stopp mitten in der Aufgabe angehalten → Session speichern (weiter).
// 'fertig'   = Modell hat den Auftrag abgeschlossen (keine Tool-Anforderung mehr).
// 'gestoppt' = am Schrittlimit angehalten (Aufgabe NICHT fertig – kein Auto-done!).
// 'budget'   = Tages-Token-Budget erreicht (Aufgabe NICHT fertig).
type TurnStatus = 'fertig' | 'budget' | 'gestoppt';

async function runAgentTurn(rl: readline.Interface, messages: any[], ask: Ask): Promise<TurnStatus> {
  const actions: Action[] = [];
  const quiet = isQuiet();

  // Die Schrittgrenze ist ein Notaus gegen Endlosschleifen – aber keine Wand.
  // Wird sie erreicht, fragt die CLI, ob weitergearbeitet werden soll. Vorher
  // brach der Vorgang mitten in der Aufgabe ab, und der Nutzer stand mit halb
  // angelegten Dateien da.
  let grenze = MAX_ITERATIONS;

  for (let iteration = 1; ; iteration++) {
    if (iteration > grenze) {
      console.log(chalk.yellow(`\n⚠️ ${grenze} Schritte erreicht.`));
      printReport(actions);
      zeigePlan();

      if (!process.stdin.isTTY) {
        console.log(chalk.gray('  Kein interaktives Terminal – gestoppt. Der Verlauf bleibt erhalten,'));
        console.log(chalk.gray('  eine Folgeeingabe wie "mach weiter" setzt die Arbeit fort.\n'));
        return 'gestoppt';
      }
      if (!(await frageJaNein(`Weitere ${MAX_ITERATIONS} Schritte ausführen?`, true, ask))) {
        console.log(chalk.gray('  Gestoppt. Der Verlauf bleibt erhalten – "mach weiter" setzt fort.\n'));
        return 'gestoppt';
      }
      grenze += MAX_ITERATIONS;
    }

    // Tages-Budget: nur wenn Auto-Stopp an ist. Vor dem API-Aufruf prüfen – erreicht die
    // Grenze, hält die Schleife hier an (der aktuelle Turn endet sauber).
    if (settings.autoStopp) {
      const prov = capabilitiesFor(settings.model).provider;
      usageDaten = resetWennNeuerTag(usageDaten, heutigesDatum());
      if (ueberBudget(usageDaten, prov)) {
        const v = usageDaten.verbrauch[prov] || 0;
        const l = usageDaten.limits[prov] || 0;
        console.log(chalk.red(`\n  🛑 Tagesbudget für ${prov} erreicht (${v} / ${l} Tokens). Auto-Stopp.`));
        console.log(chalk.gray('  Der Stand wird gesichert. Am nächsten Tag mit "weiter" an dieser Aufgabe fortsetzen.'));
        return 'budget';
      }
    }

    // Provider-passendes Etikett – nicht mehr fest „DeepSeek".
    const p = providerFor(settings.model);
    const anbieter = p === 'anthropic' ? 'Claude' : p === 'qwen' ? 'Qwen' : 'DeepSeek';
    const label = iteration === 1
      ? `${anbieter} denkt nach…`
      : `${anbieter} arbeitet weiter (Schritt ${iteration})…`;

    // tools werden bei JEDEM Request mitgegeben. Fehlen sie im Folge-Request,
    // kann das Modell nach einem read_file kein write_file mehr anfordern und
    // der Vorgang endet stumm mitten in der Aufgabe.
    const message = await callMitAnzeige(label, messages);

    const calls = extractToolCalls(message);
    // Das rohe Antwort-Objekt wandert unverändert in die History. Im Thinking-Modus
    // hängt daran reasoning_content, das DeepSeek ab dem ersten Tool-Call in jedem
    // Folge-Request zurückerwartet. Niemals neu zusammenbauen oder Felder entfernen.
    messages.push(message);

    // Im stillen Modus nur die Schlussnachricht zeigen, nicht das Zwischengeschwätz.
    const isFinal = calls.length === 0;
    if (message.content && message.content.trim() && (isFinal || !quiet)) {
      if (quiet) printReport(actions);
      formatAssistantMessage(message.content);
    }

    if (isFinal) {
      if (quiet && !message.content?.trim()) printReport(actions);
      return 'fertig';
    }

    const needsApproval = calls.filter(call => !isAutoApproved(call));
    const approved = new Set(
      calls.filter(call => isAutoApproved(call)).map(call => call.id)
    );
    if (needsApproval.length > 0) {
      const confirmed = await confirmToolCalls(rl, needsApproval);
      confirmed.forEach(id => approved.add(id));
    }

    for (const call of calls) {
      // Jeder Tool-Call bekommt genau eine Antwort – auch wenn er blockiert oder
      // abgelehnt wurde. Fehlt auch nur eine, lehnt die API den nächsten Request ab.
      let result: string;

      if (!approved.has(call.id)) {
        if (!quiet) console.log(chalk.yellow(`⏭️  ${call.function.name} übersprungen`));
        actions.push({ symbol: '⏭', tool: call.function.name, detail: chalk.yellow('abgelehnt') });
        result = '❌ Der Nutzer hat diesen Tool-Aufruf abgelehnt. Führe ihn nicht erneut aus, sondern frage nach, wie du weitermachen sollst.';
      } else {
        const verdict = loopBreaker.check({
          name: call.function.name,
          arguments: parseArgs(call.function.arguments)
        });

        if (verdict.blocked) {
          // Auch im stillen Modus sichtbar: ein blockierter Lauf darf nicht wie
          // ein glatter Erfolg aussehen.
          console.log(chalk.red(`🛑 ${verdict.reason}`));
          actions.push({ symbol: '🛑', tool: call.function.name, detail: chalk.red('vom Loop-Breaker blockiert') });
          // Der Grund geht als Tool-Ergebnis zurück an das Modell, statt den Turn
          // hart abzubrechen. So kann es seinen Ansatz selbst korrigieren.
          result = `🛑 Loop-Breaker: ${verdict.reason}\nWiederhole diesen Aufruf nicht. Wähle einen anderen Weg oder antworte dem Nutzer direkt.`;
        } else {
          result = await withSpinner(`${call.function.name}…`, () => executeTool(call));
          if (!quiet) printToolResult(call.function.name, result);

          const failed = result.startsWith('❌');
          const symbol = failed ? '⚠️' : (TOOL_PERMISSION[call.function.name] === 'read' ? '👁' : '✎');
          const detail = failed
            ? chalk.red(result.split('\n')[0].replace(/^❌\s*/, ''))
            : describeTarget(call);
          actions.push({ symbol, tool: call.function.name, detail });
        }
      }

      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: truncate(result)
      });
    }
  }

}

// ============================================
// Rollen
// ============================================
interface Rolle {
  read: string;
  write: string[];
  permissions: { read: boolean; write: boolean; exec: boolean };
  settings: { model: string; thinking: boolean; effort: string; temperature: number };
  /**
   * Darf diese Rolle GANZ ~/.leaven lesen – also auch die Konfiguration der
   * anderen Rollen? Nur für Rollen gedacht, die an der CLI selbst arbeiten.
   * Bewusst eine eigene Eigenschaft und keine allgemeine "extraRead"-Liste: Sonst
   * wäre daraus schnell ein Weg, auch .ssh oder .aws freizuschalten.
   */
  rollenzugriff?: boolean;
  /** Freigegebene Domains für fetch_url. Leer/fehlend = kein Netzzugriff. */
  internet?: string[];
}

const LEAVEN_WURZEL = LEAVEN_ROOT;   // gleiche Wurzel, oben schon definiert

const ROLLEN_DATEI = path.join(os.homedir(), '.leaven', 'roles.json');
const ROLLEN_ORDNER = path.join(os.homedir(), '.leaven', 'roles');

/** Zusatztext einer aktiven Rolle (Onboarding-Datei), sonst leer. */
let rollenOnboarding = '';
let aktiveRolle: string | null = null;
let aktiverRollenzugriff = false;

/** Verzeichnis der aktiven Rolle – das einzige unter ~/.leaven, das sie lesen darf. */
function eigenesRollenverzeichnis(): string | null {
  return aktiveRolle ? path.join(ROLLEN_ORDNER, `.${aktiveRolle}`) : null;
}

async function ladeRollen(): Promise<Record<string, Rolle>> {
  try {
    return JSON.parse(await fs.readFile(ROLLEN_DATEI, 'utf-8')) || {};
  } catch {
    return {};
  }
}

async function speichereRollen(rollen: Record<string, Rolle>): Promise<void> {
  await fs.mkdir(path.dirname(ROLLEN_DATEI), { recursive: true });
  await fs.writeFile(ROLLEN_DATEI, JSON.stringify(rollen, null, 2), 'utf-8');
}

function rollenSchnappschuss(rollenzugriff = false): Rolle {
  return {
    read: roots.read,
    write: [...roots.write],
    permissions: { ...permissions },
    settings: {
      model: settings.model,
      thinking: settings.thinking,
      effort: settings.effort,
      temperature: settings.temperature,
    },
    rollenzugriff,
    internet: [...internetDomains],
  };
}

function baueSystemPrompt(): string {
  // Fähigkeiten-Manifest: aus dem tatsächlichen Zustand erzeugt, damit dem Modell klar ist,
  // was ohne/mit Rückfrage geht – und dass es Sinnvolles vorschlagen darf, statt Befehle in
  // bash-Skripte zu bündeln.
  const istSkript = (z: string) => /^(bash|sh|zsh|dash|ksh)\b/.test(z);
  const registrierte = (commandConfig.allowedCommands ?? []).filter(z => !istSkript(z));
  const skripte = (commandConfig.allowedCommands ?? []).filter(istSkript);
  const allowlist = Object.keys(commandConfig.allowed).join(', ');
  // Lesende Befehle (cat, head, tail, grep, sed -n 'N,Mp' …) sind ein Datei-Read und
  // folgen deshalb – wie read_file – dem LESEN-Recht: ohne Rückfrage nur, wenn Lesen
  // freigegeben ist, sonst über den Freigabe-Dialog.
  const leseZeile = permissions.read
    ? `- Lesende Befehle über execute_command: ${allowlist} und sed -n 'N,Mp' datei (ohne Shell, nur im Lesebereich).`
    : `- Lesende Befehle über execute_command (${allowlist}, sed -n 'N,Mp' datei) brauchen – wie read_file – jeweils eine Freigabe, weil LESEN nicht ohne Rückfrage erlaubt ist.`;
  const manifest = `
Was OHNE Rückfrage läuft:
- Datei-Werkzeuge im erlaubten Bereich: read_file, list_files (lesen), write_file, edit_file, copy_file (schreiben).
${leseZeile}
- Syntax-Check: exakt "php -l <datei>" (nur das Flag -l, sonst keins).
${registrierte.length ? `- Vorregistrierte Befehle – GENAU so aufrufen, ohne Zusatz-Flags: ${registrierte.map(z => `"${z}"`).join(', ')}.` : '- (Noch keine vorregistrierten Befehle.)'}${skripte.length ? `\n- Freigegebene Skripte: ${skripte.map(z => `"${z}"`).join(', ')}.` : ''}

Was IMMER eine Freigabe braucht: alles andere – insbesondere bash/Shell-Skripte, npm, git und jedes nicht vorregistrierte Programm. Auch ein Programm mit Pfadangabe (z.B. /usr/local/bin/php) fragt immer.

Bündle Befehle NICHT in bash-Skripte, um die Freigabe zu umgehen – Shell-Skripte umgehen die Sicherheitsgrenzen und werden nicht ohne Freigabe ausgeführt. Brauchst du einen Befehl oder festen Prüflauf regelmäßig, schlage ihn mit propose_command vor. Der Vorschlag landet in einem Prüf-Eingang, den ein Mensch freigibt – erst danach läuft er ohne Rückfrage. Bis dahin führe die Schritte einzeln aus.`;

  const basis = `Du bist ein hilfreicher KI-Assistent mit Dateisystem-Zugriff.
Lesebereich: ${roots.read}
Schreibbereiche (${roots.write.length}):
${roots.write.map(w => `  - ${w}`).join('\n')}
Relative Pfade beziehen sich IMMER auf den Lesebereich, auch beim Schreiben.
Beispiel: Um "${path.join(roots.write[0], 'datei.txt')}" zu schreiben, benutze den Pfad
"${path.join(path.relative(roots.read, roots.write[0]) || '.', 'datei.txt')}" – NICHT "datei.txt".
Lesen darfst du im gesamten Lesebereich, Ändern nur innerhalb der Schreibbereiche.
Wird ein Schreibzugriff wegen der Bereichsgrenze abgelehnt, probiere NICHT dieselbe
Datei über einen anders geschriebenen Pfad – melde es stattdessen dem Nutzer.
Verfügbare Tools: read_file, write_file, edit_file, copy_file, list_files, execute_command, propose_command.
Arbeite Schritt für Schritt: Lies eine Datei, bevor du sie änderst, und benutze für
Änderungen an bestehenden Dateien edit_file statt write_file.
Für Sicherungskopien benutze copy_file (nicht cp). copy_file bleibt im Schreibbereich und
braucht keine Rückfrage; cp wird ohnehin auf copy_file umgeleitet.
${manifest}
Ein Syntax-Check läuft als exakt "php -l <datei>" – schreibe "php" (nicht den vollen Pfad)
und füge kein weiteres Flag hinzu, sonst kommt eine Rückfrage.
Wenn die Aufgabe erledigt ist, antworte mit einer kurzen Zusammenfassung ohne Tool-Call.

Arbeitsplan: Bei mehrstufigen Aufgaben (ab etwa drei Schritten) rufe ZUERST update_plan
auf und gliedere die Aufgabe in Schritte. Halte den Plan danach aktuell: Setze den Schritt,
an dem du gerade arbeitest, auf "laeuft" und melde ihn als "erledigt", sobald er fertig
ist. Stellt sich heraus, dass ein Schritt nicht mehr nötig ist, setze ihn auf "entfaellt"
statt ihn offen zu lassen. Ergänze fehlende Schritte, sobald du sie erkennst.
Bei einfachen Fragen oder Einzelaktionen KEINEN Plan anlegen.`;

  const netz = internetDomains.length > 0
    ? `\nfetch_url ist freigegeben für: ${internetDomains.join(', ')} (inkl. Subdomains, nur GET).`
    : `\nKein Netzzugriff: fetch_url steht nicht zur Verfügung.`;
  const senden = pruefeEndpunkt(apiEndpunkt()).ok
    ? `\npost_to_endpoint sendet an eine fest konfigurierte Adresse. Du kannst das Ziel nicht wählen.`
    : '';

  const komplett = basis + netz + senden;
  if (!rollenOnboarding) return komplett;
  return `${komplett}\n\n--- Rollenbeschreibung "${aktiveRolle}" ---\n${rollenOnboarding}`;
}

/**
 * Aktiviert eine Rolle: Bereiche, Rechte und Modell-Einstellungen übernehmen,
 * Onboarding-Text einlesen.
 *
 * Rückgabe: true, wenn der Gesprächsverlauf zurückgesetzt werden muss – nämlich
 * dann, wenn sich Modell oder Thinking-Modus ändern. Eine History mit
 * reasoning_content wird von einem Non-Thinking-Modell abgelehnt und umgekehrt.
 */
async function aktiviereRolle(name: string, rolle: Rolle): Promise<boolean> {
  const modellWechsel = rolle.settings.model !== settings.model
    || rolle.settings.thinking !== settings.thinking;

  roots.read = rolle.read;
  roots.write = [...rolle.write];
  Object.assign(permissions, rolle.permissions);
  Object.assign(settings, rolle.settings);
  aktiveRolle = name;
  aktiverRollenzugriff = rolle.rollenzugriff === true;
  internetDomains = [...(rolle.internet ?? [])];
  if (internetDomains.length > 0) {
    console.log(chalk.yellow(`  🌐 Netzzugriff (nur GET): ${internetDomains.join(', ')}`));
  }
  if (aktiverRollenzugriff) {
    console.log(chalk.yellow(`  🔓 Diese Rolle darf ~/.leaven lesen (Konfiguration aller Rollen).`));
  }

  // Die Onboarding-Datei liest die CLI selbst – NICHT über read_file. Sie umgeht
  // damit securePath bewusst, denn sie ist Konfiguration, nicht Agentendaten.
  rollenOnboarding = '';
  const datei = path.join(ROLLEN_ORDNER, `.${name}`, 'onboarding.md');
  try {
    rollenOnboarding = (await fs.readFile(datei, 'utf-8')).trim();
    if (rollenOnboarding) {
      console.log(chalk.gray(`  📄 Onboarding geladen (${rollenOnboarding.length} Zeichen).`));
    }
  } catch {
    // optional – ohne Datei bleibt es beim Basis-Prompt
  }

  return modellWechsel;
}

/**
 * Schreibt den Systemprompt neu. MUSS nach jeder Bereichsänderung laufen.
 *
 * Der Prompt wurde früher nur einmal beim Start gebaut: Nach einem /rights glaubte
 * das Modell weiter an die alten Bereiche, während securePath() die neuen erzwang –
 * es bekam also Ablehnungen für genau die Pfade, die ihm vorgegeben waren.
 */
function aktualisiereSystemPrompt(messages: any[]): void {
  if (messages.length > 0 && messages[0].role === 'system') {
    messages[0].content = baueSystemPrompt();
  }
}

// ============================================
// Slash-Befehle
// ============================================
const ORANGE = '#0023E3';
const DUNKELBLAU = '#0023E3';
const breite = () => Math.max(20, (process.stdout.columns || 80) - 1);
const linie = () => chalk.hex(DUNKELBLAU)('━'.repeat(breite()));

/**
 * Kurzhinweis direkt über dem Eingaberahmen. Bewusst OBERHALB: Während getippt wird,
 * gehört die unterste Zeile readline – dorthin lässt sich nichts schreiben, ohne die
 * Cursorposition bei jedem Tastendruck selbst nachzuführen.
 */
function fusszeile(): string {
  const voll = '/help Hilfe · /status Einstellungen · /rights Rechte · Strg-C beenden';
  const kurz = '/help · /status · /rights · Strg-C';
  return chalk.gray(voll.length <= breite() ? voll : kurz);
}

interface SlashBefehl {
  name: string;
  hilfe: string;
  /** Optional: nur anzeigen/anwendbar, wenn true. Steuert die provider-abhängige Anzeige. */
  gilt?: () => boolean;
  ausfuehren: (arg: string, ask: Ask, messages: any[]) => Promise<void>;
}

function zeigeStatus(): void {
  const caps = capabilitiesFor(settings.model);
  console.log(chalk.blue('\n  Aktuelle Einstellungen'));
  console.log(`    Modell       ${chalk.bold(settings.model)} ${chalk.gray(`(${caps.provider})`)}`);
  if (caps.thinkingAlwaysOn) {
    console.log(`    Thinking     ${chalk.green(`immer an (${settings.effort})`)}`);
  } else if (!caps.thinkingToggle) {
    console.log(`    Thinking     ${chalk.gray('Standardmodus (Deep-Thinking braucht Streaming – geplant)')}`);
  } else {
    console.log(`    Thinking     ${settings.thinking ? chalk.green(`an (${settings.effort})`) : chalk.gray('aus')}`);
  }
  // Temperature nur zeigen, wo sie gilt; sonst der Verweis auf /effort.
  if (caps.temperature) console.log(`    Temperature  ${settings.temperature}`);
  else console.log(`    Denktiefe    ${settings.effort} ${chalk.gray(`(/effort: ${caps.effortLevels.join(', ')})`)}`);
  console.log(`    API-Key      ${maskiere(settings.apiKey)} ${chalk.gray(`(${caps.apiKeyEnv})`)}`);
  console.log(`    Lesebereich  ${roots.read}  ${permissions.read ? chalk.green('ohne Rückfrage') : chalk.gray('mit Rückfrage')}`);
  roots.write.forEach((w, i) => {
    const label = i === 0 ? '    Schreibber. ' : '                ';
    const zusatz = i === 0 ? `  ${permissions.write ? chalk.green('ohne Rückfrage') : chalk.gray('mit Rückfrage')}` : '';
    console.log(`${label} ${w}${zusatz}`);
  });
  const befehleTxt = permissions.exec
    ? chalk.green('alle ohne Rückfrage')
    : (permissions.read
        ? chalk.gray('nur Lesebefehle ohne Rückfrage')
        : chalk.gray('nur vorregistrierte ohne Rückfrage (Lesebefehle folgen dem Leserecht)'));
  console.log(`    Befehle      ${befehleTxt}`);
  console.log(`    npm build    ${settings.npmBuild ? chalk.green('on (npm run build ohne Rückfrage)') : chalk.gray('off (/npm-build on)')}`);
  console.log(`    Geheimnisse  ${ALLOW_SECRETS ? chalk.yellow('entsperrt (--allow-secrets)') : chalk.green('gesperrt')}`);
  console.log(`    Gedanken     ${settings.zeigeGedanken ? chalk.green('an (live)') : chalk.gray('aus')}`);
  console.log(`    Schritte     ${settings.zeigeSchritte ? chalk.green('an') : chalk.gray('aus (nur Bericht)')}`);
  {
    const prov = caps.provider;
    const v = usageDaten.verbrauch[prov] || 0;
    const l = usageDaten.limits[prov] || 0;
    const budget = l > 0 ? `${v}/${l}` : `${v} (kein Limit)`;
    console.log(`    Budget       ${prov}: ${budget} Tokens heute · Auto-Stopp ${settings.autoStopp ? chalk.green('an') : chalk.gray('aus')} ${chalk.gray('(/budget)')}`);
    console.log(`    Auto-weiter  ${settings.autoWeiter ? chalk.green('an') : chalk.gray('aus')} ${chalk.gray('(/resume auto on|off)')}`);
  }
  {
    const limit = loopBreaker.getMaxToolCalls();
    const zustand = limit > 0
      ? chalk.green(`an (${loopBreaker.getTotalCalls()}/${limit})`)
      : chalk.gray('aus');
    console.log(`    Backstop     ${zustand} ${chalk.gray('(/backstop on|off)')}`);
  }
  console.log('');
}

/**
 * Setzt die Konversation zurück. Nötig bei Modell- und Thinking-Wechsel: Eine
 * History, die reasoning_content eines Thinking-Modells enthält, wird von einem
 * Non-Thinking-Modell nicht akzeptiert – und umgekehrt verlangt ein Thinking-Modell
 * das Feld in Nachrichten, die es gar nicht hat. Genau daran ist dieses Projekt
 * ursprünglich gescheitert (HTTP 400).
 */
function setzeKonversationZurueck(messages: any[], grund: string): void {
  messages.splice(1);            // System-Nachricht behalten
  loopBreaker.reset();
  zustand.plan = [];                     // ohne Verlauf ergibt der alte Plan keinen Sinn mehr
  console.log(chalk.yellow(`  ↺ Gesprächsverlauf zurückgesetzt (${grund}).`));
}

async function waehleAus(
  titel: string, optionen: string[], aktuell: string, ask: Ask
): Promise<string | null> {
  console.log(chalk.blue(`\n  ${titel}`));
  optionen.forEach((o, i) => {
    const marke = o === aktuell ? chalk.green(' ← aktuell') : '';
    console.log(`    ${i + 1}) ${o}${marke}`);
  });
  process.stdout.write(chalk.green('  Nummer (Enter = unverändert): '));
  const antwort = (await ask()).trim();
  if (!antwort) return null;
  const nr = Number(antwort);
  if (!Number.isInteger(nr) || nr < 1 || nr > optionen.length) {
    console.log(chalk.red(`  Ungültige Auswahl: ${antwort}`));
    return null;
  }
  return optionen[nr - 1];
}

const BEFEHLE: SlashBefehl[] = [
  {
    name: '/help',
    hilfe: 'Diese Übersicht anzeigen',
    ausfuehren: async () => zeigeHilfe(),
  },
  {
    name: '/status',
    hilfe: 'Aktuelle Einstellungen anzeigen',
    ausfuehren: async () => zeigeStatus(),
  },
  {
    name: '/rights',
    hilfe: 'Lese-/Schreibbereiche und Berechtigungen einstellen',
    ausfuehren: async (_arg, ask) => { await askPermissions(ask, true); },
  },
  {
    name: '/model',
    hilfe: `Modell wählen – voller Name oder Kurzname (opus, fable, qwen, deepseek)`,
    ausfuehren: async (arg, ask, messages) => {
      // Kurznamen auflösen: "/model opus" -> claude-opus-5 usw.
      const aufgeloest = arg ? aufloesenModell(arg) : '';
      const neu = arg ? (MODELLE.includes(aufgeloest) ? aufgeloest : null) : await waehleAus('Modell', MODELLE, settings.model, ask);
      if (arg && !neu) {
        console.log(chalk.red(`  Unbekanntes Modell: ${arg}`));
        console.log(chalk.gray(`  Kurznamen: opus, fable, qwen, deepseek · oder voll: ${MODELLE.join(', ')}`));
        return;
      }
      if (!neu || neu === settings.model) return;
      settings.model = neu;
      // Schlüssel des neuen Providers ziehen; fehlt er, klar sagen welche Variable nötig ist.
      aktualisiereApiKey();
      const caps = capabilitiesFor(neu);
      // Der voreingestellte Effort muss zu den Stufen des Providers passen (z.B. DeepSeek
      // kennt "low" nicht). Sonst still auf eine gültige Stufe fallen. Bei Providern ohne
      // Effort-Konzept (Qwen: leere Liste) nichts anfassen.
      if (caps.effortLevels.length && !caps.effortLevels.includes(settings.effort)) {
        settings.effort = caps.effortLevels.includes('high') ? 'high' : caps.effortLevels[0];
      }
      console.log(chalk.green(`  ✔ Modell: ${neu}`));
      if (!settings.apiKey) {
        console.log(chalk.yellow(`    ⚠️  Kein Schlüssel: export ${caps.apiKeyEnv}="dein-key"`));
      }
      if (caps.thinkingAlwaysOn) console.log(chalk.gray('    Thinking ist bei diesem Modell immer an.'));
      if (!caps.temperature) console.log(chalk.gray('    /temperature entfällt – Steuerung über /effort.'));
      if (caps.provider === 'qwen') console.log(chalk.gray('    Läuft im Standardmodus (Deep-Thinking braucht Streaming – geplant).'));
      if (messages.length > 1) setzeKonversationZurueck(messages, 'Modellwechsel');
    },
  },
  {
    name: '/thinking',
    hilfe: 'Toggle thinking mode on/off — resets conversation',
    ausfuehren: async (arg, ask, messages) => {
      const caps = capabilitiesFor(settings.model);
      if (caps.thinkingAlwaysOn) {
        console.log(chalk.gray(`  Thinking ist bei ${settings.model} immer an – nicht abschaltbar.`));
        return;
      }
      if (!caps.thinkingToggle) {
        console.log(chalk.gray(`  Thinking ist bei ${settings.model} (noch) nicht verfügbar.`));
        console.log(chalk.gray('  Qwens Deep-Thinking braucht Streaming – das ist ein geplanter Folge-Schritt.'));
        return;
      }
      let neu: boolean;
      if (arg === 'on' || arg === 'an') neu = true;
      else if (arg === 'off' || arg === 'aus') neu = false;
      else {
        const wahl = await waehleAus('Thinking-Modus', ['an', 'aus'], settings.thinking ? 'an' : 'aus', ask);
        if (!wahl) return;
        neu = wahl === 'an';
      }
      if (neu === settings.thinking) return;
      settings.thinking = neu;
      console.log(chalk.green(`  ✔ Thinking: ${neu ? `an (${settings.effort})` : 'aus'}`));
      if (messages.length > 1) setzeKonversationZurueck(messages, 'Thinking-Wechsel');
    },
  },
  {
    name: '/effort',
    hilfe: 'Denktiefe (Stufen je Modell)',
    ausfuehren: async (arg, ask) => {
      const stufen = capabilitiesFor(settings.model).effortLevels;
      if (!stufen.length) {
        console.log(chalk.gray(`  Denktiefe ist bei ${settings.model} nicht einstellbar.`));
        return;
      }
      const neu = arg && stufen.includes(arg)
        ? arg
        : await waehleAus('Denktiefe', stufen, settings.effort, ask);
      if (!neu) return;
      settings.effort = neu;
      console.log(chalk.green(`  ✔ Denktiefe: ${neu}`));
      if (capabilitiesFor(settings.model).thinkingToggle && !settings.thinking) {
        console.log(chalk.gray('    (wirkt erst, wenn Thinking eingeschaltet ist)'));
      }
    },
  },
  {
    name: '/temperature',
    hilfe: 'Temperatur 0.0–2.0 setzen (nur DeepSeek)',
    gilt: () => capabilitiesFor(settings.model).temperature,
    ausfuehren: async (arg, ask) => {
      if (!capabilitiesFor(settings.model).temperature) {
        console.log(chalk.yellow(`  Nicht verfügbar für ${settings.model}.`));
        console.log(chalk.gray('  Die Anthropic-API kennt temperature nicht – nutze /effort'));
        console.log(chalk.gray(`  (${capabilitiesFor(settings.model).effortLevels.join(', ')}).`));
        return;
      }
      let roh = arg;
      if (!roh) {
        process.stdout.write(chalk.green(`\n  Temperatur 0.0–2.0 [${settings.temperature}]: `));
        roh = (await ask()).trim();
      }
      if (!roh) return;
      const wert = Number(roh.replace(',', '.'));
      if (!Number.isFinite(wert) || wert < 0 || wert > 2) {
        console.log(chalk.red(`  Ungültig: ${roh} (erlaubt 0.0–2.0)`));
        return;
      }
      settings.temperature = wert;
      console.log(chalk.green(`  ✔ Temperatur: ${wert}`));
      if (settings.thinking) {
        console.log(chalk.gray('    Hinweis: Bei aktivem Thinking wird die Temperatur von der API'));
        console.log(chalk.gray('    zwar angenommen, ihre Wirkung ist dort aber nicht zugesichert.'));
      }
    },
  },
  {
    name: '/output',
    hilfe: 'Toggle display: reasoning stream and intermediate steps (on/off)',
    ausfuehren: async (arg) => {
      const [was, wert] = arg.trim().split(/\s+/).filter(Boolean);
      const onOff = (v: string) =>
        ['on', 'an'].includes(v) ? true : ['off', 'aus'].includes(v) ? false : null;

      if (!was) {
        console.log(chalk.blue('\n  Anzeige'));
        console.log(`    Gedankenstrom (live) ${settings.zeigeGedanken ? chalk.green('an') : chalk.gray('aus')}`);
        console.log(`    Zwischenschritte     ${settings.zeigeSchritte ? chalk.green('an') : chalk.gray('aus (nur Bericht)')}`);
        console.log(chalk.gray('\n    Change: "/output reasoning on|off"  or  "/output steps on|off"'));
        console.log(chalk.gray('    reasoning = live thought stream (gray) · steps = intermediate steps\n'));
        return;
      }

      const ziel = ['reasoning', 'gedanken', 'thoughts'].includes(was.toLowerCase()) ? 'gedanken'
        : ['steps', 'schritte'].includes(was.toLowerCase()) ? 'schritte' : null;
      if (!ziel) {
        console.log(chalk.red('  Unknown. Use: /output reasoning on|off  OR  /output steps on|off'));
        return;
      }
      const b = onOff((wert || '').toLowerCase());
      if (b === null) { console.log(chalk.red('  Bitte "on" oder "off" angeben, z.B. /output reasoning off')); return; }

      if (ziel === 'gedanken') {
        settings.zeigeGedanken = b;
        console.log(chalk.green(`  ✔ Gedankenstrom: ${b ? 'an (live)' : 'aus'}`));
      } else {
        settings.zeigeSchritte = b;
        console.log(chalk.green(`  ✔ Zwischenschritte: ${b ? 'an' : 'aus (nur Endergebnis + Bericht)'}`));
      }
    },
  },
  {
    name: '/npm-build',
    hilfe: 'Exakt "npm run build" ohne Rückfrage laufen lassen (on/off, Default off)',
    ausfuehren: async (arg) => {
      const wert = arg.trim().toLowerCase();
      const onOff = ['on', 'an'].includes(wert) ? true
        : ['off', 'aus'].includes(wert) ? false : null;
      if (!wert) {
        console.log(chalk.blue('\n  npm run build ohne Rückfrage'));
        console.log(`    Status: ${settings.npmBuild ? chalk.green('on') : chalk.gray('off')}`);
        console.log(chalk.gray('\n    Umstellen: "/npm-build on"  oder  "/npm-build off"'));
        console.log(chalk.gray('    Betrifft NUR den exakten Befehl "npm run build" – sonst nichts.\n'));
        return;
      }
      if (onOff === null) { console.log(chalk.red('  Bitte "on" oder "off" angeben, z.B. /npm-build on')); return; }
      settings.npmBuild = onOff;
      console.log(chalk.green(`  ✔ npm run build ohne Rückfrage: ${onOff ? 'on' : 'off'}`));
    },
  },
  {
    name: '/budget',
    hilfe: 'Tages-Token-Budget pro Anbieter setzen/anzeigen; Auto-Stopp an/aus',
    ausfuehren: async (arg) => {
      usageDaten = resetWennNeuerTag(usageDaten, heutigesDatum());
      const [a, b] = arg.trim().split(/\s+/).filter(Boolean);

      if (!a) {
        console.log(chalk.blue('\n  Tages-Token-Budget') + chalk.gray(`  (Stand ${usageDaten.datum})`));
        console.log(`    Auto-Stopp   ${settings.autoStopp ? chalk.green('an') : chalk.gray('aus (nur Zählung, keine Grenze)')}`);
        for (const p of ANBIETER) {
          const v = usageDaten.verbrauch[p] || 0;
          const l = usageDaten.limits[p] || 0;
          const stand = l > 0 ? `${v} / ${l}` : `${v} / ohne Limit`;
          const warn = ueberBudget(usageDaten, p) ? chalk.red(' ⛔ erreicht') : '';
          console.log(`    ${p.padEnd(10)} ${stand}${warn}`);
        }
        console.log(chalk.gray('\n    Limit setzen: "/budget anthropic 500000"  (0 = kein Limit)'));
        console.log(chalk.gray('    Auto-Stopp:   "/budget auto on"  /  "/budget auto off"\n'));
        return;
      }

      if (a.toLowerCase() === 'auto') {
        const on = ['on', 'an'].includes((b || '').toLowerCase());
        const off = ['off', 'aus'].includes((b || '').toLowerCase());
        if (!on && !off) { console.log(chalk.red('  Nutze: /budget auto on|off')); return; }
        settings.autoStopp = on;
        usageDaten.autoStopp = on;   // persistieren – gilt auch nach Neustart
        speichereUsage();
        console.log(chalk.green(`  ✔ Auto-Stopp: ${on ? 'an (Grenze wird erzwungen)' : 'aus (nur Zählung)'}`));
        return;
      }

      const prov = a.toLowerCase();
      if (!ANBIETER.includes(prov)) {
        console.log(chalk.red(`  Anbieter unbekannt. Erlaubt: ${ANBIETER.join(', ')}`));
        return;
      }
      const n = Number(b);
      if (!Number.isFinite(n) || n < 0) {
        console.log(chalk.red('  Token-Zahl angeben, z.B. /budget anthropic 500000  (0 = kein Limit)'));
        return;
      }
      usageDaten.limits[prov] = Math.floor(n);
      speichereUsage();
      console.log(chalk.green(`  ✔ Tageslimit ${prov}: ${n > 0 ? Math.floor(n) + ' Tokens' : 'kein Limit'}`));
      if (n > 0 && !settings.autoStopp) {
        console.log(chalk.gray('    Hinweis: Grenze wirkt erst, wenn Auto-Stopp an ist → "/budget auto on".'));
      }
    },
  },
  {
    name: '/backstop',
    hilfe: 'Budget-Backstop (max. Tool-Calls pro Sitzung) an/aus oder Zahl setzen',
    ausfuehren: async (arg, ask) => {
      const [a] = arg.trim().split(/\s+/).filter(Boolean);

      // Ohne Argument: Stand zeigen + fragen.
      if (!a) {
        const limit = loopBreaker.getMaxToolCalls();
        console.log(chalk.blue('\n  Budget-Backstop') + chalk.gray('  (harte Obergrenze an Tool-Calls pro Sitzung)'));
        console.log(`    Zustand      ${limit > 0 ? chalk.green(`an (Limit ${limit})`) : chalk.gray('aus (kein Limit)')}`);
        console.log(`    Verbraucht   ${loopBreaker.getTotalCalls()} Tool-Calls`);
        console.log(chalk.gray('\n    Umschalten:  "/backstop off"  /  "/backstop on"  /  "/backstop 500"'));
        console.log(chalk.gray('    (Loop- und Zyklus-Erkennung bleiben davon unberührt.)\n'));
        return;
      }

      const wort = a.toLowerCase();
      if (['off', 'aus'].includes(wort)) {
        loopBreaker.setMaxToolCalls(0);
        console.log(chalk.green('  ✔ Budget-Backstop: aus (kein Limit mehr)'));
        console.log(chalk.gray('    Loop- und Zyklus-Erkennung bleiben aktiv.'));
        return;
      }
      if (['on', 'an'].includes(wort)) {
        const wert = (config.max_tool_calls ?? 200) || 9999;
        loopBreaker.setMaxToolCalls(wert);
        console.log(chalk.green(`  ✔ Budget-Backstop: an (Limit ${wert})`));
        return;
      }

      const n = Number(a);
      if (!Number.isFinite(n) || n < 0) {
        console.log(chalk.red('  Nutze: /backstop on|off  oder eine Zahl, z.B. /backstop 500  (0 = aus)'));
        return;
      }
      loopBreaker.setMaxToolCalls(n);
      console.log(chalk.green(`  ✔ Budget-Backstop: ${n > 0 ? `an (Limit ${Math.floor(n)})` : 'aus (kein Limit)'}`));
    },
  },
  {
    name: '/key',
    hilfe: 'API-Schlüssel anzeigen oder für diese Sitzung wechseln',
    ausfuehren: async (arg, ask) => {
      const env = capabilitiesFor(settings.model).apiKeyEnv;
      // Beide Schlüssel anzeigen – der aktive ist markiert.
      console.log(chalk.gray('\n  Schlüssel:'));
      for (const [name, wert] of Object.entries(apiKeys)) {
        const aktiv = name === env ? chalk.hex(ORANGE)(' ← aktiv') : '';
        console.log(`${chalk.gray(`    ${name.padEnd(18)} ${maskiere(wert)}`)}${aktiv}`);
      }
      let neu = arg;
      if (!neu) {
        process.stdout.write(chalk.green(`  Neuer Schlüssel für ${env} (Enter = unverändert): `));
        neu = (await ask()).trim();
      }
      if (!neu) return;
      // In den Slot des AKTIVEN Providers schreiben – der andere bleibt erhalten.
      apiKeys[env] = neu;
      aktualisiereApiKey();
      console.log(chalk.green(`  ✔ ${env} gesetzt: ${maskiere(neu)}`));
      console.log(chalk.gray('    Gilt nur für diese Sitzung – die Shell-Variable bleibt unverändert.'));
    },
  },
  {
    name: '/plan',
    hilfe: 'Arbeitsplan anzeigen · clear löscht ihn',
    ausfuehren: async (arg) => {
      if (arg.trim().toLowerCase() === 'clear') {
        zustand.plan = [];
        console.log(chalk.green('  ✔ Arbeitsplan gelöscht.'));
        return;
      }
      if (zustand.plan.length === 0) {
        console.log(chalk.gray('\n  Kein Arbeitsplan. Das Modell legt bei mehrstufigen Aufgaben selbst einen an.\n'));
        return;
      }
      zeigePlan();
      console.log('');
    },
  },
  {
    name: '/internet',
    hilfe: 'Freigegebene Domains: list · add <domain> · remove <domain> · clear',
    ausfuehren: async (arg, _ask, messages) => {
      const [unter, ...rest] = arg.split(/\s+/).filter(Boolean);
      const domain = rest.join(' ').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');

      switch ((unter || 'list').toLowerCase()) {
        case 'list':
          if (internetDomains.length === 0) {
            console.log(chalk.gray('\n  Kein Netzzugriff. "/internet add <domain>" gibt eine Domain frei.\n'));
          } else {
            console.log(chalk.blue('\n  Freigegebene Domains (inkl. Subdomains):'));
            internetDomains.forEach(d => console.log(`    ${d}`));
            console.log(chalk.gray('\n    Nur Lesen (GET). Senden ist ausschliesslich an den Endpunkt möglich.\n'));
          }
          return;
        case 'add': {
          if (!domain) { console.log(chalk.red('\n  Domain fehlt: /internet add <domain>\n')); return; }
          if (!internetDomains.includes(domain)) internetDomains.push(domain);
          console.log(chalk.green(`  ✔ Freigegeben: ${domain} (inkl. Subdomains)`));
          aktualisiereSystemPrompt(messages);
          return;
        }
        case 'remove':
          internetDomains = internetDomains.filter(d => d !== domain);
          console.log(chalk.green(`  ✔ Entfernt: ${domain}`));
          aktualisiereSystemPrompt(messages);
          return;
        case 'clear':
          internetDomains = [];
          console.log(chalk.green('  ✔ Netzzugriff abgeschaltet.'));
          aktualisiereSystemPrompt(messages);
          return;
        default:
          console.log(chalk.red(`\n  Unbekannt: ${unter} – möglich: list, add, remove, clear\n`));
      }
    },
  },
  {
    name: '/endpoint',
    hilfe: 'Sende-Ziel für post_to_endpoint: show · set <url> · clear',
    ausfuehren: async (arg, _ask, messages) => {
      const [unter, ...rest] = arg.split(/\s+/).filter(Boolean);
      const wert = rest.join(' ').trim();

      switch ((unter || 'show').toLowerCase()) {
        case 'show': {
          const p = pruefeEndpunkt(apiEndpunkt());
          console.log(p.ok
            ? chalk.blue(`\n  Sende-Ziel: ${p.url.toString()}\n`)
            : chalk.gray(`\n  Kein Sende-Ziel: ${p.grund}\n`));
          return;
        }
        case 'set': {
          const p = pruefeEndpunkt(wert);
          if (!p.ok) { console.log(chalk.red(`\n  Abgelehnt: ${p.grund}\n`)); return; }
          endpunktUeberschrieben = p.url.toString();
          console.log(chalk.green(`  ✔ Sende-Ziel: ${p.url.toString()}`));
          console.log(chalk.gray(`    Nur diese eine Adresse. Das Modell kann kein anderes Ziel wählen,`));
          console.log(chalk.gray(`    und Weiterleitungen werden nicht befolgt.`));
          aktualisiereSystemPrompt(messages);
          return;
        }
        case 'clear':
          endpunktUeberschrieben = null;
          process.env.LEAVEN_API_ENDPOINT = '';
          console.log(chalk.green('  ✔ Sende-Ziel entfernt – post_to_endpoint ist nicht mehr verfügbar.'));
          aktualisiereSystemPrompt(messages);
          return;
        default:
          console.log(chalk.red(`\n  Unbekannt: ${unter} – möglich: show, set, clear\n`));
      }
    },
  },
  {
    name: '/role',
    hilfe: 'Rollen: ohne Argument Auswahl · use|new|edit|list|delete <name>',
    ausfuehren: async (arg, ask, messages) => { await befehlRolle(arg, ask, messages); },
  },
  {
    name: '/clear',
    hilfe: 'Gesprächsverlauf löschen, Einstellungen behalten',
    ausfuehren: async (_arg, _ask, messages) => setzeKonversationZurueck(messages, 'auf Wunsch'),
  },
  {
    name: '/exit',
    hilfe: 'leaven-cli beenden',
    ausfuehren: async () => { /* wird in der Hauptschleife behandelt */ },
  },
];

function beschreibeRolle(name: string, r: Rolle, aktiv: boolean): string[] {
  const ja = (b: boolean) => (b ? 'ja' : 'nein');
  return [
    `  ${aktiv ? chalk.green('●') : ' '} ${chalk.bold(name)}`,
    chalk.gray(`      Lesen      ${shortPath(r.read)}`),
    ...r.write.map((w, i) => chalk.gray(`      ${i === 0 ? 'Schreiben ' : '          '} ${shortPath(w)}`)),
    chalk.gray(`      Rechte     Lesen ${ja(r.permissions.read)} · Schreiben ${ja(r.permissions.write)} · Shell ${ja(r.permissions.exec)}`),
    chalk.gray(`      Modell     ${r.settings.model}${r.settings.thinking ? ` (Thinking ${r.settings.effort})` : ' (ohne Thinking)'}`),
    ...(r.rollenzugriff ? [chalk.yellow(`      Sonder     darf ~/.leaven lesen`)] : []),
    ...(r.internet && r.internet.length > 0
      ? [chalk.yellow(`      Netz       ${r.internet.join(', ')} (nur GET)`)] : []),
  ];
}

async function uebernehmeRolle(name: string, rolle: Rolle, messages: any[]): Promise<void> {
  const zuruecksetzen = await aktiviereRolle(name, rolle);
  aktualisiereSystemPrompt(messages);
  console.log(chalk.green(`  ✔ Rolle aktiv: ${name}`));
  zeigeRechteZusammenfassung();
  if (zuruecksetzen && messages.length > 1) {
    setzeKonversationZurueck(messages, 'Modell-/Thinking-Wechsel durch die Rolle');
    aktualisiereSystemPrompt(messages);
  }
}

async function befehlRolle(arg: string, ask: Ask, messages: any[]): Promise<void> {
  const [unterbefehl, ...rest] = arg.split(/\s+/).filter(Boolean);
  const name = rest.join(' ').trim();
  const rollen = await ladeRollen();
  const namen = Object.keys(rollen).sort();

  // Ohne Argument: Auswahl aus den vorhandenen Rollen.
  if (!unterbefehl) {
    if (namen.length === 0) {
      console.log(chalk.yellow('\n  Noch keine Rollen angelegt. "/role new <name>" legt eine an.\n'));
      return;
    }
    if (!aktivesRl || !process.stdin.isTTY) {
      console.log(chalk.yellow('\n  Kein interaktives Terminal – nutze "/role use <name>".\n'));
      return;
    }
    const gewaehlt = await mehrfachAuswahl(
      aktivesRl,
      chalk.blue('  Welche Rolle aktivieren?'),
      namen.map(n => ({ text: n, vorausgewaehlt: n === aktiveRolle })),
      'Leertaste ankreuzen · ↑↓ navigieren · ⏎ aktivieren · Esc abbrechen'
    );
    if (!gewaehlt || gewaehlt.length === 0) return;
    if (gewaehlt.length > 1) {
      console.log(chalk.yellow('  Nur eine Rolle kann aktiv sein – nehme die erste ausgewählte.'));
    }
    const ziel = namen[gewaehlt[0]];
    await uebernehmeRolle(ziel, rollen[ziel], messages);
    return;
  }

  switch (unterbefehl.toLowerCase()) {
    case 'list': {
      if (namen.length === 0) { console.log(chalk.yellow('\n  Noch keine Rollen angelegt.\n')); return; }
      console.log(chalk.blue(`\n  Rollen (${namen.length}):`));
      namen.forEach(n => beschreibeRolle(n, rollen[n], n === aktiveRolle).forEach(z => console.log(z)));
      console.log(chalk.gray(`\n  Onboarding: ~/.leaven/roles/.<name>/onboarding.md\n`));
      return;
    }

    case 'use': {
      if (!name) { console.log(chalk.red('\n  Name fehlt: /role use <name>\n')); return; }
      if (!rollen[name]) { console.log(chalk.red(`\n  Unbekannte Rolle: ${name}\n`)); return; }
      await uebernehmeRolle(name, rollen[name], messages);
      return;
    }

    case 'new':
    case 'edit': {
      if (!name) { console.log(chalk.red(`\n  Name fehlt: /role ${unterbefehl} <name>\n`)); return; }
      const neu = unterbefehl.toLowerCase() === 'new';
      if (neu && rollen[name]) { console.log(chalk.red(`\n  "${name}" existiert bereits – nutze /role edit ${name}\n`)); return; }
      if (!neu && !rollen[name]) { console.log(chalk.red(`\n  Unbekannte Rolle: ${name}\n`)); return; }

      // Bestehende Rolle als Ausgangspunkt laden, damit "edit" die Ist-Werte zeigt.
      if (!neu) await aktiviereRolle(name, rollen[name]);

      console.log(chalk.blue(`\n  Rolle "${name}" einrichten`));
      console.log(chalk.gray('  Bereiche und Rechte werden jetzt abgefragt und unter diesem Namen gespeichert.'));
      await askPermissions(ask, true);

      console.log(chalk.gray(`\n  Nur für Rollen, die an leaven-cli selbst arbeiten:`));
      const zugriff = await frageJaNein(
        'Darf diese Rolle ~/.leaven lesen (Konfiguration ALLER Rollen)?',
        rollen[name]?.rollenzugriff === true,
        ask
      );

      rollen[name] = rollenSchnappschuss(zugriff);
      await speichereRollen(rollen);

      const ordner = path.join(ROLLEN_ORDNER, `.${name}`);
      await fs.mkdir(ordner, { recursive: true });
      const datei = path.join(ordner, 'onboarding.md');
      try {
        await fs.access(datei);
      } catch {
        await fs.writeFile(
          datei,
          `# Onboarding für die Rolle "${name}"\n\n` +
          `Dieser Text wird dem Modell beim Aktivieren der Rolle als Teil des\n` +
          `Systemprompts mitgegeben. Beschreibe hier Aufgabe, Konventionen und\n` +
          `alles, was sonst jedes Mal neu erklärt werden müsste.\n\n` +
          `Die Rolle darf ausschliesslich dieses Verzeichnis unter ~/.leaven lesen,\n` +
          `nicht die Konfiguration der anderen Rollen.\n`,
          'utf-8'
        );
        console.log(chalk.gray(`  📄 Onboarding-Vorlage angelegt: ${shortPath(datei)}`));
      }

      console.log(chalk.green(`  ✔ Rolle "${name}" gespeichert.`));
      await uebernehmeRolle(name, rollen[name], messages);
      return;
    }

    case 'delete': {
      if (!name) { console.log(chalk.red('\n  Name fehlt: /role delete <name>\n')); return; }
      if (!rollen[name]) { console.log(chalk.red(`\n  Unbekannte Rolle: ${name}\n`)); return; }
      process.stdout.write(chalk.yellow(`  Rolle "${name}" wirklich löschen? [y/N]: `));
      if (!['y', 'yes', 'j', 'ja'].includes((await ask()).trim().toLowerCase())) {
        console.log(chalk.gray('  Abgebrochen.'));
        return;
      }
      delete rollen[name];
      await speichereRollen(rollen);
      if (aktiveRolle === name) { aktiveRolle = null; rollenOnboarding = ''; aktualisiereSystemPrompt(messages); }
      console.log(chalk.green(`  ✔ Rolle "${name}" gelöscht.`));
      console.log(chalk.gray(`    Das Verzeichnis ${shortPath(path.join(ROLLEN_ORDNER, `.${name}`))} bleibt bestehen.`));
      return;
    }

    default:
      console.log(chalk.red(`\n  Unbekannter Unterbefehl: ${unterbefehl}`));
      console.log(chalk.gray('  Möglich: use, new, edit, list, delete – oder "/role" für die Auswahl.\n'));
  }
}

function zeigeHilfe(): void {
  console.log(chalk.blue('\n  Befehle'));
  // Nur Befehle zeigen, die für das aktive Modell gelten (z.B. /temperature nur bei DeepSeek).
  for (const b of BEFEHLE) {
    if (b.gilt && !b.gilt()) continue;
    console.log(`    ${chalk.hex(ORANGE)(b.name.padEnd(14))} ${chalk.gray(b.hilfe)}`);
  }
  console.log(chalk.gray('\n    Argument direkt möglich, z.B. "/model deepseek-v4-flash" oder "/thinking off".'));
  console.log(chalk.gray('    Alles ohne führenden Schrägstrich geht als Auftrag an das Modell.'));
  console.log(chalk.gray('    Nach Auto-Stopp: "weiter" (oder "/resume") setzt fort · "/resume auto on|off" für den Auto-Start.'));

  console.log(chalk.blue('\n  Bedienung'));
  console.log(chalk.gray('    Enter            Auftrag absenden'));
  console.log(chalk.gray('    Mehrzeiliges     Einfügen wird zu EINEM Auftrag zusammengefasst –'));
  console.log(chalk.gray('                     ein 100-Zeilen-Prompt ist also ein Aufruf, nicht 100'));
  console.log(chalk.gray('    Strg-C           beendet die CLI sofort (bricht auch einen laufenden Auftrag ab)'));
  console.log(chalk.gray('    Strg-D           beendet die CLI ebenfalls'));
  console.log(chalk.gray('    Blaue Linien     rahmen deine eigene Eingabe ein'));

  console.log(chalk.blue('\n  Im Freigabe-Dialog'));
  console.log(chalk.gray('    ↑ ↓              zwischen den Aktionen wechseln'));
  console.log(chalk.gray('    Leertaste        Aktion an-/abwählen'));
  console.log(chalk.gray('    Enter            ausgewählte Aktionen ausführen'));
  console.log(chalk.gray('    a                alle abwählen'));
  console.log(chalk.gray('    Esc              alle ablehnen'));

  console.log(chalk.blue('\n  Bereiche'));
  console.log(chalk.gray(`    Lesen            ${roots.read}`));
  roots.write.forEach((w, i) => {
    console.log(chalk.gray(`    ${i === 0 ? 'Schreiben       ' : '                '} ${w}`));
  });
  console.log(chalk.gray('    Relative Pfade zählen immer ab dem Lesebereich – auch beim Schreiben.'));
  console.log(chalk.gray('    Ändern mit "/rights".\n'));
}

/** Gibt true zurück, wenn die Eingabe ein Slash-Befehl war (und behandelt wurde). */
async function behandleSlashBefehl(eingabe: string, ask: Ask, messages: any[]): Promise<boolean> {
  if (!eingabe.startsWith('/')) return false;

  const [name, ...rest] = eingabe.trim().split(/\s+/);
  const befehl = BEFEHLE.find(b => b.name === name.toLowerCase());

  if (!befehl) {
    console.log(chalk.red(`\n  Unbekannter Befehl: ${name}`));
    console.log(chalk.gray('  "/help" zeigt alle Befehle.\n'));
    return true;
  }

  await befehl.ausfuehren(rest.join(' ').trim(), ask, messages);
  return true;
}

// ============================================
// Haupt-Chat-Funktion
// ============================================
async function startChat() {
  if (!settings.apiKey) {
    console.log(chalk.red('❌ Kein API-Key gefunden!'));
    console.log(chalk.yellow(`💡 Setze: export ${capabilitiesFor(settings.model).apiKeyEnv}="dein-key"`));
    return;
  }

  loopBreaker.reset();

  console.log(chalk.hex(DUNKELBLAU).bold(`\n█     █████  ███  █   █ █████ █   █     ███   ███  ████  █████ \n█     █     █   █ █   █ █     ██  █    █     █   █ █   █ █     \n█     ████  █████ █   █ ████  █ █ █    █     █   █ █   █ ████  \n█     █     █   █  █ █  █     █  ██    █     █   █ █   █ █     \n█████ █████ █   █   █   █████ █   █     ███   ███  ████  █████ `));
  console.log(chalk.gray(`  ${settings.model}${settings.thinking ? ` · Thinking ${settings.effort}` : ' · ohne Thinking'} · Loop Breaker aktiv`));

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  aktivesRl = rl;   // für die Checkbox-Auswahl in askPermissions()

  // Eingaben werden gepuffert, statt sie per rl.question() einzeln abzuholen.
  // Bei gepipter Eingabe trifft der komplette Text als ein Chunk ein, lange bevor
  // der erste Turn fertig ist – ohne Queue gingen alle Zeilen bis auf die erste
  // verloren. Ausserdem beendet 'close' (Ctrl-D, EOF) die Schleife sauber, statt
  // sie ewig warten zu lassen.
  const pending: string[] = [];
  let closed = false;
  let waiting: ((value: string) => void) | null = null;

  const deliver = (value: string) => {
    const resolve = waiting;
    waiting = null;
    if (resolve) resolve(value);
    else pending.push(value);
  };

  rl.setPrompt(chalk.hex(DUNKELBLAU)('› '));

  // Einfügen von mehrzeiligem Text: Das Terminal schickt ihn als normale
  // Tastenanschläge inklusive Zeilenumbruch, readline feuert also pro Zeile ein
  // 'line'-Ereignis. Ohne Zusammenfassung würde ein 100-Zeilen-Prompt zu 100
  // einzelnen Aufträgen – gemessen und bestätigt.
  //
  // Zeilen, die innerhalb von PASTE_FENSTER_MS eintreffen, gehören zusammen: Ein
  // Mensch braucht zwischen zwei Enter-Anschlägen deutlich länger.
  //
  // NUR im echten Terminal. Bei gepipter Eingabe muss jede Zeile ein eigener
  // Auftrag bleiben, sonst brechen Skripte und Testläufe.
  const PASTE_FENSTER_MS = 120;
  const interaktiv = Boolean(process.stdin.isTTY);
  let sammler: string[] = [];
  let sammelTimer: NodeJS.Timeout | null = null;

  const flushSammler = () => {
    sammelTimer = null;
    const text = sammler.join('\n');
    sammler = [];
    deliver(text);
  };

  rl.on('line', (zeile: string) => {
    if (!interaktiv) { deliver(zeile); return; }
    sammler.push(zeile);
    if (sammelTimer) clearTimeout(sammelTimer);
    sammelTimer = setTimeout(flushSammler, PASTE_FENSTER_MS);
  });

  rl.on('close', () => {
    closed = true;
    if (sammelTimer) { clearTimeout(sammelTimer); flushSammler(); return; }
    if (waiting) { const resolve = waiting; waiting = null; resolve('exit'); }
  });

  // Liest eine Zeile OHNE den Chat-Prompt auszugeben – die Berechtigungsfragen
  // schreiben ihren eigenen Text davor.
  const readLine = () => new Promise<string>(resolve => {
    const buffered = pending.shift();
    if (buffered !== undefined) return resolve(buffered);
    if (closed) return resolve('exit');
    rl.resume();
    waiting = resolve;
  });

  await askPermissions(readLine);

  console.log(chalk.bold(`\n  Hallo! Womit kann ich dir heute helfen?`));
  console.log(chalk.gray(`  "/help" zeigt alle Befehle · "/exit" beendet.`));

  const messages: any[] = [{ role: 'system', content: baueSystemPrompt() }];

  // Unterbrochene Aufgabe (per Auto-Stopp gesichert) laden und darauf hinweisen.
  ladeSession();
  if (geladeneSession && interaktiv) {
    console.log(chalk.hex(ORANGE)(`\n  ⏸  Unterbrochene Aufgabe vom ${geladeneSession.datum}: „${geladeneSession.label}"`));
    // Auto-Fortsetzen: nur wenn eingeschaltet UND das Budget frei ist – sonst liefe es sofort
    // wieder in den Auto-Stopp. Andernfalls nur der Hinweis, „weiter" wartet auf den Nutzer.
    usageDaten = resetWennNeuerTag(usageDaten, heutigesDatum());
    const prov = providerFor(geladeneSession.model);
    const budgetFrei = !settings.autoStopp || !ueberBudget(usageDaten, prov);
    if (settings.autoWeiter && budgetFrei) {
      console.log(chalk.gray('      ⏵ Auto-Fortsetzen ist an – ich mache automatisch weiter…'));
      await sessionFortsetzen(rl, messages, readLine, geladeneSession);
    } else if (settings.autoWeiter && !budgetFrei) {
      console.log(chalk.gray('      (Auto-Fortsetzen an, aber Budget noch erschöpft – „weiter", sobald frei.)'));
    } else {
      console.log(chalk.gray(`      Tippe „weiter", um dort fortzusetzen (Modell: ${geladeneSession.model}).`));
    }
  }

  // Initial-Auftrag aus Datei (Launcher): sofort und ohne manuelle Eingabe ausführen. Danach
  // fällt die Sitzung in die normale Schleife – der Mensch kann beaufsichtigen und fortsetzen.
  if (PROMPT_FILE) {
    try {
      const abs = path.resolve(process.cwd(), expandHome(PROMPT_FILE));
      const auftrag = (await fs.readFile(abs, 'utf-8')).trim();
      if (auftrag) {
        console.log(chalk.hex(ORANGE)(`\n  ▶ Initial-Auftrag aus ${shortPath(abs)} – ich beginne automatisch…`));
        messages.push({ role: 'user', content: auftrag });
        // §F.1 – Selbst-Meldung ans Board: Sobald der Launcher-Auftrag startet, springt
        // die übernommene Karte von „offen" auf „in Arbeit". Best-Effort, blockiert nie.
        if (boardAktiv()) {
          const r = await meldeArbeitBegonnen();
          if (r.gemeldet > 0) console.log(chalk.gray(`  ↪ Board: ${r.gemeldet} Feature(s) auf „in Arbeit" gemeldet.`));
          else if (r.fehler) console.log(chalk.gray(`  ↪ Board-Meldung übersprungen (${r.fehler}).`));
        }
        try {
          const status = await runAgentTurn(rl, messages, readLine);
          if (status === 'budget') { speichereSession(messages, aktuellesLabel(messages)); sessionGehoertAktuell = true; }
          else if (status === 'fertig') await meldeAbschlussFallsBoard();
        } catch (error: any) {
          console.log(chalk.red(`\n❌ ${error.response?.data?.error?.message || error.message}`));
          repairHistory(messages);
          if (sessionGehoertAktuell) speichereSession(messages, aktuellesLabel(messages));
        }
        trimHistory(messages);
      } else {
        console.log(chalk.yellow(`\n  ⚠️  Initial-Auftrag ${shortPath(abs)} ist leer – übersprungen.`));
      }
    } catch {
      console.log(chalk.red(`\n  ❌ Initial-Auftrag nicht lesbar: ${PROMPT_FILE}`));
    }
  }

  try {
    while (true) {
      // Arbeitsplan, Kurzhinweis, dann orangene Linie ÜBER der Eingabe. Der Plan
      // steht damit immer direkt vor dem nächsten Prompt – man sieht beim Tippen,
      // was noch offen ist.
      if (interaktiv) {
        zeigePlan();
        console.log(`\n${fusszeile()}\n${linie()}`);
      }

      // Nach EOF (gepipte Eingabe) ist rl geschlossen – prompt()/resume() würden
      // dann werfen. Gepufferte Zeilen sollen aber noch abgearbeitet werden.
      if (!closed) rl.prompt();
      const input = (await readLine()).trim();

      if (interaktiv) console.log(linie());

      if (!input) continue;

      // /resume wird HIER (vor behandleSlashBefehl) behandelt, weil das manuelle Fortsetzen
      // rl/messages/readLine braucht – anders als ein normaler Slash-Befehl.
      const low = input.toLowerCase();
      if (low === '/resume' || low.startsWith('/resume ')) {
        const rest = input.slice(7).trim().toLowerCase();
        if (rest.startsWith('auto')) {
          const v = rest.slice(4).trim();
          const on = ['on', 'an'].includes(v), off = ['off', 'aus'].includes(v);
          if (!on && !off) { console.log(chalk.red('  Nutze: /resume auto on|off')); }
          else {
            settings.autoWeiter = on;
            usageDaten.autoWeiter = on;
            speichereUsage();
            console.log(chalk.green(`  ✔ Auto-Fortsetzen beim Start: ${on ? 'an' : 'aus'}`));
          }
        } else if (rest === '') {
          if (geladeneSession) await sessionFortsetzen(rl, messages, readLine, geladeneSession);
          else console.log(chalk.gray('  Keine unterbrochene Aufgabe vorhanden.'));
        } else {
          console.log(chalk.gray('  „/resume" setzt jetzt fort · „/resume auto on|off" schaltet den Auto-Start.'));
        }
        continue;
      }

      if (await behandleSlashBefehl(input, readLine, messages)) {
        if (input.trim().toLowerCase().startsWith('/exit')) {
          console.log(chalk.yellow('\n  👋 Auf Wiedersehen!'));
          break;
        }
        continue;
      }

      // Alte Schreibweisen bleiben gültig, damit Skripte und Gewohnheit funktionieren.
      if (['exit', 'quit', 'q'].includes(input.toLowerCase())) {
        console.log(chalk.yellow('\n  👋 Auf Wiedersehen!'));
        break;
      }
      if (input.toLowerCase() === 'rechte') {
        console.log(chalk.gray('  Hinweis: "rechte" heisst jetzt "/rights".'));
        await askPermissions(readLine, true);
        continue;
      }

      // „weiter"/„continue working": eine per Auto-Stopp unterbrochene Aufgabe fortsetzen.
      // Nur wenn wirklich eine geladene Session vorliegt – sonst ist „weiter" ein normaler Prompt.
      if (geladeneSession && /^(weiter|weitermachen|weiterarbeiten|continue|continue working)$/i.test(input)) {
        await sessionFortsetzen(rl, messages, readLine, geladeneSession);
        continue;
      }

      messages.push({ role: 'user', content: input });

      try {
        const status = await runAgentTurn(rl, messages, readLine);
        if (status === 'budget') {
          // Diese Konversation wurde unterbrochen → sichern; sie besitzt nun den Slot.
          speichereSession(messages, aktuellesLabel(messages));
          sessionGehoertAktuell = true;
        } else if (sessionGehoertAktuell) {
          // Erledigt UND es war unsere gesicherte Aufgabe → Datei verwerfen.
          loescheSession();
          sessionGehoertAktuell = false;
        }
        // Sonst (erledigt, aber Datei gehört einer fremden, noch nicht fortgesetzten Session):
        // die gespeicherte Session bleibt unangetastet (Bug 2).
      } catch (error: any) {
        console.log(chalk.red(`\n❌ ${error.response?.data?.error?.message || error.message}`));
        // Ohne diese Reparatur bleibt die History nach einem Fehler dauerhaft
        // ungültig und jede weitere Frage der Session scheitert erneut.
        repairHistory(messages);
        if (sessionGehoertAktuell) speichereSession(messages, aktuellesLabel(messages));
      }

      trimHistory(messages);
    }
  } finally {
    rl.close();
  }
}

// ============================================
// CLI-Befehl
// ============================================
const program = new Command();
program
  .name('leaven')
  .description('CLI-Agent für DeepSeek, Claude (Opus/Fable) und Qwen mit Loop Breaker')
  .version('1.0.0');

program
  .command('chat', { isDefault: true })
  .option('-y, --yes', 'Tool-Aufrufe ohne Rückfrage ausführen (nicht-interaktiv)')
  .option('--model <name>', 'Modell überschreiben (Standard: deepseek-v4-pro)')
  .option('--no-thinking', 'Thinking-Modus abschalten (schneller, günstiger)')
  .option('--effort <stufe>', 'reasoning_effort: high oder max', 'high')
  .option('--read-root <pfad>', 'Lesebereich festlegen (überspringt die Startfrage)')
  .option('--write-root <pfad>', 'Schreibbereich festlegen (überspringt die Startfrage)')
  .option('--verbose', 'Anzeige: Gedankenstrom UND Zwischenschritte an (zur Laufzeit: /output)')
  .option('--quiet', 'Anzeige: beides aus – nur Endergebnis und Abschlussbericht')
  .option('--allow-secrets', 'Sperre für .env, Schlüssel und Zugangsdaten aufheben')
  .option('--prompt-file <pfad>', 'Initial-Auftrag aus Datei beim Start sofort ausführen (nicht-interaktiv, für den Launcher)')
  .action(startChat);

program.parse();
