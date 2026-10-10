import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { ZaiError } from '../gateway/client.js';
import { FALLBACK_VISION_MODEL } from '../gateway/protocol-constants.js';

export const VISION_THINKING_BUDGET = 4000;

const MEDIA_TYPES = new Map([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
  ['.webp', 'image/webp'],
]);

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export const DEFAULT_VISION_PROMPT =
  'Describe this image in detail, and transcribe any text it contains.';

const VISION_DIRECTIVE =
  'An image is attached directly to the user turn and is visible to you in full. '
  + 'Answer from the attached image itself. Never reply that you cannot view images, '
  + 'cannot access external URLs, or need the image re-sent — the image is already here.';

export async function describeImage(options) {
  const { client, image, prompt, signal } = options;

  const imageBlock = await buildImageBlock(image);
  const body = {
    model: options.model ?? (await client.resolveModel({ requireVision: true })) ?? FALLBACK_VISION_MODEL,
    max_tokens: options.maxTokens ?? 2048,
    stream: false,
    system: client.identitySystem({ type: 'text', text: VISION_DIRECTIVE }),
    messages: [{
      role: 'user',
      content: [
        imageBlock,
        { type: 'text', text: prompt?.trim() || DEFAULT_VISION_PROMPT },
      ],
    }],
    thinking: { type: 'enabled', budget_tokens: VISION_THINKING_BUDGET },
  };

  const payload = await client.request(body, 'vision', signal);

  const blocks = Array.isArray(payload.content) ? payload.content : [];
  const answer = blocks
    .filter((block) => block?.type === 'text')
    .map((block) => String(block.text ?? ''))
    .join('')
    .trim();

  if (answer.length === 0) {
    throw new ZaiError('the vision request returned no description', { code: 'ZAI_EMPTY_RESULT' });
  }

  return {
    text: answer,
    model: body.model,
    usage: {
      ...(Number.isFinite(payload?.usage?.input_tokens) ? { inputTokens: payload.usage.input_tokens } : {}),
      ...(Number.isFinite(payload?.usage?.output_tokens) ? { outputTokens: payload.usage.output_tokens } : {}),
    },
  };
}

async function buildImageBlock(image) {
  const value = String(image ?? '').trim();
  if (value.length === 0) {
    throw new ZaiError('an image URL or path is required', { code: 'ZAI_INVALID_IMAGE' });
  }

  if (isHttpUrl(value)) {
    return { type: 'image', source: { type: 'url', url: value } };
  }

  const mediaType = MEDIA_TYPES.get(extname(value).toLowerCase());
  if (!mediaType) {
    throw new ZaiError(
      `"${value}" is neither an HTTP(S) URL nor a supported image file (${[...MEDIA_TYPES.keys()].join(', ')})`,
      { code: 'ZAI_INVALID_IMAGE' },
    );
  }

  let bytes;
  try {
    bytes = await readFile(value);
  } catch (error) {
    throw new ZaiError(
      `the image could not be read: ${error instanceof Error ? error.message : String(error)}`,
      { code: 'ZAI_INVALID_IMAGE', cause: error },
    );
  }
  if (bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new ZaiError(
      `the image is ${Math.round(bytes.byteLength / 1024 / 1024)} MiB, over the ${MAX_IMAGE_BYTES / 1024 / 1024} MiB limit`,
      { code: 'ZAI_IMAGE_TOO_LARGE' },
    );
  }

  return {
    type: 'image',
    source: { type: 'base64', media_type: mediaType, data: bytes.toString('base64') },
  };
}

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}
