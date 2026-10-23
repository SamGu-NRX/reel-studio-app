import { expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

for (const [keep, fail, reporter] of [['0', false, true], ['1', false, true], ['0', true, true], ['0', true, false]] as const) {
  it(`fails if a run's files outlive it, passed or failed, unless KEEP_E2E_TMP=1 (keep=${keep}, fail=${fail}, cleanup reporter=${reporter})`, () => {
    const dir = mkdtempSync(resolve(__dirname, '../e2e-cleanup-'))
    const config = join(dir, 'playwright.config.ts')
    let base: string | undefined
    try {
      writeFileSync(config, `export default { testDir: '.', outputDir: './results', workers: 1, reporter: [['list']${reporter ? ", ['../e2e/cleanup-reporter.ts']" : ''}] }`)
      writeFileSync(join(dir, 'a-pass.spec.ts'), `
        import { test } from '@playwright/test'
        import '../e2e/helpers'
        test('earlier spec in the same worker', () => {})
      `)
      writeFileSync(join(dir, 'cleanup.spec.ts'), `
        import { test, expect } from '@playwright/test'
        import { writeFileSync } from 'node:fs'
        import { join } from 'node:path'
        import { BASE } from '../e2e/helpers'
        test.beforeAll(() => {
          console.log('BASE=' + BASE)
          writeFileSync(join(BASE, 'main.log'), 'debug evidence')
          expect(${fail}).toBe(false)
        })
        test('cleanup', () => {})
      `)
      const result = spawnSync(process.execPath, [require.resolve('@playwright/test/cli'), 'test', '-c', config], {
        cwd: dir, env: { ...process.env, KEEP_E2E_TMP: keep, TMPDIR: dir, TMP: dir, TEMP: dir }, encoding: 'utf8'
      })
      base = result.stdout.match(/BASE=(.+)/)?.[1].trim()
      expect(result.status, result.stdout + result.stderr).toBe(fail ? 1 : 0)
      expect(base).toBeDefined()
      if (!base) throw new Error('test worker did not report its temp folder')
      const retained = keep === '1'
      expect(existsSync(base)).toBe(retained)
      if (retained) {
        expect(readFileSync(join(base, 'main.log'), 'utf8')).toBe('debug evidence')
        expect(result.stdout).toContain('Kept e2e files: ')
      }
    } finally {
      if (base) rmSync(base, { recursive: true, force: true })
      rmSync(dir, { recursive: true, force: true })
    }
  })
}
