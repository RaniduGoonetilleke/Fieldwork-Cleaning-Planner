import {BookingError, initialState, validateState, applyCommand} from './booking-core.mjs';

export const DATABASE_NAME = 'fieldwork-manager-bookings-v1';
export const OBJECT_STORE = 'draft';
export const STATE_KEY = 'current';
const storageError = (message, cause) => { const error = new BookingError('STORAGE', message); if (cause) error.cause = cause; return error; };

/** All reads and changes use the same IndexedDB record. A transaction serialises competing tabs. */
export function createBookingStore(options = {}) {
  const factory = options.indexedDB ?? globalThis.indexedDB;
  const Channel = Object.prototype.hasOwnProperty.call(options, 'BroadcastChannel') ? options.BroadcastChannel : globalThis.BroadcastChannel;
  const dbName = options.dbName ?? DATABASE_NAME;
  if (typeof dbName !== 'string' || !dbName || dbName.length > 150) throw storageError('The booking database name is invalid.');
  let opening = null, closed = false, channel = null;
  const listeners = new Set();
  const notify = revision => { for (const listener of listeners) { try { listener({revision}); } catch {} } };
  if (typeof Channel === 'function') {
    try {
      channel = new Channel(dbName + ':changes');
      channel.onmessage = event => {
        if (event.data?.type === 'changed' && Number.isSafeInteger(event.data.revision)) notify(event.data.revision);
      };
    } catch { /* Notifications are optional; transaction version checks are authoritative. */ }
  }
  function database() {
    if (closed) return Promise.reject(storageError('This booking store is closed.'));
    if (!factory || typeof factory.open !== 'function') return Promise.reject(storageError('Browser storage is unavailable. No booking was saved.'));
    if (!opening) opening = new Promise((resolve, reject) => {
      let request;
      try { request = factory.open(dbName, 1); } catch (error) { reject(storageError('Could not open browser booking storage.', error)); return; }
      let rejected = false;
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(OBJECT_STORE)) db.createObjectStore(OBJECT_STORE);
      };
      request.onerror = () => { rejected = true; reject(storageError('Could not open browser booking storage.', request.error)); };
      request.onblocked = () => { rejected = true; reject(storageError('Another tab is blocking booking storage. Close it and reload this page.')); };
      request.onsuccess = () => {
        const db = request.result;
        if (rejected || closed) { db.close(); if (!rejected) reject(storageError('This booking store is closed.')); return; }
        db.onversionchange = () => { db.close(); closed = true; notify(null); };
        resolve(db);
      };
    });
    return opening;
  }
  async function transaction(command, expectedRevision) {
    const db = await database();
    if (closed) throw storageError('This booking store is closed.');
    return new Promise((resolve, reject) => {
      let tx, result, failure = null;
      try { tx = db.transaction(OBJECT_STORE, command ? 'readwrite' : 'readonly'); }
      catch (error) { reject(storageError('Could not start the booking transaction. Nothing was saved.', error)); return; }
      const abort = error => {
        failure = error;
        try { tx.abort(); } catch { reject(error); }
      };
      tx.onabort = () => reject(failure || storageError('The booking transaction was cancelled. Nothing was saved.', tx.error));
      tx.onerror = () => { failure ??= storageError('Could not save the booking. Nothing was saved.', tx.error); };
      tx.oncomplete = () => {
        if (failure) { reject(failure); return; }
        if (!result) { reject(storageError('The booking transaction returned no state.')); return; }
        if (command) {
          notify(result.revision);
          try { channel?.postMessage({type: 'changed', revision: result.revision}); } catch {}
        }
        resolve(result);
      };
      let store, request;
      try { store = tx.objectStore(OBJECT_STORE); request = store.get(STATE_KEY); }
      catch (error) { abort(storageError('Could not read saved bookings.', error)); return; }
      request.onerror = () => { failure = storageError('Could not read saved bookings.', request.error); };
      request.onsuccess = () => {
        try {
          const state = request.result === undefined ? initialState() : validateState(request.result);
          result = command ? applyCommand(state, command, expectedRevision) : state;
          if (command) {
            const put = store.put(result, STATE_KEY);
            put.onerror = () => { failure = storageError('Could not save bookings. Check browser storage permissions or available space.', put.error); };
          }
        } catch (error) { abort(error instanceof BookingError ? error : storageError('Saved bookings could not be read. Nothing was changed.', error)); }
      };
    });
  }
  return {
    load: () => transaction(null),
    commit(command, expectedRevision) {
      if (!command || typeof command !== 'object' || Array.isArray(command)) return Promise.reject(new BookingError('VALIDATION', 'Choose a booking action.'));
      let captured;
      try { captured = structuredClone(command); }
      catch { return Promise.reject(new BookingError('VALIDATION', 'The booking action could not be copied. Nothing was saved.')); }
      return transaction(captured, expectedRevision);
    },
    subscribe(listener) { if (typeof listener !== 'function') throw new TypeError('A booking listener must be a function.'); listeners.add(listener); return () => listeners.delete(listener); },
    close() { closed = true; listeners.clear(); channel?.close(); if (opening) opening.then(db => db.close(), () => {}); },
  };
}
