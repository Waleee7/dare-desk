// Shared formatting — every number on the desk reads the same way.

export const money = (n: number | null | undefined, digits = 2): string =>
  n == null ? '—' : `${n < 0 ? '-' : ''}$${Math.abs(n).toFixed(digits)}`;

export const signedMoney = (n: number | null | undefined): string =>
  n == null ? '—' : `${n >= 0 ? '+' : '-'}$${Math.abs(n).toFixed(2)}`;

export const signedPct = (n: number | null | undefined): string =>
  n == null ? '—' : `${n >= 0 ? '+' : ''}${Math.round(n)}%`;

export const signedR = (n: number | null | undefined): string =>
  n == null ? '—' : `${n >= 0 ? '+' : ''}${n.toFixed(2)}R`;

export const plClass = (n: number | null | undefined): string =>
  n == null ? '' : n >= 0 ? 'up' : 'down';

export const arrow = (dir: string): string => (dir === 'up' ? '↑' : dir === 'down' ? '↓' : '→');

export const contractLabel = (c: { strike: number; optionType: string; expiry: string; dte?: number }): string =>
  `$${c.strike}${c.optionType === 'call' ? 'C' : 'P'} ${c.dte === 0 ? '0DTE' : c.expiry.slice(5)}`;

export const sideLabel = (direction: string): string => (direction === 'long' ? 'CALLS' : 'PUTS');

export const timeAgo = (iso: string): string => {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 90) return `${Math.round(s)}s ago`;
  if (s < 5400) return `${Math.round(s / 60)}m ago`;
  if (s < 129600) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
};

export const gradeClass = (grade: string): string =>
  grade === 'A+' ? 'grade-aplus' : grade === 'A' ? 'grade-a' : grade === 'B' ? 'grade-b' : 'grade-low';
