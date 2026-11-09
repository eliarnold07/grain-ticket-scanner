import pg from 'pg';
import { BILLING_STAGING_ROLE, BILLING_PRODUCTION_ROLE } from './config.js';

export async function assertStagingBillingRole(client, expectedRole = BILLING_STAGING_ROLE) {
  const { rows: [role] } = await client.query(`
    select current_user::text as effective_role, session_user::text as login_role,
           current_database() as database, rolcanlogin,
           (rolsuper or rolbypassrls or rolcreatedb or rolcreaterole or rolreplication) as elevated,
           exists (select 1 from pg_catalog.pg_auth_members where member=r.oid) as member_of_role
    from pg_catalog.pg_roles r where r.rolname=session_user
  `);
  if (role?.effective_role !== expectedRole || role.login_role !== expectedRole ||
      role.database !== 'postgres' || role.rolcanlogin !== true || role.elevated !== false ||
      role.member_of_role !== false) {
    throw new Error('Hosted billing database rejected an unexpected or privileged login');
  }
  if (expectedRole === BILLING_PRODUCTION_ROLE) {
    const { rows: [permissions] } = await client.query(`
      select exists (
        select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
        where n.nspname='public' and c.relkind in ('r','p','v','m','f')
        and (has_table_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
          or has_any_column_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE,REFERENCES'))
      ) or exists (
        select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
        where n.nspname='auth' and c.relname='users'
        and has_any_column_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE')
      ) or has_table_privilege(current_user,'private.billing_policy','INSERT,UPDATE,DELETE,TRUNCATE')
        or has_any_column_privilege(current_user,'private.billing_policy','INSERT,UPDATE')
        as unexpected_access
    `);
    if (permissions?.unexpected_access !== false) throw new Error('Production billing login has unexpected data or enforcement privileges');
  }
}

export function createBillingDatabase(connectionString, { staging = false, role = BILLING_STAGING_ROLE, ca } = {}) {
  const pool = new pg.Pool({
    connectionString, max: 4, connectionTimeoutMillis: 5000, idleTimeoutMillis: 10000,
    ...(staging ? { ssl: { rejectUnauthorized: true, minVersion: 'TLSv1.2', ...(ca ? { ca } : {}) } } : {})
  });

  async function connect() {
    const client = await pool.connect();
    if (staging) {
      try { await assertStagingBillingRole(client, role); }
      catch (error) { client.release(true); throw error; }
    }
    return client;
  }

  return {
    async query(text, values) {
      if (!staging) return pool.query(text, values);
      const client = await connect();
      try { return await client.query(text, values); }
      finally { client.release(); }
    },
    async transaction(work) {
      const client = await connect();
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
