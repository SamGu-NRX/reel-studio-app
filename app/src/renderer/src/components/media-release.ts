type ReleasableVideo = {
  pause: () => void
  removeAttribute: (name: string) => void
  load: () => void
}

/** Release Chromium's media player before a video element is discarded. */
export function releaseVideo(v: ReleasableVideo): void {
  v.pause()
  v.removeAttribute('src')
  v.load()
}
