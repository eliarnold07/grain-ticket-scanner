export function requireUuid(value, label = 'ID') {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    const error = new Error(`${label} must be a UUID.`);
    error.status = 400;
    throw error;
  }
  return value.toLowerCase();
}

export function restQuery(resource, parameters = {}) {
  if (!/^[a-z][a-z_]*(?:\/[a-z][a-z_]*)?$/.test(resource)) throw new Error('Invalid REST resource.');
  const search = new URLSearchParams();
  for (const [key, values] of Object.entries(parameters)) {
    for (const value of Array.isArray(values) ? values : [values]) {
      if (value == null) continue;
      if (['id', 'user_id', 'farm_id', 'bin_id', 'ticket_id', 'inventory_transaction_id', 'scanned_by_user_id', 'created_by_user_id'].includes(key)) {
        const match = String(value).match(/^(eq|neq)\.(.*)$/);
        if (!match) throw new Error('Invalid UUID filter.');
        requireUuid(match[2], key);
      }
      search.append(key, String(value));
    }
  }
  return `${resource}${search.size ? `?${search}` : ''}`;
}

export function validateApiIds(req, res, next) {
  try {
    for (const key of ['bin_id', 'ticket_id', 'inventory_transaction_id', 'farm_id', 'user_id', 'request_id', 'join_token']) {
      for (const source of [req.query, req.body, req.body?.ticket]) {
        if (source?.[key] != null && source[key] !== '') requireUuid(source[key], key);
      }
    }
    for (const assignment of req.body?.assignments || req.body?.ticket?.assignments || []) {
      if (String(assignment.type).toUpperCase() === 'CONTRACT') requireUuid(assignment.contract_id, 'Contract ID');
    }
    next();
  } catch (error) { res.status(400).json({ error: error.message }); }
}

// Transitional protection for legacy callers: reject fragments/duplicate filters,
// validate UUID filters, then reserialize with the structured query builder.
export function canonicalRestPath(path, farmId) {
  if (typeof path !== 'string' || path.includes('#') || path.split('?').length > 2) throw new Error('Invalid REST path.');
  const [resource, query] = path.split('?');
  const params = new URLSearchParams(query || '');
  const values = {};
  for (const [key,value] of params) {
    if (Object.hasOwn(values,key)) {
      if (key !== 'created_at' || Array.isArray(values[key])) throw new Error('Duplicate REST filter.');
      const pair=[values[key],value];
      if (!pair.some(x=>x.startsWith('gte.')) || !pair.some(x=>x.startsWith('lt.')) || pair.some(x=>!Number.isFinite(Date.parse(x.slice(x.indexOf('.')+1))))) throw new Error('Invalid date range.');
      values[key]=pair;
    } else values[key]=value;
  }
  if (farmId && params.has('farm_id') && params.get('farm_id') !== `eq.${requireUuid(farmId)}`) throw new Error('Farm filter mismatch.');
  return restQuery(resource, values);
}
