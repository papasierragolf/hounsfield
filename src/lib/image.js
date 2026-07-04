/**
 * Image ingestion utilities. MedGemma's vision encoder works on 896×896
 * crops, so we downscale large captures — this also keeps IndexedDB lean and
 * inference fast. iOS HEIC photos are transparently re-encoded to JPEG by
 * drawing through a canvas.
 */
const MAX_DIM = 1280; // stored size; the processor resizes again for the model
const THUMB_DIM = 320;

function loadBitmap(blob) {
  if ('createImageBitmap' in window) return createImageBitmap(blob);
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = reject;
    img.src = url;
  });
}

function drawScaled(bitmap, maxDim) {
  const w = bitmap.width;
  const h = bitmap.height;
  const scale = Math.min(1, maxDim / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function canvasToBlob(canvas, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
}

/**
 * Normalize any user-supplied image file into {blob, thumb, width, height}.
 */
export async function ingestImageFile(file) {
  const bitmap = await loadBitmap(file);
  const full = drawScaled(bitmap, MAX_DIM);
  const thumbCanvas = drawScaled(bitmap, THUMB_DIM);
  const [blob, thumb] = await Promise.all([canvasToBlob(full, 0.92), canvasToBlob(thumbCanvas, 0.8)]);
  if (bitmap.close) bitmap.close();
  return { blob, thumb, width: full.width, height: full.height };
}

export function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

export function dataURLToBlob(dataUrl) {
  const [head, b64] = dataUrl.split(',');
  const mime = head.match(/data:(.*?);/)[1];
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}
