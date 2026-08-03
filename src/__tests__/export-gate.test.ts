import { validateForExport, analyzeProject } from '../main/api/validator';

type AnalyzeFn = typeof analyzeProject;

describe('validateForExport', () => {
  const mockAnalyze = jest.fn<ReturnType<AnalyzeFn>, Parameters<AnalyzeFn>>();

  beforeEach(() => mockAnalyze.mockReset());

  test('returns findings from analyzeProject', async () => {
    mockAnalyze.mockResolvedValue({
      findings: [{
        id: 'f1',
        category: 'correctness',
        severity: 'error',
        file: 'main.tf',
        resourceAddress: 'okta_user.u',
        title: 'bad attribute',
        explanation: 'bad attribute explanation',
        originalSnippet: '',
        fixedSnippet: '',
      }],
      fixedMaskedFiles: {},
    });
    const files = { 'main.tf': 'resource "okta_user" "u" {}' };
    const result = await validateForExport(files, '6.13.0', mockAnalyze);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].severity).toBe('error');
    expect(result.error).toBeUndefined();
  });

  test('returns empty findings array on analyzeProject error (no throw)', async () => {
    mockAnalyze.mockRejectedValue(new Error('API unavailable'));
    const files = { 'main.tf': 'resource "okta_user" "u" {}' };
    const result = await validateForExport(files, '6.13.0', mockAnalyze);
    expect(result.findings).toEqual([]);
    expect(result.error).toBeTruthy();
  });

  test('returns empty findings for empty files object', async () => {
    mockAnalyze.mockResolvedValue({ findings: [], fixedMaskedFiles: {} });
    const result = await validateForExport({}, '6.13.0', mockAnalyze);
    expect(result.findings).toEqual([]);
    expect(mockAnalyze).not.toHaveBeenCalled();
  });
});
