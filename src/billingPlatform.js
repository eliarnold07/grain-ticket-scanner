// Purchase presentation only. This NEVER grants farm access.
export function externalPurchasePolicy(platform, config = {}) {
  if (!['ios','android'].includes(platform)) return null;
  if (config.enabled !== 'true' || !config.reviewReference?.trim()) return null;
  try {
    const url=new URL(config.url);
    if(url.protocol!=='https:' || url.hostname!=='getbinflow.com' || url.username || url.password) return null;
    return url.href;
  } catch { return null; }
}
