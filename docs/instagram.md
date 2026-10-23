# Instagram backend

API version **v26.0**, checked against Meta's official documentation on 2026-10-23:

- [Business Login for Instagram](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/business-login)
- [Account fields](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/get-started)
- [Content publishing](https://developers.facebook.com/documentation/instagram-platform/content-publishing)
- [Media container creation and cover specifications](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media)
- [Media insights](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-media/insights/)
- [Graph API versions](https://developers.facebook.com/docs/graph-api/changelog/)
- [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage)

This backend connects one Professional account per installation. It uses Instagram Login on `graph.instagram.com`, without a Facebook Page. The required permissions are exactly:

```
instagram_business_basic
instagram_business_content_publish
instagram_business_manage_insights
```

The app rejects Personal accounts before saving a connection or uploading a video. A Business or Creator account is required. Some insights can be delayed by 48 hours; absent values remain `null`, never invented zeros.

## Developer settings and calls

The main process requires both developer mode and `instagramEnabled: true`. Tests of the app's normal Electron entry point cannot enable live Instagram access. There is no new settings UI. The preload exposes typed `reel.instagram` calls for a future interface. Configure them from a development build:

```ts
await reel.instagram.configure({
  instagramEnabled: true,
  instagramAppId: '<Instagram app ID>',
  instagramBrokerUrl: 'https://<project-server-domain>',
  instagramUploadOrigins: ['https://<approved-object-storage-host>']
})
```

Settings default to disabled. `configure` cancels current work and clears the previous local connection. `session` returns account ID, username and expiry without exposing credentials. `connect` opens the system browser, `cancelConnect` closes its pending callback, and `disconnect` cancels current work and deletes the local encrypted token. Disconnect is local sign-out; it does not revoke Meta permissions. Removing access in Instagram also invalidates the connection.

```ts
await reel.instagram.connect()
const post = await reel.instagram.publish({
  slug: '<project-slug>',
  version: 1,
  caption: 'A caption',
  cover: { kind: 'image' }
})
await reel.instagram.insights('<project-slug>', 1, post.postId)
```

Publishing reads the finished `versions/vN/export.mp4`. An image cover reads that version's `cover.png` and converts it to JPEG because Meta requires JPEG covers. Alternatively, pass `cover: { kind: 'frame', offsetMs: 800 }` to select a video frame. Caption length is limited to 2,200 Unicode code points. Meta validates the remaining media constraints, including codec, duration, aspect ratio, hashtags and mentions. Exports must meet its linked specifications; the backend does not transcode them.

Tokens are encrypted with Electron 44's safeStorage in `instagram-credentials.bin` under app data, written atomically with owner-only file permissions. There is no plaintext fallback. Linux `basic_text` storage is rejected. The synchronous safeStorage API matches the app's installed Electron version; migrate it when upgrading to Electron 46.

Refresh happens before API work when at most seven days remain. Seven days is a conservative maintenance window, not a measured optimum. Meta permits refresh only while the long-lived token is valid and at least 24 hours old. A definite OAuth rejection triggers one refresh and one retry when those conditions hold. An expired or revoked connection requires a new user sign-in. There is no background network activity or automatic posting.

## Server contract

Only the desktop client is implemented here. The project's Vercel app must implement the HTTPS broker below before connection or media staging can work. `instagramBrokerUrl` is its origin, without a path or query. The Instagram App Secret belongs exclusively in the server's secret store. Both the authorization-code exchange and the long-lived exchange require that secret and run on the server.

Every response containing a token, handoff or upload URL must use `Cache-Control: no-store`. Redact codes, tokens, state, verifiers and signed URLs from logs. Do not use request URLs containing tokens in analytics. Return errors as `{ "error": { "code": <Meta numeric code> } }` with an appropriate HTTP status, omitting raw upstream messages. The client maps errors to plain messages. For broker-specific failures, use 400 for invalid input, 401 for an invalid handoff/session, 403 for denied access and 429 for a limit.

### Begin connection

`POST /api/instagram/oauth/start`, JSON body:

```json
{
  "app_id": "<Instagram app ID>",
  "state": "<32 random bytes, base64url>",
  "loopback_uri": "http://127.0.0.1:<port>/instagram/callback",
  "code_challenge": "<base64url SHA-256 of code_verifier>",
  "code_challenge_method": "S256"
}
```

Return HTTP 200 with `{}` only after storing this transaction in a shared durable store. Allow only the server's configured app ID, an unused random state, S256 and the exact literal loopback IP, path and an explicit valid port. Reject credentials, fragments and queries in the loopback URI. Expire transactions after ten minutes, rate-limit creation and bound total outstanding transactions. Never allow an arbitrary redirect destination.

The desktop opens `https://www.instagram.com/oauth/authorize` with the configured app ID, the three scopes, this state and `redirect_uri=https://<broker>/api/instagram/oauth/callback`. S256 protects the broker handoff; it is not an assertion that Instagram supports PKCE.

### Meta callback and exchange

`GET /api/instagram/oauth/callback?code=...&state=...` is the exact HTTPS redirect registered in Meta. Match a live unused transaction and consume the authorization code once. On the server:

1. `POST https://api.instagram.com/oauth/access_token` with `client_id`, `client_secret`, `grant_type=authorization_code`, the exact HTTPS `redirect_uri` and `code`. Extract the short-lived token and granted permissions from Meta's response.
2. `GET https://graph.instagram.com/access_token` with `grant_type=ig_exchange_token`, `client_secret` and the short-lived `access_token`. Retain the returned long-lived token, bearer token type and expiry.
3. Create a random one-use handoff bound to the transaction, state and S256 challenge. Expire it after 60 seconds. Store tokens encrypted and discard the short-lived token.
4. Redirect only to the stored loopback URI with `?state=<state>&handoff=<handoff>`. The handoff must be 16 to 512 base64url characters. Tokens and the Meta authorization code must never enter the loopback URL.

If authorization is denied, redirect to the stored loopback URI with the original state and `error=access_denied`. For other failures, use the same state-bound error callback, without upstream error details. Never redirect an unknown state.

### Redeem handoff

`POST /api/instagram/oauth/complete`, JSON body:

```json
{ "handoff": "<one-use handoff>", "state": "<state>", "code_verifier": "<verifier>" }
```

Atomically check expiry, state, handoff and SHA-256 verifier proof, consume the handoff, and return:

```json
{
  "access_token": "<long-lived token>",
  "token_type": "bearer",
  "expires_in": 5184000,
  "permissions": [
    "instagram_business_basic",
    "instagram_business_content_publish",
    "instagram_business_manage_insights"
  ]
}
```

`expires_in` is the remaining lifetime from Meta, not a fixed server constant. Delete the broker's temporary token and transaction after redemption or expiry. The client verifies the account directly through `GET /v26.0/me?fields=user_id,username,account_type` before saving the token. Subsequent refresh uses Meta's unversioned `/refresh_access_token?grant_type=ig_refresh_token&access_token=...` endpoint directly, which needs no app secret.

### Stage a local export

The official content-publishing guide limits resumable upload to Facebook Login for Business. For this Instagram Login implementation, the client uses `video_url` with temporary public storage. The user does not supply a public video URL.

`POST /api/instagram/uploads` with `Authorization: Bearer <Instagram token>` and JSON:

```json
{ "video_size": 123456, "cover_size": 1234 }
```

`cover_size` is `null` for a frame cover. Validate the token with Meta's `/me`, associate the session with that account, reject non-Professional accounts, and enforce per-account quotas. Permit only a video of 1 to 300,000,000 bytes and, when requested, a JPEG of 1 to 8,000,000 bytes. Return HTTP 200:

```json
{
  "video": {
    "upload_url": "https://<approved-storage-host>/<random-object>?<signed-put>",
    "public_url": "https://<approved-storage-host>/<random-object>"
  },
  "cover": {
    "upload_url": "https://<approved-storage-host>/<random-cover>?<signed-put>",
    "public_url": "https://<approved-storage-host>/<random-cover>"
  }
}
```

Omit `cover` for a frame cover. Use an object store with presigned PUT support behind the Vercel broker, such as S3 or R2. Do not proxy a 300 MB export through a Vercel function's request body. The signed PUT must authorize exactly one object, content type and requested length, expire after ten minutes, and grant no listing or read of other objects. The desktop sends a streamed `PUT` with `Content-Type: video/mp4` and `Content-Length`; the JPEG uses `image/jpeg`. It sends no Instagram token to storage. Both returned URL origins must be explicitly listed in `instagramUploadOrigins`.

Objects must be immediately readable by Meta without cookies or authorization once PUT completes. Use unguessable names and expire objects automatically after 26 hours, covering the container's 24-hour lifetime and cleanup delay. Avoid sensitive names and disable object listing. Public staging is a disclosure of the exported video and selected cover to the storage host and Meta. A future publish interface must explain that before calling this backend. The server never calls `/media_publish`.

## Publishing and outcomes

The client creates `POST /v26.0/<account-id>/media` with `media_type=REELS`, `video_url`, caption and `cover_url` or `thumb_offset`. It checks `GET /v26.0/<container-id>?fields=status_code` immediately and then once per minute for up to five minutes. Only `FINISHED` permits `POST /v26.0/<account-id>/media_publish` with `creation_id`. Processing can resume on a later call for the same version without reuploading it. A saved SHA-256 fingerprint binds the container to its caption and cover choice; changed settings are rejected instead of silently publishing old metadata.

`instagram-publish.json` records the account, container and publish state before issuing the publish call. One publish is allowed per project version. A repeated call returns the recorded post. Concurrent calls in this main process are serialized. After a lost response or a crash during publishing, the saved `publishing` state blocks another attempt because the reel might already be public. Support must reconcile the container and Instagram account before clearing that record. A definite rejected request, such as a rate limit, leaves the processed container available for retry. A local write failure after success reports the returned post ID. Do not blindly retry by creating a new version.

`outcomes.json` has this shape, preserving other versions and post IDs on each atomic update:

```json
{
  "schemaVersion": 1,
  "versions": {
    "v1": {
      "<post-id>": {
        "version": 1,
        "accountId": "<Instagram account ID>",
        "postId": "<post-id>",
        "publishedAt": "<ISO timestamp>",
        "platform": "instagram",
        "apiVersion": "v26.0",
        "observedAt": "<ISO timestamp or null>",
        "metrics": {
          "plays": 100,
          "reach": 80,
          "likes": 10,
          "comments": 2,
          "shares": 3,
          "saves": 4,
          "averageWatchTimeMs": 4500,
          "totalWatchTimeMs": 450000,
          "skipRatePercent": 12.5
        }
      }
    }
  }
}
```

Before collection, `metrics` and `observedAt` are `null`. Join `trials.json` on the rendered version number and the recorded Instagram post ID. No `trials.json` writer exists on this base branch; this contract does not change a trial schema maintained by another branch.

Insights request `views,reach,likes,comments,shares,saved,ig_reels_avg_watch_time,ig_reels_video_view_total_time,reels_skip_rate` at `/<post-id>/insights`, with `period=lifetime`. `plays` retains the current `views` value because that is the v26.0 name. Watch times retain Meta's millisecond values. `reels_skip_rate` is Meta's estimated percentage of initial views skipped in the first three seconds, not an inferred retention score. Empty or omitted metrics remain `null`; zero stays zero. A malformed response or unreadable existing outcomes file fails without replacing the previous data.

## Meta dashboard setup

- Create or choose the Meta app and add the Instagram product with API setup using Instagram Login.
- Copy the Instagram App ID into the developer setting and store the Instagram App Secret only on the broker server.
- Register the broker's exact HTTPS `/api/instagram/oauth/callback` URI under Instagram business login settings.
- Configure deauthorization and data deletion callback URLs and the app's privacy policy URL.
- Add the owned Professional test accounts and required app roles for Standard Access testing.
- Request Advanced Access and complete App Review for the three permissions before serving accounts outside the app's roles.
- Complete any business verification requirements shown by Meta and select the supported API version for the app.
