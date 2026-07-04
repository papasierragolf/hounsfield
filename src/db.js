import { openDB } from 'idb';

/**
 * Local-only persistence. Everything lives in IndexedDB on the device:
 *  - studies: metadata + generated report
 *  - images:  full-resolution Blobs + small JPEG thumbnails
 *  - settings: key/value (model id, device preference, disclaimer ack)
 */
const DB_NAME = 'hounsfield';
const DB_VERSION = 1;

const dbPromise = openDB(DB_NAME, DB_VERSION, {
  upgrade(db) {
    const studies = db.createObjectStore('studies', { keyPath: 'id' });
    studies.createIndex('createdAt', 'createdAt');
    db.createObjectStore('images', { keyPath: 'id' });
    db.createObjectStore('settings');
  },
});

export function uid() {
  return crypto.randomUUID();
}

// ---- studies ----
export async function saveStudy(study) {
  const db = await dbPromise;
  await db.put('studies', study);
  return study;
}

export async function getStudy(id) {
  return (await dbPromise).get('studies', id);
}

export async function listStudies() {
  const db = await dbPromise;
  const all = await db.getAllFromIndex('studies', 'createdAt');
  return all.reverse();
}

export async function deleteStudy(id) {
  const db = await dbPromise;
  const study = await db.get('studies', id);
  if (study) {
    for (const imageId of study.imageIds || []) await db.delete('images', imageId);
    await db.delete('studies', id);
  }
}

// ---- images ----
export async function saveImage(image) {
  const db = await dbPromise;
  await db.put('images', image);
  return image;
}

export async function getImage(id) {
  return (await dbPromise).get('images', id);
}

// ---- settings ----
export async function getSetting(key, fallback = null) {
  const v = await (await dbPromise).get('settings', key);
  return v === undefined ? fallback : v;
}

export async function setSetting(key, value) {
  return (await dbPromise).put('settings', value, key);
}

// ---- bulk (backup/restore) ----
export async function getAllData() {
  const db = await dbPromise;
  return { studies: await db.getAll('studies'), images: await db.getAll('images') };
}

export async function importData({ studies, images }) {
  const db = await dbPromise;
  const tx = db.transaction(['studies', 'images'], 'readwrite');
  for (const s of studies) tx.objectStore('studies').put(s);
  for (const i of images) tx.objectStore('images').put(i);
  await tx.done;
}
