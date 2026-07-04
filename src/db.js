import { openDB } from 'idb';
import { encryptJSON, decryptJSON, encryptBlob, decryptBlob } from './lib/crypto.js';

/**
 * Local-only persistence. Everything lives in IndexedDB on the device:
 *  - studies: metadata + generated report
 *  - images:  full-resolution Blobs + small JPEG thumbnails
 *  - settings: key/value (model id, device preference, disclaimer ack) —
 *    intentionally never encrypted, since some settings (theme, disclaimer
 *    acceptance) must be readable before the vault is unlocked to paint the
 *    UI at all.
 *
 * When a vault key is active (see lib/vault.js), studies and images are
 * transparently encrypted at rest with AES-GCM: only `id`/`createdAt`
 * (studies) and `id`/`studyId`/`width`/`height` (images) stay plaintext —
 * enough to keep the IndexedDB indexes and lookups working — everything
 * else (context, question, report, and the image bytes themselves) is
 * opaque ciphertext on disk.
 */
const DB_NAME = 'hounsfield';
const DB_VERSION = 2;

const dbPromise = openDB(DB_NAME, DB_VERSION, {
  upgrade(db, oldVersion) {
    if (oldVersion < 1) {
      const studies = db.createObjectStore('studies', { keyPath: 'id' });
      studies.createIndex('createdAt', 'createdAt');
      db.createObjectStore('images', { keyPath: 'id' });
      db.createObjectStore('settings');
    }
    if (oldVersion < 2) {
      // Browser-only: holds the non-extractable AES-GCM CryptoKey for the
      // vault. Native iOS keeps the key in the Keychain instead (see
      // BiometricVaultPlugin.swift) and never uses this store.
      db.createObjectStore('vaultKeys');
    }
  },
});

export function uid() {
  return crypto.randomUUID();
}

// ---- vault key (in-memory only; set/cleared by lib/vault.js) ----
let activeKey = null;

export function setActiveKey(key) {
  activeKey = key;
}

export function clearActiveKey() {
  activeKey = null;
}

export function hasActiveKey() {
  return !!activeKey;
}

/** For lib/vault.js only — needed to re-encrypt with the key that was just verified during disable(). */
export function getActiveKey() {
  return activeKey;
}

async function encryptStudy(study) {
  if (!activeKey) return study;
  const { id, createdAt } = study;
  return { id, createdAt, enc: await encryptJSON(activeKey, study) };
}

async function decryptStudy(record) {
  if (!record || !record.enc) return record; // plaintext (encryption never enabled)
  if (!activeKey) throw new Error('Vault is locked — unlock with Face ID/Touch ID first.');
  return decryptJSON(activeKey, record.enc);
}

async function encryptImage(image) {
  if (!activeKey) return image;
  const { id, studyId, width, height } = image;
  const [blobEnc, thumbEnc] = await Promise.all([
    encryptBlob(activeKey, image.blob),
    encryptBlob(activeKey, image.thumb),
  ]);
  return { id, studyId, width, height, blobEnc, thumbEnc };
}

async function decryptImage(record) {
  if (!record || !record.blobEnc) return record; // plaintext (encryption never enabled)
  if (!activeKey) throw new Error('Vault is locked — unlock with Face ID/Touch ID first.');
  const [blob, thumb] = await Promise.all([
    decryptBlob(activeKey, record.blobEnc),
    decryptBlob(activeKey, record.thumbEnc),
  ]);
  return { id: record.id, studyId: record.studyId, width: record.width, height: record.height, blob, thumb };
}

// ---- studies ----
export async function saveStudy(study) {
  const db = await dbPromise;
  await db.put('studies', await encryptStudy(study));
  return study;
}

export async function getStudy(id) {
  return decryptStudy(await (await dbPromise).get('studies', id));
}

export async function listStudies() {
  const db = await dbPromise;
  const all = await db.getAllFromIndex('studies', 'createdAt');
  const decrypted = await Promise.all(all.map(decryptStudy));
  return decrypted.reverse();
}

export async function deleteStudy(id) {
  const db = await dbPromise;
  const study = await getStudy(id);
  if (study) {
    for (const imageId of study.imageIds || []) await db.delete('images', imageId);
    await db.delete('studies', id);
  }
}

// ---- images ----
export async function saveImage(image) {
  const db = await dbPromise;
  await db.put('images', await encryptImage(image));
  return image;
}

export async function getImage(id) {
  return decryptImage(await (await dbPromise).get('images', id));
}

// ---- vault key storage (browser path only; see lib/vault.js) ----
export async function getVaultKeyRecord() {
  return (await dbPromise).get('vaultKeys', 'key');
}

export async function setVaultKeyRecord(cryptoKey) {
  return (await dbPromise).put('vaultKeys', cryptoKey, 'key');
}

export async function deleteVaultKeyRecord() {
  return (await dbPromise).delete('vaultKeys', 'key');
}

// ---- settings (always plaintext) ----
export async function getSetting(key, fallback = null) {
  const v = await (await dbPromise).get('settings', key);
  return v === undefined ? fallback : v;
}

export async function setSetting(key, value) {
  return (await dbPromise).put('settings', value, key);
}

// ---- bulk (backup/restore) — always operates on decrypted plaintext ----
export async function getAllData() {
  const db = await dbPromise;
  const [studyRecords, imageRecords] = await Promise.all([db.getAll('studies'), db.getAll('images')]);
  const studies = await Promise.all(studyRecords.map(decryptStudy));
  const images = await Promise.all(imageRecords.map(decryptImage));
  return { studies, images };
}

export async function importData({ studies, images }) {
  const db = await dbPromise;
  const encStudies = await Promise.all(studies.map(encryptStudy));
  const encImages = await Promise.all(images.map(encryptImage));
  const tx = db.transaction(['studies', 'images'], 'readwrite');
  for (const s of encStudies) tx.objectStore('studies').put(s);
  for (const i of encImages) tx.objectStore('images').put(i);
  await tx.done;
}

/**
 * Re-encrypt every study/image under the currently active key (called right
 * after enabling or disabling the vault, with `activeKey` already set to
 * the new key or cleared to null for plaintext). Reads with the OLD key
 * first, so call this only while `activeKey` still refers to the state
 * matching what's on disk — vault.js handles the before/after key swap.
 */
export async function reencryptAll(readKey, writeKey) {
  const db = await dbPromise;
  const [studyRecords, imageRecords] = await Promise.all([db.getAll('studies'), db.getAll('images')]);

  activeKey = readKey;
  const studies = await Promise.all(studyRecords.map(decryptStudy));
  const images = await Promise.all(imageRecords.map(decryptImage));

  activeKey = writeKey;
  const encStudies = await Promise.all(studies.map(encryptStudy));
  const encImages = await Promise.all(images.map(encryptImage));

  const tx = db.transaction(['studies', 'images'], 'readwrite');
  for (const s of encStudies) tx.objectStore('studies').put(s);
  for (const i of encImages) tx.objectStore('images').put(i);
  await tx.done;
}
