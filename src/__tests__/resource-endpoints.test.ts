import {
  RESOURCE_DICTIONARY, effectiveEndpoint, searchResources,
} from '../shared/resource-dictionary';

describe('effectiveEndpoint', () => {
  it('maps okta_user to the users bucket — the regression that produced okta_app_user', () => {
    const user = RESOURCE_DICTIONARY.find(r => r.terraformResource === 'okta_user')!;
    expect(user.primaryEndpoint).toBeUndefined(); // no explicit mapping, by design

    const resolved = effectiveEndpoint(user);
    expect(resolved).toEqual({
      primaryEndpoint: '/api/v1/users',
      endpointLabel: 'Users',
    });
  });

  it('prefers an explicit sub-resource mapping over the parent derivation', () => {
    const appUser = RESOURCE_DICTIONARY.find(r => r.terraformResource === 'okta_app_user')!;
    const resolved = effectiveEndpoint(appUser);

    // must NOT collapse to the parent /api/v1/apps bucket
    expect(resolved).toEqual({
      primaryEndpoint: '/api/v1/apps/<id>/users',
      endpointLabel: 'App User Assignments',
    });
  });

  it('strips the query string from the derived endpoint', () => {
    const group = RESOURCE_DICTIONARY.find(r => r.terraformResource === 'okta_group')!;
    expect(effectiveEndpoint(group)?.primaryEndpoint).not.toContain('?');
  });

  it('resolves an endpoint for every resource in the dictionary', () => {
    const unresolved = RESOURCE_DICTIONARY
      .filter(r => effectiveEndpoint(r) === null)
      .map(r => r.terraformResource);

    // A null here means a parentType with no RESOURCE_TYPES entry, which would
    // silently hide the resource from workload entry and the AI's table.
    expect(unresolved).toEqual([]);
  });

  it('keeps okta_user findable by search, since that is how a user reaches it', () => {
    const hits = searchResources('okta_user').map(r => r.terraformResource);
    expect(hits).toContain('okta_user');
  });
});
