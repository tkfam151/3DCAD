import { test } from 'node:test';
import assert from 'node:assert/strict';
import { answer } from '../src/pip-brain.js';

const has = (q, re, ctx) => assert.match(answer(q, ctx).html, re, q);

test('Pip answers how-to questions', () => {
  has('how do I make a hole?', /negative distance/);
  has('drill holes in my part', /negative distance/);
  has('how to round the edges', /Edge fillet/);
  has('export for 3d printing', /Export → STL/);
  has('how do I draw a rectangle', /Sketch/);
  has('rotate my part', /Rotate/);
  has('make 6 copies around a circle', /Circular/);
  has('how do I measure', /Measure/);
  has('can it open STEP files from fusion', /can't read STEP/);
  has('add threads to a bolt', /can't do that one yet/);
  has('mac app keeps bouncing', /Terminal fix/);
  has('how do I make it bigger', /blue arrows/);
  has('edit the shape with arrows', /blue arrows/);
  has('how do I add text', /Text/);
  has('engrave my name', /engrave/);
  has('how do I save to the cloud', /Cloud/);
  has('sign in', /Sign in/);
  has('will it need supports', /Print check/);
  has('how long will it take to print', /Print check/);
  has('how do I submit to my teacher', /Hand in/);
  has('where do I write my reflection', /Journal/);
  has('show me a tutorial', /Lesson/);
  has('what is the meaning of life', /not sure/);
  assert.equal(answer('how do I make a hole').actions[0].cmd, 'sketch');
});

test('Pip answers about the open model', () => {
  const ctx = {
    errors: [{ name: 'Box2', message: 'Dimensions must be positive' }],
    bodies: [{ name: 'Body1', size: [20, 10, 5], volume: 1000 }],
    selected: [],
  };
  has("what's wrong?", /Box2.*Dimensions must be positive/, ctx);
  has('why is it red', /Box2/, ctx);
  has('how big is it?', /20 × 10 × 5 mm/, ctx);
  has('how much filament does it weigh', /1\.2 g/, ctx);
  has("what's wrong", /No steps have errors/, { errors: [], bodies: [] });
  has('how big is it', /nothing to measure/, { errors: [], bodies: [] });
  assert.equal(answer('good boy pip').mood, 'cheer');
  assert.equal(answer('hello').mood, 'wave');
});
