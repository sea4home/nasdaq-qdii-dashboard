import { chinaDay, oncePerIsolate, readCache, writeCache } from '@/lib/daily-cache';
import { buildEvents, HORIZONS, round, THRESHOLDS, type BacktestEvent, type PricePoint } from '@/lib/backtest-engine';
const nasdaqHeaders = {
  Accept: 'application/json, text/plain, */*',
  'User-Agent': 'Mozilla/5.0',
  Referer: 'https://www.nasdaq.com/market-activity/index/ndx/historical',
};
const historyCache = new Map<string, { day: string; updatedAt: string; points: PricePoint[] }>();

function finiteNumber(value: string | undefined) {
  const normalized = value?.replace(/[^0-9.-]/g, '').trim();
  if (!normalized || normalized === '-' || normalized === '.' || normalized === '-.') return null;
  const parsed = Number(normalized);
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

async function fetchNasdaqHistoryFromSource(symbol: 'NDX' | 'COMP') {
  const fromDate = yearsAgo(29);
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
      const open = finiteNumber(row.open);
      const high = finiteNumber(row.high);
      const low = finiteNumber(row.low);
      return {
        date,
        close,
        open: open !== null && open > 0 ? open : close,
        high: high !== null && high > 0 ? high : close,
        low: low !== null && low > 0 ? low : close,
      };
    })
    .filter((point): point is PricePoint => point !== null)
    .sort((left, right) => left.date.localeCompare(right.date));

  if (points.length < 260) throw new Error('Not enough Nasdaq historical observations');
  return points;
}

async function loadNasdaqHistory(symbol: 'NDX' | 'COMP') {
  const day = chinaDay();
  const cacheKey = `nasdaq-history:${symbol}`;
  const memory = historyCache.get(cacheKey);
  if (memory?.day === day) return { ...memory, status: 'hit' as const };

  const cached = await readCache<PricePoint[]>(cacheKey, day);
  if (cached) {
    historyCache.set(cacheKey, { day: cached.day, updatedAt: cached.updatedAt, points: cached.value });
    return { day: cached.day, updatedAt: cached.updatedAt, points: cached.value, status: 'hit' as const };
  }

  return oncePerIsolate(`${cacheKey}:${day}`, async () => {
    const secondRead = await readCache<PricePoint[]>(cacheKey, day);
    if (secondRead) {
      historyCache.set(cacheKey, { day: secondRead.day, updatedAt: secondRead.updatedAt, points: secondRead.value });
      return { day: secondRead.day, updatedAt: secondRead.updatedAt, points: secondRead.value, status: 'hit' as const };
    }
    try {
      const points = await fetchNasdaqHistoryFromSource(symbol);
      const stored = await writeCache(cacheKey, day, points);
      const updatedAt = stored?.updatedAt ?? new Date().toISOString();
      historyCache.set(cacheKey, { day, updatedAt, points });
      return { day, updatedAt, points, status: stored ? 'updated' as const : 'unavailable' as const };
    } catch (error) {
      const stale = await readCache<PricePoint[]>(cacheKey);
      if (!stale) throw error;
      historyCache.set(cacheKey, { day: stale.day, updatedAt: stale.updatedAt, points: stale.value });
      return { day: stale.day, updatedAt: stale.updatedAt, points: stale.value, status: 'stale' as const };
    }
  });
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
    const history = await loadNasdaqHistory(symbol);
    const points = history.points;
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
        cache: { day: history.day, updatedAt: history.updatedAt, status: history.status },
      },
      { headers: { 'Cache-Control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=86400' } },
    );
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Backtest data unavailable' },
      { status: 502, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
