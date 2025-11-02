# Agentic RAG Knowledge Assistant

An enterprise-grade intelligent knowledge assistant built on GitHub Spark with multi-agent orchestration for advanced document retrieval and question answering.

## Features

- **🤖 Multi-Agent System**: Intelligent query classification, planning, routing, and validation
- **📚 Multi-Source Ingestion**: Upload files, GitHub repos, websites, Dropbox, OneDrive
- **🔍 Advanced Retrieval**: Semantic, keyword, and hybrid search with RRF fusion
- **☁️ Azure Integration**: Optional Azure OpenAI embeddings and AI Search with semantic ranking
- **⚡ Production-Ready**: Caching, compression, namespacing, and scalability features
- **📊 Quality Metrics**: Faithfulness and relevance scoring with transparent agent workflows

## Quick Start

### Installation

```bash
npm install
```

### Development

```bash
npm run dev        # Start development server
npm run build      # Build for production
npm run lint       # Check code quality
```

### Basic Usage

1. **Configure Azure (Optional)**: Navigate to the Azure tab to connect your Azure OpenAI and AI Search services
2. **Upload Documents**: Use the Upload tab to add documents, or use Integrations for GitHub/web content
3. **Query**: Ask questions in the Query tab with Agentic Mode enabled for best results

## Tech Stack

**Frontend**: React 19 • TypeScript • Vite 6 • Tailwind CSS 4 • Radix UI • Phosphor Icons
**Platform**: GitHub Spark (KV store, LLM integration)
**AI Services**: Azure OpenAI • Azure AI Search (optional)
**Architecture**: Multi-agent RAG with orchestration, caching, and streaming

## Documentation

### 🚀 Quick Start
- **[README.md](./README.md)** - Project overview and quick start (you are here)
- **[CLOUDFLARE.md](./CLOUDFLARE.md)** - Deploy to Cloudflare Workers (5-minute guide)

### 👨‍💻 Developer Guides
- **[CLAUDE.md](./CLAUDE.md)** - Claude Code developer reference
- **[PRD.md](./PRD.md)** - Product requirements and specifications

### 🏗️ Architecture & Design
- **[docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)** - Multi-agent system design patterns
- **[docs/context-architecture.md](./docs/context-architecture.md)** - Context flow and state management
- **[docs/prompt-engineering.md](./docs/prompt-engineering.md)** - Agent prompt engineering guide
- **[docs/CLOUDFLARE.md](./docs/CLOUDFLARE.md)** - Cloudflare architecture deep dive

### 🔧 Production Features
- **[docs/OBSERVABILITY.md](./docs/OBSERVABILITY.md)** - Observability and monitoring layer
- **[docs/LAYER_UPGRADES.md](./docs/LAYER_UPGRADES.md)** - Production upgrades (Layers 6-8)

### ☁️ Azure Integration
- **[docs/AZURE_OPTIMIZATION.md](./docs/AZURE_OPTIMIZATION.md)** - Azure AI Search optimization

### 📦 Archives
- **[docs/archive/](./docs/archive/)** - Historical documentation and audits

## Project Structure

```
spark-template/
├── src/
│   ├── components/        # React components
│   ├── lib/
│   │   ├── agents/       # Agent implementations
│   │   ├── azure-*.ts    # Azure service integrations
│   │   └── *.ts          # Core utilities
│   ├── hooks/            # Custom React hooks
│   └── types/            # TypeScript type definitions
├── docs/                 # Technical documentation
└── [config files]        # Build and tool configurations
```

## Key Concepts

### Agentic Mode

When enabled (default), queries flow through a sophisticated agent pipeline:
1. **Classifier Agent**: Analyzes query complexity
2. **Planner Agent**: Decomposes complex queries into sub-queries
3. **Routing Agent**: Selects optimal retrieval strategy
4. **Critic Agent**: Validates response quality
5. **ReAct Agent**: Iteratively refines responses

### Data Sources

- **Upload**: Direct file upload (.txt, .md, .pdf)
- **GitHub**: Repository content ingestion
- **Website**: Web scraping with configurable depth
- **Dropbox**: Cloud storage integration
- **OneDrive**: Microsoft cloud storage integration

## License

MIT
