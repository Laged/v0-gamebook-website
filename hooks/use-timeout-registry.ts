"use client"

import { useCallback, useEffect, useRef } from "react"

export function useTimeoutRegistry() {
  const timeoutIdsRef = useRef<number[]>([])

  const scheduleTimeout = useCallback((cb: () => void, ms: number) => {
    const id = window.setTimeout(() => {
      timeoutIdsRef.current = timeoutIdsRef.current.filter((pendingId) => pendingId !== id)
      cb()
    }, ms)

    timeoutIdsRef.current.push(id)
    return id
  }, [])

  useEffect(() => {
    return () => {
      timeoutIdsRef.current.forEach((id) => window.clearTimeout(id))
      timeoutIdsRef.current = []
    }
  }, [])

  return scheduleTimeout
}
