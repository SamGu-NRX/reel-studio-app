# Broker regression evidence

All 21 tests passed after restoring the implementation. Each row below was also run alone after removing or changing its corresponding behavior; every mutation failed at an assertion. These are observed regression mutations, not a claim that all tests were written before implementation. The suite ran from this package after its own `npm ci --ignore-scripts`, with at most two Vitest workers. No live platform or object-store request was made. The execution host used Node 26.5.0; Vercel Node 22 remains a hosted verification step.

| Test | Observed failure with behavior removed |
| --- | --- |
| exchanges and refreshes Instagram without using the platform token as broker auth | `AssertionError: expected undefined to be 'ig-refreshed' // Object.is equality` |
| exchanges and refreshes TikTok | `AssertionError: expected undefined to be 'tt-refreshed' // Object.is equality` |
| rejects a loopback redirect outside the allowlist | `AssertionError: expected 200 to be 400 // Object.is equality` |
| requires the issued install token and returns per-object short-lived PUT URLs | `AssertionError: expected 200 to be 401 // Object.is equality` |
| rate limits starts by install or client identity | `AssertionError: expected 200 to be 429 // Object.is equality` |
| deletes token records and staged objects on Meta data deletion | `AssertionError: expected 200 to be 401 // Object.is equality` |
| consumes a proof-bound handoff once under concurrent redemption | `AssertionError: expected [ 200, 200 ] to deeply equal [ 200, 401 ]` |
| expires a handoff after sixty seconds and never redirects unknown state | `AssertionError: expected 200 to be 401 // Object.is equality` |
| passes TikTok PKCE and opaque codes exactly once with the server secret | `AssertionError: expected 'broken-code' to be 'a+b/%2F?=&' // Object.is equality` |
| requires independent install proof for both platform refresh routes | `AssertionError: expected 200 to be 401 // Object.is equality` |
| revokes an install credential independently of the platform token | `AssertionError: expected 200 to be 401 // Object.is equality` |
| limits uploads by install without blocking a separate OAuth install | `AssertionError: expected 200 to be 429 // Object.is equality` |
| rejects both platform redirect bypasses before any exchange | `AssertionError: expected 200 to be 400 // Object.is equality` |
| rejects oversized media reservations and emits no storage grants | `AssertionError: expected 200 to be 400 // Object.is equality` |
| rejects forged and stale Meta deletion requests | `AssertionError: expected 200 to be 401 // Object.is equality` |
| authenticates TikTok deauthorization over the exact body and revokes refresh records | `AssertionError: expected [ …(2) ] to deeply equal []` |
| keeps replay cleanup until PUT expiry and returns one receipt for concurrent deletion | `AssertionError: expected 'complete' to be 'pending' // Object.is equality` |
| revokes credentials even if storage deletion fails and retries the media later | `AssertionError: expected 200 to be 401 // Object.is equality` |
| rejects oversized bodies and protects cleanup with its own secret | `AssertionError: expected 400 to be 413 // Object.is equality` |
| signs only one S3 object, exact PUT headers and a ten-minute GET lifetime without network | `AssertionError: expected '1200' to be '600' // Object.is equality` |
| encrypts transient platform tokens and rejects ciphertext or record-key tampering | `AssertionError: expected [Function] to throw an error` |

`npm run typecheck` passed. The tests use an in-memory transactional store in place of PostgreSQL. Real transaction locking, TLS configuration, provider signature enforcement and Vercel routing/cron have not been exercised against hosted services.
