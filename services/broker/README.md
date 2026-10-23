# Reel Studio OAuth broker

This Vercel Node/TypeScript service exchanges Instagram and TikTok credentials for the desktop app and stages Instagram exports in a private S3-compatible bucket. It does not publish posts. Platform secrets come from the environment. Platform bearer tokens cannot authorize uploads, and broker install tokens cannot call platform publishing APIs.

The API follows `docs/instagram.md` at `8554822` and `docs/tiktok.md` at `6b6e432`, with the separate install credential required for this broker. Instagram's `public_url` is a signed GET URL usable without an Authorization header. Both GET and PUT URLs expire after ten minutes. This takes precedence over the older contract's unsigned public object example and 26-hour readable window. Objects remain private and are deleted after 26 hours. A container that fetches media after the signed URL expires will fail; live Meta compatibility and slow uploads need testing before release.

## Endpoints

| Method and path | Purpose |
| --- | --- |
| `POST /api/instagram/oauth/start` | Save a ten-minute S256-bound loopback transaction. |
| `GET /api/instagram/oauth/callback` | Exchange Meta's code and short-lived token, validate the Professional account and redirect with a one-use handoff. |
| `POST /api/instagram/oauth/complete` | Redeem state, handoff and verifier atomically; return platform credentials and a separate `install_token`. |
| `POST /api/instagram/oauth/refresh` | Refresh a long-lived token. JSON `{ "access_token": "..." }` and install header required; account must match. |
| `POST /api/tiktok/oauth/token` | Exchange the desktop code/verifier or refresh a token with the server secret. Refresh also requires the install header. |
| `POST /api/instagram/uploads` | Reserve video and optional JPEG objects, returning signed PUT/GET URLs. Requires only the install header. |
| `POST /api/install/revoke` | Revoke this install and its refresh mapping. Requires the install header. |
| `POST /api/install/data-deletion` | Delete this platform account's broker records and media across all its installs. Requires the install header. |
| `POST /api/meta/deauthorize` | Verify Meta's HMAC-SHA256 `signed_request` and delete broker data. |
| `POST /api/meta/data-deletion` | Same deletion, with Meta's confirmation code and status URL response. |
| `POST /api/tiktok/webhook` | Verify TikTok's raw-body signature and process `authorization.removed`. |
| `POST /api/tiktok/deauthorize` | Alias of the signed TikTok webhook. |
| `GET /api/privacy` | Operator, contact and the service's data-use policy. |
| `GET /api/deletion-status?code=...` | Opaque receipt status, available for 24 hours. |
| `GET /api/cleanup` | Expiry and deletion retries. Requires `Authorization: Bearer <CRON_SECRET>`. |

Meta callback bodies accept JSON or form encoding. TikTok webhooks require JSON with a `TikTok-Signature` header. Meta signatures older than 24 hours and TikTok signatures outside five minutes are rejected. Duplicate signed deletion deliveries share one receipt. An unknown OAuth state never redirects. The only redirect allowlist entries are `http://127.0.0.1:<1..65535>/instagram/callback` and `http://127.0.0.1:<1..65535>/tiktok/callback`; credentials, queries, fragments, alternate IP spellings, hostnames and arbitrary HTTPS targets are rejected. TikTok redirects directly to the desktop listener, as its pinned contract requires.

## Client changes

The connector branches are not changed by this service. Their client owners must make these changes before enabling the broker:

1. Read `install_token` from Instagram's `/api/instagram/oauth/complete` response and TikTok's initial `/api/tiktok/oauth/token` authorization-code response. Each OAuth connection creates a distinct random install credential, bound to that platform account. Refresh keeps the existing credential.
2. Store it encrypted with Electron `safeStorage` alongside that connection's encrypted credentials, under the same atomic file-write and no-plaintext-fallback rules. Keep it in the main process; never expose it in renderer session responses, logs, project files or URLs. Existing saved connections must reconnect once because they have no broker credential.
3. Send `X-Reel-Install-Token: <install_token>` only to the configured broker origin on `POST /api/instagram/uploads`, both broker refresh routes, `/api/install/revoke` and `/api/install/data-deletion`. Remove `Authorization: Bearer <Instagram token>` from the upload request. The upload body stays `{ "video_size": ..., "cover_size": ... }`. No platform access token is needed, sent or stored to authenticate an upload.
4. Continue sending platform bearer tokens directly to platform APIs. Send no broker or platform authentication header to the returned object-store PUT/GET addresses. Continue enforcing `instagramUploadOrigins` for both addresses; include the S3 endpoint origin, or the region-specific virtual-host bucket origin when path-style addressing is off.
5. On explicit broker sign-out, call `/api/install/revoke` before deleting the encrypted install token locally. For data deletion call `/api/install/data-deletion` before clearing credentials. Network failure must be reported so server revocation is not falsely claimed. Platform permission removal also triggers server-side deletion through the signed callbacks.
6. TikTok refresh must now include the install header in addition to its existing JSON refresh token. Instagram may retain its direct, secret-free platform refresh; its broker install credential expires with the original long-lived token. Alternatively, call the broker refresh route with the install header to extend the broker credential expiry after an account-checked refresh. An expired/revoked install requires OAuth again.

## Storage and limits

PostgreSQL is required in production. `schema.sql` creates an encrypted record store; advisory transaction locks serialize changes to each account, OAuth state and rate counter across function instances. AES-256-GCM binds each encrypted payload to its record key. Install tokens and TikTok refresh tokens are indexed only by SHA-256 hashes. No platform bearer token is stored after Instagram handoff redemption; unredeemed tokens expire logically after sixty seconds and the cleanup job deletes expired encrypted records. TikTok access and refresh values are returned directly to the desktop, never persisted in plaintext.

The first deletion transaction commits credential revocation and media cleanup reservations before any object-store request. It deletes current objects immediately, up to ten in the foreground; the cleanup job processes the rest and retries failures. A presigned PUT remains valid until its ten-minute expiry. A cleanup reservation survives the first deletion until that expiry, then deletes the object again to handle replay. Status remains `pending` while reservations exist. Deletion cannot remove exports already downloaded by Meta or posts already published at either platform.

Configure a private, non-versioned bucket dedicated to `staging/`. Versioning and object lock must be off so DeleteObject actually removes the bytes. There is no anonymous listing, public read policy or anonymous upload endpoint. Signed PUT grants bind one random key, content type and requested Content-Length. The broker never proxies large media through a function. The object-store lifecycle is a fallback; the five-minute cleanup job enforces the broker's 26-hour retention, subject to successful storage requests. Monitor failed cleanup counts and function errors.

Initial limits are deliberately conservative policy choices, without load-test evidence: 30 authenticated broker calls per install per minute, five upload reservations per install per minute, 20 per account per hour, and 40 outstanding media objects per account. Before OAuth there is no install credential: starts have 20 requests per trusted Vercel client address per minute and 200 globally per minute, with at most 1,000 live Instagram states. Bodies are capped at 16 KiB. The existing clients must retain their state/PKCE checks. Rate limits and revocation are shared across all Vercel instances.

The service does not log request data. Disable external request-body/header capture, analytics and URL logging on OAuth and media routes; Vercel/provider infrastructure logs and retention must be reviewed separately. All broker responses use `Cache-Control: no-store` and `Referrer-Policy: no-referrer`. Platform errors expose safe error codes, not raw upstream bodies.

## Environment variables

Set values in Vercel's environment settings, separately for each intended environment. Do not put real values in `.env.example` or commit a local `.env` file.

| Name | Meaning |
| --- | --- |
| `BROKER_ORIGIN` | Exact public HTTPS origin, without a trailing slash. |
| `INSTAGRAM_APP_ID` | Public Instagram app ID accepted by OAuth start. |
| `INSTAGRAM_APP_SECRET` | Instagram secret for token exchange and signed callbacks. |
| `TIKTOK_CLIENT_KEY` | Public TikTok client key. |
| `TIKTOK_CLIENT_SECRET` | TikTok secret for token exchange and webhook verification. |
| `BROKER_DATABASE_URL` | TLS PostgreSQL connection URL, using a pooler compatible with transaction advisory locks. |
| `BROKER_ENCRYPTION_KEY` | Cryptographically random 32-byte key encoded as exactly 64 hexadecimal characters. Retain it securely; replacing it requires deleting/migrating old records. |
| `S3_ENDPOINT` | HTTPS S3 API origin. |
| `S3_REGION` | Signing region required by the chosen store. |
| `S3_BUCKET` | Dedicated private, non-versioned media bucket. |
| `S3_ACCESS_KEY_ID` | Server-side key with access only to the staging prefix. |
| `S3_SECRET_ACCESS_KEY` | Corresponding object-store secret. |
| `S3_FORCE_PATH_STYLE` | `true` for path-style compatible stores, `false` for AWS virtual-host addressing. Defaults to `true`. |
| `CRON_SECRET` | Independent random secret of at least 32 characters. Vercel Cron supplies it as a bearer credential. |
| `PRIVACY_CONTACT_EMAIL` | Operator email shown by the privacy endpoint. |
| `PRIVACY_OPERATOR_NAME` | Legal/operator name shown by the privacy endpoint. |

## Vercel setup for Sam

1. Create a PostgreSQL database near the intended Vercel region. In its SQL console, run the statements from `services/broker/schema.sql`. Create a runtime database role limited to SELECT, INSERT, UPDATE and DELETE on `broker_records`; supply its TLS connection URL. Do not use an edge runtime.
2. Create a dedicated private S3-compatible bucket with versioning, object lock and public access disabled. Issue a server credential limited to `PutObject`, `GetObject` and `DeleteObject` for `<bucket>/staging/*`; grant no public list access. Require TLS. If the provider supports signature-age bucket policies, cap them at 600,000 milliseconds. Set a two-day lifecycle expiry as a cleanup-outage fallback; the broker's cron handles the earlier 26-hour deadline. CORS is needed only for a future browser uploader; the current Electron main-process PUT does not require it.
3. In Vercel, import the fork repository, choose the reviewed `broker` branch, select Framework Preset **Other**, and set Root Directory to `services/broker`. Set Node.js to 22.x, install command to `npm ci --ignore-scripts`, and build command to `npm run typecheck`. Leave Output Directory unset. The `api/index.ts` function and `vercel.json` rewrites handle `/api/*`.
4. Configure a stable HTTPS domain and every environment variable listed above. Generate the encryption and cron secrets privately. Set `BROKER_ORIGIN` to that exact domain and keep production credentials out of unrelated previews. Use a Vercel plan supporting five-minute cron execution; Hobby's daily scheduling is insufficient. Check that the `*/5 * * * *` cleanup schedule is enabled for the production deployment and that its authorization header comes from `CRON_SECRET`.
5. Review the privacy endpoint text for the actual operator, storage provider, legal policy and retention configuration. Register its stable `/api/privacy` URL in both platform dashboards. Add any platform-required terms-of-service page separately; this service does not draft legal terms.
6. In Meta's Instagram Login settings, register the exact `https://<broker-domain>/api/instagram/oauth/callback`. Register `/api/meta/deauthorize` as the deauthorization callback and `/api/meta/data-deletion` as the data deletion callback. Add owned Professional test accounts and obtain the required access/reviews for `instagram_business_basic`, `instagram_business_content_publish` and `instagram_business_manage_insights`.
7. In TikTok, use a Desktop app with Login Kit and register `http://127.0.0.1:*/tiktok/callback`. Register `https://<broker-domain>/api/tiktok/webhook` for signed events. Configure `user.info.basic`, `video.upload`, `video.list` and optional `video.publish`, then complete the required reviews/audit. TikTok's OAuth redirect goes directly to the desktop, not a new HTTPS broker callback.
8. Route the changes under **Client changes** to the connector owners. Set the broker origin and public app IDs/keys in the desktop settings and allow the exact S3 URL origin in `instagramUploadOrigins`.
9. When ready, deploy the reviewed commit yourself. Make the OAuth callbacks, signed platform deletion callbacks, privacy page and signed object GETs publicly reachable; deployment protection must not intercept them. Keep authenticated endpoints behind their application credentials.
10. With owned test accounts, verify both real token flows, install revocation, Meta's signed deletion/status response, TikTok's signed deauthorization, an Instagram video/cover transfer and delayed Meta retrieval within the ten-minute URL window. Verify S3 rejects wrong PUT length/type and expired signatures. Run cleanup with a disposable object and check that records/bytes disappear. Check logs do not capture credentials. Offline tests do not establish platform approval, real provider behavior or hosted routing.

## Local verification

From this folder, `npm ci --ignore-scripts`, `npm test` and `npm run typecheck` use this package's own lockfile and install. The suite blocks ambient fetch and injects platform HTTP fixtures and an object-store substitute. A separate test signs URLs with the real AWS SDK without contacting storage. Encryption tests use fresh local keys. PostgreSQL concurrency behavior, Vercel routing/cron and live platform integration still require hosted verification.
