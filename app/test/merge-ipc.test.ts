import { expect, it, vi } from 'vitest'
import type { ReelApi } from '../src/shared/api'

const bridge = vi.hoisted(() => ({ api: null as ReelApi | null, invoke: vi.fn() }))
vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: (_name: string, api: ReelApi) => { bridge.api = api } },
  ipcRenderer: { invoke: bridge.invoke },
  webUtils: {}
}))
import '../src/preload/index'

it('passes explicit merge choices through the renderer bridge and returns the job receipt', async () => {
  const request = { ours: 2, theirs: 1, take: { cut: 'ours', captions: 'theirs', music: 'ours', zooms: 'ours', broll: 'ours', sfx: 'ours', cover: 'ours' } } as const
  bridge.invoke.mockResolvedValue({ ok: true, value: { jobId: 'merge-job' } })
  expect(await bridge.api!.projects.mergeVersions('bread', request)).toEqual({ jobId: 'merge-job' })
  expect(bridge.invoke).toHaveBeenCalledWith('projects:mergeVersions', 'bread', request)
})
