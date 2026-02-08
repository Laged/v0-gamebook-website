"use client"

import { useEffect, useRef, useState } from "react"

import { cn } from "@/lib/utils"

export const FLYING_NUMBER_TOTAL_MS = 650
export const FLYING_NUMBER_REDUCED_MS = 60

export interface FlyingNum {
  id: number
  value: string | number
  fromX: number
  fromY: number
  toX: number
  toY: number
  color: string
}

interface FlyingNumberProps {
  num: FlyingNum
  onDone: () => void
}

export function FlyingNumber({ num, onDone }: FlyingNumberProps) {
  const [arrived, setArrived] = useState(false)
  const doneRef = useRef(onDone)
  doneRef.current = onDone

  useEffect(() => {
    let rafA = 0
    let rafB = 0
    let timeoutId: number | null = null
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    const doneAfterMs = reduced ? FLYING_NUMBER_REDUCED_MS : FLYING_NUMBER_TOTAL_MS

    rafA = window.requestAnimationFrame(() => {
      rafB = window.requestAnimationFrame(() => {
        setArrived(true)
        // Start completion timing only after the "arrived" transition begins.
        timeoutId = window.setTimeout(() => doneRef.current(), doneAfterMs)
      })
    })

    return () => {
      window.cancelAnimationFrame(rafA)
      window.cancelAnimationFrame(rafB)
      if (timeoutId !== null) window.clearTimeout(timeoutId)
    }
  }, [])

  const dx = num.toX - num.fromX
  const dy = num.toY - num.fromY

  return (
    <div
      className={cn("flying-number", arrived && "flying-number-arrived")}
      style={{
        position: "fixed",
        zIndex: 9999,
        pointerEvents: "none",
        left: num.fromX,
        top: num.fromY,
        ["--fly-dx" as "--fly-dx"]: `${dx}px`,
        ["--fly-dy" as "--fly-dy"]: `${dy}px`,
        ["--fly-scale" as "--fly-scale"]: "0.42",
        ["--fly-start-color" as "--fly-start-color"]: num.color,
        ["--fly-end-color" as "--fly-end-color"]: num.color,
      } as React.CSSProperties}
    >
      {num.value}
    </div>
  )
}
