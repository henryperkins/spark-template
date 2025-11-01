# Development Guidelines

## Code Quality Standards

### TypeScript Usage
- **Strict Type Safety**: All files use TypeScript with explicit type annotations for function parameters and return values
- **Interface-First Design**: Define comprehensive interfaces in `/src/types/index.ts` before implementation
- **No Implicit Any**: Avoid `any` types; use proper type definitions or generics
- **Type Exports**: Export all shared types from centralized type files for reusability

### Import Organization
- **Path Aliases**: Use `@/` prefix for absolute imports (configured in tsconfig.json)
  ```typescript
  import { Card } from '@/components/ui/card'
  import { useSparkKV } from '@/hooks/use-spark-kv'
  import { azureServiceManager } from '@/lib/azure-service-manager'
  ```
- **Import Order**: React imports first, then UI components, then hooks, then lib/services, then types
- **Named Imports**: Prefer named imports over default imports for better tree-shaking

### Component Structure
- **Functional Components**: Use React functional components exclusively with TypeScript
- **Props Interfaces**: Define explicit props interfaces for all components
  ```typescript
  interface ComponentNameProps {
    onAction: (data: Type) => void
    config: ConfigType
  }
  
  export function ComponentName({ onAction, config }: ComponentNameProps) {
    // implementation
  }
  ```
- **Export Pattern**: Use named exports with `export function` (not default exports)

### Naming Conventions
- **Components**: PascalCase for component names and files (e.g., `QueryInterface.tsx`, `AzureConfiguration.tsx`)
- **Hooks**: camelCase with `use` prefix (e.g., `useSparkKV`, `use-mobile.ts`)
- **Services**: camelCase for service instances (e.g., `azureServiceManager`, `oneDriveService`)
- **Types/Interfaces**: PascalCase for interfaces (e.g., `Document`, `AzureConfig`, `QueryResponse`)
- **Constants**: UPPER_SNAKE_CASE for true constants, camelCase for configuration objects

## React Patterns

### State Management
- **useSparkKV Hook**: Primary pattern for persistent state across sessions
  ```typescript
  const [config, setConfig] = useSparkKV<AzureConfig | null>('azure-config', null)
  const [documents, setDocuments] = useSparkKV<Document[]>('rag-documents', [])
  ```
- **Local useState**: Use for ephemeral UI state (loading, validation, hover states)
- **Controlled Components**: All form inputs are controlled with value and onChange
- **State Initialization**: Use useEffect to sync persisted state with local form state

### Effect Patterns
- **Cleanup Functions**: Always return cleanup functions from useEffect when needed
  ```typescript
  useEffect(() => {
    let cancelled = false
    
    const loadData = async () => {
      const data = await fetchData()
      if (!cancelled) setState(data)
    }
    
    loadData()
    return () => { cancelled = true }
  }, [dependency])
  ```
- **Dependency Arrays**: Explicitly list all dependencies; use useCallback for stable function references

### Event Handling
- **Async Handlers**: Wrap async operations in try-catch with proper error handling
  ```typescript
  const handleAction = async () => {
    setLoading(true)
    try {
      const result = await service.performAction(config)
      toast.success('Action completed')
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      toast.error(errorMessage)
    } finally {
      setLoading(false)
    }
  }
  ```
- **Form Submission**: Prevent default with `e.preventDefault()` in form onSubmit handlers

## UI Component Patterns

### shadcn/ui Integration
- **Component Imports**: Import from `@/components/ui/[component-name]`
- **Composition Pattern**: Build complex UIs by composing primitive components
  ```typescript
  <Card>
    <CardHeader>
      <CardTitle>Title</CardTitle>
      <CardDescription>Description</CardDescription>
    </CardHeader>
    <CardContent>
      {/* content */}
    </CardContent>
  </Card>
  ```
- **Variant Props**: Use variant props for component styling (e.g., `variant="outline"`, `variant="destructive"`)

### Icon Usage
- **Phosphor Icons**: Primary icon library with consistent sizing
  ```typescript
  import { CloudArrowUp, Check, Warning } from '@phosphor-icons/react'
  
  <CloudArrowUp size={20} className="text-primary" />
  ```
- **Icon Sizing**: Standard sizes are 14px (inline), 16px (buttons), 20px (headers), 24px (large)
- **Icon Colors**: Use Tailwind classes for colors (e.g., `text-primary`, `text-muted-foreground`)

### Styling Conventions
- **Tailwind CSS**: Use utility classes for all styling
- **Conditional Classes**: Use `cn()` utility from `@/lib/utils` for conditional class merging
  ```typescript
  import { cn } from '@/lib/utils'
  
  <div className={cn(
    "base-classes",
    isActive && "active-classes",
    variant === 'primary' && "primary-classes"
  )} />
  ```
- **Spacing**: Use consistent spacing scale (gap-2, gap-4, p-4, space-y-4)
- **Responsive Design**: Mobile-first with responsive breakpoints (md:, lg:)

### Layout Patterns
- **Grid Layouts**: Use `grid grid-cols-1 md:grid-cols-2 gap-4` for responsive grids
- **Flex Layouts**: Use `flex items-center gap-2` for horizontal layouts
- **Spacing**: Use `space-y-4` for vertical stacking, `gap-4` for flex/grid gaps
- **ScrollArea**: Wrap long content in ScrollArea component with explicit height

## Service Layer Patterns

### API Integration
- **Service Managers**: Centralized service classes for external APIs
  ```typescript
  class ServiceManager {
    async initialize(config: Config): Promise<Status> {
      // validation and setup
    }
    
    async performAction(params: Params): Promise<Result> {
      // API calls with error handling
    }
  }
  
  export const serviceManager = new ServiceManager()
  ```
- **Error Handling**: Wrap all API calls in try-catch with meaningful error messages
- **Validation**: Validate configuration before making API calls

### Async Patterns
- **Promise Handling**: Use async/await consistently (not .then() chains)
- **Parallel Operations**: Use `Promise.all()` for independent parallel operations
- **Error Propagation**: Throw errors with context; catch at component level for user feedback

### Fallback Strategy
- **Graceful Degradation**: Implement fallback mechanisms when services unavailable
  ```typescript
  const withKv = async <T>(
    key: string,
    handler: (kv: SparkKv) => Promise<T>,
    fallback: () => Promise<T>
  ) => {
    try {
      const kv = getActiveSparkKv()
      return await handler(kv)
    } catch (error) {
      console.warn(`Falling back for key "${key}":`, error)
      return fallback()
    }
  }
  ```

## Data Management

### Type Definitions
- **Comprehensive Interfaces**: Define all data structures in `/src/types/index.ts`
- **Optional Properties**: Use `?` for optional fields with clear semantics
- **Union Types**: Use union types for status fields (e.g., `'pending' | 'processing' | 'completed' | 'error'`)
- **Metadata Objects**: Use `Record<string, any>` for flexible metadata fields

### State Persistence
- **Spark KV Store**: Primary persistence mechanism using `useSparkKV` hook
- **Key Naming**: Use kebab-case for KV keys (e.g., `'azure-config'`, `'rag-documents'`)
- **Structured Clone**: Use `structuredClone()` or JSON parse/stringify for deep cloning
- **Initialization**: Provide sensible default values as second parameter to useSparkKV

### Data Validation
- **Input Validation**: Validate user inputs before processing
- **Type Guards**: Use type guards for runtime type checking
- **Error States**: Track error states separately from data states

## User Experience Patterns

### Loading States
- **Loading Indicators**: Show loading state during async operations
  ```typescript
  const [isLoading, setIsLoading] = useState(false)
  
  <Button disabled={isLoading}>
    {isLoading ? 'Processing...' : 'Submit'}
  </Button>
  ```
- **Skeleton States**: Use skeleton loaders for content that's loading
- **Progress Indicators**: Show progress for long-running operations

### User Feedback
- **Toast Notifications**: Use `sonner` toast for success/error feedback
  ```typescript
  import { toast } from 'sonner'
  
  toast.success('Operation completed successfully')
  toast.error('Operation failed: ' + errorMessage)
  ```
- **Inline Validation**: Show validation errors inline near form fields
- **Status Badges**: Use Badge component to show status (connected/error/testing)

### Form Patterns
- **Controlled Inputs**: All inputs controlled with value and onChange
- **Label Association**: Use Label component with htmlFor matching input id
- **Password Visibility**: Implement show/hide toggle for sensitive fields
- **Form Validation**: Validate before submission with clear error messages

## Configuration Management

### Settings Organization
- **Tabbed Interfaces**: Use Tabs component for organizing related settings
  ```typescript
  <Tabs defaultValue="openai">
    <TabsList>
      <TabsTrigger value="openai">Azure OpenAI</TabsTrigger>
      <TabsTrigger value="search">Azure AI Search</TabsTrigger>
    </TabsList>
    <TabsContent value="openai">
      {/* OpenAI settings */}
    </TabsContent>
  </Tabs>
  ```
- **Nested Configuration**: Use nested objects for related configuration groups
- **Feature Toggles**: Use Switch component for enabling/disabling features

### Optimization Settings
- **Slider Controls**: Use Slider component for numeric configuration
  ```typescript
  <Slider
    value={[weight]}
    onValueChange={([newWeight]) => setWeight(newWeight)}
    min={0}
    max={5}
    step={0.1}
  />
  ```
- **Select Dropdowns**: Use Select component for enumerated options
- **Conditional Rendering**: Show advanced settings only when feature enabled

## Architecture Visualization

### Interactive Diagrams
- **Layer-Based Organization**: Organize architecture into logical layers with clear responsibilities
- **Component Details**: Provide expandable details for each architectural component
- **Technology Badges**: Tag components with technologies and patterns used
- **Interaction Mapping**: Document how layers interact with each other

### Documentation Patterns
- **Inline Documentation**: Provide descriptions directly in UI components
- **Progressive Disclosure**: Use collapsible sections for detailed information
- **Visual Hierarchy**: Use icons, colors, and spacing to create clear hierarchy

## Performance Considerations

### Optimization Techniques
- **Memoization**: Use useCallback for stable function references passed as props
- **Lazy Loading**: Load heavy components only when needed
- **Debouncing**: Debounce expensive operations triggered by user input
- **Caching**: Implement multi-level caching for API responses and computations

### Bundle Optimization
- **Tree Shaking**: Use named imports to enable tree shaking
- **Code Splitting**: Split large features into separate chunks
- **Dynamic Imports**: Use dynamic imports for rarely-used features

## Testing & Debugging

### Error Handling
- **Try-Catch Blocks**: Wrap all async operations in try-catch
- **Error Messages**: Provide user-friendly error messages with context
- **Console Logging**: Use console.warn for fallback scenarios, console.error for failures
- **Error Boundaries**: Implement error boundaries for component-level error handling

### Development Practices
- **Type Checking**: Run TypeScript compiler regularly to catch type errors
- **Linting**: Follow ESLint rules for code consistency
- **Browser DevTools**: Use React DevTools for component inspection
- **Network Inspection**: Monitor API calls in browser network tab

## Security Best Practices

### Credential Management
- **Browser Storage**: Store API keys in Spark KV (browser-based, not server)
- **Password Fields**: Use `type="password"` for sensitive inputs
- **No Hardcoding**: Never hardcode credentials in source code
- **Secure Transmission**: Only send credentials to authorized Azure endpoints

### Input Sanitization
- **User Input**: Validate and sanitize all user inputs
- **URL Validation**: Validate URLs before making requests
- **Token Validation**: Validate OAuth tokens before use
- **XSS Prevention**: React automatically escapes content; avoid dangerouslySetInnerHTML

## Common Code Idioms

### Conditional Rendering
```typescript
{isLoading && <LoadingSpinner />}
{error && <ErrorMessage message={error} />}
{data && <DataDisplay data={data} />}
```

### Array Mapping
```typescript
{items.map((item, index) => (
  <Component key={item.id || index} data={item} />
))}
```

### Object Spreading for Updates
```typescript
setConfig(prev => ({
  ...prev,
  [service]: {
    ...prev[service],
    [field]: value
  }
}))
```

### Async State Updates
```typescript
const [loading, setLoading] = useState(false)

const handleAction = async () => {
  setLoading(true)
  try {
    await performAction()
  } finally {
    setLoading(false)
  }
}
```

## Frequently Used Annotations

### Component Props
```typescript
interface ComponentProps {
  onAction: (data: Type) => void  // Callback functions
  config: ConfigType              // Configuration objects
  disabled?: boolean              // Optional flags
  className?: string              // Style overrides
}
```

### Hook Return Types
```typescript
const [value, setValue, deleteValue] = useSparkKV<Type>('key', defaultValue)
```

### Service Methods
```typescript
async methodName(params: ParamsType): Promise<ResultType> {
  // implementation
}
```

### Event Handlers
```typescript
const handleEvent = async (e: React.FormEvent) => {
  e.preventDefault()
  // handle event
}

onChange={(e) => setValue(e.target.value)}
onClick={() => performAction()}
```
