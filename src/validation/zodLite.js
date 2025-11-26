class ZodError extends Error {
  constructor(issues) {
    super('Validation failed');
    this.issues = issues;
  }
}

class BaseSchema {
  constructor() {
    this._optional = false;
    this._transform = null;
    this._refine = null;
  }

  optional() {
    const clone = this._clone();
    clone._optional = true;
    return clone;
  }

  transform(fn) {
    const clone = this._clone();
    clone._transform = fn;
    return clone;
  }

  refine(fn, options = {}) {
    const clone = this._clone();
    clone._refine = { fn, message: options.message || 'Invalid value' };
    return clone;
  }

  _clone() {
    const copy = Object.assign(Object.create(Object.getPrototypeOf(this)), this);
    return copy;
  }

  _applyOptional(value) {
    if (value === undefined || value === null) {
      if (this._optional) return { success: true, value: undefined };
      return { success: false, message: 'Required' };
    }
    return { success: null };
  }

  _applyTransform(value) {
    return this._transform ? this._transform(value) : value;
  }

  _applyRefine(value) {
    if (this._refine && !this._refine.fn(value)) {
      return { success: false, message: this._refine.message };
    }
    return { success: true };
  }
}

class StringSchema extends BaseSchema {
  constructor() {
    super();
    this._min = null;
    this._trim = false;
    this._email = false;
  }

  min(value) {
    const clone = this._clone();
    clone._min = value;
    return clone;
  }

  trim() {
    const clone = this._clone();
    clone._trim = true;
    return clone;
  }

  email() {
    const clone = this._clone();
    clone._email = true;
    return clone;
  }

  parse(input, path = []) {
    const optionalCheck = this._applyOptional(input);
    if (optionalCheck.success !== null) {
      return optionalCheck.success ? optionalCheck.value : this._error(optionalCheck.message, path);
    }
    if (typeof input !== 'string') {
      return this._error('Expected string', path);
    }
    let value = this._trim ? input.trim() : input;
    if (this._min !== null && value.length < this._min) {
      return this._error(`Must be at least ${this._min} characters`, path);
    }
    if (this._email && !/^\S+@\S+\.\S+$/.test(value)) {
      return this._error('Invalid email', path);
    }
    value = this._applyTransform(value);
    const refined = this._applyRefine(value);
    if (!refined.success) return this._error(refined.message, path);
    return value;
  }

  _error(message, path) {
    throw new ZodError([{ path, message }]);
  }
}

class NumberSchema extends BaseSchema {
  parse(input, path = []) {
    const optionalCheck = this._applyOptional(input);
    if (optionalCheck.success !== null) {
      return optionalCheck.success ? optionalCheck.value : this._error(optionalCheck.message, path);
    }
    const value = Number(input);
    if (!Number.isFinite(value)) {
      return this._error('Expected number', path);
    }
    const transformed = this._applyTransform(value);
    const refined = this._applyRefine(transformed);
    if (!refined.success) return this._error(refined.message, path);
    return transformed;
  }

  _error(message, path) {
    throw new ZodError([{ path, message }]);
  }
}

class BooleanSchema extends BaseSchema {
  parse(input, path = []) {
    const optionalCheck = this._applyOptional(input);
    if (optionalCheck.success !== null) {
      return optionalCheck.success ? optionalCheck.value : this._error(optionalCheck.message, path);
    }
    if (typeof input === 'boolean') return this._finalize(input, path);
    if (typeof input === 'string') {
      if (['true', 'false'].includes(input.toLowerCase())) {
        return this._finalize(input.toLowerCase() === 'true', path);
      }
    }
    return this._error('Expected boolean', path);
  }

  _finalize(value, path) {
    const transformed = this._applyTransform(value);
    const refined = this._applyRefine(transformed);
    if (!refined.success) return this._error(refined.message, path);
    return transformed;
  }

  _error(message, path) {
    throw new ZodError([{ path, message }]);
  }
}

class EnumSchema extends BaseSchema {
  constructor(values) {
    super();
    this.values = values;
  }

  parse(input, path = []) {
    const optionalCheck = this._applyOptional(input);
    if (optionalCheck.success !== null) {
      return optionalCheck.success ? optionalCheck.value : this._error(optionalCheck.message, path);
    }
    if (!this.values.includes(input)) {
      return this._error(`Expected one of: ${this.values.join(', ')}`, path);
    }
    const transformed = this._applyTransform(input);
    const refined = this._applyRefine(transformed);
    if (!refined.success) return this._error(refined.message, path);
    return transformed;
  }

  _error(message, path) {
    throw new ZodError([{ path, message }]);
  }
}

class ArraySchema extends BaseSchema {
  constructor(element) {
    super();
    this.element = element;
  }

  parse(input, path = []) {
    const optionalCheck = this._applyOptional(input);
    if (optionalCheck.success !== null) {
      return optionalCheck.success ? optionalCheck.value : this._error(optionalCheck.message, path);
    }
    if (!Array.isArray(input)) {
      return this._error('Expected array', path);
    }
    const parsed = input.map((item, idx) => this.element.parse(item, [...path, idx]));
    const transformed = this._applyTransform(parsed);
    const refined = this._applyRefine(transformed);
    if (!refined.success) return this._error(refined.message, path);
    return transformed;
  }

  _error(message, path) {
    throw new ZodError([{ path, message }]);
  }
}

class UnionSchema extends BaseSchema {
  constructor(schemas) {
    super();
    this.schemas = schemas;
  }

  parse(input, path = []) {
    const optionalCheck = this._applyOptional(input);
    if (optionalCheck.success !== null) {
      return optionalCheck.success ? optionalCheck.value : this._error(optionalCheck.message, path);
    }
    for (const schema of this.schemas) {
      try {
        return schema.parse(input, path);
      } catch (err) {
        // continue
      }
    }
    return this._error('No union variant matched', path);
  }

  _error(message, path) {
    throw new ZodError([{ path, message }]);
  }
}

class ObjectSchema extends BaseSchema {
  constructor(shape) {
    super();
    this.shape = shape;
  }

  extend(shape) {
    return new ObjectSchema({ ...this.shape, ...shape });
  }

  partial() {
    const shape = Object.fromEntries(
      Object.entries(this.shape).map(([key, schema]) => [key, schema.optional()])
    );
    return new ObjectSchema(shape);
  }

  parse(input, path = []) {
    const optionalCheck = this._applyOptional(input);
    if (optionalCheck.success !== null) {
      return optionalCheck.success ? optionalCheck.value : this._error(optionalCheck.message, path);
    }
    if (typeof input !== 'object' || input === null || Array.isArray(input)) {
      return this._error('Expected object', path);
    }
    const result = {};
    for (const [key, schema] of Object.entries(this.shape)) {
      result[key] = schema.parse(input[key], [...path, key]);
    }
    const transformed = this._applyTransform(result);
    const refined = this._applyRefine(transformed);
    if (!refined.success) return this._error(refined.message, path);
    return transformed;
  }

  _error(message, path) {
    throw new ZodError([{ path, message }]);
  }
}

const z = {
  string: () => new StringSchema(),
  number: () => new NumberSchema(),
  boolean: () => new BooleanSchema(),
  enum: values => new EnumSchema(values),
  array: schema => new ArraySchema(schema),
  union: schemas => new UnionSchema(schemas),
  object: shape => new ObjectSchema(shape)
};

module.exports = { z, ZodError };
