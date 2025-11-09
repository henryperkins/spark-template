import React, { useMemo } from 'react'
import { marked } from 'marked'
import createDOMPurify from 'dompurify'

// DOMPurify needs a Window-like object; in browsers/tests we can rely on globalThis.
const domPurify = typeof window !== 'undefined'
  ? createDOMPurify(window)
  : undefined

interface SafeMarkdownProps {
  content: string
  className?: string
  allowLinks?: boolean
}

export function SafeMarkdown({ 
  content, 
  className = 'prose prose-sm max-w-none dark:prose-invert',
  allowLinks = true 
}: SafeMarkdownProps) {
  const html = useMemo(() => {
    if (!domPurify) {
      return ''
    }
    // marked.parse returns string | Promise<string>; async rendering is disabled so coerce to string.
    const raw = marked.parse(content) as string
    const clean = domPurify.sanitize(raw, {
      USE_PROFILES: { html: true },
      ADD_ATTR: allowLinks ? ['target', 'rel'] : [],
      FORBID_TAGS: allowLinks ? [] : ['a'],
      ALLOW_UNKNOWN_PROTOCOLS: false,
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
