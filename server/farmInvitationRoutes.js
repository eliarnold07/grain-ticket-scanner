import { createHmac } from 'node:crypto';
import { generateFarmCode, hashFarmCode, encryptFarmCode, decryptFarmCode, validateFarmInvitationKey } from './farmInvitation.js';
import { invitationClientIp } from './invitationIdentity.js';

export function registerFarmInvitationRoutes(app, { rpc, authenticate, signup, requestAccount }) {
  function ready() {
    if (process.env.FARM_INVITATIONS_ENABLED !== 'true' || !process.env.FARM_INVITE_ENCRYPTION_KEY) {
      const error = new Error('Farm invitation joining is not available yet. Contact your farm Admin.');
      error.status = 503;
      throw error;
    }
    try { validateFarmInvitationKey(process.env.FARM_INVITE_ENCRYPTION_KEY); }
    catch { const error = new Error('Farm invitation joining is temporarily unavailable.'); error.status = 503; throw error; }
  }
  function uuid(value) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value || '')) throw new Error('Invalid join confirmation. Enter the code again.');
    return value;
  }
  function route(action) {
    return async (req, res) => {
      try {
        ready();
        const data = await action(req);
        if (data?.error) return res.status(data.status || 400).json({ error: data.error });
        res.json(data);
      } catch (error) {
        // Do not log codes, join tokens, passwords or upstream Auth response details.
        const message = error.status === 503 ? error.message : error.status === 401 ? 'Please log in to join this farm.' : 'Could not complete the farm invitation request. Check the code and try again.';
        res.status(error.status || 400).json({ error: message });
      }
    };
  }
  app.post('/api/farm-invites/preview', route(async (req) => {
    let hash;
    try { hash = hashFarmCode(req.body?.code); } catch { hash = 'invalid'; }
    let identity;
    try { identity = invitationClientIp(req); }
    catch { const error = new Error('Farm invitation joining is unavailable until proxy identity is configured.'); error.status = 503; throw error; }
    const attemptKey = createHmac('sha256', process.env.FARM_INVITE_ENCRYPTION_KEY).update(`farm-invites:${identity}`).digest('hex');
    return rpc('preview_farm_invite', { p_hash: hash, p_attempt_key: attemptKey });
  }));
  app.post('/api/farm-invites/register', route(async (req) => {
    const token = uuid(req.body?.join_token);
    const email = String(req.body?.email || '').trim();
    const password = req.body?.password;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || typeof password !== 'string' || password.length < 8) {
      return { error: 'Enter a valid email and a password with at least 8 characters.', status: 400 };
    }
    const preparation = await rpc('prepare_farm_join_signup', { p_token: token });
    if (preparation.error) return preparation;
    return signup({ email, password, data: { display_name: String(req.body?.display_name || '').trim().slice(0, 100), binflow_join_token: token } });
  }));
  app.post('/api/farm-invites/accept', route(async (req) => {
    const user = await authenticate(req.get('authorization'));
    return rpc('accept_farm_invite', { p_actor: user.id, p_token: uuid(req.body?.join_token) });
  }));
  const manage = (rotate) => route(async (req) => {
    const user = requestAccount(req);
    if (user?.role !== 'admin') {
      const error = new Error('Admin access required'); error.status = 403; throw error;
    }
    const code = generateFarmCode();
    const invitation = await rpc('manage_farm_invite', {
      p_actor: user.user_id, p_hash: hashFarmCode(code),
      p_encrypted: encryptFarmCode(code, process.env.FARM_INVITE_ENCRYPTION_KEY, user.farm_id), p_rotate: rotate
    });
    const normalized = decryptFarmCode(invitation.encrypted_code, process.env.FARM_INVITE_ENCRYPTION_KEY, user.farm_id);
    return { code: normalized.match(/.{4}/g).join('-'), updated_at: invitation.updated_at };
  });
  // These paths run through the normal membership/Admin middleware.
  app.get('/api/users/invitation', manage(false));
  app.post('/api/users/invitation/rotate', manage(true));
}
