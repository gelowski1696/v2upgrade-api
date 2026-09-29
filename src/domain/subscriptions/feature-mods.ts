export const FEATURE_MOD_KEYS = [
  'cashAdvance',
  'attendanceCapture',
  'customerImport',
  'dueReminders',
  'posQuickOrders',
  'customerInactivityRules',
  'paymentReferenceTracking',
  'personnelTankCommission',
  'inventoryReportPrinting',
  'taskReminders',
  'customerGroups',
  'loyaltyPoints',
  'scheduledDeliveries',
  'pettyCashReceivables',
  'specialReceipts',
  'customerReport',
  'summaryCsv',
  'financialReport',
  'purchases',
  'discountReport',
] as const;

export type FeatureModKey = (typeof FEATURE_MOD_KEYS)[number];
export type FeatureMods = Partial<Record<FeatureModKey, boolean>>;

const featureModKeys = new Set<string>(FEATURE_MOD_KEYS);

export function validateFeatureMods(
  value: Record<string, unknown>,
): FeatureMods {
  const result: FeatureMods = {};
  for (const [key, enabled] of Object.entries(value)) {
    if (!featureModKeys.has(key)) {
      throw new Error(`Unknown feature mod: ${key}.`);
    }
    if (typeof enabled !== 'boolean') {
      throw new Error(`Feature mod ${key} must be true or false.`);
    }
    result[key as FeatureModKey] = enabled;
  }
  return result;
}

export function featureModsFromEntitlements(
  entitlements: Record<string, unknown>,
): FeatureMods {
  const result: FeatureMods = {};
  for (const key of FEATURE_MOD_KEYS) {
    const enabled = entitlements[key];
    if (typeof enabled === 'boolean') result[key] = enabled;
  }
  return result;
}

export function webDashboardEnabled(entitlements: unknown): boolean {
  if (
    !entitlements ||
    typeof entitlements !== 'object' ||
    Array.isArray(entitlements)
  ) {
    return true;
  }
  return (entitlements as Record<string, unknown>)['webDashboard'] !== false;
}
