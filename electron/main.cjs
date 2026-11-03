// Electron main process: window, native macOS menus and file access.
const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const fsSync = require('fs');

const isMac = process.platform === 'darwin';
const OPENABLE = new Set(['.ocad', '.json', '.stl', '.obj']);
const MAX_FILE_BYTES = 512 * 1024 * 1024;
const SMOKE_TEST = !!process.env.OPENCAD_SMOKE_TEST;

// ---------- diagnostics: never fail silently ----------

let logFile = null;
function log(...parts) {
  const line = `[${new Date().toISOString()}] ${parts.map((p) => (p instanceof Error ? p.stack : typeof p === 'string' ? p : JSON.stringify(p))).join(' ')}\n`;
  if (SMOKE_TEST) process.stdout.write(line);
  try {
    if (!logFile && app.isReady()) {
      const dir = app.getPath('logs');
      fsSync.mkdirSync(dir, { recursive: true });
      logFile = path.join(dir, 'main.log');
    }
    if (logFile) fsSync.appendFileSync(logFile, line);
  } catch { /* logging must never crash the app */ }
}

function fatal(title, err) {
  log('FATAL', title, err);
  if (SMOKE_TEST) { console.log('SMOKE_FAIL', title, err?.stack || err); app.exit(1); return; }
  const where = logFile ? `\n\nDetails were saved to:\n${logFile}` : '';
  try { dialog.showErrorBox(`OpenCAD Studio: ${title}`, `${err?.stack || err}${where}`); } catch { /* ignore */ }
}

process.on('uncaughtException', (e) => fatal('Unexpected error', e));
process.on('unhandledRejection', (e) => fatal('Unexpected error', e));

async function readForRenderer(filePath) {
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) throw new Error('Invalid path');
  if (!OPENABLE.has(path.extname(filePath).toLowerCase())) throw new Error('Unsupported file type');
  const st = await fs.stat(filePath);
  if (!st.isFile()) throw new Error('Not a file');
  if (st.size > MAX_FILE_BYTES) throw new Error('File is too large');
  const buf = await fs.readFile(filePath);
  app.addRecentDocument(filePath);
  return { path: filePath, name: path.basename(filePath), buffer: new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength) };
}
const windows = new Set();
const pendingOpen = [];

function createWindow(fileToOpen) {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    title: 'OpenCAD Studio',
    backgroundColor: '#1b1f25',
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 14, y: 18 },
    show: !SMOKE_TEST,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.state = { dirty: false, forceClose: false };
  windows.add(win);
  win.on('closed', () => windows.delete(win));

  win.webContents.on('render-process-gone', (_e, details) => {
    fatal('The window stopped working', new Error(`Renderer ${details.reason} (exit code ${details.exitCode})`));
  });
  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    fatal('The app could not load', new Error(`${desc} (${code}) loading ${url}`));
  });
  win.webContents.on('preload-error', (_e, preloadPath, error) => fatal('Startup script failed', error));
  win.webContents.on('console-message', (e) => {
    const level = e.level ?? '';
    if (SMOKE_TEST || level === 'error' || level === 3) log('renderer', level, e.message ?? '');
  });

  win.on('close', async (e) => {
    if (!win.state.dirty || win.state.forceClose) return;
    e.preventDefault();
    const { response } = await dialog.showMessageBox(win, {
      type: 'warning',
      buttons: ['Save…', 'Cancel', "Don't Save"],
      defaultId: 0,
      cancelId: 1,
      message: 'Do you want to save the changes you made?',
      detail: "Your changes will be lost if you don't save them.",
    });
    if (response === 0) win.webContents.send('menu', 'saveThenClose');
    if (response === 2) { win.state.forceClose = true; win.close(); }
  });

  // Never navigate away or open new windows inside the app
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());

  if (process.env.VITE_DEV_SERVER_URL) win.loadURL(process.env.VITE_DEV_SERVER_URL);
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));

  if (fileToOpen) win.webContents.once('did-finish-load', () => openPath(win, fileToOpen));
  return win;
}

async function openPath(win, filePath) {
  try {
    win.webContents.send('menu', 'openFile', await readForRenderer(filePath));
  } catch (e) {
    dialog.showErrorBox('Could not open file', e.message);
  }
}

const send = (cmd, arg) => {
  const win = BrowserWindow.getFocusedWindow() || [...windows][0];
  if (win) win.webContents.send('menu', cmd, arg);
};

function buildMenu() {
  const template = [
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'Home', accelerator: 'CmdOrCtrl+Shift+H', click: () => send('home') },
        { type: 'separator' },
        { label: 'New Design', accelerator: 'CmdOrCtrl+N', click: () => send('new') },
        { label: 'New Window', accelerator: 'CmdOrCtrl+Shift+N', click: () => createWindow() },
        { label: 'Open…', accelerator: 'CmdOrCtrl+O', click: () => send('open') },
        { role: 'recentDocuments', submenu: [{ role: 'clearRecentDocuments' }] },
        { label: 'Examples…', click: () => send('examples') },
        { type: 'separator' },
        { label: 'Save', accelerator: 'CmdOrCtrl+S', click: () => send('save') },
        { label: 'Save As…', accelerator: 'CmdOrCtrl+Shift+S', click: () => send('saveAs') },
        { label: 'Save to Cloud', click: () => send('cloudSave') },
        { label: 'Account…', click: () => send('signIn') },
        { type: 'separator' },
        { label: 'Import STL / OBJ into Design…', accelerator: 'CmdOrCtrl+I', click: () => send('importMesh') },
        { label: 'Export STL…', accelerator: 'CmdOrCtrl+E', click: () => send('exportStl') },
        { label: 'Export OBJ…', click: () => send('exportObj') },
        { label: 'Save Image…', click: () => send('screenshot') },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { label: 'Undo', accelerator: 'CmdOrCtrl+Z', click: () => send('undo') },
        { label: 'Redo', accelerator: 'Shift+CmdOrCtrl+Z', click: () => send('redo') },
        { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' },
        { label: 'Select All Bodies', accelerator: 'CmdOrCtrl+A', click: () => send('selectAll') },
        { type: 'separator' },
        { label: 'Parameters…', accelerator: 'CmdOrCtrl+P', click: () => send('params') },
      ],
    },
    {
      label: 'Create',
      submenu: [
        ['Sketch', 'sketch'], ['Extrude', 'extrude'], ['Revolve', 'revolve'], null,
        ['Box', 'box'], ['Cylinder', 'cylinder'], ['Sphere', 'sphere'], ['Cone', 'cone'], ['Torus', 'torus'],
      ].map((x) => (x ? { label: x[0], click: () => send(x[1]) } : { type: 'separator' })),
    },
    {
      label: 'Modify',
      submenu: [
        ['Move / Rotate', 'move'], ['Scale', 'scale'], ['Combine', 'combine'], ['Mirror', 'mirror'],
        ['Linear Pattern', 'linearPattern'], ['Circular Pattern', 'circularPattern'], ['Hollow', 'shell'], null,
        ['Remove Selected Bodies', 'deleteSelection'],
      ].map((x) => (x ? { label: x[0], click: () => send(x[1]) } : { type: 'separator' })),
    },
    {
      label: 'View',
      submenu: [
        { label: 'Home', accelerator: '0', registerAccelerator: false, click: () => send('view:iso') },
        { label: 'Front', click: () => send('view:front') },
        { label: 'Top', click: () => send('view:top') },
        { label: 'Right', click: () => send('view:right') },
        { label: 'Fit All', click: () => send('fit') },
        { type: 'separator' },
        { label: 'Orthographic', click: () => send('toggle:ortho') },
        { label: 'Wireframe', click: () => send('toggle:wire') },
        { label: 'X-Ray', click: () => send('toggle:xray') },
        { label: 'Grid', click: () => send('toggle:grid') },
        { type: 'separator' },
        {
          label: 'Curve Quality',
          submenu: [['Draft (32)', 32], ['Normal (64)', 64], ['Fine (128)', 128], ['Ultra (256)', 256]]
            .map(([label, n]) => ({ label, click: () => send('quality', n) })),
        },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { role: 'toggleDevTools' },
      ],
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        { label: 'Keyboard Shortcuts', click: () => send('shortcuts') },
        { label: 'Show / Hide Pip', click: () => send('mascot') },
        { label: 'About OpenCAD Studio', click: () => send('about') },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

ipcMain.handle('open-file', async (e, { filters }) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters });
  if (r.canceled || !r.filePaths[0]) return null;
  return readForRenderer(r.filePaths[0]);
});

// Reopen a file from the recent list (only design/mesh file types are readable)
ipcMain.handle('read-file', (_e, filePath) => readForRenderer(filePath));

ipcMain.handle('save-dialog', async (e, { defaultPath, filters }) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const r = await dialog.showSaveDialog(win, { defaultPath, filters });
  return r.canceled ? null : r.filePath;
});

ipcMain.handle('write-file', async (_e, filePath, data) => {
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) throw new Error('Invalid path');
  await fs.writeFile(filePath, typeof data === 'string' ? data : Buffer.from(data));
  if (filePath.endsWith('.ocad')) app.addRecentDocument(filePath);
  return true;
});

ipcMain.on('set-dirty', (e, dirty, title) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (!win) return;
  win.state.dirty = dirty;
  win.setDocumentEdited?.(dirty);
  if (title) win.setTitle(title);
});

ipcMain.on('close-window', (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (win) { win.state.forceClose = true; win.close(); }
});

// macOS: double-clicking a .ocad file in Finder
app.on('open-file', (e, filePath) => {
  e.preventDefault();
  if (app.isReady()) createWindow(filePath);
  else pendingOpen.push(filePath);
});

// The renderer reports once the editor (geometry kernel + 3D view) is up.
ipcMain.on('app-ready', () => {
  log('renderer ready');
  if (SMOKE_TEST) { console.log('SMOKE_OK'); app.exit(0); }
});
ipcMain.on('app-error', (_e, message) => fatal('The app failed to start', new Error(String(message))));
app.on('child-process-gone', (_e, details) => {
  log('child process gone', details);
  if (SMOKE_TEST && details.type === 'GPU' && details.reason !== 'clean-exit') log('GPU process crashed');
});

app.whenReady().then(() => {
  log(`starting ${app.getName()} ${app.getVersion()} on ${process.platform} ${process.arch} ${process.getSystemVersion?.() || ''} electron ${process.versions.electron}`);
  try {
    app.setAboutPanelOptions?.({ applicationName: 'OpenCAD Studio', copyright: 'Free and open source (MIT)' });
    buildMenu();
  } catch (e) {
    log('menu setup failed', e); // the app still works without a custom menu
  }
  if (pendingOpen.length) pendingOpen.splice(0).forEach((f) => createWindow(f));
  else createWindow(process.argv.slice(1).find((a) => OPENABLE.has(path.extname(a).toLowerCase()) && path.isAbsolute(a)));
  app.on('activate', () => { if (!windows.size) createWindow(); });
  if (SMOKE_TEST) setTimeout(() => fatal('Smoke test timed out', new Error('renderer never reported ready')), 90_000);
}).catch((e) => fatal('Startup failed', e));

app.on('window-all-closed', () => { if (!isMac) app.quit(); });
