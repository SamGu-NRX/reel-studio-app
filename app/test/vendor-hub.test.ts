// Finding CLIProxyAPI on this computer (main/vendor-hub.ts): its config in either layout, a running copy's --config,
// and the probe of /v1/models against a fake hub on a random port. No real config or key is read.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FakeHub } from '../../ai/test/fakeHub'
import { configsOfRunning, detectHub, hubConfigCandidates, parseHubConfig } from '../src/main/vendor-hub'

describe('reading CLIProxyAPI’s config', () => {
  it('the older layout: an empty host is this computer, and the api-keys list holds the client keys', () => {
    const c = parseHubConfig('host: ""\nport: 8411\napi-keys:\n  - "k-one"\n  - "k-two"\n', '/x/config.yaml')
    expect(c).toEqual({ file: '/x/config.yaml', origin: 'http://127.0.0.1:8411', keys: ['k-one', 'k-two'] })
  })

  it('the v8 layout: server and access sections, TLS, and the top-level api-keys map of upstream keys left out', () => {
    const yaml = 'server:\n  host: 0.0.0.0\n  port: 9443\n  tls:\n    enable: true\naccess:\n  api-keys:\n    - client-key\napi-keys:\n  claude:\n    - api-key: upstream-secret\n'
    expect(parseHubConfig(yaml, '/y')).toEqual({ file: '/y', origin: 'https://127.0.0.1:9443', keys: ['client-key'] })
  })

  it('not YAML, or a port that is not one: nothing', () => {
    expect(parseHubConfig('port: [', '/z')).toBeNull()
    expect(parseHubConfig('port: 70000', '/z')).toBeNull()
  })

  it('looks where Homebrew and the auth folder keep it, or only in the test folder', () => {
    expect(hubConfigCandidates({}, 'darwin', '/Users/p').slice(0, 3)).toEqual(['/opt/homebrew/etc/cliproxyapi.conf', '/usr/local/etc/cliproxyapi.conf', '/Users/p/.cli-proxy-api/config.yaml'])
    expect(hubConfigCandidates({ REELSTUDIO_TEST_HUB_CONFIG: '/t' }, 'darwin', '/Users/p')).toEqual(['/t/config.yaml', '/t/cliproxyapi.conf'])
    expect(hubConfigCandidates({ LOCALAPPDATA: 'C:\\Users\\p\\AppData\\Local' }, 'win32', 'C:\\Users\\p')).toContain('C:\\Users\\p\\.cli-proxy-api\\config.yaml')
  })

  it('a running copy’s --config, in either spelling; other programs are ignored', () => {
    const ps = ['/Users/p/build/bin/cliproxyapi-current --config /opt/homebrew/etc/cliproxyapi.conf', '/opt/homebrew/opt/cliproxyapi/bin/cliproxyapi -config=/srv/hub.yaml', 'vim --config /etc/not-this.yaml', 'cliproxyapi --config relative.yaml'].join('\n')
    expect(configsOfRunning(ps)).toEqual(['/opt/homebrew/etc/cliproxyapi.conf', '/srv/hub.yaml'])
  })
})

describe('finding the hub', () => {
  let hub: FakeHub
  let dir: string
  const asked: string[] = []
  const f = (u: string, i?: { headers?: Record<string, string>; signal?: AbortSignal }) => {
    asked.push(u)
    return fetch(u, i)
  }
  beforeEach(async () => {
    hub = new FakeHub()
    await hub.start()
    dir = mkdtempSync(join(tmpdir(), 'rs-hub-'))
    asked.length = 0
  })
  afterEach(async () => {
    await hub.stop()
  })

  it('ready with the config’s key: the count of models the picker will list, the file it came from, and the key kept for Use it', async () => {
    writeFileSync(join(dir, 'config.yaml'), `port: ${hub.port}\napi-keys:\n  - stale\n  - ${hub.key}\n`)
    const found = await detectHub({ env: { REELSTUDIO_TEST_HUB_CONFIG: dir }, platform: 'darwin', fetch: f, home: '/nobody' })
    expect(found).toEqual({ state: 'ready', origin: hub.origin, models: 5, keySource: join(dir, 'config.yaml'), key: hub.key })
  })

  it('answers but refuses every key in the config: asks for one, and says the config’s keys were refused', async () => {
    writeFileSync(join(dir, 'cliproxyapi.conf'), `port: ${hub.port}\napi-keys: [old-key]\n`)
    const found = await detectHub({ env: { REELSTUDIO_TEST_HUB_CONFIG: dir }, platform: 'darwin', fetch: f, home: '/nobody' })
    expect(found).toEqual({ state: 'needs-key', origin: hub.origin, keySource: join(dir, 'cliproxyapi.conf'), keyRefused: true })
  })

  it('no config in the test folder: none, and the real default port is never asked', async () => {
    const found = await detectHub({ env: { REELSTUDIO_TEST_HUB_CONFIG: dir }, platform: 'darwin', fetch: f, home: '/nobody', running: async () => ['/should/not/be/read'] })
    expect(found).toEqual({ state: 'none' })
    expect(asked).toEqual([])
  })
})
