import pg from 'pg';

export function createBillingDatabase(connectionString) {
  const pool = new pg.Pool({ connectionString, max: 4, connectionTimeoutMillis: 5000, idleTimeoutMillis: 10000 });
  return {
    query: (text, values) => pool.query(text, values),
    async transaction(work) {
      const client = await pool.connect();
      try {
        await client.query('begin');
        await client.query("set local lock_timeout='10s'; set local statement_timeout='30s'; set local idle_in_transaction_session_timeout='60s'");
        const result = await work(client);
        await client.query('commit');
        return result;
      } catch (error) { await client.query('rollback'); throw error; }
      finally { client.release(); }
    },
    close: () => pool.end()
  };
}
