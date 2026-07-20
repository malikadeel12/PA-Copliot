# PA Copilot Deployment and Authentication Setup

This guide deploys:

- The React frontend to Vercel
- The Node.js/Express backend to Render
- Authentication and the database through Supabase

Follow the steps in order. Do not commit real API keys or service-role keys to Git.

## 1. Before deploying

Make sure the latest code containing these authentication fixes is pushed to GitHub:

- `frontend/src/context/AuthContext.js`
- `backend-node/src/auth.js`
- `frontend/vercel.json`

The fixes prevent the Supabase login operation from waiting on a slow Render request, prevent duplicate profile creation races, and make Vercel serve React routes such as `/login` and `/reset-password`.

## 2. Configure Supabase

### 2.1 Create or open the Supabase project

1. Sign in to [Supabase](https://supabase.com/dashboard).
2. Create a project, or open the project used by PA Copilot.
3. Open **SQL Editor**.
4. Copy all SQL from `backend-node/supabase_schema.sql`.
5. Run the SQL once.

Do not repeatedly run schema statements if the tables already exist unless you have reviewed the SQL and know the operation is safe.

### 2.2 Collect the Supabase values

Open **Project Settings → API** and copy:

- Project URL
- Anon or publishable key
- Service-role key

The service-role key is secret. It must only be added to Render. Never add it to Vercel or frontend code.

### 2.3 Enable email authentication

1. Open **Authentication → Providers**.
2. Enable **Email**.
3. Decide whether users must confirm their email address.
4. Save the settings.

If email confirmation is enabled, a new user will not receive a session until they click the confirmation link. The UI will tell the user to check their email.

For reliable production email delivery, configure a custom SMTP provider under the Supabase authentication email settings. The default email service is intended for limited testing and may be rate-limited.

### 2.4 Configure production URLs

Deploy Vercel once if you do not have the final frontend URL yet. Then open **Authentication → URL Configuration** in Supabase.

Set **Site URL** to the exact production frontend origin:

```text
https://your-production-domain.com
```

Add these **Redirect URLs**:

```text
https://your-production-domain.com/login
https://your-production-domain.com/reset-password
```

If the production site uses the Vercel domain, use that exact domain:

```text
https://your-project.vercel.app/login
https://your-project.vercel.app/reset-password
```

For Vercel preview deployments, you may add an appropriate Vercel preview wildcard supported by Supabase, but keep the production URL explicitly listed.

Important URL rules:

- Use `https://` in production.
- Do not add a trailing slash to the origin.
- The hostname must exactly match the URL users open.
- Add both the Vercel domain and custom domain if users may use both.

## 3. Configure Google OAuth (optional)

Skip this section if only email/password authentication is required.

### 3.1 Create Google OAuth credentials

1. Open [Google Cloud Console](https://console.cloud.google.com/).
2. Select or create a project.
3. Configure the OAuth consent screen.
4. Open **APIs & Services → Credentials**.
5. Create an **OAuth client ID** of type **Web application**.

### 3.2 Add the Supabase callback to Google

In the Google OAuth client, add this **Authorized redirect URI**:

```text
https://YOUR-SUPABASE-PROJECT-REF.supabase.co/auth/v1/callback
```

Use the real Supabase project reference. This callback is a Supabase URL, not the Vercel `/login` URL.

If Google requests authorized JavaScript origins, add the production frontend origin:

```text
https://your-production-domain.com
```

### 3.3 Add Google credentials to Supabase

1. Return to **Supabase → Authentication → Providers → Google**.
2. Enable Google.
3. Enter the Google client ID and client secret.
4. Save the provider settings.

## 4. Deploy the backend to Render

### 4.1 Create the service

1. Sign in to [Render](https://dashboard.render.com/).
2. Select **New → Web Service**.
3. Connect the GitHub repository.
4. Use these settings:

```text
Root Directory: backend-node
Runtime: Node
Build Command: npm install
Start Command: npm start
```

Render normally supplies `PORT` automatically. The application already reads `process.env.PORT`.

### 4.2 Add Render environment variables

Open the Render service's **Environment** settings and add:

```text
SUPABASE_URL=https://YOUR-SUPABASE-PROJECT-REF.supabase.co
SUPABASE_ANON_KEY=your-supabase-anon-or-publishable-key
SUPABASE_SERVICE_ROLE_KEY=your-secret-service-role-key
ADMIN_EMAIL=your-admin-email@example.com
CORS_ORIGINS=https://your-production-domain.com
```

Add the AI/OCR variables required by the features you use:

```text
ANTHROPIC_API_KEY=your-anthropic-key
ANTHROPIC_MODEL=your-supported-model-id
GCP_SERVICE_ACCOUNT_JSON=your-complete-service-account-json
DOCUMENT_AI_LOCATION=us
DOCUMENT_AI_PROCESSOR_ID=your-processor-id
```

If users can access both a Vercel domain and a custom domain, provide comma-separated origins:

```text
CORS_ORIGINS=https://your-project.vercel.app,https://your-production-domain.com
```

Do not include paths such as `/login`, `/api`, or a trailing slash in `CORS_ORIGINS`.

### 4.3 Verify Render

After deployment, open:

```text
https://your-render-service.onrender.com/api/health
```

Expected response:

```json
{"status":"ok","ts":1234567890}
```

Copy the Render service origin, without `/api` and without a trailing slash. You will add it to Vercel.

## 5. Deploy the frontend to Vercel

### 5.1 Create the Vercel project

1. Sign in to [Vercel](https://vercel.com/).
2. Import the GitHub repository.
3. Configure:

```text
Root Directory: frontend
Framework Preset: Create React App
Build Command: npm run build
Output Directory: build
```

The `frontend/vercel.json` file provides the SPA rewrite required for direct visits and authentication redirects.

### 5.2 Add Vercel environment variables

Open **Project Settings → Environment Variables** and add:

```text
REACT_APP_BACKEND_URL=https://your-render-service.onrender.com
REACT_APP_SUPABASE_URL=https://YOUR-SUPABASE-PROJECT-REF.supabase.co
REACT_APP_SUPABASE_ANON_KEY=your-supabase-anon-or-publishable-key
```

Important:

- Do not add `/api` to `REACT_APP_BACKEND_URL`; the frontend adds it automatically.
- Do not add the Supabase service-role key to Vercel.
- Select **Production**, **Preview**, and **Development** for each variable if all deployment types need authentication.
- Create React App embeds variables during the build. Redeploy after changing any `REACT_APP_*` value.

### 5.3 Redeploy Vercel

After saving the environment variables:

1. Open **Deployments**.
2. Select the latest deployment.
3. Choose **Redeploy**.
4. Do not reuse an old build if Vercel offers an option to rebuild without cache.

## 6. Redeployment order after applying the fix

Use this order:

1. Commit and push the fixed files to GitHub.
2. Deploy the Render backend.
3. Confirm `/api/health` returns `200`.
4. Deploy the Vercel frontend.
5. Update Supabase Site URL and Redirect URLs with the final Vercel/custom domain.
6. If using Google OAuth, verify the Google callback and Supabase provider settings.
7. Test in a private browser window.

Example Git commands:

```bash
git add .gitignore DEPLOYMENT_AUTH_SETUP.md \
  frontend/src/context/AuthContext.js \
  frontend/vercel.json \
  backend-node/src/auth.js
git commit -m "Fix production authentication and document deployment"
git push origin main
```

Review `git status` and `git diff` before committing. Do not commit `.env` files or credentials.

## 7. Test the complete authentication flow

Use a private/incognito window so an old Supabase session does not affect the result.

### 7.1 Email signup test

1. Open the exact production frontend URL.
2. Select **Register**.
3. Use a new email address and a password that satisfies the Supabase password policy.
4. Submit the form.
5. If email confirmation is enabled, open the confirmation email and click the link.
6. Confirm that the browser returns to the production site.
7. Sign in.
8. Confirm the dashboard opens and the account has five initial credits.

### 7.2 Existing-user login test

1. Sign out.
2. Sign in with the same account.
3. Confirm the dashboard opens without a long spinner.
4. In browser developer tools, verify `/api/auth/me` returns `200`.

### 7.3 Google login test

1. Sign out and return to `/login`.
2. Select **Continue with Google**.
3. Complete Google authentication.
4. Confirm the browser returns to `https://your-production-domain.com/login`.
5. Confirm the dashboard opens.

### 7.4 Password-reset test

1. Select **Forgot password?**.
2. Submit an existing email address.
3. Open the reset email.
4. Confirm the link opens `/reset-password` on the production frontend.
5. Set a new password and sign in.

### 7.5 International test

Ask the international tester to:

1. Use the same exact production URL.
2. Test in a private/incognito browser window.
3. Disable VPNs, privacy extensions, and corporate filtering temporarily for one test.
4. Record the visible error message.
5. Open browser developer tools → **Network** and preserve the log.
6. Check requests to both:
   - `YOUR-PROJECT.supabase.co`
   - `your-render-service.onrender.com/api/auth/me`
7. Send the failed request's URL, status code, and response body to the developer. Never send access tokens or API keys.

## 8. Troubleshooting

### `Failed to fetch` for a Supabase URL

The browser cannot reach Supabase. Check DNS, a corporate firewall, VPN, browser extensions, and whether the Supabase project is active. This occurs before the Render backend is involved.

### `Invalid login credentials`

Confirm the email/password, confirm the email if confirmation is enabled, and verify that Vercel points to the same Supabase project where the user was created.

### `Email not confirmed`

The user must click the confirmation email. Verify Supabase Site URL, Redirect URLs, SMTP configuration, spam folders, and email rate limits.

### `Email rate limit exceeded`

Configure custom SMTP in Supabase or wait for the test limit to reset. Do not repeatedly create accounts using the default test mailer.

### `401 Invalid or expired token` from `/api/auth/me`

Vercel and Render are probably using different Supabase projects or keys. Confirm that these values belong to the same project:

- Vercel `REACT_APP_SUPABASE_URL`
- Vercel `REACT_APP_SUPABASE_ANON_KEY`
- Render `SUPABASE_URL`
- Render `SUPABASE_ANON_KEY`
- Render `SUPABASE_SERVICE_ROLE_KEY`

Redeploy both services after correcting the values.

### Browser CORS error for the Render URL

Set Render `CORS_ORIGINS` to the exact frontend origin. For multiple origins, separate them with commas. Then redeploy Render.

Correct:

```text
https://your-project.vercel.app,https://app.example.com
```

Incorrect:

```text
https://your-project.vercel.app/,https://app.example.com/login
```

### `/login` or `/reset-password` returns a Vercel 404

Confirm `frontend/vercel.json` is committed and that Vercel's Root Directory is `frontend`. Redeploy Vercel.

### Login succeeds but returns to the login page

Check `/api/auth/me` in browser developer tools. If it fails:

- `401`: verify matching Supabase credentials.
- CORS error: fix Render `CORS_ORIGINS`.
- `500 Profile lookup failed`: verify the Supabase schema and Render service-role key.
- Timeout or `502/503`: inspect Render logs and check whether the free Render service is waking from sleep.

### Google reports `redirect_uri_mismatch`

The authorized redirect URI in Google must exactly equal:

```text
https://YOUR-SUPABASE-PROJECT-REF.supabase.co/auth/v1/callback
```

Do not use the Vercel `/login` URL as Google's OAuth callback. Vercel is configured as an allowed redirect in Supabase instead.

## 9. Security checklist

- Keep `SUPABASE_SERVICE_ROLE_KEY` only on Render.
- Keep Anthropic and Google service-account secrets only on Render.
- The Supabase anon/publishable key may be used by the frontend.
- Never commit `.env` files.
- Never paste tokens from browser developer tools into tickets or chat.
- Rotate any key immediately if it was committed or publicly shared.
- Use HTTPS URLs for all production services.
- Restrict Render CORS to the real frontend domains.

## 10. Final production checklist

- [ ] Supabase schema has been applied.
- [ ] Supabase Email provider is enabled.
- [ ] Supabase Site URL matches the production frontend.
- [ ] Supabase `/login` and `/reset-password` redirect URLs are allowed.
- [ ] Google OAuth callback points to Supabase, if Google login is enabled.
- [ ] Render environment variables are configured.
- [ ] Render `/api/health` returns `200`.
- [ ] Vercel environment variables are configured for Production.
- [ ] Vercel `REACT_APP_BACKEND_URL` does not contain `/api`.
- [ ] Vercel and Render use the same Supabase project.
- [ ] `frontend/vercel.json` is deployed.
- [ ] Both Render and Vercel were redeployed after variable changes.
- [ ] Email signup, login, Google login, and password reset were tested.
- [ ] Testing was repeated in a private window from the client's location.
