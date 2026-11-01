// Electron main process: window, native macOS menus and file access.
const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs/promises');

const isMac = process.platform === 'darwin';
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
    show: false,
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
  win.once('ready-to-show', () => win.show());

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
    const text = await fs.readFile(filePath, 'utf8');
    win.webContents.send('menu', 'openFile', { path: filePath, name: path.basename(filePath), data: text });
    app.addRecentDocument(filePath);
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
        { label: 'New Design', accelerator: 'CmdOrCtrl+N', click: () => send('new') },
        { label: 'New Window', accelerator: 'CmdOrCtrl+Shift+N', click: () => createWindow() },
        { label: 'Open…', accelerator: 'CmdOrCtrl+O', click: () => send('open') },
        { role: 'recentDocuments', submenu: [{ role: 'clearRecentDocuments' }] },
        { label: 'Examples…', click: () => send('examples') },
        { type: 'separator' },
        { label: 'Save', accelerator: 'CmdOrCtrl+S', click: () => send('save') },
        { label: 'Save As…', accelerator: 'CmdOrCtrl+Shift+S', click: () => send('saveAs') },
        { type: 'separator' },
        { label: 'Import STL…', accelerator: 'CmdOrCtrl+I', click: () => send('importStl') },
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
        { label: 'About OpenCAD Studio', click: () => send('about') },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

ipcMain.handle('open-file', async (e, { filters, binary }) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters });
  if (r.canceled || !r.filePaths[0]) return null;
  const p = r.filePaths[0];
  const name = path.basename(p);
  if (binary) {
    const buf = await fs.readFile(p);
    return { path: p, name, buffer: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
  }
  app.addRecentDocument(p);
  return { path: p, name, text: await fs.readFile(p, 'utf8') };
});

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

app.whenReady().then(() => {
  app.setAboutPanelOptions?.({ applicationName: 'OpenCAD Studio', copyright: 'Free and open source (MIT)' });
  buildMenu();
  if (pendingOpen.length) pendingOpen.splice(0).forEach((f) => createWindow(f));
  else createWindow(process.argv.find((a) => a.endsWith('.ocad')));
  app.on('activate', () => { if (!windows.size) createWindow(); });
});

app.on('window-all-closed', () => { if (!isMac) app.quit(); });
