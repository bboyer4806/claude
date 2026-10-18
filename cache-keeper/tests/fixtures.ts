// Test helpers: transcript rows shaped like Claude Code's own, and the inverse of
// powershell.ts's encodeCommand.

type RowOptions = { model?: string; ttl5m?: number; ttl1h?: number; speed?: string; geo?: string; isSidechain?: boolean }

export function assistantRow(o: RowOptions = {}): string {
  const ttl5m = o.ttl5m ?? 0
  const ttl1h = o.ttl1h ?? 0
  return JSON.stringify({
    parentUuid: 'parent-1',
    isSidechain: o.isSidechain ?? false,
    message: {
      model: o.model ?? 'claude-opus-5-5',
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: 'ok' }],
      usage: {
        input_tokens: 2,
        cache_creation_input_tokens: ttl5m + ttl1h,
        cache_read_input_tokens: 425_512,
        output_tokens: 10,
        cache_creation: { ephemeral_1h_input_tokens: ttl1h, ephemeral_5m_input_tokens: ttl5m },
        inference_geo: o.geo ?? 'global',
        speed: o.speed ?? 'standard',
      },
    },
    type: 'assistant',
    uuid: 'row-1',
    timestamp: '2026-10-18T14:00:00.000Z',
  })
}

export function progressRow(): string {
  return JSON.stringify({
    type: 'progress',
    isSidechain: false,
    data: { message: { type: 'assistant', message: { usage: { cache_creation: { ephemeral_1h_input_tokens: 9, ephemeral_5m_input_tokens: 0 } } } } },
  })
}

// base64 of UTF-16LE back to text, as powershell.exe -EncodedCommand reads it.
export function decodeCommand(base64: string): string {
  const bytes = atob(base64)
  let text = ''
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    text += String.fromCharCode(bytes.charCodeAt(i) | (bytes.charCodeAt(i + 1) << 8))
  }
  return text
}
