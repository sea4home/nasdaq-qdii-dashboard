import assert from 'node:assert/strict';
import { buildEvents } from '../app/api/backtest/route.ts';

const SYMBOLS = ['NDX', 'COMP'];
const YEARS = Array.from({ length: 23 }, (_, index) => index + 3);
const PEAK_WINDOWS = [126, 252, 756];
const THRESHOLDS = [5, 8, 10, 15, 20, 25, 30];

function dateYearsAgo(years) {
  const date = new Date();
  date.setUTCFullYear(date.getUTCFullYear() - years);
  return date.toISOString().slice(0, 10);
}

function number(value) {
  const normalized = String(value ?? '').replace(/[^0-9.-]/g, '').trim();
  if (!normalized || normalized === '-' || normalized === '.' || normalized === '-.') return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function isoDate(value) {
  const [month, day, year] = String(value ?? '').split('/');
  return month && day && year
    ? `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
    : null;
}

async function history(symbol) {
  const rows = [];
  let offset = 0;
  let total = Infinity;
  while (offset < total) {
    const url = new URL(`https://api.nasdaq.com/api/quote/${symbol}/historical`);
    url.searchParams.set('assetclass', 'index');
    url.searchParams.set('fromdate', dateYearsAgo(29));
    url.searchParams.set('limit', '5000');
    url.searchParams.set('offset', String(offset));
    const response = await fetch(url, {
      cache: 'no-store',
      headers: {
        Accept: 'application/json, text/plain, */*',
        Referer: `https://www.nasdaq.com/market-activity/index/${symbol.toLowerCase()}/historical`,
        'User-Agent': 'Mozilla/5.0',
      },
    });
    assert.equal(response.ok, true, `${symbol} history request failed: ${response.status}`);
    const payload = await response.json();
    const page = payload.data?.tradesTable?.rows ?? [];
    assert.ok(page.length, `${symbol} history response was empty`);
    rows.push(...page);
    total = Number(payload.data?.totalRecords ?? page.length);
    offset += page.length;
    if (page.length < 5000) break;
  }
  const points = rows
    .map((row) => {
      const date = isoDate(row.date);
      const close = number(row.close);
      if (!date || close === null || close <= 0) return null;
      const open = number(row.open);
      const high = number(row.high);
      const low = number(row.low);
      return {
        date,
        close,
        open: open !== null && open > 0 ? open : close,
        high: high !== null && high > 0 ? high : close,
        low: low !== null && low > 0 ? low : close,
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.date.localeCompare(right.date));
  assert.ok(
    points.every((point) => point.open > 0 && point.high > 0 && point.low > 0 && point.close > 0),
    `${symbol} contains an invalid OHLC value`,
  );
  return points;
}

function referenceTriggers(points, startDate, peakDays) {
  const armed = new Map(THRESHOLDS.map((threshold) => [threshold, true]));
  const events = new Map(THRESHOLDS.map((threshold) => [threshold, []]));
  for (let index = 0; index < points.length; index++) {
    const windowStart = Math.max(0, index - peakDays + 1);
    let peakIndex = windowStart;
    for (let cursor = windowStart + 1; cursor <= index; cursor++) {
      if (points[cursor].close >= points[peakIndex].close) peakIndex = cursor;
    }
    if (peakIndex === index) THRESHOLDS.forEach((threshold) => armed.set(threshold, true));
    const drawdown = (points[index].close / points[peakIndex].close - 1) * 100;
    for (const threshold of THRESHOLDS) {
      if (!armed.get(threshold) || drawdown > -threshold) continue;
      armed.set(threshold, false);
      if (points[index].date >= startDate && index + 1 < points.length) {
        events.get(threshold).push(points[index].date);
      }
    }
  }
  return events;
}

function validateBoundaryRegression() {
  const closes = [100, 94, 93, 101, 94, 93];
  const points = closes.map((close, index) => ({
    date: `2024-01-${String(index + 1).padStart(2, '0')}`,
    open: close,
    high: close,
    low: close,
    close,
  }));
  const events = buildEvents(points, '2024-01-03', 126).get(5) ?? [];
  assert.deepEqual(events.map((event) => event.triggerDate), ['2024-01-05']);
}

validateBoundaryRegression();

let combinations = 0;
for (const symbol of SYMBOLS) {
  const points = await history(symbol);
  for (const years of YEARS) {
    const requestedStart = dateYearsAgo(years);
    const startDate = points.find((point) => point.date >= requestedStart)?.date ?? points[0].date;
    for (const peakDays of PEAK_WINDOWS) {
      const expected = referenceTriggers(points, startDate, peakDays);
      const actual = buildEvents(points, startDate, peakDays);
      for (const threshold of THRESHOLDS) {
        assert.deepEqual(
          (actual.get(threshold) ?? []).map((event) => event.triggerDate),
          expected.get(threshold),
          `${symbol} ${years}y peak=${peakDays} threshold=${threshold}%`,
        );
      }
      combinations += 1;
    }
  }
}

console.log(`Backtest validation passed: ${combinations} parameter combinations, ${combinations * THRESHOLDS.length} threshold series.`);
