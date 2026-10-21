import 'dotenv/config';

// Read-only fallback entry point. Never substitutes legacy direct writers.
process.env.BINFLOW_WRITE_MODE='paused';
process.env.ACCOUNT_DELETION_ENABLED='false';
process.env.FARM_INVITATIONS_ENABLED='false';
process.env.BILLING_ENFORCEMENT_MODE='disabled';
await import('./index.js');
