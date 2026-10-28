// My style's empty screen line. Keep free of DOM imports: test/style-words.test.ts runs it in Node.
import { styleEditors } from '../../../shared/style-editors'

/** How to fill My style: a note that starts with "always", or the editors learning from past edits reads. */
export function styleEmptyLine(isMac: boolean): string {
  const editors = styleEditors(isMac)
  return `Start a note with “always”, like “always use big subtitles”, and say Yes when you’re asked to remember it. Or learn from edits you made in ${editors}.`
}
