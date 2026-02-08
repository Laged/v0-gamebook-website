"use client"
import React, { Suspense, useState, useReducer, useCallback, useEffect, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

const DungeonDice = React.lazy(() => import("@/components/dungeon-dice"))
type DieSpec = { value: number; tint?: string }
interface DiceOpts {
  label?: string
  title?: string
  comparison?: { text: string; success: boolean; successLabel: string; failLabel: string }
  onDone?: () => void
  displayTotal?: number
  flyTarget?: string
  flyValue?: string | number
  flyColor?: string
}
type ShowDiceFn = (results: DieSpec[], opts?: DiceOpts) => void

/* ── Dice Helpers ── */
function r1d6() { return Math.floor(Math.random() * 6) + 1 }
function r2d6(): [number, number] { return [r1d6(), r1d6()] }

/* ── Types ── */
interface Room { x: number; y: number; status: "safe" | "danger" }
interface Log { text: string; type: "info" | "success" | "danger" | "warning"; id: number }
interface Enemy { name: string; skill: number; stamina: number; maxStamina: number }
interface GS {
  created: boolean; skill: number; mSkill: number; stamina: number; mStamina: number
  luck: number; mLuck: number; provisions: number; gold: number; equipment: string[]
  atkMod: number; log: Log[]; logId: number; rooms: Record<string, Room>; pos: { x: number; y: number }
}

const initRooms = { "0,0": { x: 0, y: 0, status: "safe" as const } }
const init: GS = {
  created: false, skill: 0, mSkill: 0, stamina: 0, mStamina: 0,
  luck: 0, mLuck: 0, provisions: 10, gold: 0, equipment: [],
  atkMod: 0, log: [], logId: 0, rooms: initRooms, pos: { x: 0, y: 0 },
}

type GA =
  | { type: "CREATE"; skill: number; stamina: number; luck: number }
  | { type: "SET_SKL"; v: number } | { type: "SET_STA"; v: number } | { type: "SET_LCK"; v: number }
  | { type: "SET_GOLD"; v: number } | { type: "ADD_ITEM"; item: string } | { type: "DEL_ITEM"; idx: number }
  | { type: "EAT" } | { type: "SET_ATK"; v: number }
  | { type: "POTION"; stat: "skill" | "stamina" | "luck"; bonus: number }
  | { type: "LOAD_STATE"; state: GS }
  | { type: "LOG"; text: string; lt: Log["type"] }
  | { type: "MOVE"; dx: number; dy: number } | { type: "SAFE" } | { type: "DANGER" }

function reducer(s: GS, a: GA): GS {
  switch (a.type) {
    case "CREATE": return { ...s, created: true, skill: a.skill, mSkill: a.skill, stamina: a.stamina, mStamina: a.stamina, luck: a.luck, mLuck: a.luck }
    case "SET_SKL": return { ...s, skill: Math.max(0, Math.min(a.v, s.mSkill)) }
    case "SET_STA": return { ...s, stamina: Math.max(0, Math.min(a.v, s.mStamina)) }
    case "SET_LCK": return { ...s, luck: Math.max(0, a.v) }
    case "SET_GOLD": return { ...s, gold: Math.max(0, a.v) }
    case "ADD_ITEM": return { ...s, equipment: [...s.equipment, a.item] }
    case "DEL_ITEM": return { ...s, equipment: s.equipment.filter((_, i) => i !== a.idx) }
    case "EAT": {
      if (s.provisions <= 0) return s
      const ns = Math.min(s.stamina + 4, s.mStamina)
      return { ...s, provisions: s.provisions - 1, stamina: ns }
    }
    case "SET_ATK": return { ...s, atkMod: a.v }
    case "POTION": {
      if (a.stat === "skill") return { ...s, skill: s.mSkill + a.bonus }
      if (a.stat === "stamina") return { ...s, stamina: s.mStamina + a.bonus }
      return { ...s, luck: s.mLuck + a.bonus }
    }
    case "LOG": {
      const id = s.logId + 1
      return { ...s, log: [{ text: a.text, type: a.lt, id }, ...s.log].slice(0, 80), logId: id }
    }
    case "MOVE": {
      const nx = s.pos.x + a.dx, ny = s.pos.y + a.dy, k = `${nx},${ny}`
      const rooms = { ...s.rooms }
      if (!rooms[k]) rooms[k] = { x: nx, y: ny, status: "safe" }
      return { ...s, pos: { x: nx, y: ny }, rooms }
    }
    case "SAFE": { const k = `${s.pos.x},${s.pos.y}`; return { ...s, rooms: { ...s.rooms, [k]: { ...s.rooms[k], status: "safe" } } } }
    case "DANGER": { const k = `${s.pos.x},${s.pos.y}`; return { ...s, rooms: { ...s.rooms, [k]: { ...s.rooms[k], status: "danger" } } } }
    case "LOAD_STATE": return { ...a.state }
    default: return s
  }
}

/* ── Style Constants ── */
const PNL = "rounded-sm border-2 border-stone-700 bg-[#eaddcf] p-4 shadow-md"
const INK = "text-stone-900"
const FADED = "text-stone-500"
const BTN = "bg-stone-800 text-[#eaddcf] border-2 border-stone-600 rounded-sm font-[MedievalSharp] hover:bg-red-900 hover:border-red-950 hover:text-white transition-all shadow-md active:scale-[0.97]"

/* ── LocalStorage ── */
interface SaveSlot { name: string; date: string; state: GS }
const LS_CUR = "ff-current", LS_SAV = "ff-saves"
function loadSaves(): SaveSlot[] { try { return JSON.parse(localStorage.getItem(LS_SAV) || "[]") } catch { return [] } }
function writeSaves(s: SaveSlot[]) { localStorage.setItem(LS_SAV, JSON.stringify(s)) }
function loadCur(): GS | null { try { const r = localStorage.getItem(LS_CUR); return r ? JSON.parse(r) : null } catch { return null } }

/* ── Stat Pills ── */
function StatPills({ items, size = "sm", animated = false }: { items: [string, string | number, string][]; size?: "sm" | "xs"; animated?: boolean }) {
  const sz = size === "sm" ? "text-[10px]" : "text-[9px]"
  const vz = size === "sm" ? "text-sm font-bold" : "text-xs font-bold"
  return (
    <div className="flex flex-wrap gap-3">
      {items.map(([l, v, c]) => (
        <div key={l} className="flex flex-col items-center">
          <span className={cn(sz, "uppercase tracking-widest font-[Cinzel] text-stone-400")}>{l}</span>
          <span data-stat={animated ? `header-${l}` : undefined} key={animated ? `${l}-${v}` : undefined} className={cn(vz, "font-[MedievalSharp]", c, animated && "stat-pop")}>{v}</span>
        </div>
      ))}
    </div>
  )
}

/* ── Run Summary ── */
function RunSummary({ gs }: { gs: GS }) {
  const rooms = Object.keys(gs.rooms).length
  const danger = Object.values(gs.rooms).filter(r => r.status === "danger").length
  const alive = gs.stamina > 0
  return (
    <div className="flex flex-col gap-2.5">
      <span className={cn("text-xs font-bold font-[MedievalSharp] px-2 py-0.5 rounded-sm border w-fit", alive ? "bg-emerald-100 text-emerald-900 border-emerald-700" : "bg-red-100 text-red-900 border-red-700")}>{alive ? "Alive" : "Fallen"}</span>
      <StatPills size="xs" items={[
        ["SKL", `${gs.skill}/${gs.mSkill}`, "text-stone-800"],
        ["STA", `${gs.stamina}/${gs.mStamina}`, "text-red-800"],
        ["LCK", `${gs.luck}/${gs.mLuck}`, "text-emerald-800"],
        ["PRV", gs.provisions, "text-amber-800"],
        ["GLD", gs.gold, "text-yellow-700"],
        ["MAP", `${rooms}${danger > 0 ? ` (${danger}!)` : ""}`, "text-stone-600"],
        ...(gs.equipment.length > 0 ? [["BAG", `${gs.equipment.length}`, "text-stone-600"] as [string, string, string]] : []),
      ]} />
    </div>
  )
}

/* ── Creation ── */
function Creation({ onCreate, log, showDice }: { onCreate: (sk: number, st: number, l: number) => void; log: (t: string, ty: Log["type"]) => void; showDice: ShowDiceFn }) {
  const [rolling, setRolling] = useState(false)
  const [phase, setPhase] = useState<"idle" | "skill" | "stamina" | "luck" | "done">("idle")
  const [partial, setPartial] = useState<{ sk?: number; skRaw?: number; st?: number; stRaw?: [number, number]; l?: number; lRaw?: number }>({})

  function startRoll() {
    setRolling(true)
    setPhase("skill")
    setPartial({})
    // Roll Skill: 1d6 + 6
    const sd = r1d6()
    const sk = sd + 6
    showDice([{ value: sd }], { title: "Create Hero", label: `Skill: 1d6 + 6 = ${sk}`, displayTotal: sk, flyTarget: '[data-stat="creation-skill"]', flyValue: sk, flyColor: '#1e3a8a', onDone: () => {
      setPartial(p => ({ ...p, sk, skRaw: sd }))
      setPhase("stamina")
      const std = r2d6()
      const st = std[0] + std[1] + 12
      showDice([{ value: std[0] }, { value: std[1] }], { title: "Create Hero", label: `Stamina: 2d6 + 12 = ${st}`, displayTotal: st, flyTarget: '[data-stat="creation-stamina"]', flyValue: st, flyColor: '#7f1d1d', onDone: () => {
        setPartial(p => ({ ...p, st, stRaw: std }))
        setPhase("luck")
        const ld = r1d6()
        const l = ld + 6
        showDice([{ value: ld }], { title: "Create Hero", label: `Luck: 1d6 + 6 = ${l}`, displayTotal: l, flyTarget: '[data-stat="creation-luck"]', flyValue: l, flyColor: '#064e3b', onDone: () => {
          setPartial(p => ({ ...p, l, lRaw: ld }))
          setPhase("done")
          setRolling(false)
        }})
      }})
    }})
  }

  const stats = phase === "done" && partial.sk != null && partial.st != null && partial.l != null
    ? { sk: partial.sk, st: partial.st, l: partial.l } : null

  function confirm() {
    if (!stats) return
    onCreate(stats.sk, stats.st, stats.l)
    log(`Hero created: Skill ${stats.sk} Stamina ${stats.st} Luck ${stats.l}`, "success")
  }

  // Show partial results as they come in
  const statCards: [string, number | undefined, string][] = [
    ["Skill", partial.sk, "text-blue-900"],
    ["Stamina", partial.st, "text-red-900"],
    ["Luck", partial.l, "text-emerald-900"],
  ]

  return (
    <div className={cn(PNL, "border-4 border-double max-w-md mx-auto")}>
      <h2 className={cn("text-2xl font-bold mb-2 font-[Cinzel] text-center uppercase tracking-wider", INK)}>Create Your Hero</h2>
      <p className={cn("text-sm mb-6 text-center font-[Crimson_Text] italic", FADED)}>Roll the bones to determine thy fate...</p>
      {phase === "idle" ? (
        <Button className={cn(BTN, "w-full text-lg py-6")} onClick={startRoll} disabled={rolling}>Roll Character</Button>
      ) : (
        <div className="flex flex-col gap-4">
          {/* Partial / full stat display */}
          <div className="grid grid-cols-3 gap-3 text-center">
            {statCards.map(([label, v, c]) => (
              <div key={label} className={cn("rounded-sm border-2 p-3 transition-all duration-300", v != null ? "border-stone-900 bg-white/40" : "border-stone-600/30 bg-white/10")}>
                <p className={cn("text-xs font-[Cinzel] uppercase tracking-wider mb-1", FADED)}>{label}</p>
                {v != null ? (
                  <p data-stat={`creation-${label.toLowerCase()}`} className={cn("text-3xl font-bold font-[MedievalSharp] ink-stamp", c)}>{v}</p>
                ) : (
                  <p data-stat={`creation-${label.toLowerCase()}`} className={cn("text-3xl font-bold font-[MedievalSharp] text-stone-300 animate-pulse")}>?</p>
                )}
              </div>
            ))}
          </div>
          {rolling && (
            <p className={cn("text-sm text-center font-[Crimson_Text] italic animate-pulse", FADED)}>
              {phase === "skill" && "Rolling for Skill..."}
              {phase === "stamina" && "Rolling for Stamina..."}
              {phase === "luck" && "Rolling for Luck..."}
            </p>
          )}
          {stats && (
            <div className="flex gap-3">
              <Button className={cn(BTN, "flex-1")} onClick={confirm}>Accept Destiny</Button>
              <Button variant="outline" className="flex-1 bg-transparent border-stone-600 text-stone-700 font-[MedievalSharp] hover:bg-stone-200" onClick={() => { setPhase("idle"); setPartial({}) }}>Reroll</Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/* ── Character Sheet ── */
function Sheet({ s, d }: { s: GS; d: React.Dispatch<GA> }) {
  const [item, setItem] = useState("")
  const log = useCallback((t: string, ty: Log["type"]) => d({ type: "LOG", text: t, lt: ty }), [d])
  const adj = (type: "SET_SKL" | "SET_STA" | "SET_LCK", cur: number, delta: number) => d({ type, v: cur + delta })

  return (
    <div className="flex flex-col gap-5">
      {/* Stats */}
      <div className={PNL}>
        <h3 className={cn("mb-4 text-lg font-bold font-[Cinzel] uppercase tracking-wider", INK)}>Attributes</h3>
        {([["Skill", s.skill, s.mSkill, "SET_SKL", "text-blue-900", "bg-blue-800"], ["Stamina", s.stamina, s.mStamina, "SET_STA", "text-red-900", "bg-red-800"], ["Luck", s.luck, s.mLuck, "SET_LCK", "text-emerald-900", "bg-emerald-800"]] as const).map(([label, cur, max, type, tc, bc]) => (
          <div key={label} className="mb-3">
            <div className="flex items-center justify-between mb-1">
              <span className={cn("text-sm font-[Cinzel] uppercase tracking-wider", tc)}>{label}</span>
              <span className={cn("font-bold font-[MedievalSharp]", tc)}>{cur}/{max}</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="h-3 flex-1 overflow-hidden rounded-full bg-stone-300"><div className={cn("h-full rounded-full transition-all duration-500 ease-out", bc)} style={{ width: `${(cur / Math.max(max, 1)) * 100}%` }} /></div>
              <button type="button" className="w-8 h-8 rounded-sm border border-stone-600 bg-white/40 text-stone-800 font-bold" onClick={() => adj(type, cur, -1)}>-</button>
              <button type="button" className="w-8 h-8 rounded-sm border border-stone-600 bg-white/40 text-stone-800 font-bold" onClick={() => adj(type, cur, 1)}>+</button>
            </div>
          </div>
        ))}
      </div>
      {/* Provisions */}
      <div className={PNL}>
        <h3 className={cn("mb-3 text-lg font-bold font-[Cinzel]", INK)}>Provisions</h3>
        <p className={cn("text-sm mb-2 font-[Crimson_Text]", FADED)}>Remaining: <span className="font-bold text-amber-800">{s.provisions}</span></p>
        <p className={cn("text-xs italic font-[Crimson_Text] mb-3", FADED)}>Cannot eat during combat.</p>
        <div className="flex gap-2">
          <Button className={BTN} onClick={() => { d({ type: "EAT" }); if (s.provisions > 0) log(`Ate a provision. Stamina ${s.stamina}->${Math.min(s.stamina + 4, s.mStamina)}`, "success") }} disabled={s.provisions <= 0}>Eat (+4 Stamina)</Button>
          <div className="flex items-center gap-1">
            <button type="button" className="w-8 h-8 rounded-sm border border-stone-600 bg-white/40 text-stone-800 font-bold" onClick={() => d({ type: "EAT" })} disabled={s.provisions <= 0}>-</button>
            <span className="text-sm font-[MedievalSharp] text-stone-800 w-6 text-center">{s.provisions}</span>
            <button type="button" className="w-8 h-8 rounded-sm border border-stone-600 bg-white/40 text-stone-800 font-bold" onClick={() => d({ type: "SET_STA", v: s.stamina })} disabled>+</button>
          </div>
        </div>
      </div>
      {/* Attack Modifier */}
      <div className={PNL}>
        <h3 className={cn("mb-3 text-lg font-bold font-[Cinzel]", INK)}>Combat Modifier</h3>
        <div className="flex items-center gap-3">
          <button type="button" className="w-8 h-8 rounded-sm border border-stone-600 bg-white/40 text-stone-800 font-bold" onClick={() => d({ type: "SET_ATK", v: s.atkMod - 1 })}>-</button>
          <span className={cn("text-2xl font-bold font-[MedievalSharp]", s.atkMod > 0 ? "text-emerald-800" : s.atkMod < 0 ? "text-red-800" : INK)}>{s.atkMod >= 0 ? "+" : ""}{s.atkMod}</span>
          <button type="button" className="w-8 h-8 rounded-sm border border-stone-600 bg-white/40 text-stone-800 font-bold" onClick={() => d({ type: "SET_ATK", v: s.atkMod + 1 })}>+</button>
          <span className={cn("text-xs font-[Crimson_Text] italic", FADED)}>Added to Attack Strength</span>
        </div>
      </div>
      {/* Potions */}
      <div className={PNL}>
        <h3 className={cn("mb-3 text-lg font-bold font-[Cinzel]", INK)}>Potions</h3>
        <div className="flex flex-wrap gap-2">
          {([["Skill Potion", "skill", 0], ["Strength Potion", "stamina", 0], ["Fortune Potion", "luck", 1]] as const).map(([label, stat, bonus]) => (
            <Button key={label} className={BTN} onClick={() => { d({ type: "POTION", stat, bonus }); log(`Used ${label}! ${stat} restored.`, "success") }}>{label}</Button>
          ))}
        </div>
      </div>
      {/* Inventory & Gold */}
      <div className={PNL}>
        <h3 className={cn("mb-3 text-lg font-bold font-[Cinzel]", INK)}>Inventory</h3>
        <div className="flex items-center gap-3 mb-3">
          <span className={cn("text-sm font-[Cinzel]", INK)}>Gold:</span>
          <button type="button" className="w-8 h-8 rounded-sm border border-stone-600 bg-white/40 text-stone-800 font-bold" onClick={() => d({ type: "SET_GOLD", v: s.gold - 1 })}>-</button>
          <span className="text-xl font-bold font-[MedievalSharp] text-yellow-700">{s.gold}</span>
          <button type="button" className="w-8 h-8 rounded-sm border border-stone-600 bg-white/40 text-stone-800 font-bold" onClick={() => d({ type: "SET_GOLD", v: s.gold + 1 })}>+</button>
        </div>
        <div className="flex gap-2 mb-3">
          <Input placeholder="Add item..." value={item} onChange={e => setItem(e.target.value)} className="bg-white/40 border-stone-600 text-stone-900 placeholder:text-stone-400 font-[Crimson_Text]" onKeyDown={e => { if (e.key === "Enter" && item.trim()) { d({ type: "ADD_ITEM", item: item.trim() }); setItem("") } }} />
          <Button className={BTN} onClick={() => { if (item.trim()) { d({ type: "ADD_ITEM", item: item.trim() }); setItem("") } }}>Add</Button>
        </div>
        {s.equipment.length > 0 ? (
          <ul className="flex flex-col gap-1">{s.equipment.map((eq, i) => (
            <li key={`${i}-${eq}`} className="flex items-center justify-between rounded-sm bg-white/30 border border-stone-400 px-3 py-1.5 text-sm font-[Crimson_Text] text-stone-800 panel-in" style={{ animationDelay: `${i * 30}ms` }}>
              <span>{eq}</span>
              <button type="button" className="text-xs text-red-800 hover:text-red-600 font-[MedievalSharp]" onClick={() => d({ type: "DEL_ITEM", idx: i })}>drop</button>
            </li>
          ))}</ul>
        ) : <p className={cn("text-sm italic font-[Crimson_Text]", FADED)}>No items carried.</p>}
      </div>
      {/* Retire */}
      <div className={PNL}>
        <Button variant="outline" className="w-full bg-transparent border-red-800 text-red-800 font-[MedievalSharp] hover:bg-red-900 hover:text-white" onClick={() => { if (confirm("Retire this adventurer?")) { localStorage.removeItem(LS_CUR); window.location.reload() } }}>Retire Adventurer</Button>
      </div>
    </div>
  )
}

/* ── Combat ── */
function Combat({ s, d, showDice }: { s: GS; d: React.Dispatch<GA>; showDice: ShowDiceFn }) {
  const [en, setEn] = useState("Orc")
  const [esk, setEsk] = useState("8")
  const [est, setEst] = useState("6")
  const [enemy, setEnemy] = useState<Enemy | null>(null)
  const [queue, setQueue] = useState<Enemy[]>([])
  const [rlog, setRlog] = useState<string[]>([])
  const [over, setOver] = useState(false)
  const [round, setRound] = useState(0)
  const log = useCallback((t: string, ty: Log["type"] = "info") => d({ type: "LOG", text: t, lt: ty }), [d])

  function addToQueue() {
    const sk = Number.parseInt(esk) || 8, st = Number.parseInt(est) || 6
    setQueue(q => [...q, { name: en || "Enemy", skill: sk, stamina: st, maxStamina: st }])
  }

  function startNext(fromQueue?: Enemy) {
    const e = fromQueue || (() => { const sk = Number.parseInt(esk) || 8, st = Number.parseInt(est) || 6; return { name: en || "Enemy", skill: sk, stamina: st, maxStamina: st } as Enemy })()
    setEnemy(e); setRlog([]); setOver(false); setRound(0)
    log(`Combat: ${e.name} (Sk${e.skill} St${e.stamina})`, "warning")
  }

  function loadNextFromQueue() {
    if (queue.length > 0) { const [next, ...rest] = queue; setQueue(rest); startNext(next) }
  }

  function fight(useLuck: boolean) {
    if (!enemy || over || s.stamina <= 0) return
    const rd = round + 1
    const hr = r2d6(), ht = hr[0] + hr[1] + s.skill + s.atkMod
    const er = r2d6(), et = er[0] + er[1] + enemy.skill
    const modStr = s.atkMod !== 0 ? ` +${s.atkMod}mod` : ""

    const heroWon = ht > et
    const enemyWon = et > ht
    const bannerSuccess = heroWon

    const combatDice: DieSpec[] = [
      { value: hr[0] }, { value: hr[1] },
      { value: er[0], tint: "#3b1010" }, { value: er[1], tint: "#3b1010" },
    ]

    showDice(combatDice, {
      title: `Combat Round ${rd}`,
      label: `You ${ht} vs ${enemy.name} ${et}`,
      comparison: {
        text: `[${hr[0]}+${hr[1]}]+${s.skill}${modStr} = ${ht}  vs  [${er[0]}+${er[1]}]+${enemy.skill} = ${et}`,
        success: bannerSuccess,
        successLabel: "HIT!",
        failLabel: enemyWon ? "WOUNDED!" : "CLASH!",
      },
      displayTotal: ht,
      flyTarget: '[data-combat="hero"]',
      flyValue: ht,
      flyColor: '#1e3a8a',
      onDone: () => {
        d({ type: "DANGER" })
        setRound(rd)
        const lines: string[] = []
        lines.push(`R${rd}: You [${hr[0]}+${hr[1]}]+${s.skill}${modStr}=${ht} vs ${enemy.name} [${er[0]}+${er[1]}]+${enemy.skill}=${et}`)

        if (heroWon) {
          let dmg = 2
          if (useLuck && s.luck > 0) {
            const lr = r2d6(), lt = lr[0] + lr[1]
            const curLuck = s.luck
            const lucky = lt <= curLuck
            dmg = lucky ? 4 : 1
            const ns = Math.max(0, enemy.stamina - dmg)
            // Show luck dice, defer state to luck onDone
            showDice(lr.map(v => ({ value: v })), {
              title: "Test Your Luck",
              label: `Damage Luck: ${lt} vs Luck ${curLuck}`,
              comparison: {
                text: `${lt} vs ${curLuck}`,
                success: lucky,
                successLabel: "Lucky! 4 damage!",
                failLabel: "Unlucky! 1 damage!",
              },
              onDone: () => {
                d({ type: "SET_LCK", v: curLuck - 1 })
                setEnemy({ ...enemy, stamina: ns })
                lines.push(`Luck: [${lr[0]}+${lr[1]}]=${lt} vs ${curLuck} -- ${lucky ? "Lucky! 4dmg" : "Unlucky! 1dmg"}`)
                lines.push(`Hit ${enemy.name} for ${dmg}! (${enemy.stamina}->${ns})`)
                log(`Hit ${enemy.name} for ${dmg}`, "success")
                if (ns <= 0) { lines.push(`${enemy.name} defeated!`); log(`${enemy.name} defeated!`, "success"); setOver(true) }
                setRlog(p => [...lines, "---", ...p])
              },
            })
            return
          }
          // No luck - apply immediately in this onDone
          const ns = Math.max(0, enemy.stamina - dmg)
          setEnemy({ ...enemy, stamina: ns })
          lines.push(`Hit ${enemy.name} for ${dmg}! (${enemy.stamina}->${ns})`)
          log(`Hit ${enemy.name} for ${dmg}`, "success")
          if (ns <= 0) { lines.push(`${enemy.name} defeated!`); log(`${enemy.name} defeated!`, "success"); setOver(true) }
        } else if (enemyWon) {
          let dmg = 2
          if (useLuck && s.luck > 0) {
            const lr = r2d6(), lt = lr[0] + lr[1]
            const curLuck = s.luck
            const lucky = lt <= curLuck
            dmg = lucky ? 1 : 3
            const newSta = Math.max(0, s.stamina - dmg)
            showDice(lr.map(v => ({ value: v })), {
              title: "Test Your Luck",
              label: `Defense Luck: ${lt} vs Luck ${curLuck}`,
              comparison: {
                text: `${lt} vs ${curLuck}`,
                success: lucky,
                successLabel: "Lucky! Only 1 damage!",
                failLabel: "Unlucky! 3 damage!",
              },
              onDone: () => {
                d({ type: "SET_LCK", v: curLuck - 1 })
                d({ type: "SET_STA", v: newSta })
                lines.push(`Luck: [${lr[0]}+${lr[1]}]=${lt} vs ${curLuck} -- ${lucky ? "Lucky! 1dmg" : "Unlucky! 3dmg"}`)
                lines.push(`${enemy.name} hits for ${dmg}! (${s.stamina}->${newSta})`)
                log(`${enemy.name} hit you for ${dmg}`, "danger")
                if (newSta <= 0) { lines.push("You have fallen..."); log("Defeated!", "danger"); setOver(true) }
                setRlog(p => [...lines, "---", ...p])
              },
            })
            return
          }
          d({ type: "SET_STA", v: s.stamina - dmg })
          lines.push(`${enemy.name} hits for ${dmg}! (${s.stamina}->${Math.max(0, s.stamina - dmg)})`)
          log(`${enemy.name} hit you for ${dmg}`, "danger")
          if (s.stamina - dmg <= 0) { lines.push("You have fallen..."); log("Defeated!", "danger"); setOver(true) }
        } else {
          lines.push("Clash! No damage.")
          log("Tied -- no damage", "info")
        }
        setRlog(p => [...lines, "---", ...p])
      },
    })
  }

  return (
    <div className="flex flex-col gap-5">
      {!enemy || over ? (
        <div className={PNL}>
          <h3 className={cn("mb-4 text-lg font-bold font-[Cinzel] text-amber-800")}>{over ? "Combat Complete" : "Set Up Combat"}</h3>
          {over && enemy && <p className={cn("mb-4 text-sm font-[Crimson_Text]", FADED)}>{enemy.stamina <= 0 ? `Victory! ${enemy.name} slain in ${round} rounds.` : "Combat ended."}</p>}
          <div className="flex flex-col gap-3">
            <div><label className={cn("mb-1 block text-xs font-[Cinzel]", FADED)}>Enemy Name</label><Input value={en} onChange={e => setEn(e.target.value)} className="bg-white/40 border-stone-600 text-stone-900 font-[Crimson_Text]" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className={cn("mb-1 block text-xs font-[Cinzel]", FADED)}>Skill</label><Input type="number" value={esk} onChange={e => setEsk(e.target.value)} className="bg-white/40 border-stone-600 text-stone-900 font-[MedievalSharp]" /></div>
              <div><label className={cn("mb-1 block text-xs font-[Cinzel]", FADED)}>Stamina</label><Input type="number" value={est} onChange={e => setEst(e.target.value)} className="bg-white/40 border-stone-600 text-stone-900 font-[MedievalSharp]" /></div>
            </div>
            <div className="flex gap-2">
              <Button className={cn(BTN, "flex-1")} onClick={() => startNext()}>Fight Now</Button>
              <Button variant="outline" className="bg-transparent border-stone-600 text-stone-700 font-[MedievalSharp]" onClick={addToQueue}>Add to Queue</Button>
            </div>
            {over && enemy && (
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1 bg-transparent border-stone-600 font-[MedievalSharp] text-stone-700" onClick={() => { setEnemy({ ...enemy, stamina: enemy.maxStamina }); setRlog([]); setOver(false); setRound(0); log(`Rematch: ${enemy.name}!`, "warning") }}>Fight Same Again</Button>
                {queue.length > 0 && <Button className={cn(BTN, "flex-1")} onClick={loadNextFromQueue}>Next: {queue[0].name}</Button>}
              </div>
            )}
          </div>
          {queue.length > 0 && (
            <div className="mt-4 pt-4 border-t border-stone-600">
              <h4 className={cn("text-xs font-semibold uppercase tracking-wider mb-2 font-[Cinzel]", FADED)}>Enemy Queue ({queue.length})</h4>
              <ul className="flex flex-col gap-1">{queue.map((e, i) => (
                <li key={`${i}-${e.name}`} className="flex items-center justify-between rounded-sm bg-white/30 border border-stone-400 px-3 py-1.5 text-sm font-[Crimson_Text] text-stone-800">
                  <span>{e.name} <span className="text-stone-500 text-xs">(Sk{e.skill} St{e.stamina})</span></span>
                  <button type="button" className="text-xs text-red-800 font-[MedievalSharp]" onClick={() => setQueue(q => q.filter((_, j) => j !== i))}>remove</button>
                </li>
              ))}</ul>
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div key={`enemy-${enemy.stamina}`} className="rounded-sm border-2 border-red-800 bg-red-50/60 p-4 combat-hit-red">
            <div className="flex items-center justify-between mb-2"><h3 data-combat="enemy" className="font-bold text-red-900 font-[Cinzel]">{enemy.name}</h3><span className={cn("text-xs font-[Crimson_Text]", FADED)}>Skill {enemy.skill} | Round {round}{queue.length > 0 ? ` | ${queue.length} queued` : ""}</span></div>
            <div className="h-3 w-full overflow-hidden rounded-full bg-stone-300"><div className="h-full rounded-full bg-red-700 transition-all duration-500 ease-out" style={{ width: `${(enemy.stamina / enemy.maxStamina) * 100}%` }} /></div>
            <p className={cn("mt-1 text-xs font-[Crimson_Text]", FADED)}>Stamina: {enemy.stamina}/{enemy.maxStamina}</p>
          </div>
          <div key={`hero-${s.stamina}`} className="rounded-sm border-2 border-blue-800 bg-blue-50/60 p-4 combat-hit-blue">
            <div className="flex items-center justify-between mb-2"><h3 data-combat="hero" className="font-bold text-blue-900 font-[Cinzel]">You</h3><span className={cn("text-xs font-[Crimson_Text]", FADED)}>Skill {s.skill}{s.atkMod !== 0 ? ` (${s.atkMod >= 0 ? "+" : ""}${s.atkMod})` : ""} | Luck {s.luck}</span></div>
            <div className="h-3 w-full overflow-hidden rounded-full bg-stone-300"><div className="h-full rounded-full bg-blue-700 transition-all duration-500 ease-out" style={{ width: `${(s.stamina / s.mStamina) * 100}%` }} /></div>
            <p className={cn("mt-1 text-xs font-[Crimson_Text]", FADED)}>Stamina: {s.stamina}/{s.mStamina}</p>
          </div>
          <div className="flex gap-3">
            <Button className={cn(BTN, "flex-1")} onClick={() => fight(false)}>Attack</Button>
            <Button variant="outline" className="flex-1 border-emerald-700 text-emerald-900 font-[MedievalSharp] hover:bg-emerald-100 bg-transparent" onClick={() => fight(true)} disabled={s.luck <= 0}>Attack+Luck</Button>
            <Button variant="outline" className="border-red-800 text-red-800 font-[MedievalSharp] hover:bg-red-100 bg-transparent" onClick={() => { d({ type: "SET_STA", v: s.stamina - 2 }); log(`Escaped! -2 Sta (${s.stamina}->${Math.max(0, s.stamina - 2)}). Round ${round}.`, "warning"); setOver(true) }}>Escape</Button>
          </div>
          {rlog.length > 0 && <div className="max-h-48 overflow-y-auto rounded-sm border border-stone-600 bg-white/30 p-3 text-xs font-mono font-[Crimson_Text] text-stone-700">{rlog.map((l, i) => <p key={`${i}-${l.slice(0, 8)}`} className={l === "---" ? "my-1 border-t border-stone-400" : ""}>{l !== "---" ? l : null}</p>)}</div>}
        </div>
      )}
    </div>
  )
}

/* ── Dice Roller ── */
function Roller({ log, showDice }: { log: (t: string, ty: Log["type"]) => void; showDice: ShowDiceFn }) {
  const [res, setRes] = useState<number[] | null>(null)
  function roll(n: number) {
    const dice = Array.from({ length: n }, () => r1d6())
    showDice(dice.map(v => ({ value: v })))
    setRes(dice)
    const total = dice.reduce((a, b) => a + b, 0)
    log(`Rolled ${n}d6: [${dice.join("+")}] = ${total}`, "info")
  }
  return (
    <div className={PNL}>
      <h3 className={cn("mb-4 text-lg font-bold font-[Cinzel] uppercase tracking-wider", INK)}>Dice Roller</h3>
      <div className="flex gap-3 mb-4">
        {[1, 2, 3].map(n => <Button key={n} className={cn(BTN, "flex-1")} onClick={() => roll(n)}>{n}d6</Button>)}
      </div>
      {res && (
        <div className="text-center ink-stamp">
          <span className="text-4xl font-bold font-[MedievalSharp] text-stone-900">{res.reduce((a, b) => a + b, 0)}</span>
          {res.length > 1 && <p className={cn("text-sm font-[Crimson_Text]", FADED)}>[{res.join(" + ")}]</p>}
        </div>
      )}
    </div>
  )
}

/* ── Tests ── */
function Tests({ s, d, showDice }: { s: GS; d: React.Dispatch<GA>; showDice: ShowDiceFn }) {
  const [res, setRes] = useState<string | null>(null)
  const log = useCallback((t: string, ty: Log["type"]) => d({ type: "LOG", text: t, lt: ty }), [d])

  function testLuck() {
    const dice = r2d6()
    const total = dice[0] + dice[1], pass = total <= s.luck
    showDice(dice.map(v => ({ value: v })), {
      title: "Test Your Luck",
      label: `Roll 2d6 vs Luck ${s.luck}`,
      comparison: { text: `${total} vs ${s.luck}`, success: pass, successLabel: "Lucky!", failLabel: "Unlucky!" },
    })
    d({ type: "SET_LCK", v: s.luck - 1 })
    const msg = `Test Your Luck: [${dice[0]}+${dice[1]}]=${total} vs ${s.luck} -- ${pass ? "LUCKY!" : "UNLUCKY!"}`
    setRes(msg); log(msg, pass ? "success" : "danger")
  }
  function testSkill() {
    const dice = r2d6()
    const total = dice[0] + dice[1], pass = total <= s.skill
    showDice(dice.map(v => ({ value: v })), {
      title: "Test Your Skill",
      label: `Roll 2d6 vs Skill ${s.skill}`,
      comparison: { text: `${total} vs ${s.skill}`, success: pass, successLabel: "Passed!", failLabel: "Failed!" },
    })
    const msg = `Test Your Skill: [${dice[0]}+${dice[1]}]=${total} vs ${s.skill} -- ${pass ? "PASSED!" : "FAILED!"}`
    setRes(msg); log(msg, pass ? "success" : "danger")
  }

  return (
    <div className={PNL}>
      <h3 className={cn("mb-4 text-lg font-bold font-[Cinzel] uppercase tracking-wider", INK)}>Tests</h3>
      <div className="flex gap-3 mb-4">
        <Button className={cn(BTN, "flex-1")} onClick={testLuck} disabled={s.luck <= 0}>Test Luck ({s.luck})</Button>
        <Button className={cn(BTN, "flex-1")} onClick={testSkill}>Test Skill ({s.skill})</Button>
      </div>
      {res && <p className={cn("text-sm font-[Crimson_Text] text-center ink-stamp", res.includes("LUCKY") || res.includes("PASSED") ? "text-emerald-800" : "text-red-800")}>{res}</p>}
    </div>
  )
}

/* ── Map ── */
function MapView({ s, d }: { s: GS; d: React.Dispatch<GA> }) {
  const log = useCallback((t: string, ty: Log["type"]) => d({ type: "LOG", text: t, lt: ty }), [d])
  const dirs = [{ dx: 0, dy: -1, l: "N" }, { dx: 0, dy: 1, l: "S" }, { dx: -1, dy: 0, l: "W" }, { dx: 1, dy: 0, l: "E" }]
  const allR = Object.values(s.rooms)
  const xs = allR.map(r => r.x), ys = allR.map(r => r.y)
  const minX = Math.min(...xs) - 1, maxX = Math.max(...xs) + 1, minY = Math.min(...ys) - 1, maxY = Math.max(...ys) + 1
  const cols = maxX - minX + 1

  return (
    <div className="flex flex-col gap-5">
      <div className={PNL}>
        <h3 className={cn("mb-3 text-lg font-bold font-[Cinzel] uppercase tracking-wider", INK)}>Dungeon Map</h3>
        <p className={cn("text-xs font-[Crimson_Text] mb-3", FADED)}>Position: ({s.pos.x}, {s.pos.y}) | Rooms: {allR.length}</p>
        <div className="flex gap-2 mb-4 justify-center flex-wrap">
          {dirs.map(({ dx, dy, l }) => (
            <Button key={l} className={BTN} onClick={() => { d({ type: "MOVE", dx, dy }); log(`Moved ${l} to (${s.pos.x + dx},${s.pos.y + dy})`, "info") }}>{l}</Button>
          ))}
          <Button variant="outline" className="bg-transparent border-stone-600 text-stone-700 font-[MedievalSharp]" onClick={() => { d({ type: "SAFE" }); log("Marked safe", "success") }}>Safe</Button>
          <Button variant="outline" className="bg-transparent border-red-700 text-red-800 font-[MedievalSharp]" onClick={() => { d({ type: "DANGER" }); log("Marked danger!", "danger") }}>Danger</Button>
        </div>
        <div className="grid gap-1 mx-auto overflow-auto max-h-64" style={{ gridTemplateColumns: `repeat(${cols}, 2rem)` }}>
          {Array.from({ length: (maxY - minY + 1) * cols }, (_, idx) => {
            const gx = minX + (idx % cols), gy = minY + Math.floor(idx / cols)
            const k = `${gx},${gy}`, room = s.rooms[k], isCur = gx === s.pos.x && gy === s.pos.y
            return (
              <div key={k} className={cn(
                "w-8 h-8 rounded-sm border text-[10px] flex items-center justify-center font-[MedievalSharp]",
                isCur ? "border-amber-700 ring-2 ring-amber-600 bg-stone-800 text-[#eaddcf] font-bold" :
                room?.status === "danger" ? "border-red-700 bg-red-200 text-red-800" :
                room ? "border-stone-500 bg-[#cbbea8] text-stone-700" :
                "border-transparent"
              )}>
                {isCur ? "@" : room ? (room.status === "danger" ? "!" : ".") : ""}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

/* ── Activity Log ── */
function ActivityLog({ log }: { log: Log[] }) {
  if (log.length === 0) return null
  const clr: Record<Log["type"], string> = { info: "text-stone-700", success: "text-emerald-800", danger: "text-red-800", warning: "text-amber-800" }
  return (
    <div className={cn(PNL, "max-h-56 overflow-y-auto")}>
      <h3 className={cn("mb-3 text-sm font-bold font-[Cinzel] uppercase tracking-wider", FADED)}>Adventure Log</h3>
      {log.map((l, i) => {
        const rot = `${((l.id * 7 + 3) % 15 - 7) * 0.2}deg`
        const delay = i < 5 ? `${i * 40}ms` : undefined
        return <p key={l.id} className={cn("text-xs font-[Crimson_Text] leading-relaxed log-entry", clr[l.type])} style={{ "--rot": rot, animationDelay: delay } as React.CSSProperties}>{l.text}</p>
      })}
    </div>
  )
}

/* ── Flying Number ── */
interface FlyingNum { id: number; value: string | number; fromX: number; fromY: number; toX: number; toY: number; color: string }

function FlyingNumber({ num, onDone }: { num: FlyingNum; onDone: () => void }) {
  const [arrived, setArrived] = useState(false)
  const doneRef = useRef(onDone)
  doneRef.current = onDone
  useEffect(() => {
    requestAnimationFrame(() => requestAnimationFrame(() => setArrived(true)))
    const t = setTimeout(() => doneRef.current(), 650)
    return () => clearTimeout(t)
  }, [])
  return (
    <div className="flying-number" style={{
      position: 'fixed', zIndex: 9999, pointerEvents: 'none',
      left: arrived ? num.toX : num.fromX,
      top: arrived ? num.toY : num.fromY,
      transform: 'translate(-50%, -50%)',
      transition: arrived
        ? 'left 500ms cubic-bezier(0.34,1.56,0.64,1), top 500ms cubic-bezier(0.34,1.56,0.64,1), font-size 500ms cubic-bezier(0.34,1.56,0.64,1), color 500ms ease-out, text-shadow 500ms ease-out, opacity 150ms ease-out 400ms'
        : 'none',
      fontSize: arrived ? 18 : 48,
      fontFamily: 'MedievalSharp, cursive',
      fontWeight: 'bold',
      color: arrived ? num.color : '#ffd666',
      textShadow: arrived
        ? '0 1px 3px rgba(0,0,0,.4)'
        : '0 0 30px rgba(255,180,40,.6), 0 2px 8px rgba(0,0,0,.9)',
      opacity: arrived ? 0 : 1,
    }}>{num.value}</div>
  )
}

/* ── Saves ── */
function Saves({ s, d, onLoad }: { s: GS; d: React.Dispatch<GA>; onLoad: (state: GS) => void }) {
  const [saves, setSaves] = useState<SaveSlot[]>([])
  const [name, setName] = useState("")
  const [loaded, setLoaded] = useState(false)

  useEffect(() => { setSaves(loadSaves()); setLoaded(true) }, [s])

  function save() {
    const label = name.trim() || `${new Date().toLocaleDateString()} adventurer`
    const slot: SaveSlot = { name: label, date: new Date().toISOString(), state: { ...s } }
    const fresh = loadSaves().filter(sl => sl.name !== label)
    const updated = [slot, ...fresh].slice(0, 20)
    setSaves(updated); writeSaves(updated); setName("")
    d({ type: "LOG", text: `Run saved: "${label}"`, lt: "success" })
  }

  function load(slot: SaveSlot) { onLoad(slot.state); d({ type: "LOG", text: `Loaded: "${slot.name}"`, lt: "info" }) }
  function del(idx: number) { const u = saves.filter((_, i) => i !== idx); setSaves(u); writeSaves(u) }

  if (!loaded) return null

  return (
    <div className="flex flex-col gap-5">
      {s.created && <div className={PNL}><h3 className={cn("mb-3 text-lg font-bold font-[Cinzel]", INK)}>Current Run</h3><RunSummary gs={s} /></div>}
      <div className={PNL}>
        <h3 className={cn("mb-4 text-lg font-bold font-[Cinzel]", INK)}>Save Run</h3>
        <div className="flex gap-2 mb-2">
          <Input placeholder="Name this run..." value={name} onChange={e => setName(e.target.value)} className="bg-white/40 border-stone-600 text-stone-900 placeholder:text-stone-400 font-[Crimson_Text] flex-1" onKeyDown={e => { if (e.key === "Enter") save() }} />
          <Button className={BTN} onClick={save} disabled={!s.created}>Save</Button>
        </div>
        <p className={cn("text-xs italic font-[Crimson_Text]", FADED)}>Auto-saves after every action. Manual saves let you name checkpoints.</p>
      </div>
      <div className={PNL}>
        <h3 className={cn("mb-4 text-lg font-bold font-[Cinzel]", INK)}>Saved Runs</h3>
        {saves.length === 0 ? <p className={cn("text-sm italic font-[Crimson_Text]", FADED)}>No saved runs yet.</p> : (
          <ul className="flex flex-col gap-3">{saves.map((slot, i) => {
            const isAuto = slot.name === "Latest Autosave"
            return (
              <li key={`${i}-${slot.date}`} className={cn("rounded-sm border px-3 py-3", isAuto ? "border-amber-700/60 bg-amber-50/40" : "border-stone-600 bg-white/30")}>
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div><span className={cn("text-sm font-semibold font-[Cinzel]", INK)}>{slot.name}</span><br /><span className={cn("text-[11px] font-[Crimson_Text]", FADED)}>{new Date(slot.date).toLocaleString()}</span></div>
                  <div className="flex gap-1.5 shrink-0">
                    <button type="button" className="rounded-sm border border-stone-600 bg-stone-800 px-3 py-1 text-xs text-[#eaddcf] font-[MedievalSharp] hover:bg-emerald-900 transition-colors" onClick={() => load(slot)}>Load</button>
                    {!isAuto && <button type="button" className="rounded-sm border border-stone-600 bg-white/40 px-2 py-1 text-xs text-red-900 font-[MedievalSharp] hover:bg-red-900 hover:text-white transition-colors" onClick={() => del(i)}>Del</button>}
                  </div>
                </div>
                <RunSummary gs={slot.state} />
              </li>
            )
          })}</ul>
        )}
      </div>
    </div>
  )
}

/* ── Tab Icons ── */
function TabIcon({ icon, active }: { icon: string; active: boolean }) {
  const c = active ? "#eaddcf" : "#78716c"
  const paths: Record<string, string> = {
    explore: "M12 2L2 12h3v8h6v-6h2v6h6v-8h3L12 2z",
    encounter: "M14.1 4.1L12 2 9.9 4.1 4.1 9.9 2 12l2.1 2.1 5.8 5.8L12 22l2.1-2.1 5.8-5.8L22 12l-2.1-2.1-5.8-5.8zM12 15l-3-3 3-3 3 3-3 3z",
    equipment: "M20 7h-4V4c0-1.1-.9-2-2-2h-4c-1.1 0-2 .9-2 2v3H4c-1.1 0-2 .9-2 2v11c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V9c0-1.1-.9-2-2-2zM10 4h4v3h-4V4z",
  }
  return <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill={c} className="w-6 h-6"><path d={paths[icon]} /></svg>
}

/* ══════════════════════════════════════════════════ */
/*                     MAIN PAGE                     */
/* ══════════════════════════════════════════════════ */
type Tab = "explore" | "encounter" | "equipment"

export default function Page() {
  const [s, d] = useReducer(reducer, init, (initial) => {
    if (typeof window === "undefined") return initial
    const saved = loadCur()
    return saved && typeof saved.created === "boolean" ? saved : initial
  })
  const [tab, setTab] = useState<Tab>("explore")
  const [tabKey, setTabKey] = useState(0)
  const addLog = useCallback((t: string, ty: Log["type"]) => d({ type: "LOG", text: t, lt: ty }), [])
  const [diceModal, setDiceModal] = useState<{ results: DieSpec[] } & DiceOpts | null>(null)
  const [diceKey, setDiceKey] = useState(0)
  const [diceExiting, setDiceExiting] = useState(false)
  const [showCreation, setShowCreation] = useState(!s.created)
  const [creationFading, setCreationFading] = useState(false)
  const [flyingNums, setFlyingNums] = useState<FlyingNum[]>([])
  const flyIdRef = useRef(0)
  const diceWrapperRef = useRef<HTMLDivElement>(null)

  const spawnFly = useCallback((value: string | number, fromX: number, fromY: number, toSelector: string, color: string) => {
    const el = document.querySelector(toSelector)
    if (!el) return
    const r = el.getBoundingClientRect()
    const id = ++flyIdRef.current
    setFlyingNums(prev => [...prev, { id, value, fromX, fromY, toX: r.left + r.width / 2, toY: r.top + r.height / 2, color }])
  }, [])

  const showDice: ShowDiceFn = useCallback((results, opts) => {
    setDiceKey(k => k + 1)
    setDiceModal({ results, ...opts })
  }, [])

  // Auto-save
  useEffect(() => {
    try {
      localStorage.setItem(LS_CUR, JSON.stringify(s))
      if (s.created) {
        const saves = loadSaves()
        const auto: SaveSlot = { name: "Latest Autosave", date: new Date().toISOString(), state: { ...s } }
        const rest = saves.filter(sl => sl.name !== "Latest Autosave")
        writeSaves([auto, ...rest].slice(0, 20))
      }
    } catch {}
  }, [s])

  const tabs: { key: Tab; label: string; icon: string }[] = [
    { key: "explore", label: "Explore", icon: "explore" },
    { key: "encounter", label: "Encounter", icon: "encounter" },
    { key: "equipment", label: "Equipment", icon: "equipment" },
  ]

  return (
    <>
      {/* Google Fonts */}
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@400;700;900&family=Crimson+Text:ital,wght@0,400;0,600;1,400&family=MedievalSharp&display=swap" rel="stylesheet" />

      <style>{`
        @keyframes flicker { 0%,100%{opacity:.78} 25%{opacity:.82} 50%{opacity:.75} 75%{opacity:.85} }
        @keyframes inkStamp { 0%{transform:scale(1.4) rotate(var(--rot,0deg));opacity:0;filter:blur(2px)} 100%{transform:scale(1) rotate(var(--rot,0deg));opacity:1;filter:blur(0)} }
        .ink-stamp{animation:inkStamp .25s ease-out forwards}
        .log-entry{transform:rotate(var(--rot,0deg));animation:inkStamp .2s ease-out}
        .vignette{background:radial-gradient(circle at 50% 50%,transparent 35%,rgba(0,0,0,.85) 100%);animation:flicker 4s ease-in-out infinite}
        @keyframes diceOut{to{opacity:0;transform:scale(1.02)}}
        .animate-dice-out{animation:diceOut .25s ease-in forwards;pointer-events:none}
        @keyframes tabIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
        .animate-tab-in{animation:tabIn .2s ease-out}
        @keyframes creationOut{to{opacity:0;transform:translateY(-20px) scale(0.95);filter:blur(2px)}}
        .animate-creation-out{animation:creationOut .4s ease-in forwards}
        @keyframes gameIn{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
        .animate-game-in{animation:gameIn .5s ease-out .1s both}
        @keyframes fadeIn{from{opacity:0}to{opacity:1}}
        .animate-fade-in{animation:fadeIn .4s ease-out}
        @keyframes statPop{0%{transform:scale(1.3);color:#fbbf24}100%{transform:scale(1)}}
        .stat-pop{animation:statPop .3s ease-out}
        @keyframes panelIn{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
        .panel-in{animation:panelIn .3s ease-out both}
        @keyframes combatHitRed{0%{box-shadow:0 0 20px rgba(248,113,113,.6),inset 0 0 10px rgba(248,113,113,.15)}100%{box-shadow:none}}
        .combat-hit-red{animation:combatHitRed .6s ease-out}
        @keyframes combatHitBlue{0%{box-shadow:0 0 20px rgba(96,165,250,.6),inset 0 0 10px rgba(96,165,250,.15)}100%{box-shadow:none}}
        .combat-hit-blue{animation:combatHitBlue .6s ease-out}
        .flying-number{will-change:transform,left,top,opacity}
      `}</style>

      <div className="min-h-screen bg-stone-950 text-stone-900 relative flex flex-col">
        <div className="fixed inset-0 pointer-events-none z-[200] vignette" />

        {/* Header */}
        <header className={cn("border-b-4 border-double border-stone-700 bg-stone-900 px-4 py-4 relative z-10 shrink-0 transition-[filter] duration-300", diceModal && "blur-[2px] brightness-90")}>
          <div className="mx-auto flex max-w-2xl items-center justify-between">
            <div>
              <h1 className="text-xl font-bold tracking-wider text-[#eaddcf] font-[Cinzel] uppercase">Fighting Fantasy</h1>
              <p className="text-[10px] text-stone-500 tracking-widest font-[Cinzel] uppercase">Gamebook Companion</p>
            </div>
            {s.created && (
              <StatPills animated items={[
                ["SKL", s.skill, "text-stone-300"], ["STA", s.stamina, "text-red-300"],
                ["LCK", s.luck, "text-emerald-300"], ["PRV", s.provisions, "text-amber-300"],
                ["GLD", s.gold, "text-yellow-200"],
              ]} />
            )}
          </div>
        </header>

        {/* Main Content */}
        <main className={cn("flex-1 overflow-y-auto relative z-10 pb-20 transition-[filter] duration-300", diceModal && "blur-[2px] brightness-90")}>
          <div className="mx-auto max-w-2xl px-4 py-6">
            {showCreation ? (
              <div className={cn("py-8", creationFading && "animate-creation-out")}><Creation onCreate={(sk, st, l) => {
                const cardPositions = (['skill', 'stamina', 'luck'] as const).map(stat => {
                  const el = document.querySelector(`[data-stat="creation-${stat}"]`)
                  return el?.getBoundingClientRect()
                })
                setCreationFading(true)
                setTimeout(() => {
                  d({ type: "CREATE", skill: sk, stamina: st, luck: l })
                  setShowCreation(false)
                  setCreationFading(false)
                  requestAnimationFrame(() => requestAnimationFrame(() => {
                    const targets: { value: number; target: string; color: string }[] = [
                      { value: sk, target: '[data-stat="header-SKL"]', color: '#cbd5e1' },
                      { value: st, target: '[data-stat="header-STA"]', color: '#fca5a5' },
                      { value: l, target: '[data-stat="header-LCK"]', color: '#6ee7b7' },
                    ]
                    targets.forEach(({ value, target, color }, i) => {
                      const from = cardPositions[i]
                      if (!from) return
                      setTimeout(() => spawnFly(value, from.left + from.width / 2, from.top + from.height / 2, target, color), i * 100)
                    })
                  }))
                }, 400)
              }} log={addLog} showDice={showDice} /></div>
            ) : s.created ? (
              <div key={tabKey} className="flex flex-col gap-6 animate-tab-in animate-game-in">
                {tab === "explore" && (<><div className="panel-in" style={{ animationDelay: "0ms" }}><MapView s={s} d={d} /></div><div className="panel-in" style={{ animationDelay: "80ms" }}><ActivityLog log={s.log} /></div></>)}
                {tab === "encounter" && (<><div className="panel-in" style={{ animationDelay: "0ms" }}><Combat s={s} d={d} showDice={showDice} /></div><div className="panel-in" style={{ animationDelay: "80ms" }}><Tests s={s} d={d} showDice={showDice} /></div><div className="panel-in" style={{ animationDelay: "160ms" }}><Roller log={addLog} showDice={showDice} /></div><div className="panel-in" style={{ animationDelay: "240ms" }}><ActivityLog log={s.log} /></div></>)}
                {tab === "equipment" && (<><div className="panel-in" style={{ animationDelay: "0ms" }}><Sheet s={s} d={d} /></div><div className="panel-in" style={{ animationDelay: "80ms" }}><Saves s={s} d={d} onLoad={(state) => d({ type: "LOAD_STATE", state })} /></div></>)}
              </div>
            ) : null}
          </div>
        </main>

        {/* Bottom Tab Bar */}
        {s.created && !showCreation && (
          <nav className="fixed bottom-0 left-0 right-0 z-40 border-t-4 border-double border-stone-700 bg-stone-900 animate-fade-in" aria-label="Game sections">
            <div className="mx-auto max-w-2xl flex">
              {tabs.map(t => (
                <button key={t.key} type="button" onClick={() => { setTab(t.key); setTabKey(k => k + 1) }}
                  className={cn("flex-1 flex flex-col items-center gap-1 py-3 transition-colors", tab === t.key ? "bg-stone-800 text-[#eaddcf]" : "text-stone-500 hover:text-stone-300 hover:bg-stone-800/50")}>
                  <TabIcon icon={t.icon} active={tab === t.key} />
                  <span className={cn("text-[11px] font-[MedievalSharp] tracking-wide", tab === t.key ? "text-amber-400" : "text-stone-500")}>{t.label}</span>
                </button>
              ))}
            </div>
            <div className="h-[env(safe-area-inset-bottom)] bg-stone-900" />
          </nav>
        )}

        {/* Footer (pre-creation only) */}
        {showCreation && (
          <footer className="border-t-4 border-double border-stone-700 bg-stone-900 px-4 py-3 relative z-10 shrink-0">
            <p className="text-center text-xs text-stone-600 font-[Crimson_Text] italic">Based on the Fighting Fantasy game system by Steve Jackson and Ian Livingstone</p>
          </footer>
        )}
      </div>

      {/* 3D Dice Modal */}
      {diceModal && (
        <Suspense fallback={<div className="fixed inset-0 z-[100] bg-black/80 flex items-center justify-center"><span className="text-amber-400 font-[Cinzel] text-lg animate-pulse">Loading dice...</span></div>}>
          <div ref={diceWrapperRef} className={diceExiting ? "animate-dice-out" : ""}>
            <DungeonDice key={diceKey} targetResults={diceModal.results} label={diceModal.label} title={diceModal.title} comparison={diceModal.comparison} displayTotal={diceModal.displayTotal} onComplete={() => {
              const cb = diceModal.onDone
              if (diceModal.flyTarget && diceModal.flyValue != null) {
                let fromX = window.innerWidth / 2, fromY = window.innerHeight * 0.55
                const wrapper = diceWrapperRef.current
                if (wrapper) {
                  const divs = wrapper.querySelectorAll('div')
                  for (const el of divs) {
                    const fs = parseFloat(getComputedStyle(el).fontSize)
                    if (fs > 40) {
                      const rect = el.getBoundingClientRect()
                      fromX = rect.left + rect.width / 2
                      fromY = rect.top + rect.height / 2
                      break
                    }
                  }
                }
                spawnFly(diceModal.flyValue, fromX, fromY, diceModal.flyTarget, diceModal.flyColor || '#ffd666')
              }
              setDiceExiting(true)
              setTimeout(() => {
                setDiceExiting(false)
                setDiceModal(null)
                if (cb) queueMicrotask(cb)
              }, 250)
            }} />
          </div>
        </Suspense>
      )}

      {/* Flying Numbers */}
      {flyingNums.map(f => (
        <FlyingNumber key={f.id} num={f} onDone={() => setFlyingNums(p => p.filter(n => n.id !== f.id))} />
      ))}
    </>
  )
}
