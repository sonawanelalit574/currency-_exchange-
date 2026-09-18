"""Currency Exchange Rate app — live convert, table, and 30-day trend."""

from __future__ import annotations

from datetime import date, timedelta
from threading import Lock
from time import time

import requests
from flask import Flask, jsonify, render_template, request

app = Flask(__name__)

FRANKFURTER = "https://api.frankfurter.app"
CACHE_TTL_SEC = 15 * 60
HTTP_TIMEOUT = 12

_cache: dict[str, tuple[float, object]] = {}
_lock = Lock()

POPULAR = [
    "USD",
    "EUR",
    "GBP",
    "INR",
    "JPY",
    "AUD",
    "CAD",
    "CHF",
    "CNY",
    "SGD",
    "AED",
    "HKD",
    "NZD",
    "SEK",
    "KRW",
]


def _cache_get(key: str):
    with _lock:
        hit = _cache.get(key)
        if not hit:
            return None
        stored_at, value = hit
        if time() - stored_at > CACHE_TTL_SEC:
            _cache.pop(key, None)
            return None
        return value


def _cache_set(key: str, value) -> None:
    with _lock:
        _cache[key] = (time(), value)


def _get_json(path: str) -> dict:
    url = f"{FRANKFURTER}{path}"
    cached = _cache_get(url)
    if cached is not None:
        return cached
    response = requests.get(url, timeout=HTTP_TIMEOUT)
    response.raise_for_status()
    payload = response.json()
    _cache_set(url, payload)
    return payload


@app.route("/")
def index():
    return render_template("index.html")


@app.get("/api/currencies")
def currencies():
    try:
        names = _get_json("/currencies")
    except requests.RequestException as exc:
        return jsonify({"ok": False, "error": f"Could not load currencies: {exc}"}), 502
    codes = sorted(names.keys())
    popular = [c for c in POPULAR if c in names]
    return jsonify({"ok": True, "currencies": names, "codes": codes, "popular": popular})


@app.get("/api/convert")
def convert():
    amount = request.args.get("amount", "1")
    base = (request.args.get("from") or "USD").upper().strip()
    quote = (request.args.get("to") or "INR").upper().strip()
    try:
        value = float(amount)
    except (TypeError, ValueError):
        return jsonify({"ok": False, "error": "Amount must be a number"}), 400
    if value < 0:
        return jsonify({"ok": False, "error": "Amount cannot be negative"}), 400
    if base == quote:
        return jsonify(
            {
                "ok": True,
                "amount": value,
                "from": base,
                "to": quote,
                "rate": 1.0,
                "result": value,
                "date": date.today().isoformat(),
                "inverse": 1.0,
            }
        )
    try:
        payload = _get_json(f"/latest?amount={value}&from={base}&to={quote}")
    except requests.RequestException as exc:
        return jsonify({"ok": False, "error": f"Could not fetch rate: {exc}"}), 502
    rates = payload.get("rates") or {}
    if quote not in rates:
        return jsonify({"ok": False, "error": f"No rate for {base} → {quote}"}), 400
    result = float(rates[quote])
    rate = result / value if value else float(rates[quote])
    return jsonify(
        {
            "ok": True,
            "amount": value,
            "from": payload.get("base", base),
            "to": quote,
            "rate": rate,
            "result": result,
            "date": payload.get("date"),
            "inverse": (1.0 / rate) if rate else None,
        }
    )


@app.get("/api/latest")
def latest():
    base = (request.args.get("base") or "USD").upper().strip()
    try:
        payload = _get_json(f"/latest?from={base}")
    except requests.RequestException as exc:
        return jsonify({"ok": False, "error": f"Could not fetch rates: {exc}"}), 502
    rates = payload.get("rates") or {}
    popular = {code: rates[code] for code in POPULAR if code in rates and code != base}
    return jsonify(
        {
            "ok": True,
            "base": payload.get("base", base),
            "date": payload.get("date"),
            "rates": rates,
            "popular": popular,
        }
    )


@app.get("/api/history")
def history():
    base = (request.args.get("from") or "USD").upper().strip()
    quote = (request.args.get("to") or "INR").upper().strip()
    days = request.args.get("days", "30")
    try:
        span = max(7, min(int(days), 90))
    except (TypeError, ValueError):
        span = 30
    if base == quote:
        return jsonify({"ok": True, "from": base, "to": quote, "series": []})
    start = (date.today() - timedelta(days=span)).isoformat()
    try:
        payload = _get_json(f"/{start}..?from={base}&to={quote}")
    except requests.RequestException as exc:
        return jsonify({"ok": False, "error": f"Could not fetch history: {exc}"}), 502
    raw = payload.get("rates") or {}
    series = []
    for day in sorted(raw.keys()):
        day_rates = raw[day]
        if quote in day_rates:
            series.append({"date": day, "rate": float(day_rates[quote])})
    return jsonify(
        {
            "ok": True,
            "from": payload.get("base", base),
            "to": quote,
            "start": start,
            "series": series,
        }
    )


if __name__ == "__main__":
    app.run(debug=True, port=5007)
