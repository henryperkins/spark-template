import type { QueryExecutionContext } from './agent-context'

/**
 * Minimal active-context registry to enable services (like LLMService)
 * to record token/cost usage against the current orchestrator run without
 * threading context through every call site.
 *
 * Note: This is a simple module-level holder intended for single-run UI flows.
 * If you introduce concurrency across multiple independent runs, consider
 * swapping for a more robust per-run scoping mechanism.
 */
let activeContext: QueryExecutionContext | null = null

export function setActiveQueryContext(ctx: QueryExecutionContext | null): void {
  activeContext = ctx
}

export function getActiveQueryContext(): QueryExecutionContext | null {
  return activeContext
}

