# Cloudflare Workers Deployment - Quick Start

Deploy your Agentic RAG application to Cloudflare Workers in 5 minutes.

> **📚 For detailed architecture and migration information, see [docs/CLOUDFLARE.md](./docs/CLOUDFLARE.md)**

## Prerequisites

1. **Cloudflare Account** - Sign up at https://dash.cloudflare.com
2. **Node.js** - v18 or higher
3. **Wrangler CLI** - Installed as dev dependency

## Quick Setup (5 Steps)

### 1. Install Dependencies

```bash
npm install
```

### 2. Authenticate with Cloudflare

```bash
npx wrangler login
```

This opens your browser to authorize Wrangler.

### 3. Create KV Namespaces

```bash
# Create production namespace
npm run cf:kv:create

# Create preview namespace
npm run cf:kv:create:preview
```

You'll see output like:
```
✨ Success!
Add the following to your wrangler.toml:
{ binding = "RAG_KV", id = "a1b2c3d4e5f6..." }
```

### 4. Update wrangler.toml

Copy the namespace IDs from step 3 into `wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "RAG_KV"
id = "your-production-id-here"  # From npm run cf:kv:create
preview_id = "your-preview-id-here"  # From npm run cf:kv:create:preview
```

### 5. Deploy

```bash
# Deploy to production
npm run cf:deploy

# Or deploy to staging first
npm run cf:deploy:staging
```

**Done!** Your app is now live at `https://agentic-rag.workers.dev`

## Storage Modes

The app automatically detects which storage to use:

1. **Cloudflare Workers** (deployed) - Direct KV binding via `/api/kv`
2. **Cloudflare KV REST API** (local with env vars) - Uses REST API
3. **localStorage** (fallback) - Browser storage when Cloudflare not configured

## Basic Commands

```bash
# Development
npm run dev              # Local Vite dev server
npm run cf:dev          # Wrangler dev server (simulates Workers)

# Deployment
npm run cf:deploy       # Deploy to production
npm run cf:deploy:staging  # Deploy to staging

# Monitoring
npm run cf:tail         # View real-time logs

# KV Management
npx wrangler kv:key list --binding RAG_KV
npx wrangler kv:key get "rag-documents" --binding RAG_KV
```

## Environment Variables (Optional)

### For Local Development with REST API

Create `.env` file:

```bash
# Get Account ID from Cloudflare Dashboard > Workers & Pages
VITE_CLOUDFLARE_ACCOUNT_ID=your_account_id

# Get from step 3
VITE_CLOUDFLARE_KV_NAMESPACE_ID=your_namespace_id

# Create API token at: https://dash.cloudflare.com/profile/api-tokens
# Permissions needed: "Workers KV Storage:Edit"
VITE_CLOUDFLARE_API_TOKEN=your_api_token
```

### For Production (Deployed Workers)

Set secrets (NOT in .env):

```bash
# Azure OpenAI (optional)
npx wrangler secret put VITE_AZURE_OPENAI_KEY

# Azure AI Search (optional)
npx wrangler secret put VITE_AZURE_SEARCH_KEY
```

## Quick Troubleshooting

### "Integration auth is not supported"
Make sure you've configured Cloudflare credentials in `.env` OR deployed to Workers.

### "Failed to persist localStorage"
localStorage quota exceeded (5-10MB). Deploy to Cloudflare Workers for 25MB per value.

### Build Errors
```bash
rm -rf node_modules/.vite
npm run build
```

### Worker Not Serving Assets
Make sure `dist/` directory exists:
```bash
npm run build
ls -la dist/
```

## Cost Estimate

**Cloudflare Workers Free Tier:**
- ✅ 100,000 requests/day
- ✅ KV: 100,000 reads/day, 1,000 writes/day
- ✅ CPU: 10ms per request

Your app should easily fit within free tier for personal/development use.

**Paid tier** ($5/month):
- 10M requests/month
- Unlimited KV operations (pay per use: $0.50/million reads)

## Next Steps

1. **Configure Azure Services** (optional): Navigate to Azure tab in your app
2. **Upload Documents**: Use the Upload tab
3. **Custom Domain**: Add custom domain in Cloudflare dashboard
4. **Monitor**: View logs with `npm run cf:tail`

## Need More Help?

- **Architecture Deep Dive**: [docs/CLOUDFLARE.md](./docs/CLOUDFLARE.md)
- **Cloudflare Workers Docs**: https://developers.cloudflare.com/workers/
- **KV Documentation**: https://developers.cloudflare.com/kv/
- **Wrangler CLI**: https://developers.cloudflare.com/workers/wrangler/
