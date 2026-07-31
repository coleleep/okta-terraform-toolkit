# Schema Foundation — Design Spec

**Date:** 2026-07-31
**Feature area:** Cross-cutting (`validator.ts`, `resource-dictionary.ts`, `schema-loader.ts`, GitHub Actions)
**Status:** Approved for implementation

---

## Problem

OTTO's validator uses a hand-maintained `RESOURCE_DICTIONARY` of 304 resource names as the allowlist for Claude's validation prompt. This list drifts as the Okta TF provider releases new resources — it missed `okta_app_signon_policy_rules` even though the resource exists, triggering a false-positive error. The dictionary also has no attribute-level data, so Claude can't catch missing required attributes, deprecated attribute usage, or incorrect types without relying on training data that may itself be stale.

The fix: replace the static name list with versioned schema snapshots extracted directly from `terraform providers schema -json`, and automate snapshot generation on every new provider release via GitHub Actions.

---

## Decisions Made

| Question | Decision |
|---|---|
| Approach | A — schema as source of truth, dictionary as operational overlay |
| Snapshot generation | Pre-extracted per supported version (zero runtime latency) |
| Schema loading | Static import map in `schema-loader.ts` (webpack-friendly) |
| GitHub automation | Auto-merge on CI pass (no manual involvement required) |
| Historical versions | Bootstrap all 8 current versions (6.6.1 → 6.13.0), ongoing for new versions only |
| Validator injection | Per-resource schema filtered to resources present in uploaded files |

---

## Sub-Project Roadmap

```
[1 Extractor + CI] → [2 Schema Foundation] → [3 Validator Integration] → [4 Dict Refactor*] → [5 Export Gate*]
```

Sub-projects 1–3 are **Milestone 1** (this spec). Sub-projects 4–5 are follow-on specs that build on Milestone 1.

---

## Sub-Project 1: Schema Extractor + GitHub Actions

### Extractor Script (`scripts/extract-schema.ts`)

A Node.js/TypeScript script that:

1. Accepts a provider version string as a CLI argument
2. Creates a temp directory with a minimal `main.tf`:
   ```hcl
   terraform {
     required_providers {
       okta = { source = "okta/okta", version = "= VERSION" }
     }
   }
   ```
3. Runs `terraform init -no-color -backend=false`
4. Runs `terraform providers schema -json`
5. Parses output, extracts `provider_schemas["registry.terraform.io/okta/okta"]`
6. Slims the schema — keeps `resource_schemas` and `data_source_schemas`, and within each resource: `attributes` (type, required, optional, computed, deprecated, description) and `block_types` (nesting_mode, max_items, min_items, nested attributes). Drops `version`, `description_kind`, and other internal metadata.
7. Writes the slimmed JSON to `src/shared/provider-schemas/{version}.json`
8. Appends the version to `SUPPORTED_VERSIONS` in `src/shared/versions.ts` if not already present

Estimated output size: ~150–250KB per version after slimming (vs. 2–5MB raw). Total across 8 versions: ~1.5MB added to the bundle.

### Bootstrap Workflow (`.github/workflows/bootstrap-schemas.yml`)

- **Trigger:** `workflow_dispatch` only (one-time manual run)
- **Steps:** Install Terraform + Node.js, run `extract-schema.ts` for each version in `SUPPORTED_VERSIONS`, commit all snapshots + import map updates, open a PR (same auto-merge pattern as the sync workflow). Does NOT push directly to main — branch protection applies here too.
- **One-time repo setup required:** Enable "Allow auto-merge" in repo Settings → General, and add a required status check named `schema-validate` to the main branch protection rule.

### Sync Workflow (`.github/workflows/provider-schema-sync.yml`)

- **Trigger:** Daily cron (`0 9 * * *`) + `workflow_dispatch`
- **Steps:**
  1. Fetch `https://api.github.com/repos/okta/terraform-provider-okta/releases/latest`
  2. Parse the latest version tag (e.g., `v6.14.0` → `6.14.0`)
  3. Check if version already exists in `src/shared/versions.ts` — skip if so
  4. Install Terraform + Node.js
  5. Run `extract-schema.ts {version}`
  6. Run schema validation test (see Testing section)
  7. Commit `{version}.json` + updated `versions.ts` + updated `schema-loader.ts` import map on a new branch `schema/{version}`
  8. Open PR with `gh pr create --auto-merge --title "chore: add schema snapshot for v{version}"`
- **Branch protection required:** "schema-validate" CI check must pass before auto-merge is allowed. Configured once in repo settings.
- **Failure behavior:** If `terraform init` fails, schema JSON is malformed, or validation test fails — the CI check fails, auto-merge does not proceed, and the PR stays open. No action required unless you choose to investigate.

---

## Sub-Project 2: Schema Foundation

### File Structure

```
src/shared/
  provider-schemas/
    6.6.1.json
    6.7.0.json
    6.8.0.json
    6.9.0.json
    6.10.0.json
    6.11.0.json
    6.12.0.json
    6.13.0.json
    schema-types.ts      ← TypeScript interfaces
  schema-loader.ts       ← static import map + loadSchema()
```

### TypeScript Types (`src/shared/provider-schemas/schema-types.ts`)

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
  attributes: Record<string, AttributeSchema>;
  block_types?: Record<string, BlockTypeSchema>;
}

export interface ResourceSchema {
  attributes: Record<string, AttributeSchema>;
  block_types?: Record<string, BlockTypeSchema>;
}

export interface ProviderSchema {
  resource_schemas: Record<string, ResourceSchema>;
  data_source_schemas: Record<string, ResourceSchema>;
}
```

### Schema Loader (`src/shared/schema-loader.ts`)

```ts
import type { ProviderSchema } from './provider-schemas/schema-types';
import schema_6_6_1  from './provider-schemas/6.6.1.json';
import schema_6_7_0  from './provider-schemas/6.7.0.json';
// ... one import per version ...
import schema_6_13_0 from './provider-schemas/6.13.0.json';

const SCHEMAS: Record<string, ProviderSchema> = {
  '6.6.1':  schema_6_6_1  as ProviderSchema,
  '6.7.0':  schema_6_7_0  as ProviderSchema,
  // ...
  '6.13.0': schema_6_13_0 as ProviderSchema,
};

export function loadSchema(version: string): ProviderSchema {
  const schema = SCHEMAS[version];
  if (!schema) throw new Error(`No schema snapshot for provider version ${version}`);
  return schema;
}

export function getResourceSchema(version: string, resourceType: string): ResourceSchema | null {
  const schema = loadSchema(version);
  return schema.resource_schemas[resourceType] ?? schema.data_source_schemas[resourceType] ?? null;
}

export function isKnownResource(version: string, resourceType: string): boolean {
  const schema = loadSchema(version);
  return resourceType in schema.resource_schemas || resourceType in schema.data_source_schemas;
}
```

Each new version added by GitHub Actions appends one `import` line and one entry to `SCHEMAS`. TypeScript's `resolveJsonModule: true` (already set in `tsconfig.json`) handles JSON imports natively.

---

## Sub-Project 3: Validator Integration

### Replace `buildResourceNameContext()` with `buildSchemaContext()`

**Current:** dumps all 304 resource names as a flat comma-separated list.

**New:** `buildSchemaContext(version: string, fileContents: Record<string, string>): string`

1. Extracts resource/data-source types from file contents with a simple regex: `/resource\s+"(\w+)"/g` and `/data\s+"(\w+)"/g`
2. Loads only those resource schemas from `loadSchema(version)`
3. Formats each resource schema as structured prompt text:
   ```
   okta_app_oauth (v6.13.0):
     Required: label (string), type (string), grant_types (set of string)
     Optional: redirect_uris, post_logout_redirect_uris, ...
     Deprecated: implicit_assignment — do not use
     Block: groups_claim (max 1) — required: filter_type, name, type, value
   ```
4. Returns the combined prompt section

**Prompt instruction update:** Replace the current authoritative-list language with:

> "The schema above for version {version} is authoritative. Flag any attribute in the project that is marked deprecated above as a warning. Flag any resource type not present in the schema as an error. Do not rename valid resource types."

This is strictly more accurate than the current approach — Claude sees the exact attributes for the exact resources in the project, not a wall of 304 names.

### Provider version flow

`analyzeProject` currently takes only `maskedFiles`. Its signature changes to `analyzeProject(maskedFiles: Record<string, string>, version: string): Promise<ValidatorAnalysis>`. The `validator:analyze` IPC handler calls `providerManager.getSelectedVersion()` (already available in the main process) and passes the result as the second argument. `buildSchemaContext` is called inside `analyzeProject` with this version, replacing `buildResourceNameContext()`.

---

## Sub-Project 4: OTTO Metadata Refactor (follow-on spec)

Reduce `resource-dictionary.ts` to operational-only metadata:
```ts
interface OttoResourceMetadata {
  terraformResource: string;
  parentType: ManagedResourceType;
  primaryEndpoint: string;
  endpointLabel: string;
  parentLabel: string;
}
```

Resources not in this reduced dictionary are still valid (schema is authoritative for resource name validation) — they're just not probed by Plan/Sync.

**Resource search/browse is NOT degraded — it improves.** The `ResourceLookup` component currently reads from `RESOURCE_DICTIONARY` for both the search input and "Browse all" feature. In sub-project 4, this changes to read from `loadSchema(selectedVersion)` instead. Users can now search every resource the provider supports for their specific pinned version (including resources never added to the hand-maintained list), with attribute-level details available. The dictionary no longer gatekeeps which resources are discoverable in the UI.

---

## Sub-Project 5: Export Consistency Gate (follow-on spec)

Pre-export validation step across all three export paths (`file:save-project`, `validator:export`, `file:save-tf`). Runs `analyzeProject` on the to-be-exported files before writing to disk. Errors block export (with override option); warnings show as a review step. Depends on sub-projects 1–3 for accurate validation.

---

## Testing

**Extractor script:**
- Unit test: given a real schema JSON blob, slimming produces correct structure
- Integration test (CI only): runs against a real provider version, verifies non-empty output

**Schema loader:**
- Unit test: `loadSchema('6.13.0')` returns a non-empty schema with at least `okta_app_oauth`
- Unit test: `isKnownResource('6.13.0', 'okta_app_signon_policy_rules')` returns `true` (the false-positive that triggered this feature)
- Unit test: `isKnownResource('6.13.0', 'okta_not_a_real_resource')` returns `false`
- Unit test: `loadSchema('0.0.0')` throws

**`buildSchemaContext()`:**
- Unit test: returns schema section only for resources present in files, not all 304
- Unit test: deprecated attributes appear with deprecation note
- Unit test: unknown resources produce an empty schema section (graceful fallback)

**Schema validation CI check (`schema-validate` job):**
- Validates the new JSON file has `resource_schemas` and `data_source_schemas` keys
- Validates at least one well-known resource (`okta_app_oauth`) is present
- Validates attribute objects have expected shape
- This is the gate that controls auto-merge

---

## Out of Scope

- Running `terraform init` at app startup (no runtime CLI dependency)
- Attribute-level auto-fix suggestions (schema informs error detection, not code generation in this milestone)
- Schema for non-Okta providers
- Storing schema outside the repo (all snapshots ship with the app)
