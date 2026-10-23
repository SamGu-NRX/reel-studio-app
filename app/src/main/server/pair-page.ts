// The page a pairing link opens (server/index.ts). The code rides in the URL fragment, which browsers never send to
// a server or put in a Referer; the script posts it once, removes it from the address bar and history, and goes to
// the app. Plain text and the app's paper and ink colours, so it reads as Reel Studio for the second it is shown.

export const PAIR_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Reel Studio</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f7f5f1; color: #1d1b18;
         font: 16px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; }
  main { max-width: 26rem; padding: 2rem; text-align: center; }
  h1 { font-size: 1.25rem; margin: 0 0 .5rem; }
  p { margin: 0; color: #5b5750; }
</style>
</head>
<body>
<main>
  <h1 id="title">Opening Reel Studio…</h1>
  <p id="detail" role="status"></p>
</main>
<script src="/pair.js"></script>
</body>
</html>
`

export const PAIR_JS = `(() => {
  const code = new URLSearchParams(location.hash.slice(1)).get('code')
  history.replaceState(null, '', '/pair')
  const fail = (title, detail) => {
    document.getElementById('title').textContent = title
    document.getElementById('detail').textContent = detail
  }
  const again = 'In Reel Studio on this computer, choose File \\u203a Open in Browser to get a new link.'
  if (!code) return fail('This link is missing its code', again)
  fetch('/api/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }), credentials: 'same-origin' })
    .then((r) => (r.ok ? location.replace('/') : fail('This link has expired or was already used', again)))
    .catch(() => fail('Reel Studio is not running', 'Open Reel Studio on this computer, then choose File \\u203a Open in Browser.'))
})()
`
