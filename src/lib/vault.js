/**
 * Biometric lock + encryption-key lifecycle.
 *
 * Native iOS: Face ID/Touch ID gates a Keychain item (BiometricVaultPlugin)
 * that holds the raw AES key. The OS itself refuses to release the key
 * without a fresh biometric check — this is both the login gate and the
 * source of the encryption key in one step.
 *
 * Browser/PWA: there is no OS keychain exposed to web pages, so the two
 * jobs are split. A WebAuthn platform-authenticator assertion (Face ID/
 * Touch ID/Windows Hello via the browser) is the login gate; the AES key
 * itself is a non-extractable CryptoKey persisted directly in IndexedDB
 * (browsers store CryptoKey objects natively — JS can use the key to
 * encrypt/decrypt but can never read its raw bytes back out). This is a
 * real "encrypted at rest" guarantee against casual inspection of the
 * IndexedDB files, though — unlike the native Keychain path — the browser
 * gate and the key are not cryptographically bound to each other. This
 * asymmetry is inherent to what browsers expose; there's no server in this
 * app to validate a WebAuthn signature against, so the browser assertion is
 * a strong local presence check rather than a server-verified proof.
 */
import { registerPlugin } from '@capacitor/core';
import { isNative } from './platform.js';
import { importRawKey, generateKey } from './crypto.js';
import {
  getSetting,
  setSetting,
  setActiveKey,
  clearActiveKey,
  getActiveKey,
  reencryptAll,
  getVaultKeyRecord,
  setVaultKeyRecord,
  deleteVaultKeyRecord,
} from '../db.js';

const BiometricVault = registerPlugin('BiometricVault');

class Vault extends EventTarget {
  constructor() {
    super();
    // 'checking' | 'unsupported' | 'disabled' | 'locked' | 'unlocked'
    this.state = 'checking';
    this.biometryType = 'none'; // 'faceID' | 'touchID' | 'platform' | 'none'
    this.error = null;
  }

  _emit() {
    this.dispatchEvent(new CustomEvent('state'));
  }

  async _detectBiometry() {
    if (isNative()) {
      try {
        const { available, biometryType } = await BiometricVault.isAvailable();
        return { available, kind: biometryType };
      } catch {
        return { available: false, kind: 'none' };
      }
    }
    if (window.PublicKeyCredential?.isUserVerifyingPlatformAuthenticatorAvailable) {
      try {
        const available = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
        return { available, kind: available ? 'platform' : 'none' };
      } catch {
        return { available: false, kind: 'none' };
      }
    }
    return { available: false, kind: 'none' };
  }

  /** Call once at app boot. Determines whether a lock screen is needed. */
  async init() {
    const [{ available, kind }, enabled] = await Promise.all([
      this._detectBiometry(),
      getSetting('vaultEnabled', false),
    ]);
    this.biometryType = kind;
    if (!enabled) {
      this.state = 'disabled';
    } else if (!available) {
      // Biometry was enabled but is no longer available (e.g. removed on a
      // new device restore). Data stays encrypted; without a way to
      // biometrically prove identity we cannot fetch the key, so surface a
      // clear error rather than silently unlocking or losing access.
      this.state = 'unsupported';
      this.error = 'Biometric authentication is no longer available on this device, but your data is encrypted. Reinstalling or restoring biometrics may be required.';
    } else {
      this.state = 'locked';
    }
    this._emit();
  }

  /** Prompts Face ID/Touch ID and, on success, activates the encryption key. */
  async unlock() {
    this.error = null;
    try {
      if (isNative()) {
        const { key } = await BiometricVault.unlock();
        const cryptoKey = await importRawKey(key);
        setActiveKey(cryptoKey);
      } else {
        const credentialId = await getSetting('vaultCredentialId', null);
        if (!credentialId) throw new Error('No vault credential registered.');
        await navigator.credentials.get({
          publicKey: {
            challenge: crypto.getRandomValues(new Uint8Array(32)),
            allowCredentials: [{ id: b64ToBytes(credentialId), type: 'public-key' }],
            userVerification: 'required',
            timeout: 60000,
          },
        });
        const cryptoKey = await getVaultKeyRecord();
        if (!cryptoKey) throw new Error('Vault key missing — re-enable biometric lock in Settings.');
        setActiveKey(cryptoKey);
      }
      this.state = 'unlocked';
      this._emit();
      return true;
    } catch (err) {
      this.error = err?.message === 'cancelled' ? null : String(err?.message || err);
      this._emit();
      return false;
    }
  }

  /** Re-locks without disabling — clears the in-memory key only. */
  lock() {
    clearActiveKey();
    if (this.state === 'unlocked') this.state = 'locked';
    this._emit();
  }

  /**
   * Turns on biometric lock: creates the key, migrates all existing
   * plaintext studies/images to encrypted, and activates the key.
   */
  async enable() {
    const { available } = await this._detectBiometry();
    if (!available) throw new Error('No biometric authentication is available on this device.');

    let cryptoKey;
    if (isNative()) {
      await BiometricVault.setupKey();
      const { key } = await BiometricVault.unlock();
      cryptoKey = await importRawKey(key);
    } else {
      const credentialId = await registerWebAuthnCredential();
      await setSetting('vaultCredentialId', credentialId);
      cryptoKey = await generateKey();
      await setVaultKeyRecord(cryptoKey);
    }

    await reencryptAll(null, cryptoKey);
    setActiveKey(cryptoKey);
    await setSetting('vaultEnabled', true);
    this.state = 'unlocked';
    this._emit();
  }

  /**
   * Turns off biometric lock: proves identity again, decrypts everything
   * back to plaintext, then deletes the key material.
   */
  async disable() {
    const ok = await this.unlock();
    if (!ok) throw new Error(this.error || 'Could not verify identity.');

    // unlock() just called setActiveKey(currentKey) — reencryptAll needs
    // that same key object to read the currently-encrypted data with.
    const currentKey = getActiveKey();
    await reencryptAll(currentKey, null);
    clearActiveKey();
    await setSetting('vaultEnabled', false);

    if (isNative()) {
      await BiometricVault.deleteKey();
    } else {
      await deleteVaultKeyRecord();
      await setSetting('vaultCredentialId', null);
    }

    this.state = 'disabled';
    this._emit();
  }
}

async function registerWebAuthnCredential() {
  const cred = await navigator.credentials.create({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { name: 'Hounsfield' },
      user: {
        id: crypto.getRandomValues(new Uint8Array(16)),
        name: 'hounsfield-vault',
        displayName: 'Hounsfield Vault',
      },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 }, // ES256
        { type: 'public-key', alg: -257 }, // RS256
      ],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required' },
      timeout: 60000,
    },
  });
  return bytesToB64(new Uint8Array(cred.rawId));
}

function bytesToB64(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function b64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export const vault = new Vault();
