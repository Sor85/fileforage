import { useQuery } from "@tanstack/react-query"

import { api } from "@/lib/api"

export function useStatus() {
  return useQuery({
    queryKey: ["status"],
    queryFn: api.status,
    refetchInterval: (q) => {
      const d = q.state.data
      if (!d) return 2000
      const busy = d.indexer.phase !== "idle" || d.model.status === "loading" || d.indexer.queued.length > 0
      return busy ? 1000 : 5000
    },
  })
}

export function useCollections() {
  const status = useStatus()
  const busy = status.data ? status.data.indexer.phase !== "idle" : false
  return useQuery({
    queryKey: ["collections"],
    queryFn: api.collections,
    refetchInterval: busy ? 1500 : false,
  })
}
