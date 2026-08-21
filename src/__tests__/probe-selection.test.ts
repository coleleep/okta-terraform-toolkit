import {
  SUB_RESOURCE_ENDPOINTS, needsResourceSample, subResourcesToProbe,
} from '../shared/constants';

describe('needsResourceSample', () => {
  it('is true only when the path has an {id} to substitute', () => {
    expect(needsResourceSample('/api/v1/iam/roles/{id}')).toBe(true);
    expect(needsResourceSample('/api/v1/iam/roles')).toBe(false);
    expect(needsResourceSample('/api/v1/meta/types/user?limit=1')).toBe(false);
  });
});

describe('subResourcesToProbe', () => {
  it('includes collection endpoints even when the org has none of that resource', () => {
    // These write probes POST to a collection path with no {id}, so they are
    // probeable in an org with zero custom roles, domains, IDPs, or log streams.
    const labels = subResourcesToProbe(new Set()).map(d => d.label);

    expect(labels).toContain('Custom Role Create (write)');
    expect(labels).toContain('Domain Create (write)');
    expect(labels).toContain('IDP Create (write)');
    expect(labels).toContain('Log Stream Create (write)');
  });

  it('excludes {id} endpoints until a sample of that parent type exists', () => {
    const labels = subResourcesToProbe(new Set()).map(d => d.label);

    expect(labels).not.toContain('Custom Role (single)');
    expect(labels).not.toContain('Policy Rules');
  });

  it('includes {id} endpoints once their parent type has a sample', () => {
    const labels = subResourcesToProbe(new Set(['customRoles'])).map(d => d.label);
    expect(labels).toContain('Custom Role (single)');
  });

  it('never returns an {id} endpoint without a usable sample', () => {
    const samples = new Set(['users']);
    for (const def of subResourcesToProbe(samples)) {
      if (needsResourceSample(def.endpoint)) {
        expect(samples.has(def.parentType)).toBe(true);
      }
    }
  });

  it('offers every sub-resource once every parent type has a sample', () => {
    const all = new Set(SUB_RESOURCE_ENDPOINTS.map(d => d.parentType));
    expect(subResourcesToProbe(all)).toHaveLength(SUB_RESOURCE_ENDPOINTS.length);
  });
});
