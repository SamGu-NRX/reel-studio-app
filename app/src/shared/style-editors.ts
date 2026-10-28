// The editors whose exports My style can learn from. Keep free of Node and DOM imports: main and the renderer share it.

/** Final Cut Pro's FCPXML and Premiere Pro's XML; Final Cut Pro is a Mac app, so elsewhere Premiere Pro is named alone. */
export const styleEditors = (isMac: boolean): string => (isMac ? 'Final Cut Pro or Premiere Pro' : 'Premiere Pro')

/** The file picker that learns from past edits: its title and its file-type name. */
export function learnPicker(isMac: boolean): { title: string; filter: string } {
  const editors = styleEditors(isMac)
  return { title: `Choose exports from ${editors}`, filter: `${editors} exports` }
}
