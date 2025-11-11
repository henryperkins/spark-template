# Comprehensive Issue List & Prioritization from currentplan.md

I've extracted and categorized all issues from the document. Here's the complete prioritized list:

## **Critical Issues (P1) - Immediate Action Required**

### 1. **OAuth Token Refresh Implementation** (RICE: 70-80)
- **Category**: Security
- **Problem**: OneDrive/Dropbox tokens expire (1 hour) with no refresh logic
- **Impact**: Integrations break, poor UX, security risk
- **Action**: Store refresh tokens, implement automatic refresh on 401 errors
- **Files**: [`worker/oauth-handler.ts`](worker/oauth-handler.ts:295), [`src/hooks/use-oauth.ts`](src/hooks/use-oauth.ts:182)

### 2. **Keyboard Accessibility for AgentWorkflowVisualizer** (RICE: 90-95)
- **Category**: Accessibility (WCAG 2.2 blocker)
- **Problem**: Step toggles not keyboard accessible (not `<button>` elements)
- **Impact**: WCAG 2.2 compliance failure, blocks users with disabilities
- **Action**: Convert to `<button>`, add `aria-expanded`, keyboard handlers
- **Files**: [`src/components/AgentWorkflowVisualizer.tsx`](src/components/AgentWorkflowVisualizer.tsx:192)

### 3. **Bundle Splitting & Code Splitting** (RICE: 90-100)
- **Category**: Performance
- **Problem**: 700KB+ initial JS load, all features load unconditionally
- **Impact**: LCP ~3.5s, poor mobile performance
- **Action**: Route-level dynamic imports for Integrations/Dashboard
- **Files**: [`vite.config.analyze.ts`](vite.config.analyze.ts:20), [`src/components/Integrations.tsx`](src/components/Integrations.tsx:24)

### 4. **Error Boundaries Implementation** (RICE: 65)
- **Category**: Maintainability/UX
- **Problem**: No error boundaries, runtime errors white-screen the app
- **Impact**: Poor error recovery, debugging difficulty
- **Action**: Wrap major modules (Chat, Documents, Integrations) with ErrorBoundary
- **Files**: App root component

### 5. **Token Encryption Hardening** (RICE: 40)
- **Category**: Security
- **Problem**: Static salt (16 zero bytes) in PBKDF2 weakens encryption
- **Impact**: Reduced token security, potential vulnerability
- **Action**: Use random salt per token or stronger KDF
- **Files**: [`src/lib/services/secure-token-storage.ts`](src/lib/services/secure-token-storage.ts:53)

---

## **High Priority Issues (P2) - Next 2-4 Weeks**

### 6. **Toast/Alert Accessibility** (RICE: 50-85)
- **Category**: Accessibility
- **Problem**: Toasts lack ARIA live regions, screen readers miss updates
- **Action**: Add `role="status"` (success) and `role="alert"` (errors)
- **Files**: All toast calls across components

### 7. **Vendor Library Optimization** (RICE: 80)
- **Category**: Performance
- **Problem**: Phosphor icons (85KB) and Azure SDK (70KB) loaded entirely
- **Action**: Tree-shake icons, defer Azure SDK until needed
- **Files**: [`vite.config.analyze.ts`](vite/config.analyze.ts:22)

### 8. **Main Thread Offloading** (RICE: 70)
- **Category**: Performance
- **Problem**: PDF parsing, chunking runs on UI thread causing jank
- **Action**: Move to Web Workers, use `useTransition` for state updates
- **Files**: [`src/components/DocumentUpload.tsx`](src/components/DocumentUpload.tsx:116)

### 9. **OAuth for Dropbox/OneDrive UI** (RICE: 90)
- **Category**: UX/Security
- **Problem**: Manual token entry, no persistence, inconsistent with GitHub
- **Action**: Implement OAuth flow UI using existing PKCE backend
- **Files**: [`src/components/DropboxIngestion.tsx`](src/components/DropboxIngestion.tsx:90), [`src/components/OneDriveIngestion.tsx`](src/components/OneDriveIngestion.tsx:92)

### 10. **Duplicate File Detection** (RICE: 50-70)
- **Category**: UX
- **Problem**: Same file can be uploaded multiple times, no warning
- **Action**: Compute file hash (MD5) or use name+size heuristic
- **Files**: [`src/components/DocumentUpload.tsx`](src/components/DocumentUpload.tsx:229)

---

## **Medium Priority Issues (P3) - 4-8 Weeks**

### 11. **Screen Reader Feedback for Dynamic Content** (RICE: 50)
- **Category**: Accessibility
- **Problem**: Answer streaming, toasts not announced
- **Action**: `aria-live` regions for chat, toast ARIA roles

### 12. **Upload Manager UI** (RICE: 50)
- **Category**: UX
- **Problem**: No visibility into ongoing uploads after refresh
- **Action**: Persistent panel showing upload progress, pause/resume
- **Files**: [`src/hooks/use-upload-queue.ts`](src/hooks/use-upload-queue.ts:261)

### 13. **TypeScript Strictness** (RICE: 30-60)
- **Category**: Maintainability
- **Problem**: `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` disabled
- **Action**: Enable flags, fix 77+ errors, add proper guards
- **Files**: [`tsconfig.json`](tsconfig.json:22)

### 14. **Sentry Integration** (RICE: 45-50)
- **Category**: Observability
- **Problem**: No external monitoring, errors only in memory
- **Action**: Add Sentry to Worker and React app
- **Files**: Worker error handlers, React error boundary

### 15. **CSP & Security Headers** (RICE: 30-55)
- **Category**: Security
- **Problem**: No Content Security Policy, missing secure headers
- **Action**: Add CSP, X-Frame-Options, X-Content-Type-Options via Worker
- **Files**: [`worker/index.ts`](worker/index.ts:44)

### 16. **Rate Limit Handling** (RICE: Not scored)
- **Category**: UX/Reliability
- **Problem**: GitHub API rate limits not handled gracefully
- **Action**: Parse rate limit headers, show user-friendly messages
- **Files**: [`src/lib/integrations/github-service.ts`](src/lib/integrations/github-service.ts)

### 17. **File Type Validation** (RICE: Not scored)
- **Category**: UX
- **Problem**: Unsupported files (.docx) silently skipped
- **Action**: Explicit error messages for unsupported types
- **Files**: [`src/components/DocumentUpload.tsx`](src/components/DocumentUpload.tsx:229)

### 18. **QueryInterface Input Management** (RICE: 60)
- **Category**: UX
- **Problem**: Input clears before streaming starts, lost on error
- **Action**: Keep input until streaming confirmed, restore on error
- **Files**: [`src/components/QueryInterface.tsx`](src/components/QueryInterface.tsx:70)

---

## **Lower Priority Issues (P4) - Strategic/Refactor**

### 19. **Real-Time SSE for Metrics** (RICE: 40-80)
- **Category**: Performance/UX
- **Problem**: Polling every 5s inefficient, not real-time
- **Action**: Implement Server-Sent Events for dashboard updates
- **Files**: [`src/components/ScalingDashboard.tsx`](src/components/ScalingDashboard.tsx:72)

### 20. **Integration Source Management UI** (RICE: 75)
- **Category**: UX
- **Problem**: No persistent view of connected integrations
- **Action**: Build overview page with sync status, last updated
- **Files**: [`src/types/index.ts`](src/types/index.ts:204)

### 21. **User Authentication & RBAC** (RICE: 60)
- **Category**: Security
- **Problem**: No user accounts, global KV_API_KEY exposure risk
- **Action**: Implement auth system (Azure AD, etc.), role-based access
- **Files**: Worker auth checks, frontend login flow

### 22. **State Management Refactor** (RICE: 70)
- **Category**: Maintainability
- **Problem**: Prop drilling, multiple contexts, no global store
- **Action**: Migrate to Zustand or Redux for cross-cutting state
- **Files**: Multiple component files

### 23. **Offline-Capable Mode** (RICE: 60)
- **Category**: UX
- **Problem**: No service worker, can't work offline
- **Action**: Implement service worker for asset caching, offline reads
- **Files**: New service worker file

### 24. **Auto-Sync for Integrations** (RICE: 55)
- **Category**: Feature
- **Problem**: Manual one-time ingestion only
- **Action**: Webhooks for GitHub, scheduled crawls for websites
- **Files**: Worker cron triggers, webhook handlers

### 25. **Durable Objects Implementation** (RICE: 50)
- **Category**: Architecture
- **Problem**: No rate limiting, heavy tasks on client
- **Action**: Use Durable Objects for rate limiting, workflow orchestration
- **Files**: New Durable Object classes

---

## **Quick Reference: Top 10 Action Items**

| # | Issue | Priority | Effort | Owner |
|---|-------|----------|--------|-------|
| 1 | OAuth token refresh | P1 | 2 weeks | Backend |
| 2 | Keyboard accessibility | P1 | 1-2 weeks | Frontend |
| 3 | Bundle/code splitting | P1 | 1-2 weeks | Frontend |
| 4 | Error boundaries | P1 | 1 week | Frontend |
| 5 | Token encryption hardening | P1 | 1 week | Security |
| 6 | Toast ARIA roles | P2 | Few days | Frontend |
| 7 | Vendor library optimization | P2 | 2 weeks | Frontend |
| 8 | Web Workers for heavy tasks | P2 | 1 week | Frontend |
| 9 | OAuth UI for Dropbox/OneDrive | P2 | 2 weeks | Frontend |
| 10 | Duplicate file detection | P2 | 1 week | Frontend |

## **Implementation Roadmap**

### **Sprint 1-2 (Immediate)**
- Fix OAuth token refresh (#1)
- Implement keyboard accessibility (#2)
- Add error boundaries (#4)
- Harden token encryption (#5)

### **Sprint 3-4**
- Complete bundle splitting (#3)
- Add toast ARIA roles (#6)
- Implement OAuth UI for Dropbox/OneDrive (#9)
- Add duplicate file detection (#10)

### **Sprint 5-8**
- Optimize vendor libraries (#7)
- Offload main thread work (#8)
- Implement upload manager UI (#12)
- Add Sentry integration (#14)

### **Quarter 2**
- TypeScript strictness (#13)
- CSP & security headers (#15)
- SSE for real-time metrics (#19)
- Integration source management (#20)

This prioritization balances security risks, accessibility compliance, performance impact, and user experience improvements.
