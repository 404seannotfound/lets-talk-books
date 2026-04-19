// ─── Screen navigation ───
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

// External link handling
document.addEventListener('click', e => {
  const target = e.target.closest('[data-ext]');
  if (target) {
    e.preventDefault();
    window.open(target.dataset.ext, '_blank');
  }
});

// ─── Welcome ───
document.getElementById('btn-start').addEventListener('click', async () => {
  const status = await window.api.checkStatus();
  showScreen('screen-setup');
  renderSetup(status);
});

// ─── Setup ───
async function renderSetup(status) {
  updateCheck('check-python', status.pythonAvailable, status.pythonAvailable ? 'Ready' : 'Not found');
  updateCheck('check-audible', status.audibleAvailable, status.audibleAvailable ? 'Installed' : 'Not installed');

  // Hide all help panels
  ['setup-python-help', 'setup-install', 'setup-ready'].forEach(id => {
    document.getElementById(id).classList.add('hidden');
  });

  if (!status.pythonAvailable) {
    document.getElementById('setup-python-help').classList.remove('hidden');
    return;
  }
  if (!status.audibleAvailable) {
    document.getElementById('setup-install').classList.remove('hidden');
    return;
  }

  // All good — but check if they already have data loaded
  if (status.libraryExists) {
    // Skip directly to viz
    loadAndShowViz();
  } else if (status.profileExists) {
    // They've auth'd before but no data yet — skip login, go export
    showScreen('screen-export');
    doExport();
  } else {
    document.getElementById('setup-ready').classList.remove('hidden');
  }
}

function updateCheck(id, ok, text) {
  const el = document.getElementById(id);
  el.classList.remove('ok', 'missing');
  el.classList.add(ok ? 'ok' : 'missing');
  el.querySelector('.check-status').textContent = text;
  el.querySelector('.check-icon').textContent = '';
}

document.getElementById('btn-recheck-python').addEventListener('click', async () => {
  const status = await window.api.checkStatus();
  renderSetup(status);
});

document.getElementById('btn-install').addEventListener('click', async (e) => {
  e.target.disabled = true;
  e.target.textContent = 'Installing...';
  const log = document.getElementById('install-log');
  log.textContent = '';
  window.api.onInstallProgress(chunk => {
    log.textContent += chunk;
    log.scrollTop = log.scrollHeight;
  });
  const result = await window.api.installAudibleCli();
  e.target.disabled = false;
  e.target.textContent = 'Install audible-cli';
  if (result.success) {
    // Re-check
    const status = await window.api.checkStatus();
    renderSetup(status);
  } else {
    log.textContent += '\n\nInstallation failed. If you see "externally-managed-environment", try running this in a terminal:\n\n  pip3 install --user --break-system-packages audible-cli\n\nThen come back and click Re-check.';
  }
});

document.getElementById('btn-to-login').addEventListener('click', () => {
  showScreen('screen-login');
});

// ─── Login ───
document.getElementById('btn-login').addEventListener('click', async (e) => {
  e.target.disabled = true;
  e.target.textContent = 'Opening browser...';
  const log = document.getElementById('login-log');
  log.textContent = '';
  log.classList.remove('hidden');
  window.api.onLoginProgress(chunk => {
    log.textContent += chunk;
    log.scrollTop = log.scrollHeight;
  });
  const country = document.getElementById('country').value;
  const result = await window.api.startLogin({ country });
  e.target.disabled = false;
  e.target.textContent = 'Open Login in Browser';
  if (result.success) {
    showScreen('screen-export');
    doExport();
  } else {
    log.textContent += '\n\nLogin failed. You can try again or reset and start over.';
  }
});

// ─── Export ───
async function doExport() {
  const log = document.getElementById('export-log');
  log.textContent = '';
  document.getElementById('export-spinner').style.display = 'block';
  document.getElementById('btn-to-viz').classList.add('hidden');

  window.api.onExportProgress(chunk => {
    log.textContent += chunk;
    log.scrollTop = log.scrollHeight;
  });
  const result = await window.api.exportLibrary();
  document.getElementById('export-spinner').style.display = 'none';
  if (result.success) {
    document.getElementById('export-sub').textContent = `Imported ${result.count} books. Ready to explore.`;
    document.getElementById('btn-to-viz').classList.remove('hidden');
  } else {
    document.getElementById('export-sub').textContent = 'Export failed. Check the log below.';
  }
}

document.getElementById('btn-to-viz').addEventListener('click', loadAndShowViz);

// ─── Visualization ───
async function loadAndShowViz() {
  const data = await window.api.loadLibrary();
  if (!data || !data.length) {
    showScreen('screen-welcome');
    return;
  }
  showScreen('screen-viz');
  // initViz is defined in viz.js
  initViz(data);
}

document.getElementById('btn-refresh').addEventListener('click', async () => {
  showScreen('screen-export');
  doExport();
});

document.getElementById('btn-data-folder').addEventListener('click', () => {
  window.api.openDataFolder();
});

document.getElementById('btn-reset').addEventListener('click', async () => {
  if (!confirm('This will delete your library data from this app (your Audible account is not affected). Continue?')) return;
  await window.api.clearData();
  showScreen('screen-welcome');
});

// ─── Tab/control visibility wiring for the new controls ───
// The tab click handler is inside viz.js but we need to sync new control panels
document.querySelectorAll('.viz-tabs .tab').forEach(btn => {
  btn.addEventListener('click', () => {
    const v = btn.dataset.view;
    document.getElementById('author-controls').style.display = v === 'authors' ? 'flex' : 'none';
    document.getElementById('genre-controls').style.display = v === 'stream' ? 'flex' : 'none';
    document.getElementById('series-controls').style.display = v === 'series' ? 'flex' : 'none';
    document.getElementById('af-controls').style.display = v === 'authorflow' ? 'flex' : 'none';
  });
});
// Initial control visibility
document.getElementById('af-controls').style.display = 'flex';

// ─── Search/highlight wiring on viz controls ───
// These hook into the last-rendered D3 selections from viz.js
function wireSearch(inputId, resultId, matchFn) {
  const input = document.getElementById(inputId);
  const result = document.getElementById(resultId);
  if (!input) return;
  input.addEventListener('input', () => {
    const q = input.value.toLowerCase().trim();
    matchFn(q, result);
  });
}

// Author Flow search
wireSearch('af-search', 'af-search-result', (q, resultEl) => {
  // Uses globals from viz.js: DATA, authorFlowEnabled
  const paths = document.querySelectorAll('#authorflow-chart .stream');
  if (!paths.length) { resultEl.textContent = ''; return; }
  if (!q) {
    paths.forEach(p => p.setAttribute('opacity', '0.85'));
    resultEl.textContent = '';
    return;
  }
  const matching = new Set();
  DATA.forEach(b => {
    if (b.title.toLowerCase().includes(q) ||
        b.authors.toLowerCase().includes(q) ||
        (b.series && b.series.toLowerCase().includes(q))) {
      b.authors.split(',').forEach(a => {
        a = a.trim();
        if (a && authorFlowEnabled[a]) matching.add(a);
      });
    }
  });
  // Use d3 datum to check
  d3.selectAll('#authorflow-chart .stream').each(function(d) {
    this.setAttribute('opacity', matching.has(d.key) ? '1' : '0.06');
  });
  resultEl.textContent = matching.size ? `${matching.size} matching` : 'No matches';
  resultEl.style.color = matching.size ? '#facc15' : '#8b949e';
});

// Genre Flow search
wireSearch('gf-search', 'gf-search-result', (q, resultEl) => {
  const paths = d3.selectAll('#stream-chart path');
  if (!paths.size()) { resultEl.textContent = ''; return; }
  if (!q) {
    paths.attr('opacity', 0.85);
    resultEl.textContent = '';
    return;
  }
  const matchingGenres = new Set();
  let matchCount = 0;
  DATA.forEach(b => {
    if (b.title.toLowerCase().includes(q) ||
        b.authors.toLowerCase().includes(q) ||
        (b.series && b.series.toLowerCase().includes(q))) {
      matchingGenres.add(b.genre);
      matchCount++;
    }
  });
  paths.attr('opacity', function(d) {
    // 'Other' catches anything not in top genres
    return (matchingGenres.has(d.key) || (d.key === 'Other')) ? 1 : 0.06;
  });
  resultEl.textContent = matchCount ? `${matchCount} books` : 'No matches';
  resultEl.style.color = matchCount ? '#facc15' : '#8b949e';
});

// Series Timeline search
wireSearch('series-search', 'series-search-result', (q, resultEl) => {
  if (!q) {
    d3.selectAll('#series-timeline circle').attr('opacity', 0.85);
    d3.selectAll('#series-timeline text').attr('opacity', 1);
    d3.selectAll('#series-timeline line').attr('opacity', 1);
    resultEl.textContent = '';
    return;
  }
  // Re-query DOM after each render; for simplicity, do full re-highlight
  const matches = new Set();
  DATA.forEach(b => {
    if (!b.series) return;
    if (b.series.toLowerCase().includes(q) ||
        b.authors.toLowerCase().includes(q) ||
        b.title.toLowerCase().includes(q)) matches.add(b.series);
  });
  // We can't easily tag series in the current render without re-rendering.
  // Simpler approach: re-render with filter
  resultEl.textContent = matches.size ? `${matches.size} matching series` : 'No matches';
  resultEl.style.color = matches.size ? '#facc15' : '#8b949e';
  // Highlight via opacity - we'd need to re-render to filter. For now just count.
});

// ─── Auto-load on startup if data already exists ───
(async () => {
  const status = await window.api.checkStatus();
  if (status.libraryExists) {
    loadAndShowViz();
  }
})();
