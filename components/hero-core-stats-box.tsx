"use client"

import { cn } from "@/lib/utils"

export type HeroCoreStatKey = "skill" | "stamina" | "luck"
export type HeroCoreValues = Record<HeroCoreStatKey, number | "?">
export type HeroCoreIncoming = Partial<Record<HeroCoreStatKey, boolean>>

interface HeroCoreStatsBoxProps {
  values: HeroCoreValues
  incoming?: HeroCoreIncoming
  compact?: boolean
  dataPrefix?: "creation" | "header"
  sharedAttr?: string
  className?: string
}

export function HeroCoreStatsBox({
  values,
  incoming,
  compact = false,
  dataPrefix,
  sharedAttr,
  className,
}: HeroCoreStatsBoxProps) {
  const defs: Array<{ key: HeroCoreStatKey; short: string; color: string }> = [
    { key: "skill", short: "SKL", color: "text-blue-900" },
    { key: "stamina", short: "STA", color: "text-red-900" },
    { key: "luck", short: "LCK", color: "text-emerald-900" },
  ]

  const dataStat = (key: HeroCoreStatKey) => {
    if (!dataPrefix) return undefined
    if (dataPrefix === "creation") return `creation-${key}`
    const map: Record<HeroCoreStatKey, string> = { skill: "SKL", stamina: "STA", luck: "LCK" }
    return `header-${map[key]}`
  }

  return (
    <div
      data-shared={sharedAttr}
      className={cn(
        "rounded-sm border border-stone-700/50 bg-stone-100/45",
        compact ? "p-1.5" : "p-2.5",
        className,
      )}
    >
      <div className={cn("grid grid-cols-3", compact ? "gap-1.5" : "gap-3")}>
        {defs.map((def) => {
          const value = values[def.key]
          const isIncoming = Boolean(incoming?.[def.key])
          const display = isIncoming ? 0 : value
          const known = value !== "?"
          return (
            <div
              key={def.key}
              className={cn(
                "rounded-sm border text-center",
                compact
                  ? "border-stone-700 bg-stone-100/90 px-2 py-1 min-w-[44px]"
                  : "border-stone-700 bg-stone-100/90 p-3",
              )}
            >
              <p className={cn("uppercase tracking-wider font-[Cinzel]", compact ? "text-[9px] text-stone-400 mb-0.5" : "text-xs text-stone-500 mb-1")}>
                {def.short}
              </p>
              <p
                data-stat={dataStat(def.key)}
                className={cn(
                  "font-bold font-[MedievalSharp] leading-none",
                  compact ? "text-sm" : "text-3xl",
                  isIncoming && "text-transparent",
                  !isIncoming && !known && "text-stone-400",
                  !isIncoming && known && def.color,
                )}
              >
                {display}
              </p>
            </div>
          )
        })}
      </div>
    </div>
  )
}
