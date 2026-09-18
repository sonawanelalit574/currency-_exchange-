const amountEl = document.getElementById("amount");
const fromEl = document.getElementById("fromCcy");
const toEl = document.getElementById("toCcy");
const swapBtn = document.getElementById("swapBtn");
const resultMain = document.getElementById("resultMain");
const resultMeta = document.getElementById("resultMeta");
const asOf = document.getElementById("asOf");
const rateBody = document.getElementById("rateBody");
const tableBase = document.getElementById("tableBase");
const trendChart = document.getElementById("trendChart");
const trendLabel = document.getElementById("trendLabel");
const trendCaption = document.getElementById("trendCaption");

let names = {};
let timer = null;

function fmt(n, digits = 4) {
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-IN", {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  }).format(n);
}

function fillSelect(el, codes, selected) {
  el.innerHTML = codes
    .map((code) => {
      const label = names[code] ? `${code} — ${names[code]}` : code;
      const sel = code === selected ? " selected" : "";
      return `<option value="${code}"${sel}>${label}</option>`;
    })
    .join("");
}

async function loadCurrencies() {
  const res = await fetch("/api/currencies");
  const data = await res.json();
  if (!data.ok) throw new Error(data.error);
  names = data.currencies;
  const popular = data.popular || [];
  const rest = data.codes.filter((c) => !popular.includes(c));
  const ordered = [...popular, ...rest];
  fillSelect(fromEl, ordered, "USD");
  fillSelect(toEl, ordered, "INR");
}

async function convert() {
  const amount = amountEl.value || "0";
  const from = fromEl.value;
  const to = toEl.value;
  const res = await fetch(
    `/api/convert?amount=${encodeURIComponent(amount)}&from=${from}&to=${to}`
  );
  const data = await res.json();
  if (!data.ok) {
    resultMain.textContent = "Unable to convert";
    resultMeta.textContent = data.error || "Try again";
    resultMeta.classList.add("error");
    return;
  }
  resultMeta.classList.remove("error");
  resultMain.textContent = `${fmt(data.result, 4)} ${data.to}`;
  resultMeta.textContent = `1 ${data.from} = ${fmt(data.rate, 6)} ${data.to}  ·  1 ${data.to} = ${fmt(data.inverse, 6)} ${data.from}`;
  if (data.date) {
    asOf.textContent = `ECB reference date ${data.date}`;
  }
}

async function loadTable() {
  const base = fromEl.value;
  const res = await fetch(`/api/latest?base=${base}`);
  const data = await res.json();
  if (!data.ok) {
    rateBody.innerHTML = `<tr><td colspan="3">${data.error}</td></tr>`;
    return;
  }
  tableBase.textContent = `Base ${data.base}`;
  const rows = Object.entries(data.popular);
  rateBody.innerHTML = rows
    .map(
      ([code, rate]) =>
        `<tr><td>${code}</td><td>${names[code] || ""}</td><td class="num">${fmt(rate, 4)}</td></tr>`
    )
    .join("");
}

function drawTrend(series) {
  const w = 360;
  const h = 160;
  const pad = 10;
  if (!series.length) {
    trendChart.innerHTML = "";
    trendCaption.textContent = "No history for this pair (same currency).";
    return;
  }
  const values = series.map((p) => p.rate);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = series.map((p, i) => {
    const x = pad + (i / Math.max(series.length - 1, 1)) * (w - pad * 2);
    const y = h - pad - ((p.rate - min) / span) * (h - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const first = pts[0];
  const last = pts[pts.length - 1];
  trendChart.innerHTML = `
    <polyline fill="none" stroke="#3dd6c6" stroke-width="2"
      points="${pts.join(" ")}" />
    <circle cx="${last.split(",")[0]}" cy="${last.split(",")[1]}" r="3" fill="#3dd6c6" />
    <text x="${pad}" y="14" fill="#8b99ab" font-size="10">${fmt(max, 4)}</text>
    <text x="${pad}" y="${h - 2}" fill="#8b99ab" font-size="10">${fmt(min, 4)}</text>
  `;
  const firstDate = series[0].date;
  const lastDate = series[series.length - 1].date;
  const change = ((values[values.length - 1] - values[0]) / values[0]) * 100;
  const sign = change >= 0 ? "+" : "";
  trendCaption.textContent = `${firstDate} → ${lastDate}  ·  ${sign}${change.toFixed(2)}%`;
  void first;
}

async function loadTrend() {
  const from = fromEl.value;
  const to = toEl.value;
  trendLabel.textContent = `${from} / ${to}`;
  const res = await fetch(`/api/history?from=${from}&to=${to}&days=30`);
  const data = await res.json();
  if (!data.ok) {
    trendCaption.textContent = data.error || "History unavailable";
    trendChart.innerHTML = "";
    return;
  }
  drawTrend(data.series || []);
}

async function refreshAll() {
  await Promise.all([convert(), loadTable(), loadTrend()]);
}

function scheduleRefresh() {
  clearTimeout(timer);
  timer = setTimeout(refreshAll, 180);
}

amountEl.addEventListener("input", scheduleRefresh);
fromEl.addEventListener("change", refreshAll);
toEl.addEventListener("change", refreshAll);
swapBtn.addEventListener("click", () => {
  const a = fromEl.value;
  fromEl.value = toEl.value;
  toEl.value = a;
  refreshAll();
});

loadCurrencies()
  .then(refreshAll)
  .catch((err) => {
    resultMain.textContent = "Could not start";
    resultMeta.textContent = err.message;
    resultMeta.classList.add("error");
  });
