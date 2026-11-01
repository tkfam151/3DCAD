import './style.css';
import Module from 'manifold-3d/manifold.js';
import wasmUrl from 'manifold-3d/manifold.wasm?url';
import { App } from './app.js';

async function boot() {
  if (window.api?.platform === 'darwin') document.body.classList.add('mac');
  const wasm = await Module({ locateFile: () => wasmUrl });
  wasm.setup();
  window.app = new App(wasm);
  document.getElementById('loading')?.remove();
}

boot().catch((e) => {
  console.error(e);
  const l = document.getElementById('loading');
  if (l) l.textContent = `Failed to start: ${e.message}`;
});
