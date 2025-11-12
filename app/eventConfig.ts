// app/eventConfig.ts
export type ClaimMode = 'disabled' | 'monthly_fixed_day' | 'weekly_friday';

export const EVENT_CONFIG = {
  DISCIPLINE: {
    CLAIM_MODE: 'monthly_fixed_day' as ClaimMode,
    CLAIM_DAY: 2 as const, // ← TESTING: klaim setiap tanggal 2
  },
} as const;

/** Apakah HARI INI adalah hari klaim kedisiplinan? */
export function isTodayDisciplineClaimDay(now = new Date()): boolean {
  const mode = EVENT_CONFIG.DISCIPLINE.CLAIM_MODE as ClaimMode;

  if (mode === 'disabled') return false;

  if (mode === 'monthly_fixed_day') {
    const d = EVENT_CONFIG.DISCIPLINE.CLAIM_DAY;
    return now.getDate() === Number(d);
  }

  if (mode === 'weekly_friday') {
    return now.getDay() === 5; // Jumat
  }

  return false;
}

/** Hitung tanggal klaim berikutnya (buat ditampilkan di UI). */
export function nextDisciplineClaimDate(from = new Date()): Date {
  const mode = EVENT_CONFIG.DISCIPLINE.CLAIM_MODE as ClaimMode;
  const base = new Date(from);

  if (mode === 'monthly_fixed_day') {
    const day = Number(EVENT_CONFIG.DISCIPLINE.CLAIM_DAY) || 1;
    const y = base.getFullYear();
    const m = base.getDate() < day ? base.getMonth() : base.getMonth() + 1;
    const res = new Date(y, m, day, 0, 0, 0, 0);
    return res;
  }

  if (mode === 'weekly_friday') {
    const want = 5; // Jumat
    const diff = ((7 + want - base.getDay()) % 7) || 7;
    const res = new Date(base);
    res.setDate(base.getDate() + diff);
    res.setHours(0, 0, 0, 0);
    return res;
  }

  // disabled → kembalikan 'from' saja
  return base;
}
