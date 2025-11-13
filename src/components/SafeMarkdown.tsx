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
      // Always allow target/rel attributes; we enforce safe values below.
      ADD_ATTR: ['target', 'rel'],
      FORBID_TAGS: ['script'],
      FORBID_ATTR: ['onerror', 'onclick', 'onload', 'onmouseover'],
      ALLOW_UNKNOWN_PROTOCOLS: false,
    })

    // Link policy:
    // - When allowLinks === false: strip all anchor tags, keep inner text.
    // - When allowLinks === true:
    //   - Only allow http/https links (others become "#")
    //   - Force target="_blank" and rel="noopener noreferrer"
    const finalHtml = (() => {
      if (!allowLinks) {
        // Strip all anchors but keep inner text
        return clean.replace(/<a\b[^>]*>(.*?)<\/a>/gi, '$1')
      }

      // For allowLinks=true, rely on DOMPurify sanitization plus safe defaults:
      // - Neutralize javascript: and other dangerous protocols by converting them to "#"
      // - Ensure target and rel are set on anchors
      return clean
        .replace(
          /<a\b([^>]*?)href=(["'])(.*?)\2([^>]*)>/gi,
          (_full, before, quote, href, after) => {
            const safeHref =
              /^https?:\/\//i.test(href) || href.startsWith('#') ? href : '#'
            return `<a${before}href=${quote}${safeHref}${quote}${after}>`
          }
        )
        .replace(
          /<a\b([^>]*)>/gi,
          (_full, attrs) => {
            let next = attrs

            if (!/target=/i.test(next)) {
              next += ' target="_blank"'
            }
            if (!/rel=/i.test(next)) {
              next += ' rel="noopener noreferrer"'
            }

            return `<a${next}>`
          }
        )
    })()

    return finalHtml
  }, [content, allowLinks])

  return (
    <div
      className={className}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
