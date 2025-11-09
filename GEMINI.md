# Project Overview

This project is an enterprise-grade intelligent knowledge assistant that uses a multi-agent system for advanced document retrieval and question answering. It is built with React, TypeScript, and Vite on the frontend, and Cloudflare Workers for the backend. It also has optional integration with Azure OpenAI and Azure AI Search.

The application features a multi-agent system for intelligent query classification, planning, routing, and validation. It supports multi-source ingestion from file uploads, GitHub repositories, websites, Dropbox, and OneDrive. The retrieval system uses a hybrid approach with semantic and keyword search, along with Reciprocal Rank Fusion (RRF).

## Building and Running

### Installation

```bash
npm install
```

### Development

To run the development server, use the following command:

```bash
npm run dev
```

### Build

To build the project for production, use the following command:

```bash
npm run build
```

### Testing

To run the test suite, use the following command:

```bash
npm run test
```

### Linting

To lint the codebase, use the following command:

```bash
npm run lint
```

### Deployment

The project is designed to be deployed to Cloudflare Workers. The following scripts are available for deployment:

- `npm run cf:dev`: Start a local development server for the Cloudflare Worker.
- `npm run cf:deploy`: Deploy the worker to Cloudflare.
- `npm run cf:deploy:staging`: Deploy the worker to the staging environment.
- `npm run cf:deploy:production`: Deploy the worker to the production environment.

## Development Conventions

The project follows standard conventions for a React/TypeScript project. It uses ESLint for linting and Vitest for testing. The codebase is organized into `src`, `docs`, and `test` directories.

- `src`: Contains the main application source code, including React components, hooks, and utility functions.
- `docs`: Contains technical documentation, including architecture diagrams and design documents.
- `test`: Contains the test suite for the project.

The project uses a path alias `@` for the `src` directory, which is configured in `vite.config.ts` and `tsconfig.json`.
