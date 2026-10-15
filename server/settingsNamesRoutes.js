import { randomUUID } from 'node:crypto';

export function settingsNamesRoutes(app, { command, account }) {
  for (const [path, kind] of [['locations', 'location'], ['drivers', 'driver']]) {
    for (const method of ['post', 'put', 'delete']) {
      app[method](`/api/${path}${method === 'post' ? '' : '/:id'}`, async (req, res) => {
        const actor = account();
        if (actor?.role !== 'admin') return res.status(403).json({ error: 'Admin access required.' });
        const id = method === 'post' ? randomUUID() : req.params.id;
        if (!/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id)) return res.status(400).json({ code: 'INVALID_ID' });
        const name = String(req.body?.name || '').replace(/\s+/g, ' ').trim();
        if (method !== 'delete' && (!name || name.length > 100)) return res.status(400).json({ code: 'INVALID_SETTING_NAME' });
        try {
          const result = await command('binflow_manage_saved_name', { p_actor: actor.user_id, p_kind: kind, p_id: id, p_action: method, p_name: name });
          res.status(method === 'post' ? 201 : 200).json(result);
        } catch (error) {
          const code = ['SETTING_NOT_FOUND', 'SETTING_NAME_EXISTS', 'ADMIN_ACCESS_REQUIRED', 'INVALID_SETTING_NAME'].includes(error.message) ? error.message : 'SETTINGS_UNAVAILABLE';
          res.status(code === 'SETTINGS_UNAVAILABLE' ? 503 : 400).json({ code });
        }
      });
    }
  }
}
