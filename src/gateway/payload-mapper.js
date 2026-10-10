export function mapSearchResults(payload) {
  const items = Array.isArray(payload) ? payload : [];
  const sources = [];
  let dropped = 0;

  for (const item of items) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      dropped += 1;
      continue;
    }
    const url = pickUrl(item);
    if (!url) {
      dropped += 1;
      continue;
    }
    const source = { url };
    const title = pickString(item.title);
    if (title) source.title = title;
    const snippet = pickString(item.content) ?? pickString(item.snippet) ?? pickString(item.media);
    if (snippet) source.snippet = snippet;
    const publishedAt = pickString(item.publish_date) ?? pickString(item.publishDate);
    if (publishedAt) source.publishedAt = publishedAt;
    sources.push(source);
  }

  return { sources, dropped };
}

function pickUrl(item) {
  const candidate =
    pickString(item.link) ?? pickString(item.url) ?? pickString(item.href);
  return pickAbsolute(candidate);
}

export function mapReaderResult(payload, requestedUrl) {
  const record = unwrapReaderPayload(payload);
  const content = pickString(record.content) ?? pickString(record.text) ?? '';
  const url = pickAbsolute(pickString(record.url)) ?? requestedUrl;
  const title = pickString(record.title);

  const body = title ? `# ${title}\n\n${content}` : content;

  return {
    url,
    statusCode: 200,
    body: { kind: 'text', content: body },
    truncated: false,
  };
}

function unwrapReaderPayload(payload) {
  if (Array.isArray(payload)) {
    const first = payload.find((entry) => entry && typeof entry === 'object' && !Array.isArray(entry));
    return first ?? {};
  }
  if (payload && typeof payload === 'object') return payload;
  return {};
}

function pickAbsolute(value) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}

function pickString(value) {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
