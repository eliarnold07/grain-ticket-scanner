import { isPublicInvitationRequest } from './supabaseStore.js';

const employeeRoutes = new Set([
  'GET /session', 'GET /account-deletion', 'GET /dropdowns', 'GET /scanner-contracts',
  'DELETE /account', 'POST /extract-ticket', 'POST /submit-ticket'
]);

export function farmPermissionGuard(getAccount) {
  return (req, res, next) => {
    if (isPublicInvitationRequest(req) || req.path === '/health' || req.path === '/weekly-summary/send') return next();
    const account = getAccount();
    if (account?.role === 'admin' || (account?.role === 'employee' && employeeRoutes.has(`${req.method} ${req.path}`))) return next();
    return res.status(403).json({ error: 'Admin access is required for this action.' });
  };
}
