import type { Source } from '@/types'

export interface DriftInfo {
  stale?: boolean
  sourceMismatch?: boolean
  reasons: string[]
}

export interface DriftSummary {
  driftDetected: boolean
  reasons: string[]
  affectedSourceCount: number
}

export interface DriftContext {
  namespace: string
}

/**
 * Minimal metadata-based drift detection
 * Non-blocking, observability-only
 *
 * Currently a no-op placeholder until Source carries sufficient metadata.
 * Safe to wire into retrieval path without affecting behavior.
 */
export function detectDrift(
  sources: Source[],
  _context: DriftContext
): {
  annotatedSources: Array<Source & { driftInfo?: DriftInfo }>
  summary: DriftSummary
} {
  // Placeholder implementation - safe as no-op
  // Future: check namespace_id, timestamps, staleness when metadata is available
  return {
    annotatedSources: sources,
    summary: {
      driftDetected: false,
      reasons: [],
      affectedSourceCount: 0
    }
  }
}