const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn, execSync } = require('child_process');

const USER_DATA_DIR = app.getPath('userData');
const LIBRARY_JSON = path.join(USER_DATA_DIR, 'library_data.json');
const LIBRARY_TSV = path.join(USER_DATA_DIR, 'library.tsv');
const VENV_DIR = path.join(USER_DATA_DIR, 'venv');
const VENV_AUDIBLE = path.join(VENV_DIR, 'bin', 'audible');
const VENV_PYTHON = path.join(VENV_DIR, 'bin', 'python');
const VENV_PIP = path.join(VENV_DIR, 'bin', 'pip');

// Windows uses Scripts/ instead of bin/ and .exe suffixes
const IS_WIN = process.platform === 'win32';
const AUDIBLE_BIN = IS_WIN ? path.join(VENV_DIR, 'Scripts', 'audible.exe') : VENV_AUDIBLE;
const PYTHON_BIN = IS_WIN ? path.join(VENV_DIR, 'Scripts', 'python.exe') : VENV_PYTHON;
const PIP_BIN = IS_WIN ? path.join(VENV_DIR, 'Scripts', 'pip.exe') : VENV_PIP;

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0d1117',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ─── IPC: status check ───
ipcMain.handle('check-status', async () => {
  const pythonAvailable = await findPython() !== null;
  const audibleAvailable = fs.existsSync(AUDIBLE_BIN);
  const libraryExists = fs.existsSync(LIBRARY_JSON);
  const profileExists = await checkAudibleProfile();
  return { pythonAvailable, audibleAvailable, libraryExists, profileExists };
});

// ─── IPC: install audible-cli into a dedicated venv ───
ipcMain.handle('install-audible-cli', async (event) => {
  const log = (msg) => event.sender.send('install-progress', msg);

  // Step 1: find a working Python
  const python = await findPython();
  if (!python) {
    return { success: false, output: 'Python 3 not found on this system.' };
  }
  log(`Using Python: ${python}\n`);

  // Step 2: create the venv if it doesn't exist
  if (!fs.existsSync(VENV_DIR)) {
    log(`Creating isolated environment in:\n  ${VENV_DIR}\n\n`);
    const venvResult = await runStreamed(python, ['-m', 'venv', VENV_DIR], log);
    if (!venvResult.success) {
      return { success: false, output: 'Failed to create virtual environment.\n' + venvResult.output };
    }
  } else {
    log('Virtual environment already exists. Reusing it.\n\n');
  }

  // Step 3: upgrade pip (often needed)
  log('Upgrading pip...\n');
  await runStreamed(PIP_BIN, ['install', '--upgrade', 'pip', '--quiet'], log);

  // Step 4: install audible-cli
  log('\nInstalling audible-cli...\n');
  const installResult = await runStreamed(PIP_BIN, ['install', 'audible-cli'], log);
  if (!installResult.success) {
    return { success: false, output: installResult.output };
  }

  // Step 5: verify
  if (fs.existsSync(AUDIBLE_BIN)) {
    log('\n✓ Ready.\n');
    return { success: true, output: installResult.output };
  }
  return { success: false, output: 'audible binary not found after install.' };
});

// ─── IPC: login flow (opens external browser) ───
ipcMain.handle('start-login', async (event, { country }) => {
  // Run `audible manage auth-file add` non-interactively-ish
  // We need to create a profile. Use quickstart with predefined answers.
  return new Promise((resolve) => {
    // Using external browser login:
    // We write a config.toml ourselves and run `audible manage auth-file add`
    // Actually, simpler: run quickstart and feed answers via stdin
    const answers = [
      '',              // profile name (default: audible)
      country || 'us', // country code
      '',              // auth file name (default)
      'N',             // encrypt
      'y',             // external browser
      'N',             // pre-amazon account
      'y',             // continue
    ].join('\n') + '\n';

    const proc = spawn(AUDIBLE_BIN, ['quickstart'], { shell: false });
    let output = '';
    proc.stdout.on('data', d => {
      output += d.toString();
      event.sender.send('login-progress', d.toString());
    });
    proc.stderr.on('data', d => {
      output += d.toString();
      event.sender.send('login-progress', d.toString());
    });
    proc.on('close', code => resolve({ success: code === 0, output }));
    proc.on('error', err => resolve({ success: false, output: err.message }));

    proc.stdin.write(answers);
    proc.stdin.end();
  });
});

// ─── IPC: export library ───
ipcMain.handle('export-library', async (event) => {
  return new Promise((resolve) => {
    event.sender.send('export-progress', 'Fetching your library from Audible...\n');
    const proc = spawn(AUDIBLE_BIN, ['library', 'export', '--output', LIBRARY_TSV], { shell: false });
    let output = '';
    proc.stdout.on('data', d => {
      output += d.toString();
      event.sender.send('export-progress', d.toString());
    });
    proc.stderr.on('data', d => {
      output += d.toString();
      event.sender.send('export-progress', d.toString());
    });
    proc.on('close', async code => {
      if (code !== 0) return resolve({ success: false, output });
      // Convert TSV to JSON
      try {
        const books = parseTsvToJson(LIBRARY_TSV);
        fs.writeFileSync(LIBRARY_JSON, JSON.stringify(books));
        event.sender.send('export-progress', `\nImported ${books.length} books\n`);
        resolve({ success: true, count: books.length, output });
      } catch (e) {
        resolve({ success: false, output: output + '\n' + e.message });
      }
    });
    proc.on('error', err => resolve({ success: false, output: err.message }));
  });
});

// ─── IPC: load library data ───
ipcMain.handle('load-library', async () => {
  if (!fs.existsSync(LIBRARY_JSON)) return null;
  const raw = fs.readFileSync(LIBRARY_JSON, 'utf8');
  return JSON.parse(raw);
});

// ─── IPC: clear / reset ───
ipcMain.handle('clear-data', async () => {
  if (fs.existsSync(LIBRARY_JSON)) fs.unlinkSync(LIBRARY_JSON);
  if (fs.existsSync(LIBRARY_TSV)) fs.unlinkSync(LIBRARY_TSV);
  return true;
});

// ─── IPC: clear just the Audible auth (force re-login) ───
ipcMain.handle('clear-auth', async () => {
  const audibleDir = path.join(os.homedir(), '.audible');
  if (fs.existsSync(audibleDir)) {
    // Remove audible.json and config.toml but keep the folder
    for (const f of ['audible.json', 'config.toml']) {
      const fp = path.join(audibleDir, f);
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
    }
  }
  return true;
});

// ─── IPC: open data folder ───
ipcMain.handle('open-data-folder', async () => {
  shell.openPath(USER_DATA_DIR);
});

// ─── IPC: submit CVF code / OTP to running audible-cli process ───
// (Not needed for external browser flow)

// ─── Helpers ───
function checkCommand(cmd, args) {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, { shell: false });
    proc.on('close', code => resolve(code === 0));
    proc.on('error', () => resolve(false));
  });
}

// Find a usable python3 on PATH. Tries common names.
async function findPython() {
  const candidates = IS_WIN
    ? ['python', 'py', 'python3']
    : ['python3', 'python3.12', 'python3.11', 'python3.10', 'python'];
  for (const candidate of candidates) {
    // Check if it exists and can run venv
    const works = await new Promise((resolve) => {
      const p = spawn(candidate, ['-c', 'import venv; print("ok")'], { shell: false });
      let out = '';
      p.stdout.on('data', d => { out += d.toString(); });
      p.on('close', code => resolve(code === 0 && out.includes('ok')));
      p.on('error', () => resolve(false));
    });
    if (works) return candidate;
  }
  return null;
}

// Spawn a process and stream output back via callback; resolves with {success, output}
function runStreamed(cmd, args, log) {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, { shell: false });
    let output = '';
    proc.stdout.on('data', d => { const s = d.toString(); output += s; log(s); });
    proc.stderr.on('data', d => { const s = d.toString(); output += s; log(s); });
    proc.on('close', code => resolve({ success: code === 0, output }));
    proc.on('error', err => resolve({ success: false, output: err.message }));
  });
}

async function checkAudibleProfile() {
  const configPath = path.join(os.homedir(), '.audible', 'config.toml');
  return fs.existsSync(configPath);
}

function parseTsvToJson(tsvPath) {
  const raw = fs.readFileSync(tsvPath, 'utf8');
  // Normalize line endings — audible-cli can emit CRLF, which would leave a \r
  // on every last column (including the header) and break field lookup.
  const lines = raw.replace(/\r\n/g, '\n').replace(/\r/g, '').split('\n').filter(l => l.length > 0);
  const headers = lines[0].split('\t');
  const books = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = lines[i].split('\t');
    const row = {};
    headers.forEach((h, j) => { row[h] = vals[j] || ''; });
    const pd = row.purchase_date;
    if (!pd) continue;
    const dt = new Date(pd);
    if (isNaN(dt)) continue;
    const genres = row.genres || '';
    // Parse date_added (when the book first landed in the library)
    let dateAdded = '';
    if (row.date_added) {
      const da = new Date(row.date_added);
      if (!isNaN(da)) dateAdded = da.toISOString().split('T')[0];
    }
    // Listening progress
    const pct = parseFloat(row.percent_complete || '0') || 0;
    const isFinished = (row.is_finished || '').toLowerCase() === 'true' || pct >= 99;

    books.push({
      asin: row.asin || '',
      title: row.title || '',
      authors: row.authors || '',
      series: row.series_title || '',
      series_seq: row.series_sequence || '',
      genres: genres,
      genre: genres.split(',')[0].trim() || 'Other',
      runtime_min: parseInt(row.runtime_length_min || '0') || 0,
      date: dt.toISOString().split('T')[0],
      year: dt.getFullYear(),
      month: dt.getMonth() + 1,
      date_added: dateAdded,
      is_finished: isFinished,
      percent_complete: pct,
      rating: row.rating || '',
      narrators: row.narrators || '',
      cover: row.cover_url || '',
    });
  }
  books.sort((a, b) => a.date.localeCompare(b.date));
  return books;
}
