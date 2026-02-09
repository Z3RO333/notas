import { useEffect, useRef, useCallback } from 'react';

interface UsePollingOptions {
  interval?: number; // ms
  enabled?: boolean;
}

export function usePolling(
  callback: () => void | Promise<void>,
  options: UsePollingOptions = {}
) {
  const { interval = 15000, enabled = true } = options;
  const savedCallback = useRef(callback);

  // Atualiza a ref quando callback muda
  useEffect(() => {
    savedCallback.current = callback;
  }, [callback]);

  // Funcao para chamar manualmente
  const refresh = useCallback(() => {
    savedCallback.current();
  }, []);

  // Configura o polling
  useEffect(() => {
    if (!enabled) return;

    // Executa imediatamente na primeira vez
    savedCallback.current();

    // Configura intervalo
    const id = setInterval(() => {
      savedCallback.current();
    }, interval);

    return () => clearInterval(id);
  }, [interval, enabled]);

  return { refresh };
}
