'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  BarChart3,
  CalendarRange,
  Download,
  Gauge,
  Info,
  Play,
  Target,
  TrendingUp,
} from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';

type HorizonKey = 'oneMonth' | 'threeMonths' | 'sixMonths' | 'oneYear';
type MetricKey = 'median' | 'mean' | 'winRate' | 'count';
type Metric = { median: number | null; mean: number | null; winRate: number | null; count: number };
type StatRow = {
  threshold: number;
  eventCount: number;
  metrics: Record<HorizonKey, Metric>;
  worstAdverse: number | null;
};
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
};
type PathGroup = {
  paths: Array<{ id: string; label: string; values: number[] }>;
  median: Array<number | null>;
  lower: Array<number | null>;
  upper: Array<number | null>;
};
type BacktestResult = {
  generatedAt: string;
  dataAsOf: string;
  startDate: string;
  symbol: 'NDX' | 'COMP';
  symbolName: string;
  years: number;
  peakDays: number;
  thresholds: number[];
  horizons: Array<{ key: HorizonKey; label: string; days: number }>;
  stats: StatRow[];
  pathGroups: Record<string, PathGroup>;
  events: Record<string, BacktestEvent[]>;
  methodology: string;
  source: string;
};

const horizonLabels: Record<HorizonKey, string> = {
  oneMonth: '1个月',
  threeMonths: '3个月',
  sixMonths: '6个月',
  oneYear: '1年',
};
const horizonKeys = Object.keys(horizonLabels) as HorizonKey[];
const metricLabels: Record<MetricKey, string> = {
  median: '中位数',
  mean: '平均值',
  winRate: '上涨概率',
  count: '样本数',
};
const barColors: Record<HorizonKey, string> = {
  oneMonth: '#4c9cff',
  threeMonths: '#35d4bb',
  sixMonths: '#9d6bff',
  oneYear: '#55eef0',
};

type RunParameters = { symbol: 'NDX' | 'COMP'; years: number; peakDays: number };

async function requestBacktest(
  { symbol, years, peakDays }: RunParameters,
  signal?: AbortSignal,
) {
  const response = await fetch(`/api/backtest?symbol=${symbol}&years=${years}&peakDays=${peakDays}`, {
    cache: 'no-store',
    signal,
  });
  const payload = (await response.json()) as BacktestResult & { error?: string };
  if (!response.ok) throw new Error(payload.error || `回测请求失败（${response.status}）`);
  return payload;
}

function formatPercent(value: number | null, signed = true) {
  if (value === null || !Number.isFinite(value)) return '--';
  return `${signed && value > 0 ? '+' : ''}${value.toFixed(1)}%`;
}

function metricValue(row: StatRow, horizon: HorizonKey, metric: MetricKey) {
  return row.metrics[horizon][metric];
}

function heatStyle(value: number | null, metric: MetricKey) {
  if (value === null || metric === 'count') return undefined;
  const normalized = metric === 'winRate' ? (value - 50) / 30 : value / 20;
  const strength = Math.min(0.78, 0.16 + Math.abs(normalized) * 0.48);
  return {
    background: normalized >= 0
      ? `rgba(24, 215, 208, ${strength})`
      : `rgba(235, 170, 35, ${strength})`,
  };
}

export function DrawdownBacktest() {
  const [symbol, setSymbol] = useState<'NDX' | 'COMP'>('NDX');
  const [yearsInput, setYearsInput] = useState('10');
  const [peakDays, setPeakDays] = useState(252);
  const [focusThreshold, setFocusThreshold] = useState(10);
  const [focusHorizon, setFocusHorizon] = useState<HorizonKey>('oneYear');
  const [metric, setMetric] = useState<MetricKey>('median');
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [completion, setCompletion] = useState<{ id: number; text: string } | null>(null);
  const requestSequence = useRef(0);
  const activeRequest = useRef<AbortController | null>(null);
  const selectedParameters = useRef<RunParameters>({ symbol: 'NDX', years: 10, peakDays: 252 });
  const yearsInputRef = useRef('10');

  const executeBacktest = useCallback(async (parameters: RunParameters, announce: boolean) => {
    const requestId = ++requestSequence.current;
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    const startedAt = performance.now();
    setLoading(true);
    setError('');
    if (announce) setCompletion(null);
    try {
      const [payload] = await Promise.all([
        requestBacktest(parameters, controller.signal),
        new Promise((resolve) => setTimeout(resolve, 700)),
      ]);
      if (requestId !== requestSequence.current) return;
      setResult(payload);
      if (announce) {
        const elapsed = Math.max(0.7, (performance.now() - startedAt) / 1000).toFixed(1);
        setCompletion({
          id: Date.now(),
          text: `回测完成 · ${payload.symbolName} · 近${payload.years}年 · 数据截至 ${payload.dataAsOf} · 用时 ${elapsed} 秒`,
        });
      }
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === 'AbortError') return;
      if (requestId !== requestSequence.current) return;
      setError(caught instanceof Error ? caught.message : '暂时无法获取回测数据');
    } finally {
      if (requestId === requestSequence.current) {
        setLoading(false);
        if (activeRequest.current === controller) activeRequest.current = null;
      }
    }
  }, []);

  const runBacktest = useCallback(() => {
    void executeBacktest({ ...selectedParameters.current }, true);
  }, [executeBacktest]);

  const changeSymbol = (nextSymbol: 'NDX' | 'COMP') => {
    selectedParameters.current.symbol = nextSymbol;
    setSymbol(nextSymbol);
  };
  const changeYears = (nextValue: string) => {
    yearsInputRef.current = nextValue;
    setYearsInput(nextValue);
    const parsed = Number(nextValue);
    if (/^\d+$/.test(nextValue) && Number.isInteger(parsed) && parsed >= 3 && parsed <= 25) {
      selectedParameters.current.years = parsed;
    }
  };
  const normalizeYears = () => {
    const parsed = Number(yearsInputRef.current);
    const fallback = selectedParameters.current.years;
    const safeYears = yearsInputRef.current.trim() && Number.isFinite(parsed)
      ? Math.min(25, Math.max(3, Math.round(parsed)))
      : fallback;
    const normalized = String(safeYears);
    yearsInputRef.current = normalized;
    selectedParameters.current.years = safeYears;
    setYearsInput(normalized);
  };
  const changePeakDays = (nextPeakDays: number) => {
    selectedParameters.current.peakDays = nextPeakDays;
    setPeakDays(nextPeakDays);
  };

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void executeBacktest({ symbol: 'NDX', years: 10, peakDays: 252 }, false);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      activeRequest.current?.abort();
    };
  }, [executeBacktest]);

  const parsedYears = Number(yearsInput);
  const yearsValid = /^\d+$/.test(yearsInput)
    && Number.isInteger(parsedYears)
    && parsedYears >= 3
    && parsedYears <= 25;
  const parametersChanged = Boolean(
    result && (result.symbol !== symbol || !yearsValid || result.years !== parsedYears || result.peakDays !== peakDays),
  );

  const focusStat = result?.stats.find((row) => row.threshold === focusThreshold) ?? null;
  const focusEvents = result?.events[String(focusThreshold)] ?? [];
  const focusPaths = result?.pathGroups[String(focusThreshold)] ?? null;

  const exportCsv = () => {
    if (!result) return;
    const rows = [
      ['触发日', '次日开盘买入日', '阈值', '触发回撤', '阶段高点日', '买入价', '1个月', '3个月', '6个月', '1年', '持有期最大浮亏'],
      ...focusEvents.map((event) => [
        event.triggerDate,
        event.entryDate,
        `${event.threshold}%`,
        `${event.drawdown}%`,
        event.peakDate,
        event.entryPrice,
        event.returns.oneMonth ?? '',
        event.returns.threeMonths ?? '',
        event.returns.sixMonths ?? '',
        event.returns.oneYear ?? '',
        event.maxAdverse ?? '',
      ]),
    ];
    const csv = `\uFEFF${rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(',')).join('\n')}`;
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${result.symbol}-回撤${focusThreshold}%-回测.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="bt-shell" aria-busy={loading}>
      <div className="bt-heading">
        <div>
          <p className="bt-kicker">NASDAQ DRAWDOWN LAB</p>
          <h2><Activity aria-hidden="true" />纳斯达克回撤收益回测</h2>
          <p>阶段高点回撤之后，历史收益如何变化？</p>
        </div>
        <div className="bt-heading-note">
          <TrendingUp aria-hidden="true" />
          <span>真实历史日线 · 多周期统计</span>
          <small>历史结果不代表未来表现</small>
        </div>
      </div>

      <div className="bt-controls" aria-label="回测参数">
        <label>
          <span>标的</span>
          <select value={symbol} disabled={loading} onChange={(event) => changeSymbol(event.target.value as 'NDX' | 'COMP')}>
            <option value="NDX">纳斯达克100</option>
            <option value="COMP">纳斯达克综合</option>
          </select>
        </label>
        <label>
          <span>回测范围</span>
          <span className="bt-number-field">
            <input
              type="number"
              min={3}
              max={25}
              inputMode="numeric"
              value={yearsInput}
              aria-invalid={!yearsValid}
              disabled={loading}
              onChange={(event) => changeYears(event.target.value)}
              onBlur={normalizeYears}
            />
            年
          </span>
        </label>
        <label>
          <span>阶段高点</span>
          <select value={peakDays} disabled={loading} onChange={(event) => changePeakDays(Number(event.target.value))}>
            <option value={126}>近126交易日最高收盘价</option>
            <option value={252}>近252交易日最高收盘价</option>
            <option value={756}>近756交易日最高收盘价</option>
          </select>
        </label>
        <button className="bt-run" type="button" onClick={runBacktest} disabled={loading || !yearsValid}>
          {loading ? <Spinner className="h-4 w-4" /> : <Play size={16} fill="currentColor" />}
          {loading ? '计算中' : '运行回测'}
        </button>
      </div>

      <div className="bt-filter-row">
        <div className="bt-chip-group" aria-label="回撤阈值">
          <span>回撤阈值</span>
          {[5, 8, 10, 15, 20, 25, 30].map((threshold) => (
            <button
              key={threshold}
              type="button"
              className={focusThreshold === threshold ? 'active' : ''}
              aria-pressed={focusThreshold === threshold}
              disabled={loading}
              onClick={() => setFocusThreshold(threshold)}
            >
              {threshold}%
            </button>
          ))}
        </div>
        <div className="bt-chip-group" aria-label="持有周期">
          <span>持有周期</span>
          {horizonKeys.map((key) => (
            <button
              key={key}
              type="button"
              className={focusHorizon === key ? 'active' : ''}
              aria-pressed={focusHorizon === key}
              disabled={loading}
              onClick={() => setFocusHorizon(key)}
            >
              {horizonLabels[key]}
            </button>
          ))}
        </div>
      </div>

      {!loading && (
        <output
          key={!yearsValid ? 'invalid' : parametersChanged ? 'pending' : completion?.id ?? 'ready'}
          className={`bt-run-status ${!yearsValid ? 'invalid' : parametersChanged ? 'pending' : 'complete'}`}
          aria-live="polite"
        >
          {!yearsValid
            ? '请输入 3–25 之间的整数年限。'
            : parametersChanged
            ? '参数已修改，点击“运行回测”应用新的标的、年限或阶段高点。'
            : completion?.text ?? (result ? `当前结果已就绪 · ${result.symbolName} · 近${result.years}年` : '')}
        </output>
      )}

      <p className="bt-method"><Info size={15} />首次跌破阈值触发 · 次一交易日开盘买入 · 创出新的阶段高点后重新计数</p>

      {error && (
        <div className="bt-error" role="alert">
          <span>回测数据暂时未能加载：{error}</span>
          <button type="button" onClick={runBacktest}>重新计算</button>
        </div>
      )}

      <div className="bt-summary-grid">
        <SummaryCard icon={<Target />} label="有效事件" value={focusStat ? String(focusStat.eventCount) : '--'} suffix="次" note={`回撤 ≥ ${focusThreshold}% 的独立事件`} />
        <SummaryCard icon={<BarChart3 />} label={`${horizonLabels[focusHorizon]}收益中位数`} value={focusStat ? formatPercent(focusStat.metrics[focusHorizon].median) : '--'} note={`${focusStat?.metrics[focusHorizon].count ?? '--'} 个完整持有期样本`} />
        <SummaryCard icon={<TrendingUp />} label={`${horizonLabels[focusHorizon]}上涨概率`} value={focusStat ? formatPercent(focusStat.metrics[focusHorizon].winRate, false) : '--'} note="持有期收益为正的比例" />
        <SummaryCard icon={<Gauge />} label="买入后最大浮亏" value={focusStat ? formatPercent(focusStat.worstAdverse) : '--'} note="所选事件中最差历史样本" warning />
      </div>

      <div className="bt-panel bt-heat-panel">
        <div className="bt-panel-head">
          <div><h3><CalendarRange />回撤幅度 × 后续收益</h3><p>{result ? `${result.symbolName} · ${result.startDate} 至 ${result.dataAsOf}` : '等待回测数据'}</p></div>
          <div className="bt-metric-tabs" aria-label="统计口径">
            {(Object.keys(metricLabels) as MetricKey[]).map((key) => (
              <button key={key} type="button" className={metric === key ? 'active' : ''} onClick={() => setMetric(key)}>{metricLabels[key]}</button>
            ))}
          </div>
        </div>
        <div className="bt-table-wrap">
          <table className="bt-heat-table">
            <thead><tr><th>回撤幅度</th>{horizonKeys.map((key) => <th key={key}>{horizonLabels[key]}</th>)}<th>事件数</th></tr></thead>
            <tbody>
              {(result?.stats ?? []).map((row) => (
                <tr key={row.threshold} className={row.threshold === focusThreshold ? 'selected' : ''} onClick={() => setFocusThreshold(row.threshold)}>
                  <th>回撤 ≥ {row.threshold}%</th>
                  {horizonKeys.map((key) => {
                    const value = metricValue(row, key, metric);
                    return <td key={key} style={heatStyle(value, metric)}>{metric === 'count' ? value ?? '--' : formatPercent(value, metric !== 'winRate')}</td>;
                  })}
                  <td>{row.eventCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="bt-legend"><span>橙色：负收益</span><i /><span>青色：正收益</span><small>点击任一行可联动下方图表</small></div>
      </div>

      <div className="bt-chart-grid">
        <div className="bt-panel">
          <div className="bt-panel-head"><div><h3><TrendingUp />触发后累计收益路径</h3><p>当前阈值：{focusThreshold}% · 中位数与 25%–75% 区间</p></div></div>
          <PathChart group={focusPaths} />
        </div>
        <div className="bt-panel">
          <div className="bt-panel-head"><div><h3><BarChart3 />不同回撤阈值的收益对比</h3><p>各持有周期的中位数收益</p></div></div>
          <BarChart rows={result?.stats ?? []} activeHorizon={focusHorizon} />
        </div>
      </div>

      <div className="bt-panel">
        <div className="bt-panel-head">
          <div><h3><Activity />历史触发事件明细</h3><p>当前显示回撤 ≥ {focusThreshold}% 的事件，未满持有期显示“--”</p></div>
          <button type="button" className="bt-export" onClick={exportCsv} disabled={!focusEvents.length}><Download size={15} />导出 CSV</button>
        </div>
        <div className="bt-table-wrap">
          <table className="bt-events-table">
            <thead><tr><th>触发日</th><th>触发回撤</th><th>次日买入日</th><th>1个月</th><th>3个月</th><th>6个月</th><th>1年</th><th>最大浮亏</th></tr></thead>
            <tbody>
              {focusEvents.slice(0, 18).map((event) => (
                <tr key={event.id}>
                  <th>{event.triggerDate}</th>
                  <td>{formatPercent(event.drawdown)}</td>
                  <td>{event.entryDate}</td>
                  {horizonKeys.map((key) => <td key={key} className={(event.returns[key] ?? 0) >= 0 ? 'positive' : 'negative'}>{formatPercent(event.returns[key])}</td>)}
                  <td className="negative">{formatPercent(event.maxAdverse)}</td>
                </tr>
              ))}
              {!focusEvents.length && <tr><td colSpan={8} className="bt-empty">当前条件下暂无完整事件</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="bt-footnote">
          <span>数据源：{result?.source ?? 'Nasdaq 官方历史日线'} · 数据截至 {result?.dataAsOf ?? '--'}</span>
          <span>收益未计交易费用、税费与汇率影响，仅供研究参考</span>
        </div>
      </div>

      {loading && (
        <output className="bt-loading" aria-live="polite">
          <div><Spinner className="h-6 w-6" /><strong>正在计算历史回撤收益</strong><span>正在读取 Nasdaq 日线并生成多周期统计…</span></div>
        </output>
      )}
    </section>
  );
}

function SummaryCard({ icon, label, value, suffix, note, warning = false }: { icon: React.ReactNode; label: string; value: string; suffix?: string; note: string; warning?: boolean }) {
  return (
    <div className={`bt-summary-card ${warning ? 'warning' : ''}`}>
      <div className="bt-summary-label">{icon}<span>{label}</span></div>
      <div className="bt-summary-value">{value}<small>{suffix}</small></div>
      <p>{note}</p>
    </div>
  );
}

function PathChart({ group }: { group: PathGroup | null }) {
  const chart = useMemo(() => {
    if (!group) return null;
    const all = [...group.lower, ...group.upper, ...group.median].filter((value): value is number => value !== null);
    if (!all.length) return null;
    const min = Math.min(-10, Math.floor(Math.min(...all) / 10) * 10);
    const max = Math.max(20, Math.ceil(Math.max(...all) / 10) * 10);
    return { min, max };
  }, [group]);
  if (!group || !chart) return <div className="bt-chart-empty">暂无可绘制路径</div>;
  const width = 720;
  const height = 300;
  const pad = { left: 48, right: 18, top: 18, bottom: 35 };
  const x = (day: number) => pad.left + (day / 252) * (width - pad.left - pad.right);
  const y = (value: number) => pad.top + ((chart.max - value) / (chart.max - chart.min)) * (height - pad.top - pad.bottom);
  const linePath = (values: Array<number | null>) => values.map((value, index) => value === null ? '' : `${index === 0 || values[index - 1] === null ? 'M' : 'L'}${x(index).toFixed(1)},${y(value).toFixed(1)}`).join(' ');
  const band = [
    ...group.upper.map((value, index) => value === null ? '' : `${index === 0 ? 'M' : 'L'}${x(index).toFixed(1)},${y(value).toFixed(1)}`),
    ...group.lower.map((value, index) => value === null ? '' : `L${x(252 - index).toFixed(1)},${y(group.lower[252 - index] ?? value).toFixed(1)}`),
    'Z',
  ].join(' ');
  const ticks = [chart.min, Math.round((chart.min + chart.max) / 2), chart.max];
  return (
    <div className="bt-svg-wrap">
      <svg viewBox={`0 0 ${width} ${height}`} aria-label="触发回撤后的累计收益路径图">
        <title>触发回撤后的累计收益路径图</title>
        {ticks.map((tick) => <g key={tick}><line x1={pad.left} x2={width - pad.right} y1={y(tick)} y2={y(tick)} className="bt-grid-line" /><text x={pad.left - 9} y={y(tick) + 4} textAnchor="end">{tick}%</text></g>)}
        {([0, 21, 63, 126, 252] as const).map((day) => <g key={day}><line x1={x(day)} x2={x(day)} y1={pad.top} y2={height - pad.bottom} className="bt-grid-line" /><text x={x(day)} y={height - 11} textAnchor="middle">{day === 0 ? '触发' : day === 21 ? '1月' : day === 63 ? '3月' : day === 126 ? '6月' : '1年'}</text></g>)}
        <path d={band} className="bt-band" />
        {group.paths.map((path) => <path key={path.id} d={linePath(path.values)} className="bt-event-line"><title>{path.label}</title></path>)}
        <path d={linePath(group.median)} className="bt-median-line" />
      </svg>
      <div className="bt-chart-keys"><span className="median">收益中位数</span><span className="range">25%–75%区间</span><span className="events">历史事件路径</span></div>
    </div>
  );
}

function BarChart({ rows, activeHorizon }: { rows: StatRow[]; activeHorizon: HorizonKey }) {
  const values = rows.flatMap((row) => horizonKeys.map((key) => row.metrics[key].median).filter((value): value is number => value !== null));
  if (!values.length) return <div className="bt-chart-empty">暂无可绘制数据</div>;
  const width = 720;
  const height = 300;
  const pad = { left: 48, right: 18, top: 32, bottom: 42 };
  const lowestValue = values.reduce((lowest, value) => Math.min(lowest, value), 0);
  const highestValue = values.reduce((highest, value) => Math.max(highest, value), 0);
  const min = Math.min(-10, Math.floor(lowestValue / 10) * 10);
  const max = Math.max(20, Math.ceil(highestValue / 10) * 10);
  const y = (value: number) => pad.top + ((max - value) / (max - min)) * (height - pad.top - pad.bottom);
  const baseline = y(0);
  const groupWidth = (width - pad.left - pad.right) / rows.length;
  const barWidth = Math.min(13, groupWidth / 5.4);
  return (
    <div className="bt-svg-wrap">
      <svg viewBox={`0 0 ${width} ${height}`} aria-label="不同回撤阈值的后续收益柱状图">
        <title>不同回撤阈值的后续收益柱状图</title>
        {[min, 0, max].map((tick) => <g key={tick}><line x1={pad.left} x2={width - pad.right} y1={y(tick)} y2={y(tick)} className="bt-grid-line" /><text x={pad.left - 9} y={y(tick) + 4} textAnchor="end">{tick}%</text></g>)}
        {rows.map((row, groupIndex) => {
          const center = pad.left + groupWidth * (groupIndex + 0.5);
          return <g key={row.threshold}>{horizonKeys.map((key, index) => {
            const value = row.metrics[key].median;
            if (value === null) return null;
            const barY = value >= 0 ? y(value) : baseline;
            return <rect key={key} x={center + (index - 1.5) * barWidth - barWidth / 2} y={barY} width={barWidth - 2} height={Math.max(1, Math.abs(y(value) - baseline))} rx={2} fill={barColors[key]} opacity={key === activeHorizon ? 1 : 0.62}><title>{`${row.threshold}% · ${horizonLabels[key]}：${formatPercent(value)}`}</title></rect>;
          })}<text x={center} y={height - 14} textAnchor="middle">{row.threshold}%</text></g>;
        })}
      </svg>
      <div className="bt-chart-keys">{horizonKeys.map((key) => <span key={key} className={key === activeHorizon ? 'active' : ''}><i style={{ background: barColors[key] }} />{horizonLabels[key]}</span>)}</div>
    </div>
  );
}
