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


def fetch_text(url: str, encoding: str = "utf-8-sig") -> str | None:
    request = Request(url, headers=HEADERS)
    for attempt in range(2):
        try:
            with urlopen(request, timeout=12) as response:
                return response.read().decode(encoding)
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


def all_fund_statuses() -> dict[str, dict]:
    """One Eastmoney response supplies NAV, purchase status and daily purchase cap."""
    source = fetch_text(
        "https://fund.eastmoney.com/Data/Fund_JJJZ_Data.aspx?t=8&page=1,50000&js=reData&sort=fcode,asc",
        encoding="gb18030",
    )
    match = re.search(r"var reData=(\{.*\});?$", source or "", re.S)
    if not match:
        return {}
    try:
        rows = json.loads(match.group(1)).get("datas", [])
    except json.JSONDecodeError:
        return {}
    expected = {fund["code"] for fund in json.loads(UNIVERSE.read_text(encoding="utf-8"))}
    current_year = date.today().year
    result = {}
    for row in rows:
        if row[0] not in expected:
            continue
        try:
            limit = float(row[9])
            daily_limit = "不限额" if limit >= 99_999_999_999 else ("0元" if limit == 0 else f"{limit:g}元")
        except (IndexError, TypeError, ValueError):
            daily_limit = None
        result[row[0]] = {
            "nav": row[3] or None,
            "navDate": f"{current_year}-{row[4]}" if row[4] else None,
            "purchaseStatus": row[5] or None,
            "redemptionStatus": row[6] or None,
            "dailyLimit": daily_limit,
        }
    return result


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


def tencent_etf_quotes(codes: list[str]) -> dict[str, dict]:
    """Get price and the quoted IOPV field used for the premium calculation."""
    symbols = ",".join(f"{'sz' if code.startswith('15') else 'sh'}{code}" for code in codes)
    text = fetch_text(f"https://qt.gtimg.cn/q={symbols}", encoding="gb18030")
    quotes: dict[str, dict] = {}
    for line in (text or "").splitlines():
        match = re.search(r'v_[a-z]{2}(\d{6})="(.*)"', line)
        if not match:
            continue
        values = match.group(2).split("~")
        try:
            price = float(values[3])
            iopv = float(values[85])
            # Do not replace a missing or implausible IOPV with the disclosed NAV.
            if price <= 0 or iopv <= 0 or abs(price / iopv - 1) >= 0.25:
                iopv = None
            quotes[match.group(1)] = {
                "marketPrice": price,
                "previousClose": float(values[4]) if float(values[4]) > 0 else None,
                "marketChange": float(values[32]),
                "quoteTimestamp": values[30] or None,
                "iopv": iopv,
            }
        except (IndexError, ValueError):
            continue
    return quotes


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


def refresh_fund(fund: dict, quotes: dict[str, dict], performances: dict[str, dict], statuses: dict[str, dict]) -> dict:
    live_status = statuses.get(fund["code"])
    record = {**fund, **(live_status if live_status is not None else latest_nav(fund["code"]))}
    if fund["type"] == "场内ETF":
        record.update(quotes.get(fund["code"], {}))
        record.update(performances.get(fund["code"], {}))
        try:
            price = float(record["marketPrice"])
            iopv = float(record["iopv"])
            record["premium"] = round((price - iopv) / iopv * 100, 2)
            record["premiumStatus"] = "按实时 IOPV 计算"
        except (KeyError, TypeError, ValueError, ZeroDivisionError):
            record["premium"] = None
            record["premiumStatus"] = "IOPV 暂不可用，未计算溢价率"
    return record


def main() -> None:
    universe = json.loads(UNIVERSE.read_text(encoding="utf-8"))
    etf_codes = [fund["code"] for fund in universe if fund["type"] == "场内ETF"]
    quotes = tencent_etf_quotes(etf_codes)
    missing_codes = [code for code in etf_codes if code not in quotes]
    # Eastmoney supplies a price-only fallback. Premium remains empty if Tencent IOPV is absent.
    quotes = {**etf_quotes(missing_codes), **quotes}
    statuses = all_fund_statuses()
    with ThreadPoolExecutor(max_workers=6) as executor:
        performances = dict(zip(etf_codes, executor.map(nav_performance, etf_codes)))
    print(f"Refreshing {len(universe)} funds with six bounded workers...")
    with ThreadPoolExecutor(max_workers=6) as executor:
        refreshed = list(executor.map(lambda fund: refresh_fund(fund, quotes, performances, statuses), universe))

    snapshot = {
        "generatedAt": datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds"),
        "sources": {
            "nav": "天天基金 / 东方财富历史净值接口",
            "etfQuote": "腾讯财经 ETF 行情接口（市价、IOPV）；东方财富行情为市价降级",
            "etfPerformance": "东方财富基金档案单位净值走势接口",
            "qdiiQuota": "国家外汇管理局 QDII 投资额度审批情况表（建议人工复核）",
        },
        "notes": [
            "场外净值通常按基金公司披露频率更新，不等同实时估值。",
            "场内 ETF 溢价率按（最新市价 - IOPV）/ IOPV 计算；缺少 IOPV 时不展示溢价率。",
            "申购及赎回状态以基金公司最新公告为准。",
        ],
        "funds": refreshed,
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote {OUTPUT}")


if __name__ == "__main__":
    main()
