import { Capacitor } from '@capacitor/core';

/** True when running inside the native iOS (or Android) shell. */
export function isNative() {
  return Capacitor.isNativePlatform();
}

/**
 * Share plain text: native share sheet in the app shell, Web Share API in
 * Safari, clipboard as the last resort. Returns how it was delivered.
 */
export async function shareText(title, text) {
  if (isNative()) {
    const { Share } = await import('@capacitor/share');
    await Share.share({ title, text });
    return 'shared';
  }
  if (navigator.share) {
    try {
      await navigator.share({ title, text });
      return 'shared';
    } catch (err) {
      if (err.name === 'AbortError') return 'cancelled';
    }
  }
  await navigator.clipboard.writeText(text);
  return 'copied';
}
