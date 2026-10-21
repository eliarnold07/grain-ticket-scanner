import { requireUuid } from './restQuery.js';

export function writesPaused(env=process.env) {
  // Unknown configuration fails closed. Omission preserves the existing default.
  return !['enabled',''].includes(String(env.BINFLOW_WRITE_MODE??'').trim());
}

export function releaseWriteGuard(req,res,next) {
  if(!writesPaused() || ['GET','HEAD','OPTIONS'].includes(req.method)) return next();
  res.set('Cache-Control','no-store').set('Retry-After','60').status(503).json({
    code:'RELEASE_MAINTENANCE',
    error:'BinFlow is being updated. Your changes were not submitted. Please try again shortly.'
  });
}

export function requireAtomicTicketClient(req,res,next) {
  if(req.body?.request_id==null || req.body.request_id==='') {
    return res.set('Cache-Control','no-store').status(426).json({
      code:'CLIENT_UPDATE_REQUIRED',
      error:'BinFlow has been updated. Refresh the website or update the iPhone app before saving this ticket.'
    });
  }
  try { requireUuid(req.body.request_id); next(); }
  catch { res.status(400).json({code:'INVALID_ID',error:'Please check this submission and try again.'}); }
}
