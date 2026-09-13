'use client';
import { useEffect, useState } from 'react';
import { ArrowDown, BarChart3, RefreshCw } from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';
import universe from '@/data/fund_universe.json';

type Performance = {
  oneYear?: number | null;
  yearToDate?: number | null;
  threeYear?: number | null;
};
type Fund = (typeof universe)[number] & {
  nav?: string;
  navDate?: string;
  marketPrice?: number;
  marketChange?: number;
  previousClose?: number;
  purchaseStatus?: string;
  dailyLimit?: string;
  premium?: number | null;
  premiumStatus?: string;
  performance?: Performance;
};
type Stock = {
  symbol: string;
  name?: string;
  marketPrice?: number;
  marketChange?: number;
  previousClose?: number;
  quoteTimestamp?: string;
  performance?: Performance;
};
type Snapshot = {
  generatedAt: string | null;
  funds: Fund[];
  stocks: Stock[];
  sources?: string[];
};
type SortKey = 'marketChange' | 'premium' | 'oneYear' | 'yearToDate' | 'threeYear' | 'previousClose' | 'marketPrice' | 'nav' | 'date';
type SortState = { key: SortKey; direction: 'asc' | 'desc' };
type Column = { label: string; key?: SortKey };
const initial: Snapshot = { generatedAt: null, funds: universe, stocks: [] };
const etfColumns: Column[] = [
  { label: '基金名称 / 代码' }, { label: '涨跌幅', key: 'marketChange' }, { label: '净值溢价率', key: 'premium' },
  { label: '近一年收益', key: 'oneYear' }, { label: '今年收益', key: 'yearToDate' }, { label: '近3年收益', key: 'threeYear' },
  { label: '昨收', key: 'previousClose' }, { label: '最新价', key: 'marketPrice' }, { label: '最新披露单位净值', key: 'nav' }, { label: '净值日期', key: 'date' },
];
const stockColumns: Column[] = [
  { label: '标的代码' }, { label: '涨跌幅', key: 'marketChange' }, { label: '今年收益', key: 'yearToDate' },
  { label: '近一年收益', key: 'oneYear' }, { label: '近3年收益', key: 'threeYear' }, { label: '昨收', key: 'previousClose' },
  { label: '最新价', key: 'marketPrice' }, { label: '日期', key: 'date' },
];
const statusClass: Record<string, string> = {
  限大额: 'bg-amber-50 text-amber-700 border-amber-200',
  限制大额申购: 'bg-amber-50 text-amber-700 border-amber-200',
  暂停申购: 'bg-rose-50 text-rose-700 border-rose-200',
  开放申购: 'bg-emerald-50 text-emerald-700 border-emerald-200',
};

export default function Home() {
  const [snapshot, setSnapshot] = useState<Snapshot>(initial);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [etfSort, setEtfSort] = useState<SortState>({ key: 'yearToDate', direction: 'desc' });
  const [stockSort, setStockSort] = useState<SortState>({ key: 'yearToDate', direction: 'desc' });
  async function refresh() {
    setLoading(true);
    setLoadError(false);
    try {
      const response = await fetch('/api/dashboard', { cache: 'no-store' });
      if (!response.ok) throw new Error(`Dashboard request failed: ${response.status}`);
      setSnapshot(await response.json());
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void refresh();
  }, []);
  const etfs = sortRecords(
    snapshot.funds.filter((f) => f.type === '场内ETF'),
    etfSort,
    (fund, key) => getFundValue(fund, key),
  );
  const offMarket = snapshot.funds.filter((f) => f.type !== '场内ETF');
  const stocks = sortRecords(snapshot.stocks, stockSort, (stock, key) => getStockValue(stock, key));
  return (
    <main className="min-h-screen bg-[#f4f7f8]" aria-busy={loading}>
      <header className="hero-grid text-white">
        <div className="mx-auto flex max-w-7xl flex-col items-stretch gap-5 px-5 py-6 sm:flex-row sm:items-center sm:justify-between sm:px-8 sm:py-7 lg:px-10">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-[#49d0bc] text-[#082d54]">
              <BarChart3 size={21} />
            </div>
            <div>
              <p className="text-xs font-semibold tracking-[.18em] text-[#49d0bc]">
                NASDAQ QDII MONITOR
              </p>
              <h1 className="font-display text-2xl font-semibold">
                纳斯达克 QDII 基金看板
              </h1>
            </div>
          </div>
          <button
            onClick={() => void refresh()}
            disabled={loading}
            className="flex min-h-11 items-center justify-center gap-2 rounded-full border border-white/20 bg-white/10 px-5 py-2 text-sm transition hover:bg-white/15 disabled:cursor-wait disabled:opacity-80 sm:min-h-0"
            aria-label={loading ? '正在刷新数据' : '刷新数据'}
          >
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
            {loading ? '更新中' : '刷新数据'}
          </button>
        </div>
      </header>
      {loading && (
        <div className="refresh-overlay" role="dialog" aria-modal="true" aria-labelledby="refresh-title" aria-describedby="refresh-description">
          <div className="refresh-card">
            <div className="refresh-icon" aria-hidden="true">
              <Spinner className="h-7 w-7" />
            </div>
            <div className="min-w-0 flex-1">
              <p id="refresh-title" className="text-base font-semibold text-slate-900 sm:text-lg">
                正在刷新最新数据
              </p>
              <p id="refresh-description" className="mt-1 text-sm leading-6 text-slate-500">
                正在请求行情、净值和收益数据，请稍候…
              </p>
              <div className="refresh-progress" aria-hidden="true"><span /></div>
            </div>
          </div>
        </div>
      )}
      <div className="mx-auto flex max-w-7xl flex-col px-5 py-10 sm:px-8 lg:px-10">
        {loadError && (
          <div className="mb-7 flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 sm:flex-row sm:items-center sm:justify-between" role="alert">
            <span>暂时未能获取最新数据，请检查网络后重试。</span>
            <button type="button" onClick={() => void refresh()} className="min-h-10 rounded-full bg-amber-900 px-4 font-medium text-white sm:min-h-0 sm:py-2">
              重新刷新
            </button>
          </div>
        )}
        <p className="mb-8 text-sm text-slate-500">
          {snapshot.generatedAt
            ? `数据请求时间：${new Date(snapshot.generatedAt).toLocaleString('zh-CN', { hour12: false })}`
            : '正在请求实时数据'}
          　·　微信端可左右滑动，第一列固定
        </p>
        <section className="order-1">
          <p className="section-kicker">ETF PREMIUM</p>
          <h2 className="section-title">场内纳指 ETF 溢价率排行</h2>
          <p className="mt-2 text-sm text-slate-500">
            按（最新价 - 最新披露单位净值）/ 最新披露单位净值计算。
          </p>
          <div className="mt-5 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1060px] text-left text-sm">
                <thead className="bg-[#eaf0f5] text-xs text-slate-500">
                  <tr>
                    {etfColumns.map((column, i) => (
                      <SortableHeader
                        key={column.label}
                        column={column}
                        first={i === 0}
                        sort={etfSort}
                        onSort={(key) => setEtfSort(toggleSort(etfSort, key))}
                      />
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {etfs.map((f) => (
                    <tr key={f.code} className="border-t border-slate-100">
                      <td className="sticky left-0 z-10 bg-white px-5 py-3.5 shadow-[4px_0_8px_-6px_rgba(16,42,67,.28)]">
                        <p className="font-medium text-slate-800">{f.name}</p>
                        <p className="font-mono text-xs text-slate-400">
                          {f.code}
                        </p>
                      </td>
                      <Change value={f.marketChange} />
                      <Premium value={f.premium} />
                      <Return value={f.performance?.oneYear} />
                      <Return value={f.performance?.yearToDate} />
                      <Return value={f.performance?.threeYear} />
                      <Num value={f.previousClose} />
                      <Num value={f.marketPrice} strong />
                      <td className="px-5 py-3.5 font-mono text-slate-600">
                        {f.nav ?? '--'}
                      </td>
                      <td className="px-5 py-3.5 font-mono text-slate-600">
                        {f.navDate ?? '--'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
        <section className="order-3 mt-14">
          <p className="section-kicker">US MEGA-CAP TECH</p>
          <h2 className="section-title">美国大型科技巨头收益排行对比</h2>
          <p className="mt-2 text-sm text-slate-500">
            按近一年收益排序，价格单位为美元；收益基于历史收盘价计算。
          </p>
          <div className="mt-5 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[940px] text-left text-sm">
                <thead className="bg-[#eaf0f5] text-xs text-slate-500">
                  <tr>
                    {stockColumns.map((column, i) => (
                      <SortableHeader
                        key={column.label}
                        column={column}
                        first={i === 0}
                        sort={stockSort}
                        onSort={(key) => setStockSort(toggleSort(stockSort, key))}
                      />
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {stocks.map((stock) => (
                    <tr key={stock.symbol} className="border-t border-slate-100">
                      <td className="sticky left-0 z-10 bg-white px-5 py-3.5 shadow-[4px_0_8px_-6px_rgba(16,42,67,.28)]">
                        <p className="font-medium text-slate-800">{stock.symbol}</p>
                        <p className="text-xs text-slate-400">{stock.name ?? '--'}</p>
                      </td>
                      <Change value={stock.marketChange} />
                      <Return value={stock.performance?.yearToDate} />
                      <Return value={stock.performance?.oneYear} />
                      <Return value={stock.performance?.threeYear} />
                      <Num value={stock.previousClose} />
                      <Num value={stock.marketPrice} strong />
                      <td className="px-5 py-3.5 font-mono text-slate-600">
                        {stock.quoteTimestamp?.slice(0, 10) ?? '--'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
        <section className="order-2 mt-14">
          <p className="section-kicker">PURCHASE STATUS & COST</p>
          <h2 className="section-title">场外基金申购状态与费率对比</h2>
          <p className="mt-2 text-sm text-slate-500">
            状态、限额、净值和日期动态获取；费率为合同资料口径。
          </p>
          <div className="mt-5 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1050px] text-left text-sm">
                <thead className="bg-[#eaf0f5] text-xs text-slate-500">
                  <tr>
                    {[
                      '基金名称 / 代码',
                      '申购状态',
                      '单日限购额度',
                      '最新净值(元)',
                      '净值日期',
                      '管理费率',
                      '托管费率',
                      '综合费率',
                    ].map((x, i) => (
                      <th
                        key={x}
                        className={`px-5 py-3.5 font-medium ${i === 0 ? 'sticky left-0 z-20 bg-[#eaf0f5] shadow-[4px_0_8px_-6px_rgba(16,42,67,.35)]' : ''}`}
                      >
                        {x}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {offMarket.map((f) => (
                    <tr key={f.code} className="border-t border-slate-100">
                      <td className="sticky left-0 z-10 bg-white px-5 py-3.5 shadow-[4px_0_8px_-6px_rgba(16,42,67,.28)]">
                        <p className="font-medium text-slate-800">{f.name}</p>
                        <p className="font-mono text-xs text-slate-400">
                          {f.code}
                        </p>
                      </td>
                      <td className="px-5 py-3.5">
                        <span
                          className={`status-pill ${statusClass[f.purchaseStatus ?? ''] ?? 'bg-slate-100 text-slate-600 border-slate-200'}`}
                        >
                          {f.purchaseStatus ?? '--'}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 font-mono">
                        {f.dailyLimit ?? '--'}
                      </td>
                      <td className="px-5 py-3.5 font-mono text-[#0d4a7c]">
                        {f.nav ?? '--'}
                      </td>
                      <td className="px-5 py-3.5 font-mono text-slate-600">
                        {f.navDate ?? '--'}
                      </td>
                      <td className="px-5 py-3.5 font-mono">
                        {f.managementFee}
                      </td>
                      <td className="px-5 py-3.5 font-mono">{f.custodyFee}</td>
                      <td className="px-5 py-3.5 font-mono">{f.totalFee}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
        <footer className="order-4 mt-12 border-t border-slate-200 pt-5 text-xs text-slate-400">
          数据仅供信息参考，基金投资有风险。
        </footer>
      </div>
    </main>
  );
}
function toggleSort(current: SortState, key: SortKey): SortState {
  return current.key === key
    ? { key, direction: current.direction === 'desc' ? 'asc' : 'desc' }
    : { key, direction: 'desc' };
}

function sortRecords<T>(records: T[], sort: SortState, getValue: (record: T, key: SortKey) => number | string | null | undefined) {
  return [...records].sort((left, right) => {
    const a = getValue(left, sort.key);
    const b = getValue(right, sort.key);
    const aMissing = a === undefined || a === null || a === '';
    const bMissing = b === undefined || b === null || b === '';
    if (aMissing || bMissing) return aMissing === bMissing ? 0 : aMissing ? 1 : -1;
    const compared = typeof a === 'number' && typeof b === 'number'
      ? a - b
      : String(a).localeCompare(String(b), 'zh-CN');
    return sort.direction === 'desc' ? -compared : compared;
  });
}

function getFundValue(fund: Fund, key: SortKey) {
  const values: Record<SortKey, number | string | null | undefined> = {
    marketChange: fund.marketChange,
    premium: fund.premium,
    oneYear: fund.performance?.oneYear,
    yearToDate: fund.performance?.yearToDate,
    threeYear: fund.performance?.threeYear,
    previousClose: fund.previousClose,
    marketPrice: fund.marketPrice,
    nav: fund.nav ? Number(fund.nav) : undefined,
    date: fund.navDate,
  };
  return values[key];
}

function getStockValue(stock: Stock, key: SortKey) {
  const values: Record<SortKey, number | string | null | undefined> = {
    marketChange: stock.marketChange,
    premium: undefined,
    oneYear: stock.performance?.oneYear,
    yearToDate: stock.performance?.yearToDate,
    threeYear: stock.performance?.threeYear,
    previousClose: stock.previousClose,
    marketPrice: stock.marketPrice,
    nav: undefined,
    date: stock.quoteTimestamp,
  };
  return values[key];
}

function SortableHeader({ column, first, sort, onSort }: { column: Column; first: boolean; sort: SortState; onSort: (key: SortKey) => void }) {
  const active = column.key === sort.key;
  return (
    <th className={`px-5 py-3.5 font-medium ${first ? 'sticky left-0 z-20 bg-[#eaf0f5] shadow-[4px_0_8px_-6px_rgba(16,42,67,.35)]' : ''}`}>
      {column.key ? (
        <button
          type="button"
          onClick={() => onSort(column.key!)}
          className={`inline-flex items-center gap-1 whitespace-nowrap ${active ? 'text-[#0d4a7c]' : 'text-slate-500'}`}
          aria-label={`按${column.label}排序`}
        >
          {column.label}
          <ArrowDown size={13} className={active && sort.direction === 'asc' ? 'rotate-180' : ''} />
        </button>
      ) : column.label}
    </th>
  );
}
function Num({ value, strong = false }: { value?: number; strong?: boolean }) {
  return (
    <td
      className="px-5 py-3.5 font-mono text-slate-600"
    >
      {value === undefined ? '--' : value.toFixed(3)}
    </td>
  );
}
function Change({ value }: { value?: number }) {
  return (
    <td
      className="px-5 py-3.5 font-mono text-slate-600"
    >
      {value === undefined
        ? '--'
        : `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`}
    </td>
  );
}
function Premium({ value }: { value?: number | null }) {
  return (
    <td
      className="px-5 py-3.5 font-mono text-slate-600"
    >
      {value === undefined || value === null
        ? '--'
        : `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`}
    </td>
  );
}
function Return({ value }: { value?: number | null }) {
  return (
    <td
      className="px-5 py-3.5 font-mono text-slate-600"
    >
      {value === undefined || value === null
        ? '--'
        : `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`}
    </td>
  );
}
