import { expect, it } from 'vitest'
import { initialUpdateState, type UpdateMode, type UpdateState } from '../src/shared/update'
import { aboutButton, shortVersion, updateButtonLabel, updateIcon, updateSubline, updateSummary } from '../src/renderer/src/components/update-copy'

const offered = (mode: UpdateMode, patch: Partial<UpdateState> = {}): UpdateState => ({
  ...initialUpdateState('0.1.2', mode, true, null),
  status: 'available',
  availableVersion: '0.1.3',
  ...patch
})

it('fails if page mode promises a download, or install mode stops offering one', () => {
  const rejected = offered('page', {
    status: 'error',
    errorContext: 'download',
    message: 'The downloaded update did not pass its check, so it was not installed. Get Reel Studio 0.1.3 from its download page instead.'
  })
  for (const s of [offered('page'), rejected]) {
    expect(updateButtonLabel(s)).toBe('Open download page')
    expect(aboutButton(s)).toBe('Open download page')
    expect(updateIcon(s)).toBe('available')
    // the sidebar's second line only names the version; the tooltip and summary say where the click goes
    expect(updateSummary(s)).toContain('download page')
    for (const line of [updateSummary(s), updateSubline(s)]) expect(line).not.toMatch(/Download update|try again/i)
  }
  expect(updateButtonLabel(offered('install'))).toBe('Download update')
  expect(aboutButton(offered('install'))).toBe('Download')
  expect(updateSummary(offered('install'))).toBe('Reel Studio 0.1.3 is ready to download.')
})

// Sam's nightly (notes/design/r12/sam-1028/4-update-popover-sidebar-overflow.png): the sidebar line ran across the page
it('fails if a nightly version is too long for the sidebar, or a stable one is changed', () => {
  const nightly = offered('page', { availableVersion: '0.1.3-nightly.20261028.9' })
  expect(updateSubline(nightly)).toBe('Nightly Oct 28, build 9')
  expect(updateSummary(nightly)).toContain('0.1.3-nightly.20261028.9')
  expect(updateSubline(offered('install'))).toBe('Reel Studio 0.1.3')
  // not a real date: shown as it is rather than guessed
  expect(shortVersion('0.1.3-nightly.20261328.9')).toBe('Reel Studio 0.1.3-nightly.20261328.9')
})
