import {
  featureModsFromEntitlements,
  validateFeatureMods,
  webDashboardEnabled,
} from './feature-mods.js';

describe('subscription entitlements', () => {
  it('keeps legacy web dashboard access enabled until explicitly disabled', () => {
    expect(webDashboardEnabled({})).toBe(true);
    expect(webDashboardEnabled({ webDashboard: true })).toBe(true);
    expect(webDashboardEnabled({ webDashboard: false })).toBe(false);
  });

  it('returns only recognized boolean feature mods', () => {
    expect(
      featureModsFromEntitlements({
        reports: true,
        summaryCsv: true,
        discountReport: false,
      }),
    ).toEqual({ summaryCsv: true, discountReport: false });
    expect(() => validateFeatureMods({ unknownFeature: true })).toThrow(
      'Unknown feature mod',
    );
  });
});
