import { marked } from 'marked'
import { AgenticOrchestrator } from '../src/lib/agents/orchestrator'
import type { Document } from '../src/types'
import { cacheManager } from '../src/lib/cache-manager'
import { v4 as uuidv4 } from 'uuid'

// Ensure crypto API is available (Node provides webcrypto)
import { webcrypto as nodeCrypto } from 'node:crypto'

if (!globalThis.crypto) {
  // @ts-ignore
  globalThis.crypto = nodeCrypto
}

const kvStore = new Map<string, any>()
const localStorageStore = new Map<string, string>()

const llmCallLog: Array<{ tag: string; snippet: string }> = []
let criticCallCount = 0

const kv = {
  async keys(): Promise<string[]> {
    return Array.from(kvStore.keys())
  },
  async get(key: string): Promise<any> {
    return kvStore.get(key)
  },
  async set(key: string, value: any): Promise<void> {
    kvStore.set(key, value)
  },
  async delete(key: string): Promise<void> {
    kvStore.delete(key)
  }
}

const sparkStub = {
  llmPrompt(strings: TemplateStringsArray, ...values: any[]): string {
    let combined = ''
    for (let i = 0; i < strings.length; i++) {
      combined += strings[i]
      if (i < values.length) {
        combined += values[i]
      }
    }
    return combined
  },
  async llm(prompt: string): Promise<string> {
    const normalized = prompt.toLowerCase()
    const snippet = prompt.replace(/\s+/g, ' ').slice(0, 120)

    const record = (tag: string) => {
      llmCallLog.push({ tag, snippet })
    }

    if (normalized.includes('query classification expert')) {
      record('query-classifier')
      return JSON.stringify({
        complexity: 'complex',
        reasoning: 'Test stub: complex multi-part question',
        recommendedStrategy: 'planned',
        requiresDecomposition: true,
        estimatedSubQueries: 2
      })
    }

    if (normalized.includes('query planning expert')) {
      record('query-planner')
      return JSON.stringify({
        subQueries: [
          {
            id: 'sub-1',
            query: 'What is the Spark agentic RAG architecture?',
            purpose: 'Understand core components',
            priority: 1
          },
          {
            id: 'sub-2',
            query: 'How does Spark orchestrate agents for retrieval?',
            purpose: 'Assess workflow behaviour',
            priority: 2
          }
        ],
        executionStrategy: 'sequential',
        reasoning: 'Later sub-query builds on architecture overview'
      })
    }

    if (normalized.includes('retrieval strategy expert')) {
      record('routing-agent')
      return JSON.stringify({
        strategy: 'hybrid',
        reasoning: 'Mix of conceptual and specific terms in query',
        confidence: 0.82
      })
    }

    if (normalized.includes('fact-checking expert')) {
      record('critic-agent')
      criticCallCount += 1
      if (criticCallCount === 1) {
        return JSON.stringify({
          isValid: false,
          confidence: 0.55,
          issues: ['Add explicit source citations for architecture details'],
          suggestions: ['Cite [1] after describing orchestrator flow'],
          faithfulnessScore: 0.62,
          relevanceScore: 0.68
        })
      }
      return JSON.stringify({
        isValid: true,
        confidence: 0.88,
        issues: [],
        suggestions: [],
        faithfulnessScore: 0.85,
        relevanceScore: 0.82
      })
    }

    if (normalized.includes('analyzing a response to improve it')) {
      record('react-thought')
      return 'Focus on citing the retrieval path using source [1].'
    }

    if (normalized.includes('refining an ai response based on validation feedback')) {
      record('react-refine')
      return 'The Spark orchestrator coordinates classifier, planner, router, and critic agents within the RAG pipeline [1].'
    }

    if (normalized.includes('based on the user\'s question and the retrieved context')) {
      record('expansion-context')
      return JSON.stringify({
        questions: [
          {
            question: 'What quality checks does the critic agent perform?',
            reasoning: 'Critic validation is referenced in context',
            category: 'deeper',
            relevanceScore: 0.86
          },
          {
            question: 'How can the workflow adapt to missing Azure services?',
            reasoning: 'Context mentions Azure fallbacks',
            category: 'related',
            relevanceScore: 0.81
          },
          {
            question: 'Which documents feed the retrieval cache?',
            reasoning: 'Clarifies ingestion paths',
            category: 'clarification',
            relevanceScore: 0.78
          },
          {
            question: 'What observability hooks capture agent metrics?',
            reasoning: 'Expands to analytics layer',
            category: 'broader',
            relevanceScore: 0.73
          }
        ]
      })
    }

    if (normalized.includes('based on the user\'s question and the available knowledge base topics')) {
      record('expansion-doc-topics')
      return JSON.stringify({
        questions: [
          {
            question: 'Which knowledge base topics map to each Spark agent?',
            reasoning: 'Connects orchestration stages to stored content',
            category: 'clarification',
            relevanceScore: 0.79
          },
          {
            question: 'How frequently should Spark refresh indexed documents?',
            reasoning: 'Relates to knowledge base maintenance',
            category: 'deeper',
            relevanceScore: 0.76
          },
          {
            question: 'What documents describe Azure fallback behaviour?',
            reasoning: 'Highlights coverage gaps in topics',
            category: 'related',
            relevanceScore: 0.74
          },
          {
            question: 'Where are observability patterns documented for Spark agents?',
            reasoning: 'Broaden to operational guidance',
            category: 'broader',
            relevanceScore: 0.71
          }
        ]
      })
    }

    if (normalized.includes('based on the user\'s question, suggest 4 related questions')) {
      record('expansion-generic')
      return JSON.stringify({
        questions: [
          {
            question: 'What telemetry events does Spark emit per agent step?',
            reasoning: 'Helps understand analytics workflow',
            category: 'related',
            relevanceScore: 0.8
          },
          {
            question: 'How are UUIDs used to correlate orchestrator runs?',
            reasoning: 'Connects to persistence layer',
            category: 'deeper',
            relevanceScore: 0.77
          },
          {
            question: 'What is the fallback behaviour when Azure services are disabled?',
            reasoning: 'Explores alternative execution paths',
            category: 'clarification',
            relevanceScore: 0.74
          },
          {
            question: 'How can the markdown renderer be extended for custom blocks?',
            reasoning: 'Broadens to presentation layer',
            category: 'broader',
            relevanceScore: 0.72
          }
        ]
      })
    }

    if (normalized.includes('analyze the following document excerpts and identify 5-7 main topics or themes')) {
      record('expansion-topics')
      return JSON.stringify({
        topics: ['agent orchestration', 'azure fallback', 'telemetry pipeline']
      })
    }

    if (normalized.includes('you are a helpful research assistant')) {
      record('rag-response')
      return 'Spark orchestrates classifier, planner, router, and critic agents to answer questions with contextual citations [1].'
    }

    record('default')
    return JSON.stringify({ result: 'stub-response' })
  },
  telemetry: {
    track(_event: string, _payload: unknown) {
      // no-op for test
    }
  },
  analytics: {
    track(_event: string, _payload: unknown) {
      // no-op
    }
  },
  analyticsClient: {
    capture(_event: string, _payload: unknown) {
      // no-op
    }
  },
  kv,
  endpoint: null
}

const windowStub: any = {
  spark: sparkStub,
  localStorage: {
    getItem(key: string) {
      return localStorageStore.has(key) ? localStorageStore.get(key)! : null
    },
    setItem(key: string, value: string) {
      localStorageStore.set(key, String(value))
    },
    removeItem(key: string) {
      localStorageStore.delete(key)
    }
  },
  location: {
    origin: 'http://localhost:5173',
    hostname: 'localhost'
  },
  fetch,
  navigator: undefined
}

// @ts-ignore
if (typeof globalThis.window === 'undefined') {
  // @ts-ignore
  globalThis.window = windowStub
} else {
  Object.assign(globalThis.window, windowStub)
}

// Provide atob for GitHub service compatibility if needed
if (typeof (globalThis.window as any).atob !== 'function') {
  (globalThis.window as any).atob = (input: string) => Buffer.from(input, 'base64').toString('binary')
}

process.env.NODE_ENV = process.env.NODE_ENV || 'development'

function logSection(title: string) {
  console.log(`\n=== ${title} ===`)
}

async function run() {
  logSection('Markdown Rendering')
  const markdownSample = '# Spark Agentic RAG' + '\n\n' + '- Classifier agent' + '\n' + '- Planner agent' + '\n' + '- Critic agent'
  const rendered = marked.parse(markdownSample)
  console.log('Rendered HTML snippet:', rendered.replace(/\s+/g, ' ').slice(0, 120))

  logSection('UUID Persistence via Cache Manager')
  const docId = uuidv4()
  const cacheKey = `doc:${docId}:summary`
  await cacheManager.set(cacheKey, { summary: 'Agent workflow cached value', ts: new Date().toISOString() })
  const retrieved = await cacheManager.get<typeof cacheKey>(cacheKey)
  console.log('Cache entry exists:', Boolean(retrieved))
  await cacheManager.invalidateDocument(docId)
  const remainingKeys = await windowStub.spark.kv.keys()
  console.log('KV keys after invalidation:', remainingKeys)

  logSection('Agent Orchestrator Flow')

  const documents: Document[] = [
    {
      id: uuidv4(),
      name: 'spark-overview.md',
      size: 2048,
      uploadedAt: new Date().toISOString(),
      type: 'text/markdown',
      chunks: [
        {
          id: 'chunk-1',
          documentId: 'doc-1',
          chunkIndex: 0,
          content: 'Spark agentic workflow orchestrator coordinates classifier, planner, router, critic, and expansion agents to deliver reliable RAG responses with citations.'
        }
      ],
      processed: true,
      processingStatus: 'completed',
      source: 'github'
    }
  ]

  const orchestrator = new AgenticOrchestrator()
  const query = 'Explain the Spark agentic RAG workflow'
  const runResult = await orchestrator.processQuery(query, documents, { runId: uuidv4() })

  console.log('Response:', runResult.response)
  console.log('Sources used:', runResult.sources.length)
  console.log('Classification:', runResult.classification)
  console.log('Plan:', runResult.plan)
  console.log('Validation:', runResult.validation)
  console.log('ReAct iterations:', runResult.refinement?.iterations ?? 0, 'Improved:', runResult.refinement?.improved ?? false)
  console.log('Expansion suggestions:', runResult.expansion?.suggestedQuestions.length ?? 0)

  logSection('Spark LLM Call Trace')
  llmCallLog.forEach((entry, index) => {
    console.log(`${index + 1}. [${entry.tag}] ${entry.snippet}`)
  })
}

run().catch(error => {
  console.error('Runtime checks failed:', error)
  process.exitCode = 1
})
