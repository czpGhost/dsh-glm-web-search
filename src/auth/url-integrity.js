export const REQUIRED_AUTHORIZE_PARAMS = ['client_id', 'redirect_uri', 'response_type', 'state'];

export function checkAuthorizeUrl(url, required = REQUIRED_AUTHORIZE_PARAMS) {
  if (typeof url !== 'string' || url.length === 0) {
    return { ok: false, missing: [...required] };
  }

  const query = url.includes('?') ? url.slice(url.indexOf('?') + 1) : '';
  const present = new Set(
    query
      .split('&')
      .map((part) => part.split('=')[0].trim())
      .filter((name) => name.length > 0),
  );

  const missing = required.filter((name) => !present.has(name));
  return { ok: missing.length === 0, missing };
}

export function looksTruncated(url, required = REQUIRED_AUTHORIZE_PARAMS) {
  const { ok, missing } = checkAuthorizeUrl(url, required);
  if (ok) return false;
  const keptFirst = !missing.includes(required[0]);
  return keptFirst && missing.length === required.length - 1;
}
