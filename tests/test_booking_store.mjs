import test from 'node:test';
import assert from 'node:assert/strict';
import {createBookingStore, STATE_KEY} from '../public/booking-store.mjs';
import {CHECK_KEYS, initialState} from '../public/booking-core.mjs';

// The fake serialises transactions across connections, like a single IndexedDB object store.
// Real-browser tests are still required for the browser's own transaction implementation.
class FakeTransaction {
  constructor(database, mode) {
    this.database = database; this.mode = mode; this.pending = []; this.active = false; this.finished = false;
    this.previous = database.tail;
    database.tail = new Promise(resolve => { this.release = resolve; });
    this.previous.then(() => {
      if (this.finished) return;
      this.active = true; this.data = new Map([...database.data.entries()].map(([key, value]) => [key, structuredClone(value)]));
      this.flush();
    });
  }
  objectStore() {
    return {get: key => this.request(() => structuredClone(this.data.get(key))), put: (value, key) => {
      const copy = structuredClone(value);
      return this.request(() => {
        if (this.mode !== 'readwrite') throw new Error('Read-only transaction');
        if (this.database.failWrite) { this.database.failWrite = false; throw new Error('Quota exceeded'); }
        this.data.set(key, copy); return key;
      });
    }};
  }
  request(operation) { const request = {}; this.pending.push({operation, request}); if (this.active) queueMicrotask(() => this.flush()); return request; }
  flush() {
    if (this.finished || !this.active) return;
    const task = this.pending.shift();
    if (!task) { this.finished = true; if (this.mode === 'readwrite') this.database.data = this.data; this.oncomplete?.(); this.release(); return; }
    try { task.request.result = task.operation(); task.request.onsuccess?.(); }
    catch (error) { task.request.error = error; task.request.onerror?.(); this.error = error; this.onerror?.(); this.abort(); return; }
    queueMicrotask(() => this.flush());
  }
  abort() { if (this.finished) return; this.finished = true; queueMicrotask(() => {this.onabort?.(); this.release();}); }
}
class FakeIndexedDB {
  data = new Map(); tail = Promise.resolve(); initialized = false; failWrite = false; failOpen = false; writes = 0;
  open() {
    const request = {};
    queueMicrotask(() => {
      if (this.failOpen) {request.error = new Error('Storage denied'); request.onerror?.(); return;}
      const db = {objectStoreNames: {contains: () => this.initialized}, createObjectStore: () => {this.initialized = true;}, close() {}, transaction: (_, mode) => {if (mode === 'readwrite') this.writes++; return new FakeTransaction(this, mode);}};
      request.result = db;
      if (!this.initialized) request.onupgradeneeded?.();
      request.onsuccess?.();
    });
    return request;
  }
}
class FakeChannel {
  static channels = [];
  constructor(name) {this.name = name; this.closed = false; FakeChannel.channels.push(this);}
  postMessage(data) {for (const other of FakeChannel.channels) if (other !== this && !other.closed && other.name === this.name) queueMicrotask(() => other.onmessage?.({data}));}
  close() {this.closed = true;}
}
const fixture = () => { const indexedDB = new FakeIndexedDB(); const options = {indexedDB, BroadcastChannel: FakeChannel, dbName: 'test-' + Math.random()}; return {indexedDB, a: createBookingStore(options), b: createBookingStore(options)}; };
const building = {company: 'Company', customer: 'Customer', building: 'Building'};
const job = (changes = {}) => ({id: 'job-1', name: 'Windows', kind: 'windows', place: 'Lobby', stage: 1, mode: 'UR5', workerId: 'H2', groups: [{count: 6, width: 1, height: 1.5, faces: 'inside'}], access: 'floor', checks: Object.fromEntries(CHECK_KEYS.map(key => [key, 'yes'])), notes: '', status: 'draft', ...changes});
const errorCode = expected => error => error.code === expected;

test('an empty database loads without writing, and committed data survives another connection', async () => {
  const {indexedDB, a, b} = fixture();
  assert.deepEqual(await a.load(), initialState()); assert.equal(indexedDB.writes, 0);
  const state = await a.commit({type: 'setContext', context: building}, 0);
  assert.equal(state.revision, 1); assert.deepEqual(await b.load(), state);
  state.context.building = 'Local object changed'; assert.equal((await a.load()).context.building, 'Building');
  a.close(); b.close();
});

test('two simultaneous writes based on one revision cannot both commit', async () => {
  const {a, b} = fixture();
  await a.commit({type: 'setContext', context: building}, 0);
  const [left, right] = await Promise.all([a.load(), b.load()]);
  const results = await Promise.allSettled([a.commit({type: 'reserveJob', job: job()}, left.revision), b.commit({type: 'reserveJob', job: job({id: 'job-2', mode: 'G1'})}, right.revision)]);
  assert.equal(results.filter(value => value.status === 'fulfilled').length, 1);
  const failed = results.find(value => value.status === 'rejected'); assert.equal(failed.reason.code, 'STALE_REVISION');
  const saved = await a.load(); assert.equal(saved.jobs.length, 1); assert.equal(saved.revision, 2);
  assert.deepEqual(await b.load(), saved);
  a.close(); b.close();
});

test('retrying a stale action does not duplicate it and every writer must re-read', async () => {
  const {a, b} = fixture();
  await a.commit({type: 'setContext', context: building}, 0);
  const command = {type: 'reserveJob', job: job()};
  await a.commit(command, 1);
  await assert.rejects(a.commit(command, 1), errorCode('STALE_REVISION'));
  await assert.rejects(b.commit({type: 'setBusy', id: 'H2', stage: 1, busy: true}, 1), errorCode('STALE_REVISION'));
  const state = await b.load(); assert.equal(state.jobs.length, 1);
  const changed = await b.commit({type: 'setBusy', id: 'H2', stage: 1, busy: true}, state.revision);
  assert.deepEqual(changed.busy.H2, [1]);
  a.close(); b.close();
});

test('reservation conflict rejects atomically even at the current version', async () => {
  const {a} = fixture();
  await a.commit({type: 'setContext', context: building}, 0);
  const before = await a.commit({type: 'reserveJob', job: job()}, 1);
  await assert.rejects(a.commit({type: 'reserveJob', job: job({id: 'job-2', mode: 'UR3'})}, before.revision), errorCode('RESERVATION_BLOCKED'));
  assert.deepEqual(await a.load(), before);
  a.close();
});

test('write failure leaves the saved state untouched and reports the storage problem', async () => {
  const {indexedDB, a} = fixture();
  const before = await a.commit({type: 'setContext', context: building}, 0);
  indexedDB.failWrite = true;
  await assert.rejects(a.commit({type: 'reserveJob', job: job()}, before.revision), errorCode('STORAGE'));
  assert.deepEqual(await a.load(), before);
  a.close();
});

test('bad saved data is not silently replaced or partly repaired', async () => {
  const {indexedDB, a} = fixture();
  indexedDB.data.set(STATE_KEY, {...initialState(), schema: 'unknown-format'});
  const original = structuredClone(indexedDB.data.get(STATE_KEY));
  await assert.rejects(a.load(), errorCode('SCHEMA'));
  await assert.rejects(a.commit({type: 'setContext', context: building}, 0), errorCode('SCHEMA'));
  assert.deepEqual(indexedDB.data.get(STATE_KEY), original);
  a.close();
});

test('unavailable or denied browser storage never falls back to an unsaved plan', async () => {
  const unavailable = createBookingStore({indexedDB: {}, BroadcastChannel: null});
  await assert.rejects(unavailable.load(), errorCode('STORAGE'));
  await assert.rejects(unavailable.commit({type: 'setContext', context: building}, 0), errorCode('STORAGE'));
  const denied = new FakeIndexedDB(); denied.failOpen = true;
  await assert.rejects(createBookingStore({indexedDB: denied, BroadcastChannel: null}).load(), errorCode('STORAGE'));
  await assert.rejects(unavailable.commit(null, 0), errorCode('VALIDATION'));
  unavailable.close();
});

test('notifications announce committed revisions only and are not required for stale-write protection', async () => {
  const {indexedDB, a, b} = fixture(); const events = [], own = [];
  const unsubscribe = b.subscribe(event => events.push(event.revision)); a.subscribe(event => own.push(event.revision));
  await a.commit({type: 'setContext', context: building}, 0);
  await Promise.resolve(); assert.deepEqual(events, [1]); assert.deepEqual(own, [1]);
  indexedDB.failWrite = true;
  await assert.rejects(a.commit({type: 'reserveJob', job: job()}, 1));
  await Promise.resolve(); assert.deepEqual(events, [1]);
  unsubscribe(); await a.commit({type: 'setBusy', id: 'H2', stage: 2, busy: true}, 1);
  await Promise.resolve(); assert.deepEqual(events, [1]);
  const silent = createBookingStore({indexedDB, BroadcastChannel: null});
  await assert.rejects(silent.commit({type: 'saveJob', job: job()}, 1), errorCode('STALE_REVISION'));
  a.close(); b.close(); silent.close();
});

test('closing the store refuses subsequent operations', async () => {
  const {a} = fixture(); await a.load(); a.close();
  await assert.rejects(a.load(), errorCode('STORAGE'));
  await assert.rejects(a.commit({type: 'setContext', context: building}, 0), errorCode('STORAGE'));
});

test('commit captures its command before awaiting the database or a queued transaction', async () => {
  const {a, b} = fixture();
  const context = structuredClone(building);
  const opening = a.commit({type: 'setContext', context}, 0);
  context.building = 'Changed before the database opened';
  assert.equal((await opening).context.building, 'Building');
  const command = {type: 'reserveJob', job: job()};
  const pending = a.commit(command, 1);
  command.job.place = 'Different place';
  command.job.mode = 'G1';
  command.job.groups[0].count = 100;
  const saved = await pending;
  assert.equal(saved.jobs[0].place, 'Lobby');
  assert.equal(saved.jobs[0].mode, 'UR5');
  assert.equal(saved.jobs[0].groups[0].count, 6);
  assert.deepEqual(await b.load(), saved);
  a.close(); b.close();
});

test('an uncopyable command fails before any transaction writes', async () => {
  const {indexedDB, a} = fixture();
  const before = await a.load();
  await assert.rejects(a.commit({type: 'saveJob', job: {...job(), invalid: () => true}}, 0), errorCode('VALIDATION'));
  assert.equal(indexedDB.writes, 0);
  assert.deepEqual(await a.load(), before);
  a.close();
});
