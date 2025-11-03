# Research how to use Azure AI Search resource using the 2025-08-01-preview REST API Schema. For code examples, present them in Typescript or Javascript.

Now I have comprehensive information to provide a detailed guide with TypeScript and JavaScript examples. Let me create the complete resource.

## How to Use Azure AI Search Resource Using the 2025-08-01-preview REST API Schema with TypeScript/JavaScript

Azure AI Search's 2025-08-01-preview API version provides powerful search capabilities through the **@azure/search-documents** SDK for TypeScript and JavaScript. This guide covers the complete workflow with practical code examples.

### Installation and Setup

Begin by installing the Azure AI Search SDK for JavaScript/TypeScript:[^1][^2]

```bash
npm install @azure/search-documents
```

**Environment Configuration:**

Create a `.env` file with your Azure AI Search credentials:[^3]

```
SEARCH_API_KEY=<your-search-admin-key>
SEARCH_API_ENDPOINT=https://<your-service-name>.search.windows.net
```

**Basic Client Initialization:**

```typescript
import { SearchClient, SearchIndexClient, AzureKeyCredential } from "@azure/search-documents";
import * as dotenv from "dotenv";

dotenv.config();

const endpoint = process.env.SEARCH_API_ENDPOINT || "";
const apiKey = process.env.SEARCH_API_KEY || "";
const indexName = "my-index";

const credential = new AzureKeyCredential(apiKey);

// For index management operations
const indexClient = new SearchIndexClient(endpoint, credential);

// For document operations (search, upload, update, delete)
const searchClient = new SearchClient(endpoint, indexName, credential);
```


### Creating and Managing Indexes

**Create an Index with Vector Search Support:**

The following example creates an index with support for full-text search, vector search, and semantic ranking:[^4][^5]

```typescript
import {
  SearchIndex,
  SearchField,
  SearchFieldDataType,
  SimpleField,
  SearchableField,
  VectorSearch,
  VectorSearchProfile,
  HnswAlgorithmConfiguration,
  SemanticConfiguration,
  SemanticPrioritizedFields,
  SemanticField,
  SemanticSearch
} from "@azure/search-documents/models";

async function createIndex(indexClient: SearchIndexClient, indexName: string) {
  const index = new SearchIndex({
    name: indexName,
    fields: [
      new SimpleField({
        name: "id",
        type: "Edm.String",
        key: true,
        filterable: true,
        sortable: true
      }),
      new SearchableField({
        name: "title",
        type: "Edm.String",
        searchable: true,
        retrievable: true,
        sortable: true,
        filterable: true
      }),
      new SearchableField({
        name: "description",
        type: "Edm.String",
        searchable: true,
        retrievable: true
      }),
      new SearchField({
        name: "descriptionVector",
        type: "Collection(Edm.Single)",
        searchable: true,
        retrievable: false,
        dimensions: 1536,
        vectorSearchProfileName: "vector-profile"
      }),
      new SimpleField({
        name: "category",
        type: "Edm.String",
        filterable: true,
        facetable: true,
        retrievable: true
      }),
      new SimpleField({
        name: "lastUpdated",
        type: "Edm.DateTimeOffset",
        filterable: true,
        sortable: true
      })
    ],
    vectorSearch: new VectorSearch({
      algorithms: [
        new HnswAlgorithmConfiguration({
          name: "hnsw-config",
          parameters: {
            m: 4,
            efConstruction: 400,
            efSearch: 500,
            metric: "cosine"
          }
        })
      ],
      profiles: [
        new VectorSearchProfile({
          name: "vector-profile",
          algorithmConfigurationName: "hnsw-config"
        })
      ]
    }),
    semanticSearch: new SemanticSearch({
      configurations: [
        new SemanticConfiguration({
          name: "semantic-config",
          prioritizedFields: new SemanticPrioritizedFields({
            titleField: new SemanticField({ fieldName: "title" }),
            contentFields: [new SemanticField({ fieldName: "description" })]
          })
        })
      ]
    })
  });

  try {
    const result = await indexClient.createOrUpdateIndex(index);
    console.log(`Index '${result.name}' created successfully.`);
    return result;
  } catch (error) {
    console.error("Error creating index:", error);
    throw error;
  }
}
```

**List and Delete Indexes:**

```typescript
async function listIndexes(indexClient: SearchIndexClient) {
  try {
    const indexes = await indexClient.listIndexes();
    console.log("Available indexes:");
    for await (const index of indexes) {
      console.log(`- ${index.name}`);
    }
  } catch (error) {
    console.error("Error listing indexes:", error);
  }
}

async function deleteIndex(indexClient: SearchIndexClient, indexName: string) {
  try {
    await indexClient.deleteIndex(indexName);
    console.log(`Index '${indexName}' deleted successfully.`);
  } catch (error) {
    console.error("Error deleting index:", error);
  }
}
```


### Uploading and Managing Documents

**Upload Documents to Index:**

```typescript
interface Document {
  id: string;
  title: string;
  description: string;
  descriptionVector?: number[];
  category: string;
  lastUpdated: string;
}

async function uploadDocuments(searchClient: SearchClient<Document>) {
  const documents: Document[] = [
    {
      id: "1",
      title: "Azure AI Search Basics",
      description: "Learn the fundamentals of Azure AI Search and vector search capabilities",
      descriptionVector: [0.1, 0.2, 0.3, /* ... 1533 more values */],
      category: "Tutorial",
      lastUpdated: new Date().toISOString()
    },
    {
      id: "2",
      title: "Advanced Vector Querying",
      description: "Deep dive into vector search algorithms and optimization techniques",
      descriptionVector: [0.2, 0.3, 0.4, /* ... 1533 more values */],
      category: "Advanced",
      lastUpdated: new Date().toISOString()
    },
    {
      id: "3",
      title: "Semantic Ranking Guide",
      description: "Understanding semantic ranking and how to improve search relevance",
      descriptionVector: [0.15, 0.25, 0.35, /* ... 1533 more values */],
      category: "Guide",
      lastUpdated: new Date().toISOString()
    }
  ];

  try {
    // Upload documents with batch operations
    const result = await searchClient.mergeOrUploadDocuments(documents);
    console.log(`Successfully indexed ${documents.length} documents.`);
    return result;
  } catch (error) {
    console.error("Error uploading documents:", error);
    throw error;
  }
}

// Alternative: Upload with buffering for large datasets
async function uploadDocumentsBuffered(searchClient: SearchClient<Document>) {
  const { SearchIndexingBufferedSender } = await import("@azure/search-documents");

  const documents: Document[] = [
    // Your documents array
  ];

  const bufferedSender = new SearchIndexingBufferedSender(searchClient, {
    autoFlushIntervalMs: 5000,
    maxRetries: 3
  });

  try {
    await bufferedSender.uploadDocuments(documents);
    await bufferedSender.flush();
    console.log(`Successfully buffered and indexed ${documents.length} documents.`);
  } catch (error) {
    console.error("Error uploading documents with buffering:", error);
    throw error;
  }
}
```

**Update and Delete Documents:**

```typescript
async function updateDocument(searchClient: SearchClient<Document>) {
  const updatedDoc: Document = {
    id: "1",
    title: "Azure AI Search Updated",
    description: "Updated description with new information",
    category: "Tutorial",
    lastUpdated: new Date().toISOString()
  };

  try {
    await searchClient.mergeDocuments([updatedDoc]);
    console.log(`Document '${updatedDoc.id}' updated successfully.`);
  } catch (error) {
    console.error("Error updating document:", error);
  }
}

async function deleteDocument(searchClient: SearchClient<Document>, docId: string) {
  try {
    await searchClient.deleteDocuments([{ id: docId }]);
    console.log(`Document '${docId}' deleted successfully.`);
  } catch (error) {
    console.error("Error deleting document:", error);
  }
}
```


### Performing Searches

**Basic Keyword Search:**

```typescript
async function performKeywordSearch(searchClient: SearchClient<Document>, searchQuery: string) {
  try {
    const searchResults = await searchClient.search(searchQuery, {
      select: ["id", "title", "description", "category"],
      top: 10,
      includeTotalCount: true
    });

    console.log(`Search results for "${searchQuery}":`);
    console.log(`Total count: ${searchResults.count}`);

    let count = 0;
    for await (const result of searchResults.results) {
      count++;
      console.log(`\nResult #${count}:`);
      console.log(`  Score: ${result.score}`);
      console.log(`  Document:`, result.document);
    }
  } catch (error) {
    console.error("Error during search:", error);
  }
}
```

**Vector Search:**

Vector search allows semantic similarity matching using embeddings:[^6]

```typescript
async function performVectorSearch(
  searchClient: SearchClient<Document>,
  queryVector: number[]
) {
  try {
    const searchResults = await searchClient.search(undefined, {
      vectorSearchOptions: {
        queries: [
          {
            kind: "vector",
            vector: queryVector,
            fields: ["descriptionVector"],
            kNearestNeighborsCount: 5,
            exhaustive: true
          }
        ]
      },
      select: ["id", "title", "description", "category"],
      top: 5,
      includeTotalCount: true
    });

    console.log(`Vector search results:`);
    console.log(`Total matches: ${searchResults.count}`);

    for await (const result of searchResults.results) {
      console.log(`- ${result.document.title} (score: ${result.score})`);
    }
  } catch (error) {
    console.error("Error during vector search:", error);
  }
}
```

**Hybrid Search with Vector and Keyword:**

Hybrid search combines keyword and vector queries for optimal relevance:[^7]

```typescript
async function performHybridSearch(
  searchClient: SearchClient<Document>,
  searchQuery: string,
  queryVector: number[]
) {
  try {
    const searchResults = await searchClient.search(searchQuery, {
      vectorSearchOptions: {
        queries: [
          {
            kind: "vector",
            vector: queryVector,
            fields: ["descriptionVector"],
            kNearestNeighborsCount: 10,
            weight: 0.8
          }
        ]
      },
      queryType: "simple",
      searchMode: "all",
      select: ["id", "title", "description", "category"],
      filter: "category eq 'Tutorial'",
      top: 10,
      includeTotalCount: true
    });

    console.log(`Hybrid search results for "${searchQuery}":`);
    let count = 0;
    for await (const result of searchResults.results) {
      count++;
      console.log(`Result #${count}: ${result.document.title} (score: ${result.score})`);
    }
    console.log(`\nTotal results: ${count}`);
  } catch (error) {
    console.error("Error during hybrid search:", error);
  }
}
```

**Semantic Ranking:**

Semantic ranking uses machine reading comprehension to improve relevance:[^8]

```typescript
async function performSemanticSearch(
  searchClient: SearchClient<Document>,
  searchQuery: string
) {
  try {
    const searchResults = await searchClient.search(searchQuery, {
      queryType: "semantic",
      semanticSearchOptions: {
        configurationName: "semantic-config",
        captions: "extractive",
        answers: "extractive"
      },
      select: ["id", "title", "description", "category"],
      top: 10,
      includeTotalCount: true
    });

    console.log(`Semantic search results for "${searchQuery}":`);
    console.log(`Total count: ${searchResults.count}`);

    // Extract semantic answers if available
    if (searchResults.semanticSearch?.answers) {
      console.log("\nSemantic Answers:");
      for (const answer of searchResults.semanticSearch.answers) {
        console.log(`- ${answer.text} (highlight: ${answer.highlights})`);
      }
    }

    // Process results with captions
    for await (const result of searchResults.results) {
      console.log(`\nResult: ${result.document.title}`);
      console.log(`  Score: ${result.score}`);

      if (result.semanticSearch?.captions) {
        const caption = result.semanticSearch.captions[^0];
        console.log(`  Caption: ${caption.text}`);
      }
    }
  } catch (error) {
    console.error("Error during semantic search:", error);
  }
}
```

**Search with Filters and Facets:**

```typescript
async function performFilteredSearch(
  searchClient: SearchClient<Document>,
  searchQuery: string
) {
  try {
    const searchResults = await searchClient.search(searchQuery, {
      filter: "category eq 'Tutorial' or category eq 'Guide'",
      facets: ["category"],
      select: ["id", "title", "description", "category"],
      top: 20,
      includeTotalCount: true
    });

    console.log(`Filtered search results for "${searchQuery}":`);

    // Display results
    for await (const result of searchResults.results) {
      console.log(`- ${result.document.title} (category: ${result.document.category})`);
    }

    // Display facet counts
    if (searchResults.facets?.category) {
      console.log("\nCategory Facets:");
      for (const facet of searchResults.facets.category) {
        console.log(`  ${facet.value}: ${facet.count} documents`);
      }
    }
  } catch (error) {
    console.error("Error during filtered search:", error);
  }
}
```


### Advanced Scenarios

**Autocomplete Suggestions:**

```typescript
async function getAutocompleteSuggestions(
  searchClient: SearchClient<Document>,
  partialQuery: string,
  suggesterName: string = "sg"
) {
  try {
    const suggestions = await searchClient.autocomplete(partialQuery, suggesterName, {
      highlightPostTag: "</em>",
      highlightPreTag: "<em>"
    });

    console.log(`Autocomplete suggestions for "${partialQuery}":`);
    for (const suggestion of suggestions.results) {
      console.log(`- ${suggestion.text}`);
    }
  } catch (error) {
    console.error("Error getting autocomplete suggestions:", error);
  }
}
```

**Retrieving a Single Document:**

```typescript
async function getDocument(searchClient: SearchClient<Document>, docId: string) {
  try {
    const doc = await searchClient.getDocument(docId);
    console.log("Retrieved document:", doc);
    return doc;
  } catch (error) {
    console.error("Error retrieving document:", error);
  }
}
```

**Pagination:**

```typescript
async function performPaginatedSearch(
  searchClient: SearchClient<Document>,
  searchQuery: string,
  pageSize: number = 10
) {
  try {
    let skip = 0;
    let pageNumber = 1;

    while (true) {
      const searchResults = await searchClient.search(searchQuery, {
        skip: skip,
        top: pageSize,
        select: ["id", "title", "description"],
        includeTotalCount: true
      });

      if ((searchResults.results as any).length === 0) {
        break;
      }

      console.log(`\nPage ${pageNumber}:`);
      for await (const result of searchResults.results) {
        console.log(`- ${result.document.title}`);
      }

      skip += pageSize;
      pageNumber++;
    }
  } catch (error) {
    console.error("Error during paginated search:", error);
  }
}
```


### Complete Workflow Example

Here's a comprehensive example combining all operations:[^5][^3]

```typescript
async function runCompleteWorkflow() {
  try {
    // 1. Create index
    console.log("1. Creating index...");
    await createIndex(indexClient, indexName);

    // Wait for index to be ready
    await new Promise(resolve => setTimeout(resolve, 2000));

    // 2. Upload documents
    console.log("\n2. Uploading documents...");
    await uploadDocuments(searchClient);

    // Wait for documents to be indexed
    await new Promise(resolve => setTimeout(resolve, 2000));

    // 3. Perform keyword search
    console.log("\n3. Performing keyword search...");
    await performKeywordSearch(searchClient, "vector search");

    // 4. Perform semantic search
    console.log("\n4. Performing semantic search...");
    await performSemanticSearch(searchClient, "machine learning techniques");

    // 5. Perform filtered search
    console.log("\n5. Performing filtered search...");
    await performFilteredSearch(searchClient, "Azure", );

    // 6. Get single document
    console.log("\n6. Retrieving single document...");
    await getDocument(searchClient, "1");

    // 7. Update document
    console.log("\n7. Updating document...");
    await updateDocument(searchClient);

    // 8. Clean up (optional)
    console.log("\n8. Deleting index...");
    await deleteIndex(indexClient, indexName);

  } catch (error) {
    console.error("Workflow error:", error);
  }
}

// Run the workflow
runCompleteWorkflow();
```


### Error Handling and Best Practices

**Implement Robust Error Handling:**

```typescript
async function robustSearch(
  searchClient: SearchClient<Document>,
  query: string,
  maxRetries: number = 3
) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const results = await searchClient.search(query, {
        select: ["id", "title"],
        top: 10
      });
      return results;
    } catch (error: any) {
      if (attempt === maxRetries) {
        throw error;
      }

      // Exponential backoff
      const delay = Math.pow(2, attempt) * 1000;
      console.log(`Attempt ${attempt} failed. Retrying in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}
```

**Connection Best Practices:**

Use **DefaultAzureCredential** for production environments instead of API keys:[^9]

```typescript
import { DefaultAzureCredential } from "@azure/identity";

const credential = new DefaultAzureCredential();
const searchClient = new SearchClient(endpoint, indexName, credential);
```


### Key Considerations for 2025-08-01-preview

The 2025-08-01-preview API includes several important features:[^10][^11]

- **Knowledge Agents** now require `knowledgeSources` instead of `targetIndexes`
- **Vector dimensions** support up to 4096 (increased from previous limits)
- **Strict Post-Filtering** available through `strictPostFilter` mode for vector queries
- **Breaking Changes** from 2025-05-01-preview require migration of knowledge agent definitions


### Resources

- **NPM Package**: @azure/search-documents[^2]
- **API Reference**: Microsoft Learn JavaScript API docs[^12]
- **GitHub Samples**: azure-search-javascript-samples repository[^13]
- **SDK Source Code**: azure-sdk-for-js on GitHub[^1]

The TypeScript and JavaScript SDK provides a complete abstraction over the REST API, making it easier to build sophisticated search applications with modern JavaScript patterns while maintaining full compatibility with the 2025-08-01-preview REST schema.
<span style="display:none">[^14][^15][^16][^17][^18][^19][^20][^21][^22][^23][^24][^25][^26][^27][^28][^29][^30][^31][^32][^33][^34][^35]</span>

<div align="center">⁂</div>

[^1]: https://learn.microsoft.com/en-us/azure/search/samples-javascript

[^2]: https://www.npmjs.com/package/@azure/search-documents

[^3]: https://learn.microsoft.com/en-us/samples/azure-samples/azure-search-javascript-samples/javascript-quickstart/

[^4]: https://learn.microsoft.com/en-us/javascript/api/overview/azure/search-documents-readme?view=azure-node-latest

[^5]: https://docs.azure.cn/en-us/search/samples-javascript

[^6]: https://js.langchain.com/docs/integrations/vectorstores/azure_aisearch/

[^7]: https://docs.azure.cn/en-us/search/hybrid-search-how-to-query

[^8]: https://learn.microsoft.com/en-us/azure/search/search-get-started-semantic

[^9]: https://learn.microsoft.com/en-us/azure/search/search-get-started-text

[^10]: https://learn.microsoft.com/en-us/azure/search/whats-new

[^11]: https://learn.microsoft.com/en-us/rest/api/searchservice/search-service-api-versions

[^12]: https://learn.microsoft.com/en-us/javascript/api/@azure/search-documents/?view=azure-node-latest

[^13]: https://github.com/Azure-Samples/azure-search-javascript-samples

[^14]: https://learn.microsoft.com/en-us/azure/search/search-api-preview

[^15]: https://docs.azure.cn/en-us/search/search-api-preview

[^16]: https://learn.microsoft.com/en-us/azure/search/search-get-started-vector

[^17]: https://neon.com/guides/azure-ai-search

[^18]: https://stackoverflow.com/questions/79328696/azure-cognitive-vector-search-query-and-index-creation

[^19]: https://docs.azure.cn/en-us/search/vector-search-how-to-query

[^20]: https://stackoverflow.com/questions/78593801/azure-search-documents-vector-search-successful-but-response-is-null

[^21]: https://learn.microsoft.com/en-us/azure/search/samples-rest

[^22]: https://github.com/Azure/azure-search-vector-samples

[^23]: https://stackoverflow.com/questions/46714067/how-to-get-a-link-to-fetch-next-records-from-azure-search

[^24]: https://stackoverflow.com/questions/77613936/how-to-create-a-vector-search-index-in-azure-ai-search-using-v11-4-0

[^25]: https://learn.microsoft.com/en-us/azure/search/semantic-how-to-query-request

[^26]: https://learn.microsoft.com/en-us/rest/api/searchservice/documents/search-get?view=rest-searchservice-2025-09-01

[^27]: https://learn.microsoft.com/en-us/azure/search/search-security-api-keys

[^28]: https://learn.microsoft.com/en-us/azure/search/search-how-to-create-search-index

[^29]: https://docs.azure.cn/en-us/search/semantic-how-to-configure

[^30]: https://docs.azure.cn/en-us/search/search-add-autocomplete-suggestions

[^31]: https://learn.microsoft.com/en-us/azure/search/search-get-started-agentic-retrieval

[^32]: https://learn.microsoft.com/en-us/azure/search/hybrid-search-how-to-query

[^33]: https://docs.azure.cn/en-us/search/search-get-started-agentic-retrieval

[^34]: https://learn.microsoft.com/en-us/azure/ai-foundry/agents/quickstart

[^35]: https://github.com/Azure-Samples/azure-search-openai-javascript

