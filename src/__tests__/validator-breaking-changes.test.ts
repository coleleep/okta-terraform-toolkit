import { validateForExport } from '../main/api/validator';
import type { ValidatorAnalysis } from '../../src/shared/types';

describe('validateForExport: v7.0.0 breaking-change hints', () => {
  it('flags a renamed attribute (network_excludes) with the specific replacement', async () => {
    const files = {
      'main.tf': `resource "okta_threat_insight_settings" "example" {
  network_excludes = ["1.2.3.0/24"]
}`,
    };
    const stubAnalyze = async (): Promise<ValidatorAnalysis> => ({ findings: [], fixedMaskedFiles: {} });
    const result = await validateForExport(files, '7.0.0', stubAnalyze);
    expect(result.findings.some(f =>
      f.resourceAddress === 'okta_threat_insight_settings.example' &&
      f.explanation.includes('exclude_zones')
    )).toBe(true);
  });

  it('does not flag network_excludes when targeting 6.15.0 (change not yet applicable)', async () => {
    const files = {
      'main.tf': `resource "okta_threat_insight_settings" "example" {
  network_excludes = ["1.2.3.0/24"]
}`,
    };
    const stubAnalyze = async (): Promise<ValidatorAnalysis> => ({ findings: [], fixedMaskedFiles: {} });
    const result = await validateForExport(files, '6.15.0', stubAnalyze);
    expect(result.findings.some(f => f.explanation.includes('exclude_zones'))).toBe(false);
  });

  it('does not flag an unrelated attribute of the same name in a different resource type', async () => {
    const files = {
      'main.tf': `resource "okta_network_zone" "example" {
  network_excludes = ["1.2.3.0/24"]
}`,
    };
    const stubAnalyze = async (): Promise<ValidatorAnalysis> => ({ findings: [], fixedMaskedFiles: {} });
    const result = await validateForExport(files, '7.0.0', stubAnalyze);
    expect(result.findings.some(f => f.explanation.includes('exclude_zones'))).toBe(false);
  });

  it('flags a removed attribute (status on okta_role_subscription)', async () => {
    const files = {
      'main.tf': `resource "okta_role_subscription" "example" {
  role_ref = "SUPER_ADMIN"
  status   = "subscribed"
}`,
    };
    const stubAnalyze = async (): Promise<ValidatorAnalysis> => ({ findings: [], fixedMaskedFiles: {} });
    const result = await validateForExport(files, '7.0.0', stubAnalyze);
    expect(result.findings.some(f =>
      f.resourceAddress === 'okta_role_subscription.example' && f.severity === 'error'
    )).toBe(true);
  });

  it('does NOT flag status inside a data "okta_role_subscription" block (blockKind: resource only)', async () => {
    const files = {
      'main.tf': `data "okta_role_subscription" "example" {
  role_ref = "SUPER_ADMIN"
  status   = "subscribed"
}`,
    };
    const stubAnalyze = async (): Promise<ValidatorAnalysis> => ({ findings: [], fixedMaskedFiles: {} });
    const result = await validateForExport(files, '7.0.0', stubAnalyze);
    expect(result.findings.some(f => f.explanation.includes('computed'))).toBe(false);
  });

  it('flags notification_type requiredness change inside a data "okta_role_subscription" block', async () => {
    const files = {
      'main.tf': `data "okta_role_subscription" "example" {
  notification_type = "APP_ASSIGNMENT"
}`,
    };
    const stubAnalyze = async (): Promise<ValidatorAnalysis> => ({ findings: [], fixedMaskedFiles: {} });
    const result = await validateForExport(files, '7.0.0', stubAnalyze);
    expect(result.findings.some(f =>
      f.resourceAddress === 'data.okta_role_subscription.example' &&
      f.explanation.toLowerCase().includes('computed')
    )).toBe(true);
  });

  it('does not flag a commented-out block', async () => {
    const files = {
      'main.tf': `# resource "okta_role_subscription" "example" {
#   role_ref = "SUPER_ADMIN"
#   status   = "subscribed"
# }`,
    };
    const stubAnalyze = async (): Promise<ValidatorAnalysis> => ({ findings: [], fixedMaskedFiles: {} });
    const result = await validateForExport(files, '7.0.0', stubAnalyze);
    expect(result.findings.length).toBe(0);
  });

  it('does not flag status when the word only appears inside an unrelated string value', async () => {
    const files = {
      'main.tf': `resource "okta_role_subscription" "example" {
  role_ref    = "SUPER_ADMIN"
  description = "status = active for onboarding"
}`,
    };
    const stubAnalyze = async (): Promise<ValidatorAnalysis> => ({ findings: [], fixedMaskedFiles: {} });
    const result = await validateForExport(files, '7.0.0', stubAnalyze);
    expect(result.findings.some(f =>
      f.resourceAddress === 'okta_role_subscription.example' && f.title.includes('status')
    )).toBe(false);
  });
});
