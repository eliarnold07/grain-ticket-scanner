# Proposed Privacy Update At Deletion Activation

**Not published. Owner/legal approval and verified production behavior required.**
The current public policy says automatic in-app deletion is not yet available.
Replace only that statement after the approved compatible backend/SQL rollout and
successful disposable-account testing. Leave published contacts unchanged unless
the owner separately approves an update. Do not publish an implementation flag name.

## Proposed Plain-Language Section

You can delete your BinFlow account in Settings > My Account > Delete account.
Confirm your email address and current password and review the consequences before
continuing. Deleting your account removes your login, your farm membership, and
personal ticket-scanning attribution. It does not delete other farm members or close
the farm.

If you are the only Administrator and other members remain, choose another member
to become Administrator as part of the same process. If you are the only member,
access to that farm is archived; the farm's shared operating records are not deleted
automatically. Shared grain tickets, inventory, contracts and payment records may be
retained only where there is an applicable lawful basis. Contact BinFlow using the
privacy contact below for questions about retained records or other privacy rights.

## Decisions Before Publishing / Submission

- Owner/legal approval of lawful bases, retention durations and handling of archived
  farms/shared records, including any identifying free-text ticket/driver/payment
  content. Operational history alone must not become a permanent retention promise.
- Confirm production provider settings for OpenAI image/log retention, Render logs,
  Supabase backups/Auth/Storage and Resend delivery/recipient records. The implementation
  scrubs stored summary recipients and scanner identity; it cannot recall sent email
  or promise instant erasure from providers/backups.
- Confirm current original-photo retention. The inspected OCR path compresses and
  transmits images; it does not persist them in BinFlow Storage. Native temporary
  captures/cache and provider processing are not proven to have zero retention.
- Confirm Phone/Other Contact Info and possible printed Physical Addresses against
  actual support messages/photos and Apple's collection definition. No GPS, analytics,
  tracking or active subscriptions should be described as implemented.
- If the schema reveals user-owned Storage objects, test the refusal/cleanup path
  before enabling deletion. Never delete Storage catalogue rows as a substitute for
  deleting actual objects. Current app supplies no general document-storage feature.

No payment/trial/renewal language is required for this billing-disabled build. Future
subscriptions require their own platform/provider/privacy and cancellation review.
