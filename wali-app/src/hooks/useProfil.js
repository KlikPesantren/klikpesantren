import { useState, useEffect, useCallback, useRef } from 'react';
import { santriApi } from '../api/santri.api';
import { getApiErrorMessage } from '../utils/apiError';
import { useActiveChild } from '../context/ActiveChildContext';

export function useProfil(activeSantriId) {
  const { activeUnitId } = useActiveChild();
  const [data, setData] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const requestRef = useRef(0);

  const fetchProfil = useCallback(
    async ({ silent = false } = {}) => {
      if (!activeSantriId || !activeUnitId) return;
      const requestId = ++requestRef.current;

      if (!silent) setIsLoading(true);
      else setIsRefreshing(true);

      setError(null);

      try {
        const res = await santriApi.getProfil();
        if (requestId !== requestRef.current) return;
        setData(res.data ?? null);
      } catch (err) {
        if (requestId !== requestRef.current) return;
        setError(getApiErrorMessage(err, 'Gagal memuat profil santri. Silakan coba lagi.'));
      } finally {
        if (requestId === requestRef.current) {
          setIsLoading(false);
          setIsRefreshing(false);
        }
      }
    },
    [activeSantriId, activeUnitId]
  );

  useEffect(() => {
    requestRef.current += 1;
    setData(null);
    setError(null);
    fetchProfil({ silent: false });
  }, [fetchProfil]);

  return {
    data,
    isLoading,
    isRefreshing,
    error,
    refresh: () => fetchProfil({ silent: true }),
  };
}
