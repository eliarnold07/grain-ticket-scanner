import { Router } from 'express';
import { accountDeletionFailure } from './accountDeletionService.js';

export function accountDeletionRouter({ preview, remove, report = () => {} }) {
  const router = Router();
  const handler = (operation) => async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      res.json(await operation(req.body));
    } catch (error) {
      const failure = accountDeletionFailure(error);
      report(failure.body.code);
      res.status(failure.status).json(failure.body);
    }
  };
  router.get('/account-deletion', handler(preview));
  router.delete('/account', handler(remove));
  router.all(['/account-deletion', '/account'], (_req, res) => {
    res.status(405).set('Cache-Control', 'no-store').json({ error: 'This account request is not supported.', code: 'DELETION_UNAVAILABLE' });
  });
  return router;
}
