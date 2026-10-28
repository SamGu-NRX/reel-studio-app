import { expect, it } from 'vitest'
import { styleEmptyLine } from '../src/renderer/src/screens/style-words'

// fails if My style's empty screen offers Final Cut Pro on Windows, where it doesn't exist, or drops it on a Mac
it('names Final Cut Pro only on a Mac, and Premiere Pro everywhere', () => {
  expect(styleEmptyLine(true)).toMatch(/edits you made in Final Cut Pro or Premiere Pro\.$/)
  expect(styleEmptyLine(false)).toMatch(/edits you made in Premiere Pro\.$/)
  expect(styleEmptyLine(false)).not.toContain('Final Cut')
})
