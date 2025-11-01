# Agentic RAG Application

An intelligent knowledge assistant built on GitHub Spark with multi-agent orchestration for advanced document retrieval and question answering.

## Overview

This application combines Retrieval-Augmented Generation (RAG) with a sophisticated multi-agent system to provide intelligent responses from your document corpus. It supports multiple data sources, intelligent chunking strategies, and optional Azure AI Search integration.

## Key Features

- **Multi-source ingestion**: Upload files, GitHub repos, websites, Dropbox, OneDrive
- **Intelligent agents**: Query planning, routing, expansion, and response refinement
- **Advanced retrieval**: Semantic, keyword, and hybrid search strategies
- **Azure integration**: Optional Azure OpenAI embeddings and AI Search indexing
- **Production-ready**: Caching, metrics, and scalability features

## Quick Start

```bash
npm install
npm run dev
```

## Documentation

- **[CLAUDE.md](./CLAUDE.md)** - Development guide and architecture overview
- **[PRD.md](./PRD.md)** - Comprehensive product requirements
- **[AGENTIC_RAG.md](./AGENTIC_RAG.md)** - Multi-agent system details
- **[AZURE_EMBEDDING_OPTIMIZATION.md](./AZURE_EMBEDDING_OPTIMIZATION.md)** - Azure AI Search optimization
- **[LAYER_UPGRADES_GUIDE.md](./LAYER_UPGRADES_GUIDE.md)** - Advanced features and scaling

## Tech Stack

React 19 • TypeScript • Vite • Tailwind CSS 4 • Radix UI • GitHub Spark • Azure AI (optional)

## License

MIT
