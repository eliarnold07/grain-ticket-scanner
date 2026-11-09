import { billingRuntime } from './runtime.js';

export function startBillingReconciliation({ getRuntime = billingRuntime, report = console.log, intervalMs = 3600000 } = {}) {
  let running = false;
  let stopped = false;
  async function check() {
    if (running || stopped) return;
    running = true;
    try {
      const runtime = getRuntime();
      if (!runtime) return;
      const results = await runtime.service.reconcileAll();
      report({ billingReconciliation: true, checked: results.length, failed: results.filter(r => !r.ok).length });
    } catch {
      report({ billingReconciliation: true, failed: true });
    } finally { running = false; }
  }
  const timer = setInterval(check, intervalMs);
  timer.unref?.();
  void check();
  return () => { stopped = true; clearInterval(timer); };
}
