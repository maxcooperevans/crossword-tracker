'use strict';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

let solves = [];
let config = { thresholds: [10, 20, 30] };
let lineChart = null;
let dowChart = null;
let medianMode = false;
let logExpanded = false;

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtTime(sec) {
  if (sec == null || isNaN(sec)) return '—';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function parseTime(str) {
  const m = str.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const mins = parseInt(m[1], 10);
  const secs = parseInt(m[2], 10);
  if (secs >= 60) return null;
  return mins * 60 + secs;
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function localDate(dateStr) {
  const [y, mo, d] = dateStr.split('-').map(Number);
  return new Date(y, mo - 1, d);
}

function dayOf(dateStr) {
  return localDate(dateStr).getDay();
}

function displayDate(dateStr) {
  return localDate(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function shiftDate(dateStr, delta) {
  const d = localDate(dateStr);
  d.setDate(d.getDate() + delta);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function computeMedian(arr) {
  if (!arr.length) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
    : sorted[mid];
}

function stdDev(arr) {
  if (arr.length < 2) return 0;
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  const variance = arr.reduce((s, v) => s + (v - mean) ** 2, 0) / arr.length;
  return Math.sqrt(variance);
}

function rollingAvg(data, window = 7) {
  return data.map((_, i) => {
    const slice = data.slice(Math.max(0, i - window + 1), i + 1);
    return Math.round(slice.reduce((a, b) => a + b, 0) / slice.length);
  });
}

// ── API ───────────────────────────────────────────────────────────────────────

async function fetchSolves() {
  const res = await fetch('/api/solves');
  solves = await res.json();
  solves.sort((a, b) => a.date.localeCompare(b.date));
}

async function fetchConfig() {
  const res = await fetch('/api/config');
  config = await res.json();
}

async function postSolve(seconds, date) {
  const res = await fetch('/api/solves', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ seconds, date }),
  });
  if (!res.ok) throw new Error('Save failed');
  return res.json();
}

async function deleteSolve(id) {
  await fetch(`/api/solves/${id}`, { method: 'DELETE' });
}

async function updateSolve(id, seconds) {
  const res = await fetch(`/api/solves/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ seconds }),
  });
  if (!res.ok) throw new Error('Update failed');
}

// ── Computations ─────────────────────────────────────────────────────────────

function computeStats() {
  if (!solves.length) return null;
  const times = solves.map(s => s.seconds);
  const best = Math.min(...times);
  const worst = Math.max(...times);
  const bestEntry = solves.find(s => s.seconds === best);
  const worstEntry = solves.find(s => s.seconds === worst);
  const avg = Math.round(times.reduce((a, b) => a + b, 0) / times.length);
  const sd = Math.round(stdDev(times));
  const top5 = [...times].sort((a, b) => a - b).slice(0, 5);
  const floor = Math.round(top5.reduce((a, b) => a + b, 0) / top5.length);

  const uniqueDays = [...new Set(solves.map(s => s.date))].sort();
  let current = 1, longest = 1, run = 1;
  for (let i = 1; i < uniqueDays.length; i++) {
    const diff = (localDate(uniqueDays[i]) - localDate(uniqueDays[i - 1])) / 86400000;
    if (diff === 1) { run++; } else { run = 1; }
    longest = Math.max(longest, run);
    current = run;
  }
  const today = todayStr();
  const yesterday = shiftDate(today, -1);
  const lastDay = uniqueDays[uniqueDays.length - 1];
  if (lastDay !== today && lastDay !== yesterday) current = 0;

  return { best, worst, bestEntry, worstEntry, avg, sd, floor, current, longest, total: solves.length };
}

function computeDowStats() {
  const buckets = Array.from({ length: 7 }, () => []);
  solves.forEach(s => buckets[dayOf(s.date)].push(s.seconds));
  return buckets.map((b, i) => {
    if (!b.length) return { day: DAY_NAMES[i], count: 0, avg: null, best: null, worst: null };
    return {
      day: DAY_NAMES[i],
      count: b.length,
      avg: Math.round(b.reduce((a, v) => a + v, 0) / b.length),
      best: Math.min(...b),
      worst: Math.max(...b),
    };
  });
}

// ── Render ────────────────────────────────────────────────────────────────────

function renderMasthead() {
  const total = solves.length;
  document.getElementById('masthead-right').textContent = `${total} solve${total !== 1 ? 's' : ''}`;
}

function renderPrimaryStats() {
  const s = computeStats();
  if (!s) return;
  document.getElementById('s-best').textContent = fmtTime(s.best);
  document.getElementById('s-best-date').textContent = s.bestEntry ? displayDate(s.bestEntry.date) : '';
  document.getElementById('s-worst').textContent = fmtTime(s.worst);
  document.getElementById('s-worst-date').textContent = s.worstEntry ? displayDate(s.worstEntry.date) : '';
  const allTimes = solves.map(sv => sv.seconds);
  const avgVal = medianMode ? computeMedian(allTimes) : s.avg;
  document.getElementById('s-avg').textContent = fmtTime(avgVal);
  document.getElementById('s-avg-sub').textContent = `across ${s.total} solve${s.total !== 1 ? 's' : ''}`;
  document.getElementById('avg-toggle').textContent = medianMode ? 'Median time ⇄' : 'Mean time ⇄';
  document.getElementById('s-std').textContent = fmtTime(s.sd);
  document.getElementById('s-streak').textContent = s.current;
  document.getElementById('s-longest').textContent = s.longest;
  document.getElementById('s-total').textContent = s.total;
  document.getElementById('s-floor').textContent = fmtTime(s.floor);
}

function renderThresholds() {
  const grid = document.getElementById('threshold-stats');
  grid.innerHTML = '';
  config.thresholds.forEach(thresh => {
    const count = solves.filter(s => s.seconds < thresh).length;
    const pct = solves.length ? Math.round((count / solves.length) * 100) : 0;
    const div = document.createElement('div');
    div.className = 'stat';
    div.innerHTML = `
      <div class="stat-label">Sub ${fmtTime(thresh)}</div>
      <div class="stat-value">${count}</div>
      <div class="stat-sub">${pct}% of solves</div>
    `;
    grid.appendChild(div);
  });
}

function renderLineChart() {
  const last30 = solves.slice(-30);
  if (!last30.length) {
    document.getElementById('line-section').classList.add('hidden');
    return;
  }
  document.getElementById('line-section').classList.remove('hidden');

  const labels = last30.map(s => {
    const [, mo, d] = s.date.split('-');
    return `${parseInt(d)}/${parseInt(mo)}`;
  });
  const data = last30.map(s => s.seconds);
  const rolling = rollingAvg(data, 7);

  const ctx = document.getElementById('line-chart').getContext('2d');
  if (lineChart) lineChart.destroy();

  lineChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Solve time',
          data,
          borderColor: '#000',
          backgroundColor: 'rgba(0,0,0,0.04)',
          borderWidth: 1.5,
          pointRadius: 3,
          pointBackgroundColor: '#000',
          tension: 0.25,
          fill: true,
          order: 2,
        },
        {
          label: '7-solve avg',
          data: rolling,
          borderColor: '#999',
          borderWidth: 1.5,
          borderDash: [5, 4],
          pointRadius: 0,
          fill: false,
          tension: 0.35,
          order: 1,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => `  ${ctx.dataset.label}: ${fmtTime(ctx.raw)}`,
          },
          bodyFont: { family: 'Times New Roman' },
          titleFont: { family: 'Times New Roman' },
        },
      },
      scales: {
        y: {
          ticks: {
            callback: v => fmtTime(v),
            font: { family: 'Times New Roman', size: 11 },
            color: '#666',
          },
          grid: { color: 'rgba(0,0,0,0.06)' },
        },
        x: {
          ticks: {
            font: { family: 'Times New Roman', size: 11 },
            color: '#666',
            maxRotation: 45,
            autoSkip: false,
          },
          grid: { display: false },
        },
      },
    },
  });
}

function renderDowChart() {
  const stats = computeDowStats();
  const avgs = stats.map(s => s.avg);
  const hasData = avgs.some(v => v !== null);

  document.getElementById('dow-section').classList.toggle('hidden', !hasData);
  if (!hasData) return;

  const minAvg = Math.min(...avgs.filter(v => v !== null));
  const ctx = document.getElementById('dow-chart').getContext('2d');
  if (dowChart) dowChart.destroy();

  dowChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: DAY_NAMES,
      datasets: [{
        data: avgs,
        backgroundColor: avgs.map(v =>
          v === null ? 'rgba(0,0,0,0.08)' :
          v === minAvg ? '#000' : '#aaa'
        ),
        borderRadius: 0,
        borderSkipped: false,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => ctx.raw !== null ? `  ${fmtTime(ctx.raw)}` : '  No data',
          },
          bodyFont: { family: 'Times New Roman' },
          titleFont: { family: 'Times New Roman' },
        },
      },
      scales: {
        y: {
          ticks: {
            callback: v => fmtTime(v),
            font: { family: 'Times New Roman', size: 11 },
            color: '#666',
          },
          grid: { color: 'rgba(0,0,0,0.06)' },
        },
        x: {
          ticks: {
            font: { family: 'Times New Roman', size: 12, weight: '700' },
            color: '#000',
          },
          grid: { display: false },
        },
      },
    },
  });
}

function renderDowTable() {
  const stats = computeDowStats();
  const hasData = stats.some(s => s.count > 0);
  document.getElementById('dow-table-section').classList.toggle('hidden', !hasData);
  if (!hasData) return;

  const tbody = document.getElementById('dow-table-body');
  tbody.innerHTML = '';
  const bestAvg = Math.min(...stats.filter(s => s.avg !== null).map(s => s.avg));

  stats.forEach(s => {
    const tr = document.createElement('tr');
    if (s.count === 0) {
      tr.innerHTML = `<td>${s.day}</td><td colspan="4" class="td-muted">No data</td>`;
    } else {
      tr.innerHTML = `
        <td><strong>${s.day}</strong></td>
        <td class="td-time${s.avg === bestAvg ? ' td-best' : ''}">${fmtTime(s.avg)}</td>
        <td class="td-time">${fmtTime(s.best)}</td>
        <td class="td-time">${fmtTime(s.worst)}</td>
        <td class="td-muted">${s.count}</td>
      `;
    }
    tbody.appendChild(tr);
  });
}

function renderLog() {
  const tbody = document.getElementById('log-body');
  const empty = document.getElementById('log-empty');
  const showMoreBtn = document.getElementById('log-show-more');
  tbody.innerHTML = '';

  if (!solves.length) { empty.classList.remove('hidden'); showMoreBtn.classList.add('hidden'); return; }
  empty.classList.add('hidden');

  const bestTime = Math.min(...solves.map(s => s.seconds));
  const all = [...solves].reverse();
  const visible = logExpanded ? all : all.slice(0, 7);

  visible.forEach(s => {
    const tr = document.createElement('tr');
    const isBest = s.seconds === bestTime;
    tr.innerHTML = `
      <td>${displayDate(s.date)}</td>
      <td class="td-muted">${DAY_NAMES[dayOf(s.date)]}</td>
      <td class="td-time${isBest ? ' td-best' : ''}">${fmtTime(s.seconds)}${isBest ? ' ★' : ''}</td>
    `;
    tbody.appendChild(tr);
  });

  if (all.length > 7 && !logExpanded) {
    showMoreBtn.classList.remove('hidden');
    showMoreBtn.textContent = `Show more (${all.length - 7} more)`;
  } else {
    showMoreBtn.classList.add('hidden');
  }
}

function renderEditTable() {
  const section = document.getElementById('edit-section');
  if (!section || section.classList.contains('hidden')) return;
  const tbody = document.getElementById('edit-body');
  tbody.innerHTML = '';
  [...solves].reverse().forEach(s => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${displayDate(s.date)}</td>
      <td><input class="edit-time-input" type="text" value="${fmtTime(s.seconds)}" data-id="${s.id}" maxlength="5" /></td>
      <td><button class="edit-save-btn" data-id="${s.id}">Save</button></td>
      <td class="edit-status" data-id="${s.id}"></td>
    `;
    tbody.appendChild(tr);
  });
}

function renderAll() {
  renderMasthead();
  renderPrimaryStats();
  renderThresholds();
  renderLineChart();
  renderDowChart();
  renderDowTable();
  renderLog();
  renderEditTable();
}

// ── Date navigation ───────────────────────────────────────────────────────────

const dateInput = document.getElementById('date-input');
const dateNext = document.getElementById('date-next');

function updateDateNav() {
  dateNext.disabled = dateInput.value >= todayStr();
}

document.getElementById('date-prev').addEventListener('click', () => {
  dateInput.value = shiftDate(dateInput.value || todayStr(), -1);
  updateDateNav();
});

dateNext.addEventListener('click', () => {
  const shifted = shiftDate(dateInput.value || todayStr(), 1);
  if (shifted <= todayStr()) { dateInput.value = shifted; updateDateNav(); }
});

dateInput.addEventListener('change', updateDateNav);

// ── Time input auto-colon ─────────────────────────────────────────────────────

const timeInput = document.getElementById('time-input');
timeInput.addEventListener('input', e => {
  let v = e.target.value.replace(/[^\d:]/g, '');
  if (v.length === 2 && !v.includes(':') && e.inputType !== 'deleteContentBackward') v += ':';
  e.target.value = v;
});

// ── Form submit ───────────────────────────────────────────────────────────────

document.getElementById('entry-form').addEventListener('submit', async e => {
  e.preventDefault();
  const status = document.getElementById('entry-status');
  const seconds = parseTime(timeInput.value);
  if (seconds === null) {
    status.textContent = 'Please enter a valid time, e.g. 1:23';
    status.className = 'entry-status error';
    timeInput.focus();
    return;
  }
  const date = dateInput.value || todayStr();
  status.textContent = 'Saving…';
  status.className = 'entry-status';

  try {
    const entry = await postSolve(seconds, date);
    solves.push(entry);
    solves.sort((a, b) => a.date.localeCompare(b.date));
    renderAll();
    timeInput.value = '';
    status.textContent = `Recorded ${fmtTime(seconds)} on ${displayDate(date)}`;
    timeInput.focus();
  } catch {
    status.textContent = 'Failed to save. Is the server running?';
    status.className = 'entry-status error';
  }
});

// ── Show more ─────────────────────────────────────────────────────────────────

document.getElementById('log-show-more').addEventListener('click', () => {
  logExpanded = true;
  renderLog();
});

// ── PIN auth (write-lock only) ────────────────────────────────────────────────

let unlocked = false;

function setFormLocked(locked) {
  document.getElementById('entry-section').classList.toggle('hidden', locked);
  document.getElementById('unlock-row').classList.toggle('hidden', !locked);
  document.getElementById('edit-toggle-row').classList.toggle('hidden', locked);
}

async function initAuth() {
  const res = await fetch('/api/auth-required');
  const { required } = await res.json();
  if (!required) { unlocked = true; setFormLocked(false); return; }

  setFormLocked(true);

  document.getElementById('unlock-btn').addEventListener('click', () => {
    document.getElementById('pin-inline').classList.remove('hidden');
    document.getElementById('unlock-row').classList.add('hidden');
    document.getElementById('pin-input').focus();
  });

  async function attemptLogin() {
    const pinError = document.getElementById('pin-error');
    pinError.textContent = '';
    const r = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: document.getElementById('pin-input').value }),
    });
    if (r.ok) {
      unlocked = true;
      document.getElementById('pin-inline').classList.add('hidden');
      setFormLocked(false);
      document.getElementById('time-input').focus();
    } else {
      pinError.textContent = 'Incorrect PIN.';
      document.getElementById('pin-input').value = '';
      document.getElementById('pin-input').focus();
    }
  }

  document.getElementById('pin-submit').addEventListener('click', attemptLogin);
  document.getElementById('pin-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') attemptLogin();
  });
}

// ── Mean / Median toggle ──────────────────────────────────────────────────────

document.getElementById('avg-toggle').addEventListener('click', () => {
  medianMode = !medianMode;
  renderPrimaryStats();
});

// ── Edit entries ─────────────────────────────────────────────────────────────

document.getElementById('edit-toggle-btn').addEventListener('click', () => {
  const section = document.getElementById('edit-section');
  const isHidden = section.classList.toggle('hidden');
  document.getElementById('edit-toggle-btn').textContent = isHidden ? 'Edit entries' : 'Hide editor';
  if (!isHidden) renderEditTable();
});

document.getElementById('edit-body').addEventListener('click', async e => {
  const btn = e.target.closest('.edit-save-btn');
  if (!btn) return;
  const id = Number(btn.dataset.id);
  const input = document.querySelector(`.edit-time-input[data-id="${id}"]`);
  const status = document.querySelector(`.edit-status[data-id="${id}"]`);
  const seconds = parseTime(input.value);
  if (seconds === null) { status.textContent = 'Invalid'; return; }
  btn.disabled = true;
  status.textContent = '…';
  try {
    await updateSolve(id, seconds);
    const solve = solves.find(s => s.id === id);
    if (solve) solve.seconds = seconds;
    renderAll();
    status.textContent = '✓';
  } catch {
    status.textContent = 'Failed';
    btn.disabled = false;
  }
});

// ── Init ──────────────────────────────────────────────────────────────────────

dateInput.value = todayStr();
updateDateNav();

initAuth().then(() => Promise.all([fetchSolves(), fetchConfig()]).then(renderAll));
