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

describe('metric area billing', () => {
  it('sq m and running metres from mm, cm, m or feet', () => {
    expect(areaQty({ length: 1220, width: 2440, pieces: 1, in: 'mm' }, 'sqm')).toBe(2.98);
    expect(areaQty({ length: 2, width: 1.5, pieces: 2, in: 'm' }, 'sqm')).toBe(6);
    expect(areaQty({ length: 250, pieces: 4, in: 'cm' }, 'rmt')).toBe(10);
    expect(areaQty({ length: 600, width: 400, pieces: 1, in: 'mm' }, 'sqft')).toBe(2.58);
    expect(dimsLabel({ length: 2, width: 1.5, pieces: 1, in: 'm' }, 'sqm')).toBe('2 m × 1.5 m = 3 sq m');
  });
});
