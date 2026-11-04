import { billingRuntime } from './runtime.js';
// SQL archive writes a durable outbox entry in the deletion transaction. Try
// cancellation immediately; provider failure must never block personal deletion.
export function withBillingDeletion(remove, currentFarm, getRuntime=billingRuntime) {
  return async body=>{
    const farmId=currentFarm()?.id;
    const result=await remove(body);
    if(result?.deleted && result?.farm_archived && farmId) {
      try {
        const runtime=getRuntime();
        if(runtime) {await runtime.service.reconcile(farmId);result.billing_cancellation='completed';}
      } catch {result.billing_cancellation='pending';}
    }
    return result;
  };
}
