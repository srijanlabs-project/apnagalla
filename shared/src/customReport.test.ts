import { describe, expect, it } from 'vitest';
import { periodRange, runCustomReport } from './customReport';

const bill = (id: string, date: string, total: number, createdBy = 'u1') => ({
  id,
  date,
  number: `INV/${id}`,
  status: 'saved',
  createdBy,
  billTo: { name: 'Gupta' },
  history: [{ by: createdBy, byName: createdBy === 'u1' ? 'Owner' : 'Ravi' }],
  totals: { taxableAmount: total, taxTotal: 0, grandTotal: total, lines: [{ taxable: total, tax: 0 }] },
  lines: [{ itemId: 'i1', name: 'Rice', qty: 2 }],
});

describe('custom reports', () => {
  it('periods are counted from today', () => {
    expect(periodRange('lastMonth', '2026-03-15')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(periodRange('week', '2026-11-25')).toEqual({ from: '2026-11-23', to: '2026-11-25' });
    expect(periodRange('fy', '2026-02-10')).toEqual({ from: '2025-04-01', to: '2026-02-10' });
  });

  it('lists, groups and filters', () => {
    const input = { invoices: [bill('1', '2026-11-24', 10000), bill('2', '2026-11-25', 5000, 'u2'), bill('3', '2026-11-25', 2500)], payments: [], purchases: [], expenses: [], items: [{ id: 'i1', name: 'Rice', categoryId: 'c1' }], categories: [{ id: 'c1', name: 'Grains' }] };
    const plain = runCustomReport({ source: 'bills', columns: ['number', 'total'], period: 'month' }, input, '2026-11-25');
    expect(plain.rows).toEqual([['INV/1', 10000], ['INV/2', 5000], ['INV/3', 2500]]);
    expect(plain.foot).toEqual(['Total', 17500]);
    const byStaff = runCustomReport({ source: 'bills', columns: ['total'], groupBy: 'staff', period: 'month' }, input, '2026-11-25');
    expect(byStaff.rows).toEqual([['Owner', 2, 12500], ['Ravi', 1, 5000]]);
    const ravi = runCustomReport({ source: 'bills', columns: ['total'], period: 'today', filters: { staffId: 'u2' } }, input, '2026-11-25');
    expect(ravi.rows).toEqual([[5000]]);
    const lines = runCustomReport({ source: 'billLines', columns: ['category', 'qty'], groupBy: 'category', period: 'month' }, input, '2026-11-25');
    expect(lines.rows).toEqual([['Grains', 3, 6]]);
  });
});
