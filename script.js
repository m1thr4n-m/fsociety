/* ═══════════════════════════════════════════════════════════════
   UI FILE HANDLERS
   ═══════════════════════════════════════════════════════════════ */

// Attach click listeners to drop areas to trigger file inputs
document.querySelectorAll('.file-drop-area').forEach(area => {
  area.addEventListener('click', () => {
    const inputId = area.dataset.input;
    if (inputId) {
      document.getElementById(inputId).click();
    }
  });
});

// Attach change listeners to file inputs to update filenames and styles
['fileRisk', 'fileDates', 'fileExtra'].forEach(inputId => {
  const input = document.getElementById(inputId);
  const nameId = 'name' + inputId.replace('file', ''); // nameRisk, nameDates, nameExtra
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
   APP STATE & DATA LOGIC
   ═══════════════════════════════════════════════════════════════ */
let globalData = [];
let filteredData = [];
let selectedMeter = null;

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
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 220);
  }, 2400);
}

const parseCSV = (file) =>
  new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => resolve(results.data),
      error: (err) => reject(err),
    });
  });

// Store original button content for reset
const processBtn = document.getElementById('processBtn');
const originalBtnHTML = processBtn.innerHTML;

processBtn.addEventListener('click', async () => {
  const fileRisk = document.getElementById('fileRisk').files[0];
  const fileDates = document.getElementById('fileDates').files[0];

  if (!fileRisk || !fileDates) {
    showToast('Please select both Risk Scores and Theft Dates CSVs', 'error');
    return;
  }

  processBtn.innerHTML = 'Processing Data...';
  processBtn.style.opacity = '0.7';

  try {
    const riskData = await parseCSV(fileRisk);
    const dateData = await parseCSV(fileDates);

    // Map Dates for O(1) Lookup
    const dateMap = {};
    dateData.forEach((row) => {
      if (row.CONS_NO) dateMap[row.CONS_NO] = row.theft_start_date;
    });

    // Merge Risk and Dates
    let flaggedCount = 0;
    globalData = riskData.map((row) => {
      const flag =
        row.FLAG !== undefined
          ? parseInt(row.FLAG)
          : parseFloat(row.risk_score) > 0.5
          ? 1
          : 0;
      if (flag === 1) flaggedCount++;

      let score = parseFloat(row.risk_score);
      score = isNaN(score) ? 0 : score.toFixed(4);

      return {
        id: row.CONS_NO || 'Unknown ID',
        score: score,
        flag: flag,
        date: flag === 1 ? dateMap[row.CONS_NO] || 'Investigating' : 'N/A',
      };
    });

    globalData.sort((a, b) => b.score - a.score);
    filteredData = [...globalData];

    // Update UI
    document.getElementById('kpiTotal').innerText = globalData.length.toLocaleString();
    document.getElementById('kpiFlagged').innerText = flaggedCount.toLocaleString();

    const rate =
      globalData.length > 0
        ? ((flaggedCount / globalData.length) * 100).toFixed(2)
        : 0;
    document.getElementById('kpiRate').innerText = `${rate}%`;

    document.getElementById('diagnosticsSection').style.display = 'block';
    showToast('Test Data Merged Successfully');
    renderList();

    if (window.innerWidth < 860) {
      document
        .getElementById('diagnosticsSection')
        .scrollIntoView({ behavior: 'smooth' });
    }
  } catch (err) {
    console.error(err);
    showToast('Error parsing files. Ensure they are valid CSVs.', 'error');
  } finally {
    processBtn.innerHTML = originalBtnHTML;
    processBtn.style.opacity = '1';
  }
});

document.getElementById('searchInput').addEventListener('input', (e) => {
  const query = e.target.value.toLowerCase();
  filteredData = globalData.filter((d) => d.id.toLowerCase().includes(query));
  renderList();
});

function renderList() {
  const listEl = document.getElementById('meterList');
  listEl.innerHTML = '';

  const slice = filteredData.slice(0, 100);

  if (slice.length === 0) {
    listEl.innerHTML = `<div style="color:var(--label-3); padding:10px 0; font-size:14px;">No meters found.</div>`;
    return;
  }

  slice.forEach((meter) => {
    const btn = document.createElement('button');
    btn.className = `radio-row ${
      selectedMeter && selectedMeter.id === meter.id ? 'selected' : ''
    }`;
    btn.addEventListener('click', () => selectMeter(meter, btn));

    const isFlagged = meter.flag === 1;
    const iconClass = isFlagged ? 'flagged' : 'safe';
    const badgeClass = isFlagged ? 'red' : 'green';
    const badgeText = isFlagged ? 'Anomaly' : 'Clear';
    const svg = isFlagged
      ? `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M10 2a8 8 0 100 16 8 8 0 000-16zM10 6v5M10 14h.01"/></svg>`
      : `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 10.5L8 15L16 5"/></svg>`;

    const displayId =
      meter.id.length > 18 ? meter.id.substring(0, 18) + '...' : meter.id;

    btn.innerHTML = `
      <div class="meter-icon ${iconClass}">${svg}</div>
      <div class="radio-body">
        <span class="radio-title">${displayId}</span>
        <span class="radio-desc">Risk: ${meter.score}</span>
        <span class="badge ${badgeClass}">${badgeText}</span>
      </div>
    `;
    listEl.appendChild(btn);
  });
}

function selectMeter(meter, btnElement) {
  selectedMeter = meter;

  document
    .querySelectorAll('.radio-row')
    .forEach((el) => el.classList.remove('selected'));
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
  document.getElementById('detailClass').innerText = isFlagged
    ? 'Non-Technical Loss'
    : 'Technical / Normal';
  document.getElementById('detailDate').innerText = meter.date;
  document.getElementById('detailAction').innerText = isFlagged
    ? 'Dispatch Field Team'
    : 'None';
}