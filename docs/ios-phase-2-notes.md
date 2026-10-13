# iOS Phase 2 Notes

## Native Camera

The web scanner remains backed by the browser file input. Capacitor builds use `@capacitor/camera` to take a new photo or select an existing photo, then convert the native result into a `File` object before handing it to the existing compression and OCR upload path.

No OCR backend behavior changes were made.

## API Origin

The API CORS allow-list now includes the packaged app origins:

```text
capacitor://localhost
binflow://localhost
```

Existing production web origins remain in place. Render can keep using `CORS_ORIGIN` for additional origins, but production deployment is still required before the live API accepts any code changes made locally.

## Authentication

BinFlow currently uses Supabase Auth REST endpoints for email/password signup, login, refresh, and logout. Session persistence is handled with local storage under `binflow-supabase-session`.

Mobile deep links are not required for the current password login flow when signup returns an immediately usable session. If Supabase email confirmation is enabled and signup no longer returns a session, a deep-link flow should be added before App Store release.

Recommended future deep link:

```text
binflow://auth/callback
```

Supabase dashboard settings would need to allow that callback URL alongside the existing web URLs.

## Subscription Enforcement Points

The entitlement middleware is currently non-blocking. Future enforcement should happen after Supabase JWT validation and farm membership resolution, before role-based route authorization and protected route handlers.

Do not enforce access from frontend state. The `/api/session` entitlement value should only be used for display.
