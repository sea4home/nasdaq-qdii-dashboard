export type PricePoint = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
};

export type HorizonKey = 'oneMonth' | 'threeMonths' | 'sixMonths' | 'oneYear';

export type BacktestEvent = {
  id: string;
  triggerDate: string;
  entryDate: string;
  threshold: number;
  drawdown: number;
  peakDate: string;
  peakClose: number;
  entryPrice: number;
  returns: Record<HorizonKey, number | null>;
  maxAdverse: number | null;
  path: number[];
};

export const THRESHOLDS = [5, 8, 10, 15, 20, 25, 30] as const;
export const HORIZONS: Array<{ key: HorizonKey; label: string; days: number }> = [
  { key: 'oneMonth', label: '1个月', days: 21 },
  { key: 'threeMonths', label: '3个月', days: 63 },
  { key: 'sixMonths', label: '6个月', days: 126 },
  { key: 'oneYear', label: '1年', days: 252 },
];

export function round(value: number) {
  return Number(value.toFixed(2));
}

export function buildEvents(points: PricePoint[], startDate: string, peakDays: number) {
  const events = new Map<number, BacktestEvent[]>();
  const armed = new Map<number, boolean>();
  THRESHOLDS.forEach((threshold) => {
    events.set(threshold, []);
    armed.set(threshold, true);
  });

  const peakDeque: number[] = [];
  for (let index = 0; index < points.length; index++) {
    while (peakDeque.length && peakDeque[0] < index - peakDays + 1) peakDeque.shift();
    while (peakDeque.length && points[peakDeque.at(-1)!].close <= points[index].close) peakDeque.pop();
    peakDeque.push(index);
    const peakIndex = peakDeque[0];
    const peak = points[peakIndex];
    const drawdown = (points[index].close / peak.close - 1) * 100;

    if (peakIndex === index) THRESHOLDS.forEach((threshold) => armed.set(threshold, true));

    for (const threshold of THRESHOLDS) {
      if (!armed.get(threshold) || drawdown > -threshold) continue;
      armed.set(threshold, false);
      if (points[index].date < startDate || index + 1 >= points.length) continue;
      const entryIndex = index + 1;
      const entry = points[entryIndex];
      const entryPrice = entry.open > 0 ? entry.open : entry.close;
      const futureReturns = Object.fromEntries(
        HORIZONS.map(({ key, days }) => {
          const future = points[entryIndex + days];
          return [key, future ? round((future.close / entryPrice - 1) * 100) : null];
        }),
      ) as Record<HorizonKey, number | null>;
      const endIndex = Math.min(points.length - 1, entryIndex + 252);
      let worst = Infinity;
      const path: number[] = [];
      for (let cursor = entryIndex; cursor <= endIndex; cursor++) {
        path.push(round((points[cursor].close / entryPrice - 1) * 100));
        worst = Math.min(worst, (points[cursor].low / entryPrice - 1) * 100);
      }
      events.get(threshold)!.push({
        id: `${threshold}-${points[index].date}`,
        triggerDate: points[index].date,
        entryDate: entry.date,
        threshold,
        drawdown: round(drawdown),
        peakDate: peak.date,
        peakClose: round(peak.close),
        entryPrice: round(entryPrice),
        returns: futureReturns,
        maxAdverse: Number.isFinite(worst) ? round(worst) : null,
        path,
      });
    }
  }
  return events;
}
