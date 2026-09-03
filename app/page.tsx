'use client';
import { useEffect, useState } from 'react';
import { BarChart3, RefreshCw } from 'lucide-react';
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
type Snapshot = {
  generatedAt: string | null;
  funds: Fund[];
  sources?: string[];
};
const initial: Snapshot = { generatedAt: null, funds: universe };
const statusClass: Record<string, string> = {
  限大额: 'bg-amber-50 text-amber-700 border-amber-200',
  限制大额申购: 'bg-amber-50 text-amber-700 border-amber-200',
  暂停申购: 'bg-rose-50 text-rose-700 border-rose-200',
  开放申购: 'bg-emerald-50 text-emerald-700 border-emerald-200',
};

export default function Home() {
  const [snapshot, setSnapshot] = useState<Snapshot>(initial);
  const [loading, setLoading] = useState(false);
  async function refresh() {
    setLoading(true);
    try {
      const response = await fetch('/api/dashboard', { cache: 'no-store' });
      if (response.ok) setSnapshot(await response.json());
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void refresh();
  }, []);
  const etfs = snapshot.funds
    .filter((f) => f.type === '场内ETF')
    .sort((a, b) => (b.premium ?? -Infinity) - (a.premium ?? -Infinity));
  const offMarket = snapshot.funds.filter((f) => f.type !== '场内ETF');
  return (
    <main className="min-h-screen bg-[#f4f7f8]">
      <header className="hero-grid text-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-7 sm:px-8 lg:px-10">
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
            className="flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-2 text-sm"
          >
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
            {loading ? '更新中' : '刷新数据'}
          </button>
        </div>
      </header>
      <div className="mx-auto max-w-7xl px-5 py-10 sm:px-8 lg:px-10">
        <p className="mb-8 text-sm text-slate-500">
          {snapshot.generatedAt
            ? `数据请求时间：${new Date(snapshot.generatedAt).toLocaleString('zh-CN', { hour12: false })}`
            : '正在请求实时数据'}
          　·　微信端可左右滑动，第一列固定
        </p>
        <section>
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
                    {[
                      '涨跌幅',
                      '净值溢价率',
                      '近一年收益',
                      '今年收益',
                      '近3年收益',
                      '基金名称 / 代码',
                      '昨收',
                      '最新价',
                      '最新披露单位净值',
                      '净值日期',
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
                  {etfs.map((f) => (
                    <tr key={f.code} className="border-t border-slate-100">
                      <Change value={f.marketChange} />
                      <Premium value={f.premium} />
                      <Return value={f.performance?.oneYear} />
                      <Return value={f.performance?.yearToDate} />
                      <Return value={f.performance?.threeYear} />
                      <td className="px-5 py-3.5">
                        <p className="font-medium text-slate-800">{f.name}</p>
                        <p className="font-mono text-xs text-slate-400">
                          {f.code}
                        </p>
                      </td>
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
        <section className="mt-14">
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
        <footer className="mt-12 border-t border-slate-200 pt-5 text-xs text-slate-400">
          数据仅供信息参考，基金投资有风险。
        </footer>
      </div>
    </main>
  );
}
function Num({ value, strong = false }: { value?: number; strong?: boolean }) {
  return (
    <td
      className={`px-5 py-3.5 font-mono ${strong ? 'font-medium text-[#0d4a7c]' : 'text-slate-600'}`}
    >
      {value === undefined ? '--' : value.toFixed(3)}
    </td>
  );
}
function Change({ value }: { value?: number }) {
  return (
    <td
      className={`sticky left-0 z-10 bg-white px-5 py-3.5 font-mono shadow-[4px_0_8px_-6px_rgba(16,42,67,.28)] ${value === undefined ? 'text-slate-400' : value >= 0 ? 'text-rose-600' : 'text-emerald-700'}`}
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
      className={`px-5 py-3.5 font-mono font-semibold ${value === undefined || value === null ? 'text-slate-400' : value >= 0 ? 'text-rose-600' : 'text-emerald-700'}`}
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
      className={`px-5 py-3.5 font-mono ${value === undefined || value === null ? 'text-slate-400' : value >= 0 ? 'text-rose-600' : 'text-emerald-700'}`}
    >
      {value === undefined || value === null
        ? '--'
        : `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`}
    </td>
  );
}
