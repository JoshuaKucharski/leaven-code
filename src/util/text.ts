import chalk from 'chalk';
import * as os from 'os';

const MAX_TOOL_RESULT_CHARS = 8000;

export function truncate(text: string, limit = MAX_TOOL_RESULT_CHARS): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n… [gekürzt, ${text.length - limit} Zeichen ausgelassen]`;
}

export function parseArgs(raw: any): any {
  if (typeof raw === 'string') {
    try { return JSON.parse(raw); } catch { return {}; }
  }
  return raw || {};
}

/**
 * Liest einen Zeilenbereich wie `sed -n 'START,ENDp'`: 1-basiert, beide Grenzen
 * inklusive. Zeilen sind durch \n getrennt; eine letzte Zeile ohne abschliessendes
 * \n zählt mit. Über das Dateiende hinaus wird abgeschnitten; liegt START dahinter,
 * kommt Leerstring zurück. end === Number.POSITIVE_INFINITY = bis Dateiende ($).
 * Die Ausgabe ist identisch mit der von sed: jede ausgewählte Zeile plus \n.
 */
export function liesZeilenBereich(content: string, start: number, end: number): string {
  const zeilen = content.split('\n');
  if (zeilen.length > 0 && zeilen[zeilen.length - 1] === '') zeilen.pop();
  const von = Math.max(1, start);
  const bis = Number.isFinite(end) ? end : zeilen.length;
  if (von > zeilen.length || bis < von) return '';
  return zeilen.slice(von - 1, bis).map(z => z + '\n').join('');
}

export function shortPath(fullPath: string): string {
  const home = os.homedir();
  return fullPath.startsWith(home) ? `~${fullPath.slice(home.length)}` : fullPath;
}

export function maskiere(key: string): string {
  if (!key) return '(nicht gesetzt)';
  return key.length <= 10 ? '***' : `${key.slice(0, 6)}…${key.slice(-4)}`;
}

export function formatAssistantMessage(content: string): void {
  if (!content || !content.trim()) return;
  const sentences = content.match(/[^.!?]+[.!?]+/g) || [content];
  const lastSentence = sentences[sentences.length - 1]?.trim() || '';
  const isQuestion = lastSentence.includes('?') && sentences.length > 1;

  if (isQuestion) {
    const explanation = sentences.slice(0, -1).join(' ').trim();
    if (explanation) console.log(chalk.gray(explanation));
    console.log(chalk.bold(`● ${lastSentence}`));
  } else {
    console.log(chalk.bold(content));
  }
}

export function summarizeArgs(raw: any): string {
  const args = parseArgs(raw);
  const parts = Object.entries(args).map(([key, value]) => {
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    const short = text.length > 40 ? `${text.slice(0, 40)}…` : text;
    return `${key}: ${short.replace(/\n/g, '⏎')}`;
  });
  return parts.join(', ');
}
