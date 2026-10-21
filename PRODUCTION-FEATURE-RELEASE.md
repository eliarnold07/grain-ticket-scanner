# Coordinated Web And Uploaded iOS Release

This release preserves develop's landing, privacy, support, and app build entries.
It copies the shared React client from 07fa6496bdbfe526793ab6d37c71c6fb25a44360,
the reviewed iOS client source. No native project or signing files are included.
Backend and SQL files match 5306bb88437a06462baa4f32fa801732672198ca.

Settings, personal-account deletion, and invitation-code interfaces are shared
between web and iOS. Deletion and invitations require the corresponding server
readiness checks and separately verified activation. The website must not be
published ahead of its compatible atomic-ticket backend and database protocol.

Billing remains disabled. Never replay baseline migrations 001, 002, or weekly
summary 003. Use the separately approved eleven-transaction manifest, not a glob
or the older ten-transaction packaging script. Preserve the exact known empty
ownerless farm unchanged and verify all Apple Review records against the private
cutover baseline. Do not use reviewer/customer accounts for destructive tests.

The October 21 privacy wording must be published only as part of successful
production deletion activation. It does not change contact information or add
retention periods, payment processing, analytics, or location collection.

Keep future releases on one shared client source: web publication and each native
binary must record their client commit and backend protocol compatibility. A
website deployment cannot replace JavaScript bundled in an existing iOS binary.
Changes requiring new bundled code require a new Apple build; server-gated
features already in that binary can be activated without a Mac rebuild.

The uploaded Build 1's exact binary is still subject to TestFlight acceptance;
source review, browser testing, and backend acceptance do not substitute for it.
