"""Refresh the public dashboard snapshot without any browser-side scraping.

Run: python scripts/update_data.py
The script uses only Python's standard library and writes public/data/latest.json.
"""

from __future__ import annotations

import json
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
UNIVERSE = ROOT / "data" / "fund_universe.json"
OUTPUT = ROOT / "public" / "data" / "latest.json"
HEADERS = {"User-Agent": "Mozilla/5.0", "Referer": "https://fund.eastmoney.com/"}


def fetch_json(url: str) -> dict | None:
    request = Request(url, headers=HEADERS)
    # Bound one slow upstream response so a scheduled refresh always finishes.
    for attempt in range(2):
        try:
            with urlopen(request, timeout=8) as response:
                return json.loads(response.read().decode("utf-8"))
        except (HTTPError, URLError, TimeoutError, json.JSONDecodeError) as error:
            if attempt == 1:
                print(f"WARN {url}: {error}", file=sys.stderr)
            time.sleep(1.0 * (attempt + 1))
    return None


def fetch_text(url: str) -> str | None:
    request = Request(url, headers=HEADERS)
    for attempt in range(2):
        try:
            with urlopen(request, timeout=12) as response:
                return response.read().decode("utf-8-sig")
        except (HTTPError, URLError, TimeoutError) as error:
            if attempt == 1:
                print(f"WARN {url}: {error}", file=sys.stderr)
            time.sleep(1.0 * (attempt + 1))
    return None


def exchange_secid(code: str) -> str:
    # 15xxxx ETFs trade in Shenzhen; 51xxxx ETFs trade in Shanghai.
    return f"{'0' if code.startswith('15') else '1'}.{code}"


def latest_nav(code: str) -> dict:
    payload = fetch_json(
        f"https://api.fund.eastmoney.com/f10/lsjz?fundCode={code}&pageIndex=1&pageSize=1"
    )
    rows = ((payload or {}).get("Data") or {}).get("LSJZList") or []
    if not rows:
        return {}
    row = rows[0]
    return {
        "nav": row.get("DWJZ"),
        "navDate": row.get("FSRQ"),
        "navChange": row.get("JZZZL"),
        "purchaseStatus": row.get("SGZT"),
        "redemptionStatus": row.get("SHZT"),
    }


def etf_quotes(codes: list[str]) -> dict[str, dict]:
    """Fetch all ETF quotes in one Eastmoney request to reduce timeout risk."""
    secids = ",".join(exchange_secid(code) for code in codes)
    payload = fetch_json(
        "https://push2.eastmoney.com/api/qt/ulist.np/get?"
        f"fltt=2&invt=2&fields=f2,f3,f12,f14,f18,f124&secids={secids}"
    )
    rows = ((payload or {}).get("data") or {}).get("diff") or []
    return {
        str(row["f12"]): {
            "marketPrice": row.get("f2"),
            "marketChange": row.get("f3"),
            "previousClose": row.get("f18"),
            "quoteName": row.get("f14"),
            "quoteTimestamp": row.get("f124"),
        }
        for row in rows
        if row.get("f12")
    }


def shift_years(value: date, years: int) -> date:
    try:
        return value.replace(year=value.year - years)
    except ValueError:
        # February 29 maps to February 28 in a non-leap reference year.
        return value.replace(year=value.year - years, month=2, day=28)


def nav_performance(code: str) -> dict:
    """Compute fund-NAV returns from Eastmoney's complete net-worth history."""
    source = fetch_text(f"https://fund.eastmoney.com/pingzhongdata/{code}.js?v={int(time.time())}")
    match = re.search(r"var Data_netWorthTrend\s*=\s*(\[.*?\]);", source or "", re.S)
    if not match:
        return {}
    try:
        trend = json.loads(match.group(1))
    except json.JSONDecodeError:
        return {}

    points = []
    for row in trend:
        if not isinstance(row.get("x"), (int, float)) or not isinstance(row.get("y"), (int, float)):
            continue
        points.append((datetime.fromtimestamp(row["x"] / 1000, timezone.utc).date(), row["y"]))
    if not points:
        return {}

    as_of, latest = points[-1]

    def return_from(target: date) -> float | None:
        reference = next((value for point_date, value in reversed(points) if point_date <= target), None)
        return round((latest / reference - 1) * 100, 2) if reference else None

    return {
        "performance": {
            "asOf": as_of.isoformat(),
            "oneYear": return_from(shift_years(as_of, 1)),
            "yearToDate": return_from(date(as_of.year, 1, 1)),
            "threeYear": return_from(shift_years(as_of, 3)),
            "basis": "单位净值累计收益",
        }
    }


def refresh_fund(fund: dict, quotes: dict[str, dict], performances: dict[str, dict]) -> dict:
    record = {**fund, **latest_nav(fund["code"])}
    if fund["type"] == "场内ETF":
        record.update(quotes.get(fund["code"], {}))
        record.update(performances.get(fund["code"], {}))
        # IOPV is deliberately not inferred from a previous NAV.
        record["iopv"] = None
        record["premium"] = None
        record["premiumStatus"] = "未接入实时 IOPV，暂不计算溢价"
    return record


def main() -> None:
    universe = json.loads(UNIVERSE.read_text(encoding="utf-8"))
    etf_codes = [fund["code"] for fund in universe if fund["type"] == "场内ETF"]
    quotes = etf_quotes(etf_codes)
    with ThreadPoolExecutor(max_workers=6) as executor:
        performances = dict(zip(etf_codes, executor.map(nav_performance, etf_codes)))
    print(f"Refreshing {len(universe)} funds with six bounded workers...")
    with ThreadPoolExecutor(max_workers=6) as executor:
        refreshed = list(executor.map(lambda fund: refresh_fund(fund, quotes, performances), universe))

    snapshot = {
        "generatedAt": datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds"),
        "sources": {
            "nav": "天天基金 / 东方财富历史净值接口",
            "etfQuote": "东方财富行情接口",
            "etfPerformance": "东方财富基金档案单位净值走势接口",
            "qdiiQuota": "国家外汇管理局 QDII 投资额度审批情况表（建议人工复核）",
        },
        "notes": [
            "场外净值通常按基金公司披露频率更新，不等同实时估值。",
            "场内 ETF 溢价必须使用同一时点 IOPV 计算；未接入时显示为空。",
            "申购及赎回状态以基金公司最新公告为准。",
        ],
        "funds": refreshed,
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote {OUTPUT}")


if __name__ == "__main__":
    main()
