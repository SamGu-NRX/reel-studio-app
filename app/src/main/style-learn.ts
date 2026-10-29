// "Learn from my past edits": each export through the engine's import-reference, then shared/learn-style.ts.
// Nothing here writes My style; the person keeps the rules they want (style:keepLearned).
import { basename } from 'node:path'
import type { StyleLesson } from '../shared/api'
import { editorOf, learnStyle, type ImportRecord } from '../shared/learn-style'

/** The engine's import record, checked where it comes in: a different shape is a bug in one of the two sides. */
function asRecord(x: unknown, file: string): ImportRecord {
  const r = x as Partial<ImportRecord> | null
  if (!r || (r.source?.adapter !== 'fcpx_xml' && r.source?.adapter !== 'fcp_xml') || !Array.isArray(r.timelines)) {
    throw new Error(`import-reference returned no timelines record for ${file}`)
  }
  return r as ImportRecord
}

export async function readLesson(
  files: string[],
  importReference: (file: string) => Promise<unknown>,
  onProgress?: (p: { done: number; total: number }) => void
): Promise<StyleLesson> {
  const records: ImportRecord[] = []
  const read: StyleLesson['files'] = []
  const skipped: StyleLesson['skipped'] = []
  for (const [done, file] of files.entries()) {
    onProgress?.({ done, total: files.length })
    try {
      const record = asRecord(await importReference(file), file)
      records.push(record)
      read.push({ path: file, name: basename(file), editor: editorOf(record) })
    } catch (e) {
      const reason = (e as { userMessage?: unknown })?.userMessage
      if (typeof reason !== 'string') throw e
      skipped.push({ name: basename(file), reason })
    }
  }
  const lesson = learnStyle(records)
  return { files: read, timelines: lesson.timelines, shots: lesson.shots, rules: lesson.rules, skipped }
}
