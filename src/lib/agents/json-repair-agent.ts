import { ZodSchema } from 'zod'

export interface JSONRepairRequest<T> {
  rawText: string
  schema: ZodSchema<T>
  contextLabel?: string
}

export interface JSONRepairSuccess<T> {
  ok: true
  value: T
  attempts: number
}

export interface JSONRepairFailure {
  ok: false
  error: {
    message: string
    originalSnippet: string
  }
}

export type JSONRepairResult<T> = JSONRepairSuccess<T> | JSONRepairFailure

export interface IJSONRepairAgent {
  tryRepairJson<T>(input: JSONRepairRequest<T>): JSONRepairResult<T>
}

export class JSONRepairAgent implements IJSONRepairAgent {
  tryRepairJson<T>(input: JSONRepairRequest<T>): JSONRepairResult<T> {
    const snippet = (input.rawText || '').trim()
    if (!snippet) {
      return { ok: false, error: { message: 'Empty JSON text', originalSnippet: '' } }
    }

    const attempts: string[] = []

    // 1) As-is
    attempts.push(snippet)

    // 2) Extract fenced json ```json
    const md = snippet.match(/```json?\s*\n([\s\S]*?)\n```/i)
    if (md && md[1]) attempts.push(md[1])

    // 3) Extract first {...} object
    const obj = snippet.match(/\{[\s\S]*\}/)
    if (obj && obj[0]) attempts.push(obj[0])

    // 4) Heuristic cleanup pipeline on base candidates
    const baseCandidates = [...attempts]
    for (const base of baseCandidates) {
      let s = base
      // a) Normalize smart quotes and backticks
      s = s.replace(/[“”]/g, '"').replace(/[‘’]/g, "'")
      // b) Remove trailing commas before } or ]
      s = s.replace(/,\s*([}\]])/g, '$1')
      // c) Quote unquoted object keys: { key: value } -> { "key": value }
      s = s.replace(/([,{]\s*)([A-Za-z_][A-Za-z0-9_]*)(\s*:)/g, '$1"$2"$3')
      // d) Replace single-quoted strings with double quotes conservatively
      s = s.replace(/:\s*'([^']*)'/g, ': "$1"')
      s = s.replace(/'([^']*)'\s*:/g, '"$1":')
      attempts.push(s)
    }

    // Try each attempt with schema validation
    for (let i = 0; i < attempts.length; i++) {
      const t = attempts[i]
      try {
        const parsed = JSON.parse(t)
        const value = input.schema.parse(parsed)
        return { ok: true, value, attempts: i + 1 }
      } catch {
        // continue
      }
    }

    return {
      ok: false,
      error: {
        message: `Failed to repair JSON${input.contextLabel ? ` for ${input.contextLabel}` : ''}`,
        originalSnippet: snippet.slice(0, 200)
      }
    }
  }
}

export const jsonRepairAgent = new JSONRepairAgent()

