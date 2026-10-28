// One polite status line for changes a person makes without a visible message: the playback speed and the phone
// shape, picked from a menu or set with a key. It sits outside the page (data-over-dialogs), so a dialog or the
// full-screen stage making the page inert does not silence it.
// Made when this module loads, long before its first words: a live region added and filled at once is often not read.
const line = document.createElement('div')
line.className = 'sr-only'
line.setAttribute('role', 'status')
line.setAttribute('data-over-dialogs', '')
line.dataset.testid = 'announce'
document.body.append(line)
let timer = 0

export function announce(text: string): void {
  // cleared first, so the same words said twice (2x, then 2x again at the end of the list) are read twice. 100 ms is
  // the gap commonly used for screen readers to see the change; it was not measured here.
  line.textContent = ''
  window.clearTimeout(timer)
  timer = window.setTimeout(() => (line.textContent = text), 100)
}
