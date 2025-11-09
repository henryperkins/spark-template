import { test, expect } from '@playwright/test'

test.describe('E2E Smoke Tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
  })

  test('basic app load and navigation', async ({ page }) => {
    // Verify app loads
    await expect(page.locator('text="Agentic RAG"')).toBeVisible()
    await expect(page.locator('text="Intelligent Knowledge Assistant"')).toBeVisible()
    
    // Verify navigation tabs exist
    const tabs = ['Query', 'Upload', 'Integrations', 'Knowledge', 'Scaling', 'Azure', 'Architecture']
    for (const tab of tabs) {
      await expect(page.locator(`text="${tab}"`)).toBeVisible()
    }
  })

  test('upload and process a document', async ({ page }) => {
    // Navigate to upload
    await page.click('text="Upload"')
    await page.waitForSelector('text="Drag and drop files here"')
    
    // Create a test file
    const testContent = 'This is a test document for the Agentic RAG system.'
    const testFile = new File([testContent], 'test-document.txt', { type: 'text/plain' })
    
    // Upload the file
    const fileInput = await page.locator('input[type="file"]')
    await fileInput.setInputFiles(testFile)
    
    // Wait for processing
    await page.waitForTimeout(2000)
    
    // Verify document appears in knowledge base
    await page.click('text="Knowledge"')
    await page.waitForTimeout(1000)
    
    const documentExists = await page.locator('text="test-document.txt"').count()
    expect(documentExists).toBeGreaterThan(0)
  })

  test('execute a query and verify response', async ({ page }) => {
    // First upload a document
    await page.click('text="Upload"')
    await page.waitForSelector('text="Drag and drop files here"')
    
    const testContent = 'The capital of France is Paris. The Eiffel Tower is located there.'
    const testFile = new File([testContent], 'france-facts.txt', { type: 'text/plain' })
    const fileInput = await page.locator('input[type="file"]')
    await fileInput.setInputFiles(testFile)
    
    await page.waitForTimeout(2000)
    
    // Navigate to query
    await page.click('text="Query"')
    await page.waitForSelector('textarea[placeholder*="Ask a question"]')
    
    // Enter a question
    const queryTextarea = await page.locator('textarea[placeholder*="Ask a question"]')
    await queryTextarea.fill('What is the capital of France?')
    
    // Submit query
    await page.click('button[type="submit"]')
    
    // Wait for response
    await page.waitForTimeout(3000)
    
    // Verify response contains expected content
    const responseText = await page.locator('[data-testid="query-response"]').textContent()
    expect(responseText?.toLowerCase()).toContain('paris')
  })

  test('azure configuration flow', async ({ page }) => {
    // Navigate to Azure configuration
    await page.click('text="Azure"')
    await page.waitForSelector('text="Azure OpenAI Configuration"')
    
    // Fill in configuration (using test values)
    await page.fill('input[placeholder*="OpenAI Endpoint"]', 'https://test.openai.azure.com')
    await page.fill('input[placeholder*="API Key"]', 'test-key')
    await page.fill('input[placeholder*="Deployment Name"]', 'test-deployment')
    await page.fill('input[placeholder*="Embedding Deployment"]', 'test-embedding')
    
    // Test connection
    await page.click('text="Test Connection"')
    await page.waitForTimeout(2000)
    
    // Verify connection test completed
    const statusText = await page.locator('text="connected"').count() + 
                      await page.locator('text="error"').count()
    expect(statusText).toBeGreaterThan(0)
  })

  test('scaling dashboard displays metrics', async ({ page }) => {
    // Navigate to scaling dashboard
    await page.click('text="Scaling"')
    await page.waitForSelector('text="Scaling & Performance Dashboard"')
    
    // Verify dashboard sections exist
    await expect(page.locator('text="Token Usage"')).toBeVisible()
    await expect(page.locator('text="Error Rates"')).toBeVisible()
    await expect(page.locator('text="Agent Performance"')).toBeVisible()
    
    // Verify metrics are displayed
    const metricsExist = await page.locator('[data-testid="metric-card"]').count()
    expect(metricsExist).toBeGreaterThan(0)
  })

  test('architecture diagram renders', async ({ page }) => {
    // Navigate to architecture
    await page.click('text="Architecture"')
    await page.waitForSelector('text="14-Layer Architecture"')
    
    // Verify architecture layers are displayed
    const layers = [
      'Layer 1: User Interface',
      'Layer 2: API Gateway',
      'Layer 3: Agent Orchestrator',
      'Layer 4: Query Processing',
      'Layer 5: Document Processing',
      'Layer 6: Embedding Service',
      'Layer 7: Vector Store',
      'Layer 8: Knowledge Graph',
      'Layer 9: Caching Layer',
      'Layer 10: LLM Service',
      'Layer 11: Response Generation',
      'Layer 12: Observability',
      'Layer 13: Security',
      'Layer 14: Infrastructure'
    ]
    
    for (const layer of layers) {
      await expect(page.locator(`text="${layer}"`)).toBeVisible()
    }
  })

  test('error handling and recovery', async ({ page }) => {
    // Navigate to upload
    await page.click('text="Upload"')
    await page.waitForSelector('text="Drag and drop files here"')
    
    // Try to upload an invalid file type
    const invalidFile = new File(['<xml>test</xml>'], 'test.xml', { type: 'application/xml' })
    const fileInput = await page.locator('input[type="file"]')
    await fileInput.setInputFiles(invalidFile)
    
    // Wait for error handling
    await page.waitForTimeout(1000)
    
    // Verify error is displayed
    const errorExists = await page.locator('text="error"').count() + 
                       await page.locator('[class*="error"]').count()
    expect(errorExists).toBeGreaterThan(0)
  })

  test('responsive navigation works on mobile viewport', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 })
    
    // Verify mobile navigation
    await page.goto('/')
    await expect(page.locator('text="Agentic RAG"')).toBeVisible()
    
    // Check if mobile menu toggle exists
    const mobileMenu = await page.locator('button[aria-label*="menu"], button[aria-label*="navigation"]').count()
    if (mobileMenu > 0) {
      await page.click('button[aria-label*="menu"]')
      await page.waitForTimeout(500)
      
      // Verify mobile menu items
      await expect(page.locator('text="Query"')).toBeVisible()
    }
  })
})