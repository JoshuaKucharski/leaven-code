/**
 * Fallback-Parser für DeepSeeks XML-artige Tool-Calls.
 *
 * Bei korrekt konfiguriertem Function-Calling liefert die API `tool_calls` als JSON –
 * dieser Pfad greift dann nie. Er bleibt als Netz für den Fall, dass das Modell sein
 * internes Format in den Text durchreicht.
 *
 * Beispiel:
 * <｜｜DSML｜｜tool_calls>
 *   <｜｜DSML｜｜invoke name="read_file">
 *     <｜｜DSML｜｜parameter name="path">/path/to/file</｜｜DSML｜｜parameter>
 *   </｜｜DSML｜｜invoke>
 * </｜｜DSML｜｜tool_calls>
 */

const TOOL_CALLS_BLOCK = /<｜｜DSML｜｜tool_calls>([\s\S]*?)<\/｜｜DSML｜｜tool_calls>/g;

// Attribute nach dem Namen werden bewusst tolerant behandelt ([^>]*): Frühere
// Versionen verlangten strikt string="true". Fehlte das Attribut, wurden die
// Parameter still verworfen und das Tool mit leeren Argumenten aufgerufen.
const INVOKE_BLOCK = /<｜｜DSML｜｜invoke\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/｜｜DSML｜｜invoke>/g;
const PARAMETER_BLOCK = /<｜｜DSML｜｜parameter\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/｜｜DSML｜｜parameter>/g;

let counter = 0;

export function parseDeepSeekToolCalls(text: string): any[] | null {
  if (!text) return null;

  const toolCalls: any[] = [];
  TOOL_CALLS_BLOCK.lastIndex = 0;

  let blockMatch: RegExpExecArray | null;
  while ((blockMatch = TOOL_CALLS_BLOCK.exec(text)) !== null) {
    const blockContent = blockMatch[1];
    INVOKE_BLOCK.lastIndex = 0;

    let invokeMatch: RegExpExecArray | null;
    while ((invokeMatch = INVOKE_BLOCK.exec(blockContent)) !== null) {
      const name = invokeMatch[1];
      const paramsContent = invokeMatch[2];
      const args: Record<string, string> = {};

      PARAMETER_BLOCK.lastIndex = 0;
      let paramMatch: RegExpExecArray | null;
      while ((paramMatch = PARAMETER_BLOCK.exec(paramsContent)) !== null) {
        args[paramMatch[1]] = paramMatch[2].trim();
      }

      toolCalls.push({
        id: `call_${Date.now()}_${counter++}`,
        type: 'function',
        function: {
          name,
          arguments: JSON.stringify(args)
        }
      });
    }
  }

  return toolCalls.length > 0 ? toolCalls : null;
}

/** Entfernt alle DSML-Blöcke aus dem Text, damit sie nicht im Chat auftauchen. */
export function stripDeepSeekToolCalls(text: string): string {
  if (!text) return text;
  return text.replace(TOOL_CALLS_BLOCK, '').trim();
}
