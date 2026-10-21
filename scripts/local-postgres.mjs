import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';

// Disposable loopback-only PostgreSQL. Never accepts a database URL or cloud key.
export async function withLocalPostgres(run) {
  const modulePath = process.env.BINFLOW_EMBEDDED_POSTGRES_MODULE;
  if (!modulePath) throw new Error('Set BINFLOW_EMBEDDED_POSTGRES_MODULE to the installed local embedded-postgres runtime. No external database will be used.');
  const { default: EmbeddedPostgres } = await import(pathToFileURL(modulePath).href);
  const root = await mkdtemp(join(tmpdir(), 'binflow-grain-pg-'));
  const listener = createServer();
  await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  const cluster = new EmbeddedPostgres({ databaseDir: join(root, 'db'), user: 'postgres', password: randomBytes(24).toString('hex'), port, persistent: true, createPostgresUser: false, onLog: () => {}, onError: () => {} });
  const clients = [];
  try {
    await cluster.initialise(); await cluster.start();
    for (let i = 0; i < 3; i++) {
      const client = cluster.getPgClient('postgres', '127.0.0.1');
      await client.connect(); clients.push(client);
      await client.query("set statement_timeout='15s'; set lock_timeout='5s'");
    }
    await run(clients);
  } finally {
    for (const client of clients) { await client.query('rollback').catch(() => {}); await client.end().catch(() => {}); }
    await cluster.stop().catch(() => {});
    if (!resolve(root).startsWith(`${resolve(tmpdir())}${sep}binflow-grain-pg-`)) throw new Error('Unsafe test cleanup target.');
    await rm(root, { recursive: true, force: true });
  }
}

export async function observeLock(observer, client) {
  const pid = (await client.query('select pg_backend_pid() as pid')).rows[0].pid;
  return async () => {
    for (let n = 0; n < 150; n++) {
      if ((await observer.query('select wait_event_type from pg_stat_activity where pid=$1', [pid])).rows[0]?.wait_event_type === 'Lock') return;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    throw new Error('Expected a genuine lock wait in a separate PostgreSQL session.');
  };
}
