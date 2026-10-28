import { expect, it } from 'vitest'
import { styleEmptyLine } from '../src/renderer/src/screens/style-words'
import { learnPicker } from '../src/shared/style-editors'

// fails if My style's empty screen offers Final Cut Pro on Windows, where it doesn't exist, or drops it on a Mac
it('names Final Cut Pro only on a Mac, and Premiere Pro everywhere', () => {
  expect(styleEmptyLine(true)).toMatch(/edits you made in Final Cut Pro or Premiere Pro\.$/)
  expect(styleEmptyLine(false)).toMatch(/edits you made in Premiere Pro\.$/)
  expect(styleEmptyLine(false)).not.toContain('Final Cut')
})

// fails if the Windows file picker for learning from past edits asks for Final Cut Pro exports
it('titles the learn-from-edits picker with the editors this computer can have', () => {
  expect(learnPicker(true)).toEqual({ title: 'Choose exports from Final Cut Pro or Premiere Pro', filter: 'Final Cut Pro or Premiere Pro exports' })
  expect(learnPicker(false)).toEqual({ title: 'Choose exports from Premiere Pro', filter: 'Premiere Pro exports' })
})
