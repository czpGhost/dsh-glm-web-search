const FILLED = '\u2588';
const EMPTY = '\u2591';

const LABEL = 9;

const NAME = 14;

export function bar(value, total, width = 10) {
  const ratio = total > 0 ? Math.max(0, Math.min(1, value / total)) : 0;
  const filled = Math.round(ratio * width);
  return FILLED.repeat(filled) + EMPTY.repeat(Math.max(0, width - filled));
}

export function percent(value, total) {
  if (!(total > 0)) return 0;
  return Math.round((value / total) * 100);
}

export function tokens(value) {
  const n = Number(value) || 0;
  if (n >= 1e9) return `${trimNumber(n / 1e9)}B`;
  if (n >= 1e6) return `${trimNumber(n / 1e6)}M`;
  if (n >= 1e3) return `${trimNumber(n / 1e3)}K`;
  return String(Math.round(n));
}

function trimNumber(x) {
  const rounded = Math.round(x * 100) / 100;
  if (Number.isInteger(rounded)) return String(rounded);
  return String(rounded).replace(/0+$/, '').replace(/\.$/, '');
}

export function countdown(ms) {
  if (!Number.isFinite(ms)) return 'unknown';
  if (ms <= 0) return 'now';
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${totalSeconds}s`;
}

export function stamp(ms) {
  if (!Number.isFinite(ms)) return 'unknown';
  const d = new Date(ms);
  const pad2 = (n) => String(n).padStart(2, '0');
  return `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export function pad(label, width) {
  const text = String(label);
  return text.length >= width ? text : text + ' '.repeat(width - text.length);
}

function row(label, value) {
  return `${pad(label, LABEL)}${value}`;
}

export function join(segments) {
  return segments
    .filter((part) => part !== undefined && part !== null && part !== '')
    .join(' \u00b7 ');
}

export function summary(segments) {
  return join(segments);
}

function tokenCell(state, now) {
  if (!state.configured) return 'not configured';
  if (state.tokenExpiresAt === undefined) return 'present';
  if (state.tokenExpired) return 'EXPIRED — run login';
  const left = state.tokenExpiresAt - now;
  return left < 10 * 60_000 ? `expires in ${countdown(left)} — renew soon` : `valid ${countdown(left)}`;
}

function quotaCell(quota, now, owner) {
  const left = percent(quota.remaining, quota.total);
  const reset = quota.periodEnd ?? quota.expiresAt;
  const amount = `${tokens(quota.remaining)}/${tokens(quota.total)}`;

  const meter = left === 100
    ? `${bar(quota.remaining, quota.total)} full     `
    : `${bar(quota.remaining, quota.total)} ${String(left).padStart(3)}%  ${pad(amount, 10)}`;

  const from = owner ? `  <- ${owner}` : '';
  return `${pad(quota.name, NAME)} ${meter}`
    + (reset !== undefined ? ` resets ${countdown(reset - now)}` : '')
    + from;
}

export function statusView({ state, billing, error, now = Date.now() }) {
  const lines = [];

  if (state.configured) {
    lines.push(row('account', state.email ?? '(email unknown)'));
    lines.push(row('', `token ${tokenCell(state, now)}`));
  } else {
    lines.push(row('account', 'not signed in — run login'));
  }

  if (billing) {
    const heldPlans = billing.plans ?? [];
    const buckets = billing.balances ?? [];
    if (heldPlans.length > 0) {
      lines.push('');
      let first = true;
      for (const plan of heldPlans) {
        const ends = plan.endsAt !== undefined
          ? ` · ends ${stamp(plan.endsAt)} (${countdown(plan.endsAt - now)})`
          : '';
        lines.push(row(first ? 'plan' : '', `${plan.name}${plan.status ? ` [${plan.status}]` : ''}${ends}`));

        const bucketEntitlements = new Set(
          buckets.map((bucket) => bucket.entitlementId).filter(Boolean),
        );
        const bucketNames = new Set(buckets.map((bucket) => bucket.name));
        for (const grant of plan.entitlements ?? []) {
          const covered = grant.entitlementId
            ? bucketEntitlements.has(grant.entitlementId)
            : bucketNames.has(grant.showName);
          if (covered) continue;
          const period = grant.period === 'one_time' ? 'one-time' : grant.period;
          lines.push(row('', `${pad('', LABEL)}${grant.showName} ${tokens(grant.grantUnits)} (${period})`));
        }
        first = false;
      }
    }

    const ownerOf = (quota) => {
      if (heldPlans.length < 2) return '';
      const owner = heldPlans.find((plan) => plan.planId && plan.planId === quota.planId);
      return owner ? shortPlanName(owner.name) : '';
    };
    for (const quota of buckets) {
      lines.push(row('quota', quotaCell(quota, now, ownerOf(quota))));
    }

    const cycle = describeCycle(buckets, heldPlans);
    if (cycle) lines.push(row('cycle', cycle));
  } else if (error) {
    lines.push('');
    lines.push(row('plan', `unavailable — ${error}`));
  }

  return lines.join('\n');
}

export function statusSummary({ state, billing, error, now = Date.now() }) {
  if (!state.configured) return 'not signed in';

  const parts = [];

  if (state.tokenExpired) parts.push('token EXPIRED');
  else if (state.tokenExpiresAt !== undefined) parts.push(`token ${countdown(state.tokenExpiresAt - now)}`);

  if (billing) {
    const plans = billing.plans ?? [];

    if (plans.length === 1) {
      parts.push(shortPlanName(plans[0].name));
    } else if (plans.length === 2) {
      parts.push(plans.map((plan) => shortPlanName(plan.name)).join(' + '));
    } else if (plans.length > 2) {
      parts.push(`${plans.length} plans`);
    }

    const tightest = billing.balances
      .map((q) => ({ ...q, ratio: q.total > 0 ? q.remaining / q.total : 1 }))
      .sort((a, b) => a.ratio - b.ratio)[0];
    if (tightest) {
      const left = percent(tightest.remaining, tightest.total);
      parts.push(`${tightest.name} ${tokens(tightest.remaining)} left${left <= 20 ? ' LOW' : ''}`);
      const reset = tightest.periodEnd ?? tightest.expiresAt;
      if (reset !== undefined) parts.push(`resets ${countdown(reset - now)}`);
    }
  } else if (error) {
    parts.push('plan unavailable');
  }

  return join(parts);
}

function shortPlanName(name) {
  const text = String(name ?? '').trim();
  return text.startsWith('ZCode ') ? text.slice('ZCode '.length) : text;
}

function describeCycle(buckets, plans) {
  if (buckets.length === 0) return '';

  const windows = buckets
    .filter((bucket) => bucket.periodEnd !== undefined)
    .map((bucket) => ({ start: bucket.periodStart, end: bucket.periodEnd }));
  if (windows.length === 0) {
    const ends = plans.map((plan) => plan.endsAt).filter((value) => value !== undefined);
    return ends.length > 0
      ? `one-time grant, expires with the plan (${stamp(Math.min(...ends))})`
      : 'one-time grant, no refill';
  }

  const span = (windows[0].end - (windows[0].start ?? windows[0].end - 86_400_000)) / 1000;
  const hours = span / 3600;
  if (Math.abs(hours - 24) < 0.01) return 'daily grant, refills at 00:00 Asia/Shanghai';
  if (Math.abs(hours - 1) < 0.01) return 'hourly grant, refills on the hour';
  if (Math.abs(hours - 168) < 0.01) return 'weekly grant, refills weekly';
  return `grant refills every ${(hours / 24).toFixed(1)} days`;
}

export function loginView({ flow, opened }) {
  const lines = [];
  lines.push(row('browser', opened
    ? 'opened the authorization page'
    : 'open this URL and approve access:'));
  if (!opened) {
    lines.push('');
    lines.push(`  ${flow.authorizeUrl}`);
  }
  lines.push('');
  lines.push(row('next', 'the token stores itself once you approve'));
  return lines.join('\n');
}

export function logoutView({ configured, source }) {
  if (!configured) return 'No stored Z.AI credential to remove.';
  return [
    row('removed', source),
    '',
    'web_search, web_fetch and zai_vision now report a missing credential',
    'sign in again with: /dsh-glm-web-search login',
  ].join('\n');
}
