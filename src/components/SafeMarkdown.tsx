import { useMemo } from 'react'
import DOMPurify from 'dompurify'
import { marked } from 'marked'

interface SafeMarkdownProps {
  content: string
  className?: string
  allowLinks?: boolean
}

/**
 * SafeMarkdown: Renders markdown content with XSS protection via DOMPurify.
 *
 * Security Features:
 * - Sanitizes HTML using DOMPurify to prevent XSS attacks
 * - Parses markdown to HTML using marked
 * - Optional link blocking for untrusted content
 * - Memoized for performance
 *
 * @param content - Raw markdown/text content to render
 * @param className - Optional CSS classes (defaults to prose styling)
 * @param allowLinks - Whether to allow <a> tags (default: true)
 */
export function SafeMarkdown({
  content,
  className = 'prose prose-sm max-w-none dark:prose-invert',
  allowLinks = true
}: SafeMarkdownProps) {
  const html = useMemo(() => {
    // Parse markdown to HTML
    const rawHtml = marked.parse(content, { async: false }) as string

    // Sanitize HTML to prevent XSS
    const clean = DOMPurify.sanitize(rawHtml, {
      USE_PROFILES: { html: true },
      ADD_ATTR: allowLinks ? ['target', 'rel'] : [],
      FORBID_TAGS: allowLinks ? [] : ['a'],
      ALLOW_UNKNOWN_PROTOCOLS: false,
      ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,
    })

    return clean
  }, [content, allowLinks])

  return (
    <div
      className={className}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
