const SCHEMA_MARKER = Symbol.for('schemastery');

function describePath(path) {
  return path.length > 0 ? path.join('.') : '(root)';
}

function field(kind, options = {}) {
  const meta = {};
  if (options.defaultValue !== undefined) meta.default = options.defaultValue;
  if (options.min !== undefined) meta.min = options.min;
  if (options.integer === true) meta.integer = true;
  if (options.optional === true) meta.required = false;
  if (options.description !== undefined) meta.description = options.description;

  return {
    type: kind,
    meta,
    [SCHEMA_MARKER]: true,
    optional: options.optional === true,
    defaultValue: options.defaultValue,
    role: options.role,
  };
}

export function string(options = {}) {
  return field('string', options);
}

export function number(options = {}) {
  return field('number', options);
}

export function boolean(options = {}) {
  return field('boolean', options);
}

function validateField(spec, raw, path, issues) {
  if (raw === undefined) {
    if (spec.defaultValue !== undefined) return spec.defaultValue;
    if (spec.optional) return undefined;
    issues.push({ message: `${describePath(path)} is required`, path });
    return undefined;
  }

  if (typeof raw !== spec.type) {
    issues.push({ message: `${describePath(path)} must be a ${spec.type}`, path });
    return undefined;
  }

  if (spec.type === 'number') {
    if (spec.meta.integer && !Number.isSafeInteger(raw)) {
      issues.push({ message: `${describePath(path)} must be an integer`, path });
      return undefined;
    }
    if (spec.meta.min !== undefined && raw < spec.meta.min) {
      issues.push({ message: `${describePath(path)} must be at least ${spec.meta.min}`, path });
      return undefined;
    }
  }

  return raw;
}

export function object(fields, options = {}) {
  const dict = {};
  for (const [key, spec] of Object.entries(fields)) {
    dict[key] = spec;
    if (options.descriptions?.[key] !== undefined && dict[key].meta.description === undefined) {
      dict[key].meta.description = options.descriptions[key];
    }
  }

  const schema = {
    type: 'object',
    meta: {
      default: {},
      ...(options.description !== undefined ? { description: options.description } : {}),
    },
    dict,
    [SCHEMA_MARKER]: true,
    '~standard': {
      version: 1,
      vendor: 'schemastery',
      validate(raw) {
        const input = raw === undefined || raw === null ? {} : raw;
        if (typeof input !== 'object' || Array.isArray(input)) {
          return { issues: [{ message: 'config must be an object', path: [] }] };
        }

        const issues = [];
        const value = {};
        for (const [key, spec] of Object.entries(fields)) {
          const resolved = validateField(spec, input[key], [key], issues);
          if (resolved !== undefined) value[key] = resolved;
        }

        for (const key of Object.keys(input)) {
          if (!(key in fields)) {
            issues.push({ message: `unknown field "${key}"`, path: [key] });
          }
        }

        return issues.length > 0 ? { issues } : { value };
      },
    },
  };
  return schema;
}

export default { object, string, number, boolean };
