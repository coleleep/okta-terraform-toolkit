# Schema Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the static `RESOURCE_DICTIONARY` name list in the validator with versioned provider schema snapshots, auto-updated by GitHub Actions on every new Okta TF provider release.

**Architecture:** A Node.js extractor script (`scripts/extract-schema.js`) runs `terraform providers schema -json` for a given version and writes a slimmed JSON snapshot. A generator script (`scripts/update-schema-loader.js`) rebuilds `src/shared/schema-loader.ts` from all snapshots. The validator's `buildResourceNameContext()` is replaced by `buildSchemaContext()` which injects per-resource attribute schemas for only the resources present in the uploaded files. GitHub Actions detects new provider releases daily and auto-merges schema PRs when CI passes.

**Tech Stack:** TypeScript, Node.js (scripts as `.js`), Terraform CLI (CI only), GitHub Actions, webpack 5 (JSON imports handled natively), Jest + ts-jest.

---

## File Map

| Action | File | Purpose |
|---|---|---|
| Create | `scripts/extract-schema.js` | Runs terraform to extract + slim one version's schema |
| Create | `scripts/update-schema-loader.js` | Regenerates `schema-loader.ts` from all JSON snapshots |
| Create | `scripts/validate-schema.js` | CI gate: validates JSON structure before auto-merge |
| Create | `src/shared/provider-schemas/schema-types.ts` | TypeScript interfaces for schema JSON |
| Create | `src/shared/provider-schemas/6.6.1.json` … `6.13.0.json` | Generated schema snapshots (8 files) |
| Create | `src/shared/schema-loader.ts` | Auto-generated import map + `loadSchema`, `isKnownResource`, `getResourceSchema` |
| Create | `src/__tests__/schema-loader.test.ts` | Unit tests for schema loader |
| Create | `.github/workflows/bootstrap-schemas.yml` | One-time manual workflow to generate all 8 snapshots |
| Create | `.github/workflows/provider-schema-sync.yml` | Daily auto-sync workflow |
| Modify | `src/main/api/validator.ts` | Add `buildSchemaContext`, update `analyzeProject` signature, remove `buildResourceNameContext` |
| Modify | `src/main/ipc-handlers.ts` | Pass `providerManager.getSelectedVersion()` to `analyzeProject` |
| Modify | `src/__tests__/validator.test.ts` | Add `buildSchemaContext` unit tests |

---

## Task 1: Schema type definitions

**Files:**
- Create: `src/shared/provider-schemas/schema-types.ts`

- [ ] **Step 1: Create the TypeScript interfaces**

Create `src/shared/provider-schemas/schema-types.ts`:

```ts
export interface AttributeSchema {
  type: string | unknown[];
  description?: string;
  required?: boolean;
  optional?: boolean;
  computed?: boolean;
  deprecated?: boolean;
}

export interface BlockTypeSchema {
  nesting_mode: 'single' | 'list' | 'set' | 'map';
  min_items?: number;
  max_items?: number;
  attributes?: Record<string, AttributeSchema>;
  block_types?: Record<string, BlockTypeSchema>;
}

export interface ResourceSchema {
  attributes?: Record<string, AttributeSchema>;
  block_types?: Record<string, BlockTypeSchema>;
}

export interface ProviderSchema {
  resource_schemas: Record<string, ResourceSchema>;
  data_source_schemas: Record<string, ResourceSchema>;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors (new file, no consumers yet).

- [ ] **Step 3: Commit**

```bash
git add src/shared/provider-schemas/schema-types.ts
git commit -m "feat(schema): add TypeScript types for provider schema snapshots"
```

---

## Task 2: Schema loader skeleton + failing tests (TDD)

**Files:**
- Create: `src/__tests__/schema-loader.test.ts`
- Create: `src/shared/schema-loader.ts` (skeleton — no JSON imports yet)

- [ ] **Step 1: Write failing tests**

Create `src/__tests__/schema-loader.test.ts`:

```ts
import { loadSchema, isKnownResource, getResourceSchema } from '../shared/schema-loader';

describe('loadSchema', () => {
  it('loads v6.13.0 and returns resource_schemas', () => {
    const schema = loadSchema('6.13.0');
    expect(schema.resource_schemas).toBeDefined();
    expect(schema.data_source_schemas).toBeDefined();
  });

  it('contains okta_app_oauth in v6.13.0', () => {
    const schema = loadSchema('6.13.0');
    expect(schema.resource_schemas['okta_app_oauth']).toBeDefined();
  });

  it('throws for an unknown version', () => {
    expect(() => loadSchema('0.0.0')).toThrow('No schema snapshot for provider version 0.0.0');
  });
});

describe('isKnownResource', () => {
  it('returns true for okta_app_signon_policy_rules — the false-positive that triggered this feature', () => {
    expect(isKnownResource('6.13.0', 'okta_app_signon_policy_rules')).toBe(true);
  });

  it('returns true for okta_app_signon_policy_rule (singular)', () => {
    expect(isKnownResource('6.13.0', 'okta_app_signon_policy_rule')).toBe(true);
  });

  it('returns false for invented resource names', () => {
    expect(isKnownResource('6.13.0', 'okta_not_a_real_resource')).toBe(false);
  });

  it('returns true for known data sources', () => {
    expect(isKnownResource('6.13.0', 'okta_app')).toBe(true);
  });
});

describe('getResourceSchema', () => {
  it('returns schema for okta_app_oauth with attributes', () => {
    const schema = getResourceSchema('6.13.0', 'okta_app_oauth');
    expect(schema).not.toBeNull();
    expect(schema!.attributes).toBeDefined();
    expect(schema!.attributes!['label']).toBeDefined();
  });

  it('returns null for unknown resource', () => {
    expect(getResourceSchema('6.13.0', 'okta_not_real')).toBeNull();
  });
});
```

- [ ] **Step 2: Create loader skeleton**

Create `src/shared/schema-loader.ts`:

```ts
// AUTO-GENERATED by scripts/update-schema-loader.js — do not edit manually.
// Run: node scripts/update-schema-loader.js
import type { ProviderSchema, ResourceSchema } from './provider-schemas/schema-types';

const SCHEMAS: Record<string, ProviderSchema> = {
  // versions added here by update-schema-loader.js
};

export function loadSchema(version: string): ProviderSchema {
  const schema = SCHEMAS[version];
  if (!schema) throw new Error(`No schema snapshot for provider version ${version}`);
  return schema;
}

export function getResourceSchema(version: string, resourceType: string): ResourceSchema | null {
  const schema = loadSchema(version);
  return (schema.resource_schemas[resourceType] ?? schema.data_source_schemas[resourceType]) ?? null;
}

export function isKnownResource(version: string, resourceType: string): boolean {
  const schema = loadSchema(version);
  return resourceType in schema.resource_schemas || resourceType in schema.data_source_schemas;
}
```

- [ ] **Step 3: Run tests — confirm they fail**

```bash
npx jest schema-loader.test.ts
```

Expected: FAIL — `loadSchema('6.13.0')` throws "No schema snapshot for provider version 6.13.0" (SCHEMAS map is empty).

- [ ] **Step 4: Commit skeleton + failing tests**

```bash
git add src/shared/schema-loader.ts src/__tests__/schema-loader.test.ts
git commit -m "feat(schema): add schema-loader skeleton and failing tests"
```

---

## Task 3: Schema extractor script

**Files:**
- Create: `scripts/extract-schema.js`

- [ ] **Step 1: Create the scripts directory and extractor**

```bash
mkdir scripts
```

Create `scripts/extract-schema.js`:

```js
#!/usr/bin/env node
'use strict';

const { execSync } = require('child_process');
const { mkdtempSync, writeFileSync, rmSync, existsSync } = require('fs');
const { join } = require('path');
const { tmpdir } = require('os');

const version = process.argv[2];
if (!version) {
  console.error('Usage: node scripts/extract-schema.js <version>');
  console.error('Example: node scripts/extract-schema.js 6.13.0');
  process.exit(1);
}

const outPath = join(__dirname, '..', 'src', 'shared', 'provider-schemas', `${version}.json`);

const tmpDir = mkdtempSync(join(tmpdir(), 'otto-schema-'));
console.log(`Working in temp dir: ${tmpDir}`);

try {
  // Write minimal provider config
  writeFileSync(join(tmpDir, 'main.tf'), [
    'terraform {',
    '  required_providers {',
    '    okta = {',
    `      source  = "okta/okta"`,
    `      version = "= ${version}"`,
    '    }',
    '  }',
    '}',
  ].join('\n'));

  // terraform init
  console.log(`Initializing Okta provider v${version}...`);
  execSync('terraform init -no-color -backend=false', {
    cwd: tmpDir,
    stdio: 'inherit',
  });

  // Extract schema
  console.log('Extracting schema...');
  const raw = execSync('terraform providers schema -json', { cwd: tmpDir }).toString();
  const full = JSON.parse(raw);

  const okta = full.provider_schemas?.['registry.terraform.io/okta/okta'];
  if (!okta) throw new Error('Okta provider block not found in schema output');

  const slimmed = {
    resource_schemas: slimResourceMap(okta.resource_schemas ?? {}),
    data_source_schemas: slimResourceMap(okta.data_source_schemas ?? {}),
  };

  writeFileSync(outPath, JSON.stringify(slimmed, null, 2));
  const resourceCount = Object.keys(slimmed.resource_schemas).length;
  const dataCount = Object.keys(slimmed.data_source_schemas).length;
  console.log(`✓ Written to ${outPath} (${resourceCount} resources, ${dataCount} data sources)`);

} finally {
  rmSync(tmpDir, { recursive: true, force: true });
}

function slimResourceMap(resources) {
  const result = {};
  for (const [name, resource] of Object.entries(resources)) {
    result[name] = slimBlock(resource.block ?? {});
  }
  return result;
}

function slimBlock(block) {
  const result = {};

  if (block.attributes && Object.keys(block.attributes).length > 0) {
    result.attributes = {};
    for (const [name, attr] of Object.entries(block.attributes)) {
      const slim = { type: attr.type };
      if (attr.description) slim.description = attr.description;
      if (attr.required) slim.required = true;
      if (attr.optional) slim.optional = true;
      // only include computed flag when it's the only modifier (purely server-assigned)
      if (attr.computed && !attr.optional && !attr.required) slim.computed = true;
      if (attr.deprecated) slim.deprecated = true;
      result.attributes[name] = slim;
    }
  }

  if (block.block_types && Object.keys(block.block_types).length > 0) {
    result.block_types = {};
    for (const [name, bt] of Object.entries(block.block_types)) {
      const slim = { nesting_mode: bt.nesting_mode };
      if (bt.min_items) slim.min_items = bt.min_items;
      if (bt.max_items) slim.max_items = bt.max_items;
      Object.assign(slim, slimBlock(bt.block ?? {}));
      result.block_types[name] = slim;
    }
  }

  return result;
}
```

- [ ] **Step 2: Verify Terraform is available**

```bash
terraform version
```

Expected: shows Terraform version (e.g., `Terraform v1.9.x`). If not installed, install via `brew install terraform` or download from https://developer.hashicorp.com/terraform/downloads.

- [ ] **Step 3: Run extractor for 6.13.0**

```bash
node scripts/extract-schema.js 6.13.0
```

Expected output:
```
Working in temp dir: /tmp/otto-schema-XXXXX
Initializing Okta provider v6.13.0...
...Terraform has been successfully initialized...
Extracting schema...
✓ Written to .../src/shared/provider-schemas/6.13.0.json (NNN resources, NN data sources)
```

Expected: a new file `src/shared/provider-schemas/6.13.0.json` exists with `resource_schemas` and `data_source_schemas` keys.

- [ ] **Step 4: Spot-check the output**

```bash
node -e "
const s = require('./src/shared/provider-schemas/6.13.0.json');
console.log('Resources:', Object.keys(s.resource_schemas).length);
console.log('Has okta_app_oauth:', 'okta_app_oauth' in s.resource_schemas);
console.log('Has okta_app_signon_policy_rules:', 'okta_app_signon_policy_rules' in s.resource_schemas);
console.log('okta_app_oauth.attributes.label:', s.resource_schemas.okta_app_oauth.attributes?.label);
"
```

Expected: `Has okta_app_signon_policy_rules: true`, `label` shows `{ type: 'string', description: '...', required: true }`.

- [ ] **Step 5: Commit extractor + first snapshot**

```bash
git add scripts/extract-schema.js src/shared/provider-schemas/6.13.0.json
git commit -m "feat(schema): add extractor script and 6.13.0 snapshot"
```

---

## Task 4: Schema loader generator + tests passing

**Files:**
- Create: `scripts/update-schema-loader.js`
- Modify: `src/shared/schema-loader.ts` (regenerated)

- [ ] **Step 1: Create the loader generator script**

Create `scripts/update-schema-loader.js`:

```js
#!/usr/bin/env node
'use strict';

const { readdirSync, writeFileSync, readFileSync } = require('fs');
const { join } = require('path');

const schemasDir = join(__dirname, '..', 'src', 'shared', 'provider-schemas');
const loaderPath = join(__dirname, '..', 'src', 'shared', 'schema-loader.ts');
const versionsPath = join(__dirname, '..', 'src', 'shared', 'versions.ts');

// Find all version JSON files, sorted ascending
const versions = readdirSync(schemasDir)
  .filter(f => f.endsWith('.json'))
  .map(f => f.replace('.json', ''))
  .sort((a, b) => {
    const [aMaj, aMin, aPat] = a.split('.').map(Number);
    const [bMaj, bMin, bPat] = b.split('.').map(Number);
    return aMaj - bMaj || aMin - bMin || aPat - bPat;
  });

if (versions.length === 0) {
  console.error('No schema JSON files found in', schemasDir);
  process.exit(1);
}

// Build import lines and SCHEMAS map entries
const importLines = versions.map(v => {
  const varName = 'schema_' + v.replace(/\./g, '_');
  return `import schema_raw_${v.replace(/\./g, '_')} from './provider-schemas/${v}.json';`;
}).join('\n');

const schemaEntries = versions.map(v => {
  const varName = 'schema_raw_' + v.replace(/\./g, '_');
  return `  '${v}': ${varName} as unknown as ProviderSchema,`;
}).join('\n');

// Generate schema-loader.ts
const loaderContent = `// AUTO-GENERATED by scripts/update-schema-loader.js — do not edit manually.
// To regenerate: node scripts/update-schema-loader.js
import type { ProviderSchema, ResourceSchema } from './provider-schemas/schema-types';

${importLines}

const SCHEMAS: Record<string, ProviderSchema> = {
${schemaEntries}
};

export function loadSchema(version: string): ProviderSchema {
  const schema = SCHEMAS[version];
  if (!schema) throw new Error(\`No schema snapshot for provider version \${version}\`);
  return schema;
}

export function getResourceSchema(version: string, resourceType: string): ResourceSchema | null {
  const schema = loadSchema(version);
  return (schema.resource_schemas[resourceType] ?? schema.data_source_schemas[resourceType]) ?? null;
}

export function isKnownResource(version: string, resourceType: string): boolean {
  const schema = loadSchema(version);
  return resourceType in schema.resource_schemas || resourceType in schema.data_source_schemas;
}
`;

writeFileSync(loaderPath, loaderContent);
console.log(`✓ schema-loader.ts updated with ${versions.length} versions: ${versions.join(', ')}`);

// Update SUPPORTED_VERSIONS in versions.ts
let versionsContent = readFileSync(versionsPath, 'utf-8');
const newVersionsLine = `export const SUPPORTED_VERSIONS = [${versions.map(v => `'${v}'`).join(', ')}] as const;`;
versionsContent = versionsContent.replace(
  /export const SUPPORTED_VERSIONS = \[.*?\] as const;/,
  newVersionsLine
);
writeFileSync(versionsPath, versionsContent);
console.log(`✓ SUPPORTED_VERSIONS updated in versions.ts`);
```

- [ ] **Step 2: Run the generator**

```bash
node scripts/update-schema-loader.js
```

Expected output:
```
✓ schema-loader.ts updated with 1 versions: 6.13.0
✓ SUPPORTED_VERSIONS updated in versions.ts
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors. The generated `schema-loader.ts` imports `6.13.0.json` as `unknown as ProviderSchema`.

- [ ] **Step 4: Run the failing tests — now they should partially pass**

```bash
npx jest schema-loader.test.ts
```

Expected: all tests PASS (6.13.0 is now wired in, `okta_app_signon_policy_rules` is in the real schema).

- [ ] **Step 5: Run the full suite to confirm no regressions**

```bash
npx jest
```

Expected: all 135 existing tests + new schema-loader tests pass.

- [ ] **Step 6: Commit**

```bash
git add scripts/update-schema-loader.js src/shared/schema-loader.ts src/shared/versions.ts
git commit -m "feat(schema): add loader generator script, wire in 6.13.0 snapshot"
```

---

## Task 5: Bootstrap all remaining versions

**Files:**
- Create: `src/shared/provider-schemas/6.6.1.json` through `6.12.0.json` (7 files)
- Modify: `src/shared/schema-loader.ts` (regenerated)
- Modify: `src/shared/versions.ts` (regenerated)

- [ ] **Step 1: Run extractor for each remaining version**

```bash
for v in 6.6.1 6.7.0 6.8.0 6.9.0 6.10.0 6.11.0 6.12.0; do
  echo "=== $v ==="
  node scripts/extract-schema.js "$v"
done
```

Expected: 7 JSON files created in `src/shared/provider-schemas/`. Each run downloads the provider plugin, which may take 30-60 seconds per version on first run (plugins cache after first download).

- [ ] **Step 2: Regenerate loader**

```bash
node scripts/update-schema-loader.js
```

Expected:
```
✓ schema-loader.ts updated with 8 versions: 6.6.1, 6.7.0, 6.8.0, 6.9.0, 6.10.0, 6.11.0, 6.12.0, 6.13.0
✓ SUPPORTED_VERSIONS updated in versions.ts
```

- [ ] **Step 3: TypeScript compile + full test suite**

```bash
npx tsc --noEmit && npx jest
```

Expected: clean compile, all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/shared/provider-schemas/ src/shared/schema-loader.ts src/shared/versions.ts
git commit -m "feat(schema): bootstrap snapshots for all 8 supported versions (6.6.1-6.13.0)"
```

---

## Task 6: Schema validation script

**Files:**
- Create: `scripts/validate-schema.js`

- [ ] **Step 1: Create the validation script**

Create `scripts/validate-schema.js`:

```js
#!/usr/bin/env node
'use strict';

const { readFileSync, existsSync } = require('fs');
const { join } = require('path');

const version = process.argv[2];
if (!version) {
  console.error('Usage: node scripts/validate-schema.js <version>');
  process.exit(1);
}

const schemaPath = join(__dirname, '..', 'src', 'shared', 'provider-schemas', `${version}.json`);

if (!existsSync(schemaPath)) {
  console.error(`Schema file not found: ${schemaPath}`);
  process.exit(1);
}

let schema;
try {
  schema = JSON.parse(readFileSync(schemaPath, 'utf-8'));
} catch (e) {
  console.error(`Failed to parse ${schemaPath}: ${e.message}`);
  process.exit(1);
}

const errors = [];

if (!schema.resource_schemas || typeof schema.resource_schemas !== 'object')
  errors.push('Missing or invalid resource_schemas');
if (!schema.data_source_schemas || typeof schema.data_source_schemas !== 'object')
  errors.push('Missing or invalid data_source_schemas');

const appOauth = schema.resource_schemas?.['okta_app_oauth'];
if (!appOauth)
  errors.push('Missing well-known resource okta_app_oauth — extraction likely failed');
if (appOauth && (!appOauth.attributes || typeof appOauth.attributes !== 'object'))
  errors.push('okta_app_oauth.attributes is missing or not an object');

const resourceCount = Object.keys(schema.resource_schemas ?? {}).length;
if (resourceCount < 50)
  errors.push(`Only ${resourceCount} resources found — expected 100+, extraction may be incomplete`);

if (errors.length > 0) {
  console.error(`Schema validation FAILED for v${version}:`);
  errors.forEach(e => console.error(`  ✗ ${e}`));
  process.exit(1);
}

console.log(`✓ Schema v${version} valid: ${resourceCount} resources, ${Object.keys(schema.data_source_schemas ?? {}).length} data sources`);
```

- [ ] **Step 2: Run against 6.13.0 to verify it works**

```bash
node scripts/validate-schema.js 6.13.0
```

Expected: `✓ Schema v6.13.0 valid: NNN resources, NN data sources`

- [ ] **Step 3: Verify it fails correctly on bad input**

```bash
echo '{"bad": "json"}' > /tmp/test-bad-schema.json
node -e "
const { execSync } = require('child_process');
const { writeFileSync } = require('fs');
writeFileSync('src/shared/provider-schemas/0.0.0.json', JSON.stringify({bad: true}));
" && node scripts/validate-schema.js 0.0.0
```

Expected: exits with non-zero, prints validation errors. Then clean up:

```bash
rm -f src/shared/provider-schemas/0.0.0.json
```

- [ ] **Step 4: Commit**

```bash
git add scripts/validate-schema.js
git commit -m "feat(schema): add schema validation script for CI gate"
```

---

## Task 7: GitHub Actions workflows

**Files:**
- Create: `.github/workflows/bootstrap-schemas.yml`
- Create: `.github/workflows/provider-schema-sync.yml`

- [ ] **Step 1: Create the bootstrap workflow**

Create `.github/workflows/bootstrap-schemas.yml`:

```yaml
name: Bootstrap Provider Schemas

on:
  workflow_dispatch:

permissions:
  contents: write
  pull-requests: write

jobs:
  bootstrap:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'

      - uses: hashicorp/setup-terraform@v3
        with:
          terraform_version: '1.9.0'

      - name: Install dependencies
        run: npm ci

      - name: Extract schemas for all supported versions
        run: |
          node -e "
            const { SUPPORTED_VERSIONS } = require('./src/shared/versions.ts');
          " 2>/dev/null || true
          # Read versions directly from file to avoid TypeScript compilation
          VERSIONS=$(node -e "
            const fs = require('fs');
            const content = fs.readFileSync('src/shared/versions.ts', 'utf-8');
            const match = content.match(/SUPPORTED_VERSIONS\s*=\s*\[([^\]]+)\]/);
            const versions = match[1].match(/'([^']+)'/g).map(v => v.replace(/'/g, ''));
            console.log(versions.join(' '));
          ")
          for v in $VERSIONS; do
            echo "=== Extracting schema for v$v ==="
            node scripts/extract-schema.js "$v"
            node scripts/validate-schema.js "$v"
          done

      - name: Regenerate schema loader
        run: node scripts/update-schema-loader.js

      - name: Create PR
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          BRANCH="schema/bootstrap-$(date +%Y%m%d)"
          git checkout -b "$BRANCH"
          git add src/shared/provider-schemas/ src/shared/schema-loader.ts src/shared/versions.ts
          git commit -m "chore: bootstrap provider schema snapshots for all supported versions"
          git push -u origin "$BRANCH"
          gh pr create \
            --auto-merge \
            --title "chore: bootstrap provider schema snapshots" \
            --body "Automated bootstrap of Okta TF provider schema snapshots. Validates via \`schema-validate\` CI check before merging."
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

- [ ] **Step 2: Create the daily sync workflow**

Create `.github/workflows/provider-schema-sync.yml`:

```yaml
name: Provider Schema Sync

on:
  schedule:
    - cron: '0 9 * * *'
  workflow_dispatch:

permissions:
  contents: write
  pull-requests: write

jobs:
  check-and-sync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Check for new provider version
        id: check
        run: |
          LATEST=$(curl -sf https://api.github.com/repos/okta/terraform-provider-okta/releases/latest \
            -H "Authorization: Bearer ${{ secrets.GITHUB_TOKEN }}" \
            | node -e "let d=''; process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).tag_name.replace(/^v/,'')))")
          echo "latest=$LATEST" >> $GITHUB_OUTPUT
          echo "Latest Okta TF provider: v$LATEST"
          if grep -q "'$LATEST'" src/shared/versions.ts; then
            echo "known=true" >> $GITHUB_OUTPUT
            echo "v$LATEST already in SUPPORTED_VERSIONS — nothing to do"
          else
            echo "known=false" >> $GITHUB_OUTPUT
            echo "v$LATEST is NEW — will extract schema"
          fi

      - uses: hashicorp/setup-terraform@v3
        if: steps.check.outputs.known == 'false'
        with:
          terraform_version: '1.9.0'

      - name: Install dependencies
        if: steps.check.outputs.known == 'false'
        run: npm ci

      - name: Extract and validate schema
        if: steps.check.outputs.known == 'false'
        run: |
          node scripts/extract-schema.js ${{ steps.check.outputs.latest }}
          node scripts/validate-schema.js ${{ steps.check.outputs.latest }}

      - name: Regenerate schema loader
        if: steps.check.outputs.known == 'false'
        run: node scripts/update-schema-loader.js

      - name: Create auto-merge PR
        if: steps.check.outputs.known == 'false'
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git checkout -b schema/${{ steps.check.outputs.latest }}
          git add src/shared/provider-schemas/${{ steps.check.outputs.latest }}.json \
                  src/shared/schema-loader.ts \
                  src/shared/versions.ts
          git commit -m "chore: add schema snapshot for Okta TF provider v${{ steps.check.outputs.latest }}"
          git push -u origin schema/${{ steps.check.outputs.latest }}
          gh pr create \
            --auto-merge \
            --title "chore: add schema snapshot for v${{ steps.check.outputs.latest }}" \
            --body "Automated schema snapshot for Okta TF provider v${{ steps.check.outputs.latest }}. Auto-merges when \`schema-validate\` CI check passes."
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

- [ ] **Step 3: One-time GitHub repo setup (do this in browser)**

In the GitHub repo settings, enable auto-merge and branch protection:
1. **Settings → General → Pull Requests**: enable "Allow auto-merge"
2. **Settings → Branches → Add rule** for `main`:
   - Check "Require status checks to pass before merging"
   - Add required status check named: `schema-validate` (this is the job name from the existing CI — update to match whatever your CI job is named)
   - Check "Require branches to be up to date before merging"

- [ ] **Step 4: Commit workflows**

```bash
git add .github/workflows/bootstrap-schemas.yml .github/workflows/provider-schema-sync.yml
git commit -m "feat(schema): add GitHub Actions workflows for schema bootstrap and daily sync"
```

---

## Task 8: `buildSchemaContext()` with tests (TDD)

**Files:**
- Modify: `src/__tests__/validator.test.ts` (append new tests)
- Modify: `src/main/api/validator.ts` (add `buildSchemaContext` + helpers)

- [ ] **Step 1: Write failing tests for `buildSchemaContext`**

Append to `src/__tests__/validator.test.ts` (after the last `describe` block):

```ts
import { buildSchemaContext } from '../main/api/validator';
import type { ProviderSchema } from '../shared/provider-schemas/schema-types';

const MOCK_SCHEMA: ProviderSchema = {
  resource_schemas: {
    okta_app_oauth: {
      attributes: {
        label:       { type: 'string', required: true, description: 'Pretty name' },
        type:        { type: 'string', required: true },
        grant_types: { type: ['set', 'string'], required: true },
        redirect_uris: { type: ['set', 'string'], optional: true },
        implicit_assignment: { type: 'bool', optional: true, deprecated: true },
        id:          { type: 'string', computed: true },
      },
      block_types: {
        groups_claim: {
          nesting_mode: 'list',
          max_items: 1,
          attributes: {
            filter_type: { type: 'string', required: true },
            name:        { type: 'string', required: true },
            type:        { type: 'string', required: true },
            value:       { type: 'string', required: true },
          },
        },
      },
    },
  },
  data_source_schemas: {
    okta_app: {
      attributes: {
        label: { type: 'string', optional: true },
      },
    },
  },
};

describe('buildSchemaContext', () => {
  it('returns schema section only for resource types present in the files', () => {
    const files = { 'main.tf': 'resource "okta_app_oauth" "x" { label = "test" }' };
    const result = buildSchemaContext(MOCK_SCHEMA, files);
    expect(result).toContain('okta_app_oauth');
    expect(result).not.toContain('okta_group');
  });

  it('marks deprecated attributes clearly', () => {
    const files = { 'main.tf': 'resource "okta_app_oauth" "x" {}' };
    const result = buildSchemaContext(MOCK_SCHEMA, files);
    expect(result).toContain('implicit_assignment');
    expect(result.toLowerCase()).toContain('deprecated');
  });

  it('includes block type info with required attributes', () => {
    const files = { 'main.tf': 'resource "okta_app_oauth" "x" {}' };
    const result = buildSchemaContext(MOCK_SCHEMA, files);
    expect(result).toContain('groups_claim');
    expect(result).toContain('filter_type');
  });

  it('marks unknown resource types explicitly as not found in schema', () => {
    const files = { 'main.tf': 'resource "okta_invented_resource" "x" {}' };
    const result = buildSchemaContext(MOCK_SCHEMA, files);
    expect(result).toContain('okta_invented_resource');
    expect(result.toLowerCase()).toContain('not found');
  });

  it('handles data sources as well as resources', () => {
    const files = { 'main.tf': 'data "okta_app" "x" {}' };
    const result = buildSchemaContext(MOCK_SCHEMA, files);
    expect(result).toContain('okta_app');
  });

  it('returns empty string when no Okta resources are present', () => {
    const files = { 'main.tf': 'resource "aws_s3_bucket" "x" {}' };
    const result = buildSchemaContext(MOCK_SCHEMA, files);
    expect(result.trim()).toBe('');
  });

  it('does not include computed-only attributes in the schema context', () => {
    const files = { 'main.tf': 'resource "okta_app_oauth" "x" {}' };
    const result = buildSchemaContext(MOCK_SCHEMA, files);
    // 'id' is computed-only — not useful for validation
    const idLine = result.split('\n').find(l => /^\s+id\b/.test(l));
    expect(idLine).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests — confirm they fail**

```bash
npx jest validator.test.ts -t "buildSchemaContext"
```

Expected: FAIL — `buildSchemaContext` is not exported from `validator.ts` yet.

- [ ] **Step 3: Implement `buildSchemaContext` and helpers in `validator.ts`**

Add these functions to `src/main/api/validator.ts`, after the `VAULT_PATTERNS` block and before `vaultProject`:

```ts
import { loadSchema, getResourceSchema } from '../../shared/schema-loader';
import type { ProviderSchema, ResourceSchema } from '../../shared/provider-schemas/schema-types';

function extractResourceTypes(files: Record<string, string>): string[] {
  const types = new Set<string>();
  const resourceRegex = /resource\s+"(\w+)"/g;
  const dataRegex = /data\s+"(\w+)"/g;
  for (const content of Object.values(files)) {
    for (const m of content.matchAll(resourceRegex)) if (m[1].startsWith('okta_')) types.add(m[1]);
    for (const m of content.matchAll(dataRegex)) if (m[1].startsWith('okta_')) types.add(m[1]);
  }
  return [...types].sort();
}

function formatResourceSchema(resourceType: string, schema: ResourceSchema): string {
  const lines: string[] = [`${resourceType}:`];
  const attrs = schema.attributes ?? {};

  const required   = Object.entries(attrs).filter(([, a]) => a.required).map(([n]) => n);
  const optional   = Object.entries(attrs).filter(([, a]) => a.optional && !a.deprecated).map(([n]) => n);
  const deprecated = Object.entries(attrs).filter(([, a]) => a.deprecated).map(([n]) => n);

  if (required.length)   lines.push(`  Required: ${required.join(', ')}`);
  if (optional.length)   lines.push(`  Optional: ${optional.join(', ')}`);
  if (deprecated.length) lines.push(`  Deprecated (do not use — flag as warning): ${deprecated.join(', ')}`);

  for (const [btName, bt] of Object.entries(schema.block_types ?? {})) {
    const btReq = Object.entries(bt.attributes ?? {}).filter(([, a]) => a.required).map(([n]) => n);
    const maxNote = bt.max_items === 1 ? ' (max 1)' : '';
    lines.push(`  Block "${btName}"${maxNote}: required: ${btReq.join(', ') || 'none'}`);
  }

  return lines.join('\n');
}

export function buildSchemaContext(schema: ProviderSchema, files: Record<string, string>): string {
  const resourceTypes = extractResourceTypes(files);
  if (resourceTypes.length === 0) return '';

  const sections: string[] = [];
  for (const resourceType of resourceTypes) {
    const resourceSchema =
      schema.resource_schemas[resourceType] ?? schema.data_source_schemas[resourceType] ?? null;
    if (resourceSchema) {
      sections.push(formatResourceSchema(resourceType, resourceSchema));
    } else {
      sections.push(`${resourceType}: NOT FOUND in provider schema — flag as error`);
    }
  }

  return `Okta Terraform Provider schema — resources in this project:\n\n${sections.join('\n\n')}`;
}
```

- [ ] **Step 4: Run tests**

```bash
npx jest validator.test.ts -t "buildSchemaContext"
```

Expected: all 7 new tests PASS.

- [ ] **Step 5: Run full test suite**

```bash
npx jest
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/main/api/validator.ts src/__tests__/validator.test.ts
git commit -m "feat(schema): add buildSchemaContext with tests"
```

---

## Task 9: Update `analyzeProject` to accept version + use schema

**Files:**
- Modify: `src/main/api/validator.ts`

- [ ] **Step 1: Update the import at the top of `validator.ts`**

The import added in Task 8 (`import { loadSchema, getResourceSchema }`) already covers this. Verify it's present at the top of `validator.ts`.

- [ ] **Step 2: Convert `VALIDATOR_SYSTEM_PROMPT` from a constant to a function**

**IMPORTANT: Do NOT copy the prompt text from this plan.** The prompt in `validator.ts` has been updated during active development and may differ from what was recorded here. Instead:

1. Read `src/main/api/validator.ts` to get the EXACT current text of `VALIDATOR_SYSTEM_PROMPT` and `buildResourceNameContext`.
2. Remove `buildResourceNameContext` entirely.
3. Remove the `VALIDATOR_SYSTEM_PROMPT` constant.
4. Replace both with the function below, substituting the prompt body you just read (everything between the opening backtick and closing backtick of `VALIDATOR_SYSTEM_PROMPT`) where indicated by `/* CURRENT PROMPT BODY */`:

```ts
function buildValidatorSystemPrompt(schema: ProviderSchema, version: string, maskedFiles: Record<string, string>): string {
  const schemaContext = buildSchemaContext(schema, maskedFiles);
  const schemaSection = schemaContext
    ? `${schemaContext}\n\nThe schema above is authoritative for provider v${version}. Do not rename valid resource types. Flag resource types absent from the schema as errors.`
    : `Provider version: ${version}. Validate resource types against your knowledge of the Okta Terraform provider.`;

  // Replace ${buildResourceNameContext()} in the original prompt with ${schemaSection}
  return /* CURRENT PROMPT BODY with buildResourceNameContext() replaced by schemaSection */;
}
```

The transformation is: take the current `VALIDATOR_SYSTEM_PROMPT` string, replace the `${buildResourceNameContext()}` interpolation with `${schemaSection}`, and wrap it as the return value of this function.

Remove the `buildResourceNameContext` function entirely. The full replacement target is everything from `function buildResourceNameContext` through the end of `VALIDATOR_SYSTEM_PROMPT`:

The resulting function signature is:
```ts
function buildValidatorSystemPrompt(schema: ProviderSchema, version: string, maskedFiles: Record<string, string>): string
```

- [ ] **Step 3: Update `analyzeProject` signature and body**

Change `analyzeProject` from:

```ts
export async function analyzeProject(maskedFiles: Record<string, string>): Promise<ValidatorAnalysis> {
  const client = getClient();
  // ...
  system: VALIDATOR_SYSTEM_PROMPT,
```

To:

```ts
export async function analyzeProject(maskedFiles: Record<string, string>, version: string): Promise<ValidatorAnalysis> {
  const client = getClient();
  const schema = loadSchema(version);
  const systemPrompt = buildValidatorSystemPrompt(schema, version, maskedFiles);

  // ... (keep all existing code, replace VALIDATOR_SYSTEM_PROMPT with systemPrompt)
  system: systemPrompt,
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: one error — `validator:analyze` IPC handler still calls `analyzeProject(session.vault.maskedFiles)` without the version argument. This is expected and fixed in Task 10.

- [ ] **Step 5: Commit**

```bash
git add src/main/api/validator.ts
git commit -m "feat(schema): update analyzeProject to accept version and inject schema context"
```

---

## Task 10: Update IPC handler to pass version

**Files:**
- Modify: `src/main/ipc-handlers.ts`

- [ ] **Step 1: Update the `validator:analyze` handler**

In `src/main/ipc-handlers.ts`, find the `validator:analyze` handler (around line 574). Change:

```ts
const analysis = await analyzeProject(session.vault.maskedFiles);
```

To:

```ts
const version = providerManager.getSelectedVersion();
const analysis = await analyzeProject(session.vault.maskedFiles, version);
```

`providerManager` is already imported at line 24. No new import needed.

- [ ] **Step 2: TypeScript compile + full test suite**

```bash
npx tsc --noEmit && npx jest
```

Expected: no TypeScript errors, all tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/main/ipc-handlers.ts
git commit -m "feat(schema): pass selected provider version to analyzeProject in IPC handler"
```

---

## Self-Review Checklist

**Spec coverage:**
- ✅ Extractor script `scripts/extract-schema.js` (Task 3)
- ✅ Loader generator `scripts/update-schema-loader.js` (Task 4)
- ✅ Validation script `scripts/validate-schema.js` (Task 6)
- ✅ `schema-types.ts` (Task 1)
- ✅ Schema snapshots for all 8 versions (Tasks 3 + 5)
- ✅ `schema-loader.ts` with `loadSchema`, `isKnownResource`, `getResourceSchema` (Task 4)
- ✅ Tests for schema loader: 6.13.0 loads, `okta_app_signon_policy_rules` is known (Task 2)
- ✅ Bootstrap workflow (Task 7)
- ✅ Daily sync workflow with auto-merge (Task 7)
- ✅ `buildSchemaContext` pure function + tests (Task 8)
- ✅ `analyzeProject` signature change (Task 9)
- ✅ IPC handler passes version (Task 10)
- ✅ `buildResourceNameContext` removed (Task 9)
- ✅ Graceful fallback when no Okta resources in files (Task 8 — returns empty string, prompt falls back to training)

**Type consistency:** `ProviderSchema`, `ResourceSchema`, `AttributeSchema`, `BlockTypeSchema` defined in Task 1 and used consistently in Tasks 4, 8, 9.

**No placeholders detected.**
