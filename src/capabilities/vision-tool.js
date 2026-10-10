import { ZaiError } from '../gateway/client.js';
import { DEFAULT_VISION_PROMPT, describeImage } from './image-analysis.js';

export const VISION_TOOL_NAME = 'zai_vision';
const VISION_TIMEOUT_MS = 90_000;

const VISION_PARAMETERS = {
  type: 'object',
  properties: {
    image: {
      type: 'string',
      description: 'Public image URL, or a path to a local image file.',
    },
    prompt: {
      type: 'string',
      description: `What to ask about the image. Defaults to "${DEFAULT_VISION_PROMPT}".`,
    },
  },
  required: ['image'],
};

const VISION_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    text: { type: 'string' },
    model: { type: 'string' },
    usage: {
      type: 'object',
      additionalProperties: false,
      properties: {
        inputTokens: { type: 'integer' },
        outputTokens: { type: 'integer' },
      },
    },
  },
  required: ['text'],
};

function checkArgs(args) {
  if (typeof args !== 'object' || args === null || Array.isArray(args)) {
    return 'arguments must be an object';
  }
  for (const key of VISION_PARAMETERS.required) {
    if (typeof args[key] !== 'string' || args[key].trim().length === 0) {
      return `missing required property "${key}"`;
    }
  }
  if (args.prompt !== undefined && typeof args.prompt !== 'string') {
    return '"prompt" must be a string';
  }
  return undefined;
}

export function registerVisionTool(ctx, options) {
  const { client } = options;

  ctx.tools.register({
    name: VISION_TOOL_NAME,
    timeoutMs: VISION_TIMEOUT_MS,
    description:
      'Analyze an image with Z.AI vision: describe it, transcribe its text, or answer a question about it. Accepts a public image URL or a local image file path (.png, .jpg, .jpeg, .gif, .webp).',
    parameters: VISION_PARAMETERS,
    output: {
      schema: VISION_OUTPUT_SCHEMA,
      render: (_args, value) => [{ type: 'text', text: value.text }],
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const violation = checkArgs(args);
      if (violation !== undefined) {
        throw new ZaiError(`invalid arguments: ${violation}`, { code: 'INVALID_ARGS' });
      }
      return describeImage({
        client,
        image: args.image,
        prompt: args.prompt,
        signal: exec.signal,
      });
    },
    presentCall: (args) => ({
      card: 'generic',
      title: 'Analyze image',
      kind: 'read',
      rawInput: args.image,
    }),
    presentResult: (_args, result) => {
      if (result.isError) return undefined;
      return { card: 'generic', title: 'Image analysis' };
    },
  });
}

export { ZaiError };
