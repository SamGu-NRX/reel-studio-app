// Which edit of the sample the person last saw in the first run, so the sample card on Reels plays the same one.
const KEY = 'rs.sample-upgraded'

/** An editor was connected during the first run: the sample ends on its version. */
export function rememberSample(upgraded: boolean): void {
  localStorage.setItem(KEY, upgraded ? '1' : '0')
}

export const sampleUpgraded = (): boolean => localStorage.getItem(KEY) === '1'
