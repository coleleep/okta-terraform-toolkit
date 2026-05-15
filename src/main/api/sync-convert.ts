import { getOrgInfo } from '../../shared/terraform-gen';

export interface ConvertedConfig {
  portableHcl: string;
  importBlocks: string;
  instructions: string[];
  warnings: string[];
}

type ResourceMatch = {
  sourceAddress: string;
  sourceId: string;
  sourceName: string;
  targetId: string | null;
  status: string;
  level?: number;
  parentSourceId?: string | null;
  parentTargetId?: string | null;
};

// These scopes exist on every Okta auth server by default and cannot be modified via API.
const SYSTEM_SCOPES = new Set(['openid', 'profile', 'email', 'offline_access', 'address']);

function resolveImportId(
  m: ResourceMatch,
  bySourceId: Map<string, ResourceMatch>,
  warnings: string[],
): string | null {
  if (!m.targetId) return null;
  const type = m.sourceAddress.split('.')[0];

  // System auth server scopes are immutable — skip silently
  if (type === 'okta_auth_server_scope' && SYSTEM_SCOPES.has(m.sourceName)) {
    return null;
  }

  // Top-level resources: just the target ID
  if (!m.level || m.level === 0) {
    return m.targetId;
  }

  // okta_group_memberships uses only group_id (no parent composite)
  if (type === 'okta_group_memberships') {
    return m.targetId;
  }

  // Level 1 sub-resources: parentTargetId/targetId
  if (m.level === 1) {
    if (!m.parentTargetId) {
      warnings.push(`"${m.sourceAddress}": parent not matched in target org — skipping import block.`);
      return null;
    }
    return `${m.parentTargetId}/${m.targetId}`;
  }

  // Level 2 sub-sub-resources (e.g. okta_auth_server_policy_rule): grandParent/parent/child
  if (m.level === 2) {
    if (!m.parentTargetId) {
      warnings.push(`"${m.sourceAddress}": parent not matched in target org — skipping import block.`);
      return null;
    }
    const parentMatch = m.parentSourceId ? bySourceId.get(m.parentSourceId) : null;
    const grandParentTargetId = parentMatch?.parentTargetId;
    if (!grandParentTargetId) {
      warnings.push(`"${m.sourceAddress}": grandparent not matched in target org — skipping import block.`);
      return null;
    }
    return `${grandParentTargetId}/${m.parentTargetId}/${m.targetId}`;
  }

  return m.targetId;
}

function buildImportBlocks(matches: ResourceMatch[], warnings: string[]): string {
  const bySourceId = new Map<string, ResourceMatch>();
  for (const m of matches) {
    if (m.sourceId) bySourceId.set(m.sourceId, m);
  }

  const SYSTEM_ZONE_NAMES = /^(blockedipzone|legacyipzone|defaultexemptipzone|defaultenhanceddynamiczone)$/i;

  const lines: string[] = [];
  for (const m of matches) {
    // Skip system network zones — they can't be managed via Terraform
    if (m.sourceAddress.startsWith('okta_network_zone.') && SYSTEM_ZONE_NAMES.test(m.sourceName)) {
      continue;
    }
    if (m.status === 'ambiguous') {
      warnings.push(
        `"${m.sourceAddress}" has multiple matches in target org — import skipped. Resolve manually.`,
      );
      continue;
    }
    if (m.status === 'missing' || !m.targetId) {
      warnings.push(
        `"${m.sourceAddress}" not found in target org — will be created from scratch. ` +
        `If a resource with the same name already exists, the apply will fail with "name already in use"; ` +
        `import it manually instead.`,
      );
      continue;
    }

    const importId = resolveImportId(m, bySourceId, warnings);
    if (importId === null) continue;

    lines.push(`import {`);
    lines.push(`  to = ${m.sourceAddress}`);
    lines.push(`  id = "${importId}"`);
    lines.push(`}`);
    lines.push('');
  }

  return lines.join('\n');
}

function substituteOrgAndIds(
  tfContent: string,
  matches: ResourceMatch[],
  targetOrgUrl: string,
): string {
  let result = tfContent;

  // Replace every matched source ID with the corresponding target ID
  for (const m of matches) {
    if (m.status === 'matched' && m.sourceId && m.targetId && m.sourceId !== m.targetId) {
      result = result.split(`"${m.sourceId}"`).join(`"${m.targetId}"`);
    }
  }

  // Update the provider block's org_name and base_url to point at the target org
  try {
    const { orgName, baseUrl } = getOrgInfo(targetOrgUrl);
    result = result.replace(/org_name\s*=\s*"[^"]*"/, `org_name  = "${orgName}"`);
    result = result.replace(/base_url\s*=\s*"[^"]*"/, `base_url  = "${baseUrl}"`);
  } catch {
    // If targetOrgUrl is unparseable, skip — leave original provider block unchanged
  }

  return result;
}

export function convertConfigDeterministic(
  tfContent: string,
  resourceMatches: ResourceMatch[],
  targetOrgUrl: string,
): ConvertedConfig {
  const warnings: string[] = [];

  const portableHcl = substituteOrgAndIds(tfContent, resourceMatches, targetOrgUrl);
  const importBlocks = buildImportBlocks(resourceMatches, warnings);

  // Warn about policy rule priority chaining — handled automatically by the AI path
  const hasPolicyRules = resourceMatches.some(m =>
    m.sourceAddress.split('.')[0].includes('policy_rule'),
  );
  if (hasPolicyRules) {
    warnings.push(
      'Policy rules were detected. Add depends_on chains between rules sharing the same parent policy ' +
      '(ascending priority order) to prevent concurrent 409 conflicts. ' +
      'The AI-powered convert mode handles this automatically.',
    );
  }

  const matchedCount = resourceMatches.filter(m => m.status === 'matched').length;
  const missingCount = resourceMatches.filter(m => m.status === 'missing').length;

  const instructions: string[] = [
    'Set your target org API token before applying: export TF_VAR_okta_api_token=<your-token>',
    'Initialize Terraform: terraform init',
    importBlocks.trim()
      ? 'Save the import blocks to imports.tf in your project directory alongside the converted config.'
      : 'No import blocks generated — all resources will be created from scratch.',
    'Preview changes: terraform plan',
    'Apply to target org: terraform apply',
  ];
  if (matchedCount > 0) {
    instructions.push(`${matchedCount} resource(s) matched — import blocks generated.`);
  }
  if (missingCount > 0) {
    instructions.push(`${missingCount} resource(s) not found in target org — will be created.`);
  }

  return { portableHcl, importBlocks, instructions, warnings };
}
