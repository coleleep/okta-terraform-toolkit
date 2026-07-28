import type { Finding } from './types';

export function reconstructFiles(
  maskedFiles: Record<string, string>,
  findings: Finding[],
  acceptedIds: Set<string>,
): Record<string, string> {
  const result = { ...maskedFiles };
  for (const finding of findings) {
    if (!acceptedIds.has(finding.id)) continue;
    if (result[finding.file] === undefined) continue;
    result[finding.file] = result[finding.file].replace(
      finding.originalSnippet,
      finding.fixedSnippet,
    );
  }
  return result;
}

export type DiffLine =
  | { type: 'context'; text: string; lineNo: number }
  | { type: 'removed'; text: string; lineNo: number }
  | { type: 'added'; text: string }
  | { type: 'collapsed'; count: number };

export function computeDiffLines(
  fileContent: string,
  findings: Finding[],
  acceptedIds: Set<string>,
): DiffLine[] {
  // Locate each finding's originalSnippet in the file
  const regions: Array<{ finding: Finding; start: number; end: number }> = [];
  for (const f of findings) {
    const idx = fileContent.indexOf(f.originalSnippet);
    if (idx !== -1) regions.push({ finding: f, start: idx, end: idx + f.originalSnippet.length });
  }
  regions.sort((a, b) => a.start - b.start);

  const result: DiffLine[] = [];
  let cursor = 0;

  for (const { finding, start, end } of regions) {
    if (cursor < start) {
      pushContext(result, fileContent.slice(cursor, start), lineNoAt(fileContent, cursor));
    }
    const lineNo = lineNoAt(fileContent, start);
    if (acceptedIds.has(finding.id)) {
      splitLines(finding.originalSnippet).forEach((text, i) =>
        result.push({ type: 'removed', text, lineNo: lineNo + i }),
      );
      splitLines(finding.fixedSnippet).forEach(text =>
        result.push({ type: 'added', text }),
      );
    } else {
      splitLines(finding.originalSnippet).forEach((text, i) =>
        result.push({ type: 'context', text, lineNo: lineNo + i }),
      );
    }
    cursor = end;
  }

  if (cursor < fileContent.length) {
    pushContext(result, fileContent.slice(cursor), lineNoAt(fileContent, cursor));
  }

  return result;
}

// Returns 1-based line number of the character at pos in content.
function lineNoAt(content: string, pos: number): number {
  return (content.slice(0, pos).match(/\n/g) ?? []).length + 1;
}

// Splits text into lines, dropping a trailing empty string produced by a
// trailing newline (e.g. "a\nb\n".split('\n') → ["a","b",""]).
function splitLines(text: string): string[] {
  const lines = text.split('\n');
  if (lines.at(-1) === '') lines.pop();
  return lines;
}

// Pushes a context segment, collapsing any run longer than 5 lines to
// keep the diff readable. Shows first 2 and last 2 lines around the collapse.
function pushContext(result: DiffLine[], text: string, startLineNo: number): void {
  const lines = splitLines(text);
  if (lines.length <= 5) {
    lines.forEach((t, i) => result.push({ type: 'context', text: t, lineNo: startLineNo + i }));
    return;
  }
  // Show first 2
  result.push({ type: 'context', text: lines[0], lineNo: startLineNo });
  result.push({ type: 'context', text: lines[1], lineNo: startLineNo + 1 });
  // Collapse middle
  const collapsedCount = lines.length - 4;
  result.push({ type: 'collapsed', count: collapsedCount });
  // Show last 2
  const lastStart = startLineNo + lines.length - 2;
  result.push({ type: 'context', text: lines[lines.length - 2], lineNo: lastStart });
  result.push({ type: 'context', text: lines[lines.length - 1], lineNo: lastStart + 1 });
}
