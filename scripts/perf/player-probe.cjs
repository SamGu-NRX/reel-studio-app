// Injected before React loads. No application bundle is changed.
module.exports = function installPlayerProbe() {
  const s = (window.__playerPerf = { commits: 0, renderers: 0, frames: [], tasks: [], actions: [], raf: [], rafTimes: [], recording: false })
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true,
    inject() {
      return ++s.renderers
    },
    onCommitFiberRoot() {
      s.commits++
    },
    onCommitFiberUnmount() {},
    onPostCommitFiberRoot() {},
    checkDCE() {}
  }
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) s.tasks.push({ at: e.startTime, ms: e.duration })
  }).observe({ type: 'longtask', buffered: true })
  const attached = new WeakSet()
  const latestFrames = new WeakMap()
  let nextId = 0
  let action = null
  let monitor = false
  let scrub = null
  const covers = new Map()
  // The Reel screen's visible video. Both players give only the video on screen this test id.
  const main = () => document.querySelector('[data-testid="player"]')
  const visible = (v) => !!v && v.isConnected && Number(getComputedStyle(v).opacity) > 0
  function attach(v) {
    if (attached.has(v)) return
    attached.add(v)
    v.dataset.perfId = String(++nextId)
    const frame = (now, m) => {
      const row = { at: now, expected: m.expectedDisplayTime, media: m.mediaTime, presented: m.presentedFrames, processingMs: m.processingDuration * 1000, id: v.dataset.perfId, kind: v.dataset.testid ?? null }
      if (s.recording && v === main()) s.frames.push(row)
      if (scrub?.pending && v === main() && Math.abs(m.mediaTime - scrub.pending.target) < 0.1) {
        scrub.frames.push({ ...scrub.pending, ms: now - scrub.pending.at, media: m.mediaTime })
        scrub.pending = null
      }
      latestFrames.set(v, row)
      finishAction(now)
      if (v.isConnected) v.requestVideoFrameCallback(frame)
    }
    v.requestVideoFrameCallback(frame)
  }
  function finishAction(now) {
    if (!action || action.start === null) return
    const v = action.kind === 'hold' ? document.querySelector('[data-testid="original-video"]') : main()
    if (!v || v.seeking || !visible(v)) return
    const f = latestFrames.get(v)
    const changingSource = action.kind === 'switch' || action.kind === 'open'
    const matches = !action.expected || decodeURIComponent(v.currentSrc || v.src).includes(action.expected)
    if (!matches) return
    const posterReady = changingSource && !!v.poster && v.readyState < 2 && covers.get(v.poster) === true
    const frameReady = !!f && v.readyState >= 2 && f.at >= (changingSource ? 0 : action.start) && Math.abs(f.media - v.currentTime) < 0.1
    const changed = changingSource ? posterReady || frameReady : frameReady && (action.kind === 'hold' || Math.abs(f.media - action.media) > 0.001)
    if (!changed) return
    const end = performance.now()
    s.actions.push({ ...action, end, ms: end - action.start, mediaAfter: f?.media ?? null, src: v.currentSrc || v.src, pictureKind: posterReady ? 'poster' : 'video', opacity: Number(getComputedStyle(v).opacity) })
    action = null
  }
  const observe = () => {
    document.querySelectorAll('video').forEach((v) => {
      attach(v)
      if (!v.poster || covers.has(v.poster)) return
      const image = new Image()
      covers.set(v.poster, false)
      image.src = v.poster
      image.decode().then(() => covers.set(v.poster, true)).catch(() => {})
    })
  }
  new MutationObserver(observe).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['poster', 'src'] })
  for (const type of ['click', 'pointerdown', 'input', 'keydown']) {
    document.addEventListener(
      type,
      (e) => {
        if (scrub && type === 'input' && e.target.matches?.('input[aria-label="Position in the video"]')) {
          if (scrub.pending) scrub.coalesced++
          scrub.inputs++
          scrub.pending = { at: performance.now(), target: Number(e.target.value) }
        }
        if (!action || action.event !== type || !e.target.closest?.(action.selector)) return
        action.start = performance.now()
        action.wallStart = Date.now()
        action.media = main()?.currentTime ?? 0
      },
      true
    )
  }
  const tick = (now) => {
    if (s.recording) s.rafTimes.push(now)
    finishAction(now)
    if (monitor) {
      // Every visible video in the phone, top to bottom: a frame is blank when none of them has a picture.
      const shown = [...document.querySelectorAll('.phone-screen video')].filter(visible)
      const pictured = shown.filter((v) => v.readyState >= 2 || (v.poster && covers.get(v.poster) === true))
      const v = main()
      s.raf.push({ at: now, id: v?.dataset.perfId ?? null, ready: v?.readyState ?? -1, shown: shown.length, pictured: pictured.length, videos: document.querySelectorAll('.phone-screen video').length })
    }
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
  s.arm = (kind, selector, event = 'click', expected = null) => {
    if (action) s.actions.push({ ...action, error: 'superseded before a changed frame' })
    action = { kind, selector, event, expected, start: null, armed: performance.now(), media: main()?.currentTime ?? 0 }
    monitor = kind === 'switch'
    if (monitor) s.raf = []
  }
  s.beginPlayback = () => {
    s.frames = []
    s.tasks = []
    s.rafTimes = []
    s.recording = true
  }
  s.endPlayback = () => {
    s.recording = false
  }
  s.action = () => action
  s.expireAction = () => {
    const value = { ...action, ms: null, unavailable: 'No qualifying picture within the timeout' }
    s.actions.push(value)
    action = null
    monitor = false
    return value
  }
  s.beginScrub = () => {
    scrub = { inputs: 0, coalesced: 0, frames: [], pending: null }
  }
  s.scrub = () => scrub
  s.endScrub = () => {
    const value = scrub
    scrub = null
    return value
  }
  s.stopMonitor = () => {
    monitor = false
    return s.raf
  }
  s.snapshot = () => ({
    at: performance.now(),
    commits: s.commits,
    renderers: s.renderers,
    videos: [...document.querySelectorAll('video')].map((v) => {
      const q = v.getVideoPlaybackQuality()
      return { id: v.dataset.perfId, testid: v.dataset.testid ?? null, src: v.currentSrc, hasSrc: v.hasAttribute('src'), ready: v.readyState, paused: v.paused, width: v.videoWidth, quality: { total: q.totalVideoFrames, dropped: q.droppedVideoFrames } }
    }),
    heap: performance.memory ? { used: performance.memory.usedJSHeapSize, total: performance.memory.totalJSHeapSize } : null
  })
}
