import { ZCODE_DEFAULT_ORIGIN } from '../gateway/protocol-constants.js';

export const TOKEN_TTL_MS = 60 * 60 * 1000;

let fallbackDeviceMid;

export class BillingError extends Error {
  constructor(message, options = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'BillingError';
    this.code = options.code ?? 'BILLING_ERROR';
    if (options.businessCode !== undefined) this.businessCode = options.businessCode;
  }
}

export async function fetchBilling(options = {}) {
  const {
    token,
    origin = ZCODE_DEFAULT_ORIGIN,
    appVersion,
    fetchImpl = globalThis.fetch,
    timeoutMs = 20_000,
    signal,
    deviceMid,
  } = options;

  if (!token) throw new BillingError('no credential is stored', { code: 'ZAI_CREDENTIAL_MISSING' });

  const base = origin.replace(/\/+$/, '');
  const query = appVersion ? `?app_version=${encodeURIComponent(appVersion)}` : '';
  const timeout = AbortSignal.timeout(timeoutMs);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;

  let response;
  try {
    response = await fetchImpl(`${base}/api/v1/zcode-plan/billing/balance${query}`, {
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${token}`,
        'x-device-mid': deviceMid || (fallbackDeviceMid ??= crypto.randomUUID()),
        ...(appVersion
          ? {
              'user-agent': `ZCode/${appVersion}`,
              'x-zcode-app-version': appVersion,
              'x-title': 'Z Code@electron',
            }
          : {}),
      },
      signal: combined,
    });
  } catch (error) {
    throw new BillingError(
      `could not reach the Z.AI billing endpoint: ${error instanceof Error ? error.message : String(error)}`,
      { code: 'BILLING_UNREACHABLE', cause: error },
    );
  }

  if (response.status === 401) {
    throw new BillingError('the Z.AI credential is no longer valid', {
      code: 'ZAI_UNAUTHENTICATED',
      businessCode: 401,
    });
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new BillingError(`the billing endpoint returned HTTP ${response.status} with no JSON body`, {
      code: 'BILLING_MALFORMED',
    });
  }

  const businessCode = typeof payload?.code === 'number' ? payload.code : undefined;
  if (businessCode === 1006) {
    throw new BillingError('the Z.AI credential is no longer valid', {
      code: 'ZAI_UNAUTHENTICATED',
      businessCode,
    });
  }
  if (businessCode !== undefined && businessCode !== 0) {
    throw new BillingError(payload?.msg || `billing lookup failed (code ${businessCode})`, {
      code: 'BILLING_UPSTREAM_ERROR',
      businessCode,
    });
  }
  if (!response.ok) {
    throw new BillingError(`the billing endpoint returned HTTP ${response.status}`, {
      code: 'BILLING_UPSTREAM_ERROR',
    });
  }

  const plans = (payload?.data?.plans ?? []).map((plan) => ({
    name: plan.name ?? plan.plan_id ?? 'unknown',
    planId: plan.plan_id,
    status: plan.status,
    description: plan.description,
    ...(Number.isFinite(plan.ends_at) ? { endsAt: plan.ends_at * 1000 } : {}),
    ...(Number.isFinite(plan.starts_at) ? { startsAt: plan.starts_at * 1000 } : {}),
    entitlements: (plan.entitlements ?? []).map((entry) => ({
      showName: entry.show_name ?? '',
      period: entry.period ?? '',
      unitType: entry.unit_type ?? '',
      grantUnits: Number(entry.grant_units ?? 0),
      ...(entry.entitlement_id ? { entitlementId: entry.entitlement_id } : {}),
    })),
  }));

  const balances = (payload?.data?.balances ?? []).map((entry) => ({
    name: entry.show_name ?? 'unknown',
    remaining: Number(entry.remaining_units ?? 0),
    total: Number(entry.total_units ?? 0),
    used: Number(entry.used_units ?? 0),
    ...(entry.plan_id ? { planId: entry.plan_id } : {}),
    ...(entry.entitlement_id ? { entitlementId: entry.entitlement_id } : {}),
    ...(Number.isFinite(entry.expires_at) ? { expiresAt: entry.expires_at * 1000 } : {}),
    ...(Number.isFinite(entry.period_end) ? { periodEnd: entry.period_end * 1000 } : {}),
    ...(Number.isFinite(entry.period_start) ? { periodStart: entry.period_start * 1000 } : {}),
  }));

  return {
    plans,
    balances,
    ...(Number.isFinite(payload?.data?.server_time)
      ? { serverTime: payload.data.server_time * 1000 }
      : {}),
  };
}

export function formatDuration(ms) {
  if (!Number.isFinite(ms)) return 'unknown';
  const past = ms < 0;
  const total = Math.abs(ms);
  const minutes = Math.floor(total / 60_000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  let text;
  if (days >= 1) text = `${days}d ${hours % 24}h`;
  else if (hours >= 1) text = `${hours}h ${minutes % 60}m`;
  else text = `${minutes}m`;

  return past ? `${text} ago` : `in ${text}`;
}

export function describeBilling(billing, now = Date.now()) {
  const lines = [];

  if (billing.plans.length === 0) {
    lines.push('Plan: none reported for this account.');
  }
  for (const plan of billing.plans) {
    const expiry = plan.endsAt === undefined
      ? 'no expiry reported'
      : `expires ${new Date(plan.endsAt).toLocaleString()} (${formatDuration(plan.endsAt - now)})`;
    lines.push(`Plan: ${plan.name} [${plan.status ?? 'unknown'}] - ${expiry}`);
  }

  for (const balance of billing.balances) {
    const when = balance.periodEnd !== undefined
      ? `, resets ${formatDuration(balance.periodEnd - now)}`
      : balance.expiresAt !== undefined
        ? `, expires ${formatDuration(balance.expiresAt - now)}`
        : '';
    lines.push(`Quota: ${balance.name} ${balance.remaining.toLocaleString()}/${balance.total.toLocaleString()}${when}`);
  }

  return lines;
}
