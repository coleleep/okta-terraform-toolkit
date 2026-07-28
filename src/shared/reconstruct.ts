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
