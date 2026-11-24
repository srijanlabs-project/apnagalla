import { describe, expect, it } from 'vitest';
import { areaQty, dimsLabel } from './area';

describe('area billing', () => {
  it('sq ft from feet or inches, times pieces', () => {
    expect(areaQty({ length: 4, width: 6, pieces: 2, in: 'ft' }, 'sqft')).toBe(48);
    expect(areaQty({ length: 18, width: 24, pieces: 1, in: 'in' }, 'sqft')).toBe(3);
    expect(areaQty({ length: 10, width: 7, pieces: 3, in: 'in' }, 'sqft')).toBe(1.46);
  });
  it('running feet', () => {
    expect(areaQty({ length: 12.5, pieces: 4, in: 'ft' }, 'rft')).toBe(50);
    expect(areaQty({ length: 30, pieces: 2, in: 'in' }, 'rft')).toBe(5);
  });
  it('is 0 until the size is filled in, and labels the size', () => {
    expect(areaQty({ length: 4, pieces: 1, in: 'ft' }, 'sqft')).toBe(0);
    expect(dimsLabel({ length: 4, width: 6, pieces: 2, in: 'ft' }, 'sqft')).toBe('4 ft × 6 ft × 2 = 48 sq ft');
    expect(dimsLabel({ length: 12.5, pieces: 1, in: 'ft' }, 'rft')).toBe('12.5 ft = 12.5 rft');
  });
});
