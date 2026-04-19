const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn, execSync } = require('child_process');

const USER_DATA_DIR = app.getPath('userData');
const LIBRARY_JSON = path.join(USER_DATA_DIR, 'library_data.json');
const LIBRARY_TSV = path.join(USER_DATA_DIR, 'library.tsv');

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
  const pythonAvailable = await checkCommand('python3', ['--version']);
  const audibleAvailable = await checkCommand('audible', ['--version']);
  const libraryExists = fs.existsSync(LIBRARY_JSON);
  const profileExists = await checkAudibleProfile();
  return { pythonAvailable, audibleAvailable, libraryExists, profileExists };
});

// ─── IPC: install audible-cli ───
ipcMain.handle('install-audible-cli', async (event) => {
  return new Promise((resolve) => {
    const proc = spawn('pip3', ['install', '--user', 'audible-cli'], { shell: false });
    let output = '';
    proc.stdout.on('data', d => {
      output += d.toString();
      event.sender.send('install-progress', d.toString());
    });
    proc.stderr.on('data', d => {
      output += d.toString();
      event.sender.send('install-progress', d.toString());
    });
    proc.on('close', code => resolve({ success: code === 0, output }));
    proc.on('error', err => resolve({ success: false, output: err.message }));
  });
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

    const proc = spawn('audible', ['quickstart'], { shell: false });
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
    const proc = spawn('audible', ['library', 'export', '--output', LIBRARY_TSV], { shell: false });
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

async function checkAudibleProfile() {
  const configPath = path.join(os.homedir(), '.audible', 'config.toml');
  return fs.existsSync(configPath);
}

function parseTsvToJson(tsvPath) {
  const raw = fs.readFileSync(tsvPath, 'utf8');
  const lines = raw.split('\n').filter(l => l.length > 0);
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
    books.push({
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
      rating: row.rating || '',
      narrators: row.narrators || '',
      cover: row.cover_url || '',
    });
  }
  books.sort((a, b) => a.date.localeCompare(b.date));
  return books;
}
