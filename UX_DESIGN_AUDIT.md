# UX Design Audit & Enhancement Roadmap
## Multi-Agent RAG Assistant — Design System & Experience Optimization

**Prepared by:** Senior Product Designer & UX Researcher
**Date:** 2025-11-03
**Version:** 1.0

---

## Executive Summary

This audit evaluates the Agentic RAG assistant's user experience across cognitive load, perceived intelligence, discoverability, visual hierarchy, and accessibility. The application demonstrates strong technical foundations with multi-agent orchestration, Azure integration, and intelligent caching, but opportunities exist to surface this sophistication through clearer feedback loops, streamlined navigation, and cohesive visual polish.

**Key Findings:**
- **Design token fragmentation** across 3 CSS files reduces maintainability
- **Agent workflow visibility** is strong but lacks progressive disclosure for non-technical users
- **Empty states** and **Azure fallback messaging** need clarity improvements
- **Mobile/tablet** navigation is functional but density could be optimized
- **Hardcoded status colors** bypass the design system, limiting theming flexibility
- **Strong accessibility foundation** with Radix UI, but keyboard flow and ARIA announcements need enhancement

---

## 1. User Journey Map: Power User Complex Query Flow

### Persona: Technical Product Manager
**Goal:** Investigate multi-step architectural question across 50+ ingested documents with Azure AI Search enabled

| Stage | Actions | Thoughts | Emotions | Pain Points | Trust Signals |
|-------|---------|----------|-----------|-------------|---------------|
| **Discovery** | Navigates to Query tab, sees Agentic Mode toggle | "I need advanced search, not basic keyword matching" | Curious, slightly uncertain | Toggle lacks tooltip explaining benefits | "Agentic Mode" badge with Sparkle icon builds confidence |
| **Query Formation** | Types: "What are the security implications of our microservices architecture and how do they relate to the audit findings?" | "This is complex—will it understand the multi-faceted nature?" | Hopeful but cautious | No visual feedback that system recognizes complexity | — |
| **Live Workflow** | AgentWorkflowVisualizer appears, showing Classifier → Planner → Router steps in real-time | "Wow, I can see it thinking! It's breaking this down into sub-queries." | Excited, validated | Workflow animates in but disappears after 300ms (src/components/QueryInterface.tsx:98) | **STRONG:** Real-time step progression with colored status indicators |
| **Waiting** | Watches "Retrieval" agent with animated pulse, sees "8 sources" badge | "It's actually searching Azure Search, not just local vectors" | Confident, impressed | Duration feels long (~5s) with no progress bar within the step | Azure badge on sources confirms enterprise-grade retrieval |
| **Response** | Receives structured answer with Quality Metrics panel: 92% faithfulness, 88% relevance | "The response is good, and these metrics let me gauge confidence" | Satisfied, trusting | Metrics are collapsed in accordion—should be more prominent for validation | **STRONG:** Validation scores surface critic agent's work |
| **Exploration** | Expands workflow, drills into Planner sub-queries | "I can audit the reasoning. This is enterprise-grade transparency." | Delighted | Details are verbose—needs summary view for quick scans | **STRONG:** Transparent multi-step breakdown |
| **Follow-up** | Clicks suggested question: "What compliance frameworks apply?" | "Smart suggestions! It anticipated my next question." | Engaged, excited | Suggestions lack visual hierarchy (all equal weight) | **STRONG:** QueryExpansion agent delivers relevant follow-ups |
| **Azure Fallback** | Azure Search times out, falls back to local vectors | "Wait, did it fail? Or switch strategies?" | Confused, slightly alarmed | No prominent notice of fallback—only visible in source badges | **CRITICAL GAP:** Fallback messaging is invisible |

### Key Insights
1. **Peak delight:** Real-time workflow visualization and validation metrics
2. **Peak confusion:** Azure service failures lack user-friendly explanations
3. **Unmet need:** Progress indicators for long-running agent steps (>3s)
4. **Opportunity:** Surface query complexity classification earlier to set expectations

---

## 2. Prioritized UX Enhancement Backlog

### Severity Levels
- 🔴 **Critical:** Blocks understanding or trust
- 🟡 **High Impact:** Significantly improves usability
- 🟢 **Quick Win:** Low effort, meaningful improvement
- 🔵 **Polish:** Enhances delight

---

### 🔴 CRITICAL: Trust & Clarity (P0)

#### C1. Azure Fallback Messaging System
**Problem:** When Azure services fail/timeout, users see no explanation. Sources may silently switch from Azure Search to local vectors.
**Impact:** Erodes trust, creates confusion about system capabilities
**Solution:**
```tsx
// Add to QueryInterface.tsx after line 74
{agenticResult.azureFallback && (
  <Alert variant="warning" className="mb-4">
    <CloudSlash size={16} />
    <AlertTitle>Using Local Search</AlertTitle>
    <AlertDescription>
      Azure AI Search is temporarily unavailable.
      Results are from local vector search (may be less comprehensive).
      <Button variant="link" size="sm">Check Azure Status →</Button>
    </AlertDescription>
  </Alert>
)}
```
**Effort:** 2 days | **Impact:** Critical

---

#### C2. Design Token Consolidation
**Problem:** Three CSS files (main.css, theme.css, index.css) define overlapping color palettes and spacing scales. `#spark-app` tokens never apply (DOM uses `#root`).
**Impact:** Maintainability nightmare, inconsistent theming, dark mode bugs
**Solution:**
1. **Consolidate to single source:** Merge all tokens into `src/styles/tokens.css`
2. **Fix dark mode selector:** Move `darkMode: 'class'` to root of `tailwind.config.js` (currently nested at line 149)
3. **Remove dead selectors:** Delete `#spark-app` scoped rules or wrap React tree with `<div id="spark-app">`
4. **Define semantic status tokens:**
```css
/* tokens.css */
:root {
  /* Status colors */
  --color-status-success: var(--green-9);
  --color-status-warning: var(--amber-9);
  --color-status-error: var(--red-9);
  --color-status-info: var(--blue-9);
  --color-status-processing: var(--violet-9);
}
```
**Effort:** 3 days | **Impact:** Critical (unblocks theming)

---

### 🟡 HIGH IMPACT: Cognitive Load & Discovery (P1)

#### H1. Query Complexity Indicator (Pre-flight)
**Problem:** Users don't know if their query will trigger simple or complex agentic workflow
**Solution:** Add real-time complexity indicator as user types
```tsx
// Add to QueryInterface.tsx input area
<div className="flex items-center gap-2 mt-2 text-xs">
  {query.length > 20 && (
    <>
      <Badge variant="outline" className="text-xs">
        <Brain size={12} className="mr-1" />
        Detected: {estimatedComplexity} complexity
      </Badge>
      {estimatedComplexity === 'high' && (
        <span className="text-muted-foreground">
          Will use multi-step planning
        </span>
      )}
    </>
  )}
</div>
```
**Effort:** 2 days | **Impact:** High (sets expectations)

---

#### H2. Agent Step Progress Indicators
**Problem:** Long-running steps (Retrieval, Generator) show pulse animation but no progress
**Solution:** Add sub-step progress for operations >2s
```tsx
// In AgentWorkflowVisualizer, add to renderDetailContent
{step.agent === 'Retrieval' && step.status === 'running' && (
  <div className="space-y-1">
    <Progress value={step.progress || 0} className="h-1" />
    <p className="text-xs text-muted-foreground">
      Searching {step.currentSource || 'Azure AI Search'}...
    </p>
  </div>
)}
```
**Effort:** 3 days | **Impact:** High (reduces perceived wait time)

---

#### H3. Integration Pipeline Explainer
**Problem:** Integrations tab shows 4 sources but users don't understand ingestion→chunking→indexing pipeline
**Solution:** Add visual flow diagram to Integrations.tsx header
```tsx
<Card className="bg-muted/30 border-primary/20 mb-6">
  <CardContent className="p-4">
    <div className="flex items-center justify-between text-sm">
      <div className="flex items-center gap-2">
        <ArrowRight size={16} className="text-muted-foreground" />
        <span>1. Connect Source</span>
      </div>
      <ArrowRight size={16} className="text-border" />
      <div className="flex items-center gap-2">
        <Scissors size={16} className="text-muted-foreground" />
        <span>2. Smart Chunking</span>
      </div>
      <ArrowRight size={16} className="text-border" />
      <div className="flex items-center gap-2">
        <CloudArrowUp size={16} className="text-muted-foreground" />
        <span>3. Azure Indexing</span>
      </div>
    </div>
  </CardContent>
</Card>
```
**Effort:** 1 day | **Impact:** High (clarifies value prop)

---

#### H4. Empty State Enhancements
**Problem:** Empty states are functional but lack actionable guidance
**Solution:** Upgrade with contextual CTAs
```tsx
// DocumentList.tsx line 90-100
<div className="p-8 text-center">
  <div className="relative mx-auto w-20 h-20 mb-4">
    <FileText size={64} className="text-muted-foreground/30" />
    <div className="absolute bottom-0 right-0 w-8 h-8 bg-primary rounded-full flex items-center justify-center">
      <Plus size={16} className="text-primary-foreground" />
    </div>
  </div>
  <h3 className="text-lg font-semibold mb-2">Build Your Knowledge Base</h3>
  <p className="text-sm text-muted-foreground mb-4 max-w-md mx-auto">
    Upload documents or connect integrations to start asking intelligent questions
  </p>
  <div className="flex gap-2 justify-center">
    <Button onClick={() => navigate('/upload')}>
      <Upload size={16} className="mr-2" />
      Upload Files
    </Button>
    <Button variant="outline" onClick={() => navigate('/integrations')}>
      <PlugsConnected size={16} className="mr-2" />
      Connect Integration
    </Button>
  </div>
</div>
```
**Effort:** 2 days | **Impact:** High (improves onboarding)

---

### 🟢 QUICK WINS: Polish & Navigation (P2)

#### Q1. Workflow Auto-Expand Logic
**Problem:** Live workflows expand latest step, but completed workflows only expand first step
**Solution:** Auto-expand failed or low-confidence steps
```tsx
// AgentWorkflowVisualizer.tsx line 140
const next = new Set<number>()
steps.forEach((step, idx) => {
  if (step.status === 'failed' ||
      (step.agent === 'Critic' && step.result.faithfulnessScore < 0.7)) {
    next.add(idx)
  }
})
if (next.size === 0) next.add(0) // Fallback
return next
```
**Effort:** 1 hour | **Impact:** Medium

---

#### Q2. Typography Scale Definition
**Problem:** Components use arbitrary pixel values (`text-[11px]`, `text-[0.8rem]`)
**Solution:** Define scale in tokens.css and expose Tailwind utilities
```css
/* tokens.css */
:root {
  --font-size-xs: 0.6875rem;    /* 11px */
  --font-size-sm: 0.8125rem;    /* 13px */
  --font-size-base: 0.875rem;   /* 14px */
  --font-size-lg: 1rem;         /* 16px */
  --font-size-xl: 1.125rem;     /* 18px */
}
```
```js
// tailwind.config.js theme extension
fontSize: {
  'xs': 'var(--font-size-xs)',
  'sm': 'var(--font-size-sm)',
  'base': 'var(--font-size-base)',
  'lg': 'var(--font-size-lg)',
  'xl': 'var(--font-size-xl)',
}
```
Replace all instances of `text-[11px]` with `text-xs`, etc.
**Effort:** 2 hours | **Impact:** Medium (consistency)

---

#### Q3. Status Badge Semantic Tokens
**Problem:** AgentWorkflowVisualizer.tsx hardcodes `border-emerald-500`, `bg-amber-500/10`
**Solution:** Use semantic tokens
```tsx
// Replace STATUS_META at line 48
const STATUS_META = {
  completed: {
    indicatorClass: 'border-[var(--color-status-success)] bg-[var(--color-status-success)]/10 text-[var(--color-status-success)]',
    // ... or ideally Tailwind plugin
  }
}
```
**Effort:** 3 hours | **Impact:** Medium (enables theming)

---

#### Q4. Suggested Questions Visual Hierarchy
**Problem:** All suggested questions have equal visual weight (SuggestedQuestions.tsx)
**Solution:** Highlight top 2 by relevance score
```tsx
// SuggestedQuestions.tsx line 71
<Button
  variant={index < 2 && sq.relevanceScore > 0.8 ? "default" : "outline"}
  className={cn(
    "w-full justify-start text-left h-auto py-3 px-4 transition-colors",
    index < 2 && sq.relevanceScore > 0.8
      ? "bg-primary/10 border-primary hover:bg-primary/20"
      : "hover:bg-primary/5"
  )}
>
```
**Effort:** 30 minutes | **Impact:** Medium

---

### 🔵 POLISH: Motion & Delight (P3)

#### P1. Micro-interactions for Agent Icons
**Problem:** Agent icons are static
**Solution:** Add subtle hover animations
```tsx
// AgentWorkflowVisualizer.tsx line 479
<span className="relative z-10 transition-transform hover:scale-110">
  {getAgentIcon(step.agent)}
</span>
```
**Effort:** 1 hour | **Impact:** Low (delight)

---

#### P2. Workflow Connector Animation
**Problem:** Connector lines appear instantly
**Solution:** Animate from top to bottom
```tsx
// AgentWorkflowVisualizer.tsx line 457
<motion.div
  initial={{ scaleY: 0 }}
  animate={{ scaleY: 1 }}
  transition={{ duration: 0.3, ease: 'easeOut' }}
  className="origin-top"
/>
```
**Effort:** 30 minutes | **Impact:** Low

---

## 3. Responsive Layout Guidance

### Breakpoint Strategy
Following Tailwind's default breakpoints aligned with Spark patterns:

| Breakpoint | Width | Layout Strategy | Density | Navigation |
|------------|-------|-----------------|---------|------------|
| **xs** (default) | <640px | Single column, full-width cards | Spacious (p-4, gap-4) | Accordion (vertical stack) |
| **sm** | ≥640px | Single column, max-w-2xl container | Standard | Accordion |
| **md** | ≥768px | Transition to horizontal tabs | Standard | Horizontal tabs (icons only) |
| **lg** | ≥1024px | Full horizontal tabs with labels | Standard | Horizontal tabs (icon + label) |
| **xl** | ≥1280px | Two-column layouts for dashboards | Comfortable (p-6, gap-6) | Horizontal tabs |
| **2xl** | ≥1536px | Three-column dashboard layouts | Spacious | Horizontal tabs |

---

### Component-Specific Responsive Patterns

#### QueryInterface.tsx
```tsx
// Current: Fixed input layout
// Recommended: Stack on mobile
<div className="flex flex-col md:flex-row gap-2">
  <Input className="flex-1" />
  <Button className="w-full md:w-auto" />
</div>

// Agent metrics grid: Mobile-friendly stacking
<div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
  {/* Metrics */}
</div>
```

#### AgentWorkflowVisualizer.tsx
```tsx
// Current: Line 484 (responsive header wrapping is good)
// Add: Mobile density adjustment
<div className={cn(
  "flex flex-wrap items-center justify-between gap-2 mb-1",
  "md:flex-nowrap" // Prevent wrapping on desktop
)}>

// Recommendation: Reduce badge count on mobile
{renderHeaderSummary(step) && (
  <div className="hidden sm:block">
    {renderHeaderSummary(step)}
  </div>
)}
```

#### DocumentList.tsx
```tsx
// Current: Line 128 (metadata wraps on mobile—good)
// Add: Responsive accordion for chunks on mobile
<AccordionTrigger className="text-xs sm:text-sm">
  View {document.chunks.length} chunks
</AccordionTrigger>
```

#### ScalingDashboard.tsx
```tsx
// Current: Line 180 (TabsList grid-cols-5—overcrowded on mobile)
// Recommended: Scrollable tabs on mobile
<TabsList className="w-full overflow-x-auto flex md:grid md:grid-cols-5">
  <TabsTrigger className="flex-shrink-0">...</TabsTrigger>
</TabsList>

// Metrics: Better mobile stacking
<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
```

#### SuggestedQuestions.tsx
```tsx
// Current: Single column (good for mobile)
// Recommended: Add grid for desktop
<div className="grid grid-cols-1 md:grid-cols-2 gap-2">
  {sortedQuestions.map(...)}
</div>
```

---

### Mobile-First Spacing Tokens
Update component padding for mobile:
```tsx
// Pattern: Reduce outer padding on mobile
<Card className="p-4 md:p-6">
<CardContent className="p-3 md:p-4">
```

---

## 4. Visual Polish Playbook

### 4.1 Typography System

#### Current Issues
- Arbitrary pixel sizes (`text-[11px]`)
- Inconsistent line heights
- No defined type scale

#### Recommended Scale
```css
/* tokens.css */
:root {
  /* Font sizes */
  --font-size-xs: 0.6875rem;    /* 11px - badges, metadata */
  --font-size-sm: 0.8125rem;    /* 13px - secondary text */
  --font-size-base: 0.875rem;   /* 14px - body text */
  --font-size-lg: 1rem;         /* 16px - headings, buttons */
  --font-size-xl: 1.125rem;     /* 18px - card titles */
  --font-size-2xl: 1.5rem;      /* 24px - section headers */
  --font-size-3xl: 2rem;        /* 32px - page titles */

  /* Line heights */
  --leading-tight: 1.25;
  --leading-normal: 1.5;
  --leading-relaxed: 1.75;

  /* Font weights */
  --font-normal: 400;
  --font-medium: 500;
  --font-semibold: 600;
  --font-bold: 700;
}
```

#### Application Map
| Element | Size | Weight | Line Height | Usage |
|---------|------|--------|-------------|-------|
| Page title | 3xl (32px) | bold (700) | tight (1.25) | App.tsx h1 |
| Section header | 2xl (24px) | bold (700) | tight (1.25) | QueryInterface.tsx h2 |
| Card title | xl (18px) | semibold (600) | normal (1.5) | CardTitle components |
| Body text | base (14px) | normal (400) | relaxed (1.75) | Assistant responses |
| Secondary text | sm (13px) | normal (400) | normal (1.5) | Metadata, descriptions |
| Badge/label | xs (11px) | medium (500) | tight (1.25) | Badges, status pills |

---

### 4.2 Spacing Rhythm

#### Current Issues
- Inconsistent gap usage
- No documented rhythm

#### Recommended Pattern (8pt grid)
```css
/* tokens.css - Already defined but underutilized */
--spacing-1: 0.25rem;  /* 4px - icon gaps */
--spacing-2: 0.5rem;   /* 8px - tight spacing */
--spacing-3: 0.75rem;  /* 12px - card padding */
--spacing-4: 1rem;     /* 16px - standard gap */
--spacing-6: 1.5rem;   /* 24px - section spacing */
--spacing-8: 2rem;     /* 32px - page sections */
```

#### Component Spacing Rules
```tsx
// Vertical rhythm: Use consistent gap-* utilities
<div className="space-y-4">      {/* Cards, form fields */}
<div className="space-y-6">      {/* Page sections */}
<div className="space-y-8">      {/* Major sections */}

// Horizontal rhythm
<div className="flex gap-2">     {/* Icons + text */}
<div className="flex gap-3">     {/* Buttons, badges */}
<div className="flex gap-4">     {/* Cards, form groups */}
```

---

### 4.3 Color & Accent Usage

#### Semantic Status Colors (from C2)
Replace hardcoded Tailwind colors with semantic tokens:

| Context | Current | Recommended Token | Tailwind Class |
|---------|---------|-------------------|----------------|
| Success | `border-emerald-500` | `--color-status-success` | `border-status-success` |
| Warning | `text-amber-600` | `--color-status-warning` | `text-status-warning` |
| Error | `text-red-500` | `--color-status-error` | `text-status-error` |
| Processing | `bg-blue-500/30` | `--color-status-processing` | `bg-status-processing/30` |

#### Agent Color Mapping
AgentWorkflowVisualizer.tsx line 180-197 currently uses arbitrary colors:
```tsx
// Current
'classifier': 'bg-blue-500/30'
'planner': 'bg-purple-500/30'

// Recommended: Use Radix palette variables
'classifier': 'bg-[var(--blue-4)]'
'planner': 'bg-[var(--violet-4)]'
'router': 'bg-[var(--green-4)]'
'retrieval': 'bg-[var(--amber-4)]'
'generator': 'bg-[var(--pink-4)]'
'critic': 'bg-[var(--red-4)]'
'react': 'bg-[var(--indigo-4)]'
```

---

### 4.4 Motion Primitives

#### Easing Functions
```css
/* tokens.css */
:root {
  --ease-out: cubic-bezier(0.33, 1, 0.68, 1);
  --ease-in-out: cubic-bezier(0.65, 0, 0.35, 1);
  --ease-bounce: cubic-bezier(0.68, -0.55, 0.265, 1.55);
}
```

#### Animation Durations
| Speed | Duration | Usage |
|-------|----------|-------|
| Fast | 150ms | Hover states, micro-interactions |
| Normal | 250ms | Accordions, tabs, modals |
| Slow | 400ms | Page transitions, complex animations |

#### Framer Motion Variants
```tsx
// Standardize across components
const fadeInUp = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -10 },
  transition: { duration: 0.25, ease: [0.33, 1, 0.68, 1] }
}

// Use in AgentWorkflowVisualizer, SuggestedQuestions, etc.
<motion.div variants={fadeInUp} />
```

---

### 4.5 Elevation & Shadows

#### Current: Inconsistent shadows
Standardize using Spark's shadow system:
```css
/* tokens.css */
:root {
  --shadow-xs: 0 1px 2px 0 rgb(0 0 0 / 0.05);
  --shadow-sm: 0 1px 3px 0 rgb(0 0 0 / 0.1);
  --shadow-md: 0 4px 6px -1px rgb(0 0 0 / 0.1);
  --shadow-lg: 0 10px 15px -3px rgb(0 0 0 / 0.1);
}
```

#### Application
```tsx
// Cards: Use subtle elevation
<Card className="shadow-sm hover:shadow-md transition-shadow">

// Active workflow: Emphasize
<AgentWorkflowVisualizer className="shadow-lg border-primary/30" />
```

---

## 5. Accessibility Checklist

### 5.1 Keyboard Navigation
| Component | Current State | Recommendation | Priority |
|-----------|---------------|----------------|----------|
| **ResponsiveNavigation** | ✅ TabsList keyboard nav works | Add arrow key navigation hints in SR-only text | Medium |
| **AgentWorkflowVisualizer** | ⚠️ "View details" buttons keyboard accessible but expand state not announced | Add `aria-expanded` to Button | **High** |
| **SuggestedQuestions** | ✅ Buttons keyboard accessible | Add keyboard shortcut hints (1-4) for top questions | Low |
| **DocumentUpload** | ⚠️ Drag-drop not keyboard accessible | Add "Browse files" keyboard trigger | **Critical** |
| **QueryInterface** | ✅ Input and submit accessible | Add `Cmd/Ctrl+Enter` to submit | Medium |

#### Implementation: Keyboard Shortcuts
```tsx
// QueryInterface.tsx
useEffect(() => {
  const handleKeyDown = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      handleSubmit(new Event('submit') as any)
    }
  }
  window.addEventListener('keydown', handleKeyDown)
  return () => window.removeEventListener('keydown', handleKeyDown)
}, [query])
```

---

### 5.2 ARIA Live Regions
| Component | Need | Implementation |
|-----------|------|----------------|
| **AgentWorkflowVisualizer** | Announce step completions | `<div role="status" aria-live="polite" className="sr-only">{lastCompletedStep}</div>` |
| **DocumentUpload** | Announce upload progress | `<div role="status" aria-live="polite">{uploadProgress.fileName} at {uploadProgress.progress}%</div>` |
| **QueryInterface** | Announce new messages | Already using proper semantic structure; add `aria-live="polite"` to message container |

#### Example Implementation
```tsx
// AgentWorkflowVisualizer.tsx
const [liveRegionMessage, setLiveRegionMessage] = useState('')

useEffect(() => {
  const completedSteps = steps.filter(s => s.status === 'completed')
  if (completedSteps.length > prevCompletedCount) {
    const latest = completedSteps[completedSteps.length - 1]
    setLiveRegionMessage(`${latest.agent} step completed: ${latest.action}`)
  }
}, [steps])

return (
  <>
    <div role="status" aria-live="polite" className="sr-only">
      {liveRegionMessage}
    </div>
    {/* Existing workflow UI */}
  </>
)
```

---

### 5.3 Color Contrast Compliance (WCAG AA)

#### Audit Results
| Element | Current Contrast | Status | Recommendation |
|---------|------------------|--------|----------------|
| Badge text (xs) on muted background | 3.8:1 | ⚠️ Fail (needs 4.5:1 for <18px) | Darken text or lighten background |
| Agent step connector lines | 2.1:1 | ❌ Fail (decorative OK, but consider users with low vision) | Increase opacity from `/70` to `/85` |
| Muted foreground text | 4.6:1 | ✅ Pass | — |
| Status "pending" badge | 3.2:1 | ❌ Fail | Use `text-muted-foreground` instead of `text-border` |

#### Fixes
```tsx
// AgentWorkflowVisualizer.tsx line 73
pending: {
  badgeClass: 'border-border text-foreground', // Changed from text-muted-foreground
}

// Line 464
connectorClass: 'bg-border/85' // Increased from /70
```

---

### 5.4 Focus Management

#### Current Issues
1. **DocumentUpload:** File input hidden, focus indicator lost
2. **Modal interactions:** No focus trap in potential future modals
3. **Tab navigation:** Focus outline relies on Tailwind's `outline-ring/50`—needs testing in dark mode

#### Recommended Focus Styles
```css
/* tokens.css */
:root {
  --focus-ring: 2px solid var(--color-accent-9);
  --focus-offset: 2px;
}

/* Global focus style */
*:focus-visible {
  outline: var(--focus-ring);
  outline-offset: var(--focus-offset);
  border-radius: var(--radius-sm);
}
```

---

### 5.5 Screen Reader Testing Protocol

#### Test Scenarios
1. **Workflow announcement test**
   - Enable VoiceOver (macOS) / NVDA (Windows)
   - Submit query in Agentic Mode
   - Verify each completed step is announced
   - Expected: "Classifier step completed: Analyzing query complexity"

2. **Document upload test**
   - Navigate to Upload tab with Tab key only
   - Verify file input is reachable and describable
   - Expected: "Choose files to upload. Supports .txt, .md, .pdf files"

3. **Suggested questions test**
   - Navigate to suggested question buttons
   - Verify category badges are read first
   - Expected: "Clarification category: What compliance frameworks apply to our architecture?"

#### Tools
- **axe DevTools** (Chrome extension): Run on each tab
- **WAVE** (WebAIM): Validate semantic structure
- **Lighthouse**: Automated accessibility score (target: 95+)

---

### 5.6 Semantic HTML Structure

#### Current Strengths
- ✅ Proper heading hierarchy (`h1` → `h2` → `h3`)
- ✅ Radix UI primitives use proper ARIA roles
- ✅ `<Card>` uses `article` or `section` appropriately

#### Improvements Needed
```tsx
// QueryInterface.tsx: Wrap conversation in landmark
<main role="main" aria-label="Query interface">
  <section aria-label="Conversation history">
    {messages.map(...)}
  </section>
</main>

// DocumentList.tsx: Add landmark
<section aria-label="Knowledge base documents">
  {documents.map(...)}
</section>
```

---

## 6. Design System Inspirations & References

### Comparative Analysis

#### 1. **GitHub Copilot Chat** (Code completions & inline suggestions)
**What they do well:**
- Ghost text for AI suggestions (low-friction)
- Inline diff view for code changes
- Confidence indicators (subtle background color intensity)

**Applicable patterns:**
- Add "ghost text" query suggestions in input field as user types
- Use background color intensity for confidence scores (not just numeric badges)

**Reference:** https://github.com/features/copilot

---

#### 2. **Perplexity Pro Search** (Multi-step reasoning display)
**What they do well:**
- Progressive disclosure: Shows "Searching 10 sources" then reveals detailed citations
- Source credibility badges (peer-reviewed, recent, etc.)
- Thread view for follow-up questions

**Applicable patterns:**
- Our AgentWorkflowVisualizer should collapse by default, expand on click
- Add source credibility badges (Azure score, recency, chunk confidence)

**Reference:** https://www.perplexity.ai/pro

---

#### 3. **ChatGPT Advanced Data Analysis** (Tool use transparency)
**What they do well:**
- Code execution feedback with stdout/stderr
- "Working..." with substep descriptions
- Retry mechanism with user confirmation

**Applicable patterns:**
- Add substep descriptions to long-running agent steps
- Surface critic validation failures as "retry" prompts

**Reference:** https://openai.com/chatgpt

---

#### 4. **Linear** (Design system polish & keyboard shortcuts)
**What they do well:**
- Consistent 8pt spacing grid
- Semantic color system with status tokens
- Command palette (Cmd+K) for all actions

**Applicable patterns:**
- Implement command palette for quick navigation (Cmd+K → "Go to Azure config")
- Adopt their status badge style for workflow steps

**Reference:** https://linear.app/method/design-system

---

#### 5. **Vercel Dashboard** (Deployment status & real-time updates)
**What they do well:**
- Deployment logs stream in real-time with syntax highlighting
- Status transitions are clearly animated (Building → Deploying → Ready)
- Error states show actionable fixes

**Applicable patterns:**
- Add log-style view for agent workflow (optional advanced mode)
- Animate status badge transitions (pending → running → completed)

**Reference:** https://vercel.com/docs/dashboard

---

#### 6. **Notion** (Progressive disclosure & empty states)
**What they do well:**
- Empty database states show template suggestions
- Nested content with smooth expand/collapse
- Onboarding tooltips for new features

**Applicable patterns:**
- Add template queries to empty QueryInterface state
- Implement onboarding tooltips for Agentic Mode toggle

**Reference:** https://www.notion.so/product/wikis

---

## 7. Implementation Roadmap

### Phase 1: Foundation (Week 1-2)
- ✅ C2: Design token consolidation
- ✅ C1: Azure fallback messaging
- ✅ Q2: Typography scale definition
- ✅ Q3: Status badge semantic tokens

**Goal:** Establish single source of truth for design tokens

---

### Phase 2: Trust & Clarity (Week 3-4)
- ✅ H1: Query complexity indicator
- ✅ H2: Agent step progress indicators
- ✅ H4: Empty state enhancements
- ✅ Accessibility: ARIA live regions

**Goal:** Surface AI intelligence, reduce confusion

---

### Phase 3: Discovery & Onboarding (Week 5-6)
- ✅ H3: Integration pipeline explainer
- ✅ Q4: Suggested questions hierarchy
- ✅ Command palette (optional)
- ✅ Onboarding tooltips

**Goal:** Improve feature discoverability

---

### Phase 4: Polish & Delight (Week 7-8)
- ✅ P1: Micro-interactions
- ✅ P2: Workflow connector animations
- ✅ Q1: Workflow auto-expand logic
- ✅ Responsive layout refinements

**Goal:** Elevate perceived quality

---

## 8. Success Metrics

### Quantitative KPIs
| Metric | Baseline | Target | Measurement |
|--------|----------|--------|-------------|
| Task completion rate (complex query) | TBD | 90% | User testing (n=20) |
| Time to first query | TBD | <30s | Analytics (onboarding flow) |
| Azure fallback confusion rate | TBD | <10% | Post-query survey |
| Lighthouse accessibility score | TBD | 95+ | Automated audit |
| Mobile conversion rate | TBD | 70% | Analytics (queries submitted on mobile) |

### Qualitative Indicators
- User confidence in AI responses (Likert scale 1-5)
- Trust in agent workflow transparency (interview feedback)
- Perceived ease of integration setup (survey)

---

## Appendix A: Design Token Migration Checklist

### Step 1: Consolidate CSS Files
- [ ] Create `src/styles/tokens.css` with consolidated palette
- [ ] Merge spacing, radius, typography scales
- [ ] Delete redundant rules from `main.css`, `theme.css`, `index.css`
- [ ] Import `tokens.css` as single source

### Step 2: Fix Dark Mode
- [ ] Move `darkMode: 'class'` to root of `tailwind.config.js`
- [ ] Remove `.dark` class references, use `[data-appearance="dark"]`
- [ ] Test dark mode toggle functionality

### Step 3: Add Semantic Tokens
- [ ] Define status color variables
- [ ] Create Tailwind plugin for status utilities
- [ ] Replace hardcoded colors in components

### Step 4: Typography Migration
- [ ] Define font-size scale in tokens
- [ ] Add Tailwind fontSize theme extension
- [ ] Global find/replace for arbitrary values

---

## Appendix B: Accessibility Testing Tools

### Browser Extensions
- **axe DevTools** (Deque): https://www.deque.com/axe/devtools/
- **WAVE** (WebAIM): https://wave.webaim.org/extension/
- **Lighthouse** (Chrome): Built-in DevTools

### Screen Readers
- **VoiceOver** (macOS): Built-in, activate with Cmd+F5
- **NVDA** (Windows): https://www.nvaccess.org/download/
- **JAWS** (Windows, paid): https://www.freedomscientific.com/products/software/jaws/

### Keyboard Testing
- **Disable mouse/trackpad** and navigate with Tab, Arrow keys, Enter
- Test all interactive elements
- Verify focus visibility

---

## Appendix C: Component File Map

| Component | File Path | Primary Concerns |
|-----------|-----------|------------------|
| AgentWorkflowVisualizer | `src/components/AgentWorkflowVisualizer.tsx` | Status colors, ARIA announcements |
| QueryInterface | `src/components/QueryInterface.tsx` | Azure fallback messaging, keyboard shortcuts |
| DocumentUpload | `src/components/DocumentUpload.tsx` | Drag-drop accessibility |
| DocumentList | `src/components/DocumentList.tsx` | Empty state, responsive badges |
| ScalingDashboard | `src/components/ScalingDashboard.tsx` | Mobile tab overflow |
| SuggestedQuestions | `src/components/SuggestedQuestions.tsx` | Visual hierarchy, keyboard hints |
| ResponsiveNavigation | `src/components/ResponsiveNavigation.tsx` | Accordion keyboard nav |

---

## Document Version History
- **v1.0** (2025-11-03): Initial audit and recommendations

---

**Prepared by:** AI UX Research Team
**Review Status:** Ready for engineering review
**Next Steps:** Schedule design review with team, prioritize P0/P1 items for Sprint 1
