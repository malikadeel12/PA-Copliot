# Google OAuth + PKCE Verification Checklist

Use this checklist after deploying the latest frontend code. The application now uses a dedicated `/auth/callback` route and explicitly exchanges the Supabase PKCE authorization code for a session.

## 1. Do not change the current Supabase URL configuration

The current Supabase settings are:

```text
Site URL:
https://pa-copliot-gamma.vercel.app

Allowed redirect URL:
https://pa-copliot-gamma.vercel.app/auth/callback

General wildcard:
https://pa-copliot-gamma.vercel.app/**
```

These URLs already support the implemented callback flow. Do not replace or remove them during this verification.

## 2. Code behavior now implemented

- Google OAuth sends the user to:

  ```text
  https://pa-copliot-gamma.vercel.app/auth/callback
  ```

- Supabase authentication uses `flowType: "pkce"`.
- Automatic URL detection is disabled to prevent a duplicate code exchange.
- `/auth/callback` reads the returned `code` parameter.
- The callback calls `exchangeCodeForSession` through a duplicate-safe helper.
- The callback waits for the backend profile to load.
- A normal user is sent to `/dashboard` after successful login.
- An admin user is sent to `/admin`.
- Callback errors are returned to `/login` and displayed to the user.
- Protected routes show a loading spinner until session/profile initialization finishes.
- Email-confirmation links also use `/auth/callback`.
- Password-reset links explicitly exchange their PKCE code on `/reset-password`.

## 3. Files included in the implementation

Confirm these files are committed and deployed:

```text
frontend/src/lib/supabase.js
frontend/src/pages/Login.js
frontend/src/pages/AuthCallback.js
frontend/src/pages/ResetPassword.js
frontend/src/context/AuthContext.js
frontend/src/App.js
frontend/vercel.json
backend-node/src/auth.js
```

## 4. Vercel checks

Open **Vercel → Project → Settings → Environment Variables** and verify:

```text
REACT_APP_SUPABASE_URL=https://YOUR-PROJECT-REF.supabase.co
REACT_APP_SUPABASE_ANON_KEY=your-project-anon-or-publishable-key
REACT_APP_BACKEND_URL=https://YOUR-RENDER-SERVICE.onrender.com
```

Check the following:

- [ ] All three variables are enabled for Production.
- [ ] `REACT_APP_BACKEND_URL` does not end with `/api`.
- [ ] `REACT_APP_BACKEND_URL` has no trailing slash.
- [ ] The Supabase URL/key belong to the same project used by Render.
- [ ] The latest Git commit is deployed.
- [ ] Vercel was redeployed after any environment-variable change.
- [ ] `frontend/vercel.json` is detected from the configured `frontend` Root Directory.

## 5. Render checks

Open **Render → Backend Web Service → Environment** and verify:

```text
SUPABASE_URL=https://YOUR-PROJECT-REF.supabase.co
SUPABASE_ANON_KEY=your-project-anon-or-publishable-key
SUPABASE_SERVICE_ROLE_KEY=your-project-service-role-key
CORS_ORIGINS=https://pa-copliot-gamma.vercel.app
```

Check:

- [ ] Vercel and Render use the same Supabase project.
- [ ] The service-role key is only stored on Render.
- [ ] `CORS_ORIGINS` has no trailing slash or path.
- [ ] The latest backend commit is deployed.
- [ ] The Render health endpoint returns HTTP 200:

  ```text
  https://YOUR-RENDER-SERVICE.onrender.com/api/health
  ```

## 6. Google Cloud OAuth check

The Google OAuth client's **Authorized redirect URI** must point to Supabase, not directly to Vercel:

```text
https://YOUR-PROJECT-REF.supabase.co/auth/v1/callback
```

Check:

- [ ] Google provider is enabled in Supabase.
- [ ] Supabase contains the correct Google client ID and secret.
- [ ] Google Cloud contains the exact Supabase `/auth/v1/callback` URI.
- [ ] The OAuth consent screen permits the account used for testing.

## 7. Clean Google-login test

1. Open a new Incognito/Private browser window.
2. Open:

   ```text
   https://pa-copliot-gamma.vercel.app/login
   ```

3. Open browser Developer Tools before clicking Google login.
4. Select the **Network** tab and enable **Preserve log**.
5. Click **Continue with Google**.
6. Use a new Google account that has not logged into this application before.
7. Complete Google's consent screen.
8. Confirm the browser briefly opens a URL shaped like:

   ```text
   https://pa-copliot-gamma.vercel.app/auth/callback?code=...
   ```

9. Confirm the page displays the secure sign-in/loading message.
10. Confirm the browser ends at:

    ```text
    https://pa-copliot-gamma.vercel.app/dashboard
    ```

Expected result:

- [ ] No Vercel 404 appears on `/auth/callback`.
- [ ] The callback does not return to `/login`.
- [ ] The dashboard loads.
- [ ] The header/dashboard shows 5 credits for a new normal user.
- [ ] Refreshing `/dashboard` keeps the user logged in.
- [ ] Opening `/login` while logged in redirects to `/dashboard`.

## 8. Cleared-site-data test

Repeat the test without any stored browser session:

1. Open browser settings or Developer Tools → **Application/Storage**.
2. Clear site data for:
   - `pa-copliot-gamma.vercel.app`
   - the Supabase project domain, if shown by the browser
3. Close all tabs for the application.
4. Open a fresh Incognito/Private window.
5. Repeat the Google login test.

Expected result:

- [ ] Login succeeds without relying on an old local-storage session.
- [ ] Only one profile is created for the new Supabase user.
- [ ] The user receives one signup credit grant of 5 credits.

## 9. Slower-network test

In Chrome/Edge Developer Tools:

1. Open **Network**.
2. Change throttling from **No throttling** to **Fast 3G** or **Slow 4G**.
3. Keep **Preserve log** enabled.
4. Repeat Google login.

Expected result:

- [ ] The callback remains on its loading screen while session/profile loading is in progress.
- [ ] The app does not immediately redirect an authenticated user back to `/login`.
- [ ] The callback retries profile loading if Render is waking from sleep.
- [ ] Successful completion ends at `/dashboard`.

After testing, restore browser throttling to **No throttling**.

## 10. Verify the Supabase user

Open **Supabase → Authentication → Users**.

Find the new Google account and confirm:

- [ ] The user exists.
- [ ] The email matches the tested Google account.
- [ ] The provider is Google.
- [ ] The last sign-in time matches the test.

## 11. Verify the profile record

Open **Supabase → Table Editor → profiles**.

Find the row whose `id` equals the ID from **Authentication → Users** and confirm:

- [ ] `id` matches the authentication user ID.
- [ ] `email` matches the Google account.
- [ ] `name` is populated when Google supplies it.
- [ ] `auth_provider` is `google`.
- [ ] `role` is `physician` for a normal user.
- [ ] `credits` is `5` for a newly created normal user.

Then open `credit_transactions` and confirm:

- [ ] A `signup_grant` transaction exists for that user.
- [ ] Its amount is `5`.
- [ ] There is not more than one signup grant for the same test login.

## 12. Network requests to inspect

During the callback, verify these requests:

1. Supabase token exchange request:

   ```text
   https://YOUR-PROJECT-REF.supabase.co/auth/v1/token?grant_type=pkce
   ```

   Expected status: `200`.

2. Backend profile request:

   ```text
   https://YOUR-RENDER-SERVICE.onrender.com/api/auth/me
   ```

   Expected status: `200`.

Do not copy or share Authorization headers, access tokens, refresh tokens, PKCE verifiers, service-role keys, or Google client secrets.

## 13. Common failures

### Callback returns to `/login` with a PKCE verifier error

- Ensure login started and completed in the same browser and tab.
- Do not open the returned callback URL in a different browser/device.
- Clear site data and start the login again.
- Confirm Vercel is running the latest frontend deployment.

### `/auth/callback` returns Vercel 404

- Confirm `frontend/vercel.json` is deployed.
- Confirm the Vercel Root Directory is `frontend`.
- Redeploy the latest commit.

### `redirect_uri_mismatch` from Google

Check Google Cloud's authorized redirect URI. It must be the Supabase URL:

```text
https://YOUR-PROJECT-REF.supabase.co/auth/v1/callback
```

### Supabase says the redirect URL is not allowed

Confirm the existing allowed URL remains:

```text
https://pa-copliot-gamma.vercel.app/auth/callback
```

Do not remove the existing wildcard while troubleshooting.

### `/api/auth/me` returns 401

Vercel and Render probably use different Supabase projects or anon keys. Compare all Supabase environment variables and redeploy both services.

### `/api/auth/me` returns 500 or `Profile lookup failed`

- Confirm `backend-node/supabase_schema.sql` was applied.
- Confirm Render has the correct service-role key.
- Check Render logs for the exact `ensureProfile` error.

### Callback waits and then reports that the profile could not load

- Open the Render `/api/health` URL.
- Check whether the Render service is waking from sleep.
- Verify CORS and Supabase keys on Render.
- Check the failed `/api/auth/me` request in the browser Network panel.

## 14. Final approval

The client can be asked to retest only after all these are true:

- [ ] Latest frontend and backend deployments are live.
- [ ] Incognito Google login succeeds.
- [ ] New-account login succeeds.
- [ ] Cleared-site-data login succeeds.
- [ ] Slower-network login succeeds.
- [ ] Callback ends at `/dashboard`.
- [ ] Authentication user exists in Supabase.
- [ ] Matching profile row exists with 5 credits.
- [ ] Exactly one signup grant exists.
- [ ] Refreshing the dashboard preserves the session.
