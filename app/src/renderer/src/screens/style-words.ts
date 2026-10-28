// My style's empty screen line. Keep free of DOM imports: test/style-words.test.ts runs it in Node.

/**
 * How to fill My style. Learning from past edits reads Final Cut Pro's FCPXML and Premiere Pro's XML exports, and
 * Final Cut Pro is a Mac app, so elsewhere the line names Premiere Pro alone.
 */
export function styleEmptyLine(isMac: boolean): string {
  const editors = isMac ? 'Final Cut Pro or Premiere Pro' : 'Premiere Pro'
  return `Start a note with “always”, like “always use big subtitles”, and say Yes when you’re asked to remember it. Or learn from edits you made in ${editors}.`
}
