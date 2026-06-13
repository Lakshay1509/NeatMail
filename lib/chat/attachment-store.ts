import { randomUUID } from "crypto"

interface StoredAttachment {
  filename: string
  mimeType: string
  data: Buffer
  createdAt: number
}

const store = new Map<string, StoredAttachment>()

// Clean expired entries every 10 minutes
setInterval(() => {
  const cutoff = Date.now() - 60 * 60 * 1000
  for (const [key, val] of store) {
    if (val.createdAt < cutoff) store.delete(key)
  }
}, 10 * 60 * 1000)

export function storeAttachment(data: {
  filename: string
  mimeType: string
  dataBase64: string
}): string {
  const key = randomUUID()
  store.set(key, {
    filename: data.filename,
    mimeType: data.mimeType,
    data: Buffer.from(data.dataBase64, "base64"),
    createdAt: Date.now(),
  })
  return key
}

export function getAttachment(key: string): StoredAttachment | null {
  const entry = store.get(key)
  if (!entry) return null
  if (Date.now() - entry.createdAt > 60 * 60 * 1000) {
    store.delete(key)
    return null
  }
  return entry
}

export function consumeAttachment(key: string): StoredAttachment | null {
  const entry = getAttachment(key)
  if (entry) store.delete(key)
  return entry
}
