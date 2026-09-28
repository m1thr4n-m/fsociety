/* ═══════════════════════════════════════════════════════════════
   UI FILE HANDLERS
   ═══════════════════════════════════════════════════════════════ */

document.querySelectorAll('.file-drop-area').forEach(area => {
  area.addEventListener('click', () => {
    const inputId = area.dataset.input;
    if (inputId) document.getElementById(inputId).click();
  });
});

['fileRisk', 'fileDates', 'fileExtra'].forEach(inputId => {
  const input = document.getElementById(inputId);
  const nameId = 'name' + inputId.replace('file', '');
  const nameEl = document.getElementById(nameId);
  const dropArea = input.closest('.file-drop-area');

  input.addEventListener('change', () => {
    if (input.files && input.files.length > 0) {
      nameEl.textContent = input.files[0].name;
      dropArea.classList.add('has-file');
    } else {
      nameEl.textContent = 'Tap to browse files...';
      dropArea.classList.remove('has-file');
    }
  });
});

/* ═══════════════════════════════════════════════════════════════
   APP STATE
   ═══════════════════════════════════════════════════════════════ */
let globalData = [];
let filteredData = [];
let selectedMeter = null;
let chartInstances = {};
let searchDebounceTimer = null;

const BATCH_SIZE = 500;
const RENDER_CHUNK = 2000;

const ICONS = {
  safe: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/></svg>`,
  flagged: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`
};

function showToast(msg, type = 'info') {
  const stack = document.getElementById('toastStack');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  const icon = type === 'error'
    ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`
    : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M20 6L9 17l-5-5"/></svg>`;
  el.innerHTML = `${icon}<span>${msg}</span>`;
  stack.appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 220); }, 2400);
}

/* ═══════════════════════════════════════════════════════════════
   CSV PARSING — WORKER-FREE STREAMING FOR 30K+ ROWS
   ═══════════════════════════════════════════════════════════════ */

const parseCSV = (file) => new Promise((resolve, reject) => {
  Papa.parse(file, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: false,
    worker: false,
    chunkSize: 1024 * 1024 * 4,
    complete: (r) => resolve(r.data),
    error: (e) => reject(e)
  });
});

const processBtn = document.getElementById('processBtn');
const originalBtnHTML = processBtn.innerHTML;

processBtn.addEventListener('click', async () => {
  const fileRisk = document.getElementById('fileRisk').files[0];
  const fileDates = document.getElementById('fileDates').files[0];

  if (!fileRisk || !fileDates) {
    showToast('Please select both Risk Scores and Theft Dates CSVs', 'error');
    return;
  }

  processBtn.innerHTML = 'Parsing 30,000+ rows...';
  processBtn.style.opacity = '0.7';
  processBtn.disabled = true;

  try {
    const t0 = performance.now();

    const [riskData, dateData] = await Promise.all([
      parseCSV(fileRisk),
      parseCSV(fileDates)
    ]);

    const tParse = performance.now();

    const dateMap = Object.create(null);
    for (let i = 0; i < dateData.length; i++) {
      const row = dateData[i];
      if (row.CONS_NO) dateMap[row.CONS_NO] = row.theft_start_date;
    }

    let flaggedCount = 0;
    const out = new Array(riskData.length);

    for (let i = 0; i < riskData.length; i++) {
      const row = riskData[i];

      let flag;
      if (row.FLAG !== undefined && row.FLAG !== '') {
        flag = row.FLAG === '1' || row.FLAG === 1 ? 1 : 0;
      } else {
        const parsed = parseFloat(row.risk_score);
        flag = parsed > 0.5 ? 1 : 0;
      }

      if (flag === 1) flaggedCount++;

      let score = parseFloat(row.risk_score);
      score = isNaN(score) ? 0 : score.toFixed(4);

      out[i] = {
        id: row.CONS_NO || 'Unknown ID',
        score: score,
        flag: flag,
        date: flag === 1 ? (dateMap[row.CONS_NO] || 'Investigating') : 'N/A'
      };
    }

    out.sort((a, b) => parseFloat(b.score) - parseFloat(a.score));
    globalData = out;
    filteredData = out;

    const tMerge = performance.now();

    document.getElementById('kpiTotal').innerText = globalData.length.toLocaleString();
    document.getElementById('kpiFlagged').innerText = flaggedCount.toLocaleString();
    const rate = globalData.length > 0
      ? ((flaggedCount / globalData.length) * 100).toFixed(2)
      : 0;
    document.getElementById('kpiRate').innerText = `${rate}%`;

    document.getElementById('diagnosticsSection').style.display = 'block';
    document.getElementById('chartsSection').style.display = 'block';

    updateListMeta();

    showToast(`Merged ${globalData.length.toLocaleString()} meters in ${((tMerge - t0) / 1000).toFixed(1)}s`);

    renderList();
    renderCharts();

    if (window.innerWidth < 860) {
      document.getElementById('diagnosticsSection').scrollIntoView({ behavior: 'smooth' });
    }
  } catch (err) {
    console.error(err);
    showToast('Error parsing files. Ensure they are valid CSVs.', 'error');
  } finally {
    processBtn.innerHTML = originalBtnHTML;
    processBtn.style.opacity = '1';
    processBtn.disabled = false;
  }
});

/* ═══════════════════════════════════════════════════════════════
   SEARCH — DEBOUNCED
   ═══════════════════════════════════════════════════════════════ */
document.getElementById('searchInput').addEventListener('input', (e) => {
  clearTimeout(searchDebounceTimer);
  const query = e.target.value.trim().toLowerCase();
  searchDebounceTimer = setTimeout(() => {
    if (!query) {
      filteredData = globalData;
    } else {
      filteredData = globalData.filter((d) => d.id.toLowerCase().includes(query));
    }
    updateListMeta();
    renderList();
  }, 120);
});

/* ═══════════════════════════════════════════════════════════════
   LIST RENDERING — FULL 30,000 VIA DOCUMENT FRAGMENT + CHUNKING
   ═══════════════════════════════════════════════════════════════ */
function updateListMeta() {
  let meta = document.getElementById('listMeta');
  if (!meta) {
    meta = document.createElement('div');
    meta.id = 'listMeta';
    meta.style.cssText = 'font-size:12px;font-weight:700;color:var(--label-2);padding:4px 0 10px 0;letter-spacing:.02em;';
    const listEl = document.getElementById('meterList');
    listEl.parentNode.insertBefore(meta, listEl);
  }
  const total = filteredData.length;
  const all = globalData.length;
  meta.innerText = total === all
    ? `Showing all ${total.toLocaleString()} meters`
    : `Showing ${total.toLocaleString()} of ${all.toLocaleString()} meters`;
}

function renderList() {
  const listEl = document.getElementById('meterList');
  listEl.innerHTML = '';

  if (filteredData.length === 0) {
    listEl.innerHTML = `<div style="color:var(--label-3);padding:10px 0;font-size:14px;">No meters found.</div>`;
    return;
  }

  const frag = document.createDocumentFragment();

  for (let i = 0; i < filteredData.length; i++) {
    frag.appendChild(buildMeterRow(filteredData[i]));
  }

  listEl.appendChild(frag);
}

function buildMeterRow(meter) {
  const btn = document.createElement('button');
  btn.className = 'radio-row' + (selectedMeter && selectedMeter.id === meter.id ? ' selected' : '');
  btn.dataset.id = meter.id;
  btn.addEventListener('click', () => selectMeter(meter, btn));

  const isFlagged = meter.flag === 1;
  const iconClass = isFlagged ? 'flagged' : 'safe';
  const badgeClass = isFlagged ? 'red' : 'green';
  const badgeText = isFlagged ? 'Anomaly' : 'Clear';
  const svg = isFlagged
    ? `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M10 2a8 8 0 100 16 8 8 0 000-16zM10 6v5M10 14h.01"/></svg>`
    : `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 10.5L8 15L16 5"/></svg>`;
  const displayId = meter.id.length > 18 ? meter.id.substring(0, 18) + '...' : meter.id;

  btn.innerHTML = `
    <div class="meter-icon ${iconClass}">${svg}</div>
    <div class="radio-body">
      <span class="radio-title">${displayId}</span>
      <span class="radio-desc">Risk: ${meter.score}</span>
      <span class="badge ${badgeClass}">${badgeText}</span>
    </div>
  `;
  return btn;
}

function selectMeter(meter, btnElement) {
  selectedMeter = meter;

  const prev = document.querySelector('.radio-row.selected');
  if (prev) prev.classList.remove('selected');
  btnElement.classList.add('selected');

  const isFlagged = meter.flag === 1;
  const hero = document.getElementById('detailHero');
  hero.className = `status-hero ${isFlagged ? 'flagged' : 'safe'}`;
  hero.innerHTML = isFlagged ? ICONS.flagged : ICONS.safe;

  document.getElementById('detailId').innerText = meter.id;
  document.getElementById('detailId').style.color = 'var(--label)';

  const badge = document.getElementById('detailBadge');
  badge.className = `badge ${isFlagged ? 'red' : 'green'}`;
  badge.innerText = isFlagged ? 'High Risk - Suspect' : 'Normal Consumption';
  badge.style.background = '';
  badge.style.color = '';

  document.getElementById('detailScore').innerText = meter.score;
  document.getElementById('detailClass').innerText = isFlagged ? 'Non-Technical Loss' : 'Technical / Normal';
  document.getElementById('detailDate').innerText = meter.date;
  document.getElementById('detailAction').innerText = isFlagged ? 'Dispatch Field Team' : 'None';
}

/* ═══════════════════════════════════════════════════════════════
   CHARTS
   ═══════════════════════════════════════════════════════════════ */
function destroyCharts() {
  Object.values(chartInstances).forEach((c) => c && c.destroy());
  chartInstances = {};
}

function getThemeColors() {
  const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  return {
    text2: dark ? 'rgba(235,235,245,.6)' : 'rgba(60,60,67,.6)',
    grid:  dark ? 'rgba(84,84,88,.4)'    : 'rgba(60,60,67,.1)',
    blue:  '#007AFF',
    green: '#34C759',
    red:   '#FF3B30'
  };
}

function renderCharts() {
  if (typeof Chart === 'undefined' || globalData.length === 0) return;
  destroyCharts();
  const c = getThemeColors();

  Chart.defaults.font.family = "'Inter', -apple-system, sans-serif";
  Chart.defaults.font.weight = '600';
  Chart.defaults.color = c.text2;

  const flagged = globalData.reduce((n, d) => n + (d.flag === 1 ? 1 : 0), 0);
  const clear = globalData.length - flagged;

  chartInstances.donut = new Chart(document.getElementById('chartDonut'), {
    type: 'doughnut',
    data: {
      labels: ['Clear', 'Flagged'],
      datasets: [{
        data: [clear, flagged],
        backgroundColor: [c.green, c.red],
        borderWidth: 0,
        hoverOffset: 6
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '68%',
      animation: false,
      plugins: {
        legend: {
          position: 'bottom',
          labels: { padding: 16, usePointStyle: true, pointStyle: 'circle', boxWidth: 8, color: c.text2 }
        },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const total = clear + flagged || 1;
              const pct = ((ctx.parsed / total) * 100).toFixed(1);
              return ` ${ctx.label}: ${ctx.parsed.toLocaleString()} (${pct}%)`;
            }
          }
        }
      }
    }
  });

  const bins = new Array(10).fill(0);
  for (let i = 0; i < globalData.length; i++) {
    const s = parseFloat(globalData[i].score);
    if (!isNaN(s)) {
      const idx = Math.min(9, Math.floor(s * 10));
      bins[idx]++;
    }
  }

  chartInstances.hist = new Chart(document.getElementById('chartHist'), {
    type: 'bar',
    data: {
      labels: ['0-.1','.1-.2','.2-.3','.3-.4','.4-.5','.5-.6','.6-.7','.7-.8','.8-.9','.9-1'],
      datasets: [{
        label: 'Meters',
        data: bins,
        backgroundColor: bins.map((_, i) => i >= 5 ? c.red : c.blue),
        borderRadius: 6,
        borderSkipped: false
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false }, ticks: { color: c.text2, font: { size: 10 } } },
        y: { grid: { color: c.grid }, ticks: { color: c.text2, font: { size: 10 } }, beginAtZero: true }
      }
    }
  });

  const top10 = globalData.slice(0, 10);

  chartInstances.top10 = new Chart(document.getElementById('chartTop10'), {
    type: 'bar',
    data: {
      labels: top10.map((d) => d.id.length > 14 ? d.id.substring(0, 14) + '…' : d.id),
      datasets: [{
        label: 'Risk Score',
        data: top10.map((d) => parseFloat(d.score)),
        backgroundColor: top10.map((d) => d.flag === 1 ? c.red : c.blue),
        borderRadius: 6,
        borderSkipped: false
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true, maintainAspectRatio: false, animation: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const m = top10[ctx.dataIndex];
              return ` Risk: ${m.score}  ${m.flag === 1 ? '⚠ Flagged' : '✓ Clear'}`;
            }
          }
        }
      },
      scales: {
        x: { grid: { color: c.grid }, ticks: { color: c.text2, font: { size: 10 } }, beginAtZero: true, max: 1 },
        y: { grid: { display: false }, ticks: { color: c.text2, font: { family: "'JetBrains Mono', monospace", size: 10 } } }
      }
    }
  });

  const monthMap = Object.create(null);
  for (let i = 0; i < globalData.length; i++) {
    const d = globalData[i];
    if (d.flag !== 1) continue;
    if (!d.date || d.date === 'Investigating' || d.date === 'N/A') continue;
    const parsed = new Date(d.date);
    if (isNaN(parsed)) continue;
    const key = `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}`;
    monthMap[key] = (monthMap[key] || 0) + 1;
  }

  const sortedKeys = Object.keys(monthMap).sort();
  const hasTimelineData = sortedKeys.length > 0;

  chartInstances.timeline = new Chart(document.getElementById('chartTimeline'), {
    type: 'line',
    data: {
      labels: hasTimelineData ? sortedKeys : ['No data'],
      datasets: [{
        label: 'Theft Incidents',
        data: hasTimelineData ? sortedKeys.map((k) => monthMap[k]) : [0],
        borderColor: c.red,
        backgroundColor: 'rgba(255,59,48,0.12)',
        fill: true,
        tension: 0.35,
        pointBackgroundColor: c.red,
        pointBorderColor: '#fff',
        pointBorderWidth: 2,
        pointRadius: 4,
        pointHoverRadius: 7
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false }, ticks: { color: c.text2, font: { size: 10 } } },
        y: { grid: { color: c.grid }, ticks: { color: c.text2, font: { size: 10 } }, beginAtZero: true }
      }
    }
  });
}

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (globalData.length > 0) renderCharts();
});
