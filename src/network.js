export async function withDeadline(operation, milliseconds, cancel = () => {}) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise((_, reject) => { timer = setTimeout(() => {
        const error = new Error('The request timed out.'); error.name = 'TimeoutError';
        reject(error);
        try { cancel(); } catch { /* Timeout must still settle the UI. */ }
      }, milliseconds); })
    ]);
  } finally { clearTimeout(timer); }
}

export function readJsonWithTimeout(response, milliseconds = 20000) {
  return withDeadline(() => response.json(), milliseconds, () => {
    response.body?.cancel?.().catch(() => {});
  });
}

export async function fetchWithTimeout(url, options = {}, milliseconds = 90000, fetcher = fetch) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (options.signal?.aborted) abort();
  else options.signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, milliseconds);
  try { return await withDeadline(() => fetcher(url, { ...options, signal: controller.signal }), milliseconds + 10, abort); }
  finally { clearTimeout(timer); options.signal?.removeEventListener('abort', abort); }
}
