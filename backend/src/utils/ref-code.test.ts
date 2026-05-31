import { describe, it } from 'node:test';
import assert from 'node:assert';
import { generateRefCode } from './ref-code.js';

describe('generateRefCode', () => {
  it('returns 12 alphanumeric characters from safe alphabet', () => {
    const code = generateRefCode(12);
    assert.strictEqual(code.length, 12);
    assert.match(code, /^[A-Z2-9]+$/);
  });
});
