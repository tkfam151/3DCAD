import './style.css';
import Module from 'manifold-3d/manifold.js';
import wasmUrl from 'manifold-3d/manifold.wasm?url';
import { App } from './app.js';
import { registerFont } from './kernel/kernel.js';
import droidRegular from './assets/fonts/droid_sans_regular.typeface.json';
import droidBold from './assets/fonts/droid_sans_bold.typeface.json';

registerFont('regular', droidRegular);
registerFont('bold', droidBold);

async function boot() {
  if (window.api?.platform === 'darwin') document.body.classList.add('mac');
  const wasm = await Module({ locateFile: () => wasmUrl });
  wasm.setup();
  window.app = new App(wasm);
  document.getElementById('loading')?.remove();
  window.api?.reportReady?.();
}

boot().catch((e) => {
  console.error(e);
  const l = document.getElementById('loading');
  if (l) l.textContent = `Failed to start: ${e.message}`;
  window.api?.reportError?.(e?.stack || e?.message || String(e));
});
