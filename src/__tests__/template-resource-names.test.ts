// Ensures every resource/data-source name used in OTTO's own HCL templates
// exists in the current provider schema. Prevents hallucinated resource names
// from shipping in generated code (e.g. okta_app_group_push_now).
import * as fs from 'fs';
import * as path from 'path';
import { isKnownResource } from '../shared/schema-loader';
import { DEFAULT_VERSION } from '../shared/versions';

const TEMPLATE_FILES = [
  'src/renderer/components/ProviderBlock.tsx',
  'src/renderer/components/BestPractices.tsx',
  'src/shared/versions.ts',
  'src/main/api/claude.ts',
];

function extractOktaResourceNames(content: string): string[] {
  const pattern = /(?:resource|data)\s+"(okta_[a-z_]+)"/g;
  const names: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(content)) !== null) {
    names.push(m[1]);
  }
  return [...new Set(names)];
}

const root = path.resolve(__dirname, '../..');

describe('HCL template resource name accuracy', () => {
  for (const relPath of TEMPLATE_FILES) {
    const content = fs.readFileSync(path.join(root, relPath), 'utf8');
    const names = extractOktaResourceNames(content);

    describe(path.basename(relPath), () => {
      for (const name of names) {
        test(`${name} is in ${DEFAULT_VERSION} schema`, () => {
          expect(isKnownResource(DEFAULT_VERSION, name)).toBe(true);
        });
      }
    });
  }
});
