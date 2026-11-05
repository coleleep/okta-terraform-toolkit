// Runs scripts/update-schema-loader.js against a temp copy of the repo layout
// and checks that a new schema version gets an entry in every
// Record<ProviderVersion, ...> in versions.ts. A missing entry is a compile
// error, which broke main on the v7.1.0 auto-merge.
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';

const root = path.resolve(__dirname, '../..');

describe('update-schema-loader.js', () => {
  it('adds the new version to every Record<ProviderVersion, ...> in versions.ts', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'otto-loader-'));
    try {
      fs.mkdirSync(path.join(tmp, 'scripts'));
      fs.mkdirSync(path.join(tmp, 'src/shared/provider-schemas'), { recursive: true });
      fs.copyFileSync(path.join(root, 'scripts/update-schema-loader.js'), path.join(tmp, 'scripts/update-schema-loader.js'));
      fs.copyFileSync(path.join(root, 'src/shared/versions.ts'), path.join(tmp, 'src/shared/versions.ts'));
      for (const f of fs.readdirSync(path.join(root, 'src/shared/provider-schemas'))) {
        if (f.endsWith('.json')) fs.writeFileSync(path.join(tmp, 'src/shared/provider-schemas', f), '{}');
      }
      fs.writeFileSync(path.join(tmp, 'src/shared/provider-schemas/99.0.0.json'), '{}');

      execFileSync('node', [path.join(tmp, 'scripts/update-schema-loader.js')], { stdio: 'pipe' });

      const out = fs.readFileSync(path.join(tmp, 'src/shared/versions.ts'), 'utf8');
      const records = [...out.matchAll(/export const (\w+): Record<ProviderVersion,[\s\S]*?\n};/g)];
      expect(records.length).toBeGreaterThanOrEqual(3);
      for (const [block, name] of records) {
        expect({ name, has: block.includes("'99.0.0': []") }).toEqual({ name, has: true });
      }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
