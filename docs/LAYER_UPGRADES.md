# Azure RAG System Upgrades: Layers 6, 7, and 8

This document details the production-ready upgrades implemented across the vector database (Layer 6), retrieval (Layer 7), and generation (Layer 8) layers of the Agentic RAG system.

## Overview

The system has been enhanced with:
- **Layer 6**: Vector DB namespacing, metadata filtering, and compression
- **Layer 7**: True hybrid retrieval with RRF, semantic reranking, and contextual compression
- **Layer 8**: Azure OpenAI streaming completions with stored completions support

## Layer 6: Vector Database Upgrades

### Namespacing for Multitenancy

**Purpose**: Partition data by tenant, environment, or domain to improve latency, relevance, and isolation.

**Implementation**:
- `NamespaceManager` class manages namespace lifecycle and isolation
- Namespaces support tenant, environment (production/staging/development), and domain partitioning
- All upserts automatically tag documents with namespace metadata
- Queries filter by namespace to enforce strong isolation

**Usage Example**:
```typescript
import { namespaceManager } from '@/lib/namespace-manager'

// Create namespace for tenant
const namespace = await namespaceManager.createNamespace({
  id: 'acme-production',
  tenant: 'acme',
  environment: 'production',
  compressionEnabled: true
})

// Build metadata filter
const metadata = namespaceManager.buildMetadataFilter('acme-production', {
  doc_type: 'contract',
  source: 'upload',
  pii_flag: false
})

// Search within namespace
const results = await azureSearchService.semanticHybridSearch(
  query,
  queryVector,
  top,
  'acme-production'  // namespace isolation
)
```

**Benefits**:
- **Isolation**: Strong tenant separation prevents data leakage
- **Performance**: Reduced scan scope improves query latency
- **Relevance**: Context-specific results within tenant boundaries
- **Governance**: Metadata filters enable policy enforcement

### Metadata Filtering and Guardrails

**Implementation**:
- Extended `ChunkMetadata` interface with governance fields:
  - `namespace_id`: Namespace identifier
  - `tenant`: Tenant identifier
  - `doc_type`: Document classification
  - `source`: Origin (upload, github, website, etc.)
  - `pii_flag`: PII detection flag
  - `timestamp`: Creation timestamp

**Usage**:
```typescript
const metadata: ChunkMetadata = {
  namespace_id: 'acme-production',
  tenant: 'acme',
  doc_type: 'policy',
  source: 'upload',
  pii_flag: false,
  timestamp: new Date().toISOString()
}
```

**Benefits**:
- Efficient filtered search at query time
- Retention policy enforcement
- PII governance and compliance
- Audit trail via timestamps

### Vector Compression

**Configuration**:
```typescript
const azureConfig: AzureConfig = {
  search: {
    vectorCompression: {
      enabled: true,
      method: 'scalar'  // or 'binary'
    }
  }
}
```

**Methods**:
- **Scalar Quantization**: 4-bit quantization reducing storage ~4x
- **Binary Quantization**: 1-bit quantization for maximum compression

**Benefits**:
- Reduced storage costs (up to 75% savings)
- Lower memory footprint
- Faster vector operations
- Minimal recall impact (<2% for scalar, <5% for binary)

**Monitoring**:
Track recall metrics via namespace manager:
```typescript
const metrics = await namespaceManager.getMetrics()
console.log(`Total namespaces: ${metrics.totalNamespaces}`)
console.log(`Total documents: ${metrics.totalDocuments}`)
```

## Layer 7: Retrieval Upgrades

### True Hybrid Retrieval with RRF

**What is RRF?**
Reciprocal Rank Fusion (RRF) merges BM25 keyword search and vector semantic search results using reciprocal rank scores, avoiding score normalization issues.

**Configuration**:
```typescript
const azureConfig: AzureConfig = {
  search: {
    hybridSearch: {
      enabled: true,
      maxTextRecallSize: 2000,  // BM25 candidate pool size
      enableRRF: true,
      enableSemanticReranker: true
    }
  }
}
```

**How It Works**:
1. **Parallel Execution**: BM25 and vector searches run simultaneously
2. **RRF Fusion**: Results merged using reciprocal rank formula: `1 / (k + rank)`
3. **Semantic Reranking**: Optional final reranking for natural language queries
4. **Unified Results**: Single ranked list with combined signals

**Tuning Guidance**:
- **Increase `maxTextRecallSize`**: For large indexes or rare terms
- **Decrease `maxTextRecallSize`**: When vector search consistently outperforms
- **Enable Semantic Reranker**: For complex natural language queries

**Request Format**:
```json
{
  "vectorQueries": [
    {
      "kind": "vector",
      "vector": [0.1, 0.2, ...],
      "k": 50
    }
  ],
  "search": "natural language query here",
  "hybridSearch": {
    "maxTextRecallSize": 2000,
    "countAndFacetMode": "relaxed"
  },
  "queryType": "semantic",
  "semanticConfiguration": "semantic-config",
  "top": 20
}
```

**Benefits**:
- **Robustness**: Works across diverse query types
- **No Score Calibration**: RRF handles different score distributions
- **Improved Relevance**: Combines lexical and semantic signals
- **Query Versatility**: Handles both keywords and natural language

### Semantic Ranking

**Implementation**:
Azure AI Search semantic ranking provides L2 reranking using Microsoft's semantic models.

**Configuration**:
```typescript
const azureConfig: AzureConfig = {
  search: {
    semanticConfiguration: {
      enabled: true,
      configName: 'semantic-config',
      prioritizeTitle: true,      // Boost document titles
      prioritizeKeywords: true    // Boost metadata keywords
    }
  }
}
```

**Features**:
- **Semantic Captions**: Extractive highlights from matched content
- **Semantic Answers**: Direct answer extraction for factoid queries
- **Reranker Scores**: Quality scores for final ranking

**Response Format**:
```typescript
interface Source {
  content: string
  semanticCaption?: string              // Highlighted excerpt
  semanticRerankerScore?: number        // L2 ranking score
  azureScore: number                    // Initial search score
}
```

### Contextual Compression

**Purpose**: Reduce token count while preserving evidence, improving latency and cost.

**Configuration**:
```typescript
const azureConfig: AzureConfig = {
  search: {
    contextCompression: {
      enabled: true,
      method: 'extractive',      // or 'llmlingua' (future)
      compressionRatio: 0.5      // 50% token reduction
    }
  }
}
```

**Methods**:
- **Extractive**: Query-relevant sentence extraction
- **LLMLingua**: Token-level compression (future implementation)

**Extractive Algorithm**:
1. Split content into sentences
2. Score sentences by query word overlap
3. Select top N% sentences by relevance
4. Reconstruct in original order

**Benefits**:
- 2-20x token reduction
- Lower generation costs
- Faster response times
- Preserved factual accuracy

**Example**:
```typescript
// Original: 500 tokens
const original = "Long document with many sentences..."

// Compressed: 250 tokens (50% ratio)
const compressed = await applyContextualCompression(sources, query)
```

## Layer 8: Generation Upgrades

### Azure OpenAI Chat Completions

**Implementation**:
Production-ready Azure OpenAI integration with streaming and stored completions.

**Configuration**:
```typescript
const azureConfig: AzureConfig = {
  openai: {
    endpoint: 'https://<resource>.openai.azure.com',
    apiKey: process.env.AZURE_OPENAI_API_KEY,
    deploymentName: 'gpt-4o',
    embeddingDeploymentName: 'text-embedding-3-large',
    apiVersion: '2025-04-01-preview',
    enableStreaming: true,
    enableStoredCompletions: true
  }
}
```

**Features**:

#### 1. Streaming Responses
Real-time token streaming for improved UX:
```typescript
const response = await azureOpenAI.generateCompletion(messages, {
  stream: true,
  onChunk: (chunk) => {
    console.log('Received:', chunk)
    // Update UI in real-time
  }
})
```

#### 2. Stored Completions
Enterprise data governance and evaluation:
```typescript
// Automatically stored when enabled
const response = await azureOpenAI.generateCompletion(messages)
// Prompt and response stored for:
// - Offline evaluation
// - Red-teaming
// - Prompt hardening
// - Model distillation
```

#### 3. Production Best Practices

**Retry Logic** (recommended implementation):
```typescript
async function generateWithRetry(messages, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await azureOpenAI.generateCompletion(messages)
    } catch (error) {
      if (i === maxRetries - 1) throw error
      await sleep(Math.pow(2, i) * 1000)  // Exponential backoff
    }
  }
}
```

**Circuit Breaker** (recommended):
```typescript
class CircuitBreaker {
  private failures = 0
  private readonly threshold = 5
  private state: 'closed' | 'open' = 'closed'
  
  async call<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      throw new Error('Circuit breaker is open')
    }
    
    try {
      const result = await fn()
      this.failures = 0
      return result
    } catch (error) {
      this.failures++
      if (this.failures >= this.threshold) {
        this.state = 'open'
        setTimeout(() => this.state = 'closed', 60000)
      }
      throw error
    }
  }
}
```

**API Version Lifecycle**:
- Current: `2025-04-01-preview`
- Update quarterly per Azure OpenAI lifecycle guidance
- Monitor deprecation notices

### Data Privacy and Governance

**Azure AI Foundry Commitments**:
- Customer data not used for model training
- Data processed in customer's region
- Microsoft Entra ID authentication support
- Enterprise-grade compliance (SOC 2, ISO 27001, etc.)

**Authentication** (recommended):
```typescript
import { DefaultAzureCredential } from '@azure/identity'

const credential = new DefaultAzureCredential()
const token = await credential.getToken('https://cognitiveservices.azure.com/.default')

// Use token instead of API key
headers: {
  'Authorization': `Bearer ${token.token}`
}
```

## Rollout Order and Validation

### Step 1: Layer 6 - Namespacing (Week 1-2)

**Implementation**:
1. Create namespace manager
2. Backfill existing vectors with default namespace
3. Enable metadata filters
4. Validate isolation via tenant-specific queries

**Validation**:
```typescript
// Test namespace isolation
const acmeResults = await search(query, 'acme-production')
const xyzResults = await search(query, 'xyz-production')
// Verify no overlap in results

// Validate latency SLOs
const start = Date.now()
await search(query, namespace)
const latency = Date.now() - start
console.assert(latency < 500, 'Latency SLO exceeded')
```

**Success Criteria**:
- ✅ Zero cross-tenant data leakage
- ✅ <500ms query latency per tenant
- ✅ Metadata filters functional

**Optional**: Enable 4-bit compression on new namespaces:
```typescript
const namespace = await namespaceManager.createNamespace({
  id: 'new-tenant',
  tenant: 'new-tenant',
  environment: 'production',
  compressionEnabled: true  // Enable compression
})

// Measure recall impact
const uncompressedRecall = await measureRecall(queries, namespace)
// Enable compression
// const compressedRecall = await measureRecall(queries, namespace)
// Target: <2% recall degradation
```

### Step 2: Layer 7 - Hybrid Retrieval (Week 3-4)

**Implementation**:
1. Enable hybrid search with RRF
2. Tune `maxTextRecallSize` parameter
3. Add semantic reranker
4. Layer in contextual compression

**Validation**:
```typescript
// A/B test hybrid vs vector-only
const hybridResults = await hybridSearch(query)
const vectorResults = await vectorSearch(query)

// Offline evaluation
const hybridNDCG = calculateNDCG(hybridResults, groundTruth)
const vectorNDCG = calculateNDCG(vectorResults, groundTruth)

console.log(`Hybrid improvement: ${((hybridNDCG - vectorNDCG) / vectorNDCG * 100).toFixed(1)}%`)
```

**Tuning Process**:
```typescript
// Test different BM25 pool sizes
for (const poolSize of [500, 1000, 2000, 5000]) {
  config.hybridSearch.maxTextRecallSize = poolSize
  const metrics = await evaluateQueries(testQueries)
  console.log(`Pool ${poolSize}: NDCG=${metrics.ndcg}, Latency=${metrics.latency}ms`)
}
```

**Success Criteria**:
- ✅ >5% NDCG improvement vs baseline
- ✅ <1s query latency (p95)
- ✅ 2-5x token reduction with compression

### Step 3: Layer 8 - Azure OpenAI (Week 5-6)

**Implementation**:
1. Migrate to Azure OpenAI endpoints
2. Enable streaming for UI
3. Activate stored completions
4. Apply production resilience patterns

**Validation**:
```typescript
// Canary deployment
const canaryTraffic = 0.10  // 10% of traffic

async function handleQuery(query: string) {
  const useAzure = Math.random() < canaryTraffic
  
  if (useAzure) {
    try {
      return await azureOpenAI.generateCompletion(query)
    } catch (error) {
      logError('Azure OpenAI failed', error)
      return await fallbackLLM(query)
    }
  } else {
    return await currentLLM(query)
  }
}
```

**Monitoring**:
```typescript
// Track key metrics
const metrics = {
  latency: [],
  errorRate: 0,
  tokenUsage: [],
  costPerQuery: []
}

// Gradual rollout
// Week 1: 10% traffic
// Week 2: 25% traffic
// Week 3: 50% traffic
// Week 4: 100% traffic
```

**Success Criteria**:
- ✅ <2s generation latency (p95)
- ✅ <0.1% error rate
- ✅ Stored completions captured
- ✅ Cost within budget

## Performance Benchmarks

### Expected Improvements

| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| Query Latency (p95) | 800ms | <500ms | 37.5% faster |
| Storage Cost | $100/mo | $40/mo | 60% reduction |
| Retrieval NDCG | 0.72 | 0.81 | 12.5% improvement |
| Token Cost | $2/query | $0.60/query | 70% reduction |
| Cross-tenant Leakage | Possible | Zero | 100% isolation |

### Scaling Considerations

**Namespace Scaling**:
- Support 1000+ tenants per index
- <100ms namespace filter overhead
- Linear cost scaling per tenant

**Compression Scaling**:
- 4-bit scalar: 75% storage reduction, <2% recall loss
- Binary: 94% storage reduction, <5% recall loss

**RRF Scaling**:
- Constant-time fusion regardless of result size
- No score calibration overhead
- Handles 10,000+ candidates efficiently

## Troubleshooting

### Common Issues

**Issue**: Namespace isolation not working
```typescript
// Solution: Verify metadata filter syntax
const filter = `namespaceId eq '${namespaceId}'`
console.log('Filter:', filter)
```

**Issue**: Low recall after compression
```typescript
// Solution: Reduce compression ratio
config.vectorCompression.method = 'scalar'  // Instead of 'binary'
config.contextCompression.compressionRatio = 0.7  // Instead of 0.5
```

**Issue**: Slow hybrid search
```typescript
// Solution: Tune BM25 pool size
config.hybridSearch.maxTextRecallSize = 1000  // Reduce from 2000
```

**Issue**: Azure OpenAI rate limits
```typescript
// Solution: Implement exponential backoff
async function withBackoff(fn, maxRetries = 5) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn()
    } catch (error) {
      if (error.status === 429) {
        const delay = Math.min(1000 * Math.pow(2, i), 32000)
        await sleep(delay)
        continue
      }
      throw error
    }
  }
}
```

## References

1. [Azure OpenAI Stored Completions](https://learn.microsoft.com/en-us/azure/ai-foundry/openai/how-to/stored-completions)
2. [Azure AI Search Hybrid Query](https://learn.microsoft.com/en-us/azure/search/hybrid-search-how-to-query)
3. [Pinecone Namespacing Guide](https://docs.pinecone.io/guides/index-data/implement-multitenancy)
4. [Hybrid Search Ranking](https://learn.microsoft.com/en-us/azure/search/hybrid-search-ranking)
5. [RRF Algorithm](https://opensearch.org/blog/introducing-reciprocal-rank-fusion-hybrid-search/)
6. [LLMLingua Compression](https://arxiv.org/pdf/2310.05736.pdf)
7. [Production Best Practices](https://platform.openai.com/docs/guides/production-best-practices)

## Next Steps

After implementing these upgrades, consider:

1. **Advanced Reranking**: Cross-encoder models for final ranking
2. **Query Understanding**: Intent classification and entity extraction
3. **Feedback Loops**: User feedback for continuous improvement
4. **Cost Optimization**: Dynamic compression based on query importance
5. **Multi-modal**: Image and document understanding
6. **Real-time Updates**: Change data capture for live index updates
