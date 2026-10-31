# Sign-in provider setup

`/register` shows a sign-in button for a provider only when that provider's env vars are set (`server/auth.js`). No credentials, no button, and the manual path (name + selfie) keeps working. Signing in with a second provider links it to the same profile.

Each provider needs its own app and a **callback URL**. Replace `BASE` below with `PUBLIC_BASE_URL` (prod: `https://aura-haunt.fly.dev`). The callback is always `BASE/auth/<provider>/callback`.

| Provider | Callback URL | Env vars | Cost / approval |
|---|---|---|---|
| GitHub | `BASE/auth/github/callback` | `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | free, instant |
| LinkedIn | `BASE/auth/linkedin/callback` | `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET` | free, needs a Company Page, product usually self-serve |
| Google | `BASE/auth/google/callback` | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | free, instant |
| Apple | `BASE/auth/apple/callback` | `APPLE_CLIENT_ID`, `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY` | **$99/yr Apple Developer Program**, HTTPS domain only |

Store the values with `scripts/secrets.sh set prod KEY=value` (see SECRETS.md), run `scripts/secrets.sh push-to-host`, then deploy. Never paste a secret into the bus, a PR or a commit message.

**One callback URL per app.** The tunnel, localhost and prod have different hosts, so make a second app per provider for local testing and put its values in `dev`. Apple cannot do localhost at all (HTTPS and a real domain only); test Apple on the deployed URL or the tunnel domain.

## GitHub

1. GitHub, Settings, Developer settings, OAuth Apps, New OAuth App (use the org if the team should own it).
2. Homepage URL: `BASE`. Authorization callback URL: `BASE/auth/github/callback`.
3. Register, then Generate a new client secret. Copy it now; GitHub shows it once.
4. Set `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`.

The app asks for `read:user` only (name, login, avatar). If the app belongs to an org with third-party restrictions, an org owner has to approve it.

## LinkedIn

1. linkedin.com/developers/apps, Create app. It must be associated with a LinkedIn **Company Page** (create an empty one if you have none) and needs a logo.
2. Products tab: request **Sign In with LinkedIn using OpenID Connect**. This is normally approved immediately.
3. Auth tab: add the redirect URL `BASE/auth/linkedin/callback`. The Auth tab also shows the Client ID and the Client Secret (Primary).
4. Set `LINKEDIN_CLIENT_ID` and `LINKEDIN_CLIENT_SECRET`.

Scopes used: `openid profile email`. That returns name, picture and email, not the profile URL or headline, so the LinkedIn handle on the card stays whatever the person types. Picture URLs expire, so the server downloads the image at sign-in and keeps the bytes. Using the "Share on LinkedIn" or other products is not needed.

## Google

1. console.cloud.google.com, create or pick a project.
2. APIs & Services, OAuth consent screen (Google Auth Platform, Branding): app name, support email, user type **External**. Scopes `openid`, `email`, `profile` are non-sensitive, so no Google verification is needed.
3. While the app is in **Testing**, only listed test users (up to 100) can sign in. Before the event, click **Publish app** so anyone can.
4. Credentials, Create credentials, OAuth client ID, type **Web application**. Authorized redirect URI: `BASE/auth/google/callback`. (Authorized JavaScript origins can stay empty; this is a server-side flow.)
5. Copy the Client ID and Client secret into `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.

Changes to redirect URIs can take a few minutes to apply.

## Apple (Sign in with Apple)

Requires a paid Apple Developer Program membership and a public HTTPS domain. Apple returns the person's name **only the first time** they authorize the app, and never a photo, so an Apple user types or keeps their own name and takes a selfie.

1. developer.apple.com, Certificates, Identifiers & Profiles, Identifiers, **App IDs**: create (or reuse) an App ID and enable the **Sign in with Apple** capability. It is the primary App ID for the next step; it never ships as an app.
2. Identifiers, **Services IDs**, create one (for example `com.yourteam.haunt.web`). Enable Sign in with Apple, then Configure: pick the primary App ID, add your domain (`aura-haunt.fly.dev`, no scheme) and the return URL `BASE/auth/apple/callback`. This Services ID is `APPLE_CLIENT_ID`.
3. If the portal asks you to verify the domain, download the file it gives you and serve it at `BASE/.well-known/apple-developer-domain-association.txt`. Put it at `web/.well-known/apple-developer-domain-association.txt`; the server's static handler serves `.well-known` (checked on the installed Express). Confirm with `curl` on the deployed URL before pressing Verify.
4. Keys, create a key, enable **Sign in with Apple**, choose the same primary App ID. Download the `.p8` once (Apple will not let you download it again) and note the **Key ID**.
5. Team ID: top right of the developer portal, or Membership details.
6. Set the four values. The private key goes in as one line with literal `\n` for newlines:
   ```bash
   scripts/secrets.sh set prod \
     APPLE_CLIENT_ID=com.yourteam.haunt.web \
     APPLE_TEAM_ID=ABCDE12345 \
     APPLE_KEY_ID=ABC123DEFG \
     "APPLE_PRIVATE_KEY=$(awk '{printf "%s\\n",$0}' AuthKey_ABC123DEFG.p8)"
   ```
   Keep the `.p8` file out of the repo (`.gitignore` blocks `*.p8`; store it in a password manager).

To retest the first-time name flow, remove the app at appleid.apple.com, Sign-In and Security, Sign in with Apple, then sign in again.

## Checking it worked

```bash
curl -s BASE/api/auth/providers          # lists every provider with credentials set
```
Then open `BASE/register` on a phone and try each button. Failures show `Sign-in failed: <reason>` on the page. The usual causes are a callback URL that does not match exactly (scheme, host, path), `PUBLIC_BASE_URL` pointing at the wrong host, and, for Google, a user missing from the Testing list.
