import { insightsOptions, insightsSummary } from './insights'

type Handle = (channel: string, fn: (event: unknown, ...args: unknown[]) => unknown) => void
export function registerInsightsIpc(d: { handle: Handle; projectsRoot: () => string; now?: () => number }): void {
  d.handle('insights:get', (_event, value) => {
    const options = insightsOptions(value)
    return insightsSummary(d.projectsRoot(), { ...options, asOf: options.asOf ?? new Date((d.now ?? Date.now)()).toISOString() })
  })
}
