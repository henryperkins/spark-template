import { appConfig } from './config'
import { encoding_for_model, get_encoding } from '@dqbd/tiktoken'

/**
 * Sanitize untrusted user text before interpolation into prompts.
 * - Neutralizes code fences
 * - Removes common instruction-takeover phrases
 * - Optionally redacts simple PII patterns
 * - Enforces max length
 */
export function sanitizeQueryForPrompt(input: string): string {
  const { sanitizeQueries, maxUserQueryChars, redactPII } = appConfig.safety

  if (!sanitizeQueries) {
    return (input ?? '').slice(0, maxUserQueryChars)
  }

  let s = String(input ?? '')

  // Neutralize code fences and common jailbreak patterns
  s = s
    .replace(/```/g, "'''")
    .replace(/\bIgnore (?:previous|all) instructions\b/gi, '[instruction phrase removed]')
    .replace(/\bDisregard (?:previous|all) instructions\b/gi, '[instruction phrase removed]')
    .replace(/\bYou are now\b/gi, '[role change removed]')
    .replace(/\bSystem:\b/gi, '[system role removed]')

  // Optional light PII redaction (best-effort, not exhaustive)
  if (redactPII) {
    s = s
      // emails
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted-email]')
      // API keys or tokens (simple heuristic: 20+ contiguous base64url/hex-like)
      .replace(/\b[A-Za-z0-9_-]{20,}\b/g, '[redacted-token]')
      // phone numbers (very rough)
      .replace(/\b(?:\+?\d{1,3}[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?){2}\d{4}\b/g, '[redacted-phone]')
  }

  // Enforce length
  if (s.length > maxUserQueryChars) {
    s = s.slice(0, maxUserQueryChars) + '…'
  }

  return s
}

// Best-effort mapping to a tokenizer encoding; falls back to o200k_base → cl100k_base → heuristic
function getEncodingForModel(modelName?: string) {
  try {
    if (modelName) {
      return encoding_for_model(modelName as unknown)
    }
  } catch {
    // ignore and try explicit encodings
  }
  try {
    return get_encoding('o200k_base')
  } catch {
    // ignore
  }
  try {
    return get_encoding('cl100k_base')
  } catch {
    // ignore
  }
  return null
}

/**
 * Estimate token count using tiktoken when available; falls back to char:token ratio heuristic.
 * Providing model helps choose the correct encoding; when omitted, defaults to appConfig.model.defaultModel.
 */
export function estimateTokens(text: string, model?: string): number {
  const s = text ?? ''
  try {
    const enc = getEncodingForModel(model || appConfig.model.defaultModel)
    if (enc) {
      const n = enc.encode(s).length
      enc.free()
      return n
    }
  } catch {
    // fall back below
  }
  const ratio = appConfig.truncation.tokenCharRatio || 4.0
  return Math.ceil(s.length / Math.max(ratio, 1))
}

/**
 * Truncate at approximate token budget, trying to end on a sentence boundary.
 * Adds an annotation when truncated.
 */
export function truncateContext(text: string, maxTokens: number, options?: { notice?: string }): string {
  if (!text) return ''
  const estimated = estimateTokens(text)
  if (estimated <= maxTokens) return text

  const maxChars = Math.max(1, Math.floor(maxTokens * (appConfig.truncation.tokenCharRatio || 4.0)))
  const slice = text.slice(0, maxChars)

  // Try to end on a sentence boundary near the end of the slice
  const boundary = Math.max(
    slice.lastIndexOf('.'),
    slice.lastIndexOf('!'),
    slice.lastIndexOf('?')
  )

  const cutoff = boundary > maxChars * 0.7 ? boundary + 1 : maxChars
  const base = slice.slice(0, cutoff).trimEnd()

  const notice = options?.notice ?? '[Context truncated to fit token budget]'
  return `${base}\n\n${notice}`
}

/**
 * Deterministic JSON-output guardrail text to embed in system prompts.
 * Include verbatim at the end of your prompt when JSON output is required.
 */
export const JSON_OUTPUT_REQUIREMENTS = appConfig.prompts.enforceJsonOnly
  ? [
      'CRITICAL OUTPUT REQUIREMENTS:',
      '- Return ONLY a valid JSON object.',
      '- Do NOT include markdown, code fences, or explanatory text.',
      '- Do NOT include trailing commas.',
      '- No newlines outside the JSON object.',
      '',
      'Example valid:',
      '{"ok": true}',
      '',
      'Example INVALID:',
      '```json',
      '{"ok": true}',
      '```',
      'Analysis here...',
      '',
      'YOUR OUTPUT (JSON only):'
    ].join('\n')
  : ''

/**
 * Normalize whitespace for compact prompt serialization.
 */
export function normalizeWhitespace(s: string): string {
  return String(s ?? '').replace(/\s+/g, ' ').trim()
}
