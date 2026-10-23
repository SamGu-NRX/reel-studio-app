// A harness runs one agent task: it turns the model's tool calls into executeTool calls on the
// task's ToolContext and returns the results to the model. `loop` is our own loop (agent.ts) over
// any ModelProvider; `claude-code` lets `claude -p` call the tools natively over MCP (mcp/claudeCode.ts).
import { AgentEvent, ImagePart, ModelProvider } from './types';
import { runAgent, RunAgentResult } from './agent';
import type { ToolContext } from './tools';

export interface HarnessRun {
  system: string;
  task: string;
  taskImages?: ImagePart[];
  /** the note's context: the only project this run can touch */
  ctx: ToolContext;
  /** allowlist of tool names, checked on every call */
  tools: string[];
  maxSteps: number;
  tokenBudget?: number;
  /** read-only tools run before the first model turn, their results appended to the task */
  preload?: string[];
  maxMisses?: number;
  onEvent: (e: AgentEvent) => void;
  signal?: AbortSignal;
}

export interface Harness {
  readonly id: 'loop' | 'claude-code';
  readonly supportsImages: boolean;
  run(o: HarnessRun): Promise<RunAgentResult>;
}

export function loopHarness(provider: ModelProvider): Harness {
  return {
    id: 'loop',
    supportsImages: provider.supportsImages,
    run: (o) => runAgent({ provider, ...o }),
  };
}
