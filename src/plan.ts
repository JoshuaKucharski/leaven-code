import chalk from 'chalk';
import { zustand, PlanSchritt } from './state.js';

/**
 * Ein Schritt zählt als abgeschlossen, wenn er erledigt ist ODER sich erübrigt hat.
 * Ohne den zweiten Fall bleibt der Balken hängen, sobald sich unterwegs herausstellt,
 * dass etwas gar nicht nötig war.
 */
export const istAbgeschlossen = (s: PlanSchritt) => s.status === 'erledigt' || s.status === 'entfaellt';

export function planBalken(): string {
  const gesamt = zustand.plan.length;
  if (gesamt === 0) return '';
  const fertig = zustand.plan.filter(istAbgeschlossen).length;

  // Höchstens 24 Segmente, damit der Balken auch bei vielen Schritten passt.
  const segmente = Math.min(gesamt, 24);
  const gefuellt = Math.round((fertig / gesamt) * segmente);

  const balken = chalk.green('▰'.repeat(gefuellt)) + chalk.white('▱'.repeat(segmente - gefuellt));
  const wort = gesamt === 1 ? 'Schritt' : 'Schritten';
  return `${balken}  ${chalk.bold(`${fertig}/${gesamt}`)} ${chalk.gray(wort)}`;
}

export function planListe(): string[] {
  const breite = Math.max(20, (process.stdout.columns || 80) - 8);
  const clip = (t: string) => (t.length > breite ? `${t.slice(0, breite - 1)}…` : t);

  return zustand.plan.map(s => {
    switch (s.status) {
      case 'erledigt':  return `  ${chalk.green('✓')} ${chalk.gray(clip(s.titel))}`;
      case 'entfaellt': return chalk.gray(`  ⊘ ${clip(s.titel)} (entfällt)`);
      case 'laeuft':    return `  ${chalk.yellow('▸')} ${chalk.bold(clip(s.titel))}`;
      default:          return chalk.gray(`    ${clip(s.titel)}`);
    }
  });
}

export function zeigePlan(mitListe = true): void {
  if (zustand.plan.length === 0) return;
  console.log(`\n${planBalken()}`);
  if (mitListe) planListe().forEach(z => console.log(z));
}
