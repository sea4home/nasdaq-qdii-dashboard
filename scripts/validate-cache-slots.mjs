import assert from 'node:assert/strict';
import { chinaCacheSlot, chinaDay } from '../lib/cache-slot.ts';

const atChinaTime = (value) => new Date(`${value}+08:00`);

assert.equal(chinaDay(atChinaTime('2026-09-14T05:50:00')), '2026-09-14');
assert.equal(chinaCacheSlot(atChinaTime('2026-09-14T05:39:00')), '2026-09-13T18');
assert.equal(chinaCacheSlot(atChinaTime('2026-09-14T05:50:00'), true), '2026-09-14T06');
assert.equal(chinaCacheSlot(atChinaTime('2026-09-14T06:00:00')), '2026-09-14T06');
assert.equal(chinaCacheSlot(atChinaTime('2026-09-14T11:50:00'), true), '2026-09-14T12');
assert.equal(chinaCacheSlot(atChinaTime('2026-09-14T12:00:00')), '2026-09-14T12');
assert.equal(chinaCacheSlot(atChinaTime('2026-09-14T17:50:00'), true), '2026-09-14T18');
assert.equal(chinaCacheSlot(atChinaTime('2026-09-14T18:00:00')), '2026-09-14T18');

console.log('Cache slot validation passed.');
