/**
 * Thin WebCrypto (AES-GCM) helpers used to encrypt studies and images at
 * rest. The same functions run on both platforms — only where the key
 * material comes from differs (see vault.js): native iOS derives it from a
 * Face ID/Touch ID-gated Keychain item, the browser holds a non-extractable
 * CryptoKey it never exposes to JS as raw bytes.
 */

function toB64(bytes) {
  let bin = '';
  for (const b of new Uint8Array(bytes)) bin += String.fromCharCode(b);
  return btoa(bin);
}

function fromB64(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** Import 32 raw key bytes (base64) as a non-extractable AES-GCM CryptoKey. */
export async function importRawKey(base64Key) {
  const bytes = fromB64(base64Key);
  return crypto.subtle.importKey('raw', bytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

/** Generate a fresh non-extractable AES-256-GCM key (browser path). */
export function generateKey() {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

/** Encrypt a JSON-serializable value. Returns a small plain object safe to store in IndexedDB. */
export async function encryptJSON(key, value) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
  return { iv: toB64(iv), data: toB64(ciphertext) };
}

export async function decryptJSON(key, { iv, data }) {
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromB64(iv) },
    key,
    fromB64(data)
  );
  return JSON.parse(new TextDecoder().decode(plaintext));
}

/** Encrypt a Blob (image bytes). Returns a Blob of opaque ciphertext plus its IV. */
export async function encryptBlob(key, blob) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = await blob.arrayBuffer();
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
  return { iv: toB64(iv), blob: new Blob([ciphertext], { type: 'application/octet-stream' }) };
}

/** Decrypt back to a Blob with the given mime type (images are always JPEG here). */
export async function decryptBlob(key, { iv, blob }, mime = 'image/jpeg') {
  const ciphertext = await blob.arrayBuffer();
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromB64(iv) },
    key,
    ciphertext
  );
  return new Blob([plaintext], { type: mime });
}
