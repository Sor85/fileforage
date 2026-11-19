export type Kind = "text" | "document" | "image" | "video" | "audio"
export type ChunkKind = "name" | "text" | "page" | "image" | "audio" | "video" | "transcript"

export type FileInfo = {
  id: number
  collection_id: number
  name: string
  rel_path: string
  path: string
  dir: string
  ext: string
  kind: Kind
  size: number
  mtime: number
  status: string
  error: string | null
  meta: {
    width?: number
    height?: number
    duration?: number
    pages?: number
    chars?: number
    has_audio?: boolean
  }
  has_thumb: boolean
}

export type Chunk = {
  id: number
  kind: ChunkKind
  ord: number
  text: string | null
  start: number | null
  end: number | null
  has_thumb: boolean
  score?: number
}

export type SearchResult = {
  file: FileInfo
  score: number
  relevance: number
  match: Chunk
  extra: Chunk[]
}

export type SearchResponse = {
  query: string | null
  results: SearchResult[]
  timing: { embed_ms: number; search_ms: number }
}

export type FileDetail = FileInfo & {
  chunks: Chunk[]
  collection: { id: number; name: string; path: string } | null
  content: string | null
  truncated?: boolean
}

export type Progress = {
  phase: "idle" | "waiting_model" | "scanning" | "indexing"
  collection_id: number | null
  collection_name: string | null
  total: number
  done: number
  failed: number
  current: string | null
  current_progress: number
  started_at: number | null
  eta_seconds: number | null
  paused: boolean
  queued: number[]
}

export type Status = {
  version: string
  model: {
    name: string
    status: "idle" | "loading" | "ready" | "error"
    error: string | null
    device: string
    dtype: string
    dim: number
    modalities: string[]
    load_seconds: number | null
  }
  whisper: { enabled: boolean; model: string; error: string | null }
  indexer: Progress
  stats: {
    files: number
    indexed: number
    errors: number
    pending: number
    bytes: number
    chunks: number
    by_kind: Partial<Record<Kind, number>>
    collections: number
  }
}

export type Collection = {
  id: number
  path: string
  name: string
  created_at: number
  last_scan_at: number | null
  last_error: string | null
  /** 新添加的目录在用户点击“开始索引”前为 false */
  enabled: boolean
  excluded_kinds: Kind[]
  exists: boolean
  files: number
  bytes: number
  errors: number
  pending: number
  kinds: Partial<Record<Kind, number>>
}

export type FsListing = {
  path: string | null
  parent: string | null
  entries: { name: string; path: string }[]
}

export type SettingsValues = {
  transcribe: boolean
  whisper_model: string
  image_tokens: number
  video_segment_seconds: number
  video_max_frames: number
  audio_segment_seconds: number
  max_text_mb: number
  min_image_px: number
  include_hidden: boolean
  excludes: string[]
  exclude_presets: string[]
  watch: boolean
  min_score: number
}

export type ExcludePreset = { key: string; label: string; exts: string[] }

export type SettingsResponse = {
  values: SettingsValues
  exclude_presets: ExcludePreset[]
  env: { model: string; device: string; roots: string[]; data_dir: string; modalities: string[] }
}

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  if (!res.ok) {
    let msg = `请求失败（${res.status}）`
    try {
      const body = await res.json()
      if (body?.detail) msg = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail)
    } catch {
      /* 非 JSON 响应 */
    }
    throw new ApiError(res.status, msg)
  }
  return res.json() as Promise<T>
}

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  body: body === undefined ? undefined : JSON.stringify(body),
})

function qs(params: Record<string, string | number | undefined | null>) {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") p.set(k, String(v))
  const s = p.toString()
  return s ? `?${s}` : ""
}

export const api = {
  status: () => request<Status>("/api/status"),
  search: (q: string, kinds?: string, collections?: string, signal?: AbortSignal) =>
    request<SearchResponse>(`/api/search${qs({ q, kinds, collections })}`, { signal }),
  searchImage: (file: Blob, kinds?: string) => {
    const fd = new FormData()
    fd.append("file", file)
    return request<SearchResponse>(`/api/search/image${qs({ kinds })}`, { method: "POST", body: fd })
  },
  similar: (id: number) => request<{ results: SearchResult[] }>(`/api/files/${id}/similar`),
  file: (id: number) => request<FileDetail>(`/api/files/${id}`),
  collections: () => request<Collection[]>("/api/collections"),
  addCollection: (path: string, name?: string) => request<Collection>("/api/collections", json("POST", { path, name })),
  updateCollection: (id: number, body: { excluded_kinds?: Kind[] }) =>
    request<Collection>(`/api/collections/${id}`, json("PATCH", body)),
  startCollection: (id: number) => request<Collection>(`/api/collections/${id}/start`, json("POST")),
  stopCollection: (id: number) => request<Collection>(`/api/collections/${id}/stop`, json("POST")),
  deleteCollection: (id: number) => request<{ ok: boolean }>(`/api/collections/${id}`, json("DELETE")),
  scanCollection: (id: number) => request<{ ok: boolean }>(`/api/collections/${id}/scan`, json("POST")),
  reindexCollection: (id: number) => request<{ ok: boolean }>(`/api/collections/${id}/reindex`, json("POST")),
  collectionErrors: (id: number) => request<FileInfo[]>(`/api/collections/${id}/errors`),
  indexer: (action: "pause" | "resume" | "cancel") => request<Progress>("/api/indexer", json("POST", { action })),
  fs: (path?: string | null) => request<FsListing>(`/api/fs${qs({ path })}`),
  settings: () => request<SettingsResponse>("/api/settings"),
  saveSettings: (values: Partial<SettingsValues>) => request<SettingsResponse>("/api/settings", json("PUT", values)),
}

export const fileUrl = {
  raw: (id: number) => `/api/files/${id}/raw`,
  download: (id: number) => `/api/files/${id}/raw?download=1`,
  thumb: (id: number, name = "file") => `/api/files/${id}/thumb/${name}`,
  chunkThumb: (fileId: number, c: Pick<Chunk, "kind" | "ord">) => `/api/files/${fileId}/thumb/${c.kind}-${c.ord}`,
}
