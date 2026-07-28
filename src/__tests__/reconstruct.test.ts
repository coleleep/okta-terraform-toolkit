import { reconstructFiles, computeDiffLines, DiffLine } from '../shared/reconstruct';
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

describe('computeDiffLines', () => {
  it('shows accepted finding as removed + added lines, context around it', () => {
    const file = 'line1\noriginal\nline3\n';
    const f = base({ originalSnippet: 'original', fixedSnippet: 'fixed' });
    const lines = computeDiffLines(file, [f], new Set(['f1']));

    expect(lines).toContainEqual({ type: 'context', text: 'line1', lineNo: 1 });
    expect(lines).toContainEqual({ type: 'removed', text: 'original', lineNo: 2 });
    expect(lines).toContainEqual({ type: 'added', text: 'fixed' });
    expect(lines).toContainEqual({ type: 'context', text: 'line3', lineNo: 3 });
  });

  it('shows rejected finding as unchanged context', () => {
    const file = 'line1\noriginal\nline3\n';
    const f = base({ originalSnippet: 'original', fixedSnippet: 'fixed' });
    const lines = computeDiffLines(file, [f], new Set());

    const types = lines.map(l => l.type);
    expect(types).not.toContain('removed');
    expect(types).not.toContain('added');
    expect(lines).toContainEqual({ type: 'context', text: 'original', lineNo: 2 });
  });

  it('collapses unchanged runs longer than 5 lines', () => {
    const file = Array.from({ length: 10 }, (_, i) => `ctx${i}`).join('\n') + '\noriginal\n';
    const f = base({ originalSnippet: 'original', fixedSnippet: 'fixed' });
    const lines = computeDiffLines(file, [f], new Set(['f1']));

    const collapsed = lines.filter(l => l.type === 'collapsed');
    expect(collapsed.length).toBeGreaterThan(0);
    const total = (collapsed[0] as Extract<DiffLine, { type: 'collapsed' }>).count;
    expect(total).toBeGreaterThan(0);
  });

  it('handles a multi-line originalSnippet and fixedSnippet', () => {
    const file = 'before\nfoo = true\nbar = true\nafter\n';
    const f = base({
      originalSnippet: 'foo = true\nbar = true',
      fixedSnippet: '# removed foo\n# removed bar',
    });
    const lines = computeDiffLines(file, [f], new Set(['f1']));

    expect(lines).toContainEqual({ type: 'removed', text: 'foo = true', lineNo: 2 });
    expect(lines).toContainEqual({ type: 'removed', text: 'bar = true', lineNo: 3 });
    expect(lines).toContainEqual({ type: 'added', text: '# removed foo' });
    expect(lines).toContainEqual({ type: 'added', text: '# removed bar' });
  });

  it('returns only context lines when no findings are present', () => {
    const file = 'a\nb\nc\n';
    const lines = computeDiffLines(file, [], new Set());
    expect(lines.every(l => l.type === 'context')).toBe(true);
    expect(lines).toHaveLength(3);
  });

  it('skips a finding whose originalSnippet is not found in the file', () => {
    const file = 'line1\nline2\n';
    const f = base({ originalSnippet: 'not present', fixedSnippet: 'fixed' });
    const lines = computeDiffLines(file, [f], new Set(['f1']));
    expect(lines.every(l => l.type === 'context')).toBe(true);
  });
});
