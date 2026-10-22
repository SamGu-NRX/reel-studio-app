// The cover picker's scan runs beside a job on the same project and joins it with the job's owner token
// (index.ts projects:coverCandidates): the token must be the one in the project's lock while it is held.
import { expect, it } from 'vitest'
import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createJobManager } from '../src/main/jobs'
import { projectDir } from '../src/main/store'
import { setupPaths } from './helpers'

it('fails if ownerToken is not the token in the lock while a project is held, or outlives it', async () => {
  setupPaths()
  const slug = 'scan-joins'
  mkdirSync(projectDir(slug), { recursive: true })
  const jobs = createJobManager(() => undefined, () => undefined)
  expect(jobs.ownerToken(slug)).toBeNull()
  let during: string | null = null
  let lock: { token?: string } = {}
  await jobs.hold(slug, async () => {
    during = jobs.ownerToken(slug)
    lock = JSON.parse(readFileSync(join(projectDir(slug), 'work', '.owner.lock'), 'utf8'))
  })
  expect(during).toBe(lock.token)
  expect(during).toBeTruthy()
  expect(jobs.ownerToken(slug)).toBeNull()
})
