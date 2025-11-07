// Lightweight PDF text extraction using pdfjs-dist (browser only).
// Falls back gracefully if the library isn't available.

export async function extractTextFromPdf(fileOrData: File | ArrayBuffer): Promise<string> {
  // Dynamic import to avoid heavy bundle unless needed.
  let pdfjs: typeof import('pdfjs-dist') | undefined
  try {
    pdfjs = await import('pdfjs-dist')
  } catch {
    // Older versions expose build/pdf
    try {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      pdfjs = await import('pdfjs-dist/build/pdf')
    } catch {
      // Last resort: return plain text from bytes (garbled but non-blocking)
      const buf = fileOrData instanceof File ? await fileOrData.arrayBuffer() : fileOrData
      return new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(buf))
    }
  }

  // Some bundlers require explicit worker
  try {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    const worker = await import('pdfjs-dist/build/pdf.worker.mjs')
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    pdfjs.GlobalWorkerOptions.workerSrc = (worker as any).default || worker
  } catch {
    // If worker import fails, pdfjs will use a fallback; continue.
  }

  const data = fileOrData instanceof File ? await fileOrData.arrayBuffer() : fileOrData
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  const doc = await pdfjs.getDocument({ data }).promise
  let text = ''
  const pages = doc.numPages || 0
  for (let p = 1; p <= pages; p++) {
    const page = await doc.getPage(p)
    const content = await page.getTextContent()
    const strings = (content.items || []).map((it: any) => ('str' in it ? it.str : '')).filter(Boolean)
    text += strings.join(' ') + '\n\n'
  }
  try {
    await doc.cleanup()
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    if (doc.destroy) doc.destroy()
  } catch {
    // ignore
  }
  return text.trim()
}

