import {
  SUPPORTED_VERSIONS,
  DEFAULT_VERSION,
  VERSION_RESOURCE_ADDITIONS,
  VERSION_ATTRIBUTE_NOTES,
  getAdditionsForVersion,
  isAvailableIn,
} from '../shared/versions';
import { RESOURCE_DICTIONARY } from '../shared/resource-dictionary';

describe('v6.12.0 version registration', () => {
  it('includes 6.12.0 in SUPPORTED_VERSIONS', () => {
    expect(SUPPORTED_VERSIONS).toContain('6.12.0');
  });

  it('sets DEFAULT_VERSION to 6.12.0', () => {
    expect(DEFAULT_VERSION).toBe('6.12.0');
  });

  it('isAvailableIn returns true for 6.12.0 in 6.12.0', () => {
    expect(isAvailableIn('6.12.0', '6.12.0')).toBe(true);
  });

  it('isAvailableIn returns false for 6.12.0 in 6.11.0', () => {
    expect(isAvailableIn('6.12.0', '6.11.0')).toBe(false);
  });
});
