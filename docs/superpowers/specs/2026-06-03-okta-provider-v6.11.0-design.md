# Design: Okta Terraform Provider v6.11.0 Support

**Date:** 2026-06-03  
**Status:** Approved

## Overview

Update OTTO to support Okta Terraform provider v6.11.0 as the new default version. This includes registering the new version, surfacing all new and updated resources, adding a new `identitySources` managed resource type, and updating the resource picker and config templates accordingly.

---

## What Changed in v6.11.0

### New
- `okta_identity_source` — new resource and data source for profile sourcing from external identity systems

### Updated resources (new attributes)
| Resource | Change |
|---|---|
| `okta_policy_password` | Breached password protection settings |
| `okta_authenticator` | Authenticator methods + WebAuthn custom AAGUID support |
| `okta_push_group` | AD support as a destination |
| `okta_app_signon_policy_rule` | "Option to stay signed in" |
| `okta_policy_rule_sign_on` | `identity_provider` changed to TypeSet |
| `okta_user` | Computed timestamp fields |
| `okta_profile_mapping` | `terraform import` support |
| `okta_network_zone` | Diff suppression (behavioral, no schema change) |

### Bug fixes (no tool changes needed)
- `okta_resource_condition` priority mismatch
- `okta_group_memberships` user import during group membership import
- JSON normalization key ordering fix
- `okta_policy_password_default` priority modification

---

## Files to Change

### 1. `src/shared/versions.ts`

- Add `'6.11.0'` to `SUPPORTED_VERSIONS`
- Set `DEFAULT_VERSION = '6.11.0'`
- Add `VERSION_RESOURCE_ADDITIONS['6.11.0']` with config snippets for:
  - `okta_identity_source` (new resource block)
  - `okta_policy_password` breached password attributes
  - `okta_authenticator` WebAuthn AAGUID attributes
  - `okta_push_group` AD destination attribute
  - `okta_app_signon_policy_rule` stay-signed-in option
- Add `VERSION_ATTRIBUTE_NOTES['6.11.0']` listing all attribute changes and the TypeSet/computed/import behavioral changes

### 2. `src/shared/types.ts`

- Add `'identitySources'` to the `ManagedResourceType` union

### 3. `src/shared/constants.ts`

- Add `identitySources` entry to `RESOURCE_TYPES[]`:
  - API endpoint: `/api/v1/idps` (filtered by identity source type)
  - Category: `'advanced'`
  - Label: `"Identity Sources"`

### 4. `src/shared/resource-dictionary.ts`

- Add `okta_identity_source` (resource) with:
  - `parentType: 'identitySources'`
  - `parentLabel: 'Identity Sources'`
  - `sinceVersion: '6.11.0'`
  - Appropriate primary endpoint
- Add `okta_identity_source` (data source) with same parentType/sinceVersion

### 5. `src/renderer/components/ProviderBlock.tsx`

- Add `RESOURCE_CONFIGS['identitySources']` — HCL block template for `okta_identity_source` with key attributes: `name`, `type`, `issuer_mode`, and identity source settings object

---

## Data Flow (unchanged)

No architectural changes. The existing version-aware flow handles everything:
1. `SUPPORTED_VERSIONS` drives the version picker dropdown
2. `VERSION_RESOURCE_ADDITIONS` + `getAdditionsForVersion()` append new config blocks at generation time
3. `sinceVersion` on dictionary entries gates resource visibility in the picker
4. `ManagedResourceType` + `RESOURCE_TYPES` drives the resource category UI

---

## Out of Scope

- No changes to IPC handlers, store, or terraform-gen
- No changes to existing resource configs for pre-6.11.0 versions
- Bug fix behaviors (diff suppression, TypeSet normalization) are reflected in attribute notes only — no config template changes needed
