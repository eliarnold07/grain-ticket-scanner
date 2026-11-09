-- Read only. Run as an approved operator after verifying connection target and TLS.
begin read only;
select current_database() as database, current_user as operator,
       (select ssl from pg_stat_ssl where pid=pg_backend_pid()) as tls,
       (select version from pg_stat_ssl where pid=pg_backend_pid()) as tls_version;
select mode,enforce_at,grace_days,freshness_hours from private.billing_policy;
select coordinated_launch_approved,native_release_approved,legacy_client_plan_approved,legacy_cutoff,
       approved_by,review_note,reviewed_at from private.billing_release_gate;
select rolname,rolcanlogin,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls
from pg_roles where rolname='binflow_billing_prod';
select status,count(*) as farms from private.farm_subscriptions group by status order by status;
select kind,count(*) as current_grants,min(ends_at) as earliest_expiry
from private.billing_access_grants
where revoked_at is null and starts_at<=statement_timestamp() and ends_at>statement_timestamp()
group by kind order by kind;
select count(*) as active_farms,
       count(*) filter(where has_subscription_record) as subscription_records,
       count(*) filter(where has_provider_subscription) as provider_subscriptions,
       count(*) filter(where eligible_for_access) as entitled_farms,
       count(*) filter(where not eligible_for_access) as farms_needing_rollout_review
from private.billing_readiness where account_access_state='active';
select count(*) as pending_cancellations from private.billing_cancellation_outbox where completed_at is null;
rollback;
