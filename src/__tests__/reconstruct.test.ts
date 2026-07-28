import { reconstructFiles } from '../shared/reconstruct';
import type { Finding } from '../shared/types';

const base = (overrides: Partial<Finding> = {}): Finding => ({
  id: 'f1',
  category: 'correctness',
  severity: 'error',
  file: 'main.tf',
  resourceAddress: 'okta_group.admins',
  title: 'test',
  explanation: 'test',
  originalSnippet: 'skip_users = true',
  fixedSnippet: '# removed',
  ...overrides,
});

describe('reconstructFiles', () => {
  it('applies an accepted finding — replaces originalSnippet with fixedSnippet', () => {
    const maskedFiles = { 'main.tf': 'resource "okta_group" "x" {\n  skip_users = true\n}\n' };
    const findings = [base()];
    const accepted = new Set(['f1']);
    const result = reconstructFiles(maskedFiles, findings, accepted);
    expect(result['main.tf']).toContain('# removed');
    expect(result['main.tf']).not.toContain('skip_users = true');
  });

  it('does not apply a rejected finding — leaves file unchanged', () => {
    const original = 'resource "okta_group" "x" {\n  skip_users = true\n}\n';
    const maskedFiles = { 'main.tf': original };
    const findings = [base()];
    const result = reconstructFiles(maskedFiles, findings, new Set());
    expect(result['main.tf']).toBe(original);
  });

  it('applies two accepted findings in the same file sequentially', () => {
    const maskedFiles = {
      'main.tf': 'skip_users = true\nskip_groups = true\n',
    };
    const findings = [
      base({ id: 'f1', originalSnippet: 'skip_users = true', fixedSnippet: '# no skip_users' }),
      base({ id: 'f2', originalSnippet: 'skip_groups = true', fixedSnippet: '# no skip_groups' }),
    ];
    const result = reconstructFiles(maskedFiles, findings, new Set(['f1', 'f2']));
    expect(result['main.tf']).toContain('# no skip_users');
    expect(result['main.tf']).toContain('# no skip_groups');
    expect(result['main.tf']).not.toContain('skip_users = true');
    expect(result['main.tf']).not.toContain('skip_groups = true');
  });

  it('applies a finding in one file but not another', () => {
    const maskedFiles = {
      'a.tf': 'skip_users = true',
      'b.tf': 'skip_groups = true',
    };
    const findings = [
      base({ id: 'f1', file: 'a.tf', originalSnippet: 'skip_users = true', fixedSnippet: '# a' }),
      base({ id: 'f2', file: 'b.tf', originalSnippet: 'skip_groups = true', fixedSnippet: '# b' }),
    ];
    const result = reconstructFiles(maskedFiles, findings, new Set(['f1']));
    expect(result['a.tf']).toBe('# a');
    expect(result['b.tf']).toBe('skip_groups = true');
  });

  it('returns original files unchanged when no findings are accepted', () => {
    const maskedFiles = { 'main.tf': 'original content' };
    const result = reconstructFiles(maskedFiles, [base()], new Set());
    expect(result).toEqual(maskedFiles);
  });

  it('does not mutate the input maskedFiles object', () => {
    const maskedFiles = { 'main.tf': 'skip_users = true' };
    const copy = { ...maskedFiles };
    reconstructFiles(maskedFiles, [base()], new Set(['f1']));
    expect(maskedFiles).toEqual(copy);
  });
});
