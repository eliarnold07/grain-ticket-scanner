export function mobileEntryAssets(html) {
  const assets=[];
  for(const tag of html.match(/<(?:script|link)\b[^>]*>/gi) || []) {
    if (/^<link/i.test(tag) && !/\brel=["'](?:stylesheet|modulepreload|icon|apple-touch-icon)["']/i.test(tag)) continue;
    const value=tag.match(/\b(?:src|href)=["']([^"']+)["']/i)?.[1];
    if (!value) continue;
    if (!value.startsWith('./') || value.includes('..') || value.includes('?') || value.includes('#')) throw new Error('Mobile entry contains an unpackaged or absolute asset URL.');
    assets.push(value.slice(2));
  }
  if (!assets.some(asset=>asset.endsWith('.js'))) throw new Error('Mobile entry has no packaged application script.');
  return assets;
}
