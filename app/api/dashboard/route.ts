import universe from '@/data/fund_universe.json';

type MarketQuote = { marketPrice?: number; marketChange?: number; previousClose?: number; quoteTimestamp?: string };
type FundStatus = { nav?: string; navDate?: string; purchaseStatus?: string; dailyLimit?: string };

const etfCodes = universe.filter((fund) => fund.type === '场内ETF').map((fund) => fund.code);
const headers = { 'User-Agent': 'Mozilla/5.0', Referer: 'https://fund.eastmoney.com/' };

function numberAt(values: string[], index: number) {
  const value = Number(values[index]);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

async function tencentQuotes(): Promise<Record<string, MarketQuote>> {
  const symbols = etfCodes.map((code) => `${code.startsWith('15') ? 'sz' : 'sh'}${code}`).join(',');
  const response = await fetch(`https://qt.gtimg.cn/q=${symbols}`, { headers, cache: 'no-store' });
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
    };
  }
  return quotes;
}

async function eastmoneyQuoteFallback(codes: string[]): Promise<Record<string, MarketQuote>> {
  if (!codes.length) return {};
  const secids = codes.map((code) => `${code.startsWith('15') ? '0' : '1'}.${code}`).join(',');
  const response = await fetch(`https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&invt=2&fields=f2,f3,f12,f18,f124&secids=${secids}`, { headers, cache: 'no-store' });
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
  const response = await fetch('https://fund.eastmoney.com/Data/Fund_JJJZ_Data.aspx?t=8&page=1,50000&js=reData&sort=fcode,asc', { headers, cache: 'no-store' });
  if (!response.ok) throw new Error(`Eastmoney status ${response.status}`);
  const text = await response.text();
  const match = text.match(/datas:(\[.*\]),record:/s);
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
  const response = await fetch(`https://api.fund.eastmoney.com/f10/lsjz?fundCode=${code}&pageIndex=1&pageSize=1`, { headers, cache: 'no-store' });
  if (!response.ok) return {};
  const payload = await response.json() as { Data?: { LSJZList?: Array<{ DWJZ?: string; FSRQ?: string; SGZT?: string }> } };
  const row = payload.Data?.LSJZList?.[0];
  return row ? { nav: row.DWJZ, navDate: row.FSRQ, purchaseStatus: row.SGZT } : {};
}

async function mapWithConcurrency<T, R>(items: T[], worker: (item: T) => Promise<R>, limit = 5) {
  const result: R[] = new Array(items.length);
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
  const response = await fetch(`https://fund.eastmoney.com/pingzhongdata/${code}.js?v=${Date.now()}`, { headers, cache: 'no-store' });
  if (!response.ok) return undefined;
  const text = await response.text();
  const match = text.match(/var Data_netWorthTrend\s*=\s*(\[.*?\]);/s);
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

export async function GET() {
  const sources: string[] = [];
  const [quoteResult, statusResult] = await Promise.allSettled([tencentQuotes(), eastmoneyFundStatus()]);
  let quotes = quoteResult.status === 'fulfilled' ? quoteResult.value : {};
  if (quoteResult.status === 'fulfilled') sources.push('腾讯财经 ETF 行情（市价、昨收、IOPV）');
  const missingPrices = etfCodes.filter((code) => !quotes[code]?.marketPrice);
  if (missingPrices.length) {
    const fallback = await eastmoneyQuoteFallback(missingPrices);
    quotes = { ...fallback, ...quotes };
    if (Object.keys(fallback).length) sources.push('东方财富 ETF 行情（市价降级）');
  }
  const statuses = statusResult.status === 'fulfilled' ? statusResult.value : {};
  if (statusResult.status === 'fulfilled') sources.push('天天基金申购状态与净值接口');
  const navResults = await mapWithConcurrency(universe.map((fund) => fund.code), latestNav);
  const navs = Object.fromEntries(universe.map((fund, index) => [fund.code, navResults[index]]));
  if (navResults.some((item) => item.nav)) sources.push('东方财富基金历史净值接口');
  const performances = await mapWithConcurrency(etfCodes, performance);
  if (performances.some(Boolean)) sources.push('天天基金单位净值走势接口（收益计算）');

  const output = universe.map((fund) => {
    const quote = quotes[fund.code];
    const disclosedNav = navs[fund.code]?.nav;
    const premium = quote?.marketPrice && disclosedNav ? Number((((quote.marketPrice - Number(disclosedNav)) / Number(disclosedNav)) * 100).toFixed(2)) : null;
    return {
      ...fund,
      ...navs[fund.code],
      ...statuses[fund.code],
      ...quote,
      premium,
      premiumStatus: disclosedNav ? '最新市价相对最新披露单位净值' : '最新披露单位净值暂不可用，未计算溢价率',
      performance: fund.type === '场内ETF' ? performances[etfCodes.indexOf(fund.code)] : undefined,
    };
  });
  return Response.json({ generatedAt: new Date().toISOString(), mode: 'live', sources, funds: output, notes: ['净值溢价率 =（最新价 - 最新披露单位净值）/ 最新披露单位净值。', '申购状态、单日限额、净值和净值日期随页面刷新请求上游数据。'] }, { headers: { 'Cache-Control': 'no-store, max-age=0' } });
}
