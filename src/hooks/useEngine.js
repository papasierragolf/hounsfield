import { useEffect, useState } from 'react';
import { engine } from '../inference/engine.js';

/** Reactive view of the shared inference engine. */
export function useEngine() {
  const [, force] = useState(0);

  useEffect(() => {
    const bump = () => force((n) => n + 1);
    engine.addEventListener('state', bump);
    engine.addEventListener('progress', bump);
    engine.addEventListener('status', bump);
    return () => {
      engine.removeEventListener('state', bump);
      engine.removeEventListener('progress', bump);
      engine.removeEventListener('status', bump);
    };
  }, []);

  return engine;
}
