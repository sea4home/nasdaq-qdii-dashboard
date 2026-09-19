import universe from '@/data/fund_universe.json';
import { chinaCacheSlot, oncePerIsolate, readCache, writeCache } from '@/lib/daily-cache';

type MarketQuote = { marketPrice?: number; marketChange?: number; previousClose?: number; quoteTimestamp?: string; iopv?: number };
type FundStatus = { nav?: string; navDate?: string; purchaseStatus?: string; dailyLimit?: string };
type StockQuote = MarketQuote & { symbol: string; name?: string };
type StockPerformance = { oneYear?: number | null; yearToDate?: number | null; threeYear?: number | null };

const etfCodes = universe.filter((fund) => fund.type === '场内ETF').map((fund) => fund.code);
const usStockSymbols = ['NVDA', 'MSFT', 'AAPL', 'GOOGL', 'AMZN', 'META', 'TSLA', 'SPCX', 'TSM', 'AVGO', 'AMD', 'SNDK'];
const headers = { 'User-Agent': 'Mozilla/5.0', Referer: 'https://fund.eastmoney.com/' };
const upstreamFetch = (input: string | URL, init?: RequestInit) =>
  fetch(input, { ...init, signal: AbortSignal.timeout(8_000) });

async function fetchWithRetry(input: string | URL, init?: RequestInit, attempts = 2) {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await upstreamFetch(input, init);
      if (response.ok || attempt === attempts - 1) return response;
      lastError = new Error(`Upstream response ${response.status}`);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Upstream request failed');
}

function numberAt(values: string[], index: number) {
  const value = Number(values[index]);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

async function tencentQuotes(): Promise<Record<string, MarketQuote>> {
  const symbols = etfCodes.map((code) => `${code.startsWith('15') ? 'sz' : 'sh'}${code}`).join(',');
  const response = await upstreamFetch(`https://qt.gtimg.cn/q=${symbols}`, { headers, cache: 'no-store' });
  if (!response.ok) throw new Error(`Tencent quote ${response.status}`);
  const text = new TextDecoder('gb18030').decode(await response.arrayBuffer());
  const quotes: Record<string, MarketQuote> = {};

  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/v_([a-z]{2})(\d{6})="(.*)"/);
    if (!match) continue;
    const values = match[3].split('~');
    const price = numberAt(values, 3);
    quotes[match[2]] = {
      marketPrice: price,
      previousClose: numberAt(values, 4),
      marketChange: Number.isFinite(Number(values[32])) ? Number(values[32]) : undefined,
      quoteTimestamp: values[30] || undefined,
      iopv: numberAt(values, 85),
    };
  }
  return quotes;
}

async function eastmoneyQuoteFallback(codes: string[]): Promise<Record<string, MarketQuote>> {
  if (!codes.length) return {};
  const secids = codes.map((code) => `${code.startsWith('15') ? '0' : '1'}.${code}`).join(',');
  const response = await upstreamFetch(`https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&invt=2&fields=f2,f3,f12,f18,f124&secids=${secids}`, { headers, cache: 'no-store' });
  if (!response.ok) return {};
  const payload = await response.json() as { data?: { diff?: Array<Record<string, number | string>> } };
  return Object.fromEntries(((payload.data?.diff) ?? []).map((row) => [String(row.f12), {
    marketPrice: Number(row.f2) || undefined,
    marketChange: Number.isFinite(Number(row.f3)) ? Number(row.f3) : undefined,
    previousClose: Number(row.f18) || undefined,
    quoteTimestamp: row.f124 ? String(row.f124) : undefined,
  }]));
}

function formatLimit(value: string) {
  const number = Number(value);
  if (!Number.isFinite(number)) return undefined;
  if (number >= 99_999_999_999) return '不限额';
  if (number === 0) return '0元';
  return `${number.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}元`;
}

async function eastmoneyFundStatus(): Promise<Record<string, FundStatus>> {
  const response = await fetchWithRetry('https://fund.eastmoney.com/Data/Fund_JJJZ_Data.aspx?t=8&page=1,50000&js=reData&sort=fcode,asc', { headers, cache: 'no-store' }, 3);
  if (!response.ok) throw new Error(`Eastmoney status ${response.status}`);
  const text = await response.text();
  const match = text.match(/datas:(\[[\s\S]*\]),record:/);
  if (!match) throw new Error('Eastmoney status payload changed');
  const rows = JSON.parse(match[1]) as string[][];
  const expectedCodes = new Set(universe.map((fund) => fund.code));
  const status: Record<string, FundStatus> = {};
  for (const row of rows) {
    if (!expectedCodes.has(row[0])) continue;
    status[row[0]] = {
      nav: row[3] || undefined,
      navDate: row[4] ? `${new Date().getFullYear()}-${row[4]}` : undefined,
      purchaseStatus: row[5] || undefined,
      dailyLimit: formatLimit(row[9]),
    };
  }
  return status;
}

async function latestNav(code: string): Promise<FundStatus> {
  const response = await upstreamFetch(`https://api.fund.eastmoney.com/f10/lsjz?fundCode=${code}&pageIndex=1&pageSize=1`, { headers, cache: 'no-store' });
  if (!response.ok) return {};
  const payload = await response.json() as { Data?: { LSJZList?: Array<{ DWJZ?: string; FSRQ?: string; SGZT?: string }> } };
  const row = payload.Data?.LSJZList?.[0];
  return row ? { nav: row.DWJZ, navDate: row.FSRQ, purchaseStatus: row.SGZT } : {};
}

async function mapWithConcurrency<T, R>(items: T[], worker: (item: T) => Promise<R>, limit = 5) {
  const result: R[] = Array.from({ length: items.length });
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      result[index] = await worker(items[index]);
    }
  }));
  return result;
}

function shiftedDate(value: Date, years: number) {
  const result = new Date(value);
  result.setFullYear(value.getFullYear() - years);
  return result;
}

async function performance(code: string) {
  const response = await upstreamFetch(`https://fund.eastmoney.com/pingzhongdata/${code}.js?v=${Date.now()}`, { headers, cache: 'no-store' });
  if (!response.ok) return undefined;
  const text = await response.text();
  const match = text.match(/var Data_netWorthTrend\s*=\s*(\[[\s\S]*?\]);/);
  if (!match) return undefined;
  const rows = JSON.parse(match[1]) as Array<{ x: number; y: number }>;
  const points = rows.filter((row) => Number.isFinite(row.x) && Number.isFinite(row.y));
  if (!points.length) return undefined;
  const latest = points.at(-1)!;
  const getReturn = (date: Date) => {
    const prior = [...points].reverse().find((point) => new Date(point.x) <= date);
    return prior ? Number(((latest.y / prior.y - 1) * 100).toFixed(2)) : null;
  };
  const asOf = new Date(latest.x);
  return { asOf: asOf.toISOString().slice(0, 10), oneYear: getReturn(shiftedDate(asOf, 1)), yearToDate: getReturn(new Date(asOf.getFullYear(), 0, 1)), threeYear: getReturn(shiftedDate(asOf, 3)), basis: '单位净值累计收益' };
}

async function usStockQuotes(): Promise<Record<string, StockQuote>> {
  const response = await upstreamFetch(`https://qt.gtimg.cn/q=${usStockSymbols.map((symbol) => `us${symbol}`).join(',')}`, { headers, cache: 'no-store' });
  if (!response.ok) throw new Error(`Tencent US quote ${response.status}`);
  const text = new TextDecoder('gb18030').decode(await response.arrayBuffer());
  const quotes: Record<string, StockQuote> = {};

  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/v_us([A-Z]+)="(.*)"/);
    if (!match) continue;
    const values = match[2].split('~');
    quotes[match[1]] = {
      symbol: match[1],
      name: values[1] || undefined,
      marketPrice: numberAt(values, 3),
      previousClose: numberAt(values, 4),
      marketChange: Number.isFinite(Number(values[32])) ? Number(values[32]) : undefined,
      quoteTimestamp: values[30] || undefined,
    };
  }
  return quotes;
}

async function usStockPerformance(symbol: string): Promise<StockPerformance | undefined> {
  try {
    const end = Math.floor(Date.now() / 1000) + 86_400;
    const start = new Date();
    start.setFullYear(start.getFullYear() - 4);
    const response = await fetchWithRetry(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?period1=${Math.floor(start.getTime() / 1000)}&period2=${end}&interval=1d&events=history`, {
      headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
      cache: 'no-store',
    }, 3);
    if (!response.ok) return undefined;
    const payload = await response.json() as { chart?: { result?: Array<{ timestamp?: number[]; indicators?: { quote?: Array<{ close?: Array<number | null> }> } }> } };
    const chart = payload.chart?.result?.[0];
    const timestamps = chart?.timestamp ?? [];
    const closes = chart?.indicators?.quote?.[0]?.close ?? [];
    let points = timestamps.map((timestamp, index) => ({ date: new Date(timestamp * 1000), close: closes[index] }))
      .filter((point): point is { date: Date; close: number } => Number.isFinite(point.close) && Number(point.close) > 0);
    if (!points.length) {
      const nasdaqResponse = await fetchWithRetry(`https://api.nasdaq.com/api/quote/${symbol}/historical?assetclass=stocks&fromdate=${start.toISOString().slice(0, 10)}&limit=5000`, {
        headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
        cache: 'no-store',
      }, 2);
      if (!nasdaqResponse.ok) return undefined;
      const nasdaqPayload = await nasdaqResponse.json() as { data?: { tradesTable?: { rows?: Array<{ date?: string; close?: string }> } } };
      points = (nasdaqPayload.data?.tradesTable?.rows ?? []).map((row) => {
        const close = Number(row.close?.replace(/[^0-9.-]/g, ''));
        const [month, day, year] = row.date?.split('/') ?? [];
        return { date: new Date(`${year}-${month}-${day}T00:00:00`), close };
      }).filter((point): point is { date: Date; close: number } => Number.isFinite(point.close) && point.close > 0)
        .sort((a, b) => a.date.getTime() - b.date.getTime());
    }
    if (!points.length) return undefined;
    const latest = points.at(-1)!;
    const getReturn = (date: Date) => {
      const baseline = [...points].reverse().find((point) => point.date <= date) ?? points[0];
      return Number(((latest.close / baseline.close - 1) * 100).toFixed(2));
    };
    return {
      oneYear: getReturn(shiftedDate(latest.date, 1)),
      yearToDate: getReturn(new Date(latest.date.getFullYear(), 0, 1)),
      threeYear: getReturn(shiftedDate(latest.date, 3)),
    };
  } catch {
    return undefined;
  }
}

async function buildDashboardSnapshot() {
  const sources: string[] = [];
  const [quoteResult, statusResult, performances, stockQuoteResult, stockPerformances] = await Promise.all([
    Promise.resolve(tencentQuotes()).then(
      (value) => ({ status: 'fulfilled' as const, value }),
      (reason) => ({ status: 'rejected' as const, reason }),
    ),
    Promise.resolve(eastmoneyFundStatus()).then(
      (value) => ({ status: 'fulfilled' as const, value }),
      (reason) => ({ status: 'rejected' as const, reason }),
    ),
    mapWithConcurrency(etfCodes, async (code) => {
      try { return await performance(code); } catch { return undefined; }
    }, 4),
    Promise.resolve(usStockQuotes()).then(
      (value) => ({ status: 'fulfilled' as const, value }),
      (reason) => ({ status: 'rejected' as const, reason }),
    ),
    mapWithConcurrency(usStockSymbols, usStockPerformance, 4),
  ]);
  let quotes = quoteResult.status === 'fulfilled' ? quoteResult.value : {};
  if (quoteResult.status === 'fulfilled') sources.push('腾讯财经 ETF 行情（市价、昨收）');
  const missingPrices = etfCodes.filter((code) => !quotes[code]?.marketPrice);
  if (missingPrices.length) {
    try {
      const fallback = await eastmoneyQuoteFallback(missingPrices);
      quotes = { ...fallback, ...quotes };
      if (Object.keys(fallback).length) sources.push('东方财富 ETF 行情（市价降级）');
    } catch {
      // Keep the rest of the dashboard usable when a fallback provider times out.
    }
  }
  const statuses = statusResult.status === 'fulfilled' ? statusResult.value : {};
  if (statusResult.status === 'fulfilled') sources.push('天天基金申购状态与净值接口');
  const navResults = await mapWithConcurrency(universe.map((fund) => fund.code), async (code) => {
    if (statuses[code]?.nav) return {};
    try { return await latestNav(code); } catch { return {}; }
  }, 10);
  const navs = Object.fromEntries(universe.map((fund, index) => [fund.code, navResults[index]]));
  if (navResults.some((item) => item.nav)) sources.push('东方财富基金历史净值接口');
  if (performances.some(Boolean)) sources.push('天天基金单位净值走势接口（收益计算）');
  const stocks = usStockSymbols.map((symbol, index) => ({
    symbol,
    ...(stockQuoteResult.status === 'fulfilled' ? stockQuoteResult.value[symbol] : {}),
    performance: stockPerformances[index],
  }));
  if (stockQuoteResult.status === 'fulfilled') sources.push('腾讯财经美股行情接口');
  if (stockPerformances.some(Boolean)) sources.push('Yahoo Finance 历史日线（收益计算）');

  const output = universe.map((fund) => {
    const quote = quotes[fund.code];
    const disclosedNav = statuses[fund.code]?.nav ?? navs[fund.code]?.nav;
    const disclosedNavNumber = Number(disclosedNav);
    const premium = quote?.marketPrice && Number.isFinite(disclosedNavNumber) && disclosedNavNumber > 0
      ? Number((((quote.marketPrice - disclosedNavNumber) / disclosedNavNumber) * 100).toFixed(2))
      : null;
    return {
      ...fund,
      ...navs[fund.code],
      ...statuses[fund.code],
      ...quote,
      premium,
      premiumStatus: premium == null
        ? '最新价或最新披露单位净值暂不可用'
        : `按${statuses[fund.code]?.navDate ?? navs[fund.code]?.navDate ?? '最新披露日'}单位净值计算`,
      performance: fund.type === '场内ETF' ? performances[etfCodes.indexOf(fund.code)] : undefined,
    };
  });
  const pricedEtfs = output.filter((fund) => fund.type === '场内ETF' && fund.marketPrice).length;
  const fundsWithNav = output.filter((fund) => fund.nav).length;
  const pricedStocks = stocks.filter((stock) => stock.marketPrice).length;
  const fundPerformances = output.filter((fund) => fund.type === '场内ETF' && fund.performance?.yearToDate != null).length;
  const stockPerformanceCount = stocks.filter((stock) => stock.performance?.yearToDate != null && stock.performance?.oneYear != null).length;
  const offMarketFunds = output.filter((fund) => fund.type !== '场内ETF');
  const purchaseLimits = offMarketFunds.filter((fund) => fund.dailyLimit).length;
  if (pricedEtfs < Math.ceil(etfCodes.length / 2)
    || fundsWithNav < Math.ceil(universe.length / 2)
    || pricedStocks < Math.ceil(usStockSymbols.length / 2)
    || fundPerformances < Math.ceil(etfCodes.length * 0.8)
    || stockPerformanceCount < Math.ceil(usStockSymbols.length * 0.8)
    || purchaseLimits < Math.ceil(offMarketFunds.length * 0.8)) {
    throw new Error('Upstream market data coverage is insufficient');
  }
  return {
    generatedAt: new Date().toISOString(),
    mode: 'daily',
    sources,
    funds: output,
    stocks,
    notes: [
      '净值溢价率 =（最新价 - 最新披露单位净值）/ 最新披露单位净值。',
      '行情、净值和收益数据每日定时更新三次，其余访问直接读取站点缓存。',
    ],
  };
}

type DashboardSnapshot = Awaited<ReturnType<typeof buildDashboardSnapshot>>;

export async function GET(request: Request) {
  const warmNext = new URL(request.url).searchParams.get('warm') === 'next';
  const slot = chinaCacheSlot(new Date(), warmNext);
  const cacheKey = 'dashboard-v4';
  const cached = await readCache<DashboardSnapshot>(cacheKey, slot);
  if (cached) {
    return Response.json(
      { ...cached.value, cache: { day: cached.day, updatedAt: cached.updatedAt, status: 'hit' } },
      { headers: { 'Cache-Control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=86400' } },
    );
  }

  try {
    const snapshot = await oncePerIsolate(`dashboard:${slot}`, async () => {
      const secondRead = await readCache<DashboardSnapshot>(cacheKey, slot);
      if (secondRead) return { value: secondRead.value, updatedAt: secondRead.updatedAt, status: 'hit' as const };
      const value = await buildDashboardSnapshot();
      const stored = await writeCache(cacheKey, slot, value);
      return { value, updatedAt: stored?.updatedAt ?? value.generatedAt, status: stored ? 'updated' as const : 'unavailable' as const };
    });
    return Response.json(
      { ...snapshot.value, cache: { day: slot, updatedAt: snapshot.updatedAt, status: snapshot.status } },
      { headers: { 'Cache-Control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=86400' } },
    );
  } catch (error) {
    const stale = await readCache<DashboardSnapshot>(cacheKey);
    if (stale) {
      return Response.json(
        { ...stale.value, cache: { day: stale.day, updatedAt: stale.updatedAt, status: 'stale' } },
        { headers: { 'Cache-Control': 'public, max-age=60, s-maxage=300' } },
      );
    }
    return Response.json(
      { error: error instanceof Error ? error.message : 'Dashboard data unavailable' },
      { status: 502, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
