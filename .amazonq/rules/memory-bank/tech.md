# Technology Stack

## Programming Languages
- **TypeScript 5.7.2** - Primary language for type-safe development
- **TSX/JSX** - React component syntax

## Core Frameworks & Libraries

### Frontend Framework
- **React 19.0.0** - UI component library
- **React DOM 19.0.0** - React rendering for web
- **Vite 6.3.5** - Build tool and development server

### UI Component Libraries
- **Radix UI** - Accessible, unstyled component primitives
  - Dialog, Dropdown, Popover, Tabs, Accordion, Select, and 20+ other components
- **shadcn/ui** - Pre-styled Radix UI components (via components.json)
- **Lucide React 0.484.0** - Icon library
- **Phosphor Icons 2.1.7** - Additional icon set
- **Framer Motion 12.6.2** - Animation library

### Styling
- **Tailwind CSS 4.1.11** - Utility-first CSS framework
- **@tailwindcss/vite 4.1.11** - Vite integration
- **class-variance-authority 0.7.1** - Component variant management
- **tailwind-merge 3.0.2** - Tailwind class merging utility

### State Management & Data Fetching
- **TanStack React Query 5.83.1** - Server state management and caching
- **React Hook Form 7.54.2** - Form state management
- **@hookform/resolvers 4.1.3** - Form validation resolvers
- **Zod 3.25.76** - Schema validation

### Azure Services
- **@github/spark 0.39.0** - GitHub Spark framework for KV storage and runtime
- **Azure OpenAI** - Embeddings and completions (via REST API)
- **Azure AI Search** - Vector and hybrid search (via REST API)

### External Integrations
- **Octokit 4.1.2** - GitHub API client
- **@octokit/core 6.1.4** - GitHub API core
- Microsoft Graph API - OneDrive integration (via fetch)
- Dropbox API - File synchronization (via fetch)

### Utilities
- **marked 15.0.7** - Markdown parsing
- **date-fns 3.6.0** - Date manipulation
- **uuid 11.1.0** - Unique identifier generation
- **d3 7.9.0** - Data visualization for architecture diagrams
- **three 0.175.0** - 3D graphics (if used for visualizations)

### UI Enhancement
- **sonner 2.0.1** - Toast notifications
- **next-themes 0.4.6** - Theme management
- **react-resizable-panels 2.1.7** - Resizable layout panels
- **vaul 1.1.2** - Drawer component
- **cmdk 1.1.1** - Command menu
- **recharts 2.15.1** - Chart library for metrics
- **embla-carousel-react 8.5.2** - Carousel component

## Development Tools

### Build & Bundling
- **Vite 6.3.5** - Fast build tool with HMR
- **@vitejs/plugin-react 4.3.4** - React plugin for Vite
- **@vitejs/plugin-react-swc 3.10.1** - SWC-based React plugin (faster)

### Code Quality
- **ESLint 9.28.0** - JavaScript/TypeScript linter
- **@eslint/js 9.21.0** - ESLint JavaScript rules
- **typescript-eslint 8.38.0** - TypeScript ESLint integration
- **eslint-plugin-react-hooks 5.2.0** - React Hooks linting
- **eslint-plugin-react-refresh 0.4.19** - React Fast Refresh linting

### Type Checking
- **TypeScript 5.7.2** - Static type checking
- **@types/react 19.0.10** - React type definitions
- **@types/react-dom 19.0.4** - React DOM type definitions

## Development Commands

### Local Development
```bash
npm run dev          # Start Vite dev server (default port 5173)
npm run preview      # Preview production build
```

### Build & Optimization
```bash
npm run build        # TypeScript compilation + Vite production build
npm run optimize     # Vite dependency pre-bundling optimization
```

### Code Quality
```bash
npm run lint         # Run ESLint on codebase
```

### Utilities
```bash
npm run kill         # Kill process on port 5000 (fuser -k 5000/tcp)
```

## Configuration Files

### Build Configuration
- `vite.config.ts` - Vite bundler settings, plugins, and aliases
- `tsconfig.json` - TypeScript compiler options and paths

### Styling Configuration
- `tailwind.config.js` - Tailwind CSS customization
- `theme.json` - Design system theme tokens
- `components.json` - shadcn/ui component configuration

### Runtime Configuration
- `runtime.config.json` - Spark runtime settings
- `spark.meta.json` - Spark metadata

### Package Management
- `package.json` - Dependencies, scripts, and workspace configuration
- `package-lock.json` - Locked dependency versions

## Environment Requirements
- **Node.js** - Version compatible with React 19 and Vite 6 (Node 18+)
- **npm** - Package manager (comes with Node.js)
- **Azure Subscription** - Required for Azure OpenAI and Azure AI Search services

## API Dependencies
- **Azure OpenAI API** - Embeddings (text-embedding-ada-002) and completions (GPT-4)
- **Azure AI Search API** - Vector search, hybrid search with RRF, semantic ranking
- **GitHub API** - Repository content access (public and private with token)
- **Microsoft Graph API** - OneDrive file access (requires OAuth token)
- **Dropbox API** - File synchronization (requires OAuth token)
