import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { SafeMarkdown } from '../src/components/SafeMarkdown'

describe('SafeMarkdown', () => {
  it('renders markdown content safely', () => {
    const content = '# Hello World\n\nThis is **bold** and *italic* text.'
    render(<SafeMarkdown content={content} />)
    
    expect(screen.getByText('Hello World')).toBeInTheDocument()
    expect(screen.getByText(/This is/)).toBeInTheDocument()
  })

  it('sanitizes XSS attempts in markdown', () => {
    const maliciousContent = '# Title\n\n<script>alert("xss")</script>\n\n[Link](javascript:alert("xss"))'
    render(<SafeMarkdown content={maliciousContent} />)
    
    // Script tags should be removed
    expect(screen.queryByText('alert("xss")')).not.toBeInTheDocument()
    
    // Should still render safe content
    expect(screen.getByText('Title')).toBeInTheDocument()
  })

  it('disables links when allowLinks is false', () => {
    const content = '[Click here](https://example.com)'
    render(<SafeMarkdown content={content} allowLinks={false} />)
    
    // Link should not be rendered when allowLinks is false
    const link = screen.queryByRole('link')
    expect(link).not.toBeInTheDocument()
  })

  it('enables links when allowLinks is true', () => {
    const content = '[Click here](https://example.com)'
    render(<SafeMarkdown content={content} allowLinks={true} />)
    
    // Link should be rendered when allowLinks is true
    const link = screen.getByRole('link', { name: 'Click here' })
    expect(link).toBeInTheDocument()
    expect(link).toHaveAttribute('href', 'https://example.com')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('applies custom className', () => {
    const content = '# Test'
    const { container } = render(<SafeMarkdown content={content} className="custom-class" />)
    
    const div = container.querySelector('.custom-class')
    expect(div).toBeInTheDocument()
  })

  it('handles code blocks safely', () => {
    const content = '```javascript\nconst x = 1;\n```'
    render(<SafeMarkdown content={content} />)
    
    expect(screen.getByText('const x = 1;')).toBeInTheDocument()
  })

  it('handles HTML injection attempts', () => {
    const content = '# Title\n\n<img src="x" onerror="alert(\'xss\')">'
    render(<SafeMarkdown content={content} />)
    
    // onerror should be stripped, but img itself is allowed; ensure no onerror attribute
    const img = screen.getByRole('img')
    expect(img).toBeInTheDocument()
    expect(img).not.toHaveAttribute('onerror')
    
    // Title should still be rendered
    expect(screen.getByText('Title')).toBeInTheDocument()
  })
})