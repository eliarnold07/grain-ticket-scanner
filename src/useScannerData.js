import { useCallback, useEffect, useRef, useState } from 'react';
import { readJsonWithTimeout, withDeadline } from './network.js';
import { cleanMessage, readErrorResponse } from './apiErrors.js';

const emptyDropdowns = () => ({ bins: [], haulers: [], destinations: [], missing_tabs: [] });

// Latest request and current account must both match before publishing any result.
export default function useScannerData(apiFetch, actorId) {
  const api = useRef(apiFetch); api.current = apiFetch;
  const owner = useRef(actorId); owner.current = actorId;
  const requests = useRef({});
  const [dropdowns, setDropdowns] = useState(emptyDropdowns);
  const [scannerContracts, setContracts] = useState([]);
  const [state, setState] = useState({});
  const resetScannerData = useCallback(() => {
    Object.values(requests.current).forEach(request => request.abort());
    requests.current = {};
    setDropdowns(emptyDropdowns()); setContracts([]); setState({});
  }, []);
  useEffect(() => {
    resetScannerData();
    return () => { Object.values(requests.current).forEach(request => request.abort()); requests.current = {}; };
  }, [actorId, resetScannerData]);

  const load = useCallback(async (kind) => {
    const actor = owner.current;
    if (!actor) return;
    requests.current[kind]?.abort();
    const controller = new AbortController(); requests.current[kind] = controller;
    const current = () => owner.current === actor && requests.current[kind] === controller;
    setState(value => ({ ...value, [kind]: { loading: true, error: '' } }));
    try {
      const data = await withDeadline(async () => {
        const response = await api.current(kind === 'dropdowns' ? '/api/dropdowns' : '/api/scanner-contracts', {
          signal: controller.signal, timeoutMs: 20000
        });
        if (!response.ok) throw new Error(await readErrorResponse(response));
        return readJsonWithTimeout(response);
      }, 20000, () => controller.abort());
      if (kind === 'dropdowns') {
        if (!data || !['bins', 'haulers', 'destinations'].every(key => Array.isArray(data[key]) && data[key].every(v => typeof v === 'string')))
          throw new Error('Invalid farm data response');
        const options = {};
        for (const key of ['bins', 'haulers', 'destinations']) {
          const seen = new Set();
          options[key] = data[key].map(value => value.trim()).filter(value => {
            const normalized = value.toLowerCase();
            if (!value || seen.has(normalized)) return false;
            seen.add(normalized); return true;
          });
        }
        if (current()) setDropdowns({ ...options, missing_tabs: Array.isArray(data.missing_tabs) ? data.missing_tabs : [] });
      } else {
        if (!Array.isArray(data?.contracts)) throw new Error('Invalid contract response');
        if (current()) setContracts(data.contracts);
      }
      if (current()) setState(value => ({ ...value, [kind]: { loading: false, error: '' } }));
    } catch (error) {
      if (current()) setState(value => ({ ...value, [kind]: { loading: false, error: cleanMessage(error) } }));
    } finally { if (current()) delete requests.current[kind]; }
  }, []);
  const loadDropdowns = useCallback(() => load('dropdowns'), [load]);
  const loadScannerContracts = useCallback(() => load('contracts'), [load]);
  return { dropdowns, scannerContracts, loadDropdowns, loadScannerContracts, resetScannerData,
    isLoadingDropdowns: state.dropdowns?.loading || false, dropdownError: state.dropdowns?.error || '',
    isLoadingScannerContracts: state.contracts?.loading || false, scannerContractsError: state.contracts?.error || '' };
}
