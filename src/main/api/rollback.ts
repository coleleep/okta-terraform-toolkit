import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { app } from 'electron';
import { getOrgInfo, generateVersionsTf, generateVariablesTf } from '../../shared/terraform-gen';
import { RollbackManifest } from '../../shared/types';

function getBundleDir(): string {
  return path.join(app.getPath('userData'), 'rollback-bundle');
}

export function saveTfStateRollbackBundle(
  exportedDir: string,
  targetOrgUrl: string,
  providerVersion: string,
  exactProviderVersion?: string,
  swapped?: boolean,
  importedAddresses?: string[],
): void {
  const bundleDir = getBundleDir();
  fs.mkdirSync(bundleDir, { recursive: true });
  const tfstatePath = path.join(exportedDir, 'terraform.tfstate');
  if (fs.existsSync(tfstatePath)) {
    fs.copyFileSync(tfstatePath, path.join(bundleDir, 'terraform.tfstate'));
  }
  const manifest: RollbackManifest = {
    timestamp: new Date().toISOString(),
    targetOrgUrl,
    providerVersion,
    exactProviderVersion,
    mode: 'tf-state',
    swapped,
    importedAddresses,
  };
  fs.writeFileSync(path.join(bundleDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
}

export function checkRollbackBundle(): { available: boolean; manifest: RollbackManifest | null } {
  const bundleDir = getBundleDir();
  const manifestPath = path.join(bundleDir, 'manifest.json');
  const tfstatePath = path.join(bundleDir, 'terraform.tfstate');
  if (!fs.existsSync(manifestPath) || !fs.existsSync(tfstatePath)) {
    return { available: false, manifest: null };
  }
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as RollbackManifest;
    return { available: true, manifest };
  } catch {
    return { available: false, manifest: null };
  }
}

export function prepareTfStateRollback(): { rollbackDir: string; manifest: RollbackManifest } {
  const bundleDir = getBundleDir();
  const manifest = JSON.parse(
    fs.readFileSync(path.join(bundleDir, 'manifest.json'), 'utf8'),
  ) as RollbackManifest;

  const rollbackDir = path.join(os.tmpdir(), `okta-tf-rollback-${Date.now()}`);
  fs.mkdirSync(rollbackDir, { recursive: true });

  fs.copyFileSync(
    path.join(bundleDir, 'terraform.tfstate'),
    path.join(rollbackDir, 'terraform.tfstate'),
  );

  const versionsTf = manifest.providerVersion === 'system'
    ? `terraform {\n  required_version = ">= 1.5.0"\n\n  required_providers {\n    okta = {\n      source = "okta/okta"\n    }\n  }\n}\n`
    : generateVersionsTf(manifest.providerVersion, manifest.exactProviderVersion);
  fs.writeFileSync(path.join(rollbackDir, 'versions.tf'), versionsTf, 'utf8');
  fs.writeFileSync(
    path.join(rollbackDir, 'variables.tf'),
    generateVariablesTf('api_token'),
    'utf8',
  );

  const { orgName, baseUrl } = getOrgInfo(manifest.targetOrgUrl);
  const providerTf = `provider "okta" {\n  org_name  = "${orgName}"\n  base_url  = "${baseUrl}"\n  api_token = var.okta_api_token\n}\n`;
  fs.writeFileSync(path.join(rollbackDir, 'provider.tf'), providerTf, 'utf8');

  // No resource blocks — terraform will plan to destroy everything in the state
  fs.writeFileSync(
    path.join(rollbackDir, 'main.tf'),
    '# Rollback: no resources defined — terraform will destroy all managed resources\n',
    'utf8',
  );

  return { rollbackDir, manifest };
}

export function clearRollbackBundle(): void {
  const bundleDir = getBundleDir();
  if (fs.existsSync(bundleDir)) {
    fs.rmSync(bundleDir, { recursive: true, force: true });
  }
}
