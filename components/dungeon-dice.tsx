"use client"
import { useEffect, useRef, useCallback } from "react"
import { useState } from "react"

import * as THREE from "three"

/* ── Props ── */
export interface DieSpec {
  value: number        // face value 1-6
  tint?: string        // hex color for dice body (default: "#fffbf0", enemy: "#3b1010")
}
interface Comparison {
  text: string          // e.g. "7 vs Luck 9"
  success: boolean
  successLabel: string  // e.g. "LUCKY!"
  failLabel: string     // e.g. "UNLUCKY!"
}
interface Props {
  targetResults: DieSpec[]
  label?: string
  title?: string
  comparison?: Comparison
  displayTotal?: number
  hideContextCard?: boolean
  onComplete: () => void
}

/* ── GLSL Noise ── */
const NG = `float hash21(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash21(i),hash21(i+vec2(1,0)),f.x),mix(hash21(i+vec2(0,1)),hash21(i+vec2(1,1)),f.x),f.y);}
float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<5;i++){v+=a*noise(p);p*=2.;a*=.5;}return v;}`

/* ── Stone Shader ── */
const SV = `varying vec3 vWP;varying vec3 vN;void main(){vec4 w=modelMatrix*vec4(position,1.);vWP=w.xyz;vN=normalize((modelMatrix*vec4(normal,0.)).xyz);gl_Position=projectionMatrix*viewMatrix*w;}`
const SF = `precision highp float;
uniform vec3 uT1P;uniform float uT1I;uniform vec3 uT2P;uniform float uT2I;
uniform float uTime;uniform vec3 uCam;uniform float uBS;uniform vec3 uTA;uniform vec3 uTB;
varying vec3 vWP;varying vec3 vN;
${NG}
vec3 tL(vec3 tp,float ti,vec3 N,vec3 wp,vec3 bc){vec3 tl=tp-wp;float d=length(tl);vec3 L=tl/d;float a=ti/(1.+.22*d+.2*d*d);float df=max(dot(N,L),0.);vec3 V=normalize(uCam-wp);vec3 H=normalize(L+V);float sp=pow(max(dot(N,H),0.),32.)*.3;vec3 w=vec3(1.,.65,.25);return bc*df*a*w+sp*a*w;}
void main(){vec3 N=normalize(vN);vec2 uv;if(abs(N.y)>.5)uv=vWP.xz;else if(abs(N.x)>.5)uv=vWP.yz;else uv=vWP.xy;uv*=uBS;
vec2 bI=floor(uv);vec2 bF=fract(uv);float ro=mod(bI.y,2.)*.5;vec2 u2=vec2(uv.x+ro,uv.y);bI=floor(u2);bF=fract(u2);
float mW=.04;float m=step(mW,bF.x)*step(bF.x,1.-mW)*step(mW,bF.y)*step(bF.y,1.-mW);
float bn=hash21(bI*17.3);vec3 sc=mix(uTA,uTB,bn);float dt=fbm(uv*8.+bI*3.);sc*=.7+.6*dt;
float cr=smoothstep(.48,.5,abs(noise(uv*15.)-.5))*.3;sc-=cr;vec3 mc=vec3(.06,.05,.04);vec3 s=mix(mc,sc,m);
vec3 am=s*vec3(.04,.03,.06);vec3 l=am;l+=tL(uT1P,uT1I,N,vWP,s);l+=tL(uT2P,uT2I,N,vWP,s);
float fd=length(vWP-uCam);float fg=1.-exp(-fd*.1);l=mix(l,vec3(.01,.005,.02),fg);l=pow(l,vec3(.95));gl_FragColor=vec4(l,1.);}`

/* ── Flame Shader ── */
const FV = `attribute float aLife;attribute float aSize;uniform float uTime;varying float vLife;void main(){vLife=aLife;vec4 mv=modelViewMatrix*vec4(position,1.);gl_PointSize=aSize*(200./length(mv.xyz));gl_Position=projectionMatrix*mv;}`
const FF = `precision highp float;varying float vLife;void main(){float d=length(gl_PointCoord-.5)*2.;float a=smoothstep(1.,0.,d)*vLife;vec3 c=mix(vec3(1.,.2,0.),vec3(1.,.85,.3),vLife);c+=vec3(1.)*smoothstep(.6,0.,d)*vLife*.5;gl_FragColor=vec4(c,a*.7);}`

/* ── Rune Shader ── */
const RV = `varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`
const RF = `precision highp float;uniform float uTime;uniform float uGlow;varying vec2 vUv;
${NG}
void main(){vec2 c=vUv-.5;float r=length(c);float a=atan(c.y,c.x);
float r1=smoothstep(.01,0.,abs(r-.22)-.003);float r2=smoothstep(.01,0.,abs(r-.18)-.002);float r3=smoothstep(.01,0.,abs(r-.35)-.002);
float rn=0.;for(int i=0;i<12;i++){float ra=float(i)*6.28318/12.;float sg=smoothstep(.02,0.,abs(a-ra))*step(.2,r)*step(r,.34);rn+=sg*.5;}
float inner=smoothstep(.15,0.,r)*.3;float p=(r1+r2+r3+rn+inner)*uGlow;
vec3 cl=mix(vec3(.4,.1,.8),vec3(.7,.4,1.),r*2.)*p;cl+=vec3(1.,.8,.5)*inner*uGlow*.5;
float al=p*(.5+.3*sin(uTime*2.));gl_FragColor=vec4(cl,al*.6);}`

/* ── Pip Texture ── */
function pipTex(num: number, bodyColor = "#fffbf0", pipColor = "#1a1412", borderColor = "#c8b890") {
  const s = 256, cv = document.createElement("canvas")
  cv.width = cv.height = s
  const ctx = cv.getContext("2d")!
  ctx.fillStyle = bodyColor; ctx.fillRect(0, 0, s, s)
  ctx.strokeStyle = borderColor; ctx.lineWidth = 6; ctx.strokeRect(8, 8, s - 16, s - 16)
  ctx.fillStyle = pipColor
  const pip = (x: number, y: number) => { ctx.beginPath(); ctx.arc(x * s, y * s, s * .08, 0, Math.PI * 2); ctx.fill() }
  const P: Record<number, number[][]> = {
    1: [[.5,.5]], 2: [[.3,.3],[.7,.7]], 3: [[.3,.3],[.5,.5],[.7,.7]],
    4: [[.3,.3],[.7,.3],[.3,.7],[.7,.7]], 5: [[.3,.3],[.7,.3],[.5,.5],[.3,.7],[.7,.7]],
    6: [[.3,.25],[.7,.25],[.3,.5],[.7,.5],[.3,.75],[.7,.75]]
  }
  P[num].forEach(([x, y]) => pip(x, y))
  const t = new THREE.CanvasTexture(cv); t.minFilter = THREE.LinearFilter; return t
}

/* ── Face Quaternions: which rotation puts face N on top ── */
// BoxGeometry material order: +X(3), -X(4), +Y(1), -Y(6), +Z(2), -Z(5)
const FQ: Record<number, THREE.Quaternion> = {};
([
  [1, new THREE.Euler(0, 0, 0)], [2, new THREE.Euler(-Math.PI / 2, 0, 0)],
  [3, new THREE.Euler(0, 0, Math.PI / 2)], [4, new THREE.Euler(0, 0, -Math.PI / 2)],
  [5, new THREE.Euler(Math.PI / 2, 0, 0)], [6, new THREE.Euler(Math.PI, 0, 0)],
] as [number, THREE.Euler][]).forEach(([n, e]) => { FQ[n] = new THREE.Quaternion().setFromEuler(e) })

/* ── Face Normal Detection ── */
const FN = [
  { f: 3, x: 1, y: 0, z: 0 }, { f: 4, x: -1, y: 0, z: 0 },
  { f: 1, x: 0, y: 1, z: 0 }, { f: 6, x: 0, y: -1, z: 0 },
  { f: 2, x: 0, y: 0, z: 1 }, { f: 5, x: 0, y: 0, z: -1 },
]

function rotQ(vx: number, vy: number, vz: number, qx: number, qy: number, qz: number, qw: number) {
  const ix = qw * vx + qy * vz - qz * vy, iy = qw * vy + qz * vx - qx * vz
  const iz = qw * vz + qx * vy - qy * vx, iw = -qx * vx - qy * vy - qz * vz
  return {
    x: ix * qw + iw * (-qx) + iy * (-qz) - iz * (-qy),
    y: iy * qw + iw * (-qy) + iz * (-qx) - ix * (-qz),
    z: iz * qw + iw * (-qz) + ix * (-qy) - iy * (-qx),
  }
}

/* ── Physics Constants ── */
const GRAV = -9.81, REST = 0.35, FRIC = 0.55
const LDAMP = 0.93, ADAMP = 0.85, SLERP_SPD = 3.5, MAX_T = 7.0
const MIN_BV = 0.35, MICRO = 0.015, SLIDE_DR = 9.0, SPIN_DR = 7.0

const CO = [[-1,-1,-1],[-1,-1,1],[-1,1,-1],[-1,1,1],[1,-1,-1],[1,-1,1],[1,1,-1],[1,1,1]].map(
  ([x, y, z]) => new THREE.Vector3(x, y, z)
)

interface Die {
  pos: THREE.Vector3; vel: THREE.Vector3; quat: THREE.Quaternion; angVel: THREE.Vector3
  hs: number; tY: number; tHW: number; tHD: number; settled: boolean
  tgtQ: THREE.Quaternion; sBlend: number; totalT: number; lowE: number
  inC: boolean; target: number
}

function mkDie(hs: number, tY: number, tHW: number, tHD: number, target: number): Die {
  return {
    pos: new THREE.Vector3(), vel: new THREE.Vector3(), quat: new THREE.Quaternion(),
    angVel: new THREE.Vector3(), hs, tY, tHW, tHD, settled: false,
    tgtQ: new THREE.Quaternion(), sBlend: 0, totalT: 0, lowE: 0, inC: false, target
  }
}

function stepDie(d: Die, dt: number) {
  if (d.settled) return
  d.totalT += dt; d.inC = false

  if (d.sBlend > 0) {
    d.sBlend = Math.min(d.sBlend + dt * SLERP_SPD, 1)
    const t = d.sBlend * d.sBlend * (3 - 2 * d.sBlend)
    d.quat.slerp(d.tgtQ, Math.min(t, 1))
    d.vel.multiplyScalar(Math.max(1 - dt * 12, 0))
    d.angVel.multiplyScalar(Math.max(1 - dt * 12, 0))
    d.pos.y += (d.tY + d.hs - d.pos.y) * Math.min(dt * 8, 1)
    if (d.sBlend >= 0.95) {
      d.settled = true; d.quat.copy(d.tgtQ); d.pos.y = d.tY + d.hs
      d.vel.set(0, 0, 0); d.angVel.set(0, 0, 0)
    }
    return
  }

  const sub = 4, sdt = dt / sub
  const ld = Math.pow(LDAMP, sdt), ad = Math.pow(ADAMP, sdt)

  for (let s = 0; s < sub; s++) {
    d.vel.y += GRAV * sdt; d.vel.multiplyScalar(ld); d.angVel.multiplyScalar(ad)
    d.pos.x += d.vel.x * sdt; d.pos.y += d.vel.y * sdt; d.pos.z += d.vel.z * sdt

    const wx = d.angVel.x, wy = d.angVel.y, wz = d.angVel.z
    const qx = d.quat.x, qy = d.quat.y, qz = d.quat.z, qw = d.quat.w
    d.quat.x += (wx * qw + wy * qz - wz * qy) * 0.5 * sdt
    d.quat.y += (-wx * qz + wy * qw + wz * qx) * 0.5 * sdt
    d.quat.z += (wx * qy - wy * qx + wz * qw) * 0.5 * sdt
    d.quat.w += (-wx * qx - wy * qy - wz * qz) * 0.5 * sdt
    d.quat.normalize()

    const flY = d.tY
    let dP = 0, cRx = 0, cRy = 0, cRz = 0, nC = 0
    for (let ci = 0; ci < 8; ci++) {
      const co = CO[ci]
      const r = rotQ(co.x * d.hs, co.y * d.hs, co.z * d.hs, d.quat.x, d.quat.y, d.quat.z, d.quat.w)
      const wY = r.y + d.pos.y, pen = flY - wY
      if (pen > -0.005) nC++
      if (pen > dP) { dP = pen; cRx = r.x; cRy = r.y; cRz = r.z }
    }

    if (dP > 0) {
      d.inC = true; d.pos.y += dP
      const cvx = d.vel.x + (d.angVel.y * cRz - d.angVel.z * cRy)
      const cvy = d.vel.y + (d.angVel.z * cRx - d.angVel.x * cRz)
      const cvz = d.vel.z + (d.angVel.x * cRy - d.angVel.y * cRx)
      const vn = cvy
      const sl = d.hs * 2, invI = 6.0 / (sl * sl)
      const cE = d.vel.length() + d.angVel.length() * 0.3
      const eS = Math.min(cE / 3.0, 1.0)
      const cS = nC >= 3 ? 0.0 : nC === 2 ? 0.15 : 1.0
      const aIS = eS * cS

      if (vn < -MICRO) {
        const absVn = -vn
        const effE = absVn < MIN_BV ? 0.0 : REST * Math.min(1.0, (absVn - MIN_BV) / 2.0)
        const rcNx = -cRz, rcNz = cRx
        const iRcNx = rcNx * invI, iRcNz = rcNz * invI
        const rC = iRcNz * cRx - iRcNx * cRz
        const den = 1.0 + Math.max(rC, 0)
        const jn = -(1 + effE) * vn / den
        d.vel.y += jn
        d.angVel.x += -cRz * jn * invI * aIS * 0.25
        d.angVel.z += cRx * jn * invI * aIS * 0.25
        const vtL = Math.sqrt(cvx * cvx + cvz * cvz)
        if (vtL > 0.02) {
          const tx = cvx / vtL, tz = cvz / vtL
          const mF = FRIC * Math.abs(jn), fJ = Math.min(mF, vtL * 0.8)
          d.vel.x -= tx * fJ * 0.5; d.vel.z -= tz * fJ * 0.5
          const ftx = -fJ * tx, ftz = -fJ * tz
          d.angVel.x += (cRy * ftz) * invI * aIS * 0.2
          d.angVel.y += (cRz * ftx - cRx * ftz) * invI * aIS * 0.2
          d.angVel.z += (-cRy * ftx) * invI * aIS * 0.2
        }
        d.angVel.multiplyScalar(eS > 0.5 ? 0.88 : 0.7)
      } else {
        if (d.vel.y < 0) d.vel.y = 0
        d.angVel.multiplyScalar(nC >= 2 ? 0.85 : 0.92)
      }

      const ss = Math.sqrt(d.vel.x * d.vel.x + d.vel.z * d.vel.z)
      if (ss > MICRO) {
        const dc = Math.min(SLIDE_DR * sdt, ss)
        d.vel.x *= (ss - dc) / ss; d.vel.z *= (ss - dc) / ss
      } else { d.vel.x = 0; d.vel.z = 0 }

      const spn = d.angVel.length()
      if (spn > MICRO) {
        const adc = Math.min(SPIN_DR * sdt, spn)
        d.angVel.multiplyScalar((spn - adc) / spn)
      } else { d.angVel.set(0, 0, 0) }
    }

    if (Math.abs(d.vel.x) < MICRO) d.vel.x = 0
    if (Math.abs(d.vel.z) < MICRO) d.vel.z = 0
    if (d.inC && Math.abs(d.vel.y) < MICRO) d.vel.y = 0
    if (d.angVel.length() < MICRO) d.angVel.set(0, 0, 0)

    const mg = d.hs * 0.7, cX = d.tHW - mg, cZ = d.tHD - mg
    if (d.pos.x < -cX) { d.pos.x = -cX; if (d.vel.x < 0) d.vel.x *= -REST * 0.5 }
    if (d.pos.x > cX) { d.pos.x = cX; if (d.vel.x > 0) d.vel.x *= -REST * 0.5 }
    if (d.pos.z < -cZ) { d.pos.z = -cZ; if (d.vel.z < 0) d.vel.z *= -REST * 0.5 }
    if (d.pos.z > cZ) { d.pos.z = cZ; if (d.vel.z > 0) d.vel.z *= -REST * 0.5 }
  }

  const ls = d.vel.length(), as = d.angVel.length()
  const onT = d.inC || d.pos.y < d.tY + d.hs * 1.3
  if (onT && ls < 0.25 && as < 0.5) d.lowE += dt
  else d.lowE = Math.max(0, d.lowE - dt * 0.5)

  if ((d.lowE > 0.15 || d.totalT > MAX_T) && onT) {
    d.tgtQ.copy(FQ[d.target]); d.sBlend = 0.01
  }
}

function collidePair(a: Die, b: Die) {
  if (a.settled && b.settled) return
  const dx = a.pos.x - b.pos.x, dy = a.pos.y - b.pos.y, dz = a.pos.z - b.pos.z
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz), min = a.hs * 2.2
  if (dist < min && dist > 0.001) {
    const nx = dx / dist, ny = dy / dist, nz = dz / dist, ol = min - dist
    if (!a.settled) { a.pos.x += nx * ol * .5; a.pos.y += ny * ol * .5; a.pos.z += nz * ol * .5 }
    if (!b.settled) { b.pos.x -= nx * ol * .5; b.pos.y -= ny * ol * .5; b.pos.z -= nz * ol * .5 }
    const rvx = a.vel.x - b.vel.x, rvy = a.vel.y - b.vel.y, rvz = a.vel.z - b.vel.z
    const vn = rvx * nx + rvy * ny + rvz * nz
    if (vn < 0) {
      const j = -(1 + REST * .5) * vn * .5
      if (!a.settled) { a.vel.x += j * nx; a.vel.y += j * ny; a.vel.z += j * nz }
      if (!b.settled) { b.vel.x -= j * nx; b.vel.y -= j * ny; b.vel.z -= j * nz }
    }
  }
}

/* ── Flame Particles ── */
function mkFlame(count = 35) {
  const g = new THREE.BufferGeometry()
  const p = new Float32Array(count * 3), l = new Float32Array(count), sz = new Float32Array(count)
  const v: THREE.Vector3[] = []
  for (let i = 0; i < count; i++) {
    p[i * 3] = (Math.random() - .5) * .08; p[i * 3 + 1] = Math.random() * .3; p[i * 3 + 2] = (Math.random() - .5) * .08
    l[i] = Math.random(); sz[i] = 8 + Math.random() * 16
    v.push(new THREE.Vector3((Math.random() - .5) * .3, .5 + Math.random(), (Math.random() - .5) * .3))
  }
  g.setAttribute("position", new THREE.BufferAttribute(p, 3))
  g.setAttribute("aLife", new THREE.BufferAttribute(l, 1))
  g.setAttribute("aSize", new THREE.BufferAttribute(sz, 1))
  const m = new THREE.ShaderMaterial({
    vertexShader: FV, fragmentShader: FF,
    uniforms: { uTime: { value: 0 } },
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  })
  return { pts: new THREE.Points(g, m), v, g, m }
}

function updFlame(f: ReturnType<typeof mkFlame>, dt: number) {
  const p = f.g.attributes.position.array as Float32Array
  const l = f.g.attributes.aLife.array as Float32Array
  for (let i = 0; i < l.length; i++) {
    l[i] -= dt * (1.5 + Math.random() * .5)
    if (l[i] <= 0) {
      l[i] = 1; p[i * 3] = (Math.random() - .5) * .06; p[i * 3 + 1] = 0; p[i * 3 + 2] = (Math.random() - .5) * .06
      f.v[i].set((Math.random() - .5) * .3, .5 + Math.random(), (Math.random() - .5) * .3)
    }
    p[i * 3] += f.v[i].x * dt; p[i * 3 + 1] += f.v[i].y * dt; p[i * 3 + 2] += f.v[i].z * dt
    f.v[i].x += (Math.random() - .5) * dt * 2; f.v[i].z += (Math.random() - .5) * dt * 2
  }
  f.g.attributes.position.needsUpdate = true; f.g.attributes.aLife.needsUpdate = true
}

function disposeMaterial(mat: THREE.Material) {
  const texKeys = [
    "map", "alphaMap", "aoMap", "bumpMap", "displacementMap", "emissiveMap",
    "envMap", "lightMap", "metalnessMap", "normalMap", "roughnessMap", "specularMap",
  ] as const
  const maybeMat = mat as THREE.Material & Record<string, unknown>

  for (const key of texKeys) {
    const texture = maybeMat[key]
    if (texture instanceof THREE.Texture) texture.dispose()
  }

  const uniforms = maybeMat.uniforms
  if (uniforms && typeof uniforms === "object") {
    for (const value of Object.values(uniforms as Record<string, { value?: unknown }>)) {
      if (value?.value instanceof THREE.Texture) value.value.dispose()
    }
  }

  mat.dispose()
}

function disposeSceneGraph(root: THREE.Object3D) {
  const disposedGeometries = new Set<THREE.BufferGeometry>()
  const disposedMaterials = new Set<THREE.Material>()

  root.traverse((obj) => {
    const maybeObj = obj as THREE.Object3D & {
      geometry?: THREE.BufferGeometry
      material?: THREE.Material | THREE.Material[]
    }

    if (maybeObj.geometry && !disposedGeometries.has(maybeObj.geometry)) {
      disposedGeometries.add(maybeObj.geometry)
      maybeObj.geometry.dispose()
    }

    if (maybeObj.material) {
      if (Array.isArray(maybeObj.material)) {
        maybeObj.material.forEach((material) => {
          if (disposedMaterials.has(material)) return
          disposedMaterials.add(material)
          disposeMaterial(material)
        })
      } else if (!disposedMaterials.has(maybeObj.material)) {
        disposedMaterials.add(maybeObj.material)
        disposeMaterial(maybeObj.material)
      }
    }
  })
}

/* ══════════════════════════════════════════ */
/*              MAIN COMPONENT               */
/* ══════════════════════════════════════════ */
export default function DungeonDice({ targetResults, label, title, comparison, displayTotal, hideContextCard, onComplete }: Props) {
  const mountRef = useRef<HTMLDivElement>(null)
  const rollRef = useRef<{ dice: Die[]; elapsed: number; done: boolean } | null>(null)
  const completedRef = useRef(false)
  const completeTimerRef = useRef<number | null>(null)
  const rafRef = useRef<number | null>(null)
  const [settled, setSettled] = useState(false)
  const settledRef = useRef(false)

  const finish = useCallback((delayMs = 1500) => {
    if (completedRef.current) return
    completedRef.current = true

    if (completeTimerRef.current !== null) {
      window.clearTimeout(completeTimerRef.current)
      completeTimerRef.current = null
    }

    if (delayMs <= 0) {
      onComplete()
      return
    }

    completeTimerRef.current = window.setTimeout(() => {
      completeTimerRef.current = null
      onComplete()
    }, delayMs)
  }, [onComplete])

  useEffect(() => {
    const el = mountRef.current; if (!el) return
    const W = el.clientWidth, H = el.clientHeight

    const ren = new THREE.WebGLRenderer({ antialias: true, alpha: false })
    ren.setSize(W, H); ren.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    ren.shadowMap.enabled = true; ren.shadowMap.type = THREE.PCFSoftShadowMap
    ren.toneMapping = THREE.ACESFilmicToneMapping; ren.toneMappingExposure = 1.4
    el.appendChild(ren.domElement)

    const scene = new THREE.Scene(); scene.background = new THREE.Color(0x0a0510)
    const cam = new THREE.PerspectiveCamera(50, W / H, .1, 100)
    cam.position.set(0, 5.5, 5.5); cam.lookAt(0, .8, 0)

    const t1P = new THREE.Vector3(-2.5, 3.5, -2), t2P = new THREE.Vector3(2.5, 3.5, -2)
    const sU = {
      uT1P: { value: t1P }, uT1I: { value: 5.0 }, uT2P: { value: t2P }, uT2I: { value: 4.5 },
      uTime: { value: 0 }, uCam: { value: cam.position },
    }

    const stM = (bs: number, a: string, b: string) => new THREE.ShaderMaterial({
      vertexShader: SV, fragmentShader: SF,
      uniforms: { ...sU, uBS: { value: bs }, uTA: { value: new THREE.Color(a) }, uTB: { value: new THREE.Color(b) } },
    })

    // Floor
    const flG = new THREE.PlaneGeometry(14, 14); flG.rotateX(-Math.PI / 2)
    scene.add(new THREE.Mesh(flG, stM(1, "#2a2420", "#3a3530")))

    // Walls
    const wM = stM(.8, "#1e1a18", "#2e2a26"), wG = new THREE.PlaneGeometry(14, 6)
    const bw = new THREE.Mesh(wG, wM); bw.position.set(0, 3, -7); scene.add(bw)
    const lw = new THREE.Mesh(wG, wM); lw.position.set(-7, 3, 0); lw.rotation.y = Math.PI / 2; scene.add(lw)
    const rw = new THREE.Mesh(wG, wM); rw.position.set(7, 3, 0); rw.rotation.y = -Math.PI / 2; scene.add(rw)

    // Table
    const tW = 3.2, tH = .35, tD = 2.6, tY = .9
    const tbl = new THREE.Mesh(new THREE.BoxGeometry(tW, tH, tD), stM(1.5, "#1a1614", "#282220"))
    tbl.position.y = tY - tH / 2; scene.add(tbl)
    const lgG = new THREE.CylinderGeometry(.12, .15, tY - tH, 8), lgM = stM(2, "#151210", "#201c18");
    ([[-1.3, -1], [1.3, -1], [-1.3, 1], [1.3, 1]] as [number, number][]).forEach(([x, z]) => {
      const lg = new THREE.Mesh(lgG, lgM); lg.position.set(x, (tY - tH) / 2, z); scene.add(lg)
    })

    // Rune
    const ruG = new THREE.PlaneGeometry(2.2, 2.2); ruG.rotateX(-Math.PI / 2)
    const ruM = new THREE.ShaderMaterial({
      vertexShader: RV, fragmentShader: RF,
      uniforms: { uTime: { value: 0 }, uGlow: { value: .5 } },
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    })
    const rune = new THREE.Mesh(ruG, ruM); rune.position.y = tY + .005; scene.add(rune)

    // Lights -- bright torches and fill light so dice faces are fully visible
    const l1 = new THREE.PointLight(0xff9933, 5, 18, 1.2); l1.position.copy(t1P); l1.castShadow = true; scene.add(l1)
    const l2 = new THREE.PointLight(0xffaa44, 4.5, 18, 1.2); l2.position.copy(t2P); l2.castShadow = true; scene.add(l2)
    scene.add(new THREE.AmbientLight(0x352840, .6))
    // Fill light from camera direction so dice tops are well-lit
    const fill = new THREE.DirectionalLight(0xffeedd, 1.2); fill.position.set(0, 6, 5); fill.target.position.set(0, tY, 0); scene.add(fill); scene.add(fill.target)

    // Torches
    ;[t1P, t2P].forEach(pos => {
      const br = new THREE.Mesh(new THREE.BoxGeometry(.15, .12, .15), new THREE.MeshStandardMaterial({ color: 0x333333, metalness: .8, roughness: .4 }))
      br.position.copy(pos).add(new THREE.Vector3(0, -.3, 0)); scene.add(br)
      const hd = new THREE.Mesh(new THREE.CylinderGeometry(.04, .05, .6, 8), new THREE.MeshStandardMaterial({ color: 0x4a3520, roughness: .9 }))
      hd.position.copy(pos).add(new THREE.Vector3(0, -.1, 0)); scene.add(hd)
    })

    // Flames
    const fl1 = mkFlame(); fl1.pts.position.copy(t1P); scene.add(fl1.pts)
    const fl2 = mkFlame(); fl2.pts.position.copy(t2P); scene.add(fl2.pts)

    // Dice meshes
    const MAX_DICE = 6
    const dSz = .55, fOrder = [3, 4, 1, 6, 2, 5]

    // Per-die materials based on tint
    const allDieMats: THREE.MeshStandardMaterial[][] = []
    for (let i = 0; i < MAX_DICE; i++) {
      const spec = targetResults[i]
      const body = spec?.tint ?? "#fffbf0"
      const dark = spec?.tint ? parseInt(spec.tint.slice(1, 3), 16) < 0x80 : false
      const pip = dark ? "#fffbf0" : "#1a1412"
      const border = dark ? "#5a3030" : "#c8b890"
      const mats = fOrder.map(n => new THREE.MeshStandardMaterial({ map: pipTex(n, body, pip, border), roughness: .3, metalness: .05 }))
      allDieMats.push(mats)
    }

    const dGeo = new THREE.BoxGeometry(dSz, dSz, dSz)
    const meshes: THREE.Mesh[] = []
    for (let i = 0; i < MAX_DICE; i++) {
      const m = new THREE.Mesh(dGeo, allDieMats[i]); m.castShadow = true; m.receiveShadow = true
      m.visible = false; m.position.set(0, tY + 3, 0); scene.add(m); meshes.push(m)
    }

    // Dust
    const duC = 80, duG = new THREE.BufferGeometry(), duP = new Float32Array(duC * 3)
    for (let i = 0; i < duC; i++) { duP[i * 3] = (Math.random() - .5) * 10; duP[i * 3 + 1] = Math.random() * 5; duP[i * 3 + 2] = (Math.random() - .5) * 10 }
    duG.setAttribute("position", new THREE.BufferAttribute(duP, 3))
    scene.add(new THREE.Points(duG, new THREE.PointsMaterial({ color: 0xffcc88, size: .02, transparent: true, opacity: .3, blending: THREE.AdditiveBlending, depthWrite: false })))

    // ── Start Roll Immediately ──
    const numD = targetResults.length, hs = dSz / 2, tHW = 1.4, tHD = 1.1
    const spacing = numD <= 4 ? 0.7 : 0.55
    const pDice: Die[] = []
    for (let i = 0; i < numD; i++) {
      meshes[i].visible = true
      const pd = mkDie(hs, tY, tHW, tHD, targetResults[i].value)
      const spX = numD > 1 ? (i - (numD - 1) / 2) * spacing : 0
      pd.pos.set(spX + (Math.random() - .5) * .2, tY + 1.5 + Math.random() * .3 + i * .15, 2 + Math.random() * .3)
      pd.vel.set((Math.random() - .5) * .8 - spX * .3, 2.5 + Math.random() * 1.5, -3 - Math.random() * 1.2)
      const ss = () => Math.random() > .5 ? 1 : -1
      pd.angVel.set((6 + Math.random() * 8) * ss(), (4 + Math.random() * 6) * ss(), (6 + Math.random() * 8) * ss())
      pd.quat.setFromEuler(new THREE.Euler(Math.random() * Math.PI * 2, Math.random() * Math.PI * 2, Math.random() * Math.PI * 2))
      meshes[i].position.copy(pd.pos); meshes[i].quaternion.copy(pd.quat)
      pDice.push(pd)
    }
    for (let i = numD; i < MAX_DICE; i++) meshes[i].visible = false
    rollRef.current = { dice: pDice, elapsed: 0, done: false }

    // ── Animation Loop ──
    let time = 0, lastT = performance.now() / 1000, alive = true
    function animate() {
      if (!alive) return
      const now = performance.now() / 1000, dt = Math.min(now - lastT, .05)
      lastT = now; time += dt

      const f1 = 5.0 * (1 + .12 * Math.sin(time * 7.3) + .08 * Math.sin(time * 13.1) + .04 * Math.sin(time * 23.7))
      const f2 = 4.5 * (1 + .1 * Math.sin(time * 8.1 + 1) + .07 * Math.sin(time * 14.7 + 2))
      sU.uT1I.value = f1; sU.uT2I.value = f2; sU.uTime.value = time
      l1.intensity = f1; l2.intensity = f2; ruM.uniforms.uTime.value = time
      updFlame(fl1, dt); updFlame(fl2, dt); fl1.m.uniforms.uTime.value = time; fl2.m.uniforms.uTime.value = time

      const dp = duG.attributes.position.array as Float32Array
      for (let i = 0; i < duC; i++) { dp[i * 3 + 1] += dt * .05; dp[i * 3] += Math.sin(time * .3 + i) * dt * .01; if (dp[i * 3 + 1] > 5) dp[i * 3 + 1] = 0 }
      duG.attributes.position.needsUpdate = true

      cam.position.x = Math.sin(time * .15) * .12; cam.position.y = 5.5 + Math.sin(time * .2) * .05; cam.lookAt(0, .8, 0)

      const roll = rollRef.current
      if (roll && !roll.done) {
        let allS = true
        for (const pd of roll.dice) { stepDie(pd, dt); if (!pd.settled) allS = false }
        for (let i = 0; i < roll.dice.length; i++) for (let j = i + 1; j < roll.dice.length; j++) collidePair(roll.dice[i], roll.dice[j])
        for (let i = 0; i < roll.dice.length; i++) { meshes[i].position.copy(roll.dice[i].pos); meshes[i].quaternion.copy(roll.dice[i].quat) }
        roll.elapsed += dt
        ruM.uniforms.uGlow.value = .5 + Math.sin(Math.min(roll.elapsed / 4, 1) * Math.PI) * 1.5
        if (allS) {
          roll.done = true; ruM.uniforms.uGlow.value = .8
          if (!settledRef.current) { settledRef.current = true; setSettled(true) }
          finish()
        }
      }

      ren.render(scene, cam)
      rafRef.current = window.requestAnimationFrame(animate)
    }
    animate()

    const onR = () => { const w = el.clientWidth, h = el.clientHeight; cam.aspect = w / h; cam.updateProjectionMatrix(); ren.setSize(w, h) }
    window.addEventListener("resize", onR)
    return () => {
      alive = false
      window.removeEventListener("resize", onR)

      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }

      if (completeTimerRef.current !== null) {
        window.clearTimeout(completeTimerRef.current)
        completeTimerRef.current = null
      }

      disposeSceneGraph(scene)
      ren.renderLists.dispose()
      ren.dispose()

      if (el.contains(ren.domElement)) el.removeChild(ren.domElement)
      rollRef.current = null
    }
  }, [targetResults, finish])

  const total = displayTotal ?? targetResults.reduce((a, d) => a + d.value, 0)
  const showContextCard = !hideContextCard && Boolean(title || label || comparison || settled)

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 100,
      animation: "diceIn .3s ease-out",
    }}>
      <style>{`
        @keyframes diceIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes resultBanner { 0% { opacity: 0; transform: scale(1.8); filter: blur(8px); } 50% { opacity: 1; transform: scale(0.95); filter: blur(0); } 100% { opacity: 1; transform: scale(1); filter: blur(0); } }
      `}</style>
      <div ref={mountRef} style={{ width: "100%", height: "100%", position: "absolute", top: 0, left: 0 }} />
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none", background: "radial-gradient(ellipse at 50% 60%, transparent 30%, rgba(0,0,0,.5) 100%)" }} />
      {/* Context panel: compact during rolling, expands into result panel on settle */}
      {showContextCard && (
        <div style={{
          position: "absolute",
          top: settled ? "72%" : "42px",
          left: "50%",
          transform: `translate(-50%, ${settled ? "-50%" : "0"}) scale(${settled ? 1 : 0.82})`,
          transition: "top .45s cubic-bezier(.22,1,.36,1), transform .45s cubic-bezier(.22,1,.36,1), padding .45s cubic-bezier(.22,1,.36,1), min-width .45s cubic-bezier(.22,1,.36,1), border-color .45s ease, box-shadow .45s ease, background .45s ease",
          pointerEvents: "none", textAlign: "center",
          background: settled
            ? "linear-gradient(180deg, rgba(10,5,16,.95) 0%, rgba(10,5,16,.85) 80%, rgba(10,5,16,.4) 100%)"
            : "linear-gradient(180deg, rgba(10,5,16,.84) 0%, rgba(10,5,16,.7) 100%)",
          padding: settled ? "20px 40px 24px" : "10px 18px 12px",
          borderRadius: 16,
          minWidth: settled ? 220 : 170,
          border: settled && comparison
            ? `2px solid ${comparison.success ? "rgba(74,222,128,.4)" : "rgba(248,113,113,.4)"}`
            : "1px solid rgba(160,128,96,.3)",
          boxShadow: settled && comparison
            ? `0 0 40px ${comparison.success ? "rgba(74,222,128,.15)" : "rgba(248,113,113,.15)"}`
            : "0 0 20px rgba(0,0,0,.2)",
        }}>
          {/* Title */}
          {title && (
            <div style={{
              fontFamily: "'Cinzel', serif", fontSize: settled ? "clamp(14px, 3vw, 20px)" : "clamp(11px, 2.1vw, 14px)",
              color: "#c8a878", letterSpacing: 3, textTransform: "uppercase",
              marginBottom: settled ? 8 : 4, fontWeight: 700,
              transition: "font-size .35s ease, margin-bottom .35s ease, opacity .25s ease",
              opacity: settled ? 1 : 0.92,
            }}>
              {title}
            </div>
          )}
          {/* Label (sub-heading) */}
          {label && (
            <div style={{
              fontFamily: "'Cinzel', serif", fontSize: settled ? "clamp(11px, 2vw, 15px)" : "clamp(10px, 1.9vw, 12px)",
              color: "#8a7a60", letterSpacing: 3, textTransform: "uppercase",
              marginBottom: settled ? 6 : 2,
              transition: "font-size .35s ease, margin-bottom .35s ease, opacity .25s ease",
              opacity: settled ? 0.95 : 0.82,
            }}>
              {label}
            </div>
          )}
          {/* Total */}
          <div
            data-dice-total="true"
            style={{
              fontFamily: "'MedievalSharp', cursive", fontSize: "clamp(52px, 14vw, 96px)", lineHeight: 1,
              color: "#ffd666", textShadow: "0 0 40px rgba(255,180,40,.8), 0 0 100px rgba(255,120,0,.4), 0 2px 4px rgba(0,0,0,.9)",
              fontWeight: 700,
              opacity: settled ? 1 : 0,
              transform: `translateY(${settled ? 0 : 8}px) scale(${settled ? 1 : 0.94})`,
              transition: "opacity .3s ease, transform .35s cubic-bezier(.22,1,.36,1)",
            }}
          >
            {total}
          </div>
          {/* Dice breakdown */}
          {!displayTotal && targetResults.length > 1 && (
            <div style={{
              fontFamily: "'Cinzel', serif", fontSize: "clamp(16px, 3vw, 24px)",
              color: "#d4a860", marginTop: 6, letterSpacing: 4,
              textShadow: "0 0 12px rgba(255,180,40,.4)",
            }}>
              {targetResults.map(d => d.value).join("  +  ")}
            </div>
          )}
          {/* Comparison line */}
          {comparison && (
            <div style={{
              marginTop: 12, fontFamily: "'Crimson Text', serif", fontSize: "clamp(14px, 3vw, 20px)",
              color: "#b0a090", letterSpacing: 1,
            }}>
              {comparison.text}
            </div>
          )}
          {/* Success / Failure banner */}
          {comparison && (
            <div style={{
              marginTop: 14, fontFamily: "'Cinzel', serif",
              fontSize: "clamp(24px, 7vw, 48px)", fontWeight: 900,
              letterSpacing: 6, textTransform: "uppercase", lineHeight: 1.1,
              color: comparison.success ? "#4ade80" : "#f87171",
              textShadow: comparison.success
                ? "0 0 30px rgba(74,222,128,.7), 0 0 80px rgba(74,222,128,.3), 0 2px 4px rgba(0,0,0,.8)"
                : "0 0 30px rgba(248,113,113,.7), 0 0 80px rgba(248,113,113,.3), 0 2px 4px rgba(0,0,0,.8)",
              animation: "resultBanner .5s ease-out both",
            }}>
              {comparison.success ? comparison.successLabel : comparison.failLabel}
            </div>
          )}
        </div>
      )}
      {!showContextCard && (
        <div
          data-dice-total="true"
          style={{
            position: "absolute",
            right: 26,
            bottom: 22,
            minWidth: 72,
            minHeight: 72,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 4,
            background: "#eaddcf",
            border: "2px solid #44403c",
            boxShadow: "0 10px 28px rgba(0, 0, 0, .35)",
            transform: `translateY(${settled ? 0 : 10}px) scale(${settled ? 1 : 0.92})`,
            opacity: settled ? 1 : 0,
            pointerEvents: "none",
            fontFamily: "'MedievalSharp', cursive",
            fontSize: "clamp(32px, 6vw, 42px)",
            lineHeight: 1,
            color: "#1c1917",
            textShadow: "0 1px 0 rgba(255, 255, 255, .55), 0 1px 3px rgba(0, 0, 0, .35)",
            transition: "opacity .25s ease, transform .3s cubic-bezier(.22,1,.36,1)",
          }}
        >
          {total}
        </div>
      )}
      <button
        type="button"
        onClick={() => finish(0)}
        style={{
          position: "absolute", top: 16, right: 16, zIndex: 110,
          background: "rgba(0,0,0,.6)", border: "1px solid #4a3a28", borderRadius: 8,
          color: "#c8a060", fontFamily: "'Cinzel', serif", fontSize: 14, padding: "8px 16px",
          cursor: "pointer",
        }}
      >
        Close
      </button>
    </div>
  )
}
