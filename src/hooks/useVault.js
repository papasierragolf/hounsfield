import { useEffect, useState } from 'react';
import { vault } from '../lib/vault.js';

/** Reactive view of the shared biometric vault. */
export function useVault() {
  const [, force] = useState(0);

  useEffect(() => {
    const bump = () => force((n) => n + 1);
    vault.addEventListener('state', bump);
    return () => vault.removeEventListener('state', bump);
  }, []);

  return vault;
}
