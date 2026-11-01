# Public BinFlow demo

The `/demo/` entry compiles `src/main.jsx?demo`: the same app markup, navigation,
components, and CSS used by `/app/`. The Vite plugin replaces only the demo
module's authentication, network adapter, and pending-request storage. It adds
demo-specific disclosures for extraction, account deletion, and invitation codes.
The normal customer entry and native build are unchanged.

`runtime.js` holds fictional data in memory. It never calls fetch or reads the
customer session. Unknown requests fail closed. A demo-only CSP forbids network
connections and form submission. Refresh restores the fixture. No real API,
database, OCR, email, payment processing, or customer account is involved.

Supported sample actions include history filters/sorting/export, payment and
assignment edits, bin creation/editing/adjustments, contract creation/editing,
saved drivers and locations, roles, and example invitation controls. Photo
extraction deliberately returns a fixed sample. Destructive linked-grain changes
and account deletion explain their demo limits. These are simulations, not a
replacement for production authorization or inventory commands.

Run `node --test tests/public-demo.test.js`, the regular tests, and `npm run build`.
Preview the built site, because the demo CSP intentionally blocks Vite's live
reload connection. Recheck shared-app changes against this adapter when API
response shapes change. Publish through the repository's existing Pages workflow.
