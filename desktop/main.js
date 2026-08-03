// desktop/main.js — the cockpit shell.
//
// The same Solace the browser runs, in a window that behaves like a
// ship instead of a document: fullscreen from the first frame (no
// gesture law — we own the window), sound alive at boot (no autoplay
// gate), pointer lock without a toast, Esc entirely ours. This shell
// intentionally contains NO app logic: it loads the deployed worker
// (or SOLACE_URL for dev) so the web build stays the single source of
// truth and the Worker brain serves both vessels identically.
//
//   npm start                          → launch against production
//   SOLACE_URL=http://localhost:5199 npm start   → against vite dev
//
// Not yet done (needed before distribution): code signing + macOS
// notarization (electron-builder `identity`/`notarize`), auto-update.

const { app, BrowserWindow } = require('electron');

const TARGET = process.env.SOLACE_URL || 'https://solace.nicholasjprince.workers.dev';

// The ship has sound the moment you board — no gesture required.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

function createWindow() {
  const win = new BrowserWindow({
    fullscreen: true,
    backgroundColor: '#000000',
    show: false,                  // no white flash: show on first paint
    webPreferences: {
      contextIsolation: true,     // the page never touches Node
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.setMenuBarVisibility(false);
  win.once('ready-to-show', () => win.show());
  win.loadURL(TARGET);
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
