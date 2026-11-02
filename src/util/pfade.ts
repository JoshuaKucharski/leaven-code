import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

export function expandHome(inputPath: string): string {
  if (inputPath === '~') return os.homedir();
  if (inputPath.startsWith('~/')) return path.join(os.homedir(), inputPath.slice(2));
  return inputPath;
}

/**
 * Löst Symlinks so weit auf, wie der Pfad bereits existiert, und hängt den noch
 * nicht existierenden Rest wieder an. Nötig, weil path.resolve() Symlinks NICHT
 * auflöst – ein Link innerhalb des erlaubten Bereichs würde sonst nach draussen
 * zeigen und die Prüfung unterlaufen.
 */
export async function realpathSoFar(target: string): Promise<string> {
  let existing = target;
  const missing: string[] = [];

  for (;;) {
    try {
      const real = await fs.realpath(existing);
      return missing.length > 0 ? path.join(real, ...missing.reverse()) : real;
    } catch {
      const parent = path.dirname(existing);
      if (parent === existing) return target;   // nichts davon existiert
      missing.push(path.basename(existing));
      existing = parent;
    }
  }
}

export async function isDirectory(candidate: string): Promise<boolean> {
  try {
    return (await fs.stat(candidate)).isDirectory();
  } catch {
    return false;
  }
}

export async function subdirectories(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries
      .filter(e => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules')
      .map(e => e.name)
      .sort();
  } catch {
    return [];
  }
}
