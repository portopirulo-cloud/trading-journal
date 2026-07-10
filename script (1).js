// ---------- State ----------
let trades = JSON.parse(localStorage.getItem('trades') || '[]');
let activeFilter = '';

// Migration: older versions of this journal didn't store an id per trade.
// Without one, the delete button has nothing reliable to match against.
let needsIdMigration = false;
trades = trades.map(t => {
  if (!t.id) {
    needsIdMigration = true;
    return { ...t, id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8) };
  }
  return t;
});
if (needsIdMigration) localStorage.setItem('trades', JSON.stringify(trades));

const els = {
  tbody: document.getElementById('tbody'),
  emptyState: document.getElementById('emptyState'),
  wr: document.getElementById('wr'),
  ops: document.getElementById('ops'),
  pf: document.getElementById('pf'),
  avgR: document.getElementById('avgR'),
  streak: document.getElementById('streak'),
  balanceDisplay: document.getElementById('balanceDisplay'),
  pnlBadge: document.getElementById('pnlBadge'),
  startBalance: document.getElementById('startBalance'),
  equitySub: document.getElementById('equitySub'),
  equityChart: document.getElementById('equityChart'),
  filterAsset: document.getElementById('filterAsset'),
  tradeForm: document.getElementById('tradeForm'),
};

// ---------- Helpers ----------
const fmtMoney = n => (n < 0 ? '-$' : '$') + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pnlOf = t => Number(t.risk) * Number(t.rr);
const todayISO = () => new Date().toISOString().slice(0, 10);

document.getElementById('date').value = todayISO();

// ---------- Persistence ----------
function save() {
  localStorage.setItem('trades', JSON.stringify(trades));
  localStorage.setItem('startBalance', els.startBalance.value);
}

const savedStart = localStorage.getItem('startBalance');
if (savedStart) els.startBalance.value = savedStart;

// ---------- Filters ----------
function refreshAssetFilter() {
  const current = els.filterAsset.value;
  const assets = [...new Set(trades.map(t => t.asset).filter(Boolean))].sort();
  els.filterAsset.innerHTML = '<option value="">Todos los activos</option>' +
    assets.map(a => `<option value="${a}">${a}</option>`).join('');
  if (assets.includes(current)) els.filterAsset.value = current;
}
els.filterAsset.addEventListener('change', () => { activeFilter = els.filterAsset.value; render(); });

// ---------- Render ----------
function render() {
  const startBalance = Number(els.startBalance.value) || 0;
  const list = activeFilter ? trades.filter(t => t.asset === activeFilter) : trades;

  // Table
  els.tbody.innerHTML = '';
  [...list].reverse().forEach(t => {
    const pnl = pnlOf(t);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="mono">${t.date}</td>
      <td>${t.asset}</td>
      <td>${t.direction === 'Compra' ? 'Long' : 'Short'}</td>
      <td><span class="badge badge-${t.result}">${t.result}</span></td>
      <td class="mono">${Number(t.rr) > 0 ? '+' : ''}${t.rr}R</td>
      <td class="pnl-cell ${pnl > 0 ? 'pos' : pnl < 0 ? 'neg' : ''}">${pnl === 0 ? fmtMoney(0) : fmtMoney(pnl)}</td>
      <td class="notes-cell">${t.notes ? escapeHtml(t.notes) : '—'}</td>
      <td><button class="row-delete" data-id="${t.id}" title="Borrar operación" type="button">✕</button></td>`;
    els.tbody.appendChild(tr);
  });
  els.emptyState.style.display = trades.length ? 'none' : 'block';

  // Stats (computed over ALL trades, not just filtered view)
  const total = trades.length;
  const wins = trades.filter(t => t.result === 'TP');
  const losses = trades.filter(t => t.result === 'SL');
  const winRateBase = wins.length + losses.length;
  els.wr.textContent = winRateBase ? ((wins.length / winRateBase) * 100).toFixed(1) + '%' : '—';
  els.ops.textContent = total;

  const grossWin = trades.filter(t => pnlOf(t) > 0).reduce((s, t) => s + pnlOf(t), 0);
  const grossLoss = Math.abs(trades.filter(t => pnlOf(t) < 0).reduce((s, t) => s + pnlOf(t), 0));
  els.pf.textContent = total ? (grossLoss === 0 ? (grossWin > 0 ? '∞' : '—') : (grossWin / grossLoss).toFixed(2)) : '—';

  const avgRVal = total ? trades.reduce((s, t) => s + Number(t.rr), 0) / total : null;
  els.avgR.textContent = avgRVal === null ? '—' : (avgRVal > 0 ? '+' : '') + avgRVal.toFixed(2) + 'R';
  els.avgR.className = 'stat-value' + (avgRVal > 0 ? ' pos' : avgRVal < 0 ? ' neg' : '');

  let streakCount = 0, streakType = null;
  for (let i = trades.length - 1; i >= 0; i--) {
    const r = trades[i].result;
    if (r === 'BE') break;
    if (streakType === null) { streakType = r; streakCount = 1; }
    else if (r === streakType) streakCount++;
    else break;
  }
  els.streak.textContent = streakType ? `${streakCount} ${streakType === 'TP' ? 'ganadas' : 'perdidas'}` : '—';
  els.streak.className = 'stat-value' + (streakType === 'TP' ? ' pos' : streakType === 'SL' ? ' neg' : '');

  // Balance
  const netPnl = trades.reduce((s, t) => s + pnlOf(t), 0);
  const currentBalance = startBalance + netPnl;
  els.balanceDisplay.textContent = fmtMoney(currentBalance);
  els.pnlBadge.textContent = (netPnl >= 0 ? '+' : '') + fmtMoney(netPnl);
  els.pnlBadge.className = 'pnl-badge' + (netPnl > 0 ? ' pos' : netPnl < 0 ? ' neg' : '');

  els.equitySub.textContent = total ? `${total} operaciones registradas` : 'Sin operaciones todavía';
  drawEquityCurve(startBalance);
  refreshAssetFilter();
  save();
}

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

// ---------- Equity curve ----------
function drawEquityCurve(startBalance) {
  const canvas = els.equityChart;
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const w = rect.width || canvas.parentElement.clientWidth;
  const h = 160;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.height = h + 'px';
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const points = [startBalance];
  trades.forEach(t => points.push(points[points.length - 1] + pnlOf(t)));

  if (points.length < 2) {
    ctx.strokeStyle = '#242B3A';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    ctx.stroke();
    ctx.setLineDash([]);
    return;
  }

  const min = Math.min(...points);
  const max = Math.max(...points);
  const pad = 16;
  const range = (max - min) || 1;
  const x = i => pad + (i / (points.length - 1)) * (w - pad * 2);
  const y = v => h - pad - ((v - min) / range) * (h - pad * 2);

  const rising = points[points.length - 1] >= points[0];
  const lineColor = rising ? '#23D488' : '#F5566E';

  // gradient fill
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, rising ? 'rgba(35,212,136,.25)' : 'rgba(245,86,110,.25)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.beginPath();
  ctx.moveTo(x(0), y(points[0]));
  points.forEach((v, i) => ctx.lineTo(x(i), y(v)));
  ctx.lineTo(x(points.length - 1), h);
  ctx.lineTo(x(0), h);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  // baseline (start balance)
  ctx.strokeStyle = '#242B3A';
  ctx.setLineDash([3, 4]);
  ctx.beginPath();
  ctx.moveTo(0, y(startBalance));
  ctx.lineTo(w, y(startBalance));
  ctx.stroke();
  ctx.setLineDash([]);

  // line
  ctx.beginPath();
  ctx.moveTo(x(0), y(points[0]));
  points.forEach((v, i) => ctx.lineTo(x(i), y(v)));
  ctx.strokeStyle = lineColor;
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.stroke();

  // last point dot
  ctx.beginPath();
  ctx.arc(x(points.length - 1), y(points[points.length - 1]), 3.5, 0, Math.PI * 2);
  ctx.fillStyle = lineColor;
  ctx.fill();
}

// ---------- Events ----------
els.tradeForm.addEventListener('submit', e => {
  e.preventDefault();
  trades.push({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    date: date.value,
    asset: asset.value.trim().toUpperCase(),
    direction: direction.value,
    result: result.value,
    rr: rr.value,
    risk: risk.value,
    notes: notes.value.trim(),
  });
  els.tradeForm.reset();
  document.getElementById('date').value = todayISO();
  render();
});

els.tbody.addEventListener('click', e => {
  const btn = e.target.closest('.row-delete');
  if (!btn) return;
  trades = trades.filter(t => t.id !== btn.dataset.id);
  render();
});

els.startBalance.addEventListener('input', render);

document.getElementById('exportBtn').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify({ startBalance: Number(els.startBalance.value), trades }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `trading-journal-${todayISO()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});

document.getElementById('importInput').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (Array.isArray(data.trades)) {
        trades = data.trades;
        if (data.startBalance) els.startBalance.value = data.startBalance;
        render();
      } else {
        alert('El archivo no tiene el formato esperado.');
      }
    } catch {
      alert('No se pudo leer el archivo JSON.');
    }
  };
  reader.readAsText(file);
  e.target.value = '';
});

document.getElementById('clearBtn').addEventListener('click', () => {
  if (trades.length && confirm('¿Borrar todas las operaciones? Esta acción no se puede deshacer.')) {
    trades = [];
    render();
  }
});

window.addEventListener('resize', () => drawEquityCurve(Number(els.startBalance.value) || 0));

render();
