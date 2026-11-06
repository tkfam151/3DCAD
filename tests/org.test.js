import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pageMode, usernameEmail, usernameOf, slugify } from '../src/org.js';

test('page modes from the address', () => {
  assert.deepEqual(pageMode('/3DCAD/app/'), { mode: 'normal' });
  assert.deepEqual(pageMode('/3DCAD/admin/'), { mode: 'admin' });
  assert.deepEqual(pageMode('/3DCAD/admin/index.html'), { mode: 'admin' });
  assert.deepEqual(pageMode('/3DCAD/org/sisb/'), { mode: 'staff', slug: 'sisb' });
  assert.deepEqual(pageMode('/3DCAD/org/SISB'), { mode: 'staff', slug: 'sisb' });
  assert.deepEqual(pageMode('/3DCAD/org/bangkok-test/student/'), { mode: 'student', slug: 'bangkok-test' });
  assert.deepEqual(pageMode('/'), { mode: 'normal' });
});

test('school usernames', () => {
  assert.equal(usernameEmail(' Tonkla ', 'sisb'), 'tonkla@sisb.opencad.invalid');
  assert.equal(usernameOf('tonkla@sisb.opencad.invalid'), 'tonkla');
  assert.equal(usernameOf('someone@gmail.com'), null);
  assert.equal(slugify('Bangkok Test Academy'), 'bangkok-test-academy');
  assert.equal(slugify('Singapore International School of Bangkok'), 'singapore-international-school-of');
  assert.ok(slugify('x'.repeat(60)).length <= 40);
});
