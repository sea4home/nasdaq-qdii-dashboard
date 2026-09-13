type PricePoint = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
};

type HorizonKey = 'oneMonth' | 'threeMonths' | 'sixMonths' | 'oneYear';

type BacktestEvent = {
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

const THRESHOLDS = [5, 8, 10, 15, 20, 25, 30] as const;
const HORIZONS: Array<{ key: HorizonKey; label: string; days: number }> = [
  { key: 'oneMonth', label: '1个月', days: 21 },
  { key: 'threeMonths', label: '3个月', days: 63 },
  { key: 'sixMonths', label: '6个月', days: 126 },
  { key: 'oneYear', label: '1年', days: 252 },
];
const nasdaqHeaders = {
  Accept: 'application/json, text/plain, */*',
  'User-Agent': 'Mozilla/5.0',
  Referer: 'https://www.nasdaq.com/market-activity/index/ndx/historical',
};
const historyCache = new Map<string, { expiresAt: number; points: PricePoint[] }>();

function finiteNumber(value: string | undefined) {
  const parsed = Number(value?.replace(/[^0-9.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function isoNasdaqDate(value: string | undefined) {
  const [month, day, year] = value?.split('/') ?? [];
  if (!month || !day || !year) return null;
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

function yearsAgo(years: number) {
  const date = new Date();
  date.setUTCFullYear(date.getUTCFullYear() - years);
  return date.toISOString().slice(0, 10);
}

async function fetchNasdaqHistory(symbol: 'NDX' | 'COMP', fromDate: string) {
  const cacheKey = `${symbol}:${fromDate}`;
  const cached = historyCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.points;

  const rows: Array<Record<string, string>> = [];
  let offset = 0;
  let total = Infinity;
  while (offset < total && offset < 15_000) {
    const url = new URL(`https://api.nasdaq.com/api/quote/${symbol}/historical`);
    url.searchParams.set('assetclass', 'index');
    url.searchParams.set('fromdate', fromDate);
    url.searchParams.set('limit', '5000');
    url.searchParams.set('offset', String(offset));
    const response = await fetch(url, { headers: nasdaqHeaders, cache: 'no-store' });
    if (!response.ok) throw new Error(`Nasdaq historical request failed: ${response.status}`);
    const payload = (await response.json()) as {
      data?: { totalRecords?: number; tradesTable?: { rows?: Array<Record<string, string>> } } | null;
      status?: { rCode?: number; bCodeMessage?: Array<{ errorMessage?: string }> };
    };
    const page = payload.data?.tradesTable?.rows ?? [];
    if (!payload.data || !page.length) {
      const detail = payload.status?.bCodeMessage?.[0]?.errorMessage;
      throw new Error(detail || 'Nasdaq historical data is temporarily unavailable');
    }
    rows.push(...page);
    total = Number(payload.data.totalRecords ?? page.length);
    offset += page.length;
    if (page.length < 5000) break;
  }

  const points = rows
    .map((row) => {
      const date = isoNasdaqDate(row.date);
      const close = finiteNumber(row.close);
      if (!date || close === null || close <= 0) return null;
      return {
        date,
        close,
        open: finiteNumber(row.open) ?? close,
        high: finiteNumber(row.high) ?? close,
        low: finiteNumber(row.low) ?? close,
      };
    })
    .filter((point): point is PricePoint => point !== null)
    .sort((left, right) => left.date.localeCompare(right.date));

  if (points.length < 260) throw new Error('Not enough Nasdaq historical observations');
  historyCache.set(cacheKey, { expiresAt: Date.now() + 6 * 60 * 60 * 1000, points });
  return points;
}

function round(value: number) {
  return Number(value.toFixed(2));
}

function quantile(values: number[], q: number) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * q;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return round(sorted[lower]);
  return round(sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower));
}

function summarize(values: Array<number | null>) {
  const complete = values.filter((value): value is number => value !== null && Number.isFinite(value));
  return {
    median: quantile(complete, 0.5),
    mean: complete.length ? round(complete.reduce((sum, value) => sum + value, 0) / complete.length) : null,
    winRate: complete.length ? round((complete.filter((value) => value > 0).length / complete.length) * 100) : null,
    count: complete.length,
  };
}

function buildEvents(points: PricePoint[], startDate: string, peakDays: number) {
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
    if (points[index].date < startDate || index + 1 >= points.length) continue;

    for (const threshold of THRESHOLDS) {
      if (!armed.get(threshold) || drawdown > -threshold) continue;
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
      armed.set(threshold, false);
    }
  }
  return events;
}

function buildPathGroup(events: BacktestEvent[]) {
  const paths = events.slice(-40).map((event) => ({
    id: event.id,
    label: event.triggerDate,
    values: event.path,
  }));
  const median: Array<number | null> = [];
  const lower: Array<number | null> = [];
  const upper: Array<number | null> = [];
  for (let day = 0; day <= 252; day++) {
    const values = events.map((event) => event.path[day]).filter((value): value is number => Number.isFinite(value));
    median.push(quantile(values, 0.5));
    lower.push(quantile(values, 0.25));
    upper.push(quantile(values, 0.75));
  }
  return { paths, median, lower, upper };
}

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const symbol = params.get('symbol') === 'COMP' ? 'COMP' : 'NDX';
    const years = Math.min(25, Math.max(3, Number(params.get('years')) || 10));
    const peakDays = [126, 252, 756].includes(Number(params.get('peakDays'))) ? Number(params.get('peakDays')) : 252;
    const fetchYears = years + Math.ceil(peakDays / 252) + 1;
    const points = await fetchNasdaqHistory(symbol, yearsAgo(fetchYears));
    const requestedStart = yearsAgo(years);
    const availableStart = points.find((point) => point.date >= requestedStart)?.date ?? points[0].date;
    const groupedEvents = buildEvents(points, availableStart, peakDays);
    const stats = THRESHOLDS.map((threshold) => {
      const thresholdEvents = groupedEvents.get(threshold)!;
      return {
        threshold,
        eventCount: thresholdEvents.length,
        metrics: Object.fromEntries(
          HORIZONS.map(({ key }) => [key, summarize(thresholdEvents.map((event) => event.returns[key]))]),
        ),
        worstAdverse: thresholdEvents.length
          ? round(Math.min(...thresholdEvents.map((event) => event.maxAdverse ?? 0)))
          : null,
      };
    });
    const pathGroups = Object.fromEntries(
      THRESHOLDS.map((threshold) => [String(threshold), buildPathGroup(groupedEvents.get(threshold)!)]),
    );
    const events = Object.fromEntries(
      THRESHOLDS.map((threshold) => [String(threshold), groupedEvents.get(threshold)!.map(({ path: _path, ...event }) => event).reverse()]),
    );

    return Response.json(
      {
        generatedAt: new Date().toISOString(),
        dataAsOf: points.at(-1)!.date,
        startDate: availableStart,
        symbol,
        symbolName: symbol === 'NDX' ? '纳斯达克100指数' : '纳斯达克综合指数',
        years,
        peakDays,
        thresholds: THRESHOLDS,
        horizons: HORIZONS,
        stats,
        pathGroups,
        events,
        methodology: '首次跌破阈值触发；次一交易日开盘买入；创出新的阶段高点后重新计数；持有期按交易日计算。',
        source: 'Nasdaq 官方历史日线',
      },
      { headers: { 'Cache-Control': 'public, max-age=300, s-maxage=21600' } },
    );
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Backtest data unavailable' },
      { status: 502, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
