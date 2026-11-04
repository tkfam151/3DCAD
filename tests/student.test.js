import { test } from 'node:test';
import assert from 'node:assert/strict';
import Module from 'manifold-3d/manifold.js';
import { regenerate } from '../src/kernel/kernel.js';
import { printReport, overhangShare, PRINTERS, journalMarkdown, printReportText } from '../src/student.js';

const wasm = await Module();
wasm.setup();
const doc = (features) => ({ parameters: [], settings: { segments: 32 }, bodies: {}, bodyProps: {}, features });

test('print check: fits, floating, overhangs, too big', () => {
  const r = regenerate(doc([
    { id: 'a', type: 'box', params: { width: '20', depth: '20', height: '20', operation: 'new' } },
    { id: 'b', type: 'box', params: { width: '10', depth: '10', height: '10', z: '15', x: '40', operation: 'new' } },
    { id: 'c', type: 'box', params: { width: '400', depth: '10', height: '10', x: '300', operation: 'new' } },
  ]), wasm);
  const rep = printReport(r.bodies, { printer: PRINTERS[0] });
  const [a, b, c] = rep.items;
  assert.equal(a.warnings[0].level, 'ok');
  assert.ok(a.grams > 2 && a.grams < 10, `grams ${a.grams}`);
  assert.ok(b.warnings.some((w) => /Floats 15 mm/.test(w.text)), JSON.stringify(b.warnings));
  assert.ok(b.overhang > 0.1); // its bottom face hangs in the air
  assert.equal(c.fits, false);
  assert.ok(c.warnings.some((w) => /Too big/.test(w.text)));
  assert.ok(rep.total.grams > a.grams);
  assert.match(printReportText(rep), /Total: about/);
});

test('overhang: a box on the bed has none, a T-shape has some', () => {
  const box = regenerate(doc([{ id: 'a', type: 'box', params: { width: '10', depth: '10', height: '10', operation: 'new' } }]), wasm).bodies[0];
  assert.equal(overhangShare(box, 0), 0);
  const t = regenerate(doc([
    { id: 'a', type: 'box', params: { width: '4', depth: '4', height: '10', operation: 'new' } },
    { id: 'b', type: 'box', params: { width: '20', depth: '4', height: '2', z: '10', operation: 'join', target: 'a' } },
  ]), wasm).bodies[0];
  assert.ok(overhangShare(t, 0) > 0.05);
});

test('journal markdown includes the design cycle and student details', () => {
  const md = journalMarkdown({ features: [{ name: 'Box1', type: 'box' }], journal: { inquiring: 'A stand for my phone' } }, {
    title: 'Phone stand', student: 'Tonkla', className: '9B', school: 'Singapore International School of Bangkok',
  });
  assert.match(md, /# Phone stand/);
  assert.match(md, /Tonkla · 9B · Singapore International School of Bangkok/);
  assert.match(md, /A · Inquiring & analysing\n\nA stand for my phone/);
  assert.match(md, /D · Evaluating\n\n_Not filled in yet._/);
  assert.match(md, /- Box1 \(box\)/);
});
