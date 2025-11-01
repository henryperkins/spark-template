# Azure AI Search Embedding Quality Optimization Guide

This guide explains how to configure Azure AI Search to maximize embedding quality and retrieval accuracy in your Agentic RAG system.

## Overview

The application now supports advanced Azure AI Search features to enhance embedding quality and search relevance:

1. **Semantic Search** - Deep understanding of query intent and content meaning
2. **Vector Compression** - Performance optimization with minimal quality loss
3. **Custom Scoring Profiles** - Intelligent relevance boosting based on document attributes

## Semantic Search Configuration

### What is Semantic Search?

Semantic search uses Microsoft's large language models to understand the meaning and intent behind queries, going beyond simple keyword matching to comprehend context and relationships.

### Benefits

- **Better Query Understanding**: Interprets user intent even with ambiguous or complex queries
- **Semantic Captions**: Automatically generates relevant excerpts highlighting key information
- **Reranking**: Re-scores results using semantic similarity for improved relevance
- **Answer Extraction**: Can extract direct answers from content (extractive QA)

### Configuration Options

#### Enable/Disable Semantic Search
Toggle semantic search on or off. When enabled, all hybrid searches use semantic ranking.

#### Configuration Name
Specify the semantic configuration name (default: `semantic-config`). Must be unique within your index.

#### Prioritize Document Titles
When enabled, the semantic ranker gives higher weight to matches in document titles, useful for documents with descriptive titles.

#### Prioritize Metadata Keywords
When enabled, extracted metadata keywords receive higher priority in semantic ranking, improving retrieval for keyword-rich documents.

### How It Works

1. Query submitted → Converted to embedding vector
2. Initial retrieval using vector + keyword search
3. Semantic ranker re-scores top results using language model
4. Results returned with:
   - `@search.score` - Original relevance score
   - `@search.rerankerScore` - Semantic similarity score
   - `@search.captions` - Extracted relevant text snippets
   - `@search.answers` - Direct answer extraction (if applicable)

### Best Practices

- **Always enable for production** - Semantic search significantly improves accuracy
- **Use with hybrid search** - Combines keyword precision with semantic understanding
- **Monitor reranker scores** - Track `semanticRerankerScore` to evaluate relevance quality
- **Leverage captions** - Display semantic captions to users for better context

## Vector Compression

### What is Vector Compression?

Vector compression reduces the storage size and computational cost of embedding vectors using quantization techniques, improving query speed with minimal accuracy impact.

### Compression Methods

#### Scalar Quantization (Recommended)
- **How it works**: Reduces precision of vector components from 32-bit to 8-bit floats
- **Storage savings**: ~75% reduction in vector storage
- **Quality impact**: Minimal (typically <1% accuracy loss)
- **Speed improvement**: 2-3x faster queries
- **Best for**: Production deployments balancing quality and performance

#### Binary Quantization (Maximum Speed)
- **How it works**: Converts vector components to binary (0 or 1)
- **Storage savings**: ~97% reduction in vector storage
- **Quality impact**: Moderate (5-10% accuracy loss possible)
- **Speed improvement**: 10-20x faster queries
- **Best for**: Large-scale deployments prioritizing speed over precision

### When to Use Compression

**Enable compression when:**
- Working with large document collections (10,000+ chunks)
- Query latency is a concern
- Storage costs need optimization
- Accuracy loss of <1-2% is acceptable

**Disable compression when:**
- Maximum accuracy is critical
- Working with small document sets (<1,000 chunks)
- Embeddings are already low-dimensional

### Configuration

1. Toggle "Vector Compression" on
2. Select compression method:
   - **Scalar Quantization** - For best quality/performance balance
   - **Binary Quantization** - For maximum speed
3. Save and test connection to rebuild index with compression

### Performance Impact

| Method | Storage | Speed | Accuracy |
|--------|---------|-------|----------|
| None (baseline) | 100% | 1x | 100% |
| Scalar Quantization | 25% | 2-3x | 99%+ |
| Binary Quantization | 3% | 10-20x | 90-95% |

## Custom Scoring Profiles

### What are Scoring Profiles?

Scoring profiles boost search relevance by applying custom weighting to different document attributes, allowing you to prioritize results based on recency, content quality, and metadata matches.

### Scoring Components

#### 1. Recency Boost (Default: 2.0x)

Prioritizes recently created or updated documents.

**Use cases:**
- News and current events
- Product documentation with frequent updates
- Time-sensitive content

**Configuration:**
- Range: 0x (disabled) to 5x (maximum boost)
- Default boosting duration: 30 days
- Interpolation: Linear (newer = higher boost)

**Example:** A document created yesterday receives 2x score boost, while a document created 15 days ago receives 1x boost, and a document over 30 days old receives no boost.

#### 2. Content Length Boost (Default: 1.5x)

Favors chunks with optimal content length (100-2,000 characters).

**Use cases:**
- Avoiding too-short snippets lacking context
- Avoiding too-long chunks with diluted relevance
- Prioritizing well-formed paragraphs

**Configuration:**
- Range: 0x (disabled) to 5x (maximum boost)
- Optimal range: 100-2,000 characters
- Interpolation: Logarithmic (smooth boost curve)

**Example:** A 500-character chunk receives full 1.5x boost, a 50-character snippet receives reduced boost, and a 5,000-character chunk receives minimal boost.

#### 3. Metadata Weight (Default: 0.3x)

Increases importance of metadata field matches.

**Use cases:**
- Documents with rich metadata (tags, categories, keywords)
- Technical documentation with structured metadata
- Filtered searches by metadata attributes

**Configuration:**
- Range: 0x (disabled) to 2x (maximum weight)
- Applied to metadata field text matches

**Example:** A query matching both content and metadata receives the content score plus 0.3x additional weight for metadata match.

### How Scoring Works

The final relevance score is calculated as:

```
Final Score = Base Score × (1 + Recency Boost + Length Boost) + Metadata Weight
```

**Function Aggregation:** Sum (boosts are additive)

### Tuning Recommendations

#### For News/Dynamic Content
- Recency: 3.0-5.0x (high priority on fresh content)
- Length: 1.0-1.5x (standard)
- Metadata: 0.5-1.0x (moderate)

#### For Technical Documentation
- Recency: 0.5-1.0x (low priority)
- Length: 2.0-3.0x (favor complete explanations)
- Metadata: 1.0-2.0x (high value on tags/categories)

#### For General Knowledge Base
- Recency: 1.5-2.0x (moderate priority)
- Length: 1.5-2.0x (balanced)
- Metadata: 0.3-0.5x (standard)

#### For Research Papers
- Recency: 0.0-0.5x (timeless content)
- Length: 2.0-3.0x (detailed content preferred)
- Metadata: 1.5-2.0x (citations/keywords important)

## Index Schema Enhancements

The optimized Azure AI Search index includes these fields:

### Core Fields
- `id` (String, Key) - Unique chunk identifier
- `content` (String, Searchable) - Main text content with `en.microsoft` analyzer
- `contentVector` (Collection(Single)) - 1536-dimension embedding vector
- `documentId` (String, Filterable) - Parent document identifier
- `documentName` (String, Searchable) - Document title for semantic ranking
- `chunkIndex` (Int32, Sortable) - Chunk position within document

### Enhancement Fields
- `metadata` (String, Searchable) - JSON metadata with `keyword` analyzer
- `createdAt` (DateTimeOffset, Sortable) - Document creation timestamp for recency boost
- `contentLength` (Int32, Sortable) - Character count for length-based scoring

### Vector Search Configuration

**HNSW Algorithm (Default):**
- Metric: Cosine similarity
- M: 8 (neighborhood size - higher = better accuracy, more memory)
- efConstruction: 800 (build-time accuracy - higher = better quality)
- efSearch: 800 (query-time accuracy - higher = better results, slower)

**Exhaustive KNN (Fallback):**
- Used for small datasets or when maximum accuracy required
- Brute-force search with perfect recall
- Slower but guaranteed best results

### Semantic Configuration

When semantic search is enabled:
- **Content Fields**: `content` (primary text)
- **Title Field**: `documentName` (if prioritization enabled)
- **Keywords Fields**: `metadata` (if prioritization enabled)
- **Captions**: Extractive (generates relevant snippets)
- **Answers**: Extractive with count=3 (extracts up to 3 direct answers)

## Migration Guide

### Updating Existing Indexes

If you already have an Azure AI Search index:

1. **Back up existing data** (optional but recommended)
2. Navigate to Azure Configuration → Optimization tab
3. Configure desired settings
4. Click "Test Connection" - this will recreate the index with new schema
5. Re-index all documents to populate new fields

**Note:** Index recreation will temporarily make search unavailable.

### Incremental Adoption

You can enable features individually:

**Phase 1: Semantic Search Only**
- Enable semantic search
- Keep vector compression disabled
- Use default scoring profile
- Evaluate semantic ranking quality

**Phase 2: Add Custom Scoring**
- Enable custom scoring
- Tune weights based on your content
- Monitor score distribution
- Adjust weights as needed

**Phase 3: Vector Compression**
- Enable scalar quantization
- Test accuracy impact
- If acceptable, deploy to production
- Consider binary quantization for extreme scale

## Monitoring and Validation

### Key Metrics to Track

1. **Semantic Reranker Scores**
   - Monitor `semanticRerankerScore` values
   - Typical good scores: 2.5-4.0
   - Scores below 1.5 may indicate poor semantic match

2. **Relevance Score Distribution**
   - Track `@search.score` before and after optimization
   - Higher average scores = better configuration
   - Monitor top-1, top-3, top-5 accuracy

3. **Query Latency**
   - Measure p50, p95, p99 latency
   - Semantic search adds ~100-200ms
   - Vector compression reduces latency by 50-70%

4. **User Engagement**
   - Click-through rate on top results
   - User satisfaction ratings
   - Query reformulation rate

### A/B Testing

To validate improvements:

1. Deploy with semantic search and custom scoring to 50% of traffic
2. Keep baseline configuration for other 50%
3. Compare relevance metrics over 1-2 weeks
4. Roll out to 100% if metrics improve

## Troubleshooting

### Semantic Search Not Improving Results

**Possible causes:**
- Queries are already very specific (semantic adds little value)
- Document content lacks context (short snippets)
- Language mismatch (semantic ranker optimized for English)

**Solutions:**
- Verify query complexity distribution
- Ensure chunks have sufficient context (200+ characters)
- Test with more complex, natural language queries

### Vector Compression Reducing Accuracy

**If accuracy drops significantly:**
- Switch from binary to scalar quantization
- Verify base embeddings are high-quality
- Check if queries are already near decision boundaries
- Consider disabling compression for critical use cases

### Custom Scoring Not Affecting Results

**Possible causes:**
- Boost weights too low to make a difference
- Documents lack variance in boosted fields (all same age/length)
- Base vector/text scores dominating

**Solutions:**
- Increase boost weights (try 3.0-5.0x)
- Verify field distribution (check if documents vary in age/length)
- Disable vector search temporarily to isolate scoring impact

## API Version Requirements

These features require:
- **Azure AI Search**: `2024-05-01-preview` or later
- **Azure OpenAI**: `2024-08-01-preview` or later

The application automatically sets these versions in the default configuration.

## Cost Implications

### Semantic Search
- **Cost**: Additional per-query fee (~$0.001 per query)
- **Best practice**: Use for user-facing queries, not batch processing
- **ROI**: High - significant quality improvement for minimal cost

### Vector Compression
- **Cost**: Storage savings offset by rebuild costs
- **Best practice**: Enable during initial index creation
- **ROI**: High - reduces storage and query costs long-term

### Custom Scoring
- **Cost**: Negligible (computed during query execution)
- **Best practice**: Always enable
- **ROI**: Very high - free quality improvement

## References

- [Azure AI Search Semantic Ranking](https://learn.microsoft.com/en-us/azure/search/semantic-search-overview)
- [Vector Compression in Azure AI Search](https://learn.microsoft.com/en-us/azure/search/vector-search-how-to-quantization)
- [Scoring Profiles](https://learn.microsoft.com/en-us/azure/search/index-add-scoring-profiles)
- [Azure AI Search API 2024-05-01-preview](https://learn.microsoft.com/en-us/rest/api/searchservice/)

## Support

For issues or questions:
1. Check Azure AI Search service logs in Azure Portal
2. Verify API version compatibility
3. Review index schema in Azure Portal
4. Test configuration with simple queries first
5. Consult Azure AI Search documentation for detailed troubleshooting
