import { describe, it, expect } from 'vitest'
import { findRelevantChunksLocal } from '@/lib/rag'
import type { Document, Source } from '@/types'

/**
 * Minimal retrieval evaluation harness
 *
 * Metrics:
 * - Precision@k
 * - Recall@k
 * - MRR (Mean Reciprocal Rank)
 *
 * This test is deterministic, uses a tiny in-memory corpus, and does NOT hit Azure.
 * It is intended as a guardrail/diagnostic, not a benchmark for production-scale quality.
 */

interface EvalDocDef {
  id: string
  name: string
  chunks: string[]
}

interface EvalQuery {
  id: string
  query: string
  goldChunkIds: string[]
}

const docsDef: EvalDocDef[] = [
  {
    id: 'arch',
    name: 'architecture.md',
    chunks: [
      'Retrieval-Augmented Generation (RAG) combines search with generation to ground answers.',
      'The system uses Azure AI Search hybrid retrieval plus local fallback.',
      'Token tracking is implemented via a centralized service.'
    ]
  },
  {
    id: 'safety',
    name: 'safety.md',
    chunks: [
      'Prompt injection attacks attempt to override system instructions using untrusted context.',
      'Queries are sanitized and PII is redacted before logging.'
    ]
  },
  {
    id: 'other',
    name: 'unrelated.txt',
    chunks: [
      'This document describes front-end components unrelated to RAG.',
      'It mentions buttons, forms, and layout grids.'
    ]
  }
]

/**
 * Build a small in-memory Document[] corpus compatible with findRelevantChunksLocal.
 */
function buildEvalDocuments(): Document[] {
  return docsDef.map(def => {
    const chunks = def.chunks.map((content, idx) => ({
      id: `${def.id}-chunk-${idx}`,
      documentId: def.id,
      chunkIndex: idx,
      content
    }))
    return {
      id: def.id,
      name: def.name,
      size: 0,
      uploadedAt: new Date().toISOString(),
      type: 'text/plain',
      processed: true,
      processingStatus: 'completed',
      chunks,
      source: 'upload'
    } as Document
  })
}

/**
 * Tiny labeled eval set.
 * goldChunkIds reference the ids we assigned in buildEvalDocuments.
 */
const evalQueries: EvalQuery[] = [
  {
    id: 'q1',
    query: 'What is Retrieval-Augmented Generation and how is it implemented here?',
    goldChunkIds: ['arch-chunk-0', 'arch-chunk-1']
  },
  {
    id: 'q2',
    query: 'How does the system defend against prompt injection?',
    goldChunkIds: ['safety-chunk-0']
  },
  {
    id: 'q3',
    query: 'Where is token tracking implemented?',
    goldChunkIds: ['arch-chunk-2']
  }
]

function precisionAtK(retrieved: Source[], gold: Set<string>, k: number): number {
  const topK = retrieved.slice(0, k)
  if (topK.length === 0) return 0
  const hits = topK.filter(s => gold.has(s.chunkId)).length
  return hits / topK.length
}

function recallAtK(retrieved: Source[], gold: Set<string>, k: number): number {
  const topK = retrieved.slice(0, k)
  if (gold.size === 0) return 0
  const hits = topK.filter(s => gold.has(s.chunkId)).length
  return hits / gold.size
}

function reciprocalRank(retrieved: Source[], gold: Set<string>): number {
  for (let i = 0; i < retrieved.length; i++) {
    if (gold.has(retrieved[i].chunkId)) {
      return 1 / (i + 1)
    }
  }
  return 0
}

describe('Retrieval Evaluation Harness (local only)', () => {
  const documents = buildEvalDocuments()
  const K = 5

  it('computes Precision@k, Recall@k, and MRR over a small labeled set', async () => {
    let sumPAtK = 0
    let sumRAtK = 0
    let sumRR = 0

    for (const q of evalQueries) {
      const gold = new Set(q.goldChunkIds)

      // Local hybrid retrieval; no Azure calls
      const retrieved = await findRelevantChunksLocal(q.query, documents, K, 'hybrid')

      // Basic sanity: harness should return something
      expect(Array.isArray(retrieved)).toBe(true)

      const pAtK = precisionAtK(retrieved, gold, K)
      const rAtK = recallAtK(retrieved, gold, K)
      const rr = reciprocalRank(retrieved, gold)

      sumPAtK += pAtK
      sumRAtK += rAtK
      sumRR += rr
    }

    const n = evalQueries.length
    const meanPAtK = sumPAtK / n
    const meanRAtK = sumRAtK / n
    const meanMRR = sumRR / n

    // Soft thresholds: these are not strict correctness checks, but guardrails.
    // Adjust if your retrieval implementation changes.
    expect(meanPAtK).toBeGreaterThan(0)
    expect(meanRAtK).toBeGreaterThan(0)
    expect(meanMRR).toBeGreaterThan(0)

    // Log summary so it appears in CI output for quick inspection.
     
    console.log('[retrieval-eval] mean@', {
      K,
      precision: Number(meanPAtK.toFixed(3)),
      recall: Number(meanRAtK.toFixed(3)),
      mrr: Number(meanMRR.toFixed(3))
    })
  })
})