/**
 * Backup & restore. Produces a single portable `.hounsfield` JSON bundle
 * containing every study, image, and report.
 *
 * Destination is entirely the user's choice:
 *  - iOS: the share sheet offers "Save to Files" → iCloud Drive, or the
 *    Google Drive / Dropbox apps directly.
 *  - Desktop browser: a normal file download the user can drop into any
 *    synced folder (iCloud Drive, Google Drive, etc.).
 *
 * Nothing is uploaded by the app itself.
 */
import { getAllData, importData } from '../db.js';
import { blobToDataURL, dataURLToBlob } from './image.js';
import { isNative } from './platform.js';

const FORMAT = 'hounsfield-backup';
const VERSION = 1;

export async function createBackupBlob() {
  const { studies, images } = await getAllData();
  const serializedImages = await Promise.all(
    images.map(async (img) => ({
      ...img,
      blob: await blobToDataURL(img.blob),
      thumb: await blobToDataURL(img.thumb),
    }))
  );
  const payload = {
    format: FORMAT,
    version: VERSION,
    exportedAt: new Date().toISOString(),
    studies,
    images: serializedImages,
  };
  return new Blob([JSON.stringify(payload)], { type: 'application/json' });
}

export function backupFilename() {
  const d = new Date().toISOString().slice(0, 10);
  return `hounsfield-backup-${d}.hounsfield`;
}

/** Share (iOS/Android share sheet) with download fallback. */
export async function exportBackup() {
  const blob = await createBackupBlob();
  const name = backupFilename();

  if (isNative()) {
    // Native shell: write to the app cache, then hand the file to the iOS
    // share sheet (Save to Files → iCloud Drive, Google Drive app, AirDrop…).
    const { Filesystem, Directory } = await import('@capacitor/filesystem');
    const { Share } = await import('@capacitor/share');
    const dataUrl = await blobToDataURL(blob);
    const { uri } = await Filesystem.writeFile({
      path: name,
      data: dataUrl.split(',')[1],
      directory: Directory.Cache,
    });
    try {
      await Share.share({ title: 'Hounsfield backup', files: [uri] });
      return 'shared';
    } catch (err) {
      if (String(err?.message || err).toLowerCase().includes('cancel')) return 'cancelled';
      throw err;
    }
  }

  const file = new File([blob], name, { type: 'application/json' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Hounsfield backup' });
      return 'shared';
    } catch (err) {
      if (err.name === 'AbortError') return 'cancelled';
      // fall through to download
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return 'downloaded';
}

export async function restoreBackup(file) {
  const text = await file.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error('Not a valid backup file.');
  }
  if (payload.format !== FORMAT) throw new Error('Not a Hounsfield backup file.');
  if (payload.version > VERSION) throw new Error('Backup was made by a newer version of the app.');

  const images = payload.images.map((img) => ({
    ...img,
    blob: dataURLToBlob(img.blob),
    thumb: dataURLToBlob(img.thumb),
  }));
  await importData({ studies: payload.studies, images });
  return { studies: payload.studies.length, images: images.length };
}
