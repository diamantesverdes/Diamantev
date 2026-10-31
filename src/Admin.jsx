import { useState, useEffect, useRef, Component } from 'react'
import { createPortal } from 'react-dom'
import { jsPDF } from 'jspdf'
import JSZip from 'jszip'
import * as XLSX from 'xlsx'
import pptxgen from 'pptxgenjs'
import { supabase, supabaseStorage } from './supabaseClient'
import { addToQueue, isOnline, queueLength, processQueue } from './offlineQueue'

// Componentes estables fuera de Admin(): si se definieran adentro, React los
// recrearía en cada render (por ejemplo, en cada tecla escrita al buscar) y
// los remontaría por completo, causando parpadeos/pérdida de scroll y foco.
function PlantPicker({ list, selectedId, onSelect }) {
  return (
    <div style={{ maxHeight: 180, overflowY: 'auto', border: '1px solid #ccc', borderRadius: 8, marginBottom: 8, background: '#fff' }}>
      {list.length === 0 && <p className="status-msg" style={{ padding: 8, margin: 0 }}>Sin resultados</p>}
      {list.map(p => (
        <div
          key={p.id}
          onClick={() => onSelect(p.id)}
          style={{
            padding: '10px 10px',
            cursor: 'pointer',
            background: selectedId === p.id ? '#e8dfc8' : 'transparent',
            borderBottom: '1px solid #eee',
            fontWeight: selectedId === p.id ? 'bold' : 'normal',
          }}
        >
          {selectedId === p.id ? '✓ ' : ''}{p.name}
        </div>
      ))}
    </div>
  )
}

// Nombres que en realidad son un código (ej. "6d6430d1 4ac0 40...", de fotos cargadas en masa): se ordenan al final.
const esNombreCodigo = n => /^[0-9a-f]{8}[\s_-]?[0-9a-f]{4}/i.test(String(n || '').trim())
const naturalCollator = new Intl.Collator('es', { numeric: true, sensitivity: 'base' })

// ---------- Color de las plantas (detección automática a partir de la foto) ----------
// Orden = orden en que se muestran los chips y en que se ordena "por color".
const PLANT_COLORS = [
  { name: 'Blanca',   rgb: [245, 243, 238] },
  { name: 'Crema',    rgb: [240, 232, 190] },
  { name: 'Amarilla', rgb: [245, 205, 40] },
  { name: 'Durazno',  rgb: [248, 198, 150] },
  { name: 'Naranja',  rgb: [242, 110, 40] },
  { name: 'Coral',    rgb: [240, 100, 100] },
  { name: 'Rosada',   rgb: [243, 165, 185] },
  { name: 'Magenta',  rgb: [210, 40, 140] },
  { name: 'Roja',     rgb: [210, 30, 35] },
  { name: 'Vino',     rgb: [150, 15, 65] },
  { name: 'Lavanda',  rgb: [200, 150, 215] },
  { name: 'Morada',   rgb: [130, 40, 150] },
  { name: 'Bicolor',  rgb: null },
]
const colorIndex = name => { const i = PLANT_COLORS.findIndex(c => c.name === name); return i === -1 ? 999 : i }
function colorDotStyle(name, size = 12) {
  const c = PLANT_COLORS.find(x => x.name === name)
  const base = { display: 'inline-block', width: size, height: size, borderRadius: '50%', border: '1px solid rgba(0,0,0,0.25)', flexShrink: 0 }
  if (!c) return { ...base, background: '#ddd' }
  if (!c.rgb) return { ...base, background: 'linear-gradient(90deg, #fff 50%, #D2288C 50%)' }
  return { ...base, background: `rgb(${c.rgb.join(',')})` }
}
function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min
  let h = 0
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  return [h, max === 0 ? 0 : d / max, max]
}
function rgbToLab(r, g, b) {
  const lin = c => { c /= 255; return c > 0.04045 ? Math.pow((c + 0.055) / 1.055, 2.4) : c / 12.92 }
  const R = lin(r), G = lin(g), B = lin(b)
  const x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047
  const y = R * 0.2126 + G * 0.7152 + B * 0.0722
  const z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883
  const f = t => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
  const fx = f(x), fy = f(y), fz = f(z)
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]
}
const COLOR_PROTOS = PLANT_COLORS.filter(c => c.rgb).map(c => ({ name: c.name, lab: rgbToLab(...c.rgb) }))
function loadImageForColor(url) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('No se pudo cargar la foto'))
    img.src = url
  })
}
// Mira el centro de la foto (donde está la flor), ignora hojas / tierra / sombras y
// asigna cada píxel al color más cercano de la lista. Devuelve el color dominante,
// o null si no encuentra flor clara.
async function detectColorFromUrl(url) {
  const img = await loadImageForColor(url)
  const S = 64
  const canvas = document.createElement('canvas')
  canvas.width = S; canvas.height = S
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  const w = img.naturalWidth, h = img.naturalHeight
  const side = Math.min(w, h) * 0.6
  ctx.drawImage(img, (w - side) / 2, (h - side) / 2, side, side, 0, 0, S, S)
  const data = ctx.getImageData(0, 0, S, S).data
  return classifyColorPixels(data, S)
}
// Parte pura (sin DOM): recibe los píxeles RGBA de la zona central y devuelve el color.
function classifyColorPixels(data, S) {
  const votes = {}
  let valid = 0
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2]
    const [hh, sat, val] = rgbToHsv(r, g, b)
    if (val < 0.18) continue                                            // sombras muy oscuras
    if (hh > 65 && hh < 170 && sat > 0.18) continue                     // hojas
    if (hh >= 10 && hh <= 45 && sat >= 0.25 && sat <= 0.8 && val < 0.5) continue // tierra
    if (sat < 0.1 && val < 0.6) continue                                // gris/sombra
    const lab = rgbToLab(r, g, b)
    let best = null, bestD = Infinity
    for (const p of COLOR_PROTOS) {
      const dL = lab[0] - p.lab[0], da = lab[1] - p.lab[1], db = lab[2] - p.lab[2]
      const d = dL * dL * 0.5 + da * da + db * db // la luz pesa menos: las fotos varían de exposición
      if (d < bestD) { bestD = d; best = p.name }
    }
    votes[best] = (votes[best] || 0) + 1
    valid++
  }
  if (valid < S * S * 0.04) return null
  const ranked = Object.entries(votes).sort((a, b) => b[1] - a[1])
  const [topName] = ranked[0]
  // Bicolor: parte blanca/crema + parte de color intenso (el amarillo de la garganta no cuenta).
  const share = n => (votes[n] || 0) / valid
  const neutralShare = share('Blanca') + share('Crema')
  const intenseShare = ['Magenta', 'Vino', 'Roja', 'Morada', 'Naranja', 'Coral'].reduce((a, n) => a + share(n), 0)
  if (topName !== 'Amarilla' && neutralShare >= 0.12 && intenseShare >= 0.15) return 'Bicolor'
  // Casi todo blanco/crema (con sombras que lo tiñen de durazno/rosa): se queda en el neutro que más pesa.
  if (neutralShare >= 0.4 && intenseShare < 0.15) return share('Crema') > share('Blanca') ? 'Crema' : 'Blanca'
  return topName
}

// ---------- Vincular compras con plantas que ya existen (evita duplicarlas) ----------
// Compara nombres sin tildes, mayúsculas, comillas ni signos: "Iris 'Black Gamecock'" = "iris black gamecock".
function normalizarNombrePlanta(s) {
  return String(s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['"`´‘’“”]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}
// Devuelve { exacta, parecidas }: exacta = la misma planta (mismo nombre normalizado);
// parecidas = hasta 3 candidatas para que tú decidas si es la misma planta o una nueva.
function buscarPlantaParecida(nombre, plantas) {
  const lista = plantas || []
  const n = normalizarNombrePlanta(nombre)
  if (!n) return { exacta: null, parecidas: [] }
  const exacta = lista.find(p => normalizarNombrePlanta(p.name) === n) || null
  if (exacta) return { exacta, parecidas: [] }
  const tokens = new Set(n.split(' ').filter(t => t.length > 1 || /\d/.test(t)))
  const parecidas = lista
    .map(p => {
      const pn = normalizarNombrePlanta(p.name)
      const pt = new Set(pn.split(' ').filter(t => t.length > 1 || /\d/.test(t)))
      const comunes = [...tokens].filter(t => pt.has(t)).length
      let score = comunes / Math.max(tokens.size, pt.size, 1)
      if (pn.length >= 5 && n.length >= 5 && (pn.includes(n) || n.includes(pn))) score = Math.max(score, 0.8)
      return { p, score }
    })
    .filter(x => x.score >= 0.6)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map(x => x.p)
  return { exacta: null, parecidas }
}

// Estados con color (ventas y compras) y formato de dinero
const ESTADOS_VENTA = {
  pedido: { label: 'Pedido', icon: '🕒', bg: '#FFF1CC', border: '#E6C76A' },
  pagado: { label: 'Pagado', icon: '💵', bg: '#DCEBF9', border: '#9CC2E6' },
  entregado: { label: 'Entregado', icon: '✅', bg: '#DCEFD9', border: '#9CCB92' },
}
const ESTADOS_COMPRA = {
  pedido: { label: 'Pedido', icon: '🕒', bg: '#FFF1CC', border: '#E6C76A' },
  pagado: { label: 'Pagado', icon: '💵', bg: '#DCEBF9', border: '#9CC2E6' },
  recibido: { label: 'Recibido', icon: '📦', bg: '#DCEFD9', border: '#9CCB92' },
}
// "Pagada" incluye las que ya se entregaron/recibieron: para llegar a ese estado primero se pagó.
const esPagada = st => st === 'pagado' || st === 'entregado' || st === 'recibido'
// Quita tildes para que buscar "tulipan" encuentre "Tulipán" y viceversa.
function formatBlockDate(iso) {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleString('es-EC', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
  } catch { return '' }
}

// Además del nombre, un lote de semillas también "contiene" la palabra semilla/semillas,
// aunque su nombre (ej. "Mix Tigridias") no la tenga escrita.
function textoBuscableItem(item) {
  return item.name + (item.isSeed ? ' semilla semillas' : '')
}

function normalizarBusqueda(t) {
  return String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}
// Coincide si TODAS las palabras buscadas aparecen en el texto, en cualquier orden:
// "clown oncidium" encuentra "Oncidium Clown". Sin palabras (búsqueda vacía) coincide con todo.
function coincideBusqueda(texto, consulta) {
  const t = normalizarBusqueda(texto)
  return normalizarBusqueda(consulta).split(/\s+/).filter(Boolean).every(w => t.includes(w))
}

// Última selección de las pestañas Tienda, Fotos y Carrusel (la de Etiquetas se guarda aparte, junto a sus cantidades)
const SELECCIONES_KEY = 'diamantev_selecciones'
function readSelecciones() {
  try {
    const v = JSON.parse(localStorage.getItem(SELECCIONES_KEY) || 'null') || {}
    return { tienda: v.tienda || [], fotos: v.fotos || [], carrusel: v.carrusel || [] }
  } catch (e) { return { tienda: [], fotos: [], carrusel: [] } }
}

// Qué le falta a una planta para estar completa. La 🚩 se calcula sola: al completar el dato, desaparece.
function faltaInfo(p) {
  if (!p || p.isSeed) return []
  const falta = []
  if (!p.category_id) falta.push('categoría')
  if (!p.image_url) falta.push('foto')
  if (!(Number(p.price) > 0)) falta.push('precio')
  if (!p.color) falta.push('color')
  return falta
}

// ---------- Intercambios (trueque) ----------
const INT_ESTADOS = {
  cuarentena: { label: 'En cuarentena / adaptación', corto: 'En cuarentena', icon: '🌱', color: '#b06a00', bg: '#FFF1DC' },
  establecida: { label: 'Establecida / incorporada', corto: 'Establecida', icon: '✅', color: '#2E6B47', bg: '#E3F4E1' },
  baja: { label: 'Baja / no viable', corto: 'Baja', icon: '🥀', color: '#8a3b3b', bg: '#F2E0E0' },
}
const folioInt = i => `INT-${String(i.id).padStart(3, '0')}`
const INT_SQL = `create table if not exists intercambios (
  id bigint generated always as identity primary key,
  fecha date not null default current_date,
  contacto text,
  nota text,
  created_at timestamptz not null default now()
);
create table if not exists intercambio_items (
  id bigint generated always as identity primary key,
  intercambio_id bigint not null references intercambios(id) on delete cascade,
  direccion text not null check (direccion in ('entregado','recibido')),
  plant_id text,
  plant_name text not null,
  quantity integer not null default 1 check (quantity > 0),
  estado text check (estado in ('cuarentena','establecida','baja')),
  estado_fecha timestamptz,
  created_at timestamptz not null default now()
);
alter table intercambios enable row level security;
alter table intercambio_items enable row level security;
create policy "admin todo" on intercambios for all to authenticated using (true) with check (true);
create policy "admin todo" on intercambio_items for all to authenticated using (true) with check (true);`

// Color de cada botón de acción (Etiquetas, Tienda, Fotos, Carrusel)
const modeColors = { etiquetas: '#d9363e', tienda: '#f08a24', fotos: '#2f7fd0', carrusel: '#8b4fc2' }

// ---------- Borrador de etiquetas: plantas y cantidades guardadas para revisarlas antes de construir el PDF ----------
const LABELS_DRAFT_KEY = 'diamantev_labels_draft'
function readLabelsDraft() {
  try {
    const v = JSON.parse(localStorage.getItem(LABELS_DRAFT_KEY) || 'null')
    return v && Array.isArray(v.ids) && v.ids.length ? v : null
  } catch (e) { return null }
}

// ---------- Último PDF de etiquetas: se guarda en este navegador hasta que se marque como impreso ----------
function openLabelsDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('diamantev-etiquetas', 1)
    req.onupgradeneeded = () => req.result.createObjectStore('pdf')
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}
async function labelsDbRun(mode, fn) {
  const db = await openLabelsDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('pdf', mode)
    const req = fn(tx.objectStore('pdf'))
    tx.oncomplete = () => { db.close(); resolve(req ? req.result : undefined) }
    tx.onerror = () => { db.close(); reject(tx.error) }
  })
}
const saveLastLabelsPDF = (blob, meta) => labelsDbRun('readwrite', st => st.put({ blob, ...meta }, 'last'))
const loadLastLabelsPDF = () => labelsDbRun('readonly', st => st.get('last'))
const clearLastLabelsPDF = () => labelsDbRun('readwrite', st => st.delete('last'))

// Antes de correr la migración (columnas pagado/entregado/recibido), se deduce del texto de "status".
function pagadoDe(row) { return row.pagado != null ? !!row.pagado : esPagada(row.status) }
function entregadoDe(row) { return row.entregado != null ? !!row.entregado : row.status === 'entregado' }
function recibidoDe(row) { return row.recibido != null ? !!row.recibido : row.status === 'recibido' }
// Estado (Pedido/Pagado/Entregado) de cualquier venta/decremento, a partir de sus casillas
// independientes -- sirve tanto para pedidos web (orders) como para decrementos manuales.
function estadoDeMovimiento(m) {
  if (entregadoDe(m)) return 'entregado'
  if (pagadoDe(m)) return 'pagado'
  return 'pedido'
}
const money = n => `$${(Number(n) || 0).toFixed(2)}`

// Casillas independientes: cada una (menos la primera, "Pedido", que queda fija) se puede marcar
// o desmarcar en cualquier orden -- así se puede corregir "entregado sin pagar" o al revés.
// El abono (anticipo) aparece mientras no esté marcado el segundo paso (Pagado).
function StatusChecklist({ steps, values, onToggle, disabled, anticipo, onAnticipoSave }) {
  const showAnticipo = typeof anticipo === 'number' && onAnticipoSave && !values[steps[1].key]
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 11, textAlign: 'left' }}>
      {steps.map((s, i) => {
        const locked = i === 0
        const checked = locked ? true : !!values[s.key]
        return (
          <label key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 4, opacity: locked ? 0.65 : 1 }}>
            <input
              type="checkbox"
              checked={checked}
              disabled={disabled || locked}
              onChange={() => onToggle(s.key, !values[s.key])}
            />
            {s.label}
          </label>
        )
      })}
      {showAnticipo && (
        <label style={{ display: 'flex', alignItems: 'center', gap: 3, marginTop: 2 }} title="Cuánto te han abonado sin haber pagado todavía el total">
          <span style={{ fontSize: 10, opacity: 0.8 }}>Abono $</span>
          <input
            type="number" step="0.01" defaultValue={anticipo || ''} placeholder="0"
            disabled={disabled}
            onBlur={e => onAnticipoSave(Number(e.target.value) || 0)}
            style={{ width: 46, fontSize: 10 }}
          />
        </label>
      )}
    </div>
  )
}

// Paleta de "tonos" pastel de Diamantev para las tarjetas de filtro rápido.
// Estilo "pergamino + pastilla" (igual al panel Atributos rápidos): fondo degradado, borde dorado y sombra suave.
const PILL_BG = 'linear-gradient(180deg, #FFFFFF 0%, #F4EAD6 100%)'
const PILL_ACTIVE_BG = 'linear-gradient(180deg, #E8F0DF 0%, #C9DDC2 100%)'
const PILL_BORDER = '#C9B48A'
const PILL_SHADOW = '0 2px 3px rgba(91, 70, 54, 0.28), inset 0 1px 0 #fff'
const PARCHMENT_BG = 'linear-gradient(180deg, #F4EAD3 0%, #ECDFC4 100%)'
const PILL_TONE = { bg: PILL_BG, border: PILL_BORDER, active: PILL_ACTIVE_BG }
const QUICK_FILTER_TONES = {
  sage: PILL_TONE, rose: PILL_TONE, cream: PILL_TONE, sky: PILL_TONE, neutral: PILL_TONE,
}

// Botón tipo "tarjeta" que despliega un menú con opciones (ej. Todas/Con/Sin).
// Reemplaza los antiguos segmented-control de 3 botones por uno solo compacto.
function QuickFilterButton({ icon, label, value, options, onChange, tone = 'neutral' }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const c = QUICK_FILTER_TONES[tone] || QUICK_FILTER_TONES.neutral
  const isActive = value !== 'all'
  const current = options.find(o => o.value === value)

  useEffect(() => {
    function handleOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handleOutside)
    document.addEventListener('touchstart', handleOutside)
    return () => {
      document.removeEventListener('mousedown', handleOutside)
      document.removeEventListener('touchstart', handleOutside)
    }
  }, [])

  return (
    <div style={{ position: 'relative' }} ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          background: isActive ? c.active : c.bg,
          border: `2px solid ${c.border}`, borderRadius: 18,
          padding: '9px 14px', fontWeight: isActive ? 700 : 600,
          color: '#5B4636', fontSize: 13.5, whiteSpace: 'nowrap',
          boxShadow: '0 1px 2px rgba(0,0,0,0.06)', cursor: 'pointer',
        }}
      >
        <span style={{ fontSize: 16 }}>{icon}</span>
        {label}
        {isActive && <span style={{ fontSize: 12, opacity: 0.75 }}>· {current?.shortLabel || current?.label}</span>}
        <span style={{ fontSize: 11, opacity: 0.6, marginLeft: 2 }}>⌄</span>
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: '110%', left: 0, zIndex: 20,
          background: '#fff', border: `2px solid ${c.border}`, borderRadius: 12,
          boxShadow: '0 4px 14px rgba(0,0,0,0.16)', overflow: 'hidden', minWidth: 150,
        }}>
          {options.map(o => (
            <div
              key={o.value}
              onClick={() => { onChange(o.value); setOpen(false) }}
              style={{
                padding: '10px 14px', cursor: 'pointer', fontSize: 13.5,
                background: value === o.value ? c.active : '#fff',
                fontWeight: value === o.value ? 700 : 400, color: '#5B4636',
              }}
            >
              {value === o.value ? '✓ ' : ''}{o.label}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// Botón de una sola condición On/Off (ej. "Floreció alguna vez"), mismo estilo visual.
function ToggleFilterButton({ icon, label, active, onClick, tone = 'neutral' }) {
  const c = QUICK_FILTER_TONES[tone] || QUICK_FILTER_TONES.neutral
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 6,
        background: active ? c.active : c.bg,
        border: `2px solid ${c.border}`, borderRadius: 18,
        padding: '9px 14px', fontWeight: active ? 700 : 600,
        color: '#5B4636', fontSize: 13.5, whiteSpace: 'nowrap',
        boxShadow: '0 1px 2px rgba(0,0,0,0.06)', cursor: 'pointer',
      }}
    >
      <span style={{ fontSize: 16 }}>{icon}</span>
      {label}
      {active && <span style={{ fontSize: 12 }}>✓</span>}
    </button>
  )
}

// Botón que despliega un checklist de varias opciones combinables a la vez
// (ej. "Revisar": sin foto, sin categoría, sin precio... todas se pueden marcar juntas).
function MultiCheckFilterButton({ icon, label, tone = 'neutral', options, checked, onToggle }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const c = QUICK_FILTER_TONES[tone] || QUICK_FILTER_TONES.neutral
  const activeCount = options.filter(o => checked.has(o.value)).length

  useEffect(() => {
    function handleOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handleOutside)
    document.addEventListener('touchstart', handleOutside)
    return () => {
      document.removeEventListener('mousedown', handleOutside)
      document.removeEventListener('touchstart', handleOutside)
    }
  }, [])

  return (
    <div style={{ position: 'relative' }} ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          background: activeCount > 0 ? c.active : c.bg,
          border: `2px solid ${c.border}`, borderRadius: 18,
          padding: '9px 14px', fontWeight: activeCount > 0 ? 700 : 600,
          color: '#5B4636', fontSize: 13.5, whiteSpace: 'nowrap', cursor: 'pointer',
        }}
      >
        <span style={{ fontSize: 16 }}>{icon}</span>
        {label}{activeCount > 0 ? ` (${activeCount})` : ''}
        <span style={{ fontSize: 11, opacity: 0.6 }}>⌄</span>
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: '110%', left: 0, zIndex: 20,
          background: '#fff', border: `2px solid ${c.border}`, borderRadius: 12,
          boxShadow: '0 4px 14px rgba(0,0,0,0.16)', overflow: 'hidden', minWidth: 190,
        }}>
          {options.map(o => (
            <label
              key={o.value}
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', cursor: 'pointer', fontSize: 13.5, color: '#5B4636' }}
            >
              <input type="checkbox" checked={checked.has(o.value)} onChange={() => onToggle(o.value)} />
              {o.icon ? `${o.icon} ` : ''}{o.label}
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------- Botón "Atrás" del celular: cerrar pantallas/modales en vez de salir de la app ----------
// Cada vez que se abre una pantalla o modal "cerrable con Atrás", se agrega una entrada
// al historial del navegador. Cuando el usuario toca Atrás, en vez de salir de la app
// (porque React no usa páginas reales), cerramos lo último que se abrió. Si hay varias
// cosas abiertas a la vez (ej. Filtros y, dentro, el selector de categoría), Atrás cierra
// primero la de más arriba, como en una app nativa.
let backStack = []
let backPopstateAttached = false

function attachBackPopstateOnce() {
  if (backPopstateAttached) return
  backPopstateAttached = true
  window.addEventListener('popstate', () => {
    const top = backStack.pop()
    if (top) top.onClose()
  })
}

function useBackableModal(isOpen, onClose) {
  const idRef = useRef(null)
  if (idRef.current === null) idRef.current = Math.random().toString(36).slice(2)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const wasOpenRef = useRef(false)

  useEffect(() => { attachBackPopstateOnce() }, [])

  useEffect(() => {
    if (isOpen && !wasOpenRef.current) {
      window.history.pushState({ __backModal: idRef.current }, '')
      backStack.push({ id: idRef.current, onClose: () => onCloseRef.current() })
      wasOpenRef.current = true
    } else if (!isOpen && wasOpenRef.current) {
      wasOpenRef.current = false
      const idx = backStack.findIndex(e => e.id === idRef.current)
      if (idx !== -1) {
        // Seguía en la pila: se cerró desde la propia UI (✕, "Cancelar", tocar afuera),
        // no por el botón Atrás.
        const isTop = idx === backStack.length - 1
        if (isTop) {
          // Dejamos que el propio evento popstate (disparado por history.back()) sea el
          // único que la saca de la pila — si la sacábamos nosotros de una y ADEMÁS
          // esperábamos el popstate, el popstate terminaba sacando la SIGUIENTE entrada
          // (la de otro modal todavía abierto) por error.
          window.history.back()
        } else {
          // Se cerró fuera de orden (no es la de más arriba): la sacamos directo,
          // sin tocar el historial, para no arrastrar a la que sigue abierta.
          backStack.splice(idx, 1)
        }
      }
    }
  }, [isOpen])
}

function Admin() {
  const [authed, setAuthed] = useState(false)
  const [checkingSession, setCheckingSession] = useState(true)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [failed, setFailed] = useState(false)
  const [loggingIn, setLoggingIn] = useState(false)
  const [resetMode, setResetMode] = useState(false)
  const [resetEmail, setResetEmail] = useState('')
  const [resetSent, setResetSent] = useState(false)
  const [sendingReset, setSendingReset] = useState(false)
  const [recoveryMode, setRecoveryMode] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [updatingPassword, setUpdatingPassword] = useState(false)

  // 'galeria' (pantalla de aterrizaje) | 'categorias' | 'pedidos' | 'ingresos'
  const [view, setView] = useState('galeria')

  const [galleryFilter, setGalleryFilter] = useState('all')
  // Modo de la Galería: 'acciones' (la casilla selecciona para PDF/etiquetas/enviar)
  // o 'cliente' (la casilla marca/desmarca plants.marcado_cliente directamente).
  const [galleryMode, setGalleryMode] = useState('acciones')
  const [verMenuOpen, setVerMenuOpen] = useState(false)
  const [galleryLabelStatus, setGalleryLabelStatus] = useState('all')
  const [labelQtyModalOpen, setLabelQtyModalOpen] = useState(false)
  const [pendingLabelAction, setPendingLabelAction] = useState(null) // 'print' | 'pdf' | 'pptx'
  const [labelQuantities, setLabelQuantities] = useState(() => (readLabelsDraft() || {}).idQty || {}) // { plantId: cantidad }
  // Número temporal de cada planta de la lista de Etiquetas (el de la estaca provisional en el jardín).
  // nums = { plantId: n }; next = próximo número. No cambia al quitar otras plantas, y vuelve a 1 cuando la lista queda vacía.
  const [labelTemp, setLabelTemp] = useState(() => { const d = readLabelsDraft() || {}; return { nums: d.tempNums || {}, next: d.tempNext || 1 } })
  const [intercambios, setIntercambios] = useState([]) // cabeceras: INT-001, fecha, contacto
  const [intercambioItems, setIntercambioItems] = useState([]) // líneas: lo que se entregó y lo que se recibió
  const [intercambiosOk, setIntercambiosOk] = useState(true) // false mientras las tablas no existan en Supabase
  const [intSearch, setIntSearch] = useState('')
  const [intEstadoFilter, setIntEstadoFilter] = useState('all') // 'all' | 'cuarentena' | 'establecida' | 'baja'
  const [intFormOpen, setIntFormOpen] = useState(false)
  const [intPicker, setIntPicker] = useState(null) // { lado, idx, term }: selector de planta con fotos
  const [intFocus, setIntFocus] = useState(null) // fila del formulario con el cursor (muestra sugerencias con foto)
  const [intSaving, setIntSaving] = useState(false)
  const [intForm, setIntForm] = useState({ contacto: '', fecha: '', nota: '', entregados: [], recibidos: [] })
  const [carouselModalOpen, setCarouselModalOpen] = useState(false) // pantalla Carrusel
  const [carouselPickFor, setCarouselPickFor] = useState(null) // planta a la que se le elige la foto del carrusel
  const [storeModalOpen, setStoreModalOpen] = useState(false) // pantalla "Tienda" (poner/quitar, descuento, carrusel)
  const [storeDiscount, setStoreDiscount] = useState('') // % de descuento escrito en la pantalla Tienda
  const galleryVisibleRef = useRef([]) // plantas que se ven ahora en la galería (para "Todas" en las pantallas)
  const iconRowRef = useRef(null) // fila deslizable de íconos de filtro
  const [iconRowEdge, setIconRowEdge] = useState({ start: true, end: false }) // ¿está al inicio / al final?
  const [labelBulk, setLabelBulk] = useState({ id: null, name: null }) // valor de la fila "Todas" del modal de cantidades
  const [labelNameQuantities, setLabelNameQuantities] = useState(() => (readLabelsDraft() || {}).nameQty || {}) // { plantId: cantidad de etiquetas con mini foto (por defecto 1) }
  const [galleryProveedor, setGalleryProveedor] = useState('all')
  const [galleryCompraStatus, setGalleryCompraStatus] = useState('all')
  const [galleryLoteNumero, setGalleryLoteNumero] = useState('all')
  const [galleryVentaLoteNumero, setGalleryVentaLoteNumero] = useState('all')
  const [galleryVentaStatus, setGalleryVentaStatus] = useState('all')
  const [galleryActionFilter, setGalleryActionFilter] = useState('all')
  const [gallerySearch, setGallerySearch] = useState('')
  const [highlightPlantId, setHighlightPlantId] = useState(null) // planta que se acaba de buscar: se resalta y se hace scroll hasta ella
  const [galleryMissingFilters, setGalleryMissingFilters] = useState(new Set())
  const [galleryFiltersOpen, setGalleryFiltersOpen] = useState(false)
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false) // buscador único (🔍)
  const [openCards, setOpenCards] = useState(() => new Set()) // tarjetas (ventas, compras, notas…) abiertas; por defecto solo se ve el título
  const toggleCard = key => setOpenCards(prev => { const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n })
  const [lastLabelsPdf, setLastLabelsPdf] = useState(null) // último PDF de etiquetas guardado (hasta marcarlo como impreso)
  const [globalSearchTerm, setGlobalSearchTerm] = useState('')
  const [filterGroup, setFilterGroup] = useState(null) // 'compra' | 'venta' | 'etiquetas' | null (grupo de filtros desplegado)
  const [galleryColorFilter, setGalleryColorFilter] = useState('all') // 'all' | '__none__' | nombre de color
  const [gallerySortBy, setGallerySortBy] = useState('nombre') // 'nombre' | 'color'
  const [colorPickerFor, setColorPickerFor] = useState(null) // { ids: [...], title }
  const [colorScan, setColorScan] = useState(null) // { done, total } mientras detecta
  const colorRunning = useRef(false)
  const colorTried = useRef(new Set())
  const [catFilterSearch, setCatFilterSearch] = useState('')
  const [showInlineNewCategory, setShowInlineNewCategory] = useState(false)
  const [inlineNewCategoryName, setInlineNewCategoryName] = useState('')
  const [inlineNewCategoryEmoji, setInlineNewCategoryEmoji] = useState('🌿')
  const [provFilterSearch, setProvFilterSearch] = useState('')
  const [loteFilterSearch, setLoteFilterSearch] = useState('')
  const [ventaLoteFilterSearch, setVentaLoteFilterSearch] = useState('')
  const [activeSelector, setActiveSelector] = useState(null)
  const [categoriesSearch, setCategoriesSearch] = useState('')
  // Cada botón (Etiquetas, Tienda, Fotos, Carrusel) tiene su propia selección. Solo la de Etiquetas se conserva al cerrar la app.
  const [actionMode, setActionMode] = useState(null) // null | 'etiquetas' | 'tienda' | 'fotos' | 'carrusel'
  const [modeSets, setModeSets] = useState(() => { const o = readSelecciones(); return { etiquetas: new Set((readLabelsDraft() || {}).ids || []), tienda: new Set(o.tienda), fotos: new Set(o.fotos), carrusel: new Set(o.carrusel) } })
  const modeKey = actionMode || 'etiquetas'
  const selectedLabels = modeSets[modeKey]
  const setSelectedLabels = updater => setModeSets(prev => {
    const cur = prev[modeKey]
    const next = typeof updater === 'function' ? updater(cur) : updater
    return next === cur ? prev : { ...prev, [modeKey]: next }
  })
  const [photoModalPlantId, setPhotoModalPlantId] = useState(null)
  const [seedSheetId, setSeedSheetId] = useState(null) // lote de semillas abierto desde Galería/Tabla
  const [seedSheetSection, setSeedSheetSection] = useState('resumen')
  const [seedSheetMenuOpen, setSeedSheetMenuOpen] = useState(false)
  const [seedVentasFilter, setSeedVentasFilter] = useState('all') // 'all' | 'pedido' | 'pagado' | 'entregado'
  const [photoModalIndex, setPhotoModalIndex] = useState(0)
  const [photoModalMenuOpen, setPhotoModalMenuOpen] = useState(false)
  const [photoModalSection, setPhotoModalSection] = useState('fotos')
  const [mixRows, setMixRows] = useState([{ name: '', qty: '' }, { name: '', qty: '' }]) // variedades al separar un mix
  const [splittingMix, setSplittingMix] = useState(false)
  // Panel "Compra e inventario" del modal de planta: datos frescos de la BD + borrador editable
  const [plantInv, setPlantInv] = useState(null) // { plantId, compras, lotes }
  const [plantInvDraft, setPlantInvDraft] = useState(null)
  const [plantInvBase, setPlantInvBase] = useState(null) // copia del borrador al cargar/guardar, para saber si hay cambios
  const [savingPlantInv, setSavingPlantInv] = useState(false)
  const [plantInvMsg, setPlantInvMsg] = useState('')
  const photoModalSheetRef = useRef(null)
  const bulkLoteBuilderPhotoInputRef = useRef(null)
  const [bulkCategoryPickerFor, setBulkCategoryPickerFor] = useState(null) // 'loteBuilder' | null
  const [bulkCategorySearch, setBulkCategorySearch] = useState('')
  const [bulkChosenCategoryId, setBulkChosenCategoryId] = useState(null)
  const [labelSelectMenuOpen, setLabelSelectMenuOpen] = useState(false)
  const [isWideScreen, setIsWideScreen] = useState(() => typeof window !== 'undefined' && window.innerWidth >= 900)

  const [tableFilters, setTableFilters] = useState({
    categoria: 'all', proveedor: '', precioMin: '', precioMax: '',
    stockMin: '', stockMax: '', altura: '', nueva: 'all',
    descuento: 'all', proximamente: 'all', revisar: 'all', florecio: 'all', vendido: 'all', foto: 'all',
  })
  const [tableSort, setTableSort] = useState({ field: 'name', dir: 'asc' })

  function setTableFilter(field, value) {
    setTableFilters(prev => ({ ...prev, [field]: value }))
  }

  function toggleTableSort(field) {
    setTableSort(prev => prev.field === field ? { field, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { field, dir: 'asc' })
  }

  function exportTableToExcel(rows) {
    const headers = [
      'Nombre', 'Categoría', 'Proveedor', 'Costo', 'Costo + envío', 'Precio', 'Precio con descuento', 'Stock', 'Altura',
      'Nueva', 'Descuento', 'Próximamente', 'Para revisar', 'Floreció', 'Vendió',
      'N° de compra', 'Fecha de compra', 'N° de venta', 'Fecha de venta',
    ]
    const data = rows.map(r => [
      r.name,
      r.categoria,
      r.proveedor,
      r.costoSinEnvio != null ? Number(r.costoSinEnvio.toFixed(2)) : '',
      r.precioSugerido != null ? Number(r.precioSugerido.toFixed(2)) : '',
      Number(r.price.toFixed(2)),
      r.discountPercent > 0 ? Number(r.priceWithDiscount.toFixed(2)) : '',
      r.stock,
      r.height,
      r.is_new ? 'Sí' : 'No',
      r.on_sale ? 'Sí' : 'No',
      r.coming_soon ? 'Sí' : 'No',
      r.flagged ? 'Sí' : 'No',
      r.florecio ? 'Sí' : 'No',
      r.vendido ? 'Sí' : 'No',
      r.loteNumero ?? '',
      r.fechaCompra ? new Date(r.fechaCompra).toLocaleDateString() : '',
      r.ventaNumero ?? '',
      r.fechaVenta ? new Date(r.fechaVenta).toLocaleDateString() : '',
    ])
    const worksheet = XLSX.utils.aoa_to_sheet([headers, ...data])
    worksheet['!cols'] = headers.map((h, i) => ({
      wch: Math.max(h.length, ...data.map(row => String(row[i] ?? '').length)) + 2,
    }))
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Galería')
    XLSX.writeFile(workbook, `diamantev-galeria-${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  useEffect(() => {
    function handleResize() { setIsWideScreen(window.innerWidth >= 900) }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  // Antes de agregar las fotos a la compra, preguntamos si son todas de una categoría
  // particular (o "sin categoría" para decidir después), y recién ahí abrimos el selector de fotos.
  function chooseBulkCategory(catId) {
    setBulkChosenCategoryId(catId)
    const target = bulkCategoryPickerFor
    setBulkCategoryPickerFor(null)
    setBulkCategorySearch('')
    if (target === 'loteBuilder') {
      bulkLoteBuilderPhotoInputRef.current?.click()
    }
  }
  const [shareModalOpen, setShareModalOpen] = useState(false)
  const [shareOnlyStock, setShareOnlyStock] = useState(false)

  const [sharingNotes, setSharingNotes] = useState(false)

  const [orders, setOrders] = useState([])
  const [approvingIds, setApprovingIds] = useState([])

  const [compras, setCompras] = useState([])
  const [lotes, setLotes] = useState([])
  const [ventaLotes, setVentaLotes] = useState([])
  const [ventaLoteBuilderOpen, setVentaLoteBuilderOpen] = useState(false)
  const [ventaLoteCliente, setVentaLoteCliente] = useState('')
  const [ventaLoteLines, setVentaLoteLines] = useState([])
  const [ventaLineForm, setVentaLineForm] = useState({ plant_id: '', quantity: '', unit_price: '', motivo: 'Venta manual (con precio)' })
  const [savingVentaLote, setSavingVentaLote] = useState(false)
  const [addToVentaLoteId, setAddToVentaLoteId] = useState(null)
  const [shareVentaMenuId, setShareVentaMenuId] = useState(null)
  const [shareOrderMenuId, setShareOrderMenuId] = useState(null)
  const [loteBuilderOpen, setLoteBuilderOpen] = useState(false)
  const [loteStep, setLoteStep] = useState('header') // 'method' (elegir cómo ingresar) | 'header' (paso 1) | 'products' (paso 2)
  const [loteMethod, setLoteMethod] = useState('manual') // 'manual' | 'fotos' (el escaneo de factura tiene su propio flujo)
  const [loteAddMode, setLoteAddMode] = useState('choose') // 'choose' | 'search' | 'new'
  const [loteNota, setLoteNota] = useState('')
  const [loteProveedor, setLoteProveedor] = useState('')
  const [loteLines, setLoteLines] = useState([])
  const [lineForm, setLineForm] = useState({ plant_id: '', new_plant_name: '', new_plant_category: '', quantity: '', unit_cost: '', sale_price: '', file: null })
  const [loteLinePlantSearch, setLoteLinePlantSearch] = useState('')
  const [loteLinePlantCategory, setLoteLinePlantCategory] = useState('all')
  const [savingLote, setSavingLote] = useState(false)
  const [addToLoteId, setAddToLoteId] = useState(null)
  const [addToLoteForm, setAddToLoteForm] = useState({ plant_id: '', new_plant_name: '', new_plant_category: '', quantity: '', unit_cost: '', sale_price: '', file: null })
  const [savingAddToLote, setSavingAddToLote] = useState(false)
// --- ESTADO Y FUNCIÓN PARA LECTURA DE COMPRAS CON IA ---
  const [isAnalyzingImage, setIsAnalyzingImage] = useState(false);

  // Reduce el tamaño de la foto antes de subirla, para que el escaneo con IA
  // sea rápido y no se corte la conexión con fotos pesadas del celular.
  function resizeImageForUpload(file, maxDim = 1600, quality = 0.75) {
    return new Promise((resolve, reject) => {
      const img = new Image()
      const url = URL.createObjectURL(file)
      img.onload = () => {
        URL.revokeObjectURL(url)
        let { width, height } = img
        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round(height * (maxDim / width))
            width = maxDim
          } else {
            width = Math.round(width * (maxDim / height))
            height = maxDim
          }
        }
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        ctx.drawImage(img, 0, 0, width, height)
        canvas.toBlob(
          blob => {
            if (blob) resolve(blob)
            else reject(new Error('No se pudo comprimir la imagen'))
          },
          'image/jpeg',
          quality
        )
      }
      img.onerror = () => {
        URL.revokeObjectURL(url)
        reject(new Error('No se pudo cargar la imagen'))
      }
      img.src = url
    })
  }

  async function handleAutoFillFromImage(file) {
    if (!file) return;
    
    setIsAnalyzingImage(true);
    try {
      const resizedBlob = await resizeImageForUpload(file);
      const formData = new FormData();
      formData.append('file', resizedBlob, 'foto.jpg');

      // Reemplaza esta URL por tu Endpoint o Supabase Edge Function
      const response = await fetch('https://hrtaqjjrktmuwqcibagx.supabase.co/functions/v1/analyze-purchase', {
        method: 'POST',
        headers: { Authorization: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhydGFxampya3RtdXdxY2liYWd4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ2NzY4NDQsImV4cCI6MjEwMDI1Mjg0NH0.Q1wJS8m7EwBG2MaFXqO50cbg2QeMCeo27tggsFPg4aU', apikey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhydGFxampya3RtdXdxY2liYWd4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ2NzY4NDQsImV4cCI6MjEwMDI1Mjg0NH0.Q1wJS8m7EwBG2MaFXqO50cbg2QeMCeo27tggsFPg4aU' },
        body: formData,
      });

      if (!response.ok) {
        const errBody = await response.text();
        throw new Error(`HTTP ${response.status}: ${errBody.slice(0, 300)}`);
      }

      const result = await response.json();
      const first = (result.items && result.items[0]) || {};

      // Autocompleta los campos del formulario
      setLineForm(prev => ({
        ...prev,
        new_plant_name: first.nombre || prev.new_plant_name || '',
        quantity: first.cantidad != null ? String(first.cantidad) : (prev.quantity || '1'),
        unit_cost: first.precio_unitario != null ? String(first.precio_unitario) : (prev.unit_cost || '0'),
      }));
    } catch (err) {
      console.error('Error al analizar imagen:', err);
      alert('No se pudieron extraer datos de la imagen. Por favor escríbelos manualmente.');
    } finally {
      setIsAnalyzingImage(false);
    }
  }

  // --- ESCANEAR FACTURA COMPLETA (varios productos a la vez) ---
  const [scanningFactura, setScanningFactura] = useState(false)
  const [facturaScanOpen, setFacturaScanOpen] = useState(false)
  const [facturaData, setFacturaData] = useState({ proveedor: '', fecha: '', items: [], envio: '', subtotal: '', total: '' })
  const [savingFactura, setSavingFactura] = useState(false)

  async function handleScanFacturaFile(e) {
    const file = e.target.files && e.target.files[0]
    e.target.value = ''
    if (!file) return
    setScanningFactura(true)
    try {
      const resizedBlob = await resizeImageForUpload(file)
      const formData = new FormData()
      formData.append('file', resizedBlob, 'factura.jpg')
      const response = await fetch('https://hrtaqjjrktmuwqcibagx.supabase.co/functions/v1/analyze-purchase', {
        method: 'POST',
        headers: { Authorization: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhydGFxampya3RtdXdxY2liYWd4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ2NzY4NDQsImV4cCI6MjEwMDI1Mjg0NH0.Q1wJS8m7EwBG2MaFXqO50cbg2QeMCeo27tggsFPg4aU', apikey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhydGFxampya3RtdXdxY2liYWd4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ2NzY4NDQsImV4cCI6MjEwMDI1Mjg0NH0.Q1wJS8m7EwBG2MaFXqO50cbg2QeMCeo27tggsFPg4aU' },
        body: formData,
      })
      if (!response.ok) {
        const errBody = await response.text()
        throw new Error(`HTTP ${response.status}: ${errBody.slice(0, 300)}`)
      }
      const result = await response.json()
      setFacturaData({
        proveedor: result.proveedor || '',
        fecha: result.fecha || '',
        items: (result.items || []).map(it => {
          const nombre = it.nombre || ''
          const m = buscarPlantaParecida(nombre, plants)
          return {
            nombre,
            cantidad: it.cantidad != null ? String(it.cantidad) : '1',
            precio_unitario: it.precio_unitario != null ? String(it.precio_unitario) : '0',
            plant_id: m.exacta ? m.exacta.id : '', // '' = planta nueva; con id = se vincula a la que ya tienes
            manual: false,                          // true cuando tú eliges a mano (ya no se recalcula)
          }
        }),
        envio: result.envio != null ? String(result.envio) : '',
        subtotal: result.subtotal != null ? String(result.subtotal) : '',
        total: result.total != null ? String(result.total) : '',
      })
      setFacturaScanOpen(true)
      setLoteBuilderOpen(false); setLoteStep('header'); setLoteAddMode('choose')
    } catch (err) {
      console.error('Error al escanear factura:', err)
      alert('No se pudo leer la factura automáticamente. Detalle: ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setScanningFactura(false)
    }
  }

  function updateFacturaField(field, value) {
    setFacturaData(prev => ({ ...prev, [field]: value }))
  }

  function updateFacturaItem(index, field, value) {
    setFacturaData(prev => {
      const items = [...prev.items]
      const next = { ...items[index], [field]: value }
      if (field === 'plant_id') next.manual = true
      if (field === 'nombre' && !next.manual) {
        const m = buscarPlantaParecida(value, plants)
        next.plant_id = m.exacta ? m.exacta.id : ''
      }
      items[index] = next
      return { ...prev, items }
    })
  }

  function addFacturaItem() {
    setFacturaData(prev => ({ ...prev, items: [...prev.items, { nombre: '', cantidad: '1', precio_unitario: '0', plant_id: '', manual: false }] }))
  }

  function removeFacturaItem(index) {
    setFacturaData(prev => ({ ...prev, items: prev.items.filter((_, i) => i !== index) }))
  }

  async function saveFacturaCompra() {
    const itemsValidos = facturaData.items.filter(it => it.nombre.trim())
    if (itemsValidos.length === 0) { alert('Agrega al menos un producto con nombre antes de guardar'); return }
    setSavingFactura(true)

    const loteInsert = { nota: 'Registrado por escaneo de factura', proveedor: facturaData.proveedor || null }
    if (facturaData.fecha) loteInsert.created_at = facturaData.fecha
    if (facturaData.envio) loteInsert.envio1 = Number(facturaData.envio) || 0

    const { data: lote, error: loteError } = await supabase.from('compra_lotes').insert(loteInsert).select().single()
    if (loteError) { alert('Error al crear la compra: ' + loteError.message); setSavingFactura(false); return }

    // Cada producto se vincula a la planta que ya existe (la que elegiste o la de mismo nombre) y solo
    // se crea una planta nueva si de verdad no existe. La compra queda enlazada por compras.plant_id.
    const creadasEnFactura = new Map() // nombre normalizado -> planta creada en esta misma factura
    const vinculadas = []
    for (const item of itemsValidos) {
      const nombre = item.nombre.trim()
      const quantity = Number(item.cantidad) || 1
      const unit_cost = Number(item.precio_unitario) || 0
      const key = normalizarNombrePlanta(nombre)

      let planta = item.plant_id ? plants.find(p => p.id === item.plant_id) : null
      if (!planta && !item.manual) planta = buscarPlantaParecida(nombre, plants).exacta
      let reutilizada = false
      if (!planta) { planta = creadasEnFactura.get(key) || null; reutilizada = !!planta }
      let creada = false
      if (!planta) {
        const { data: nueva, error: plantError } = await supabase.from('plants').insert({
          name: nombre, category_id: null, price: 0, stock: 0, image_url: null, active: false, flagged: true,
        }).select().single()
        if (plantError || !nueva) { alert('No se pudo crear la planta "' + nombre + '": ' + (plantError ? plantError.message : '')); continue }
        planta = nueva
        creada = true
        creadasEnFactura.set(key, nueva)
      } else if (!reutilizada) {
        vinculadas.push(planta.name)
      }

      const row = {
        plant_id: planta.id, plant_name: planta.name, ...(creada ? { new_plant_category: null } : {}),
        quantity, unit_cost, sale_price: null, image_url: null, total: quantity * unit_cost,
        proveedor: facturaData.proveedor || null, status: 'pedido', lote_id: lote.id,
        crea_planta: creada, // true = esta compra creó la planta (solo esas se pueden borrar junto con la compra)
      }
      const { error } = await supabase.from('compras').insert(row)
      if (error) {
        alert('Error al guardar "' + item.nombre + '": ' + error.message)
        if (creada) { await supabase.from('plants').delete().eq('id', planta.id); creadasEnFactura.delete(key) }
        continue
      }
    }

    setFacturaScanOpen(false)
    setFacturaData({ proveedor: '', fecha: '', items: [], envio: '', subtotal: '', total: '' })
    setSavingFactura(false)
    loadData()
    if (vinculadas.length > 0) alert('🔗 ' + vinculadas.length + ' producto(s) ya existían y se vincularon a esta compra sin duplicarlos:\n• ' + vinculadas.join('\n• '))
  }
  
  const [decrementos, setDecrementos] = useState([])
  const [decForm, setDecForm] = useState({ plant_id: '', quantity: '', motivo: '', motivo_otro: '', unit_price: '' })
  const [decPlantSearch, setDecPlantSearch] = useState('')
  const [decPlantCategory, setDecPlantCategory] = useState('all')
  const [movMenuOpen, setMovMenuOpen] = useState(false)
  const [savingDec, setSavingDec] = useState(false)

  const [movSearch, setMovSearch] = useState('')
  const [movStatusFilter, setMovStatusFilter] = useState('all')
  const [movTypeFilter, setMovTypeFilter] = useState('all')

  const [ingresosSearch, setIngresosSearch] = useState('')
  const [ingresosMenuOpen, setIngresosMenuOpen] = useState(false)
  const [editingLoteId, setEditingLoteId] = useState(null)
  const [editingVentaLoteId, setEditingVentaLoteId] = useState(null)
  const [ingresosDate, setIngresosDate] = useState('')
  const [ingresosCategoria, setIngresosCategoria] = useState('all')
  const [ingresosStatus, setIngresosStatus] = useState('all')
  const [ingresosSubTab, setIngresosSubTab] = useState('compras')

  const [seedBatches, setSeedBatches] = useState([])
  const [seedBatchEvents, setSeedBatchEvents] = useState([])
  const [sbFormOpen, setSbFormOpen] = useState(false)
  const [sbForm, setSbForm] = useState({
    origen: 'cosecha', plant_id: '', category_id: '', nombre: '', es_noid: false,
    proveedor: '', cantidad_semillas: '', fecha: '', price: '',
  })
  const [sbFormFile, setSbFormFile] = useState(null)
  const [replanteoForm, setReplanteoForm] = useState(null) // { batchId, fecha, texto, file }
  const [savingReplanteo, setSavingReplanteo] = useState(false)
  const [sbConvertId, setSbConvertId] = useState(null)
  const [editingSeedBatchId, setEditingSeedBatchId] = useState(null)
  const [sbConvertForm, setSbConvertForm] = useState({ nombre: '', category_id: '', price: '', stock: '' })
  const [sbNoteModalOpen, setSbNoteModalOpen] = useState(false)
  const [currentNoteSeedBatchId, setCurrentNoteSeedBatchId] = useState(null)
  const [sbNoteBlocks, setSbNoteBlocks] = useState([])
  const [sbNoteEditIndex, setSbNoteEditIndex] = useState(null)
  const [sbNoteEditText, setSbNoteEditText] = useState('')
  const [sbNoteCurrentText, setSbNoteCurrentText] = useState('')
  const [savingSbNote, setSavingSbNote] = useState(false)

  const [plants, setPlants] = useState([])
  const [categories, setCategories] = useState([])
  const [loading, setLoading] = useState(true)

  // Detección automática de color SOLO para plantas nuevas (pocas sin color). Si hay muchas
  // pendientes, se espera a que toques "Detectar colores" en Filtros (así no descarga cientos de fotos sin avisar).
  useEffect(() => {
    if (!authed || loading || colorRunning.current) return
    const pending = plants.filter(p => p.image_url && !p.color && !p.color_manual && !colorTried.current.has(p.id))
    if (pending.length > 0 && pending.length <= 5) runColorDetection(pending, true)
  }, [plants, authed, loading])

  // Botones flotantes (☰ y ⬆): aparecen al bajar en la página.
  const [showFloatNav, setShowFloatNav] = useState(false)
  useEffect(() => {
    function onScroll() { setShowFloatNav((window.scrollY || document.documentElement.scrollTop || 0) > 200) }
    window.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // La barra fija de la Galería (position: sticky) deja de funcionar si CUALQUIER contenedor padre tiene
  // overflow hidden/auto (por ejemplo, desde App.css). Aquí buscamos esos padres y les quitamos el overflow
  // mientras la Galería está abierta; al salir se restauran tal como estaban.
  useEffect(() => {
    if (view !== 'galeria' || loading) return
    const bar = document.getElementById('gallery-sticky-bar')
    if (!bar) return
    const changed = []
    let el = bar.parentElement
    while (el && el !== document.documentElement) {
      const cs = window.getComputedStyle(el)
      const clipsX = cs.overflowX === 'hidden' || cs.overflowX === 'auto' || cs.overflowX === 'scroll'
      const clipsY = cs.overflowY === 'hidden' || cs.overflowY === 'auto' || cs.overflowY === 'scroll'
      const realScroller = (cs.overflowY === 'auto' || cs.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 1
      if ((clipsX || clipsY) && !realScroller) {
        changed.push([el, el.style.overflowX, el.style.overflowY])
        el.style.overflowX = 'clip'
        el.style.overflowY = 'visible'
      }
      el = el.parentElement
    }
    return () => { changed.forEach(([node, x, y]) => { node.style.overflowX = x; node.style.overflowY = y }) }
  }, [view, loading])
  // true una vez que ya cargamos datos al menos una vez (para no ocultar las vistas en las recargas siguientes)
  const hasLoadedOnce = useRef(false)

  const [plantNotes, setPlantNotes] = useState([])
  const [floraciones, setFloraciones] = useState([])
  const [pups, setPups] = useState([])
  const [showCustomFloracionDate, setShowCustomFloracionDate] = useState(false)
  const [customFloracionDate, setCustomFloracionDate] = useState('')
  const [showCustomPupDate, setShowCustomPupDate] = useState(false)
  const [customPupDate, setCustomPupDate] = useState('')
  const [newPupCantidad, setNewPupCantidad] = useState('')
  const [showMoverPupsForm, setShowMoverPupsForm] = useState(false)
  const [moverPupsCantidad, setMoverPupsCantidad] = useState('')
  const [backupInProgress, setBackupInProgress] = useState(false)
  const [homeMenuOpen, setHomeMenuOpen] = useState(false)
  const [backupProgress, setBackupProgress] = useState('')
  const [showRetroCompraForm, setShowRetroCompraForm] = useState(false)
  const [retroCompraForm, setRetroCompraForm] = useState({ proveedor: '', fecha: '', quantity: '', unit_cost: '' })
  const [loteNoteModalOpen, setLoteNoteModalOpen] = useState(false)
  const [currentNoteLoteId, setCurrentNoteLoteId] = useState(null)
  const [loteNoteBlocks, setLoteNoteBlocks] = useState([])
  const [loteNoteCurrentText, setLoteNoteCurrentText] = useState('')
  const [categoryNotes, setCategoryNotes] = useState([])
  const [noteFilterCategory, setNoteFilterCategory] = useState('all')
  const [globalNoteSearch, setGlobalNoteSearch] = useState('')
  const [expandedCategoryGroups, setExpandedCategoryGroups] = useState(new Set())

  function toggleCategoryGroupExpanded(id) {
    setExpandedCategoryGroups(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const [categoryNoteModalOpen, setCategoryNoteModalOpen] = useState(false)
  const [categoryNoteEditIndex, setCategoryNoteEditIndex] = useState(null)
  const [categoryNoteEditText, setCategoryNoteEditText] = useState('')
  const [editingCategoryNoteId, setEditingCategoryNoteId] = useState(null)
  const [categoryNoteCategoryId, setCategoryNoteCategoryId] = useState('')
  const [categoryNoteBlocks, setCategoryNoteBlocks] = useState([])
  const [categoryNoteCurrentText, setCategoryNoteCurrentText] = useState('')
  const [savingCategoryNote, setSavingCategoryNote] = useState(false)
  const [savingLoteNote, setSavingLoteNote] = useState(false)
  const [plantNoteModalOpen, setPlantNoteModalOpen] = useState(false)
  const [currentNotePlantId, setCurrentNotePlantId] = useState(null)
  const [editingPlantNoteId, setEditingPlantNoteId] = useState(null)
  const [plantNoteBlocks, setPlantNoteBlocks] = useState([])
  const [plantNoteCurrentText, setPlantNoteCurrentText] = useState('')
  const [plantNoteEditIndex, setPlantNoteEditIndex] = useState(null)
  const [plantNoteEditText, setPlantNoteEditText] = useState('')
  const [savingPlantNote, setSavingPlantNote] = useState(false)
  const [isDictatingPlantNote, setIsDictatingPlantNote] = useState(false)
  const plantNoteRecognitionRef = useRef(null)
  const plantNoteWantDictationRef = useRef(false) // para reiniciar solo si la persona no lo detuvo a propósito
  const [isDictatingCategoryNote, setIsDictatingCategoryNote] = useState(false)
  const categoryNoteRecognitionRef = useRef(null)
  const categoryNoteWantDictationRef = useRef(false)

  const [newCatName, setNewCatName] = useState('')
  const [newCatParentId, setNewCatParentId] = useState('')
  const [newCatEmoji, setNewCatEmoji] = useState('🌿')
  const [pendingCount, setPendingCount] = useState(0)
  const [syncing, setSyncing] = useState(false)

  // El botón Atrás del celular cierra la pantalla/modal abierto en vez de salir de la app.
  // Si hay varias cosas abiertas a la vez, cierra primero la de más arriba (la última abierta).
  useBackableModal(view !== 'galeria', () => setView('galeria'))
  useBackableModal(loteBuilderOpen, () => { setLoteBuilderOpen(false); setLoteLines([]); setLoteNota(''); setLoteProveedor(''); setLoteStep('header'); setLoteAddMode('choose') })
  useBackableModal(!!activeSelector, () => setActiveSelector(null))
  useBackableModal(galleryFiltersOpen, () => setGalleryFiltersOpen(false))
  useBackableModal(shareModalOpen, () => setShareModalOpen(false))
  useBackableModal(!!bulkCategoryPickerFor, () => { setBulkCategoryPickerFor(null); setBulkCategorySearch('') })
  useBackableModal(labelQtyModalOpen, () => closeLabelModal())
  useBackableModal(categoryNoteModalOpen, () => setCategoryNoteModalOpen(false))
  useBackableModal(globalSearchOpen, () => setGlobalSearchOpen(false))
  useEffect(() => {
    if (!highlightPlantId || view !== 'galeria' || loading) return
    const t1 = setTimeout(() => {
      const el = document.querySelector(`[data-plant-id="${highlightPlantId}"]`)
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 250)
    const t2 = setTimeout(() => setHighlightPlantId(null), 5000)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [highlightPlantId, view, loading])
  useBackableModal(storeModalOpen, () => setStoreModalOpen(false))
  useBackableModal(intFormOpen, () => setIntFormOpen(false))
  useBackableModal(!!intPicker, () => setIntPicker(null))
  // Al salir de Ventas, el formulario de "Nueva venta" se cierra (y se limpia): al volver, solo se abre si tocas el botón
  useEffect(() => {
    if (view !== 'pedidos') { setVentaLoteBuilderOpen(false); setVentaLoteLines([]); setVentaLoteCliente('') }
  }, [view])
  useBackableModal(carouselModalOpen, () => { setCarouselModalOpen(false); setCarouselPickFor(null) })
  useEffect(() => { loadLastLabelsPDF().then(v => { if (v) setLastLabelsPdf(v) }).catch(() => {}) }, [])
  // La tienda y el link compartido ahora son lo mismo: una sola vez se ofrece poner en la tienda lo que solo estaba en el link
  useEffect(() => {
    if (!plants.length) return
    try {
      if (localStorage.getItem('diamantev_tienda_unificada')) return
      localStorage.setItem('diamantev_tienda_unificada', '1')
    } catch (e) { return }
    const pendientes = plants.filter(x => x.shared_visible && !x.marcado_cliente)
    if (pendientes.length === 0) return
    if (confirm(`Ahora la tienda y el link compartido son lo mismo.\n\nHay ${pendientes.length} planta(s) que solo estaban en el link. ¿Ponerlas también en la tienda?`)) {
      markSelectedCliente(new Set(pendientes.map(x => x.id)), true)
    }
  }, [plants])
  // Las plantas cargadas en Etiquetas (y sus cantidades) se guardan solas en este navegador
  useEffect(() => {
    try {
      if (modeSets.etiquetas.size === 0) localStorage.removeItem(LABELS_DRAFT_KEY)
      else localStorage.setItem(LABELS_DRAFT_KEY, JSON.stringify({ ids: Array.from(modeSets.etiquetas), idQty: labelQuantities, nameQty: labelNameQuantities, tempNums: labelTemp.nums, tempNext: labelTemp.next, savedAt: new Date().toISOString() }))
    } catch (e) { /* nada */ }
  }, [modeSets.etiquetas, labelQuantities, labelNameQuantities, labelTemp])
  // Cada planta nueva en la lista de Etiquetas recibe el siguiente número; con la lista vacía se reinicia en 1
  useEffect(() => {
    const ids = Array.from(modeSets.etiquetas)
    setLabelTemp(prev => {
      if (ids.length === 0) return (Object.keys(prev.nums).length === 0 && prev.next === 1) ? prev : { nums: {}, next: 1 }
      const faltan = ids.filter(id => !prev.nums[id])
      if (faltan.length === 0) return prev
      const nums = { ...prev.nums }
      let next = prev.next
      faltan.forEach(id => { nums[id] = next++ })
      return { nums, next }
    })
  }, [modeSets.etiquetas])
  // Tienda, Fotos y Carrusel también recuerdan su última selección (para ir sumando o quitando)
  useEffect(() => {
    try {
      localStorage.setItem(SELECCIONES_KEY, JSON.stringify({ tienda: Array.from(modeSets.tienda), fotos: Array.from(modeSets.fotos), carrusel: Array.from(modeSets.carrusel) }))
    } catch (e) { /* nada */ }
  }, [modeSets.tienda, modeSets.fotos, modeSets.carrusel])
  // Una sola vez: la selección del Carrusel arranca con las plantas que ya están en el carrusel de la tienda
  useEffect(() => {
    if (!plants.length) return
    try {
      if (localStorage.getItem('diamantev_carrusel_precargado')) return
      localStorage.setItem('diamantev_carrusel_precargado', '1')
    } catch (e) { return }
    setModeSets(prev => (prev.carrusel.size ? prev : { ...prev, carrusel: new Set(plants.filter(x => x.coming_soon).map(x => x.id)) }))
  }, [plants])
  // Si una planta guardada ya no existe, sale de la selección
  useEffect(() => {
    if (!plants.length) return
    const validos = new Set(plants.map(x => x.id))
    setModeSets(prev => {
      let changed = false
      const out = {}
      Object.keys(prev).forEach(k => {
        const next = new Set(Array.from(prev[k]).filter(id => isSeedId(id) || validos.has(id)))
        if (next.size !== prev[k].size) { changed = true; out[k] = next } else out[k] = prev[k]
      })
      return changed ? out : prev
    })
  }, [plants])
  useBackableModal(!!photoModalPlantId, () => { setPhotoModalPlantId(null); setPhotoModalMenuOpen(false); setPhotoModalSection('fotos') })
  useBackableModal(plantNoteModalOpen, () => { setPlantNoteModalOpen(false); setEditingPlantNoteId(null) })
  useBackableModal(loteNoteModalOpen, () => setLoteNoteModalOpen(false))
  useBackableModal(sbNoteModalOpen, () => setSbNoteModalOpen(false))
  useBackableModal(facturaScanOpen, () => setFacturaScanOpen(false))
  useBackableModal(homeMenuOpen, () => setHomeMenuOpen(false))

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setAuthed(!!data.session)
      setCheckingSession(false)
    })
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      setAuthed(!!session)
      if (event === 'PASSWORD_RECOVERY') setRecoveryMode(true)
    })
    return () => listener.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (authed) loadData()
    else hasLoadedOnce.current = false // al cerrar sesión, la próxima carga vuelve a ser "inicial"
  }, [authed])

  // Al abrir el modal de una planta (desde Galería, Tabla o Notas) se leen de la base de datos
  // sus datos de compra e inventario. Si no hay conexión, se usa lo que ya está cargado en memoria.
  useEffect(() => {
    if (!photoModalPlantId) {
      setPlantInv(null); setPlantInvDraft(null); setPlantInvBase(null); setPlantInvMsg('')
      return
    }
    let cancelled = false
    const plantId = photoModalPlantId
    ;(async () => {
      let plantRow = null, cs = null, ls = null
      try {
        const r1 = await supabase.from('plants').select('id, category_id, stock, stock_disponible, label_printed_count, label_placed_count').eq('id', plantId).single()
        const r2 = await supabase.from('compras').select('*').eq('plant_id', plantId).order('created_at', { ascending: false })
        if (!r1.error && !r2.error) {
          plantRow = r1.data
          cs = r2.data || []
          const loteIds = [...new Set(cs.map(c => c.lote_id).filter(Boolean))]
          if (loteIds.length === 0) ls = []
          else {
            const r3 = await supabase.from('compra_lotes').select('*').in('id', loteIds)
            if (!r3.error) ls = r3.data || []
          }
        }
      } catch (e) { /* sin conexión: se usan los datos en memoria */ }
      if (cancelled) return
      if (!plantRow || !cs || !ls) {
        plantRow = plants.find(pl => pl.id === plantId) || null
        cs = compras.filter(c => c.plant_id === plantId).sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
        ls = lotes.filter(l => cs.some(c => c.lote_id === l.id))
      }
      const draft = {
        plantId,
        categoryId: plantRow?.category_id || '',
        stock: String(plantRow?.stock ?? 0),
        stockDisponible: String(plantRow?.stock_disponible ?? plantRow?.stock ?? 0),
        printed: String(plantRow?.label_printed_count || 0),
        placed: String(plantRow?.label_placed_count || 0),
        ...invCompraFields(cs, ls, cs[0]?.id),
      }
      setPlantInv({ plantId, compras: cs, lotes: ls })
      setPlantInvDraft(draft)
      setPlantInvBase(draft)
      setPlantInvMsg('')
    })()
    return () => { cancelled = true }
  }, [photoModalPlantId])

  useEffect(() => {
    if (!plantNoteModalOpen && plantNoteRecognitionRef.current) {
      plantNoteWantDictationRef.current = false
      plantNoteRecognitionRef.current.stop()
    }
    if (!categoryNoteModalOpen && categoryNoteRecognitionRef.current) {
      categoryNoteWantDictationRef.current = false
      categoryNoteRecognitionRef.current.stop()
    }
  }, [plantNoteModalOpen])

  useEffect(() => {
    queueLength().then(setPendingCount)
    function handleOnline() { syncOfflineQueue() }
    window.addEventListener('online', handleOnline)
    if (isOnline()) syncOfflineQueue()
    return () => window.removeEventListener('online', handleOnline)
  }, [authed])

  async function syncOfflineQueue() {
    if (!isOnline()) return
    const len = await queueLength()
    if (len === 0) return
    setSyncing(true)
    await processQueue({
      decremento: async (payload) => {
        await supabase.from('decrementos').insert(payload.decremento)
        if (payload.plantId) {
          const { data: current } = await supabase.from('plants').select('stock').eq('id', payload.plantId).single()
          if (current) {
            await supabase.from('plants').update({ stock: Math.max(0, current.stock - payload.quantity) }).eq('id', payload.plantId)
          }
        }
      },
      compra_lote_group: async (payload) => {
        const { data: lote, error: loteError } = await supabase
          .from('compra_lotes').insert({ nota: payload.nota, proveedor: payload.proveedor }).select().single()
        if (loteError) throw loteError
        for (const line0 of payload.lines) {
          // Si la línea "nueva" ya existe en el catálogo, se vincula a esa planta en vez de duplicarla
          const yaExiste = (!line0.plant_id && line0.new_plant_name) ? buscarPlantaParecida(line0.new_plant_name, plants).exacta : null
          const line = yaExiste ? { ...line0, plant_id: yaExiste.id, plant_name: yaExiste.name } : line0
          const usingNew = !line.plant_id && line.new_plant_name
          const quantity = Number(line.quantity)
          const unit_cost = Number(line.unit_cost)
          const sale_price = line.sale_price ? Number(line.sale_price) : null
          let image_url = null
          if (line.file) image_url = await uploadImage(line.file)
          const row = usingNew
            ? { plant_id: null, plant_name: line.plant_name, new_plant_category: line.new_plant_category, quantity, unit_cost, sale_price, image_url, total: quantity * unit_cost, proveedor: payload.proveedor, status: 'pedido', lote_id: lote.id }
            : { plant_id: line.plant_id, plant_name: line.plant_name, quantity, unit_cost, sale_price, image_url, total: quantity * unit_cost, proveedor: payload.proveedor, status: 'pedido', lote_id: lote.id }
          const { data: insertedCompra, error } = await supabase.from('compras').insert(row).select().single()
          if (error) throw error
          if (usingNew) {
            const { data: newPlant } = await supabase.from('plants').insert({
              name: line.plant_name,
              category_id: line.new_plant_category || null,
              price: sale_price || 0,
              stock: 0,
              image_url: image_url || null,
              active: false,
              flagged: !line.new_plant_category,
            }).select().single()
            if (newPlant) await supabase.from('compras').update({ plant_id: newPlant.id, crea_planta: true }).eq('id', insertedCompra.id)
          }
        }
      },
      compra_add_line: async (payload) => {
        const usingNew = !payload.plant_id && payload.new_plant_name
        let image_url = null
        if (payload.file) image_url = await uploadImage(payload.file)
        const row = usingNew
          ? { plant_id: null, plant_name: payload.new_plant_name, new_plant_category: payload.new_plant_category, quantity: payload.quantity, unit_cost: payload.unit_cost, sale_price: payload.sale_price, image_url, total: payload.quantity * payload.unit_cost, proveedor: payload.proveedor, status: payload.status, lote_id: payload.loteId }
          : { plant_id: payload.plant_id, plant_name: payload.plant_name, quantity: payload.quantity, unit_cost: payload.unit_cost, sale_price: payload.sale_price, image_url, total: payload.quantity * payload.unit_cost, proveedor: payload.proveedor, status: payload.status, lote_id: payload.loteId }
        if (payload.status === 'pagado' || payload.status === 'recibido') row.fecha_pago = new Date().toISOString()
        if (payload.status === 'recibido') row.fecha_recibido = new Date().toISOString()
        const { data: insertedCompra, error } = await supabase.from('compras').insert(row).select().single()
        if (error) throw error
        if (payload.status === 'recibido' && !usingNew && payload.plant_id) {
          const { data: current } = await supabase.from('plants').select('stock').eq('id', payload.plant_id).single()
          if (current) {
            const updates = { stock: current.stock + payload.quantity }
            if (image_url) updates.image_url = image_url
            await supabase.from('plants').update(updates).eq('id', payload.plant_id)
          }
        } else if (usingNew) {
          const { data: newPlant } = await supabase.from('plants').insert({
            name: payload.new_plant_name,
            category_id: payload.new_plant_category,
            price: payload.sale_price || 0,
            stock: payload.status === 'recibido' ? payload.quantity : 0,
            image_url: image_url || null,
            active: false,
          }).select().single()
          if (newPlant) await supabase.from('compras').update({ plant_id: newPlant.id, crea_planta: true }).eq('id', insertedCompra.id)
        }
      },
      lote_note: async (payload) => {
        const finalBlocks = []
        for (const b of payload.blocks) {
          if (b.type === 'text') finalBlocks.push(b)
          else if (b.url) finalBlocks.push(b)
          else {
            const url = await uploadImage(b.file, 'category-notes')
            if (url) finalBlocks.push({ type: b.type, url })
          }
        }
        const { error } = await supabase.from('compra_lotes').update({ content_blocks: finalBlocks }).eq('id', payload.loteId)
        if (error) throw error
      },
      plant_note: async (payload) => {
        const finalBlocks = []
        for (const b of payload.blocks) {
          if (b.type === 'text') finalBlocks.push(b)
          else if (b.url) finalBlocks.push(b)
          else {
            const url = await uploadImage(b.file, 'category-notes')
            if (url) finalBlocks.push({ type: b.type, url })
          }
        }
        const { error } = payload.editingNoteId
          ? await supabase.from('plant_notes').update({ content_blocks: finalBlocks }).eq('id', payload.editingNoteId)
          : await supabase.from('plant_notes').insert({ plant_id: payload.plantId, content_blocks: finalBlocks })
        if (error) throw error
      },
    })
    setPendingCount(await queueLength())
    setSyncing(false)
    loadData()
  }

  async function loadData() {
    // Solo la PRIMERA carga muestra "Cargando..." y oculta las vistas. Las recargas siguientes
    // (que se llaman después de casi cualquier acción) se hacen en segundo plano: así la pantalla
    // no se desmonta, no se pierde el scroll ni la pestaña/sección en la que estabas.
    if (!hasLoadedOnce.current) setLoading(true)
    const { data: cats } = await supabase.from('categories').select('*').order('name')
    const { data: pls } = await supabase.from('plants').select('*').order('name')
    const { data: ords } = await supabase.from('orders').select('*, order_items(*)').order('id', { ascending: false })
    const { data: comps } = await supabase.from('compras').select('*').order('created_at', { ascending: false })
    const { data: lts } = await supabase.from('compra_lotes').select('*').order('numero', { ascending: false })
    const { data: vlts } = await supabase.from('venta_lotes').select('*').order('created_at', { ascending: false })
    const { data: decs } = await supabase.from('decrementos').select('*').order('created_at', { ascending: false })
    const { data: pnts } = await supabase.from('plant_notes').select('*').order('created_at', { ascending: false })
    const { data: flrs } = await supabase.from('floraciones').select('*').order('fecha', { ascending: false })
    const { data: pps } = await supabase.from('plant_pups').select('*').order('fecha', { ascending: false })
    setCategories(cats || [])
    setPlants(pls || [])
    setOrders(ords || [])
    setCompras(comps || [])
    setLotes(lts || [])
    setVentaLotes(vlts || [])
    setDecrementos(decs || [])
    setPlantNotes(pnts || [])
    setFloraciones(flrs || [])
    setPups(pps || [])
    const { data: sbs } = await supabase.from('seed_batches').select('*').order('fecha', { ascending: false })
    const { data: sbevs } = await supabase.from('seed_batch_events').select('*').order('fecha', { ascending: false })
    const { data: catNotes } = await supabase.from('category_notes').select('*').order('updated_at', { ascending: false })
    setSeedBatches(sbs || [])
    setSeedBatchEvents(sbevs || [])
    setCategoryNotes(catNotes || [])
    try {
      const { data: ints, error: eInt } = await supabase.from('intercambios').select('*').order('id', { ascending: false })
      const { data: iits, error: eIit } = await supabase.from('intercambio_items').select('*').order('id')
      if (eInt || eIit) { setIntercambiosOk(false); setIntercambios([]); setIntercambioItems([]) }
      else { setIntercambiosOk(true); setIntercambios(ints || []); setIntercambioItems(iits || []) }
    } catch (e) { setIntercambiosOk(false) }
    hasLoadedOnce.current = true
    setLoading(false)
  }

  async function handleLogin(e) {
    e.preventDefault()
    setLoggingIn(true)
    setFailed(false)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      setFailed(true)
    }
    setLoggingIn(false)
  }

  async function handleForgotPassword(e) {
    e.preventDefault()
    if (!resetEmail.trim()) return
    setSendingReset(true)
    const { error } = await supabase.auth.resetPasswordForEmail(resetEmail, {
      redirectTo: window.location.origin + window.location.pathname,
    })
    setSendingReset(false)
    if (error) {
      alert('Error al enviar el correo: ' + error.message)
      return
    }
    setResetSent(true)
  }

  async function handleUpdatePassword(e) {
    e.preventDefault()
    if (!newPassword.trim()) return
    setUpdatingPassword(true)
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    setUpdatingPassword(false)
    if (error) {
      alert('Error al actualizar la contraseña: ' + error.message)
      return
    }
    setNewPassword('')
    setRecoveryMode(false)
    alert('Contraseña actualizada. Ya puedes usarla la próxima vez que entres.')
  }

  async function handleLogout() {
    await supabase.auth.signOut()
  }

  async function uploadImage(file, bucket = 'plant-photos') {
    const ext = file.name.split('.').pop()
    const fileName = `${Date.now()}.${ext}`
    const { error } = await supabaseStorage.storage.from(bucket).upload(fileName, file)
    if (error) { alert('Error al subir el archivo: ' + error.message); return null }
    const { data } = supabaseStorage.storage.from(bucket).getPublicUrl(fileName)
    return data.publicUrl
  }


  // ---------- Ingresos (compras agrupadas en lotes) ----------
  // Carga masiva dentro de "Nueva compra": cada foto se agrega directo a la lista de
  // productos (como una línea "planta nueva" más), sin subirla todavía — recién se sube
  // al tocar "Guardar compra", igual que el resto de las líneas.
  function addBulkPhotosToLoteBuilder(fileList) {
    const files = Array.from(fileList || [])
    if (files.length === 0) return
    const startIndex = loteLines.length
    const newEntries = files.map((file, i) => {
      const baseName = file.name.replace(/\.[^/.]+$/, '').replace(/[_-]+/g, ' ').trim()
      const name = baseName || `Planta sin nombre ${startIndex + i + 1}`
      return {
        plant_id: '',
        new_plant_name: name,
        new_plant_category: bulkChosenCategoryId || null,
        plant_name: name,
        quantity: '1',
        unit_cost: '0',
        sale_price: '',
        file,
      }
    })
    setLoteLines(prev => [...prev, ...newEntries])
  }

  function addLineToLote(e) {
    e.preventDefault()
    const usingNew = !lineForm.plant_id && lineForm.new_plant_name
    if ((!lineForm.plant_id && !usingNew) || !lineForm.quantity) {
      alert('Selecciona una planta o escribe el nombre de una nueva, y completa la cantidad')
      return false
    }
    if (usingNew && !lineForm.new_plant_category) {
      alert('Selecciona una categoría para la planta nueva')
      return false
    }
    if (usingNew) {
      const { exacta, parecidas } = buscarPlantaParecida(lineForm.new_plant_name, plants)
      if (exacta) {
        alert(`Ya existe una planta llamada "${exacta.name}". Selecciónala de la lista "Selecciona planta existente" en vez de escribirla como nueva, para no duplicarla.`)
        return false
      }
      if (parecidas.length > 0 && !confirm(`Hay plantas parecidas en tu catálogo:\n• ${parecidas.map(p => p.name).join('\n• ')}\n\n¿Aun así es una planta NUEVA?\n(Cancelar = volver y elegir la que ya existe)`)) {
        return false
      }
    }
    const plant = lineForm.plant_id ? plants.find(p => p.id === lineForm.plant_id) : null
    setLoteLines(prev => [...prev, { ...lineForm, plant_name: usingNew ? lineForm.new_plant_name : (plant ? plant.name : '') }])
    setLineForm({ plant_id: '', new_plant_name: '', new_plant_category: '', quantity: '', unit_cost: '', sale_price: '', file: null })
    return true
  }

  function removeLoteLine(index) {
    setLoteLines(prev => prev.filter((_, i) => i !== index))
  }

  async function saveLote() {
    if (loteLines.length === 0) { alert('Agrega al menos una planta a la compra'); return }
    setSavingLote(true)

    if (!isOnline()) {
      await addToQueue('compra_lote_group', { nota: loteNota, proveedor: loteProveedor, lines: loteLines })
      setLoteNota('')
      setLoteProveedor('')
      setLoteLines([])
      setLoteBuilderOpen(false)
      setSavingLote(false)
      setPendingCount(await queueLength())
      alert('Sin conexión: la compra se guardó en el celular y se subirá sola cuando vuelva la señal.')
      return
    }

    const { data: lote, error: loteError } = await supabase
      .from('compra_lotes').insert({ nota: loteNota, proveedor: loteProveedor }).select().single()
    if (loteError) { alert('Error al crear la compra: ' + loteError.message); setSavingLote(false); return }

    // Si una línea "nueva" (por ejemplo, una foto cargada en masa) coincide con una planta que ya existe,
    // se vincula a esa planta en vez de duplicarla. Solo se crea una planta cuando de verdad es nueva.
    const creadasEnCompra = new Map()
    const vinculadas = []
    for (const line of loteLines) {
      const quantity = Number(line.quantity)
      const unit_cost = Number(line.unit_cost)
      const sale_price = line.sale_price ? Number(line.sale_price) : null
      let image_url = null
      if (line.file) image_url = await uploadImage(line.file)

      let plantId = line.plant_id || null
      let plantName = line.plant_name
      let creada = false
      const key = normalizarNombrePlanta(line.new_plant_name)
      if (!plantId && line.new_plant_name) {
        const ya = buscarPlantaParecida(line.new_plant_name, plants).exacta
        const reuse = ya || creadasEnCompra.get(key)
        if (reuse) {
          plantId = reuse.id
          plantName = reuse.name
          if (ya) vinculadas.push(ya.name)
        } else {
          const { data: newPlant, error: plantError } = await supabase.from('plants').insert({
            name: line.plant_name,
            category_id: line.new_plant_category || null,
            price: sale_price || 0,
            stock: 0,
            image_url: image_url || null,
            active: false,
            flagged: !line.new_plant_category,
          }).select().single()
          if (plantError || !newPlant) { alert('No se pudo crear la planta "' + line.plant_name + '": ' + (plantError ? plantError.message : '')); continue }
          plantId = newPlant.id
          creada = true
          creadasEnCompra.set(key, newPlant)
        }
      }

      const row = {
        plant_id: plantId, plant_name: plantName, ...(creada ? { new_plant_category: line.new_plant_category } : {}),
        quantity, unit_cost, sale_price, image_url, total: quantity * unit_cost,
        proveedor: loteProveedor, status: 'pedido', lote_id: lote.id,
        crea_planta: creada, // true = esta compra creó la planta
      }
      const { error } = await supabase.from('compras').insert(row)
      if (error) {
        alert('Error al guardar una de las plantas: ' + error.message)
        if (creada) { await supabase.from('plants').delete().eq('id', plantId); creadasEnCompra.delete(key) }
        continue
      }
    }
    setLoteNota('')
    setLoteProveedor('')
    setLoteLines([])
    setLoteBuilderOpen(false)
    setSavingLote(false)
    loadData()
    if (vinculadas.length > 0) alert('🔗 ' + vinculadas.length + ' planta(s) ya existían y se vincularon a esta compra sin duplicarlas:\n• ' + vinculadas.join('\n• '))
  }

  async function saveAddToLote(lote) {
    const usingNew = !addToLoteForm.plant_id && addToLoteForm.new_plant_name
    if ((!addToLoteForm.plant_id && !usingNew) || !addToLoteForm.quantity) {
      alert('Selecciona una planta o escribe el nombre de una nueva, y completa la cantidad')
      return
    }
    if (usingNew && !addToLoteForm.new_plant_category) {
      alert('Selecciona una categoría para la planta nueva')
      return
    }
    if (usingNew) {
      const { exacta, parecidas } = buscarPlantaParecida(addToLoteForm.new_plant_name, plants)
      if (exacta) {
        alert(`Ya existe una planta llamada "${exacta.name}". Selecciónala de la lista de plantas existentes en vez de escribirla como nueva, para no duplicarla.`)
        return
      }
      if (parecidas.length > 0 && !confirm(`Hay plantas parecidas en tu catálogo:\n• ${parecidas.map(p => p.name).join('\n• ')}\n\n¿Aun así es una planta NUEVA?\n(Cancelar = volver y elegir la que ya existe)`)) {
        return
      }
    }
    setSavingAddToLote(true)
    const plant = addToLoteForm.plant_id ? plants.find(p => p.id === addToLoteForm.plant_id) : null
    const quantity = Number(addToLoteForm.quantity)
    const unit_cost = Number(addToLoteForm.unit_cost) || 0
    const sale_price = addToLoteForm.sale_price ? Number(addToLoteForm.sale_price) : null

    // Toma el mismo estado que ya tienen las demás líneas de esta compra
    const lineasDeEsteLote = compras.filter(c => c.lote_id === lote.id)
    const status = lineasDeEsteLote.some(c => c.status === 'recibido')
      ? 'recibido'
      : lineasDeEsteLote.some(c => c.status === 'pagado')
        ? 'pagado'
        : 'pedido'

    if (!isOnline()) {
      await addToQueue('compra_add_line', {
        plant_id: addToLoteForm.plant_id || null,
        plant_name: plant ? plant.name : '',
        new_plant_name: addToLoteForm.new_plant_name,
        new_plant_category: addToLoteForm.new_plant_category,
        quantity, unit_cost, sale_price,
        file: addToLoteForm.file,
        proveedor: lote.proveedor,
        status,
        loteId: lote.id,
      })
      setAddToLoteForm({ plant_id: '', new_plant_name: '', new_plant_category: '', quantity: '', unit_cost: '', sale_price: '', file: null })
      setAddToLoteId(null)
      setSavingAddToLote(false)
      setPendingCount(await queueLength())
      alert('Sin conexión: se guardó en el celular y se subirá sola cuando vuelva la señal.')
      return
    }

    let image_url = null
    if (addToLoteForm.file) image_url = await uploadImage(addToLoteForm.file)

    const row = usingNew
      ? { plant_id: null, plant_name: addToLoteForm.new_plant_name, new_plant_category: addToLoteForm.new_plant_category, quantity, unit_cost, sale_price, image_url, total: quantity * unit_cost, proveedor: lote.proveedor, status, lote_id: lote.id }
      : { plant_id: addToLoteForm.plant_id, plant_name: plant ? plant.name : '', quantity, unit_cost, sale_price, image_url, total: quantity * unit_cost, proveedor: lote.proveedor, status, lote_id: lote.id }

    if (status === 'pagado' || status === 'recibido') row.fecha_pago = new Date().toISOString()
    if (status === 'recibido') row.fecha_recibido = new Date().toISOString()

    const { data: insertedCompra, error } = await supabase.from('compras').insert(row).select().single()
    if (error) { alert('Error al agregar la planta: ' + error.message); setSavingAddToLote(false); return }

    // La foto se aplica de inmediato si es una planta existente (no afecta el stock)
    if (!usingNew && plant && image_url) {
      await supabase.from('plants').update({ image_url }).eq('id', plant.id)
    }

    if (status === 'recibido' && !usingNew && plant) {
      // Compra de planta existente ya recibida: sumar stock de inmediato
      await supabase.from('plants').update({ stock: plant.stock + quantity }).eq('id', plant.id)
    } else if (usingNew) {
      // Planta nueva: se crea de inmediato en Galería (con stock 0 si aún no llega), y se enlaza a la compra
      const { data: newPlant } = await supabase.from('plants').insert({
        name: addToLoteForm.new_plant_name,
        category_id: addToLoteForm.new_plant_category,
        price: sale_price || 0,
        stock: status === 'recibido' ? quantity : 0,
        image_url: image_url || null,
        active: false,
      }).select().single()
      if (newPlant) await supabase.from('compras').update({ plant_id: newPlant.id, crea_planta: true }).eq('id', insertedCompra.id)
    }

    setAddToLoteForm({ plant_id: '', new_plant_name: '', new_plant_category: '', quantity: '', unit_cost: '', sale_price: '', file: null })
    setAddToLoteId(null)
    setSavingAddToLote(false)
    loadData()
  }

  async function markLotePagado(loteId) {
    if (approvingIds.includes(loteId)) return
    const lineas = compras.filter(c => c.lote_id === loteId && c.status === 'pedido')
    if (lineas.length === 0) return
    setApprovingIds(prev => [...prev, loteId])
    const ids = lineas.map(c => c.id)
    const patch = { status: 'pagado', fecha_pago: new Date().toISOString() }
    const undo = patchLocal(setCompras, compras, ids, patch) // se ve al instante
    const { error } = await supabase.from('compras').update(patch).in('id', ids) // una sola llamada
    if (error) { undo(); alert('No se pudo marcar como pagado: ' + error.message) }
    setApprovingIds(prev => prev.filter(id => id !== loteId))
  }

  async function markLoteRecibido(loteId) {
    if (approvingIds.includes(loteId)) return
    const lineas = compras.filter(c => c.lote_id === loteId && c.status === 'pagado')
    if (lineas.length === 0) return
    setApprovingIds(prev => [...prev, loteId])
    const ids = lineas.map(c => c.id)
    const patch = { status: 'recibido', fecha_recibido: new Date().toISOString() }
    const undo = patchLocal(setCompras, compras, ids, patch) // se ve al instante
    const { error } = await supabase.from('compras').update(patch).in('id', ids) // una sola llamada
    if (error) {
      undo()
      alert('No se pudo marcar como recibido: ' + error.message)
    } else {
      const stockNow = {}
      for (const c of lineas) await applyRecepcionAPlanta(c, stockNow)
    }
    setApprovingIds(prev => prev.filter(id => id !== loteId))
  }

  async function renumberLotesAfterDelete(table, list, deletedNumero) {
    if (deletedNumero == null) return
    const toShift = list.filter(l => l.numero > deletedNumero).sort((a, b) => a.numero - b.numero)
    for (const l of toShift) {
      await supabase.from(table).update({ numero: l.numero - 1 }).eq('id', l.id)
    }
  }

  // ¿La planta tiene algo propio que se perdería si la borramos? (otras compras, ventas, notas, crías,
  // floraciones, intercambios, fotos extra, video o descripción). Ante cualquier duda: se conserva.
  async function plantaTieneHistorial(plantId) {
    const tablas = ['compras', 'decrementos', 'plant_notes', 'plant_pups', 'floraciones', 'intercambio_items']
    for (const t of tablas) {
      const { count, error } = await supabase.from(t).select('*', { count: 'exact', head: true }).eq('plant_id', plantId)
      if (error || (count ?? 0) > 0) return true
    }
    const { data: p } = await supabase.from('plants').select('*').eq('id', plantId).single()
    if (!p) return true
    return !!(p.extra_image_1 || p.extra_image_2 || p.extra_image_3 || p.video_url || String(p.description || '').trim())
  }

  async function deleteLote(loteId) {
    if (!confirm('¿Eliminar esta compra completa? Se borrarán todas las plantas registradas en ella. Esta acción no se puede deshacer.')) return
    const deletedNumero = lotes.find(l => l.id === loteId)?.numero
    const lineas = compras.filter(c => c.lote_id === loteId)
    for (const c of lineas) {
      if (c.status === 'recibido' && c.plant_id) {
        const { data: current } = await supabase.from('plants').select('stock').eq('id', c.plant_id).single()
        if (current) {
          await supabase.from('plants').update({ stock: Math.max(0, current.stock - c.quantity) }).eq('id', c.plant_id)
        }
      }
    }
    // Solo se consideran para borrar las plantas que ESTA compra creó (crea_planta). Las que ya existían
    // antes y solo se vincularon a la compra nunca se borran: conservan sus fotos y notas.
    const plantIds = [...new Set(lineas.filter(c => c.crea_planta && c.plant_id).map(c => c.plant_id))]
    const { error: comprasError } = await supabase.from('compras').delete().eq('lote_id', loteId)
    if (comprasError) {
      alert('Error al borrar las plantas de la compra: ' + comprasError.message)
      return
    }
    const { error: loteError } = await supabase.from('compra_lotes').delete().eq('id', loteId)
    if (loteError) {
      alert('Error al borrar la compra: ' + loteError.message)
      return
    }
    // Se borran solo las plantas creadas por esta compra que no tengan nada más (ya se borraron las
    // líneas de esta compra, así que "otras compras" cuenta las de otras facturas).
    for (const plantId of plantIds) {
      if (await plantaTieneHistorial(plantId)) continue
      await supabase.from('plants').delete().eq('id', plantId)
    }
    await renumberLotesAfterDelete('compra_lotes', lotes, deletedNumero)
    loadData()
  }

  async function cancelVentaLote(loteId) {
    const lote = ventaLotes.find(l => l.id === loteId)
    if (!lote) return
    if (lote.status === 'cancelada') { alert('Esta venta ya está cancelada.'); return }
    const motivo = prompt('¿Por qué se cancela esta venta? (ej. "Cliente no pagó", "Se arrepintió")')
    if (motivo === null) return // el usuario le dio "Cancelar" al prompt, no seguimos
    const lineas = decrementos.filter(d => d.lote_id === loteId)
    for (const d of lineas) {
      if (d.plant_id) {
        const { data: current } = await supabase.from('plants').select('stock').eq('id', d.plant_id).single()
        if (current) {
          await supabase.from('plants').update({ stock: current.stock + d.quantity }).eq('id', d.plant_id)
        }
      }
    }
    const { error } = await supabase
      .from('venta_lotes')
      .update({ status: 'cancelada', motivo_cancelacion: motivo || 'Sin motivo especificado' })
      .eq('id', loteId)
    if (error) {
      alert('Error al cancelar la venta: ' + error.message)
      return
    }
    loadData()
  }

  async function deleteVentaLote(loteId) {
    if (!confirm('¿Eliminar esta venta completa? Se borrarán todas las plantas registradas en ella. Esta acción no se puede deshacer.')) return
    const lote = ventaLotes.find(l => l.id === loteId)
    const deletedNumero = lote?.numero
    const yaCancelada = lote?.status === 'cancelada'
    const lineas = decrementos.filter(d => d.lote_id === loteId)
    if (!yaCancelada) {
      for (const d of lineas) {
        if (d.plant_id) {
          const { data: current } = await supabase.from('plants').select('stock').eq('id', d.plant_id).single()
          if (current) {
            await supabase.from('plants').update({ stock: current.stock + d.quantity }).eq('id', d.plant_id)
          }
        }
      }
    }
    const { error: decError } = await supabase.from('decrementos').delete().eq('lote_id', loteId)
    if (decError) {
      alert('Error al borrar las plantas de la venta: ' + decError.message)
      return
    }
    const { error: loteError } = await supabase.from('venta_lotes').delete().eq('id', loteId)
    if (loteError) {
      alert('Error al borrar la venta: ' + loteError.message)
      return
    }
    await renumberLotesAfterDelete('venta_lotes', ventaLotes, deletedNumero)
    loadData()
  }

  async function updateLoteProveedor(lote, value) {
    const { error } = await supabase.from('compra_lotes').update({ proveedor: value }).eq('id', lote.id)
    if (error) { alert('Error al guardar el cambio: ' + error.message); return }
    // Actualiza también el proveedor de todas las líneas de esta compra, para mantenerlo consistente
    await supabase.from('compras').update({ proveedor: value }).eq('lote_id', lote.id)
    loadData()
  }

  async function updateLoteExtra(lote, field, value) {
    const num = Number(value) || 0
    const { error } = await supabase.from('compra_lotes').update({ [field]: num }).eq('id', lote.id)
    if (error) { alert('Error al guardar el cambio: ' + error.message); return }
    loadData()
  }

  // Color pastel de fondo para la tarjeta de una compra/venta según su estado:
  // si todas las líneas llegaron al último paso (recibido/entregado) -> verde,
  // si alguna ya está pagada (pero no todas recibidas) -> celeste, si no -> amarillo.
  function statusPastelBg(lineas, finalStatus) {
    if (lineas.length === 0) return undefined
    if (lineas.every(l => l.status === finalStatus)) return '#E3F4E1' // verde pastel
    if (lineas.some(l => l.status === 'pagado' || l.status === finalStatus)) return '#DCEBF9' // celeste pastel
    return '#FFF6D8' // amarillo pastel
  }

  // Color de la tarjeta de una VENTA: verde solo si todo está entregado Y cobrado;
  // naranja suave si ya se entregó todo pero falta cobrar (ej. pagos mensuales);
  // celeste si hay algo pagado o entregado; amarillo si todo sigue como pedido.
  function ventaPastelBg(lineas) {
    if (lineas.length === 0) return undefined
    const todoEntregado = lineas.every(l => entregadoDe(l))
    const todoCobrado = lineas.every(l => pagadoDe(l) || !(Number(l.unit_price) > 0))
    if (todoEntregado && todoCobrado) return '#E3F4E1' // verde pastel
    if (todoEntregado) return '#FDE8D4' // naranja pastel: entregado, falta cobrar
    if (lineas.some(l => pagadoDe(l) || entregadoDe(l))) return '#DCEBF9' // celeste pastel
    return '#FFF6D8' // amarillo pastel
  }

  function loteProration(lote, lineas) {
    const subtotal = lineas.reduce((sum, c) => sum + Number(c.unit_cost) * Number(c.quantity), 0)
    const extras = Number(lote.envio1 || 0) + Number(lote.envio2 || 0) + Number(lote.varios || 0)
    const withExtra = lineas.map(c => {
      const value = Number(c.unit_cost) * Number(c.quantity)
      const proportion = subtotal > 0 ? value / subtotal : 0
      const prorated = proportion * extras
      return { ...c, _value: value, _prorated: prorated, _lineTotal: value + prorated }
    })
    return { subtotal, extras, total: subtotal + extras, lineas: withExtra }
  }

  async function updateOrderExtra(order, field, value) {
    const num = Number(value) || 0
    const { error } = await supabase.from('orders').update({ [field]: num }).eq('id', order.id)
    if (error) { alert('Error al guardar el cambio: ' + error.message); return }
    loadData()
  }

  function orderProration(order) {
    const items = (order.order_items || []).map(it => {
      const plant = plants.find(p => p.id === it.plant_id)
      const unitPrice = it.price ?? plant?.price ?? 0
      return { ...it, _plant: plant, _unitPrice: Number(unitPrice) }
    })
    const subtotal = items.reduce((sum, it) => sum + it._unitPrice * Number(it.quantity), 0)
    const extras = Number(order.envio1 || 0) + Number(order.envio2 || 0) + Number(order.varios || 0)
    const withExtra = items.map(it => {
      const value = it._unitPrice * Number(it.quantity)
      const proportion = subtotal > 0 ? value / subtotal : 0
      const prorated = proportion * extras
      return { ...it, _value: value, _prorated: prorated, _lineTotal: value + prorated }
    })
    return { subtotal, extras, total: subtotal + extras, items: withExtra }
  }

  const [compraDrafts, setCompraDrafts] = useState({})
  const [loteDrafts, setLoteDrafts] = useState({})

  function setLineDraft(compraId, field, value) {
    setCompraDrafts(prev => ({ ...prev, [compraId]: { ...prev[compraId], [field]: value } }))
  }

  function setLoteDraftField(loteId, field, value) {
    setLoteDrafts(prev => ({ ...prev, [loteId]: { ...prev[loteId], [field]: value } }))
  }

  // Fecha de HOY (o de una fecha dada) en la zona horaria local, no UTC.
  // new Date().toISOString() siempre convierte a UTC primero, lo que en Ecuador
  // (UTC-5) puede adelantar la fecha un día si es de noche. Esto la corrige.
  function localDateISO(d = new Date()) {
    const date = new Date(d)
    const offsetMs = date.getTimezoneOffset() * 60000
    return new Date(date.getTime() - offsetMs).toISOString().slice(0, 10)
  }

  function dateToInputValue(dateStr) {
    if (!dateStr) return ''
    const d = new Date(dateStr)
    if (isNaN(d)) return ''
    return localDateISO(d)
  }

  async function commitCompraLineDraft(compra, draft) {
    if (!draft) return
    const updates = {}
    if (draft.plant_name !== undefined) updates.plant_name = draft.plant_name
    const quantity = draft.quantity !== undefined ? (Number(draft.quantity) || 0) : Number(compra.quantity)
    const unit_cost = draft.unit_cost !== undefined ? (Number(draft.unit_cost) || 0) : Number(compra.unit_cost)
    if (draft.quantity !== undefined) updates.quantity = quantity
    if (draft.unit_cost !== undefined) updates.unit_cost = unit_cost
    if (draft.quantity !== undefined || draft.unit_cost !== undefined) updates.total = quantity * unit_cost
    if (draft.sale_price !== undefined) updates.sale_price = draft.sale_price === '' ? null : Number(draft.sale_price)
    if (draft.proveedor !== undefined) updates.proveedor = draft.proveedor
    if (Object.keys(updates).length === 0) return
    const { error } = await supabase.from('compras').update(updates).eq('id', compra.id)
    if (error) { alert(`Error al guardar "${draft.plant_name || compra.plant_name}": ${error.message}`); return }
    // Si cambió el nombre de una línea enlazada a una planta, se renombra también la planta
    const newName = (draft.plant_name ?? '').trim()
    if (compra.plant_id && newName && newName !== compraNombre(compra)) await syncPlantName(compra.plant_id, newName)
  }

  async function commitLoteDraft(lote) {
    const draft = loteDrafts[lote.id]
    if (!draft) return
    const updates = {}
    if (draft.proveedor !== undefined) updates.proveedor = draft.proveedor
    if (draft.fecha !== undefined && draft.fecha) updates.created_at = new Date(draft.fecha + 'T12:00:00').toISOString()
    if (draft.envio1 !== undefined) updates.envio1 = Number(draft.envio1) || 0
    if (draft.envio2 !== undefined) updates.envio2 = Number(draft.envio2) || 0
    if (draft.varios !== undefined) updates.varios = Number(draft.varios) || 0
    if (Object.keys(updates).length === 0) return
    const { error } = await supabase.from('compra_lotes').update(updates).eq('id', lote.id)
    if (error) alert('Error al guardar los datos de la compra: ' + error.message)
  }

  async function finishEditingLote(lote, lineas) {
    await commitLoteDraft(lote)
    for (const c of lineas) {
      if (compraDrafts[c.id]) await commitCompraLineDraft(c, compraDrafts[c.id])
    }
    setCompraDrafts(prev => {
      const next = { ...prev }
      lineas.forEach(c => delete next[c.id])
      return next
    })
    setLoteDrafts(prev => {
      const next = { ...prev }
      delete next[lote.id]
      return next
    })
    setEditingLoteId(null)
    await loadData()
  }

  async function updateCompraField(compra, field, rawValue) {
    let updates = {}
    if (field === 'plant_name') {
      updates.plant_name = rawValue
    } else if (field === 'quantity') {
      const quantity = Number(rawValue) || 0
      updates.quantity = quantity
      updates.total = quantity * Number(compra.unit_cost)
    } else if (field === 'unit_cost') {
      const unit_cost = Number(rawValue) || 0
      updates.unit_cost = unit_cost
      updates.total = Number(compra.quantity) * unit_cost
    } else if (field === 'sale_price') {
      updates.sale_price = rawValue === '' ? null : Number(rawValue)
    } else if (field === 'proveedor') {
      updates.proveedor = rawValue
    } else if (field === 'image_url') {
      updates.image_url = rawValue
    }
    const { error } = await supabase.from('compras').update(updates).eq('id', compra.id)
    if (error) { alert('Error al guardar el cambio: ' + error.message); return }
    if (field === 'plant_name') {
      const newName = (rawValue ?? '').trim()
      if (compra.plant_id && newName && newName !== compraNombre(compra)) await syncPlantName(compra.plant_id, newName)
    }
    loadData()
  }

  // Nombre "vivo" de una línea de compra: si la línea está enlazada a una planta (plant_id),
  // se muestra el nombre ACTUAL de esa planta, así los renombres hechos en la Tabla se reflejan
  // solos en Ingresos. Si no hay planta enlazada, se usa el texto guardado en la compra.
  function compraNombre(c) {
    const plant = c.plant_id ? plants.find(p => p.id === c.plant_id) : null
    return plant?.name || c.plant_name || ''
  }

  // Renombra una planta y deja sincronizado el nombre guardado en todas sus compras.
  async function syncPlantName(plantId, name) {
    const { error } = await supabase.from('plants').update({ name }).eq('id', plantId)
    if (error) { alert('No se pudo renombrar la planta: ' + error.message); return false }
    await supabase.from('compras').update({ plant_name: name }).eq('plant_id', plantId)
    return true
  }

  // Aplica un cambio a filas del estado local (se ve al instante, sin recargar nada) y devuelve
  // una función para deshacerlo si Supabase falla.
  function patchLocal(setter, currentList, ids, patch) {
    const before = currentList.filter(r => ids.includes(r.id))
    setter(prev => prev.map(r => (ids.includes(r.id) ? { ...r, ...patch } : r)))
    return () => setter(prev => prev.map(r => before.find(b => b.id === r.id) || r))
  }

  // Efecto de recibir una compra sobre su planta (stock, activa, foto), en Supabase y en el estado local.
  // stockNow acumula el stock ya sumado en esta misma tanda, por si varias líneas son de la misma planta.
  async function applyRecepcionAPlanta(c, stockNow = {}) {
    if (c.plant_id) {
      const plant = plants.find(p => p.id === c.plant_id)
      if (!plant) return
      const updates = { stock: (stockNow[plant.id] ?? plant.stock) + c.quantity }
      if (c.new_plant_category) updates.active = true
      if (c.image_url) updates.image_url = c.image_url
      const { error } = await supabase.from('plants').update(updates).eq('id', plant.id)
      if (error) { alert(`La compra quedó recibida, pero no se pudo sumar el stock de "${plant.name}": ${error.message}`); return }
      stockNow[plant.id] = updates.stock
      setPlants(prev => prev.map(p => (p.id === plant.id ? { ...p, ...updates } : p)))
    } else if (c.plant_name) {
      // Compatibilidad con compras antiguas creadas antes de que la planta se generara de inmediato
      const { data: newPlant, error } = await supabase.from('plants').insert({
        name: c.plant_name,
        category_id: c.new_plant_category || null,
        price: c.sale_price || 0,
        stock: c.quantity,
        image_url: c.image_url || null,
        active: true,
        flagged: !c.new_plant_category,
      }).select().single()
      if (error || !newPlant) { alert(`La compra quedó recibida, pero no se pudo crear la planta "${c.plant_name}".`); return }
      await supabase.from('compras').update({ plant_id: newPlant.id }).eq('id', c.id)
      setPlants(prev => [...prev, newPlant])
      setCompras(prev => prev.map(x => (x.id === c.id ? { ...x, plant_id: newPlant.id } : x)))
    }
  }

  // Pagado y Recibido se guardan por separado -- se pueden marcar y desmarcar en cualquier orden,
  // para poder corregir un error (ej. "recibido" marcado antes de tiempo, sin haber pagado).
  async function toggleCompraFlag(compra, flag, value) {
    if (approvingIds.includes(compra.id)) return
    setApprovingIds(prev => [...prev, compra.id])
    const pagado = flag === 'pagado' ? value : pagadoDe(compra)
    const recibido = flag === 'recibido' ? value : recibidoDe(compra)
    const wasRecibido = recibidoDe(compra)
    const patch = { [flag]: value, status: recibido ? 'recibido' : pagado ? 'pagado' : 'pedido' }
    if (flag === 'pagado' && value) patch.fecha_pago = new Date().toISOString()
    if (flag === 'recibido' && value) patch.fecha_recibido = new Date().toISOString()
    const undo = patchLocal(setCompras, compras, [compra.id], patch) // se ve al instante
    const { error } = await supabase.from('compras').update(patch).eq('id', compra.id)
    if (error) { undo(); alert('No se pudo actualizar: ' + error.message); setApprovingIds(prev => prev.filter(id => id !== compra.id)); return }
    if (flag === 'recibido' && value && !wasRecibido) await applyRecepcionAPlanta(compra) // solo la primera vez que se marca
    setApprovingIds(prev => prev.filter(id => id !== compra.id))
  }

  async function updateCompraAnticipo(compra, value) {
    const patch = { anticipo: value }
    const undo = patchLocal(setCompras, compras, [compra.id], patch)
    const { error } = await supabase.from('compras').update(patch).eq('id', compra.id)
    if (error) { undo(); alert('No se pudo guardar el abono: ' + error.message) }
  }

  // ---------- Nota libre por compra ----------
  function openLoteNote(lote) {
    setCurrentNoteLoteId(lote.id)
    setLoteNoteBlocks(lote.content_blocks || [])
    setLoteNoteCurrentText('')
    setLoteNoteModalOpen(true)
  }

  function insertPhotoBlockToLoteNote(file) {
    if (!file) return
    setLoteNoteBlocks(prev => {
      const next = [...prev]
      if (loteNoteCurrentText.trim()) next.push({ type: 'text', content: loteNoteCurrentText })
      next.push({ type: 'photo', file })
      return next
    })
    setLoteNoteCurrentText('')
  }

  function insertVideoBlockToLoteNote(file) {
    if (!file) return
    setLoteNoteBlocks(prev => {
      const next = [...prev]
      if (loteNoteCurrentText.trim()) next.push({ type: 'text', content: loteNoteCurrentText })
      next.push({ type: 'video', file })
      return next
    })
    setLoteNoteCurrentText('')
  }

  function removeLastLoteNoteBlock() {
    setLoteNoteBlocks(prev => prev.slice(0, -1))
  }

  async function saveLoteNote() {
    if (!currentNoteLoteId) return
    const blocks = [...loteNoteBlocks]
    if (loteNoteCurrentText.trim()) blocks.push({ type: 'text', content: loteNoteCurrentText })
    setSavingLoteNote(true)

    if (!isOnline()) {
      await addToQueue('lote_note', { loteId: currentNoteLoteId, blocks })
      setLoteNoteBlocks([])
      setLoteNoteCurrentText('')
      setSavingLoteNote(false)
      setLoteNoteModalOpen(false)
      setPendingCount(await queueLength())
      alert('Sin conexión: la nota se guardó en el celular y se subirá sola cuando vuelva la señal.')
      return
    }

    const finalBlocks = []
    for (const b of blocks) {
      if (b.type === 'text') {
        finalBlocks.push(b)
      } else if (b.url) {
        finalBlocks.push(b)
      } else {
        const url = await uploadImage(b.file, 'category-notes')
        if (url) finalBlocks.push({ type: b.type, url })
      }
    }
    const { error } = await supabase.from('compra_lotes').update({ content_blocks: finalBlocks }).eq('id', currentNoteLoteId)
    if (error) { alert('Error al guardar la nota: ' + error.message); setSavingLoteNote(false); return }
    setLoteNoteBlocks([])
    setLoteNoteCurrentText('')
    setSavingLoteNote(false)
    setLoteNoteModalOpen(false)
    loadData()
  }

  // ---------- Notas (separadas de las plantas, ej. notas por categoría o generales) ----------
  function openNewCategoryNote() {
    setEditingCategoryNoteId(null)
    setCategoryNoteCategoryId('')
    setCategoryNoteBlocks([])
    setCategoryNoteCurrentText('')
    setCategoryNoteEditIndex(null)
    setCategoryNoteModalOpen(true)
  }

  function openEditCategoryNote(note) {
    setEditingCategoryNoteId(note.id)
    setCategoryNoteCategoryId(note.category_id || '')
    setCategoryNoteBlocks(note.content_blocks || [])
    setCategoryNoteCurrentText('')
    setCategoryNoteEditIndex(null)
    setCategoryNoteModalOpen(true)
  }

  function commitCategoryNoteText() {
    if (!categoryNoteCurrentText.trim()) return
    setCategoryNoteBlocks(prev => [...prev, { type: 'text', content: categoryNoteCurrentText.trim(), at: new Date().toISOString() }])
    setCategoryNoteCurrentText('')
  }
  function startEditCategoryNoteBlock(i) {
    setCategoryNoteEditIndex(i)
    setCategoryNoteEditText(categoryNoteBlocks[i].content)
  }
  function cancelEditCategoryNoteBlock() {
    setCategoryNoteEditIndex(null)
    setCategoryNoteEditText('')
  }
  function saveEditCategoryNoteBlock() {
    setCategoryNoteBlocks(prev => prev.map((b, i) => (i === categoryNoteEditIndex ? { ...b, content: categoryNoteEditText, editedAt: new Date().toISOString() } : b)))
    cancelEditCategoryNoteBlock()
  }
  function deleteCategoryNoteBlock(i) {
    if (!confirm('¿Borrar esta entrada de la nota?')) return
    setCategoryNoteBlocks(prev => prev.filter((_, idx) => idx !== i))
    if (categoryNoteEditIndex === i) cancelEditCategoryNoteBlock()
  }

  function insertPhotoBlockToCategoryNote(files) {
    const list = files instanceof FileList || Array.isArray(files) ? Array.from(files) : (files ? [files] : [])
    if (list.length === 0) return
    setCategoryNoteBlocks(prev => {
      const next = [...prev]
      if (categoryNoteCurrentText.trim()) next.push({ type: 'text', content: categoryNoteCurrentText.trim(), at: new Date().toISOString() })
      list.forEach(file => next.push({ type: 'photo', file, at: new Date().toISOString() }))
      return next
    })
    setCategoryNoteCurrentText('')
  }

  // Dictado por voz para "Notas" (igual que en las notas de cada planta). Solo funciona en
  // navegadores con reconocimiento de voz web (Chrome en Android); en iPhone no está disponible.
  function toggleCategoryNoteDictation() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SpeechRecognition) {
      alert('El dictado por este botón no está disponible en este navegador (funciona en Chrome para Android). En iPhone, usa el micrófono del teclado para dictar directo en el cuadro de texto.')
      return
    }
    if (isDictatingCategoryNote) {
      categoryNoteWantDictationRef.current = false
      categoryNoteRecognitionRef.current?.stop()
      return
    }
    const recognition = new SpeechRecognition()
    recognition.lang = 'es-ES'
    recognition.continuous = true
    recognition.interimResults = false
    recognition.onresult = event => {
      let finalText = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) finalText += event.results[i][0].transcript
      }
      if (finalText.trim()) {
        setCategoryNoteCurrentText(prev => (prev.trim() ? prev.trim() + ' ' : '') + finalText.trim())
      }
    }
    recognition.onerror = e => { if (e.error === 'not-allowed' || e.error === 'service-not-allowed') categoryNoteWantDictationRef.current = false }
    recognition.onend = () => {
      if (categoryNoteWantDictationRef.current) { try { recognition.start(); return } catch { /* seguir y apagar */ } }
      setIsDictatingCategoryNote(false)
    }
    categoryNoteWantDictationRef.current = true
    recognition.start()
    categoryNoteRecognitionRef.current = recognition
    setIsDictatingCategoryNote(true)
  }

  function insertVideoBlockToCategoryNote(file) {
    if (!file) return
    setCategoryNoteBlocks(prev => {
      const next = [...prev]
      if (categoryNoteCurrentText.trim()) next.push({ type: 'text', content: categoryNoteCurrentText.trim(), at: new Date().toISOString() })
      next.push({ type: 'video', file, at: new Date().toISOString() })
      return next
    })
    setCategoryNoteCurrentText('')
  }

  function removeLastCategoryNoteBlock() {
    setCategoryNoteBlocks(prev => prev.slice(0, -1))
  }

  async function saveCategoryNote() {
    const blocks = [...categoryNoteBlocks]
    if (categoryNoteCurrentText.trim()) blocks.push({ type: 'text', content: categoryNoteCurrentText.trim(), at: new Date().toISOString() })
    if (blocks.length === 0) { alert('Escribe algo o agrega una foto/video antes de guardar'); return }
    setSavingCategoryNote(true)
    const finalBlocks = []
    for (const b of blocks) {
      if (b.type === 'text') {
        finalBlocks.push(b)
      } else if (b.url) {
        finalBlocks.push(b)
      } else {
        const url = await uploadImage(b.file, 'category-notes')
        if (url) { const { file, ...rest } = b; finalBlocks.push({ ...rest, url }) }
      }
    }
    if (editingCategoryNoteId) {
      const { error } = await supabase.from('category_notes').update({ content_blocks: finalBlocks, category_id: categoryNoteCategoryId || null, updated_at: new Date().toISOString() }).eq('id', editingCategoryNoteId)
      if (error) { alert('Error al guardar la nota: ' + error.message); setSavingCategoryNote(false); return }
    } else {
      const { error } = await supabase.from('category_notes').insert({ content_blocks: finalBlocks, category_id: categoryNoteCategoryId || null })
      if (error) { alert('Error al guardar la nota: ' + error.message); setSavingCategoryNote(false); return }
    }
    setCategoryNoteBlocks([])
    setCategoryNoteCurrentText('')
    setSavingCategoryNote(false)
    setCategoryNoteModalOpen(false)
    loadData()
  }

  async function deleteCategoryNote(id) {
    if (!confirm('¿Borrar esta nota permanentemente?')) return
    await supabase.from('category_notes').delete().eq('id', id)
    loadData()
  }


  // Pagado y Entregado se guardan por separado -- se pueden marcar y desmarcar en cualquier orden.
  async function toggleOrderFlag(order, flag, value) {
    if (approvingIds.includes(order.id)) return
    setApprovingIds(prev => [...prev, order.id])
    const pagado = flag === 'pagado' ? value : pagadoDe(order)
    const entregado = flag === 'entregado' ? value : entregadoDe(order)
    const patch = { [flag]: value, status: entregado ? 'entregado' : pagado ? 'pagado' : 'pedido' }
    if (flag === 'pagado' && value) patch.fecha_pago = new Date().toISOString()
    if (flag === 'entregado' && value) patch.fecha_entrega = new Date().toISOString()
    const undo = patchLocal(setOrders, orders, [order.id], patch) // se ve al instante
    const { error } = await supabase.from('orders').update(patch).eq('id', order.id)
    // Nota: el stock ya se descontó una vez cuando el cliente hizo el pedido (en App.jsx),
    // así que NO se vuelve a descontar acá — antes esto causaba un doble descuento.
    if (error) { undo(); alert('No se pudo actualizar: ' + error.message) }
    setApprovingIds(prev => prev.filter(id => id !== order.id))
  }

  async function updateOrderAnticipo(order, value) {
    const patch = { anticipo: value }
    const undo = patchLocal(setOrders, orders, [order.id], patch)
    const { error } = await supabase.from('orders').update(patch).eq('id', order.id)
    if (error) { undo(); alert('No se pudo guardar el abono: ' + error.message) }
  }

  // ---------- Ventas agrupadas en factura (venta_lotes) ----------
  // En el buscador de "Nueva venta", los lotes de semillas se identifican con el
  // prefijo 'seed:' delante de su id, para poder mezclarlos con las plantas en la
  // misma lista sin confundir los ids.
  function resolveVentaTarget(selectionId) {
    if (!selectionId) return { isSeed: false, plant: null, seedBatch: null }
    if (selectionId.startsWith('seed:')) {
      const seedBatchId = selectionId.slice(5)
      return { isSeed: true, plant: null, seedBatch: seedBatches.find(sb => sb.id === seedBatchId) }
    }
    return { isSeed: false, plant: plants.find(p => p.id === selectionId), seedBatch: null }
  }

  function seedBatchDisplayName(sb) {
    if (!sb) return ''
    return `🌰 ${sb.es_noid ? 'NOID' : (sb.nombre || 'Lote de semillas')}`
  }

  function seedBatchRawName(sb) {
    return sb.es_noid ? 'NOID' : (sb.nombre || 'Lote de semillas')
  }

  // "En venta" (o estado "catalogado") ahora solo controla si el lote se ve en la Tienda del Cliente.
  // Si ya se convirtió en planta (converted_plant_id), NO se muestra como semilla: ya existe como planta viva.
  function isSeedBatchForSale(sb) {
    if (sb.converted_plant_id) return false
    return !!sb.en_venta || sb.estado === 'catalogado'
  }

  // Todo lote ingresado se ve en Galería y Tabla (salvo que ya se haya convertido en planta viva).
  // El check "En venta" ya no es requisito aquí: solo decide la visibilidad en Tienda Cliente.
  function isSeedBatchVisibleInAdmin(sb) {
    return !sb.converted_plant_id
  }

  // Convierte los lotes en "ítems tipo planta" para mostrarlos junto a las plantas (Galería y Tabla).
  function seedBatchesAsItems() {
    return seedBatches.filter(isSeedBatchVisibleInAdmin).map(sb => {
      const foto = seedBatchEvents.find(ev => ev.seed_batch_id === sb.id && ev.photo_url)
      const fotoNota = (Array.isArray(sb.content_blocks) ? sb.content_blocks : []).find(b => b && b.type === 'photo' && b.url)
      return {
        id: `seed:${sb.id}`,
        isSeed: true,
        seedBatchId: sb.id,
        name: seedBatchRawName(sb),
        category_id: sb.category_id || null,
        price: Number(sb.price) || 0,
        stock: Number(sb.stock) || 0,
        image_url: foto ? foto.photo_url : (fotoNota ? fotoNota.url : null),
        proveedor: sb.proveedor || '',
        marcado_cliente: !!sb.marcado_cliente,
        costoSemilla: (() => {
          const cant = Number(sb.cantidad_semillas) || 0
          const total = (Number(sb.costo) || 0) + (Number(sb.envio1) || 0) + (Number(sb.envio2) || 0) + (Number(sb.varios) || 0)
          return cant > 0 && total > 0 ? { solo: (Number(sb.costo) || 0) / cant, conEnvio: total / cant } : null
        })(),
        active: true,
      }
    })
  }

  // ---------- Semillas en la tienda del cliente (Modo Tienda Cliente) ----------
  function alertSeedClienteError(error) {
    alert('No se pudo guardar para la tienda. Falta preparar Supabase: ejecuta el archivo semillas_tienda.sql en el SQL Editor.\n\nDetalle: ' + error.message)
  }

  async function toggleSeedMarcadoCliente(batchId, current) {
    const next = !current
    const prev = seedBatches
    setSeedBatches(list => list.map(b => b.id === batchId ? { ...b, marcado_cliente: next } : b)) // se ve al instante
    const { error } = await supabase.from('seed_batches').update({ marcado_cliente: next }).eq('id', batchId)
    if (error) { setSeedBatches(prev); alertSeedClienteError(error) }
  }

  async function markSeedBatchesCliente(ids, value) {
    if (ids.length === 0) return
    const prev = seedBatches
    const set = new Set(ids)
    setSeedBatches(list => list.map(b => set.has(b.id) ? { ...b, marcado_cliente: value } : b))
    for (let i = 0; i < ids.length; i += 50) {
      const { error } = await supabase.from('seed_batches').update({ marcado_cliente: value }).in('id', ids.slice(i, i + 50))
      if (error) { setSeedBatches(prev); alertSeedClienteError(error); loadData(); return }
    }
  }

  // Usar semillas del stock para sembrar: descuenta el stock y deja registro en las notas del lote.
  async function sembrarSemillas(sb) {
    const stockActual = Number(sb.stock) || 0
    const txt = window.prompt(`¿Cuántas semillas vas a sembrar? (stock actual: ${stockActual})`, '')
    if (txt === null) return
    const n = Math.floor(Number(txt))
    if (!n || n <= 0) { alert('Escribe un número mayor que 0.'); return }
    if (n > stockActual) { alert(`Solo hay ${stockActual} semillas en stock.`); return }
    const nuevoStock = stockActual - n
    const bloques = [...(Array.isArray(sb.content_blocks) ? sb.content_blocks : []), { type: 'text', content: `🌱 ${new Date().toLocaleDateString()} — Sembradas ${n} semillas (stock: ${stockActual} → ${nuevoStock}).`, at: new Date().toISOString() }]
    const patch = { stock: nuevoStock, content_blocks: bloques, sembradas: (Number(sb.sembradas) || 0) + n }
    if (sb.estado === 'semillas') patch.estado = 'sembrado'
    const { error } = await supabase.from('seed_batches').update(patch).eq('id', sb.id)
    if (error) { alert('No se pudo guardar: ' + error.message); return }
    loadData()
  }

  // Anota cuántas semillas germinaron (no cambia el stock; queda en las notas del lote).
  async function anotarGerminacion(sb) {
    const txt = window.prompt('¿Cuántas semillas germinaron?', '')
    if (txt === null) return
    const n = Math.floor(Number(txt))
    if (!n || n <= 0) { alert('Escribe un número mayor que 0.'); return }
    const bloques = [...(Array.isArray(sb.content_blocks) ? sb.content_blocks : []), { type: 'text', content: `🌿 ${new Date().toLocaleDateString()} — Germinaron ${n} semillas.` }]
    const patch = { content_blocks: bloques }
    if (sb.estado === 'semillas' || sb.estado === 'sembrado') patch.estado = 'en_crecimiento'
    const { error } = await supabase.from('seed_batches').update(patch).eq('id', sb.id)
    if (error) { alert('No se pudo guardar: ' + error.message); return }
    loadData()
  }

  // Poner o quitar un lote de la venta (necesita la columna seed_batches.en_venta)
  async function toggleSeedBatchEnVenta(batch, value) {
    const { error } = await supabase.from('seed_batches').update({ en_venta: value }).eq('id', batch.id)
    if (error) {
      alert('No se pudo guardar. Falta crear la columna "en_venta" en Supabase (SQL Editor):\n\nalter table seed_batches add column if not exists en_venta boolean not null default false;\n\nDetalle: ' + error.message)
      return
    }
    loadData()
  }

  // Tarjeta de dinero: vendido, cobrado, por cobrar, comprado y ganancia/pérdida.
  function renderMoneyCard({ vendido, cobrado, comprado, extra }) {
    const porCobrar = vendido - cobrado
    const ganancia = vendido - comprado
    const gananciaReal = cobrado - comprado
    const color = n => (n >= 0 ? '#2f6b2f' : '#b03434')
    return (
      <div style={{ background: '#FBF6EA', border: '1px solid #D8C7A3', borderRadius: 10, padding: '8px 12px', margin: '8px 0', fontSize: 14, lineHeight: 1.6 }}>
        <div>💰 Vendido: <strong>{money(vendido)}</strong> · Cobrado: <strong>{money(cobrado)}</strong> · Por cobrar: <strong>{money(porCobrar)}</strong></div>
        <div>🧾 Comprado: <strong>{money(comprado)}</strong></div>
        <div style={{ color: color(ganancia), fontWeight: 700 }}>{ganancia >= 0 ? '📈 Ganancia' : '📉 Pérdida'}: {money(Math.abs(ganancia))} <span style={{ fontWeight: 400, fontSize: 12 }}>(vendido − comprado)</span></div>
        <div style={{ color: color(gananciaReal), fontWeight: 600 }}>{gananciaReal >= 0 ? 'Ganancia' : 'Pérdida'} sobre lo ya cobrado: {money(Math.abs(gananciaReal))}</div>
        {comprado === 0 && <div style={{ fontSize: 12, color: '#8a6d3b' }}>⚠️ Todavía no hay costo de compra registrado, por eso la ganancia es igual a lo vendido.</div>}
        {extra}
      </div>
    )
  }

  // Cómo se ve cada combinación real de pagado/entregado (independientes entre sí).
  function estadoVentaInfo(v) {
    if (v.entregado && v.pagado) return { icon: '✅', label: 'Entregado y pagado', bg: '#DCEFD9', border: '#9CCB92' }
    if (v.entregado && !v.pagado) return { icon: '⚠️', label: 'Entregado, falta cobrar', bg: '#FBEEEF', border: '#EFC7CB' }
    if (v.pagado && !v.entregado) return { icon: '💵', label: 'Pagado, falta entregar', bg: '#DCEBF9', border: '#9CC2E6' }
    return { icon: '🕒', label: 'Pedido', bg: '#FFF1CC', border: '#E6C76A' }
  }

  // Lista de ventas con color por estado, filtros y casillas Pedido / Pagado / Entregado
  // que se marcan y desmarcan de forma independiente (no en un orden fijo).
  // Cada venta: { id, busyId, pagado, entregado, anticipo, cantidad, unit_price, cliente, numero, fecha, motivo, toggle(), saveAnticipo() }
  function renderVentasConEstado(ventas) {
    const unidades = fn => ventas.filter(fn).reduce((sum, v) => sum + v.cantidad, 0)
    const total = unidades(() => true)
    const pedidas = unidades(v => !v.pagado && !v.entregado)
    const pagadas = unidades(v => v.pagado)
    const entregadas = unidades(v => v.entregado)
    const cuenta = fn => ventas.filter(fn).length
    const matches = v => seedVentasFilter === 'all'
      || (seedVentasFilter === 'pedido' ? (!v.pagado && !v.entregado) : seedVentasFilter === 'pagado' ? v.pagado : v.entregado)
    const visibles = ventas.filter(matches)
    const filtros = [
      ['all', `Todas (${ventas.length})`],
      ['pedido', `🕒 Pedidas (${cuenta(v => !v.pagado && !v.entregado)})`],
      ['pagado', `💵 Pagadas (${cuenta(v => v.pagado)})`],
      ['entregado', `✅ Entregadas (${cuenta(v => v.entregado)})`],
    ]
    if (ventas.length === 0) return <p className="historial-empty">Todavía no se vendió ninguna.</p>
    return (
      <>
        <p className="historial-entry"><strong>Total vendidas: {total} u.</strong> · 🕒 {pedidas} pedidas (sin pagar) · 💵 {pagadas} pagadas · ✅ {entregadas} entregadas</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, margin: '8px 0 2px' }}>
          {filtros.map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setSeedVentasFilter(key)}
              style={{ padding: '5px 10px', fontSize: 12.5, ...(seedVentasFilter === key ? { background: PILL_ACTIVE_BG, borderColor: '#6E8161' } : null) }}
            >
              {label}
            </button>
          ))}
        </div>
        <p style={{ margin: '0 0 6px', fontSize: 11.5, color: '#8a8a7a' }}>Los números de los botones son cantidad de ventas; arriba, unidades. Pagado y Entregado se marcan por separado.</p>
        {visibles.length === 0 && <p className="historial-empty">No hay ventas con ese estado.</p>}
        {visibles.map(v => {
          const est = estadoVentaInfo(v)
          const totalV = v.cantidad * v.unit_price
          return (
            <div key={v.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, background: est.bg, border: `1px solid ${est.border}`, borderRadius: 10, padding: '8px 10px', margin: '6px 0' }}>
              <div style={{ minWidth: 0 }}>
                <div><strong>{v.cantidad} u.</strong>{v.cliente ? ` — ${v.cliente}` : ''}</div>
                <div style={{ fontSize: 12.5, color: '#5B4636' }}>
                  {v.numero ? `Venta #${v.numero} · ` : ''}{new Date(v.fecha).toLocaleDateString()} · {money(v.unit_price)} c/u = {money(totalV)}{v.motivo ? ` · ${v.motivo}` : ''}
                </div>
                {!v.pagado && v.anticipo > 0 && (
                  <div style={{ fontSize: 12, color: '#8a6d3b' }}>Abonado: {money(v.anticipo)} · Saldo: {money(totalV - v.anticipo)}</div>
                )}
                <div style={{ marginTop: 4, fontWeight: 700, fontSize: 13 }}>{est.icon} {est.label}</div>
              </div>
              <StatusChecklist
                steps={[{ key: 'pedido', label: 'Pedido' }, { key: 'pagado', label: 'Pagado' }, { key: 'entregado', label: 'Entregado' }]}
                values={{ pedido: true, pagado: v.pagado, entregado: v.entregado }}
                onToggle={v.toggle}
                disabled={approvingIds.includes(v.busyId)}
                anticipo={v.anticipo}
                onAnticipoSave={v.saveAnticipo}
              />
            </div>
          )
        })}
      </>
    )
  }

  function openSeedSheet(batchId) {
    setSeedSheetSection('resumen')
    setSeedSheetMenuOpen(false)
    setSeedVentasFilter('all')
    setSeedSheetId(batchId)
  }

  // Vender desde Galería/Tabla: abre "Nueva venta" con el lote elegido. El stock del lote se descuenta al guardar la venta.
  function sellSeedBatch(sb) {
    setVentaLineForm({ plant_id: `seed:${sb.id}`, quantity: '1', unit_price: sb.price ? String(sb.price) : '', motivo: 'Venta manual (con precio)' })
    setVentaLoteBuilderOpen(true)
    setSeedSheetId(null)
    setView('pedidos')
  }

  function addLineToVentaLote(e) {
    e.preventDefault()
    if (!ventaLineForm.plant_id || !ventaLineForm.quantity || !ventaLineForm.motivo) {
      alert('Selecciona una planta o lote de semillas, la cantidad y el motivo')
      return
    }
    const { isSeed, plant, seedBatch } = resolveVentaTarget(ventaLineForm.plant_id)
    setVentaLoteLines(prev => [...prev, {
      ...ventaLineForm,
      seed_batch_id: isSeed ? seedBatch?.id : null,
      plant_id: isSeed ? null : ventaLineForm.plant_id,
      plant_name: isSeed ? seedBatchDisplayName(seedBatch) : (plant ? plant.name : ''),
      unit_price: ventaLineForm.unit_price !== '' ? ventaLineForm.unit_price : 0,
    }])
    setVentaLineForm({ plant_id: '', quantity: '', unit_price: '', motivo: 'Venta manual (con precio)' })
  }

  function removeVentaLoteLine(index) {
    setVentaLoteLines(prev => prev.filter((_, i) => i !== index))
  }

  async function saveVentaLote() {
    if (ventaLoteLines.length === 0) { alert('Agrega al menos una planta a la factura'); return }
    setSavingVentaLote(true)
    const { data: lote, error: loteError } = await supabase.from('venta_lotes').insert({ cliente: ventaLoteCliente }).select().single()
    if (loteError) { alert('Error al crear la venta: ' + loteError.message); setSavingVentaLote(false); return }

    for (const line of ventaLoteLines) {
      const plant = line.plant_id ? plants.find(p => p.id === line.plant_id) : null
      const seedBatch = line.seed_batch_id ? seedBatches.find(sb => sb.id === line.seed_batch_id) : null
      const quantity = Number(line.quantity)
      const unit_price = Number(line.unit_price) || 0
      const { error } = await supabase.from('decrementos').insert({
        plant_id: line.plant_id || null, seed_batch_id: line.seed_batch_id || null, plant_name: line.plant_name, quantity, motivo: line.motivo, unit_price, lote_id: lote.id, status: 'pedido',
      })
      if (error) { alert('Error al guardar una de las plantas: ' + error.message); continue }
      // Descontar stock de inmediato al registrar el decremento (venta manual, pérdida o regalo)
      if (plant) {
        await supabase.from('plants').update({ stock: Math.max(0, plant.stock - quantity), stock_disponible: Math.max(0, (plant.stock_disponible ?? plant.stock) - quantity) }).eq('id', plant.id)
      } else if (seedBatch) {
        await supabase.from('seed_batches').update({ stock: Math.max(0, (seedBatch.stock || 0) - quantity) }).eq('id', seedBatch.id)
      }
    }
    setVentaLoteCliente('')
    setVentaLoteLines([])
    setVentaLoteBuilderOpen(false)
    setSavingVentaLote(false)
    loadData()
  }

  async function addPlantToVentaLote(loteId) {
    if (!ventaLineForm.plant_id || !ventaLineForm.quantity || !ventaLineForm.motivo) {
      alert('Selecciona una planta o lote de semillas, la cantidad y el motivo')
      return
    }
    const { isSeed, plant, seedBatch } = resolveVentaTarget(ventaLineForm.plant_id)
    const quantity = Number(ventaLineForm.quantity)
    const unit_price = Number(ventaLineForm.unit_price) || 0
    const { error } = await supabase.from('decrementos').insert({
      plant_id: isSeed ? null : ventaLineForm.plant_id,
      seed_batch_id: isSeed ? seedBatch?.id : null,
      plant_name: isSeed ? seedBatchDisplayName(seedBatch) : (plant ? plant.name : ''),
      quantity, motivo: ventaLineForm.motivo, unit_price, lote_id: loteId, status: 'pedido',
    })
    if (error) { alert('Error al guardar la planta: ' + error.message); return }
    // Descontar stock de inmediato al registrar el decremento (venta manual, pérdida o regalo)
    if (plant) {
      await supabase.from('plants').update({ stock: Math.max(0, plant.stock - quantity), stock_disponible: Math.max(0, (plant.stock_disponible ?? plant.stock) - quantity) }).eq('id', plant.id)
    } else if (seedBatch) {
      await supabase.from('seed_batches').update({ stock: Math.max(0, (seedBatch.stock || 0) - quantity) }).eq('id', seedBatch.id)
    }
    setVentaLineForm({ plant_id: '', quantity: '', unit_price: '', motivo: 'Venta manual (con precio)' })
    setAddToVentaLoteId(null)
    loadData()
  }

  async function updateDecrementoField(d, field, rawValue) {
    const updates = {}
    if (field === 'quantity' || field === 'unit_price') {
      updates[field] = Number(rawValue) || 0
    } else {
      updates[field] = rawValue
    }
    const { error } = await supabase.from('decrementos').update(updates).eq('id', d.id)
    if (error) { alert('Error al guardar el cambio: ' + error.message); return }
    loadData()
  }

  // Pagado y Entregado se guardan por separado -- se pueden marcar y desmarcar en cualquier orden,
  // para poder corregir casos como "entregado sin pagar" o "pagado sin entregar".
  async function toggleDecrementoFlag(d, flag, value) {
    if (approvingIds.includes(d.id)) return
    setApprovingIds(prev => [...prev, d.id])
    const pagado = flag === 'pagado' ? value : pagadoDe(d)
    const entregado = flag === 'entregado' ? value : entregadoDe(d)
    const patch = { [flag]: value, status: entregado ? 'entregado' : pagado ? 'pagado' : 'pedido' }
    const undo = patchLocal(setDecrementos, decrementos, [d.id], patch) // se ve al instante
    const { error } = await supabase.from('decrementos').update(patch).eq('id', d.id)
    // Nota: el stock ya se descontó al momento de registrar este decremento, no acá.
    if (error) { undo(); alert('Error al actualizar: ' + error.message) }
    setApprovingIds(prev => prev.filter(id => id !== d.id))
  }

  async function updateDecrementoAnticipo(d, value) {
    const patch = { anticipo: value }
    const undo = patchLocal(setDecrementos, decrementos, [d.id], patch)
    const { error } = await supabase.from('decrementos').update(patch).eq('id', d.id)
    if (error) { undo(); alert('No se pudo guardar el abono: ' + error.message) }
  }

  async function updateVentaLoteCliente(lote, value) {
    const cliente = (value || '').trim() || null
    const { error } = await supabase.from('venta_lotes').update({ cliente }).eq('id', lote.id)
    if (error) { alert('No se pudo guardar el nombre del cliente: ' + error.message); return }
    loadData()
  }

  async function updateVentaLoteExtra(lote, field, value) {
    const num = Number(value) || 0
    const { error } = await supabase.from('venta_lotes').update({ [field]: num }).eq('id', lote.id)
    if (error) { alert('Error al guardar el cambio: ' + error.message); return }
    loadData()
  }

  function ventaLoteProration(lote, lineas) {
    const subtotal = lineas.reduce((sum, d) => sum + Number(d.unit_price || 0) * Number(d.quantity), 0)
    const extras = Number(lote.envio1 || 0) + Number(lote.envio2 || 0) + Number(lote.varios || 0)
    const withExtra = lineas.map(d => {
      const value = Number(d.unit_price || 0) * Number(d.quantity)
      const proportion = subtotal > 0 ? value / subtotal : 0
      const prorated = proportion * extras
      return { ...d, _value: value, _prorated: prorated, _lineTotal: value + prorated }
    })
    return { subtotal, extras, total: subtotal + extras, lineas: withExtra }
  }

  function buildInvoiceText({ numeroLabel, cliente, dateStr, lineas, subtotal, envio1, envio2, varios, total }) {
    const items = lineas.map(l => `- ${l.plant_name} x${l.quantity} — $${l._lineTotal.toFixed(2)}`).join('\n')
    let text = `🧾 ${numeroLabel}\n`
    if (cliente) text += `Cliente: ${cliente}\n`
    text += `Fecha: ${dateStr}\n\n`
    text += `Detalle:\n${items}\n\n`
    text += `Subtotal: $${subtotal.toFixed(2)}\n`
    if (envio1) text += `Envío 1: $${Number(envio1).toFixed(2)}\n`
    if (envio2) text += `Envío 2: $${Number(envio2).toFixed(2)}\n`
    if (varios) text += `Varios: $${Number(varios).toFixed(2)}\n`
    text += `Total: $${total.toFixed(2)}\n\n`
    text += `¡Gracias por tu compra! - Diamantev 🌿`
    return text
  }

  function sendInvoiceWhatsApp(params) {
    window.open(`https://wa.me/?text=${encodeURIComponent(buildInvoiceText(params))}`, '_blank')
  }

  // Factura de compra por WhatsApp: sin estados, solo detalle y totales
  function sendCompraInvoiceWhatsApp(lote, lineasConProrrateo, subtotal, totalLote) {
    const items = lineasConProrrateo.map(l => `- ${compraNombre(l)} x${l.quantity} — $${l._lineTotal.toFixed(2)}`).join('\n')
    let text = `🧺 Factura de compra #${lote.numero}\n`
    if (lote.proveedor) text += `Proveedor: ${lote.proveedor}\n`
    text += `Fecha: ${new Date(lote.created_at).toLocaleDateString()}\n\n`
    text += `Detalle:\n${items}\n\n`
    text += `Subtotal: $${subtotal.toFixed(2)}\n`
    if (lote.envio1) text += `Envío 1: $${Number(lote.envio1).toFixed(2)}\n`
    if (lote.envio2) text += `Envío 2: $${Number(lote.envio2).toFixed(2)}\n`
    if (lote.varios) text += `Varios: $${Number(lote.varios).toFixed(2)}\n`
    text += `Total: $${totalLote.toFixed(2)}`
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank')
  }

  async function downloadInvoicePDF(params) {
    try {
      const doc = new jsPDF({ unit: 'mm', format: 'a4' })
      let y = 20
      doc.setFontSize(16)
      doc.text(params.numeroLabel, 15, y)
      y += 8
      doc.setFontSize(11)
      if (params.cliente) { doc.text(`Cliente: ${params.cliente}`, 15, y); y += 6 }
      doc.text(`Fecha: ${params.dateStr}`, 15, y)
      y += 10

      doc.setFont(undefined, 'bold')
      doc.text('Producto', 15, y)
      doc.text('Cant.', 110, y)
      doc.text('P.Unit', 135, y)
      doc.text('Total', 170, y)
      doc.setFont(undefined, 'normal')
      y += 3
      doc.line(15, y, 195, y)
      y += 6

      params.lineas.forEach(l => {
        if (y > 270) { doc.addPage(); y = 20 }
        doc.text(String(l.plant_name).slice(0, 45), 15, y)
        doc.text(String(l.quantity), 110, y)
        doc.text(`$${Number(l.unit_price || 0).toFixed(2)}`, 135, y)
        doc.text(`$${l._lineTotal.toFixed(2)}`, 170, y)
        y += 6
      })

      y += 2
      doc.line(15, y, 195, y)
      y += 6
      doc.text(`Subtotal: $${params.subtotal.toFixed(2)}`, 135, y); y += 6
      if (params.envio1) { doc.text(`Envío 1: $${Number(params.envio1).toFixed(2)}`, 135, y); y += 6 }
      if (params.envio2) { doc.text(`Envío 2: $${Number(params.envio2).toFixed(2)}`, 135, y); y += 6 }
      if (params.varios) { doc.text(`Varios: $${Number(params.varios).toFixed(2)}`, 135, y); y += 6 }
      doc.setFont(undefined, 'bold')
      doc.text(`Total: $${params.total.toFixed(2)}`, 135, y)

      doc.save(`${params.filenameSlug}.pdf`)
    } catch (err) {
      alert('No se pudo generar el PDF. Intenta de nuevo.')
    }
  }

  // Factura como FOTO (imagen JPG) para enviar por WhatsApp u otra app
  async function shareInvoiceImage(params) {
    try {
      const W = 900, PAD = 48, ROW = 46, SCALE = 2
      const lineas = params.lineas || []
      let banner = null
      try {
        banner = await new Promise((resolve, reject) => {
          const img = new Image()
          img.onload = () => resolve(img)
          img.onerror = reject
          img.src = '/banner-diamantev.jpg'
        })
      } catch (e) { banner = null }
      const bannerH = banner ? Math.round(W * banner.naturalHeight / banner.naturalWidth) : 0
      const extraRows = [['Subtotal', Number(params.subtotal || 0)]]
      if (params.envio1) extraRows.push(['Envío 1', Number(params.envio1)])
      if (params.envio2) extraRows.push(['Envío 2', Number(params.envio2)])
      if (params.varios) extraRows.push(['Varios', Number(params.varios)])
      const headH = 40 + 40 + (params.cliente ? 34 : 0) + 30 + 16
      const H = bannerH + headH + 44 + lineas.length * ROW + 24 + extraRows.length * 40 + 84 + 96
      const canvas = document.createElement('canvas')
      canvas.width = W * SCALE
      canvas.height = H * SCALE
      const ctx = canvas.getContext('2d')
      ctx.scale(SCALE, SCALE)
      const SERIF = 'Georgia, "Times New Roman", serif'
      const money = n => `$${Number(n || 0).toFixed(2)}`
      const fit = (text, maxW) => {
        let t = String(text || '')
        if (ctx.measureText(t).width <= maxW) return t
        while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1)
        return t + '…'
      }

      ctx.fillStyle = '#FBF3E6'
      ctx.fillRect(0, 0, W, H)
      if (banner) ctx.drawImage(banner, 0, 0, W, bannerH)

      let y = bannerH + 54
      ctx.textAlign = 'left'
      ctx.fillStyle = '#4a5d3a'
      ctx.font = `bold 34px ${SERIF}`
      ctx.fillText(params.numeroLabel, PAD, y)
      y += 40
      ctx.fillStyle = '#5a5040'
      ctx.font = `24px ${SERIF}`
      if (params.cliente) { ctx.fillText(`Cliente: ${params.cliente}`, PAD, y); y += 34 }
      ctx.fillText(`Fecha: ${params.dateStr}`, PAD, y)
      y += 46

      const colName = PAD + 14
      const colQty = W - PAD - 300
      const colUnit = W - PAD - 150
      const colTot = W - PAD - 14
      ctx.fillStyle = '#f3ecdd'
      ctx.fillRect(PAD, y, W - 2 * PAD, 44)
      ctx.fillStyle = '#4a5d3a'
      ctx.font = `bold 22px ${SERIF}`
      ctx.textAlign = 'left'; ctx.fillText('Producto', colName, y + 30)
      ctx.textAlign = 'center'; ctx.fillText('Cant.', colQty, y + 30)
      ctx.textAlign = 'right'; ctx.fillText('P.Unit', colUnit, y + 30)
      ctx.fillText('Total', colTot, y + 30)
      y += 44

      ctx.font = `22px ${SERIF}`
      lineas.forEach((l, i) => {
        if (i % 2 === 0) { ctx.fillStyle = 'rgba(255,255,255,0.65)'; ctx.fillRect(PAD, y, W - 2 * PAD, ROW) }
        ctx.fillStyle = '#3b3b32'
        ctx.textAlign = 'left'; ctx.fillText(fit(l.plant_name, colQty - 40 - colName), colName, y + 31)
        ctx.textAlign = 'center'; ctx.fillText(String(l.quantity), colQty, y + 31)
        ctx.textAlign = 'right'; ctx.fillText(money(l.unit_price), colUnit, y + 31)
        ctx.fillText(money(l._lineTotal), colTot, y + 31)
        y += ROW
      })

      y += 10
      ctx.strokeStyle = '#C8B58A'
      ctx.lineWidth = 2
      ctx.beginPath(); ctx.moveTo(PAD, y); ctx.lineTo(W - PAD, y); ctx.stroke()
      y += 34
      ctx.font = `22px ${SERIF}`
      ctx.fillStyle = '#5a5040'
      extraRows.forEach(([label, value]) => {
        ctx.textAlign = 'left'; ctx.fillText(label, W - PAD - 330, y)
        ctx.textAlign = 'right'; ctx.fillText(money(value), colTot, y)
        y += 40
      })
      y += 20
      ctx.font = `bold 32px ${SERIF}`
      ctx.fillStyle = '#4a5d3a'
      ctx.textAlign = 'left'; ctx.fillText('Total', W - PAD - 330, y)
      ctx.textAlign = 'right'; ctx.fillText(money(params.total), colTot, y)

      ctx.textAlign = 'center'
      ctx.fillStyle = '#7a7060'
      ctx.font = `italic 24px ${SERIF}`
      ctx.fillText('¡Gracias por tu compra! — Diamantev', W / 2, H - 44)

      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.92))
      if (!blob) throw new Error('No se pudo crear la imagen')
      const file = new File([blob], `${params.filenameSlug}.jpg`, { type: 'image/jpeg' })
      if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: params.numeroLabel })
      } else {
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `${params.filenameSlug}.jpg`
        document.body.appendChild(a)
        a.click()
        a.remove()
        setTimeout(() => URL.revokeObjectURL(url), 2000)
        alert('Se descargó la foto de la factura. Ábrela desde tu galería para enviarla por WhatsApp.')
      }
    } catch (err) {
      if (err && err.name === 'AbortError') return // cerró el panel de compartir
      alert('No se pudo generar la foto de la factura. Intenta de nuevo.')
    }
  }

  // ---- Wrappers para ventas manuales (venta_lotes / decrementos) ----
  function sendVentaInvoiceWhatsApp(lote, lineasConProrrateo, subtotal, totalLote) {
    sendInvoiceWhatsApp({
      numeroLabel: `Factura de venta #${lote.numero}`,
      cliente: lote.cliente,
      dateStr: new Date(lote.created_at).toLocaleDateString(),
      lineas: lineasConProrrateo,
      subtotal, envio1: lote.envio1, envio2: lote.envio2, varios: lote.varios, total: totalLote,
    })
  }

  function downloadVentaInvoicePDF(lote, lineasConProrrateo, subtotal, totalLote) {
    return downloadInvoicePDF({
      numeroLabel: `Factura de venta #${lote.numero}`,
      cliente: lote.cliente,
      dateStr: new Date(lote.created_at).toLocaleDateString(),
      lineas: lineasConProrrateo,
      subtotal, envio1: lote.envio1, envio2: lote.envio2, varios: lote.varios, total: totalLote,
      filenameSlug: `factura-venta-${lote.numero}`,
    })
  }

  function shareVentaInvoiceImage(lote, lineasConProrrateo, subtotal, totalLote) {
    return shareInvoiceImage({
      numeroLabel: `Factura de venta #${lote.numero}`,
      cliente: lote.cliente,
      dateStr: new Date(lote.created_at).toLocaleDateString(),
      lineas: lineasConProrrateo,
      subtotal, envio1: lote.envio1, envio2: lote.envio2, varios: lote.varios, total: totalLote,
      filenameSlug: `factura-venta-${lote.numero}`,
    })
  }

  // ---- Wrappers para pedidos web (orders) ----
  function sendOrderInvoiceWhatsApp(order, items, subtotal, total) {
    sendInvoiceWhatsApp({
      numeroLabel: `Pedido #${order.id}`,
      cliente: order.customer_name,
      dateStr: new Date(order.created_at).toLocaleDateString(),
      lineas: items.map(it => ({ plant_name: it._plant ? it._plant.name : 'Planta', quantity: it.quantity, unit_price: it._unitPrice, _lineTotal: it._lineTotal })),
      subtotal, envio1: order.envio1, envio2: order.envio2, varios: order.varios, total,
    })
  }

  function shareOrderInvoiceImage(order, items, subtotal, total) {
    return shareInvoiceImage({
      numeroLabel: `Pedido #${order.id}`,
      cliente: order.customer_name,
      dateStr: new Date(order.created_at).toLocaleDateString(),
      lineas: items.map(it => ({ plant_name: it._plant ? it._plant.name : 'Planta', quantity: it.quantity, unit_price: it._unitPrice, _lineTotal: it._lineTotal })),
      subtotal, envio1: order.envio1, envio2: order.envio2, varios: order.varios, total,
      filenameSlug: `factura-pedido-${order.id}`,
    })
  }

  function downloadOrderInvoicePDF(order, items, subtotal, total) {
    return downloadInvoicePDF({
      numeroLabel: `Pedido #${order.id}`,
      cliente: order.customer_name,
      dateStr: new Date(order.created_at).toLocaleDateString(),
      lineas: items.map(it => ({ plant_name: it._plant ? it._plant.name : 'Planta', quantity: it.quantity, unit_price: it._unitPrice, _lineTotal: it._lineTotal })),
      subtotal, envio1: order.envio1, envio2: order.envio2, varios: order.varios, total,
      filenameSlug: `factura-pedido-${order.id}`,
    })
  }

  async function addDecremento(e) {
    e.preventDefault()
    if (!decForm.plant_id || !decForm.quantity || !decForm.motivo) {
      alert('Selecciona la planta, cantidad y motivo')
      return
    }
    if (decForm.motivo === 'Otro' && !decForm.motivo_otro.trim()) {
      alert('Escribe el motivo')
      return
    }
    setSavingDec(true)
    const plant = plants.find(p => p.id === decForm.plant_id)
    const quantity = Number(decForm.quantity)
    const payload = {
      plant_id: decForm.plant_id,
      plant_name: plant ? plant.name : '',
      quantity,
      motivo: decForm.motivo,
      motivo_otro: decForm.motivo === 'Otro' ? decForm.motivo_otro : null,
      unit_price: decForm.motivo === 'Venta' ? Number(decForm.unit_price) || (plant ? Number(plant.price) : 0) : null,
    }

    if (!isOnline()) {
      await addToQueue('decremento', { decremento: payload, plantId: decForm.plant_id, quantity })
      if (plant) {
        setPlants(prev => prev.map(p => p.id === plant.id ? { ...p, stock: Math.max(0, p.stock - quantity) } : p))
      }
      setDecForm({ plant_id: '', quantity: '', motivo: '', motivo_otro: '', unit_price: '' })
      setSavingDec(false)
      setPendingCount(await queueLength())
      alert('Sin conexión: la venta se guardó en el celular y se subirá sola cuando vuelva la señal.')
      return
    }

    const { error: decError } = await supabase.from('decrementos').insert(payload)
    if (decError) { alert('Error al registrar el decremento: ' + decError.message); setSavingDec(false); return }
    if (plant) {
      await supabase.from('plants').update({ stock: Math.max(0, plant.stock - quantity), stock_disponible: Math.max(0, (plant.stock_disponible ?? plant.stock) - quantity) }).eq('id', plant.id)
    }
    setDecForm({ plant_id: '', quantity: '', motivo: '', motivo_otro: '', unit_price: '' })
    setSavingDec(false)
    loadData()
  }

  // ---------- Stock actual ----------
  async function updatePlantDiscount(id, percent) {
    const value = percent === '' ? 0 : Math.max(0, Math.min(100, Number(percent) || 0))
    await supabase.from('plants').update({ discount_percent: value }).eq('id', id)
    loadData()
  }

  // ---------- Intercambios (trueque) ----------
  const hoyISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
  const plantPorNombre = name => plants.find(p => normalizarBusqueda(p.name) === normalizarBusqueda(String(name || '').trim()))
  // Al editar, una fila que ya existía y conserva su nombre sigue apuntando a su planta original (aunque luego la hayas renombrado)
  const resolverPlantaFila = r => {
    if (r.itemId && r.origPlantId && normalizarBusqueda(String(r.name || '').trim()) === normalizarBusqueda(r.origName || '')) {
      const orig = plants.find(x => String(x.id) === String(r.origPlantId))
      if (orig) return orig
    }
    return plantPorNombre(r.name)
  }

  function abrirNuevoIntercambio() {
    setIntForm({ id: null, contacto: '', fecha: hoyISO(), nota: '', entregados: [{ name: '', qty: 1 }], recibidos: [{ name: '', qty: 1 }] })
    setIntFormOpen(true)
  }

  function abrirEditarIntercambio(i) {
    const its = intercambioItems.filter(x => x.intercambio_id === i.id)
    const fila = x => {
      const pl = plants.find(q => String(q.id) === String(x.plant_id))
      const nombre = pl ? pl.name : x.plant_name
      return { itemId: x.id, name: nombre, origName: nombre, qty: x.quantity, origQty: x.quantity, origPlantId: String(x.plant_id) }
    }
    setIntForm({
      id: i.id, contacto: i.contacto || '', fecha: i.fecha || hoyISO(), nota: i.nota || '',
      entregados: its.filter(x => x.direccion === 'entregado').map(fila),
      recibidos: its.filter(x => x.direccion === 'recibido').map(fila),
    })
    setIntFormOpen(true)
  }

  // Guarda los cambios de un intercambio ya registrado. Se recalcula el stock con la diferencia:
  // lo entregado antes vuelve al inventario y lo entregado ahora sale; lo recibido solo cuenta (suma) si su línea está "Establecida".
  async function editarIntercambio() {
    if (intSaving) return
    const inter = intercambios.find(x => x.id === intForm.id)
    if (!inter) { alert('No se encontró el intercambio.'); return }
    const contacto = intForm.contacto.trim()
    if (!contacto) { alert('Escribe el nombre de la persona o contacto.'); return }
    const armar = r => ({ itemId: r.itemId || null, name: r.name.trim(), qty: Math.floor(Number(r.qty) || 0), planta: resolverPlantaFila(r) })
    const entregados = intForm.entregados.filter(r => r.name.trim()).map(armar)
    const recibidos = intForm.recibidos.filter(r => r.name.trim()).map(armar)
    if (entregados.length === 0 && recibidos.length === 0) { alert('Deja al menos una planta en el intercambio.'); return }
    const sinPlanta = entregados.find(r => !r.planta)
    if (sinPlanta) { alert(`"${sinPlanta.name}" no existe en tu galería. En "Lo que entregué" elige plantas que ya tengas.`); return }
    if (entregados.concat(recibidos).some(r => r.qty <= 0)) { alert('Cada planta necesita una cantidad mayor a 0.'); return }

    const old = intercambioItems.filter(x => x.intercambio_id === inter.id)
    const oldPorId = new Map(old.map(x => [x.id, x]))
    const efecto = (dir, estado, qty) => (dir === 'entregado' ? -qty : (estado === 'establecida' ? qty : 0))
    const delta = new Map() // plantId -> cambio neto en el stock
    const suma = (pid, d) => { if (d) delta.set(String(pid), (delta.get(String(pid)) || 0) + d) }
    old.forEach(x => suma(x.plant_id, -efecto(x.direccion, x.estado, x.quantity))) // se deshace lo anterior
    entregados.forEach(r => suma(r.planta.id, efecto('entregado', null, r.qty)))
    recibidos.forEach(r => { const antes = r.itemId ? oldPorId.get(r.itemId) : null; if (r.planta && antes) suma(r.planta.id, efecto('recibido', antes.estado, r.qty)) })
    for (const [pid, d] of delta) {
      const pl = plants.find(x => String(x.id) === pid)
      if (pl && (Number(pl.stock) || 0) + d < 0) { alert(`No alcanza el stock de "${pl.name}": tienes ${pl.stock || 0} y este cambio necesita ${-d} más.`); return }
    }

    setIntSaving(true)
    try {
      const { error: e0 } = await supabase.from('intercambios').update({ fecha: intForm.fecha || hoyISO(), contacto, nota: intForm.nota.trim() || null }).eq('id', inter.id)
      if (e0) throw new Error(e0.message)
      const creadas = new Map() // plantas nuevas creadas en esta edición (aún no están en la lista cargada)
      const crearPlanta = async nombre => {
        const { data: nueva, error: e3 } = await supabase.from('plants').insert({ name: nombre, category_id: null, price: 0, stock: 0, image_url: null, active: false, flagged: false }).select().single()
        if (e3 || !nueva) throw new Error(`No se pudo crear "${nombre}": ${e3 ? e3.message : ''}`)
        creadas.set(String(nueva.id), nueva)
        return nueva
      }
      const mantenidos = new Set()
      const inserts = []
      for (const [dir, lista] of [['entregado', entregados], ['recibido', recibidos]]) {
        for (const r of lista) {
          let pl = r.planta
          if (!pl) pl = await crearPlanta(r.name) // solo pasa en "recibí": planta nueva, oculta y con stock 0
          if (r.itemId && oldPorId.has(r.itemId)) {
            mantenidos.add(r.itemId)
            const antes = oldPorId.get(r.itemId)
            if (String(antes.plant_id) !== String(pl.id) || antes.quantity !== r.qty) {
              const { error: e1 } = await supabase.from('intercambio_items').update({ plant_id: String(pl.id), plant_name: pl.name, quantity: r.qty }).eq('id', r.itemId)
              if (e1) throw new Error(e1.message)
            }
            if (dir === 'recibido' && !r.planta && antes.estado === 'establecida') suma(pl.id, r.qty)
          } else {
            inserts.push(dir === 'entregado'
              ? { intercambio_id: inter.id, direccion: 'entregado', plant_id: String(pl.id), plant_name: pl.name, quantity: r.qty }
              : { intercambio_id: inter.id, direccion: 'recibido', plant_id: String(pl.id), plant_name: pl.name, quantity: r.qty, estado: 'cuarentena', estado_fecha: new Date().toISOString() })
          }
        }
      }
      if (inserts.length) {
        const { error: e2 } = await supabase.from('intercambio_items').insert(inserts)
        if (e2) throw new Error(e2.message)
      }
      const borrar = old.filter(x => !mantenidos.has(x.id)).map(x => x.id)
      if (borrar.length) {
        const { error: e5 } = await supabase.from('intercambio_items').delete().in('id', borrar)
        if (e5) throw new Error(e5.message)
      }
      for (const [pid, d] of delta) {
        const pl = plants.find(x => String(x.id) === pid) || creadas.get(pid)
        if (!pl) continue
        const nuevoStock = Math.max(0, (Number(pl.stock) || 0) + d)
        const patch = { stock: nuevoStock }
        if (d < 0 && pl.stock_disponible != null) patch.stock_disponible = Math.min(Number(pl.stock_disponible) || 0, nuevoStock)
        const { error: e4 } = await supabase.from('plants').update(patch).eq('id', pl.id)
        if (e4) throw new Error(`No se pudo ajustar el stock de "${pl.name}": ${e4.message}`)
      }
      setIntFormOpen(false)
      alert(`Intercambio ${folioInt(inter)} actualizado.`)
    } catch (err) {
      alert('No se pudo guardar el cambio: ' + (err instanceof Error ? err.message : String(err)) + '\n\nRevisa el intercambio: puede haberse guardado solo en parte.')
    } finally {
      setIntSaving(false)
      await loadData()
    }
  }

  async function guardarIntercambio() {
    if (intSaving) return
    if (intForm.id) return editarIntercambio()
    const contacto = intForm.contacto.trim()
    if (!contacto) { alert('Escribe el nombre de la persona o contacto.'); return }
    const armar = r => ({ name: r.name.trim(), qty: Math.floor(Number(r.qty) || 0), planta: plantPorNombre(r.name) })
    const entregados = intForm.entregados.filter(r => r.name.trim()).map(armar)
    const recibidos = intForm.recibidos.filter(r => r.name.trim()).map(armar)
    if (entregados.length === 0 && recibidos.length === 0) { alert('Agrega al menos una planta.'); return }
    const sinPlanta = entregados.find(r => !r.planta)
    if (sinPlanta) { alert(`"${sinPlanta.name}" no existe en tu galería. En "Lo que entregué" elige plantas que ya tengas.`); return }
    if (entregados.concat(recibidos).some(r => r.qty <= 0)) { alert('Cada planta necesita una cantidad mayor a 0.'); return }
    const salida = new Map() // lo que sale del inventario (junta las repetidas)
    entregados.forEach(r => salida.set(r.planta.id, (salida.get(r.planta.id) || 0) + r.qty))
    for (const [id, qty] of salida) {
      const pl = plants.find(x => x.id === id)
      if ((Number(pl.stock) || 0) < qty) { alert(`No alcanza el stock de "${pl.name}": tienes ${pl.stock || 0} y entregas ${qty}.`); return }
    }
    setIntSaving(true)
    let cabecera = null
    try {
      const { data: cab, error: e1 } = await supabase.from('intercambios').insert({ fecha: intForm.fecha || hoyISO(), contacto, nota: intForm.nota.trim() || null }).select().single()
      if (e1 || !cab) throw new Error(e1 ? e1.message : 'No se pudo crear el intercambio')
      cabecera = cab
      const filas = entregados.map(r => ({ intercambio_id: cab.id, direccion: 'entregado', plant_id: String(r.planta.id), plant_name: r.planta.name, quantity: r.qty }))
      for (const r of recibidos) {
        let pl = r.planta
        if (!pl) { // planta nueva: se crea oculta y con stock 0
          const { data: nueva, error: e3 } = await supabase.from('plants').insert({ name: r.name, category_id: null, price: 0, stock: 0, image_url: null, active: false, flagged: false }).select().single()
          if (e3 || !nueva) throw new Error(`No se pudo crear "${r.name}": ${e3 ? e3.message : ''}`)
          pl = nueva
        }
        filas.push({ intercambio_id: cab.id, direccion: 'recibido', plant_id: String(pl.id), plant_name: pl.name, quantity: r.qty, estado: 'cuarentena', estado_fecha: new Date().toISOString() })
      }
      const { error: e2 } = await supabase.from('intercambio_items').insert(filas)
      if (e2) throw new Error(e2.message)
      for (const [id, qty] of salida) { // lo entregado sale del inventario
        const pl = plants.find(x => x.id === id)
        const nuevoStock = Math.max(0, (Number(pl.stock) || 0) - qty)
        const patch = { stock: nuevoStock }
        if (pl.stock_disponible != null) patch.stock_disponible = Math.min(Number(pl.stock_disponible) || 0, nuevoStock)
        const { error: e4 } = await supabase.from('plants').update(patch).eq('id', id)
        if (e4) throw new Error(`No se pudo descontar "${pl.name}": ${e4.message}`)
      }
      setIntFormOpen(false)
      alert(`Intercambio ${folioInt(cab)} guardado.` + (recibidos.length ? ' Lo recibido quedó en cuarentena y no suma al stock hasta que pase a "Establecida".' : ''))
    } catch (err) {
      if (cabecera) await supabase.from('intercambios').delete().eq('id', cabecera.id) // se borra con sus líneas
      const msg = err instanceof Error ? err.message : String(err)
      if (/intercambio/i.test(msg) && /(does not exist|schema cache|relation)/i.test(msg)) setIntercambiosOk(false)
      alert('No se pudo guardar el intercambio: ' + msg)
    } finally {
      setIntSaving(false)
      await loadData()
    }
  }

  // Cambia el estado de una planta recibida. Solo "Establecida" cuenta en el stock.
  async function cambiarEstadoIntercambio(item, nuevo) {
    if (item.estado === nuevo) return
    const delta = (nuevo === 'establecida' ? item.quantity : 0) - (item.estado === 'establecida' ? item.quantity : 0)
    if (item.estado === 'establecida' && !confirm(`Esta planta ya estaba en tu inventario. Se descontarán ${item.quantity} del stock de "${item.plant_name}". ¿Continuar?`)) return
    const { error } = await supabase.from('intercambio_items').update({ estado: nuevo, estado_fecha: new Date().toISOString() }).eq('id', item.id)
    if (error) { alert('No se pudo cambiar el estado: ' + error.message); return }
    const pl = plants.find(x => String(x.id) === String(item.plant_id))
    if (pl && delta !== 0) await supabase.from('plants').update({ stock: Math.max(0, (Number(pl.stock) || 0) + delta) }).eq('id', pl.id)
    await loadData()
  }

  async function eliminarIntercambio(i) {
    const its = intercambioItems.filter(x => x.intercambio_id === i.id)
    if (!confirm(`¿Borrar ${folioInt(i)}?\n\nLo que entregaste vuelve al inventario y lo recibido que ya estaba "Establecida" se descuenta.`)) return
    const { error } = await supabase.from('intercambios').delete().eq('id', i.id)
    if (error) { alert('No se pudo borrar: ' + error.message); return }
    const delta = new Map()
    its.forEach(x => {
      const d = x.direccion === 'entregado' ? x.quantity : (x.estado === 'establecida' ? -x.quantity : 0)
      if (d) delta.set(String(x.plant_id), (delta.get(String(x.plant_id)) || 0) + d)
    })
    for (const [pid, d] of delta) {
      const pl = plants.find(x => String(x.id) === pid)
      if (pl) await supabase.from('plants').update({ stock: Math.max(0, (Number(pl.stock) || 0) + d) }).eq('id', pl.id)
    }
    await loadData()
  }

  // Foto que muestra el carrusel de la tienda para una planta (null = la portada, Foto 1)
  async function setCarouselPhoto(id, url) {
    const plant = plants.find(x => x.id === id)
    if (!plant) return
    const value = url && url !== plant.image_url ? url : null
    const { error } = await supabase.from('plants').update({ carousel_image_url: value }).eq('id', id)
    if (error) {
      alert(/carousel_image_url/i.test(error.message)
        ? 'Falta crear una columna en la base de datos. Pega esto en Supabase (SQL Editor) y vuelve a intentar:\n\nalter table plants add column if not exists carousel_image_url text;'
        : 'No se pudo guardar la foto del carrusel: ' + error.message)
      return
    }
    setCarouselPickFor(null)
    await loadData()
  }

  // Descuento escrito en la pantalla Tienda (0 lo quita). Solo plantas, no semillas.
  async function applyDiscountPercent(ids, value) {
    if (ids.length === 0) { alert('El descuento es solo para plantas. Las semillas seleccionadas se ignoran.'); return }
    if (String(value).trim() === '') { alert('Escribe el % de descuento (0 para quitarlo).'); return }
    const percent = Math.max(0, Math.min(100, Number(value) || 0))
    for (let i = 0; i < ids.length; i += 50) {
      const { error } = await supabase.from('plants').update({ discount_percent: percent, on_sale: percent > 0 }).in('id', ids.slice(i, i + 50))
      if (error) { alert('No se pudo aplicar el descuento: ' + error.message); break }
    }
    await loadData()
  }

  // Carrusel de la tienda ("🔜 Próximamente"): pone o quita a varias plantas a la vez
  async function setComingSoonBulk(ids, value) {
    if (ids.length === 0) { alert('El carrusel es solo para plantas. Las semillas seleccionadas se ignoran.'); return }
    for (let i = 0; i < ids.length; i += 50) {
      const { error } = await supabase.from('plants').update({ coming_soon: value }).in('id', ids.slice(i, i + 50))
      if (error) { alert('No se pudo actualizar el carrusel: ' + error.message); break }
    }
    await loadData()
  }

  // Link de la tienda (es el mismo catálogo que ve el cliente): no marca nada, solo lo envía
  async function sendStoreLink() {
    const link = `${window.location.origin}/?shared=1`
    const shareText = `🌿 Catálogo Diamantev:\n${link}`
    try {
      if (navigator.share) await navigator.share({ title: 'Plantas Diamantev', text: shareText })
      else window.open(`https://wa.me/?text=${encodeURIComponent(shareText)}`, '_blank')
    } catch (err) {
      if (!(err && err.name === 'AbortError')) alert('No se pudo compartir. Intenta de nuevo.')
    }
  }

  async function applyBulkDiscount(ids) {
    if (ids.length === 0) return
    const input = prompt(`¿Qué % de descuento querés aplicar a las ${ids.length} planta(s) seleccionada(s)? (0 para quitar el descuento)`)
    if (input === null) return
    const percent = Math.max(0, Math.min(100, Number(input) || 0))
    await supabase.from('plants').update({ discount_percent: percent, on_sale: percent > 0 }).in('id', ids)
    loadData()
  }

  async function updatePlantHeight(id, height) {
    await supabase.from('plants').update({ height: height.trim() }).eq('id', id)
    loadData()
  }

  async function updatePlantName(id, newName) {
    const name = newName.trim()
    if (!name) return
    await syncPlantName(id, name)
    loadData()
  }

  // Campos de compra del borrador para la compra elegida. Si la compra pertenece a un lote
  // (compra agrupada), N.°, fecha y proveedor son los del lote; si fue registrada a mano, los de la línea.
  function invCompraFields(cs, ls, compraId) {
    const c = cs.find(x => String(x.id) === String(compraId))
    if (!c) return { compraId: '', numero: '', fecha: '', proveedor: '' }
    const l = c.lote_id ? ls.find(x => x.id === c.lote_id) : null
    return {
      compraId: c.id,
      numero: l && l.numero != null ? String(l.numero) : '',
      fecha: dateToInputValue(l ? l.created_at : c.created_at),
      proveedor: (l ? l.proveedor : c.proveedor) || c.proveedor || '',
    }
  }

  // Crea la categoría en la BD y la deja elegida en el borrador (se asigna a la planta al Guardar cambios)
  async function createCategoryForPlantInv() {
    const name = inlineNewCategoryName.trim()
    if (!name) { alert('Ponle un nombre a la categoría'); return }
    const { data, error } = await supabase.from('categories').insert({ name, emoji: inlineNewCategoryEmoji || '🌿' }).select().single()
    if (error) { alert('Error al crear la categoría: ' + error.message); return }
    setCategories(prev => [...prev, data].sort((a, b) => String(a.name).localeCompare(String(b.name))))
    setPlantInvDraft(d => (d ? { ...d, categoryId: data.id } : d))
    setShowInlineNewCategory(false)
    setInlineNewCategoryName('')
    setInlineNewCategoryEmoji('🌿')
  }

  // Guarda de una vez todo el panel "Compra e inventario" de la planta abierta
  async function savePlantInv() {
    const d = plantInvDraft
    if (!d || !plantInv || savingPlantInv) return
    const plantId = d.plantId
    const stock = Math.max(0, parseInt(d.stock, 10) || 0)
    const stockDisponible = Math.max(0, Math.min(stock, parseInt(d.stockDisponible, 10) || 0))
    const printed = Math.max(0, parseInt(d.printed, 10) || 0)
    const placed = Math.max(0, Math.min(printed, parseInt(d.placed, 10) || 0))
    const compra = plantInv.compras.find(c => String(c.id) === String(d.compraId)) || null
    const lote = compra && compra.lote_id ? plantInv.lotes.find(l => l.id === compra.lote_id) : null
    const proveedor = d.proveedor.trim() || null
    const fechaISO = d.fecha ? new Date(d.fecha + 'T12:00:00').toISOString() : null

    // Validaciones antes de escribir nada
    let numero = null
    if (lote && String(d.numero).trim() !== '') {
      numero = Number(d.numero)
      if (!Number.isInteger(numero) || numero < 1) { alert('El N.° de compra debe ser un número entero mayor que 0'); return }
      if (numero !== lote.numero && lotes.some(l => l.id !== lote.id && l.numero === numero)) {
        alert(`Ya existe la compra #${numero}. Elige otro número.`)
        return
      }
    }

    setSavingPlantInv(true)
    const errores = []

    // 1) Planta: categoría, stock y etiquetas
    const plantUpdates = { category_id: d.categoryId || null, stock, stock_disponible: stockDisponible, label_printed_count: printed, label_placed_count: placed }
    const { error: pErr } = await supabase.from('plants').update(plantUpdates).eq('id', plantId)
    if (pErr) errores.push('inventario: ' + pErr.message)
    else setPlants(prev => prev.map(pl => (pl.id === plantId ? { ...pl, ...plantUpdates } : pl)))

    // 2) Compra: N.°, fecha y proveedor
    if (compra) {
      if (lote) {
        const updates = { proveedor }
        if (fechaISO) updates.created_at = fechaISO
        if (numero != null && numero !== lote.numero) updates.numero = numero
        const { error: lErr } = await supabase.from('compra_lotes').update(updates).eq('id', lote.id)
        if (lErr) {
          errores.push('compra: ' + lErr.message)
        } else {
          setLotes(prev => prev.map(l => (l.id === lote.id ? { ...l, ...updates } : l)))
          setPlantInv(prev => (prev ? { ...prev, lotes: prev.lotes.map(l => (l.id === lote.id ? { ...l, ...updates } : l)) } : prev))
          // Las líneas de la compra llevan una copia del proveedor: se mantiene igual que el lote
          if ((lote.proveedor || null) !== proveedor) {
            const { error: e2 } = await supabase.from('compras').update({ proveedor }).eq('lote_id', lote.id)
            if (e2) {
              errores.push('proveedor de las líneas: ' + e2.message)
            } else {
              setCompras(prev => prev.map(c => (c.lote_id === lote.id ? { ...c, proveedor } : c)))
              setPlantInv(prev => (prev ? { ...prev, compras: prev.compras.map(c => (c.lote_id === lote.id ? { ...c, proveedor } : c)) } : prev))
            }
          }
          if (updates.numero != null) loadData() // reordena las compras por su nuevo número (en segundo plano)
        }
      } else {
        const updates = { proveedor }
        if (fechaISO) updates.created_at = fechaISO
        const { error: cErr } = await supabase.from('compras').update(updates).eq('id', compra.id)
        if (cErr) {
          errores.push('compra: ' + cErr.message)
        } else {
          setCompras(prev => prev.map(c => (c.id === compra.id ? { ...c, ...updates } : c)))
          setPlantInv(prev => (prev ? { ...prev, compras: prev.compras.map(c => (c.id === compra.id ? { ...c, ...updates } : c)) } : prev))
        }
      }
    }

    setSavingPlantInv(false)
    if (errores.length > 0) {
      alert('Algunos cambios no se pudieron guardar:\n- ' + errores.join('\n- '))
      return
    }
    const saved = {
      ...d,
      stock: String(stock),
      printed: String(printed),
      placed: String(placed),
      proveedor: proveedor || '',
      numero: numero != null ? String(numero) : d.numero,
    }
    setPlantInvDraft(saved)
    setPlantInvBase(saved)
    setPlantInvMsg('✔ Cambios guardados')
    setTimeout(() => setPlantInvMsg(''), 2500)
  }

  async function updateStock(id, newStock) {
    await supabase.from('plants').update({ stock: newStock }).eq('id', id)
    loadData()
  }

  async function updatePrice(id, newPrice) {
    await supabase.from('plants').update({ price: newPrice }).eq('id', id)
    loadData()
  }

  async function copySharedLink() {
    const link = `${window.location.origin}/?shared=1`
    await navigator.clipboard.writeText(link)
    alert('Link copiado. Muestra las plantas que están en la tienda. Pégalo en WhatsApp para enviarlo.')
  }

  async function markSelectedShared(idsSet, value) {
    const ids = Array.from(idsSet)
    if (ids.length === 0) return
    await supabase.from('plants').update({ shared_visible: value }).in('id', ids)
    loadData()
  }

  // ---------- Marca "para cliente" (Modo Tienda Cliente en la Galería) ----------
  // En ese modo la casilla de cada foto cambia este campo; es independiente de "shared_visible" (link público compartido).
  // Requiere la columna plants.marcado_cliente (boolean, default false).
  function alertMarcadoClienteError(error) {
    const msg = String(error?.message || '')
    if (msg.includes('marcado_cliente') || error?.code === 'PGRST204' || error?.code === '42703') {
      alert('Falta crear la columna "marcado_cliente" en la tabla plants. Ejecuta en Supabase (SQL Editor):\n\nalter table plants add column if not exists marcado_cliente boolean not null default false;')
    } else {
      alert('No se pudo guardar la marca de cliente: ' + msg)
    }
  }

  function alertColorError(error) {
    const msg = String(error?.message || '')
    if (msg.includes('color') || error?.code === 'PGRST204' || error?.code === '42703') {
      alert('Falta crear las columnas de color en la tabla plants. Ejecuta en Supabase (SQL Editor):\n\nalter table plants add column if not exists color text;\nalter table plants add column if not exists color_manual boolean not null default false;')
    } else {
      alert('No se pudo guardar el color: ' + msg)
    }
  }

  // Color puesto a mano (una o varias plantas): queda protegido, la detección automática no lo pisa.
  async function setPlantsColor(ids, color) {
    if (!ids || ids.length === 0) return
    const patch = { color, color_manual: true }
    const undo = patchLocal(setPlants, plants, ids, patch)
    for (let i = 0; i < ids.length; i += 50) {
      const { error } = await supabase.from('plants').update(patch).in('id', ids.slice(i, i + 50))
      if (error) { undo(); alertColorError(error); return }
    }
  }

  // Detecta el color con la foto y lo guarda (color_manual = false).
  async function runColorDetection(targets, silent = false) {
    const list = targets.filter(p => p.image_url)
    if (list.length === 0 || colorRunning.current) return
    colorRunning.current = true
    setColorScan({ done: 0, total: list.length })
    let done = 0, failed = 0
    try {
      for (const p of list) {
        colorTried.current.add(p.id)
        try {
          const color = await detectColorFromUrl(p.image_url)
          if (color) {
            const patch = { color, color_manual: false }
            const { error } = await supabase.from('plants').update(patch).eq('id', p.id)
            if (error) { if (silent) console.error(error); else alertColorError(error); break }
            setPlants(prev => prev.map(r => (r.id === p.id ? { ...r, ...patch } : r)))
          } else failed++
        } catch (e) { console.error('Color:', e); failed++ }
        done++
        setColorScan({ done, total: list.length })
      }
    } finally {
      colorRunning.current = false
      setColorScan(null)
    }
    if (failed > 0 && !silent) alert(`No se pudo detectar el color de ${failed} planta(s) (foto sin flor clara o que no cargó). Asígnalas a mano tocando 🎨 en su tarjeta.`)
  }

  async function redetectColors(ids) {
    const targets = plants.filter(p => ids.includes(p.id) && p.image_url)
    if (targets.length === 0) { alert('Estas plantas no tienen foto para detectar el color.'); return }
    for (let i = 0; i < ids.length; i += 50) {
      await supabase.from('plants').update({ color_manual: false }).in('id', ids.slice(i, i + 50))
    }
    setPlants(prev => prev.map(r => (ids.includes(r.id) ? { ...r, color_manual: false } : r)))
    runColorDetection(targets)
  }

  async function toggleMarcadoCliente(id, current) {
    const next = !current
    const undo = patchLocal(setPlants, plants, [id], { marcado_cliente: next }) // se ve al instante
    const { error } = await supabase.from('plants').update({ marcado_cliente: next }).eq('id', id)
    if (error) { undo(); alertMarcadoClienteError(error) }
  }

  async function markSelectedCliente(idsSet, value) {
    const ids = Array.from(idsSet)
    if (ids.length === 0) return
    const undo = patchLocal(setPlants, plants, ids, { marcado_cliente: value })
    // Por lotes de 50: con cientos de ids, una sola consulta .in() puede exceder el largo de URL permitido.
    for (let i = 0; i < ids.length; i += 50) {
      const { error } = await supabase.from('plants').update({ marcado_cliente: value }).in('id', ids.slice(i, i + 50))
      if (error) { undo(); alertMarcadoClienteError(error); loadData(); return }
    }
  }

  // Las semillas se seleccionan con ids "seed:<id del lote>"; las tablas de plantas no las conocen.
  function isSeedId(id) { return String(id).startsWith('seed:') }
  // Orden natural por nombre (Epidendrum 2 antes que 10); los nombres-código al final.
  function labelItemsList() {
    return [...plants, ...seedBatchesAsItems()].sort((a, b) => {
      const ca = esNombreCodigo(a.name), cb = esNombreCodigo(b.name)
      if (ca !== cb) return ca ? 1 : -1
      return naturalCollator.compare(a.name || '', b.name || '')
    })
  }
  function selectedRealPlantIds() { return Array.from(selectedLabels).filter(id => !isSeedId(id)) }
  function requireRealPlantIds() {
    const ids = selectedRealPlantIds()
    if (ids.length === 0) { alert('Esta acción es solo para plantas. Las semillas seleccionadas se ignoran.') }
    return ids
  }
  function markSelectedClienteAll(set, value) {
    const ids = Array.from(set)
    markSelectedCliente(new Set(ids.filter(id => !isSeedId(id))), value)
    markSeedBatchesCliente(ids.filter(isSeedId).map(id => id.slice(5)), value)
  }

  async function markPlantsAction(ids, field) {
    ids = ids.filter(id => !isSeedId(id))
    if (ids.length === 0) return
    await supabase.from('plants').update({ [field]: new Date().toISOString() }).in('id', ids)
    loadData()
  }

  // Etiquetas: en vez de un solo estado, cada planta lleva dos contadores.
  // "Impresas" = cuántas copias de su etiqueta salieron de la imprenta en total.
  // "Colocadas" = cuántas de esas ya están puestas en el jardín.
  // La resta (impresas - colocadas) es el "stock" de etiquetas sin pegar todavía.
  function labelStatusOf(p) {
    const printed = Number(p.label_printed_count) || 0
    const placed = Number(p.label_placed_count) || 0
    if (printed === 0) return 'disponible' // nunca se generó
    if (placed < printed) return 'sobrante' // tiene de sobra sin pegar
    return 'colocada' // todo lo impreso ya está colocado
  }

  async function addPrintedLabels(idsWithQty) {
    for (const { id, qty } of idsWithQty) {
      if (!qty || qty <= 0 || isSeedId(id)) continue
      const plant = plants.find(p => p.id === id)
      const current = Number(plant?.label_printed_count) || 0
      await supabase.from('plants').update({ label_printed_count: current + qty }).eq('id', id)
    }
    await loadData()
  }

  async function incrementLabelPlaced(id) {
    const plant = plants.find(p => p.id === id)
    if (!plant) return
    const printed = Number(plant.label_printed_count) || 0
    const placed = Number(plant.label_placed_count) || 0
    if (placed >= printed) return
    await supabase.from('plants').update({ label_placed_count: placed + 1 }).eq('id', id)
    loadData()
  }

  async function updateLabelCounts(id, printed, placed) {
    const p = Math.max(0, Number(printed) || 0)
    const c = Math.max(0, Math.min(p, Number(placed) || 0))
    await supabase.from('plants').update({ label_printed_count: p, label_placed_count: c }).eq('id', id)
    loadData()
  }

  async function markAllPlacedForSelected(ids) {
    for (const id of ids) {
      const plant = plants.find(p => p.id === id)
      const printed = Number(plant?.label_printed_count) || 0
      await supabase.from('plants').update({ label_placed_count: printed }).eq('id', id)
    }
    await loadData()
  }

  async function toggleIsNew(id, current) {
    await supabase.from('plants').update({ is_new: !current }).eq('id', id)
    loadData()
  }

  async function updatePlantCategory(id, categoryId) {
    await supabase.from('plants').update({ category_id: categoryId || null }).eq('id', id)
    loadData()
  }

  async function toggleOnSale(id, current) {
    await supabase.from('plants').update({ on_sale: !current }).eq('id', id)
    loadData()
  }

  async function toggleComingSoon(id, current) {
    await supabase.from('plants').update({ coming_soon: !current }).eq('id', id)
    loadData()
  }

  async function updatePlantImage(id, file) {
    if (!file) return
    const url = await uploadImage(file)
    if (url) {
      await supabase.from('plants').update({ image_url: url }).eq('id', id)
      loadData()
    }
  }

  async function updatePlantExtraImage(id, field, file) {
    if (!file) return
    const url = await uploadImage(file)
    if (url) {
      await supabase.from('plants').update({ [field]: url }).eq('id', id)
      loadData()
    }
  }

  // Intercambia la foto elegida con la Foto 1 (portada de galería, catálogo, etiquetas y fotos compartidas)
  async function swapPlantCover(id, field) {
    const plant = plants.find(x => x.id === id)
    if (!plant || !plant[field]) return
    const { error } = await supabase.from('plants').update({ image_url: plant[field], [field]: plant.image_url || null }).eq('id', id)
    if (error) { alert('No se pudo cambiar la portada: ' + error.message); return }
    setPhotoModalIndex(0)
    loadData()
  }

  async function updatePlantVideo(id, file) {
    if (!file) return
    const url = await uploadImage(file, 'plant-photos')
    if (url) {
      await supabase.from('plants').update({ video_url: url }).eq('id', id)
      loadData()
    }
  }

  async function updatePlantDescription(id, description) {
    await supabase.from('plants').update({ description }).eq('id', id)
    loadData()
  }

  async function toggleFlag(id, current) {
    await supabase.from('plants').update({ flagged: !current, flag_comment: !current ? '' : null }).eq('id', id)
    loadData()
  }

  async function updateFlagComment(id, comment) {
    await supabase.from('plants').update({ flag_comment: comment }).eq('id', id)
    loadData()
  }

  async function repairPendingPlantLinks() {
    // Antes solo agarraba compras con categoría asignada; esto dejaba afuera líneas viejas
    // (ej. de "Escanear factura") que quedaron sin categoría Y sin planta creada.
    const pendientes = compras.filter(c => !c.plant_id && c.plant_name)
    if (pendientes.length === 0) { alert('No hay compras pendientes por vincular. Todo está en orden.'); return }
    if (!confirm(`Se encontraron ${pendientes.length} línea(s) de compra sin planta creada (nunca llegaron a "Recibido"). Se creará una planta para cada una (con stock 0) y quedará enlazada. ¿Continuar?`)) return
    let fixed = 0
    for (const c of pendientes) {
      const { data: newPlant, error } = await supabase.from('plants').insert({
        name: c.plant_name,
        category_id: c.new_plant_category || null,
        price: c.sale_price || 0,
        stock: 0,
        image_url: c.image_url || null,
        active: false,
        flagged: !c.new_plant_category,
      }).select().single()
      if (!error && newPlant) {
        await supabase.from('compras').update({ plant_id: newPlant.id }).eq('id', c.id)
        fixed++
      }
    }
    await loadData()
    alert(`Listo, se crearon y enlazaron ${fixed} planta(s). Ya deberían aparecer en Galería (con stock 0) y ser encontrables por sus filtros de compra. Las que quedaron sin categoría están marcadas "🚩 Para revisar".`)
  }

  async function createCategoryAndAssign(plantId, name, emoji) {
    if (!name.trim()) { alert('Ponle un nombre a la categoría'); return }
    const { data, error } = await supabase.from('categories').insert({ name: name.trim(), emoji: emoji || '🌿' }).select().single()
    if (error) { alert('Error al crear la categoría: ' + error.message); return }
    await supabase.from('plants').update({ category_id: data.id }).eq('id', plantId)
    setShowInlineNewCategory(false)
    setInlineNewCategoryName('')
    setInlineNewCategoryEmoji('🌿')
    loadData()
  }

  async function deletePlant(id, onSuccess) {
    if (!confirm('¿Borrar esta planta permanentemente? Esta acción no se puede deshacer.')) return
    const { error } = await supabase.from('plants').delete().eq('id', id)
    if (error) {
      if (error.code === '23503') {
        alert('Esta planta no se puede borrar porque todavía tiene historial relacionado (compras, ventas, notas, floraciones, etc. — se perdería ese historial).')
      } else {
        alert('Error al borrar la planta: ' + error.message)
      }
      return
    }
    await loadData()
    if (onSuccess) onSuccess()
  }

  // ---------- Notas libres por planta ----------
  function openNewPlantNote(plantId) {
    setCurrentNotePlantId(plantId)
    setEditingPlantNoteId(null)
    setPlantNoteBlocks([])
    setPlantNoteCurrentText('')
    setPlantNoteEditIndex(null)
    setPlantNoteModalOpen(true)
  }

  function openEditPlantNote(note) {
    setCurrentNotePlantId(note.plant_id)
    setEditingPlantNoteId(note.id)
    setPlantNoteBlocks(note.content_blocks || [])
    setPlantNoteCurrentText('')
    setPlantNoteEditIndex(null)
    setPlantNoteModalOpen(true)
  }

  function commitPlantNoteText() {
    if (!plantNoteCurrentText.trim()) return
    setPlantNoteBlocks(prev => [...prev, { type: 'text', content: plantNoteCurrentText.trim(), at: new Date().toISOString() }])
    setPlantNoteCurrentText('')
  }
  function startEditPlantNoteBlock(i) {
    setPlantNoteEditIndex(i)
    setPlantNoteEditText(plantNoteBlocks[i].content)
  }
  function cancelEditPlantNoteBlock() {
    setPlantNoteEditIndex(null)
    setPlantNoteEditText('')
  }
  function saveEditPlantNoteBlock() {
    setPlantNoteBlocks(prev => prev.map((b, i) => (i === plantNoteEditIndex ? { ...b, content: plantNoteEditText, editedAt: new Date().toISOString() } : b)))
    cancelEditPlantNoteBlock()
  }
  function deletePlantNoteBlock(i) {
    if (!confirm('¿Borrar esta entrada de la nota?')) return
    setPlantNoteBlocks(prev => prev.filter((_, idx) => idx !== i))
    if (plantNoteEditIndex === i) cancelEditPlantNoteBlock()
  }

  function insertPhotoBlockToPlantNote(files) {
    const list = files instanceof FileList || Array.isArray(files) ? Array.from(files) : (files ? [files] : [])
    if (list.length === 0) return
    setPlantNoteBlocks(prev => {
      const next = [...prev]
      if (plantNoteCurrentText.trim()) next.push({ type: 'text', content: plantNoteCurrentText.trim(), at: new Date().toISOString() })
      list.forEach(file => next.push({ type: 'photo', file, at: new Date().toISOString() }))
      return next
    })
    setPlantNoteCurrentText('')
  }

  function insertVideoBlockToPlantNote(file) {
    if (!file) return
    setPlantNoteBlocks(prev => {
      const next = [...prev]
      if (plantNoteCurrentText.trim()) next.push({ type: 'text', content: plantNoteCurrentText.trim(), at: new Date().toISOString() })
      next.push({ type: 'video', file, at: new Date().toISOString() })
      return next
    })
    setPlantNoteCurrentText('')
  }

  function removeLastPlantNoteBlock() {
    setPlantNoteBlocks(prev => prev.slice(0, -1))
  }

  function togglePlantNoteDictation() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SpeechRecognition) {
      alert('El dictado por este botón no está disponible en este navegador (funciona en Chrome para Android). En iPhone, usa el micrófono del teclado para dictar directo en el cuadro de texto.')
      return
    }
    if (isDictatingPlantNote) {
      plantNoteWantDictationRef.current = false
      plantNoteRecognitionRef.current?.stop()
      return
    }
    const recognition = new SpeechRecognition()
    recognition.lang = 'es-ES'
    recognition.continuous = true
    recognition.interimResults = false
    recognition.onresult = event => {
      let finalText = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) finalText += event.results[i][0].transcript
      }
      if (finalText.trim()) {
        setPlantNoteCurrentText(prev => (prev.trim() ? prev.trim() + ' ' : '') + finalText.trim())
      }
    }
    recognition.onerror = e => { if (e.error === 'not-allowed' || e.error === 'service-not-allowed') plantNoteWantDictationRef.current = false }
    // El navegador corta el dictado tras unos segundos de silencio; si la persona no lo detuvo
    // a propósito (con el botón ⏹️), lo volvemos a iniciar para que sienta que "no dejó de escuchar".
    recognition.onend = () => {
      if (plantNoteWantDictationRef.current) { try { recognition.start(); return } catch { /* seguir y apagar */ } }
      setIsDictatingPlantNote(false)
    }
    plantNoteWantDictationRef.current = true
    recognition.start()
    plantNoteRecognitionRef.current = recognition
    setIsDictatingPlantNote(true)
  }

  async function savePlantNote() {
    if (!currentNotePlantId) return
    const blocks = [...plantNoteBlocks]
    if (plantNoteCurrentText.trim()) blocks.push({ type: 'text', content: plantNoteCurrentText.trim(), at: new Date().toISOString() })
    if (blocks.length === 0) return
    setSavingPlantNote(true)

    if (!isOnline()) {
      await addToQueue('plant_note', { plantId: currentNotePlantId, editingNoteId: editingPlantNoteId, blocks })
      setPlantNoteBlocks([])
      setPlantNoteCurrentText('')
      setEditingPlantNoteId(null)
      setSavingPlantNote(false)
      setPlantNoteModalOpen(false)
      setPendingCount(await queueLength())
      alert('Sin conexión: la nota se guardó en el celular y se subirá sola cuando vuelva la señal.')
      return
    }

    const finalBlocks = []
    for (const b of blocks) {
      if (b.type === 'text') {
        finalBlocks.push(b)
      } else if (b.url) {
        finalBlocks.push(b)
      } else {
        const url = await uploadImage(b.file, 'category-notes')
        if (url) { const { file, ...rest } = b; finalBlocks.push({ ...rest, url }) }
      }
    }
    const { error } = editingPlantNoteId
      ? await supabase.from('plant_notes').update({ content_blocks: finalBlocks }).eq('id', editingPlantNoteId)
      : await supabase.from('plant_notes').insert({ plant_id: currentNotePlantId, content_blocks: finalBlocks })
    if (error) { alert('Error al guardar la nota: ' + error.message); setSavingPlantNote(false); return }
    setPlantNoteBlocks([])
    setPlantNoteCurrentText('')
    setEditingPlantNoteId(null)
    setSavingPlantNote(false)
    setPlantNoteModalOpen(false)
    loadData()
  }

  async function deletePlantNote(id) {
    if (!confirm('¿Borrar esta nota permanentemente?')) return
    await supabase.from('plant_notes').delete().eq('id', id)
    loadData()
  }

  // ---------- Historial: floraciones por planta ----------
  async function addFloracion(plantId, fecha) {
    const { error } = await supabase.from('floraciones').insert({ plant_id: plantId, fecha })
    if (error) { alert('Error al registrar la floración: ' + error.message); return }
    setShowCustomFloracionDate(false)
    setCustomFloracionDate('')
    loadData()
  }

  async function deleteFloracion(id) {
    if (!confirm('¿Borrar este registro de floración?')) return
    await supabase.from('floraciones').delete().eq('id', id)
    loadData()
  }

  // ---------- Historial: hijos (propágulos) por planta ----------
  function hijosEnDesarrollo(plantId) {
    return pups
      .filter(x => x.plant_id === plantId)
      .reduce((sum, x) => x.tipo === 'movido' ? sum - x.cantidad : sum + x.cantidad, 0)
  }

  async function addPupRegistro(plantId, fecha, cantidad) {
    const cant = Number(cantidad)
    if (!cant || cant <= 0) { alert('Ingresa una cantidad válida'); return }
    const { error } = await supabase.from('plant_pups').insert({ plant_id: plantId, fecha, cantidad: cant, tipo: 'registro' })
    if (error) { alert('Error al registrar los hijos: ' + error.message); return }
    setShowCustomPupDate(false)
    setCustomPupDate('')
    setNewPupCantidad('')
    loadData()
  }

  // ---------- Separar un "mix" en variedades ----------
  // Crea (o suma a) una planta por cada variedad, descuenta del mix y reparte el costo de la compra
  // por unidad: las unidades que salen del mix se llevan su costo (y su parte del envío, porque las filas
  // nuevas quedan en la misma compra). Las plantas nuevas quedan ocultas hasta que les pongas foto.
  async function splitMix(mix, rows) {
    if (splittingMix) return
    const items = rows
      .map(r => ({ name: String(r.name || '').trim(), qty: Math.floor(Number(r.qty) || 0) }))
      .filter(r => r.name || r.qty)
    if (items.length === 0) { alert('Escribe al menos una variedad con su cantidad.'); return }
    if (items.some(r => !r.name || r.qty <= 0)) { alert('Cada variedad necesita un nombre y una cantidad mayor a 0.'); return }
    const keys = items.map(r => r.name.toLowerCase())
    if (new Set(keys).size !== keys.length) { alert('Hay nombres repetidos en la lista. Junta esas cantidades en una sola fila.'); return }
    if (keys.includes(String(mix.name).trim().toLowerCase())) { alert('Una variedad no puede llamarse igual que el mix. Cámbiale el nombre.'); return }
    const total = items.reduce((sum, r) => sum + r.qty, 0)
    const stockMix = Number(mix.stock) || 0
    if (total > stockMix) { alert(`Sumas ${total}, pero el mix solo tiene ${stockMix} en stock.`); return }
    const existentes = items.map(r => plants.find(p => p.id !== mix.id && String(p.name).trim().toLowerCase() === r.name.toLowerCase()))
    const nuevas = existentes.filter(x => !x).length
    const resumen = items.map((r, i) => `• ${r.name}: ${r.qty}${existentes[i] ? ' (se suma a la planta que ya existe)' : ' (planta nueva)'}`).join('\n')
    if (!confirm(`Separar ${total} de "${mix.name}":\n${resumen}\n\nEn el mix quedan ${stockMix - total}.`)) return

    setSplittingMix(true)
    try {
      // Compras ya recibidas del mix, de la más antigua a la más nueva: de ahí salen las unidades y su costo.
      const fuentes = compras
        .filter(c => c.plant_id === mix.id && recibidoDe(c) && Number(c.quantity) > 0)
        .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
        .map(c => ({ c, restante: Number(c.quantity) }))
      const salen = new Map() // id de compra -> unidades que salen del mix

      for (let i = 0; i < items.length; i++) {
        const it = items[i]
        let planta = existentes[i]
        if (planta) {
          const { error } = await supabase.from('plants').update({ stock: (Number(planta.stock) || 0) + it.qty }).eq('id', planta.id)
          if (error) throw new Error(`No se pudo sumar stock a "${planta.name}": ${error.message}`)
        } else {
          const { data, error } = await supabase.from('plants').insert({
            name: it.name,
            category_id: mix.category_id || null,
            price: mix.price || 0,
            stock: it.qty,
            image_url: null,
            active: false,
            flagged: !mix.category_id,
          }).select().single()
          if (error || !data) throw new Error(`No se pudo crear "${it.name}": ${error ? error.message : 'sin respuesta'}`)
          planta = data
        }
        let faltan = it.qty
        for (const f of fuentes) {
          if (faltan <= 0) break
          if (f.restante <= 0) continue
          const take = Math.min(faltan, f.restante)
          const unit = Number(f.c.unit_cost) || 0
          const cantOriginal = Number(f.c.quantity) || 1
          const { id: _id, numero: _numero, plant_id: _pid, plant_name: _pn, quantity: _q, total: _t, image_url: _img, new_plant_category: _npc, ...resto } = f.c
          const fila = { ...resto, plant_id: planta.id, plant_name: planta.name, quantity: take, total: take * unit, image_url: null }
          if (resto.anticipo != null) fila.anticipo = Number(resto.anticipo) * take / cantOriginal // el abono se reparte igual
          const { error } = await supabase.from('compras').insert(fila)
          if (error) throw new Error(`No se pudo repartir el costo de "${it.name}": ${error.message}`)
          f.restante -= take
          faltan -= take
          salen.set(f.c.id, (salen.get(f.c.id) || 0) + take)
        }
      }

      // Las compras originales del mix bajan (o se borran si quedaron en 0)
      for (const f of fuentes) {
        const sale = salen.get(f.c.id) || 0
        if (sale <= 0) continue
        const cantOriginal = Number(f.c.quantity) || 0
        const nueva = cantOriginal - sale
        if (nueva > 0) {
          const patch = { quantity: nueva, total: nueva * (Number(f.c.unit_cost) || 0) }
          if (f.c.anticipo != null) patch.anticipo = Number(f.c.anticipo) * nueva / cantOriginal
          await supabase.from('compras').update(patch).eq('id', f.c.id)
        } else {
          await supabase.from('compras').delete().eq('id', f.c.id)
        }
      }

      const nuevoStock = stockMix - total
      const patchMix = { stock: nuevoStock }
      if (mix.stock_disponible != null) patchMix.stock_disponible = Math.min(Number(mix.stock_disponible) || 0, nuevoStock)
      const { error: eMix } = await supabase.from('plants').update(patchMix).eq('id', mix.id)
      if (eMix) throw new Error('No se pudo descontar el stock del mix: ' + eMix.message)

      setMixRows([{ name: '', qty: '' }, { name: '', qty: '' }])
      alert(`Listo: se separaron ${total} de "${mix.name}".` + (nuevas ? ` Las ${nuevas} planta(s) nueva(s) quedaron ocultas hasta que les pongas foto y las actives.` : ''))
    } catch (err) {
      alert('Algo falló al separar el mix: ' + (err instanceof Error ? err.message : String(err)) + '\n\nRevisa la Galería y las compras por si quedó algo a medias.')
    } finally {
      setSplittingMix(false)
      loadData()
    }
  }

  async function moverPupsAStock(plant, cantidad) {
    const cant = Number(cantidad)
    const disponibles = hijosEnDesarrollo(plant.id)
    if (!cant || cant <= 0) { alert('Ingresa una cantidad válida'); return }
    if (cant > disponibles) { alert(`Solo tienes ${disponibles} hijo(s) en desarrollo`); return }
    const fecha = localDateISO()
    const { error } = await supabase.from('plant_pups').insert({ plant_id: plant.id, fecha, cantidad: cant, tipo: 'movido' })
    if (error) { alert('Error al pasar a stock: ' + error.message); return }
    await supabase.from('plants').update({ stock: (plant.stock || 0) + cant }).eq('id', plant.id)
    setShowMoverPupsForm(false)
    setMoverPupsCantidad('')
    loadData()
  }

  async function deletePup(id) {
    if (!confirm('¿Borrar este registro?')) return
    await supabase.from('plant_pups').delete().eq('id', id)
    loadData()
  }

  // ---------- Ingreso de Semillas (lotes independientes, con o sin planta identificada) ----------
  function openSbNote(batch) {
    setCurrentNoteSeedBatchId(batch.id)
    setSbNoteBlocks(batch.content_blocks || [])
    setSbNoteCurrentText('')
    setSbNoteEditIndex(null)
    setSbNoteModalOpen(true)
  }

  function commitSbNoteText() {
    if (!sbNoteCurrentText.trim()) return
    setSbNoteBlocks(prev => [...prev, { type: 'text', content: sbNoteCurrentText.trim(), at: new Date().toISOString() }])
    setSbNoteCurrentText('')
  }
  function startEditSbNoteBlock(i) {
    setSbNoteEditIndex(i)
    setSbNoteEditText(sbNoteBlocks[i].content)
  }
  function cancelEditSbNoteBlock() {
    setSbNoteEditIndex(null)
    setSbNoteEditText('')
  }
  function saveEditSbNoteBlock() {
    setSbNoteBlocks(prev => prev.map((b, i) => (i === sbNoteEditIndex ? { ...b, content: sbNoteEditText, editedAt: new Date().toISOString() } : b)))
    cancelEditSbNoteBlock()
  }
  function deleteSbNoteBlock(i) {
    if (!confirm('¿Borrar esta entrada de la nota?')) return
    setSbNoteBlocks(prev => prev.filter((_, idx) => idx !== i))
    if (sbNoteEditIndex === i) cancelEditSbNoteBlock()
  }

  function insertPhotoBlockToSbNote(file) {
    if (!file) return
    setSbNoteBlocks(prev => {
      const next = [...prev]
      if (sbNoteCurrentText.trim()) next.push({ type: 'text', content: sbNoteCurrentText.trim(), at: new Date().toISOString() })
      next.push({ type: 'photo', file, at: new Date().toISOString() })
      return next
    })
    setSbNoteCurrentText('')
  }

  function insertVideoBlockToSbNote(file) {
    if (!file) return
    setSbNoteBlocks(prev => {
      const next = [...prev]
      if (sbNoteCurrentText.trim()) next.push({ type: 'text', content: sbNoteCurrentText.trim(), at: new Date().toISOString() })
      next.push({ type: 'video', file, at: new Date().toISOString() })
      return next
    })
    setSbNoteCurrentText('')
  }

  function removeLastSbNoteBlock() {
    setSbNoteBlocks(prev => prev.slice(0, -1))
  }

  async function saveSbNote() {
    if (!currentNoteSeedBatchId) return
    const blocks = [...sbNoteBlocks]
    if (sbNoteCurrentText.trim()) blocks.push({ type: 'text', content: sbNoteCurrentText.trim(), at: new Date().toISOString() })
    setSavingSbNote(true)
    const finalBlocks = []
    for (const b of blocks) {
      if (b.type === 'text') {
        finalBlocks.push(b)
      } else if (b.url) {
        finalBlocks.push(b)
      } else {
        const url = await uploadImage(b.file, 'category-notes')
        if (url) { const { file, ...rest } = b; finalBlocks.push({ ...rest, url }) }
      }
    }
    const { error } = await supabase.from('seed_batches').update({ content_blocks: finalBlocks }).eq('id', currentNoteSeedBatchId)
    if (error) { alert('Error al guardar la nota: ' + error.message); setSavingSbNote(false); return }
    setSbNoteBlocks([])
    setSbNoteCurrentText('')
    setSavingSbNote(false)
    setSbNoteModalOpen(false)
    loadData()
  }

  function resetSbForm() {
    setSbForm({ origen: 'cosecha', plant_id: '', category_id: '', nombre: '', es_noid: false, proveedor: '', cantidad_semillas: '', fecha: '', price: '' })
    setSbFormFile(null)
  }

  // Foto del lote de semillas: se guarda como bloque de foto en las notas del lote (sin columnas nuevas);
  // la primera foto es la que se ve en Galería y Tabla.
  async function addSeedBatchPhoto(batch, file, comoPrincipal = true) {
    if (!file) return
    const url = await uploadImage(file, 'category-notes')
    if (!url) return
    const actuales = Array.isArray(batch.content_blocks) ? batch.content_blocks : []
    const nuevo = { type: 'photo', url, at: new Date().toISOString() }
    const bloques = comoPrincipal ? [nuevo, ...actuales] : [...actuales, nuevo]
    const { error } = await supabase.from('seed_batches').update({ content_blocks: bloques }).eq('id', batch.id)
    if (error) { alert('No se pudo guardar la foto: ' + error.message); return }
    loadData()
  }

  async function saveReplanteo() {
    const f = replanteoForm
    if (!f) return
    const sb = seedBatches.find(b => b.id === f.batchId)
    if (!sb) return
    if (!f.texto.trim() && !f.file) { alert('Escribe qué está pasando con el replanteo (o agrega una foto)'); return }
    setSavingReplanteo(true)
    const at = new Date((f.fecha || localDateISO()) + 'T12:00:00').toISOString()
    const nuevos = []
    nuevos.push({ type: 'text', kind: 'replanteo', content: `🪴 Replanteo — ${f.texto.trim() || '(sin detalle)'}`, at })
    if (f.file) {
      const url = await uploadImage(f.file, 'category-notes')
      if (url) nuevos.push({ type: 'photo', url, at })
    }
    const bloques = [...(Array.isArray(sb.content_blocks) ? sb.content_blocks : []), ...nuevos]
    const patch = { content_blocks: bloques }
    if (sb.estado === 'semillas' || sb.estado === 'sembrado') patch.estado = 'en_crecimiento'
    const { error } = await supabase.from('seed_batches').update(patch).eq('id', sb.id)
    setSavingReplanteo(false)
    if (error) { alert('No se pudo guardar el replanteo: ' + error.message); return }
    setReplanteoForm(null)
    loadData()
  }

  function onSbFormPlantChange(plantId) {
    const plant = plants.find(pp => pp.id === plantId)
    setSbForm(f => ({ ...f, plant_id: plantId, nombre: plant ? plant.name : f.nombre, category_id: plant ? (plant.category_id || '') : f.category_id }))
  }

  async function saveSeedBatch() {
    const cant = Number(sbForm.cantidad_semillas)
    if (!cant || cant <= 0) { alert('Ingresa la cantidad de semillas'); return }
    if (sbForm.origen === 'cosecha' && !sbForm.plant_id) { alert('Elige de qué planta cosechaste'); return }
    if (!sbForm.es_noid && !sbForm.category_id && sbForm.origen !== 'cosecha') { alert('Elige una categoría o marca como NOID'); return }
    let content_blocks = []
    if (sbFormFile) {
      const url = await uploadImage(sbFormFile, 'category-notes')
      if (url) content_blocks = [{ type: 'photo', url, at: new Date().toISOString() }]
    }
    const { error } = await supabase.from('seed_batches').insert({
      content_blocks,
      origen: sbForm.origen,
      plant_id: sbForm.origen === 'cosecha' ? sbForm.plant_id : null,
      category_id: sbForm.es_noid ? null : (sbForm.category_id || null),
      nombre: sbForm.es_noid ? (sbForm.nombre || 'NOID') : (sbForm.nombre || null),
      es_noid: sbForm.es_noid,
      proveedor: sbForm.origen === 'compra' ? (sbForm.proveedor || null) : null,
      cantidad_semillas: cant,
      fecha: sbForm.fecha || localDateISO(),
      price: sbForm.price ? Number(sbForm.price) : null,
      stock: cant,
      estado: 'semillas',
      costo: 0,
      envio1: 0,
      envio2: 0,
      varios: 0,
    })
    if (error) { alert('Error al guardar: ' + error.message); return }
    resetSbForm()
    setSbFormOpen(false)
    loadData()
  }

  async function updateSeedBatchField(id, field, value) {
    await supabase.from('seed_batches').update({ [field]: value }).eq('id', id)
    loadData()
  }

  async function deleteSeedBatch(id) {
    if (!confirm('¿Borrar este lote de semillas y todo su historial?')) return
    await supabase.from('seed_batches').delete().eq('id', id)
    loadData()
  }

  function openConvertSeedBatch(batch) {
    setSbConvertId(batch.id)
    setSbConvertForm({
      nombre: batch.nombre && batch.nombre !== 'NOID' ? batch.nombre : '',
      category_id: batch.category_id || '',
      price: batch.price || '',
      stock: '',
    })
  }

  // Copia el seguimiento del lote (germinación, replanteo, notas, fotos) a las notas de la planta,
  // para seguir anotando ahí hasta que florezca y se venda.
  async function traerSeguimientoSemillas(sb, plantId, avisar = true) {
    const bl = Array.isArray(sb.content_blocks) ? sb.content_blocks : []
    const cab = { type: 'text', fromSeedBatch: sb.id, at: new Date().toISOString(), content: `🌰 Seguimiento desde semillas — ${seedBatchRawName(sb)} (${sb.fecha ? new Date(sb.fecha + 'T00:00:00').toLocaleDateString() : 'sin fecha'}${sb.proveedor ? ` · ${sb.proveedor}` : ''}, ${Number(sb.cantidad_semillas) || 0} semillas)` }
    const { error } = await supabase.from('plant_notes').insert({ plant_id: plantId, content_blocks: [cab, ...bl] })
    if (error) { if (avisar) alert('No se pudo copiar el seguimiento: ' + error.message); return false }
    return true
  }

  async function confirmConvertSeedBatch(batch) {
    if (!sbConvertForm.nombre.trim()) { alert('Ponle un nombre a la planta'); return }
    if (!sbConvertForm.category_id) { alert('Elige una categoría'); return }
    const stock = Number(sbConvertForm.stock) || 0
    const { data: newPlant, error } = await supabase.from('plants').insert({
      name: sbConvertForm.nombre.trim(),
      category_id: sbConvertForm.category_id,
      price: sbConvertForm.price ? Number(sbConvertForm.price) : 0,
      stock,
      active: true,
    }).select().single()
    if (error) { alert('Error al crear la planta: ' + error.message); return }
    await supabase.from('seed_batches').update({ estado: 'catalogado', converted_plant_id: newPlant.id }).eq('id', batch.id)
    await traerSeguimientoSemillas(batch, newPlant.id, false)
    // La planta pertenece a la compra de semillas: se registra su compra con el costo del lote repartido entre las plantas.
    const totalSemillas = (Number(batch.costo) || 0) + (Number(batch.envio1) || 0) + (Number(batch.envio2) || 0) + (Number(batch.varios) || 0)
    const cantCompra = Math.max(stock, 1)
    const unitCost = totalSemillas > 0 ? totalSemillas / cantCompra : 0
    const filaCompra = {
      plant_id: newPlant.id,
      plant_name: newPlant.name,
      quantity: cantCompra,
      unit_cost: unitCost,
      sale_price: null,
      image_url: null,
      total: unitCost * cantCompra,
      proveedor: batch.origen === 'compra' ? (batch.proveedor || null) : null,
      status: 'recibido',
      lote_id: null,
    }
    if (batch.fecha) filaCompra.created_at = batch.fecha
    await supabase.from('compras').insert(filaCompra)
    setSbConvertId(null)
    loadData()
    alert(`Listo, "${sbConvertForm.nombre}" ya está catalogada en Galería.`)
  }

  async function addRetroCompra(plant, form) {
    if (!form.quantity) { alert('Completa al menos la cantidad'); return }
    const quantity = Number(form.quantity) || 0
    const unit_cost = Number(form.unit_cost) || 0
    const row = {
      plant_id: plant.id,
      plant_name: plant.name,
      quantity,
      unit_cost,
      sale_price: null,
      image_url: null,
      total: quantity * unit_cost,
      proveedor: form.proveedor || null,
      status: 'recibido',
      lote_id: null,
    }
    if (form.fecha) row.created_at = form.fecha
    const { error } = await supabase.from('compras').insert(row)
    if (error) { alert('Error al agregar el dato de compra: ' + error.message); return }
    setShowRetroCompraForm(false)
    setRetroCompraForm({ proveedor: '', fecha: '', quantity: '', unit_cost: '' })
    loadData()
  }

  // ---------- Categorías ----------
  async function uploadCategoryImage(catId, file) {
    const url = await uploadImage(file)
    if (url) {
      await supabase.from('categories').update({ image_url: url }).eq('id', catId)
      loadData()
    }
  }

  async function updateCategoryEmoji(catId, emoji) {
    await supabase.from('categories').update({ emoji }).eq('id', catId)
    loadData()
  }

  async function updateCategoryName(catId, name) {
    if (!name.trim()) return
    await supabase.from('categories').update({ name }).eq('id', catId)
    loadData()
  }

  async function addCategory(e) {
    e.preventDefault()
    if (!newCatName.trim()) return
    await supabase.from('categories').insert({ name: newCatName, emoji: newCatEmoji, parent_id: newCatParentId || null })
    setNewCatName('')
    setNewCatEmoji('🌿')
    setNewCatParentId('')
    loadData()
  }

  async function updateCategoryParent(id, parentId) {
    await supabase.from('categories').update({ parent_id: parentId || null }).eq('id', id)
    loadData()
  }

  async function deleteCategory(id) {
    const hasChildren = categories.some(c => c.parent_id === id)
    if (hasChildren) { alert('Esta categoría agrupa otras — primero cambiales el "Grupo" a otra cosa (o "Sin agrupar") antes de borrar esta.'); return }
    const plantsUsingIt = plants.filter(p => p.category_id === id).length
    if (plantsUsingIt > 0) { alert(`Hay ${plantsUsingIt} planta(s) con esta categoría — cambiales la categoría antes de borrarla.`); return }
    if (!confirm('¿Borrar esta categoría permanentemente?')) return
    const { error } = await supabase.from('categories').delete().eq('id', id)
    if (error) { alert('Error al borrar la categoría: ' + error.message); return }
    loadData()
  }

  // Categorías que tienen al menos una hija: son "carpetas" agrupadoras y no se le
  // pueden asignar directo a una planta (solo sirven para organizar/filtrar).
  function isParentCategory(categoryId) {
    return categories.some(c => c.parent_id === categoryId)
  }

  // Lista de categorías asignables a una planta (deja afuera las que son solo agrupadoras)
  function assignableCategories() {
    return categories.filter(c => !isParentCategory(c.id))
  }

  // ---------- Etiquetas para imprimir ----------
  function toggleLabelSelect(id) {
    setSelectedLabels(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function openSelector(type) {
    setActiveSelector(type)
    setCatFilterSearch('')
    setProvFilterSearch('')
    setLoteFilterSearch('')
    setVentaLoteFilterSearch('')
  }

  // Selección directa: aplica el filtro al tocar la opción y cierra el selector,
  // sin paso intermedio de "Confirmar selección".
  function selectAndClose(type, value) {
    if (type === 'categoria') setGalleryFilter(value)
    if (type === 'proveedor') setGalleryProveedor(value)
    if (type === 'compra') setGalleryLoteNumero(value)
    if (type === 'ventaLote') setGalleryVentaLoteNumero(value)
    setActiveSelector(null)
  }

  function toggleGalleryMissingFilter(key) {
    setGalleryMissingFilters(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function setGalleryTriState(hasKey, noKey, value) {
    setGalleryMissingFilters(prev => {
      const next = new Set(prev)
      next.delete(hasKey)
      next.delete(noKey)
      if (value === 'has') next.add(hasKey)
      if (value === 'no') next.add(noKey)
      return next
    })
  }

  function getGalleryTriState(hasKey, noKey) {
    if (galleryMissingFilters.has(hasKey)) return 'has'
    if (galleryMissingFilters.has(noKey)) return 'no'
    return 'all'
  }

  // ---------- Fila de íconos de filtro: flechas para deslizarla ----------
  function updateIconEdge() {
    const el = iconRowRef.current
    if (!el) return
    const start = el.scrollLeft <= 2
    const end = el.scrollLeft + el.clientWidth >= el.scrollWidth - 2
    setIconRowEdge(prev => (prev.start === start && prev.end === end ? prev : { start, end }))
  }
  function scrollIconRow(dir) {
    const el = iconRowRef.current
    if (!el) return
    el.scrollBy({ left: dir * Math.max(120, el.clientWidth * 0.7), behavior: 'smooth' })
  }

  function closeLabelModal() {
    setLabelQtyModalOpen(false)
    setLabelBulk({ id: null, name: null })
  }

  function selectAllLabels(list) {
    setSelectedLabels(new Set(list.map(p => p.id)))
  }

  function clearLabels() {
    setSelectedLabels(new Set())
  }

  function printLabels() {
    const ids = Array.from(selectedLabels)
    markPlantsAction(ids, 'printed_at')
    addPrintedLabels(ids.map(id => ({ id, qty: Math.max(1, Number(labelQuantities[id]) || 1) })))
    window.print()
  }

  async function urlToDataURL(url) {
    const res = await fetch(url)
    const blob = await res.blob()
    return await new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onloadend = () => resolve(reader.result)
      reader.onerror = reject
      reader.readAsDataURL(blob)
    })
  }

  function safeFileName(str, fallback) {
    const clean = (str || fallback || 'archivo').toString().trim().replace(/[^a-zA-Z0-9-_ ]/g, '').replace(/\s+/g, '-')
    return clean || fallback || 'archivo'
  }

  function extFromUrl(url) {
    const match = (url || '').split('?')[0].match(/\.([a-zA-Z0-9]+)$/)
    return match ? match[1] : 'jpg'
  }

  async function downloadFullBackup() {
    if (backupInProgress) return
    setBackupInProgress(true)
    setBackupProgress('Preparando...')
    try {
      const zip = new JSZip()

      // 1) Volcado de todos los datos (tablas) en un solo JSON
      const dataDump = {
        exported_at: new Date().toISOString(),
        categories,
        plants,
        orders,
        compras,
        compra_lotes: lotes,
        venta_lotes: ventaLotes,
        decrementos,
        plant_notes: plantNotes,
        floraciones,
        plant_pups: pups,
        seed_batches: seedBatches,
        seed_batch_events: seedBatchEvents,
      }
      zip.file('datos.json', JSON.stringify(dataDump, null, 2))

      // 2) Reunir todas las fotos/videos referenciados en toda la app
      const mediaJobs = []
      categories.forEach(c => {
        if (c.image_url) mediaJobs.push({ url: c.image_url, path: `categorias/${safeFileName(c.name, c.id)}.${extFromUrl(c.image_url)}` })
      })
      plants.forEach(p => {
        const folder = `plantas/${safeFileName(p.name, p.id)}`
        if (p.image_url) mediaJobs.push({ url: p.image_url, path: `${folder}/foto1.${extFromUrl(p.image_url)}` })
        if (p.extra_image_1) mediaJobs.push({ url: p.extra_image_1, path: `${folder}/foto2.${extFromUrl(p.extra_image_1)}` })
        if (p.extra_image_2) mediaJobs.push({ url: p.extra_image_2, path: `${folder}/foto3.${extFromUrl(p.extra_image_2)}` })
        if (p.extra_image_3) mediaJobs.push({ url: p.extra_image_3, path: `${folder}/foto4.${extFromUrl(p.extra_image_3)}` })
        if (p.video_url) mediaJobs.push({ url: p.video_url, path: `${folder}/video.${extFromUrl(p.video_url)}` })
      })
      plantNotes.forEach(n => {
        const plant = plants.find(p => p.id === n.plant_id)
        const folder = `notas-plantas/${safeFileName(plant?.name, n.plant_id)}`
        ;(n.content_blocks || []).forEach((b, i) => {
          if ((b.type === 'photo' || b.type === 'video') && b.url) {
            mediaJobs.push({ url: b.url, path: `${folder}/nota-${n.id}-${i}.${extFromUrl(b.url)}` })
          }
        })
      })
      compras.forEach(c => {
        if (c.image_url) mediaJobs.push({ url: c.image_url, path: `compras/${safeFileName(compraNombre(c), c.id)}.${extFromUrl(c.image_url)}` })
      })
      lotes.forEach(l => {
        ;(l.content_blocks || []).forEach((b, i) => {
          if ((b.type === 'photo' || b.type === 'video') && b.url) {
            mediaJobs.push({ url: b.url, path: `notas-compras/lote-${l.numero || l.id}-${i}.${extFromUrl(b.url)}` })
          }
        })
      })
      seedBatchEvents.forEach(x => {
        if (x.photo_url) {
          const batch = seedBatches.find(sb => sb.id === x.seed_batch_id)
          mediaJobs.push({ url: x.photo_url, path: `semillas/${safeFileName(batch?.nombre, x.seed_batch_id)}/registro-${x.id}.${extFromUrl(x.photo_url)}` })
        }
      })
      seedBatches.forEach(batch => {
        ;(batch.content_blocks || []).forEach((b, i) => {
          if ((b.type === 'photo' || b.type === 'video') && b.url) {
            mediaJobs.push({ url: b.url, path: `notas-semillas/${safeFileName(batch.nombre, batch.id)}-${i}.${extFromUrl(b.url)}` })
          }
        })
      })

      // 3) Descargar cada archivo y agregarlo al zip
      const failed = []
      for (let i = 0; i < mediaJobs.length; i++) {
        const job = mediaJobs[i]
        setBackupProgress(`Descargando fotos... ${i + 1}/${mediaJobs.length}`)
        try {
          const res = await fetch(job.url)
          const blob = await res.blob()
          zip.file(job.path, blob)
        } catch (err) {
          failed.push(job.path)
        }
      }
      if (failed.length > 0) {
        zip.file('archivos-no-descargados.txt', failed.join('\n'))
      }

      // 4) Comprimir y compartir/descargar
      setBackupProgress('Comprimiendo...')
      const content = await zip.generateAsync({ type: 'blob' }, meta => {
        setBackupProgress(`Comprimiendo... ${Math.round(meta.percent)}%`)
      })
      const today = localDateISO()
      const fileName = `diamantev-respaldo-${today}.zip`
      const file = new File([content], fileName, { type: 'application/zip' })

      let shared = false
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: 'Respaldo Diamantev', text: `Respaldo del ${today}` })
          shared = true
        } catch (shareErr) {
          // el usuario canceló el panel de compartir, o no se pudo: cae al método de descarga normal
          shared = false
        }
      }

      if (!shared) {
        const url = URL.createObjectURL(content)
        const a = document.createElement('a')
        a.href = url
        a.download = fileName
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
      }

      const resumen = `Respaldo listo (${mediaJobs.length - failed.length} de ${mediaJobs.length} archivos incluidos)${failed.length ? `. ${failed.length} no se pudieron descargar, quedaron listados en "archivos-no-descargados.txt" dentro del zip.` : '.'}`
      alert(shared ? resumen : `${resumen}\n\nSe descargó a tu celular. Para guardarlo en Google Drive u otra app: abre el archivo desde las notificaciones o el gestor de archivos, toca "Compartir" y elige la app que quieras.`)
    } catch (err) {
      alert('Error al generar el respaldo: ' + err.message)
    } finally {
      setBackupInProgress(false)
      setBackupProgress('')
    }
  }

  function expandByQuantity(list) {
    return list.flatMap(p => Array(Math.max(1, Number(labelQuantities[p.id]) || 1)).fill(p))
  }

  async function downloadLabelsPPTX(list) {
    const uniqueSelected = list.filter(p => selectedLabels.has(p.id))
    const selected = expandByQuantity(uniqueSelected)
    if (selected.length === 0) return
    setSharingNotes(true)
    try {
      const pptx = new pptxgen()
      pptx.defineLayout({ name: 'HOJA_A4', width: 11.69, height: 8.27 })
      pptx.layout = 'HOJA_A4'

      // Mismas proporciones que la etiqueta en PDF (50mm x 60mm), convertidas a pulgadas.
      const labelW = 1.9685, labelH = 2.3622, marginX = 0.3937, marginY = 0.3937, gapX = 0.1969, gapY = 0.1969
      const cols = Math.max(1, Math.floor((pptx.width - marginX * 2 + gapX) / (labelW + gapX)))
      const rows = Math.max(1, Math.floor((pptx.height - marginY * 2 + gapY) / (labelH + gapY)))
      const perSlide = cols * rows
      const bannerH = 0.42

      let slide = null
      for (let i = 0; i < selected.length; i++) {
        const p = selected[i]
        const idxInSlide = i % perSlide
        if (idxInSlide === 0) slide = pptx.addSlide()
        const col = idxInSlide % cols
        const row = Math.floor(idxInSlide / cols)
        const x = marginX + col * (labelW + gapX)
        const y = marginY + row * (labelH + gapY)

        slide.addShape('rect', { x, y, w: labelW, h: labelH, fill: { color: 'FFFFFF' }, line: { color: '000000', width: 1 } })

        if (p.image_url) {
          try {
            const dataUrl = await urlToDataURL(p.image_url)
            slide.addImage({ data: dataUrl, x, y: y + bannerH, w: labelW, h: labelH - bannerH })
          } catch (e) { /* si falla la foto, se deja el recuadro vacío */ }
        }

        slide.addShape('rect', { x, y, w: labelW, h: bannerH, fill: { color: '1A2E4A' } })
        slide.addText(p.name.toUpperCase(), {
          x, y, w: labelW, h: bannerH,
          align: 'center', valign: 'middle',
          color: 'FFFFFF', bold: true, fontSize: 11, fontFace: 'Arial',
        })
      }

      await pptx.writeFile({ fileName: 'etiquetas-diamantev.pptx' })
      await markPlantsAction(uniqueSelected.map(p => p.id), 'pdf_generated_at')
      await addPrintedLabels(uniqueSelected.map(p => ({ id: p.id, qty: Math.max(1, Number(labelQuantities[p.id]) || 1) })))
    } catch (err) {
      alert('No se pudo generar el PowerPoint. Intenta de nuevo.')
    }
    setSharingNotes(false)
  }

  // ---------- Último PDF de etiquetas guardado ----------
  function openLastLabelsPdf() {
    if (!lastLabelsPdf) return
    const url = URL.createObjectURL(lastLabelsPdf.blob)
    const a = document.createElement('a')
    a.href = url
    a.target = '_blank'
    a.rel = 'noopener'
    a.download = 'etiquetas-diamantev.pdf'
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 60000)
  }

  async function shareLastLabelsPdf() {
    if (!lastLabelsPdf) return
    try {
      const file = new File([lastLabelsPdf.blob], 'etiquetas-diamantev.pdf', { type: 'application/pdf' })
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Etiquetas Diamantev' })
      } else {
        openLastLabelsPdf()
      }
    } catch (err) {
      if (!(err && err.name === 'AbortError')) alert('No se pudo compartir el PDF.')
    }
  }

  async function markLastLabelsPrinted() {
    if (!lastLabelsPdf) return
    if (!confirm('¿Ya se imprimieron estas etiquetas? Se marcarán como impresas, se borrará el PDF guardado y se quitarán de la lista de Etiquetas (la numeración vuelve a empezar en 1 cuando la lista quede vacía).')) return
    const impresas = new Set(lastLabelsPdf.ids || [])
    setModeSets(prev => ({ ...prev, etiquetas: new Set([...prev.etiquetas].filter(id => !impresas.has(id))) }))
    await markPlantsAction(lastLabelsPdf.ids || [], 'printed_at')
    try { await clearLastLabelsPDF() } catch (e) { /* nada */ }
    setLastLabelsPdf(null)
  }

  async function discardLastLabelsPdf() {
    if (!lastLabelsPdf) return
    if (!confirm('¿Borrar el PDF guardado SIN marcarlo como impreso?')) return
    try { await clearLastLabelsPDF() } catch (e) { /* nada */ }
    setLastLabelsPdf(null)
  }

  // PDF único: "Identificación" (foto grande 5x6 cm) y/o "Etiqueta" (mini foto + nombre 6,5x1 cm
  // para grapar en la hoja), según las cantidades elegidas para cada planta (0 = ese tipo no se imprime). Primero van las identificaciones y
  // las etiquetas empiezan en una hoja nueva.
  async function downloadLabelsPDF(list) {
    // Cantidad de cada tipo por planta (0 = no se imprime ese tipo; si no se tocó, 1)
    const qtyOf = (map, id) => { const n = Number(map[id] ?? 1); return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 1 }
    const uniqueSelected = list.filter(p => selectedLabels.has(p.id))
    const idUnique = uniqueSelected.filter(p => qtyOf(labelQuantities, p.id) > 0)
    const nameUnique = uniqueSelected.filter(p => qtyOf(labelNameQuantities, p.id) > 0)
    const idItems = idUnique.flatMap(p => Array(qtyOf(labelQuantities, p.id)).fill(p))
    const nameItems = nameUnique.flatMap(p => Array(qtyOf(labelNameQuantities, p.id)).fill(p))
    if (idItems.length + nameItems.length === 0) return
    setSharingNotes(true)
    try {
      const doc = new jsPDF({ unit: 'mm', format: 'a4' })
      let hasContent = false

      // ---------- Identificaciones (foto grande) ----------
      if (idItems.length > 0) {
        const labelW = 50, labelH = 60, marginX = 10, marginY = 10, gapX = 5, gapY = 5
        const cols = Math.max(1, Math.floor((210 - marginX * 2 + gapX) / (labelW + gapX)))
        const rows = Math.max(1, Math.floor((297 - marginY * 2 + gapY) / (labelH + gapY)))
        const perPage = cols * rows
        const bannerH = 10

        for (let i = 0; i < idItems.length; i++) {
          const p = idItems[i]
          const idxInPage = i % perPage
          if (i > 0 && idxInPage === 0) doc.addPage()
          const col = idxInPage % cols
          const row = Math.floor(idxInPage / cols)
          const x = marginX + col * (labelW + gapX)
          const y = marginY + row * (labelH + gapY)

          doc.setDrawColor(0, 0, 0)
          doc.setLineWidth(0.8)
          doc.rect(x, y, labelW, labelH)

          if (p.image_url) {
            try {
              const dataUrl = await urlToDataURL(p.image_url)
              const mime = (dataUrl.match(/data:image\/(\w+);/) || [])[1] || 'jpeg'
              const format = mime.toUpperCase() === 'JPG' ? 'JPEG' : mime.toUpperCase()
              doc.addImage(dataUrl, format, x, y + bannerH, labelW, labelH - bannerH)
            } catch (e) { /* si falla la foto, se deja el recuadro vacío */ }
          }

          doc.setFillColor(26, 46, 74)
          doc.rect(x, y, labelW, bannerH, 'F')
          doc.setTextColor(255, 255, 255)
          doc.setFont(undefined, 'bold')
          doc.setFontSize(13)
          doc.text(p.name.toUpperCase(), x + labelW / 2, y + bannerH / 2 + 3, { align: 'center', maxWidth: labelW - 4 })
          doc.setFont(undefined, 'normal')
        }
        hasContent = true
      }

      // ---------- Etiquetas (mini foto + nombre, 6,5 x 1 cm) ----------
      if (nameItems.length > 0) {
        if (hasContent) doc.addPage()
        const labelW = 65, labelH = 10, gapX = 1.5, gapY = 2, marginY = 10
        const photoW = labelH // mini foto cuadrada, del alto de la etiqueta
        const PT = 0.3528 // 1 pt en mm
        const cols = Math.max(1, Math.floor((210 - 12 + gapX) / (labelW + gapX)))
        const marginX = (210 - (cols * labelW + (cols - 1) * gapX)) / 2 // centradas en la hoja
        const rows = Math.max(1, Math.floor((297 - marginY * 2 + gapY) / (labelH + gapY)))
        const perPage = cols * rows

        // Recorta la foto a cuadrado y la reduce (así el PDF pesa poco aunque haya muchas etiquetas).
        async function squareThumb(url) {
          try {
            const img = await loadImageEl(url)
            if (!img) return null
            const S = 160
            const canvas = document.createElement('canvas')
            canvas.width = S
            canvas.height = S
            const ctx = canvas.getContext('2d')
            const side = Math.min(img.width, img.height)
            ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, S, S)
            return canvas.toDataURL('image/jpeg', 0.8)
          } catch { return null }
        }
        const thumbs = new Map() // una sola descarga por planta, aunque pidas varias copias

        doc.setDrawColor(130, 130, 130)
        doc.setLineWidth(0.2)
        doc.setTextColor(0, 0, 0)

        for (let i = 0; i < nameItems.length; i++) {
          const p = nameItems[i]
          const idxInPage = i % perPage
          if (i > 0 && idxInPage === 0) doc.addPage()
          const col = idxInPage % cols
          const row = Math.floor(idxInPage / cols)
          const x = marginX + col * (labelW + gapX)
          const y = marginY + row * (labelH + gapY)

          if (!thumbs.has(p.id)) thumbs.set(p.id, p.image_url ? await squareThumb(p.image_url) : null)
          const thumb = thumbs.get(p.id)
          if (thumb) {
            try { doc.addImage(thumb, 'JPEG', x, y, photoW, labelH, `th-${p.id}`) } catch (e) { /* sin foto */ }
          }
          doc.rect(x, y, labelW, labelH)

          // Zona del texto: a la derecha de la foto (o toda la etiqueta si no hay foto)
          const textX0 = thumb ? x + photoW : x
          const textW = labelW - (thumb ? photoW : 0)
          const maxW = textW - 3
          const cx = textX0 + textW / 2

          const name = String(p.name || '').toUpperCase()
          doc.setFont(undefined, 'bold')
          // Una sola línea: baja el tamaño de letra hasta que el nombre entre.
          let size = 14
          doc.setFontSize(size)
          while (size > 6 && doc.getTextWidth(name) > maxW) {
            size -= 0.5
            doc.setFontSize(size)
          }
          if (doc.getTextWidth(name) <= maxW) {
            doc.text(name, cx, y + labelH / 2 + size * PT * 0.35, { align: 'center' })
          } else {
            // Nombre muy largo (o código): lo parte en dos líneas.
            size = 7
            doc.setFontSize(size)
            const lines = doc.splitTextToSize(name, maxW).slice(0, 2)
            const lineH = size * PT * 1.15
            const firstBaseline = y + labelH / 2 - ((lines.length - 1) * lineH) / 2 + size * PT * 0.35
            lines.forEach((ln, k) => doc.text(ln, cx, firstBaseline + k * lineH, { align: 'center' }))
          }
          doc.setFont(undefined, 'normal')
        }
        hasContent = true
      }

      // Se guarda una copia en este navegador para poder abrirla otra vez hasta marcarla como impresa
      try {
        const blob = doc.output('blob')
        const meta = { createdAt: new Date().toISOString(), ids: idUnique.map(p => p.id), idCount: idItems.length, nameCount: nameItems.length }
        await saveLastLabelsPDF(blob, meta)
        setLastLabelsPdf({ blob, ...meta })
      } catch (e) { /* si el navegador no deja guardar, el PDF igual se descarga */ }
      doc.save('etiquetas-diamantev.pdf')
      // Solo las identificaciones cuentan para el contador de etiquetas impresas/colocadas.
      if (idUnique.length > 0) {
        await markPlantsAction(idUnique.map(p => p.id), 'pdf_generated_at')
        await addPrintedLabels(idUnique.map(p => ({ id: p.id, qty: qtyOf(labelQuantities, p.id) })))
      }
    } catch (err) {
      alert('No se pudo generar el PDF. Intenta de nuevo.')
    }
    setSharingNotes(false)
  }

  async function shareSelectedPhotos(plantsList) {
    let selected = plantsList.filter(p => selectedLabels.has(p.id))
    if (shareOnlyStock) selected = selected.filter(p => p.stock > 0)
    if (selected.length === 0) return
    setSharingNotes(true)
    try {
      await markSelectedShared(new Set(selected.map(p => p.id)), true)
      const link = `${window.location.origin}/?shared=1`
      const shareText = `🌿 Catálogo Diamantev:\n${link}`

      if (navigator.share) {
        await navigator.share({ title: 'Plantas Diamantev', text: shareText })
      } else {
        window.open(`https://wa.me/?text=${encodeURIComponent(shareText)}`, '_blank')
      }
      setShareModalOpen(false)
    } catch (err) {
      if (err.name !== 'AbortError') alert('No se pudo compartir. Intenta de nuevo.')
    }
    setSharingNotes(false)
  }

  // Marca de agua "DIAMANTEV" grabada dentro de la imagen (diagonal y repetida, difícil de recortar)
  function drawWatermark(ctx, w, h) {
    const fontSize = Math.max(18, Math.round(Math.min(w, h) / 11))
    ctx.save()
    ctx.beginPath()
    ctx.rect(0, 0, w, h)
    ctx.clip()
    ctx.globalAlpha = 0.28
    ctx.font = `900 ${fontSize}px Georgia, serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = '#ffffff'
    ctx.strokeStyle = 'rgba(0,0,0,0.55)'
    ctx.lineWidth = Math.max(1, fontSize / 22)
    ctx.translate(w / 2, h / 2)
    ctx.rotate(-Math.PI / 6)
    const stepX = fontSize * 7
    const stepY = fontSize * 3.2
    const diag = Math.sqrt(w * w + h * h)
    let row = 0
    for (let y = -diag / 2; y <= diag / 2; y += stepY) {
      const offset = (row % 2) * (stepX / 2)
      for (let x = -diag / 2 - stepX; x <= diag / 2 + stepX; x += stepX) {
        ctx.strokeText('DIAMANTEV', x + offset, y)
        ctx.fillText('DIAMANTEV', x + offset, y)
      }
      row++
    }
    ctx.restore()
  }

  // Recibe una imagen (Blob) y devuelve un JPG con la marca de agua puesta (o null si falla)
  async function watermarkBlob(blob) {
    try {
      const objUrl = URL.createObjectURL(blob)
      const img = await loadImageEl(objUrl)
      URL.revokeObjectURL(objUrl)
      if (!img) return null
      const scale = Math.min(1, 1600 / Math.max(img.width, img.height))
      const w = Math.round(img.width * scale)
      const h = Math.round(img.height * scale)
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      ctx.drawImage(img, 0, 0, w, h)
      drawWatermark(ctx, w, h)
      return await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.9))
    } catch {
      return null
    }
  }

  async function loadImageEl(url) {
    return new Promise(resolve => {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => resolve(img)
      img.onerror = () => resolve(null)
      img.src = url
    })
  }

  async function buildCaptionedPhoto(url, name) {
    const img = await loadImageEl(url)
    if (!img) return null
    const width = 720
    const captionH = 80
    const imgH = img.height * (width / img.width)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = imgH + captionH
    const ctx = canvas.getContext('2d')
    ctx.drawImage(img, 0, 0, width, imgH)
    drawWatermark(ctx, width, imgH)
    ctx.fillStyle = '#1a2e4a'
    ctx.fillRect(0, imgH, width, captionH)
    ctx.fillStyle = '#fff'
    ctx.font = '900 36px Georgia, serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(name.toUpperCase(), width / 2, imgH + captionH / 2)
    return await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.9))
  }

  async function shareSelectedPhotosDirect(plantsList) {
    const selected = plantsList.filter(p => selectedLabels.has(p.id))
    if (selected.length === 0) return
    setSharingNotes(true)
    try {
      const files = []
      for (const p of selected) {
        if (!p.image_url) continue
        const blob = await buildCaptionedPhoto(p.image_url, p.name)
        if (blob) files.push(new File([blob], `${p.name.replace(/[^a-z0-9-_ ]/gi, '')}.jpg`, { type: 'image/jpeg' }))
      }
      if (files.length === 0) {
        alert('No se pudieron generar las imágenes (revisa que tengan foto).')
        setSharingNotes(false)
        return
      }

      if (navigator.share && navigator.canShare && navigator.canShare({ files })) {
        await navigator.share({ title: 'Plantas Diamantev', files })
        await markPlantsAction(selected.map(p => p.id), 'whatsapp_shared_at')
      } else {
        files.forEach(f => {
          const url = URL.createObjectURL(f)
          const a = document.createElement('a')
          a.href = url
          a.download = f.name
          a.click()
          URL.revokeObjectURL(url)
        })
      }
    } catch (err) {
      if (err.name !== 'AbortError') alert('No se pudo compartir. Puede que las fotos no permitan generarse (CORS). Intenta de nuevo.')
    }
    setSharingNotes(false)
  }

  async function urlToFile(url) {
    try {
      const res = await fetch(url)
      const blob = await res.blob()
      const name = url.split('/').pop().split('?')[0]
      if (blob.type.startsWith('image/')) {
        const marked = await watermarkBlob(blob)
        if (!marked) return null
        return new File([marked], name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' })
      }
      return new File([blob], name, { type: blob.type })
    } catch {
      return null
    }
  }

  async function shareLoteNote(lote) {
    setSharingNotes(true)
    try {
      const header = `🧺 Compra #${lote.numero}${lote.proveedor ? ` — ${lote.proveedor}` : ''}`
      const blocks = lote.content_blocks || []
      const textBlocks = blocks.filter(b => b.type === 'text').map(b => b.content).join('\n')
      const shareText = textBlocks ? `${header}:\n${textBlocks}` : header
      const fileUrls = blocks.filter(b => (b.type === 'photo' || b.type === 'video') && b.url).map(b => b.url)
      const files = (await Promise.all(fileUrls.map(urlToFile))).filter(Boolean)

      if (navigator.share && files.length > 0 && navigator.canShare && navigator.canShare({ files })) {
        await navigator.share({ title: 'Nota de compra Diamantev', text: shareText, files })
      } else if (navigator.share) {
        await navigator.share({ title: 'Nota de compra Diamantev', text: shareText })
      } else {
        window.open(`https://wa.me/?text=${encodeURIComponent(shareText)}`, '_blank')
      }
    } catch (err) {
      if (err.name !== 'AbortError') alert('No se pudo compartir. Intenta de nuevo.')
    }
    setSharingNotes(false)
  }

  async function shareSbNote(batch) {
    setSharingNotes(true)
    try {
      const header = `🌰 ${batch.es_noid ? 'NOID' : (batch.nombre || 'Lote de semillas')}`
      const blocks = batch.content_blocks || []
      const textBlocks = blocks.filter(b => b.type === 'text').map(b => b.content).join('\n')
      const shareText = textBlocks ? `${header}:\n${textBlocks}` : header
      const fileUrls = blocks.filter(b => (b.type === 'photo' || b.type === 'video') && b.url).map(b => b.url)
      const files = (await Promise.all(fileUrls.map(urlToFile))).filter(Boolean)

      if (navigator.share && files.length > 0 && navigator.canShare && navigator.canShare({ files })) {
        await navigator.share({ title: 'Nota de semillas Diamantev', text: shareText, files })
      } else if (navigator.share) {
        await navigator.share({ title: 'Nota de semillas Diamantev', text: shareText })
      } else {
        window.open(`https://wa.me/?text=${encodeURIComponent(shareText)}`, '_blank')
      }
    } catch (err) {
      if (err.name !== 'AbortError') alert('No se pudo compartir. Intenta de nuevo.')
    }
    setSharingNotes(false)
  }

  async function sharePlantNote(n) {
    setSharingNotes(true)
    try {
      const plant = plants.find(p => p.id === n.plant_id)
      const header = `🪴 ${plant ? plant.name : 'Planta'} (${new Date(n.created_at).toLocaleDateString()})`
      const textBlocks = (n.content_blocks || []).filter(b => b.type === 'text').map(b => b.content).join('\n')
      const shareText = textBlocks ? `${header}:\n${textBlocks}` : header
      const fileUrls = (n.content_blocks || []).filter(b => (b.type === 'photo' || b.type === 'video') && b.url).map(b => b.url)
      const files = (await Promise.all(fileUrls.map(urlToFile))).filter(Boolean)

      if (navigator.share && files.length > 0 && navigator.canShare && navigator.canShare({ files })) {
        await navigator.share({ title: 'Nota de planta Diamantev', text: shareText, files })
      } else if (navigator.share) {
        await navigator.share({ title: 'Nota de planta Diamantev', text: shareText })
      } else {
        window.open(`https://wa.me/?text=${encodeURIComponent(shareText)}`, '_blank')
      }
    } catch (err) {
      if (err.name !== 'AbortError') alert('No se pudo compartir. Intenta de nuevo.')
    }
    setSharingNotes(false)
  }

  if (checkingSession) {
    return <p className="status-msg">Cargando...</p>
  }

  if (recoveryMode) {
    return (
      <div className="admin-login">
        <h2>Crear nueva contraseña</h2>
        <form onSubmit={handleUpdatePassword}>
          <input
            type="password"
            placeholder="Nueva contraseña"
            value={newPassword}
            onChange={e => setNewPassword(e.target.value)}
            autoComplete="new-password"
          />
          <button type="submit" disabled={updatingPassword}>{updatingPassword ? 'Guardando...' : 'Guardar contraseña'}</button>
        </form>
      </div>
    )
  }

  if (!authed) {
    if (resetMode) {
      return (
        <div className="admin-login">
          <h2>Recuperar contraseña</h2>
          {resetSent ? (
            <p style={{ fontSize: '0.9rem', marginTop: 10 }}>
              Te enviamos un correo a <strong>{resetEmail}</strong> con un enlace para crear una nueva contraseña. Revisa también la carpeta de spam.
            </p>
          ) : (
            <form onSubmit={handleForgotPassword}>
              <input
                type="email"
                placeholder="Tu correo electrónico"
                value={resetEmail}
                onChange={e => setResetEmail(e.target.value)}
                autoComplete="username"
              />
              <button type="submit" disabled={sendingReset}>{sendingReset ? 'Enviando...' : 'Enviar enlace de recuperación'}</button>
            </form>
          )}
          <button
            type="button"
            onClick={() => { setResetMode(false); setResetSent(false) }}
            style={{ background: 'none', border: 'none', color: 'var(--dark)', textDecoration: 'underline', marginTop: 14, cursor: 'pointer' }}
          >
            ← Volver a iniciar sesión
          </button>
        </div>
      )
    }
    return (
      <div className="admin-login">
        <h2>Panel de administrador</h2>
        <form onSubmit={handleLogin}>
          <input
            type="email"
            placeholder="Correo electrónico"
            value={email}
            onChange={e => setEmail(e.target.value)}
            autoComplete="username"
          />
          <input
            type="password"
            placeholder="Contraseña"
            value={password}
            onChange={e => setPassword(e.target.value)}
            autoComplete="current-password"
          />
          <button type="submit" disabled={loggingIn}>{loggingIn ? 'Entrando...' : 'Entrar'}</button>
        </form>
        <button
          type="button"
          onClick={() => setResetMode(true)}
          style={{ background: 'none', border: 'none', color: 'var(--dark)', textDecoration: 'underline', marginTop: 14, cursor: 'pointer' }}
        >
          ¿Olvidaste tu contraseña?
        </button>
        {failed && (
          <p style={{ color: '#b03434', fontSize: '0.85rem', marginTop: 10 }}>
            Correo o contraseña incorrectos.
          </p>
        )}
      </div>
    )
  }

  // Una línea "sin cobrar" = no está marcada como Pagada y tiene precio (los pedidos web siempre cuentan).
  const sinCobrar = m => !pagadoDe(m) && (m._type === 'venta' || Number(m.unit_price) > 0)

  // Lista unificada de ventas + decrementos manuales, para "Ventas y Decrementos"
  const movimientos = [
    ...orders.map(o => ({ ...o, _type: 'venta' })),
    ...decrementos.map(d => ({ ...d, _type: 'decremento' })),
  ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))

  const movimientosFiltrados = movimientos
    .filter(m => movTypeFilter === 'all' || m._type === movTypeFilter)
    .filter(m => movStatusFilter === 'all' || (movStatusFilter === 'por_entregar' ? !entregadoDe(m) : movStatusFilter === 'por_cobrar' ? sinCobrar(m) : estadoDeMovimiento(m) === movStatusFilter))
    .filter(m => {
      const term = movSearch.toLowerCase()
      if (!term) return true
      if (m._type === 'venta') return (m.customer_name || '').toLowerCase().includes(term)
      return (m.plant_name || '').toLowerCase().includes(term) || (m.motivo || '').toLowerCase().includes(term)
    })

  // Las ventas manuales (venta_lotes) también deben respetar Buscar / Tipo / Estado.
  // El estado de una venta se deduce de sus líneas (igual que el color de la tarjeta):
  // todas entregadas -> 'entregado'; alguna pagada/entregada -> 'pagado'; si no -> 'pedido'.
  function estadoDeVentaLote(lineas) {
    if (lineas.length > 0 && lineas.every(l => l.status === 'entregado')) return 'entregado'
    if (lineas.some(l => l.status === 'pagado' || l.status === 'entregado')) return 'pagado'
    return 'pedido'
  }
  // "Por entregar": cualquier línea (venta manual, de un lote, o pedido web) que aún no esté marcada
  // como Entregada, sin importar si ya se pagó o no.
  const porEntregarCount =
    ventaLotes.filter(lote => lote.status !== 'cancelada' && decrementos.some(d => d.lote_id === lote.id && !entregadoDe(d))).length +
    decrementos.filter(d => !d.lote_id && !entregadoDe(d)).length +
    orders.filter(o => !entregadoDe(o)).length

  // "Por cobrar": ventas (de lote, manuales o pedidos web) que aún no están marcadas como Pagadas.
  // Las líneas de $0 (regalos, etc.) no cuentan.
  const porCobrarCount =
    ventaLotes.filter(lote => lote.status !== 'cancelada' && decrementos.some(d => d.lote_id === lote.id && sinCobrar(d))).length +
    decrementos.filter(d => !d.lote_id && sinCobrar(d)).length +
    orders.filter(o => !pagadoDe(o)).length

  const ventaLotesFiltrados = ventaLotes.filter(lote => {
    const lineas = decrementos.filter(d => d.lote_id === lote.id)
    if (lineas.length === 0) return false
    if (movTypeFilter === 'decremento') return false
    if (movStatusFilter === 'por_entregar') {
      if (lote.status === 'cancelada') return false
      if (!lineas.some(l => !entregadoDe(l))) return false
    } else if (movStatusFilter === 'por_cobrar') {
      if (lote.status === 'cancelada') return false
      if (!lineas.some(l => sinCobrar(l))) return false
    } else if (movStatusFilter !== 'all') {
      if (lote.status === 'cancelada') return false
      if (estadoDeVentaLote(lineas) !== movStatusFilter) return false
    }
    const term = movSearch.trim().toLowerCase()
    if (term) {
      const coincide = (lote.cliente || '').toLowerCase().includes(term)
        || lineas.some(l => (l.plant_name || '').toLowerCase().includes(term) || (l.motivo || '').toLowerCase().includes(term))
      if (!coincide) return false
    }
    return true
  })

  // Números resumen para las tarjetas de inicio
  const pedidosPendientes = orders.filter(o => o.status === 'pedido').length
  const ingresosEnCurso = compras.filter(c => c.status !== 'recibido').length

  const CLIENT_URL = 'https://diamantev.vercel.app'

  function shareClientLink() {
    const message = encodeURIComponent(`🌿 Visita nuestro catálogo de plantas Diamantev: ${CLIENT_URL}`)
    window.open(`https://wa.me/?text=${message}`, '_blank')
  }


  const cards = [
    { key: 'galeria', label: 'Galería', icon: '🪴', count: plants.length },
    { key: 'categorias', label: 'Categorías', icon: '🏷️', count: categories.length },
    { key: 'pedidos', label: 'Ventas y Decrementos', icon: '🧾', count: pedidosPendientes },
    { key: 'ingresos', label: 'Ingresos', icon: '📦', count: ingresosEnCurso },
    { key: 'tabla', label: 'Tabla completa', icon: '📊', count: 0 },
    { key: 'intercambios', label: 'Intercambios', icon: '🔄', count: intercambioItems.filter(x => x.direccion === 'recibido' && x.estado === 'cuarentena').length },
    { key: 'notas', label: 'Notas', icon: '📝', count: categoryNotes.length },
  ]

  const sideMenuItemStyle = {
    display: 'flex', alignItems: 'center', gap: 10,
    width: '100%', textAlign: 'left', padding: '12px 16px',
    background: PILL_BG, border: `2px solid ${PILL_BORDER}`, borderRadius: 999, boxShadow: PILL_SHADOW,
    color: '#4a3a2a', fontWeight: 700, fontSize: 15, cursor: 'pointer', fontFamily: 'inherit',
  }

  const sheetTitles = {
    galeria: '🪴 Galería',
    categorias: '🏷️ Categorías',
    pedidos: '🧾 Ventas y Decrementos',
    ingresos: '📦 Ingresos',
    tabla: '📊 Tabla completa',
    intercambios: '🔄 Intercambios',
    notas: '📝 Notas',
  }

  return (
    <>
    <div className="admin" style={{
      minHeight: '100vh', width: '100vw', marginLeft: 'calc(50% - 50vw)',
      overflowX: 'clip', boxSizing: 'border-box',
      display: isWideScreen ? 'flex' : 'block', alignItems: 'flex-start',
    }}>
      <style>{`
        .collapsible-card[data-open="false"] > :not(.admin-item-info):not(.card-title-row) { display: none !important; }
        .collapsible-card[data-open="false"] .admin-item-info > :not(.card-title-row) { display: none !important; }
        .collapsible-card[data-open="false"] .card-title-row button { display: none !important; }
        .collapsible-card[data-open="false"] { padding-top: 10px; padding-bottom: 10px; }
      `}</style>
      {(homeMenuOpen || isWideScreen) && (
        <>
          {!isWideScreen && (
            <div
              onClick={() => setHomeMenuOpen(false)}
              style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 2000 }}
            />
          )}
          <div style={{
            position: isWideScreen ? 'sticky' : 'fixed',
            top: 0, left: 0, alignSelf: 'flex-start', height: '100vh', width: 280, maxWidth: '82vw', flexShrink: 0,
            background: PARCHMENT_BG,
            boxShadow: isWideScreen ? 'none' : '2px 0 16px rgba(0,0,0,0.2)',
            borderRight: isWideScreen ? `1px solid ${PILL_BORDER}` : 'none',
            zIndex: 2001,
            padding: '20px 14px', boxSizing: 'border-box', overflowY: 'auto',
            display: 'flex', flexDirection: 'column', gap: 8,
          }}>
            <h3 style={{ margin: '0 0 4px 6px', color: '#4a3a2a', fontSize: '1.15rem', fontFamily: "'Playfair Display', Georgia, serif", textTransform: 'uppercase', letterSpacing: '0.02em', fontWeight: 800 }}>Menú</h3>
            <hr style={{ border: 'none', borderTop: `1px solid ${PILL_BORDER}`, margin: '0 0 6px' }} />
            {/* Orden del menú: Galería, Notas, Ingresos, Ventas, Intercambios, Tabla, Ver tienda y lo demás */}
            {['galeria', 'notas', 'ingresos', 'pedidos', 'intercambios', 'tabla'].map(k => cards.find(c => c.key === k)).filter(Boolean).map(c => (
              <button key={c.key} type="button" onClick={() => { setHomeMenuOpen(false); setView(c.key) }} style={sideMenuItemStyle}>
                <span style={{ fontSize: 18 }}>{c.icon}</span> {c.label}{c.count ? ` (${c.count})` : ''}
              </button>
            ))}
            <button
              type="button"
              onClick={() => {
                setHomeMenuOpen(false)
                localStorage.setItem('diamantev_view_store', '1')
                window.location.href = CLIENT_URL
              }}
              style={sideMenuItemStyle}
            >
              <span style={{ fontSize: 18 }}>🌿</span> Ver tienda
            </button>
            {cards.filter(c => !['galeria', 'notas', 'ingresos', 'pedidos', 'intercambios', 'tabla'].includes(c.key)).map(c => (
              <button key={c.key} type="button" onClick={() => { setHomeMenuOpen(false); setView(c.key) }} style={sideMenuItemStyle}>
                <span style={{ fontSize: 18 }}>{c.icon}</span> {c.label}{c.count ? ` (${c.count})` : ''}
              </button>
            ))}
            <button type="button" onClick={() => { setHomeMenuOpen(false); shareClientLink() }} style={sideMenuItemStyle}>
              <span style={{ fontSize: 18 }}>💬</span> Compartir catálogo por WhatsApp
            </button>
            <hr style={{ border: 'none', borderTop: '1px solid #E8DFC8', margin: '6px 0' }} />
            <button type="button" onClick={() => { setHomeMenuOpen(false); downloadFullBackup() }} disabled={backupInProgress} style={sideMenuItemStyle}>
              <span style={{ fontSize: 18 }}>💾</span> {backupInProgress ? backupProgress : 'Respaldo completo'}
            </button>
            <button type="button" onClick={() => { setHomeMenuOpen(false); repairPendingPlantLinks() }} style={sideMenuItemStyle}>
              <span style={{ fontSize: 18 }}>🔧</span> Vincular pendientes
            </button>
            <div style={{ flex: 1 }} />
            <hr style={{ border: 'none', borderTop: '1px solid #E8DFC8', margin: '6px 0' }} />
            <button type="button" onClick={() => { setHomeMenuOpen(false); handleLogout() }} style={{ ...sideMenuItemStyle, color: '#b03434', fontWeight: 700 }}>
              <span style={{ fontSize: 18 }}>🚪</span> Cerrar sesión
            </button>
          </div>
        </>
      )}

      <div style={{ flex: 1, minWidth: 0, maxWidth: '100%', overflowX: 'clip' }}>
      <div className="admin-header" style={isWideScreen ? { flexWrap: 'nowrap', overflow: 'hidden', justifyContent: 'flex-start', textAlign: 'left' } : undefined}>
        <div style={{ flex: isWideScreen ? '0 1 720px' : '0 0 100%', width: '100%', maxWidth: isWideScreen ? 720 : undefined }}>
          {/* Banner con el botón de menú (☰) dentro, a la izquierda (solo en celular; en PC el menú ya está a un lado) */}
          <div
            role="img"
            aria-label="Diamantev — Diamantes verdes"
            style={{ position: 'relative', width: '100%', aspectRatio: '1730 / 475', backgroundColor: '#EAF5F5', backgroundImage: 'url(/banner-diamantev.jpg)', backgroundSize: 'cover', backgroundRepeat: 'no-repeat', backgroundPosition: 'center', borderRadius: 14, border: '1px solid #E8DFC8', overflow: 'hidden', boxSizing: 'border-box' }}
          >
            {!isWideScreen && (
              <button
                type="button"
                aria-label="Abrir menú"
                onClick={() => setHomeMenuOpen(!homeMenuOpen)}
                style={{ position: 'absolute', top: '57%', left: '10.5%', transform: 'translateY(-50%)', width: 36, height: 36, minHeight: 0, padding: 0, borderRadius: 8, background: 'transparent', backgroundImage: 'none', border: 'none', boxShadow: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 5, cursor: 'pointer' }}
              >
                {/* Tres rayas dibujadas con CSS: quedan exactamente centradas */}
                {[0, 1, 2].map(i => (
                  <span key={i} style={{ display: 'block', width: 24, height: 3, borderRadius: 2, background: '#6b5233', boxShadow: '0 0 3px rgba(255,255,255,0.9)' }} />
                ))}
              </button>
            )}
          </div>
          {/* Franja blanca entre dos líneas */}
          <div style={{ marginTop: 8, background: '#fff', borderTop: '1px solid #C8B58A', borderBottom: '1px solid #C8B58A', padding: '6px 0', textAlign: 'center', fontSize: '0.95rem', fontWeight: 600, letterSpacing: '0.04em', color: '#5a5040' }}>
            Panel de administrador
          </div>
        </div>
        {!isWideScreen && (
          <>
            <button
              type="button"
              onClick={() => {
                localStorage.setItem('diamantev_view_store', '1')
                window.location.href = CLIENT_URL
              }}
              className="back-to-store"
              style={{ background: '#4a6b3a', backgroundImage: 'none', border: '1px solid #36502a', color: '#fff', fontWeight: 700, textShadow: 'none' }}
            >
              🌿 Ver tienda
            </button>
            <button
              type="button"
              onClick={() => { setView('galeria'); setHomeMenuOpen(false); window.scrollTo({ top: 0, behavior: 'smooth' }) }}
              aria-label="Ir al inicio (Galería)"
              title="Inicio (Galería)"
              className="back-to-store"
              style={{ background: '#fff', backgroundImage: 'none', border: '1px solid #C8B58A', color: '#4a3a2a', fontSize: 20, lineHeight: 1, padding: '6px 14px' }}
            >
              🏠
            </button>
            <button onClick={handleLogout} className="back-to-store" style={{ background: 'transparent', border: '1px solid #b03434', color: '#b03434' }}>
              Cerrar sesión
            </button>
          </>
        )}
      </div>

      {pendingCount > 0 && (
        <p className={`offline-banner ${syncing ? 'offline-banner-syncing' : ''}`}>
          {syncing ? `Sincronizando ${pendingCount} cambio(s)...` : `${pendingCount} cambio(s) guardados sin conexión, pendientes de subir`}
        </p>
      )}

      <hr className="admin-divider" />

      {/* ---------- CONTENIDO PRINCIPAL (Galería es la pantalla de aterrizaje) ---------- */}
      <div style={{ padding: '0 16px 24px', boxSizing: 'border-box' }}>
          <div className="admin-sheet-header">
            <h2>{sheetTitles[view]}</h2>
          </div>

            <div className="admin-sheet-body" style={{ overflow: 'visible', maxHeight: 'none', height: 'auto' }}>
              {loading && <p className="status-msg">Cargando...</p>}
              {!loading && view === 'galeria' && (() => {
                    const galleryPlants = [...plants, ...seedBatchesAsItems()]
                      .filter(p => galleryFilter === 'all' || p.category_id === galleryFilter || categories.find(c => c.id === p.category_id)?.parent_id === galleryFilter)
                      .filter(p => coincideBusqueda(textoBuscableItem(p), gallerySearch))
                      .filter(p => {
                        if (galleryProveedor === 'all') return true
                        const comprasDePlanta = compras.filter(c => c.plant_id === p.id)
                        if (galleryProveedor === '__none__') return comprasDePlanta.length === 0
                        return comprasDePlanta.some(c => c.proveedor === galleryProveedor)
                      })
                      .filter(p => {
                        if (galleryCompraStatus === 'all') return true
                        return compras.some(c => c.plant_id === p.id && c.status === galleryCompraStatus)
                      })
                      .filter(p => {
                        if (galleryLoteNumero === 'all') return true
                        return compras.some(c => c.plant_id === p.id && c.lote_id === galleryLoteNumero)
                      })
                      .filter(p => {
                        if (galleryVentaLoteNumero === 'all') return true
                        return decrementos.some(d => d.plant_id === p.id && d.lote_id === galleryVentaLoteNumero)
                      })
                      .filter(p => {
                        if (galleryVentaStatus === 'all') return true
                        const enOrdenes = orders.some(o => o.status === galleryVentaStatus && (o.order_items || []).some(it => it.plant_id === p.id))
                        const enDecrementos = decrementos.some(d => d.plant_id === p.id && d.status === galleryVentaStatus)
                        return enOrdenes || enDecrementos
                      })
                      .filter(p => {
                        if (galleryActionFilter === 'shared') return p.shared_visible
                        if (galleryActionFilter === 'printed') return !!p.printed_at
                        if (galleryActionFilter === 'pdf') return !!p.pdf_generated_at
                        if (galleryActionFilter === 'whatsapp') return !!p.whatsapp_shared_at
                        return true
                      })
                      .filter(p => {
                        if (galleryColorFilter === 'all') return true
                        if (galleryColorFilter === '__none__') return !p.isSeed && !p.color
                        return p.color === galleryColorFilter
                      })
                      .filter(p => {
                        if (galleryMissingFilters.has('nombreCodigo') && !esNombreCodigo(p.name)) return false
                        if (galleryMissingFilters.has('soloSemillas') && !p.isSeed) return false
                        if (galleryMissingFilters.has('sinSemillas') && p.isSeed) return false
                        if (galleryMissingFilters.has('noPhoto') && p.image_url) return false
                        if (galleryMissingFilters.has('hasPhoto') && !p.image_url) return false
                        if (galleryMissingFilters.has('noCategory') && p.category_id) return false
                        if (galleryMissingFilters.has('noPrice') && Number(p.price) > 0) return false
                        if (galleryMissingFilters.has('hasPrice') && !(Number(p.price) > 0)) return false
                        if (galleryMissingFilters.has('noStock') && Number(p.stock) > 0) return false
                        if (galleryMissingFilters.has('hasStock') && !(Number(p.stock) > 0)) return false
                        if (galleryMissingFilters.has('flowered') && !floraciones.some(f => f.plant_id === p.id)) return false
                        if (galleryMissingFilters.has('noFlowered') && floraciones.some(f => f.plant_id === p.id)) return false
                        if (galleryMissingFilters.has('hasCategory') && !p.category_id) return false
                        if (galleryMissingFilters.has('sold')) {
                          const vendida = orders.some(o => (o.order_items || []).some(it => it.plant_id === p.id)) || decrementos.some(d => d.plant_id === p.id)
                          if (!vendida) return false
                        }
                        if (galleryMissingFilters.has('hasNotes') && !plantNotes.some(n => n.plant_id === p.id)) return false
                        if (galleryMissingFilters.has('noNotes') && plantNotes.some(n => n.plant_id === p.id)) return false
                        if (galleryMissingFilters.has('hasVideo') && !p.video_url) return false
                        if (galleryMissingFilters.has('noVideo') && p.video_url) return false
                        if (galleryMissingFilters.has('flagged') && faltaInfo(p).length === 0) return false
                        if (galleryMissingFilters.has('marcadoCliente') && !p.marcado_cliente) return false
                        if (galleryLabelStatus !== 'all' && labelStatusOf(p) !== galleryLabelStatus) return false
                        return true
                      })
                      .sort((a, b) => {
                        if (gallerySortBy === 'color') {
                          const ia = colorIndex(a.color), ib = colorIndex(b.color)
                          if (ia !== ib) return ia - ib
                        }
                        if (galleryFilter === 'all') {
                          const catA = categories.find(c => c.id === a.category_id)?.name || 'zzz'
                          const catB = categories.find(c => c.id === b.category_id)?.name || 'zzz'
                          const catCompare = catA.localeCompare(catB, 'es', { numeric: true, sensitivity: 'base' })
                          if (catCompare !== 0) return catCompare
                        }
                        // Los nombres que son solo un código van al final
                        const codeA = esNombreCodigo(a.name), codeB = esNombreCodigo(b.name)
                        if (codeA !== codeB) return codeA ? 1 : -1
                        // Orden natural: "Epidendrum 2" antes que "Epidendrum 10"
                        return a.name.localeCompare(b.name, 'es', { numeric: true, sensitivity: 'base' })
                      })

                    // Las semillas se muestran pero no entran en etiquetas / PDF / enviar / marcar cliente (solo aplican a plantas).
                    const galleryRealPlants = galleryPlants.filter(p => !p.isSeed)
                    galleryVisibleRef.current = galleryPlants

                    const activeChips = []
                    if (gallerySearch.trim()) {
                      activeChips.push({ key: 'search', label: `🔍 ${gallerySearch.trim()}`, onRemove: () => setGallerySearch('') })
                    }
                    if (galleryFilter !== 'all') {
                      const cat = categories.find(c => c.id === galleryFilter)
                      activeChips.push({ key: 'cat', label: cat ? `Categoría: ${cat.emoji} ${cat.name}` : 'Categoría', onRemove: () => setGalleryFilter('all') })
                    }
                    if (galleryProveedor !== 'all') {
                      activeChips.push({ key: 'prov', label: galleryProveedor === '__none__' ? 'Sin proveedor' : `🚚 ${galleryProveedor}`, onRemove: () => setGalleryProveedor('all') })
                    }
                    if (galleryCompraStatus !== 'all') {
                      activeChips.push({ key: 'cstatus', label: `📦 Compra: ${galleryCompraStatus === 'pedido' ? 'Pedido' : galleryCompraStatus === 'pagado' ? 'Pagado' : 'Recibido'}`, onRemove: () => setGalleryCompraStatus('all') })
                    }
                    if (galleryLoteNumero !== 'all') {
                      const l = lotes.find(x => x.id === galleryLoteNumero)
                      activeChips.push({ key: 'lote', label: `Compra #${l?.numero ?? '?'}`, onRemove: () => setGalleryLoteNumero('all') })
                    }
                    if (galleryVentaLoteNumero !== 'all') {
                      const vl = ventaLotes.find(x => x.id === galleryVentaLoteNumero)
                      activeChips.push({ key: 'ventalote', label: `Venta #${vl?.numero ?? '?'}`, onRemove: () => setGalleryVentaLoteNumero('all') })
                    }
                    if (galleryVentaStatus !== 'all') {
                      activeChips.push({ key: 'vstatus', label: `🛒 Venta: ${galleryVentaStatus === 'pedido' ? 'Pedido' : galleryVentaStatus === 'pagado' ? 'Pagado' : 'Entregado'}`, onRemove: () => setGalleryVentaStatus('all') })
                    }
                    if (galleryActionFilter !== 'all') {
                      const actionLabels = { shared: '📤 Compartidas', printed: '🏷️ Impresas', pdf: '📄 En PDF', whatsapp: '📲 Por WhatsApp' }
                      activeChips.push({ key: 'action', label: actionLabels[galleryActionFilter], onRemove: () => setGalleryActionFilter('all') })
                    }
                    if (galleryLabelStatus !== 'all') {
                      const labelStatusLabels = { disponible: '🟢 Etiqueta: Nunca impresa', sobrante: '📦 Etiqueta: De sobra sin pegar', colocada: '✅ Etiqueta: Todo colocado' }
                      activeChips.push({ key: 'labelstatus', label: labelStatusLabels[galleryLabelStatus], onRemove: () => setGalleryLabelStatus('all') })
                    }
                    if (galleryColorFilter !== 'all') {
                      activeChips.push({ key: 'color', label: galleryColorFilter === '__none__' ? '🎨 Sin color' : `🎨 ${galleryColorFilter}`, onRemove: () => setGalleryColorFilter('all') })
                    }
                    if (gallerySortBy === 'color') {
                      activeChips.push({ key: 'sortcolor', label: '↕️ Orden: por color', onRemove: () => setGallerySortBy('nombre') })
                    }
                    const missingLabels = {
                      noPhoto: '🖼️ Sin foto', hasPhoto: '🖼️ Con foto',
                      noCategory: '📂 Sin categoría', hasCategory: '📂 Con categoría', noPrice: 'Sin precio', hasPrice: '💲 Con precio', soloSemillas: '🌰 Solo semillas', sinSemillas: '🪴 Sin semillas', nombreCodigo: '🔤 Nombre con código',
                      noStock: '📦 Sin stock', hasStock: '📦 Con stock',
                      flowered: '🌸 Floreció', noFlowered: '🌸 No ha florecido', sold: '🛒 Se vendió',
                      hasNotes: '📓 Con notas', noNotes: '📓 Sin notas',
                      hasVideo: '🎥 Con video', noVideo: '🎥 Sin video',
                      flagged: '🚩 Falta información',
                      marcadoCliente: '🟢 Marcadas para cliente',
                    }
                    galleryMissingFilters.forEach(key => {
                      activeChips.push({ key, label: missingLabels[key] || key, onRemove: () => toggleGalleryMissingFilter(key) })
                    })

                    function clearAllGalleryFilters() {
                      setGallerySearch('')
                      setGalleryFilter('all')
                      setGalleryProveedor('all')
                      setGalleryCompraStatus('all')
                      setGalleryLoteNumero('all')
                      setGalleryVentaLoteNumero('all')
                      setGalleryVentaStatus('all')
                      setGalleryActionFilter('all')
                      setGalleryLabelStatus('all')
                      setGalleryColorFilter('all')
                      setGallerySortBy('nombre')
                      setGalleryMissingFilters(new Set())
                    }

                    const filteredCats = categories.filter(c => c.name.toLowerCase().includes(catFilterSearch.trim().toLowerCase()))
                    const provList = [...new Set(compras.map(c => c.proveedor).filter(Boolean))].sort()
                    const filteredProvs = provList.filter(p => p.toLowerCase().includes(provFilterSearch.trim().toLowerCase()))
                    const loteList = lotes.slice().sort((a, b) => (b.numero || 0) - (a.numero || 0))
                    const filteredLotes = loteList.filter(l => `${l.numero}${l.proveedor || ''}`.toLowerCase().includes(loteFilterSearch.trim().toLowerCase()))
                    const ventaLoteList = ventaLotes.slice().sort((a, b) => (b.numero || 0) - (a.numero || 0))
                    const filteredVentaLotes = ventaLoteList.filter(l => `${l.numero}${l.cliente || ''}`.toLowerCase().includes(ventaLoteFilterSearch.trim().toLowerCase()))

                    const verActivo = galleryFilter !== 'all' || galleryCompraStatus !== 'all' || galleryVentaStatus !== 'all'
                    const modeBtnStyle = (active, activeBg, activeColor) => ({
                      border: 'none', margin: 0, borderRadius: 0, cursor: 'pointer', whiteSpace: 'nowrap',
                      padding: '8px 10px', fontSize: 13, fontWeight: active ? 700 : 600,
                      background: active ? activeBg : 'transparent', color: active ? activeColor : '#5B4636',
                    })
                    const colorCounts = {}
                    plants.forEach(p => { if (p.color) colorCounts[p.color] = (colorCounts[p.color] || 0) + 1 })
                    const plantsSinColor = plants.filter(p => !p.color)
                    const plantsPorDetectar = plantsSinColor.filter(p => p.image_url && !p.color_manual)
                    const clienteCount = plants.filter(p => p.marcado_cliente).length + seedBatches.filter(sb => isSeedBatchForSale(sb) && sb.marcado_cliente).length

                    // ----- Panel "Atributos rápidos": pastillas de filtro (estilo pergamino) -----
                    function cycleTri(posKey, negKey) {
                      // Todas → (positivo) → (negativo) → Todas
                      setGalleryMissingFilters(prev => {
                        const next = new Set(prev)
                        if (next.has(posKey)) { next.delete(posKey); next.add(negKey) }
                        else if (next.has(negKey)) { next.delete(negKey) }
                        else { next.add(posKey) }
                        return next
                      })
                    }
                    function toggleExclusive(key, otherKey) {
                      setGalleryMissingFilters(prev => {
                        const next = new Set(prev)
                        if (next.has(key)) next.delete(key)
                        else { next.add(key); if (otherKey) next.delete(otherKey) }
                        return next
                      })
                    }
                    const triPill = (icon, label, posKey, negKey, posText, negText) => {
                      const pos = galleryMissingFilters.has(posKey)
                      const neg = galleryMissingFilters.has(negKey)
                      const active = pos || neg
                      const estado = pos ? posText : neg ? negText : 'Todas'
                      // Apagado: solo el ícono. Encendido: ícono + nombre + estado (Con / Sin).
                      return (
                        <button key={label} type="button" onClick={() => cycleTri(posKey, negKey)}
                          title={label} aria-label={`${label}: ${estado}`}
                          className={`attr-pill${pos ? ' is-active' : ''}${neg ? ' is-active is-neg' : ''}`}
                          style={{ width: 'auto', minWidth: 0, minHeight: 0, flex: '0 0 auto', display: 'inline-flex', alignItems: 'center', padding: active ? '4px 12px' : '4px 9px' }}>
                          <span className="attr-icon" style={{ fontSize: 19 }}>{icon}</span>
                          {active && (
                            <span style={{ display: 'inline-flex', flexDirection: 'column', textAlign: 'left', lineHeight: 1.15, marginLeft: 8 }}>
                              <span style={{ fontWeight: 700 }}>{label}</span>
                              <small className="attr-state">{estado}</small>
                            </span>
                          )}
                        </button>
                      )
                    }
                    const smallPill = (icon, label, key, otherKey, neg = false) => {
                      const on = galleryMissingFilters.has(key)
                      return (
                        <button key={key} type="button" onClick={() => toggleExclusive(key, otherKey)}
                          title={label} aria-label={label}
                          className={`attr-pill${on ? ' is-active' : ''}${on && neg ? ' is-neg' : ''}`}
                          style={{ width: 'auto', minWidth: 0, minHeight: 0, flex: '0 0 auto', display: 'inline-flex', alignItems: 'center', padding: on ? '4px 12px' : '4px 9px' }}>
                          <span className="attr-icon" style={{ fontSize: 19 }}>{icon}</span>
                          {on && <span style={{ marginLeft: 8, fontWeight: 600 }}>{label} ✓</span>}
                        </button>
                      )
                    }
                    const cap = t => (t ? t.charAt(0).toUpperCase() + t.slice(1) : '')
                    // Botón de grupo: solo el ícono; al estar activo muestra el nombre y lo elegido
                    const groupPill = (key, icon, label, active, summary, onClick) => (
                      <button key={key} type="button" onClick={onClick} title={label} aria-label={label}
                        className={`attr-pill${active ? ' is-active' : ''}`}
                        style={{ width: 'auto', minWidth: 0, minHeight: 0, flex: '0 0 auto', display: 'inline-flex', alignItems: 'center', padding: active ? '4px 12px' : '4px 9px', outline: filterGroup === key ? '2px solid #8b7a52' : 'none', outlineOffset: 1 }}>
                        <span className="attr-icon" style={{ fontSize: 19 }}>{icon}</span>
                        {active && (
                          <span style={{ display: 'inline-flex', flexDirection: 'column', textAlign: 'left', lineHeight: 1.15, marginLeft: 8 }}>
                            <span style={{ fontWeight: 700 }}>{label}</span>
                            {summary ? <small className="attr-state">{summary}</small> : null}
                          </span>
                        )}
                      </button>
                    )
                    function setClienteParaVisibles(value) {
                      const ids = new Set(galleryRealPlants.map(p => p.id))
                      const seedIds = galleryPlants.filter(p => p.isSeed).map(p => p.seedBatchId)
                      const total = ids.size + seedIds.length
                      if (total === 0) return
                      if (!confirm(`¿${value ? 'Marcar para el cliente' : 'Quitar del cliente'} ${total} ítem(s) visibles en esta lista?`)) return
                      markSelectedCliente(ids, value)
                      markSeedBatchesCliente(seedIds, value)
                    }

                    // ----- Íconos de filtro compartidos (celular: fila rápida; hoja de Filtros) -----
                    const iconPills = (
                      <>
                                    {triPill('📦', 'Stock', 'hasStock', 'noStock', 'Con stock', 'Sin stock')}
                                    {triPill('📷', 'Foto', 'hasPhoto', 'noPhoto', 'Con foto', 'Sin foto')}
                                    {triPill('📓', 'Notas', 'hasNotes', 'noNotes', 'Con notas', 'Sin notas')}
                                    {triPill('🌸', 'Floreció', 'flowered', 'noFlowered', 'Sí', 'No')}
                                    {triPill('💲', 'Precio', 'hasPrice', 'noPrice', 'Con precio', 'Sin precio')}
                                    {triPill('🎥', 'Video', 'hasVideo', 'noVideo', 'Con video', 'Sin video')}
                                    {triPill('📂', 'Categoría', 'hasCategory', 'noCategory', 'Con categoría', 'Sin categoría')}
                                    {smallPill('🛒', 'Se vendió alguna vez', 'sold')}
                                    {smallPill('🔤', 'Nombre con código', 'nombreCodigo', null, true)}
                                    {smallPill('🚩', 'Falta información', 'flagged')}
                                    {smallPill('🟢', 'Marcadas para cliente', 'marcadoCliente')}
                                    {groupPill('compra', '🧺', 'Compra',
                                      galleryCompraStatus !== 'all' || galleryLoteNumero !== 'all',
                                      [galleryCompraStatus !== 'all' ? cap(galleryCompraStatus) : null, galleryLoteNumero !== 'all' ? `N° ${(lotes.find(x => x.id === galleryLoteNumero) || {}).numero ?? ''}` : null].filter(Boolean).join(' · '),
                                      () => setFilterGroup(g => (g === 'compra' ? null : 'compra')))}
                                    {groupPill('venta', '🧾', 'Venta',
                                      galleryVentaStatus !== 'all' || galleryVentaLoteNumero !== 'all',
                                      [galleryVentaStatus !== 'all' ? cap(galleryVentaStatus) : null, galleryVentaLoteNumero !== 'all' ? `N° ${(ventaLotes.find(x => x.id === galleryVentaLoteNumero) || {}).numero ?? ''}` : null].filter(Boolean).join(' · '),
                                      () => setFilterGroup(g => (g === 'venta' ? null : 'venta')))}
                                    {groupPill('proveedor', '🚚', 'Proveedor',
                                      galleryProveedor !== 'all',
                                      galleryProveedor === '__none__' ? 'Sin proveedor' : galleryProveedor,
                                      () => openSelector('proveedor'))}
                                    {groupPill('etiquetas', '🏷️', 'Etiquetas',
                                      galleryLabelStatus !== 'all',
                                      ({ disponible: 'Nunca impresa', sobrante: 'De sobra', colocada: 'Colocado' })[galleryLabelStatus] || '',
                                      () => setFilterGroup(g => (g === 'etiquetas' ? null : 'etiquetas')))}
                      </>
                    )
                    const colorChip = groupPill('color', '🎨', 'Color',
                      galleryColorFilter !== 'all',
                      galleryColorFilter === '__none__' ? 'Sin color' : galleryColorFilter,
                      () => setFilterGroup(g => (g === 'color' ? null : 'color')))
                    const renderGroupPanels = withColor => (
                      <>
                                  {filterGroup === 'compra' && (
                                    <div className="attr-row" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
                                      <button key="pedido" type="button" onClick={() => setGalleryCompraStatus(galleryCompraStatus === 'pedido' ? 'all' : 'pedido')} className={`attr-pill${galleryCompraStatus === 'pedido' ? ' is-active' : ''}`}>Pedido{galleryCompraStatus === 'pedido' ? ' ✓' : ''}</button>
                                      <button key="pagado" type="button" onClick={() => setGalleryCompraStatus(galleryCompraStatus === 'pagado' ? 'all' : 'pagado')} className={`attr-pill${galleryCompraStatus === 'pagado' ? ' is-active' : ''}`}>Pagado{galleryCompraStatus === 'pagado' ? ' ✓' : ''}</button>
                                      <button key="recibido" type="button" onClick={() => setGalleryCompraStatus(galleryCompraStatus === 'recibido' ? 'all' : 'recibido')} className={`attr-pill${galleryCompraStatus === 'recibido' ? ' is-active' : ''}`}>Recibido{galleryCompraStatus === 'recibido' ? ' ✓' : ''}</button>
                                      <button type="button" onClick={() => openSelector('compra')}
                                    style={{
                                      display: 'flex', alignItems: 'center', gap: 6,
                                      background: galleryLoteNumero !== 'all' ? QUICK_FILTER_TONES.sage.active : QUICK_FILTER_TONES.sage.bg,
                                      border: `2px solid ${QUICK_FILTER_TONES.sage.border}`, borderRadius: 18,
                                      padding: '9px 14px', fontWeight: galleryLoteNumero !== 'all' ? 700 : 600,
                                      color: '#5B4636', fontSize: 13.5, cursor: 'pointer',
                                    }}>
                                    <span style={{ fontSize: 16 }}>🧾</span>
                                    {galleryLoteNumero === 'all' ? 'N° de compra: Cualquiera' : (() => { const l = lotes.find(x => x.id === galleryLoteNumero); return l ? `Compra #${l.numero}${l.proveedor ? ` — ${l.proveedor}` : ''}` : 'Compra' })()}
                                    <span style={{ fontSize: 11, opacity: 0.6 }}>⌄</span>
                                  </button>
                                    </div>
                                  )}
                                  {filterGroup === 'venta' && (
                                    <div className="attr-row" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
                                      <button key="pedido" type="button" onClick={() => setGalleryVentaStatus(galleryVentaStatus === 'pedido' ? 'all' : 'pedido')} className={`attr-pill${galleryVentaStatus === 'pedido' ? ' is-active' : ''}`}>Pedido{galleryVentaStatus === 'pedido' ? ' ✓' : ''}</button>
                                      <button key="pagado" type="button" onClick={() => setGalleryVentaStatus(galleryVentaStatus === 'pagado' ? 'all' : 'pagado')} className={`attr-pill${galleryVentaStatus === 'pagado' ? ' is-active' : ''}`}>Pagado{galleryVentaStatus === 'pagado' ? ' ✓' : ''}</button>
                                      <button key="entregado" type="button" onClick={() => setGalleryVentaStatus(galleryVentaStatus === 'entregado' ? 'all' : 'entregado')} className={`attr-pill${galleryVentaStatus === 'entregado' ? ' is-active' : ''}`}>Entregado{galleryVentaStatus === 'entregado' ? ' ✓' : ''}</button>
                                      <button type="button" onClick={() => openSelector('ventaLote')}
                                    style={{
                                      display: 'flex', alignItems: 'center', gap: 6,
                                      background: galleryVentaLoteNumero !== 'all' ? QUICK_FILTER_TONES.rose.active : QUICK_FILTER_TONES.rose.bg,
                                      border: `2px solid ${QUICK_FILTER_TONES.rose.border}`, borderRadius: 18,
                                      padding: '9px 14px', fontWeight: galleryVentaLoteNumero !== 'all' ? 700 : 600,
                                      color: '#5B4636', fontSize: 13.5, cursor: 'pointer',
                                    }}>
                                    <span style={{ fontSize: 16 }}>🧾</span>
                                    {galleryVentaLoteNumero === 'all' ? 'N° de venta: Cualquiera' : (() => { const vl = ventaLotes.find(x => x.id === galleryVentaLoteNumero); return vl ? `Venta #${vl.numero}${vl.cliente ? ` — ${vl.cliente}` : ''}` : 'Venta' })()}
                                    <span style={{ fontSize: 11, opacity: 0.6 }}>⌄</span>
                                  </button>
                                    </div>
                                  )}
                                  {filterGroup === 'etiquetas' && (
                                    <div className="attr-row" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
                                      <button key="disponible" type="button" onClick={() => setGalleryLabelStatus(galleryLabelStatus === 'disponible' ? 'all' : 'disponible')} className={`attr-pill${galleryLabelStatus === 'disponible' ? ' is-active' : ''}`}>Nunca impresa{galleryLabelStatus === 'disponible' ? ' ✓' : ''}</button>
                                      <button key="sobrante" type="button" onClick={() => setGalleryLabelStatus(galleryLabelStatus === 'sobrante' ? 'all' : 'sobrante')} className={`attr-pill${galleryLabelStatus === 'sobrante' ? ' is-active' : ''}`}>De sobra sin pegar{galleryLabelStatus === 'sobrante' ? ' ✓' : ''}</button>
                                      <button key="colocada" type="button" onClick={() => setGalleryLabelStatus(galleryLabelStatus === 'colocada' ? 'all' : 'colocada')} className={`attr-pill${galleryLabelStatus === 'colocada' ? ' is-active' : ''}`}>Todo colocado{galleryLabelStatus === 'colocada' ? ' ✓' : ''}</button>
                                    </div>
                                  )}
                        {withColor && filterGroup === 'color' && (
                          <>
                      <div className="attr-row" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
                        {PLANT_COLORS.filter(c => colorCounts[c.name] || galleryColorFilter === c.name).map(c => {
                          const on = galleryColorFilter === c.name
                          return (
                            <button key={c.name} type="button" onClick={() => setGalleryColorFilter(on ? 'all' : c.name)}
                              className={`attr-pill${on ? ' is-active' : ''}`}>
                              <span style={{ ...colorDotStyle(c.name, 13), marginRight: 6, verticalAlign: 'middle' }} />
                              {c.name} ({colorCounts[c.name] || 0}){on ? ' ✓' : ''}
                            </button>
                          )
                        })}
                        <button type="button" onClick={() => setGalleryColorFilter(galleryColorFilter === '__none__' ? 'all' : '__none__')}
                          className={`attr-pill${galleryColorFilter === '__none__' ? ' is-active is-neg' : ''}`}>
                          <span className="attr-icon">❔</span>Sin color ({plantsSinColor.length}){galleryColorFilter === '__none__' ? ' ✓' : ''}
                        </button>
                      </div>
                          <p className="attr-label" style={{ marginTop: 10 }}>Ordenar</p>
                          <div className="attr-row" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                            <button type="button" onClick={() => setGallerySortBy('nombre')} className={`attr-pill${gallerySortBy === 'nombre' ? ' is-active' : ''}`}>
                              <span className="attr-icon">🔤</span>Por nombre{gallerySortBy === 'nombre' ? ' ✓' : ''}
                            </button>
                            <button type="button" onClick={() => setGallerySortBy('color')} className={`attr-pill${gallerySortBy === 'color' ? ' is-active' : ''}`}>
                              <span className="attr-icon">🎨</span>Por color{gallerySortBy === 'color' ? ' ✓' : ''}
                            </button>
                            <button type="button" disabled={!!colorScan || plantsPorDetectar.length === 0}
                              onClick={() => runColorDetection(plantsPorDetectar)}
                              className="attr-pill">
                              <span className="attr-icon">🪄</span>
                              {colorScan ? `Detectando ${colorScan.done}/${colorScan.total}...` : `Detectar colores (${plantsPorDetectar.length})`}
                            </button>
                          </div>
                          </>
                        )}
                      </>
                    )

                    return (
                      <>
                        <div id="gallery-sticky-bar" style={{ position: 'sticky', top: 0, zIndex: 40, background: '#fff', border: '1px solid #E8DFC8', borderRadius: 14, boxShadow: '0 2px 8px rgba(0,0,0,0.08)', padding: '8px 8px 6px', marginBottom: 8 }}>
                        <div className="filter-bar" style={{ flexWrap: 'wrap', rowGap: 8 }}>
                          <button
                            type="button"
                            className="filter-trigger-btn"
                            onClick={() => { setGlobalSearchTerm(gallerySearch); setGlobalSearchOpen(true) }}
                            aria-label="Buscar"
                            title="Buscar planta, proveedor, nota, cliente…"
                            style={{ fontSize: 22, lineHeight: 1, padding: '8px 14px', flex: '0 0 auto' }}
                          >
                            🔍
                          </button>
                          {(() => {
                            const selCat = categories.find(x => x.id === galleryFilter)
                            const todasSel = !!actionMode && galleryPlants.length > 0 && galleryPlants.every(p => selectedLabels.has(p.id))
                            return (
                              <>
                                <button
                                  type="button"
                                  className={selCat ? 'filter-trigger-btn has-filters' : 'filter-trigger-btn'}
                                  onClick={() => openSelector('categoria')}
                                  aria-label="Elegir categoría"
                                  style={{ flex: '1 1 0', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', padding: '8px 10px', fontSize: 15 }}
                                >
                                  🏷️ {selCat ? `${selCat.emoji} ${selCat.name}` : 'Categorías'} <span style={{ fontSize: 11, opacity: 0.6 }}>⌄</span>
                                </button>
                                <button
                                  type="button"
                                  className={todasSel ? 'filter-trigger-btn has-filters' : 'filter-trigger-btn'}
                                  onClick={() => {
                                    if (!actionMode) { alert('Primero toca Etiquetas, Tienda, Fotos o Carrusel y luego elige las plantas.'); return }
                                    if (todasSel) clearLabels()
                                    else selectAllLabels(galleryPlants)
                                  }}
                                  title={todasSel ? 'Quitar la selección' : 'Seleccionar todas las plantas visibles'}
                                  style={{ flex: '0 0 auto', padding: '8px 10px', fontSize: 15, opacity: actionMode ? 1 : 0.55 }}
                                >
                                  {todasSel ? '☐ Ninguna' : '☑ Todas'}
                                </button>
                              </>
                            )
                          })()}
                        </div>


                        {globalSearchOpen && createPortal(
                          (() => {
                            const raw = globalSearchTerm.trim()
                            const term = normalizarBusqueda(raw)
                            const cierra = () => setGlobalSearchOpen(false)
                            const fila = (key, icon, titulo, sub, onClick) => (
                              <button key={key} type="button" onClick={onClick}
                                style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', background: '#fff', border: '1px solid #E8DFC8', borderRadius: 10, padding: '10px 12px', margin: '0 0 6px', boxShadow: 'none', minHeight: 0, color: '#3b3b32' }}>
                                <span style={{ fontSize: 20 }}>{icon}</span>
                                <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                                  <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{titulo}</span>
                                  {sub ? <small style={{ color: '#7a7060' }}>{sub}</small> : null}
                                </span>
                              </button>
                            )
                            const titulo = txt => <p style={{ margin: '10px 2px 6px', fontSize: 12, fontWeight: 700, color: '#7a7060', letterSpacing: '0.04em', textTransform: 'uppercase' }}>{txt}</p>
                            const coincide = t => term && coincideBusqueda(t, raw)
                            const itemsBusq = [...plants, ...seedBatchesAsItems()].filter(x => coincide(textoBuscableItem(x)))
                            const proveedoresRes = [...new Set([...compras.map(c => c.proveedor), ...lotes.map(l => l.proveedor)].filter(Boolean))].filter(coincide).sort()
                            const intRes = intercambios.filter(i => coincide([folioInt(i), i.contacto, i.nota, ...intercambioItems.filter(x => x.intercambio_id === i.id).map(x => x.plant_name)].join(' '))).slice(0, 6)
                            const clientesRes = [...new Set([...ventaLotes.map(v => v.cliente), ...orders.map(o => o.customer_name)].filter(Boolean))].filter(coincide).sort()
                            return (
                              <div onClick={cierra} style={{ position: 'fixed', inset: 0, zIndex: 3000, background: 'rgba(0,0,0,0.35)', display: 'flex', justifyContent: 'center', alignItems: 'flex-start', paddingTop: 'max(12px, env(safe-area-inset-top))' }}>
                                <div onClick={e => e.stopPropagation()} style={{ width: 'min(640px, 96vw)', maxHeight: '88vh', overflowY: 'auto', background: '#FBF3E6', borderRadius: 14, boxShadow: '0 10px 30px rgba(0,0,0,0.25)', padding: 12, boxSizing: 'border-box' }}>
                                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                    <input
                                      autoFocus
                                      className="order-search"
                                      value={globalSearchTerm}
                                      onChange={e => setGlobalSearchTerm(e.target.value)}
                                      onKeyDown={e => { if (e.key === 'Escape') cierra() }}
                                      placeholder="Buscar planta, proveedor, nota, cliente…"
                                      style={{ flex: 1, minWidth: 0, boxSizing: 'border-box' }}
                                    />
                                    <button type="button" onClick={cierra} aria-label="Cerrar búsqueda" style={{ border: 'none', background: 'none', boxShadow: 'none', fontSize: 20, padding: 6, minHeight: 0 }}>✕</button>
                                  </div>

                                  {!term && (
                                    <p style={{ color: '#7a7060', fontSize: 13, margin: '12px 2px 4px' }}>Escribe para buscar en plantas, proveedores, clientes, notas, ventas e ingresos.</p>
                                  )}

                                  {term && itemsBusq.length > 0 && (
                                    <>
                                      {titulo(`🪴 Plantas (${itemsBusq.length})`)}
                                      {fila('ver-galeria', '🖼️', `Ver las ${itemsBusq.length} en la galería`, `Filtra la galería por «${raw}»`, () => { clearAllGalleryFilters(); setGallerySearch(raw); setView('galeria'); cierra() })}
                                      {itemsBusq.slice(0, 6).map(x => fila(`p-${x.id}`, x.isSeed ? '🌰' : '🪴', x.name, x.isSeed ? 'Semillas' : `Stock ${x.stock ?? 0}`, () => {
                                        clearAllGalleryFilters(); setGallerySearch(x.isSeed ? raw : x.name); setHighlightPlantId(x.isSeed ? null : x.id); setView('galeria'); cierra()
                                      }))}
                                    </>
                                  )}

                                  {term && proveedoresRes.length > 0 && (
                                    <>
                                      {titulo('🚚 Proveedores')}
                                      {proveedoresRes.slice(0, 6).map(n => fila(`prov-${n}`, '🚚', n, 'Ver sus plantas en la galería', () => { setGallerySearch(''); setGalleryProveedor(n); setView('galeria'); cierra() }))}
                                    </>
                                  )}

                                  {term && clientesRes.length > 0 && (
                                    <>
                                      {titulo('🧾 Clientes')}
                                      {clientesRes.slice(0, 6).map(n => fila(`cli-${n}`, '🧾', n, 'Ver sus ventas', () => { setMovSearch(n); setMovMenuOpen(true); setView('pedidos'); cierra() }))}
                                    </>
                                  )}

                                  {term && intRes.length > 0 && (
                                    <>
                                      {titulo('🔄 Intercambios')}
                                      {intRes.map(i => fila(`int-${i.id}`, '🔄', `${folioInt(i)} — ${i.contacto || 'Sin nombre'}`, 'Ver el intercambio', () => { setIntSearch(raw); setIntEstadoFilter('all'); setView('intercambios'); cierra() }))}
                                    </>
                                  )}

                                  {term && (
                                    <>
                                      {titulo('Buscar «' + raw + '» también en…')}
                                      {fila('en-notas', '📝', 'Notas', 'Plantas, compras, semillas y categorías', () => { setGlobalNoteSearch(raw); setView('notas'); cierra() })}
                                      {fila('en-ventas', '🧾', 'Ventas y decrementos', 'Por cliente, planta o motivo', () => { setMovSearch(raw); setMovMenuOpen(true); setView('pedidos'); cierra() })}
                                      {fila('en-ingresos', '📦', 'Ingresos (compras)', 'Por proveedor o planta', () => { setIngresosSearch(raw); setIngresosMenuOpen(true); setView('ingresos'); cierra() })}
                                    </>
                                  )}
                                </div>
                              </div>
                            )
                          })(),
                          document.body
                        )}
                        <div
                          ref={el => { iconRowRef.current = el; if (el) requestAnimationFrame(updateIconEdge) }}
                          onScroll={updateIconEdge}
                          style={{ display: 'flex', flexWrap: 'nowrap', gap: 6, overflowX: 'auto', WebkitOverflowScrolling: 'touch', scrollbarWidth: 'none', paddingTop: 6, paddingBottom: 2 }}
                        >
                          {iconPills}
                          {colorChip}
                        </div>
                        {!(iconRowEdge.start && iconRowEdge.end) && (
                          <div style={{ display: 'flex', justifyContent: 'center', gap: 12, marginTop: 2 }}>
                            {[['◀', -1, iconRowEdge.start, 'Ver los filtros anteriores'], ['▶', 1, iconRowEdge.end, 'Ver más filtros']].map(([txt, dir, off, label]) => (
                              <button key={txt} type="button" aria-label={label} title={label} disabled={off} onClick={() => scrollIconRow(dir)}
                                style={{ padding: '2px 22px', fontSize: 14, minHeight: 0, lineHeight: 1.3, borderRadius: 12, boxShadow: 'none', background: '#F3ECDD', border: '1px solid #d8cfb8', color: '#5B4636', opacity: off ? 0.35 : 1 }}>
                                {txt}
                              </button>
                            ))}
                          </div>
                        )}
                        {renderGroupPanels(true)}

                        {/* ---------- Barra fija: conmutador de modo + acciones ---------- */}
                        <style>{`
                          .gallery-actions-row > button { flex: 0 0 auto !important; width: auto !important; margin: 0 !important; white-space: nowrap !important; }
                        `}</style>
                          {(() => {
                            const MODOS = [
                              { key: 'etiquetas', nombre: 'Etiquetas', color: '#d9363e' },
                              { key: 'tienda', nombre: 'Tienda', color: '#f08a24' },
                              { key: 'fotos', nombre: 'Fotos', color: '#2f7fd0' },
                              { key: 'carrusel', nombre: 'Carrusel', color: '#8b4fc2' },
                            ]
                            const activo = MODOS.find(m => m.key === actionMode)
                            const terminar = () => {
                              const n = selectedLabels.size
                              if (n === 0) { alert('Marca las casillas de las plantas que quieras y luego toca "Terminar".'); return }
                              if (actionMode === 'etiquetas') {
                                setLabelQuantities(prev => { const next = { ...prev }; selectedLabels.forEach(id => { if (!next[id]) next[id] = 1 }); return next })
                                setPendingLabelAction('pdf')
                                setLabelQtyModalOpen(true)
                              } else if (actionMode === 'tienda') setStoreModalOpen(true)
                              else if (actionMode === 'fotos') setShareModalOpen(true)
                              else if (actionMode === 'carrusel') setCarouselModalOpen(true)
                            }
                            return (
                              <div style={{ paddingTop: 8 }}>
                                <div style={{ display: 'flex', gap: 4 }}>
                                  {MODOS.map(m => {
                                    const on = actionMode === m.key
                                    return (
                                      <button key={m.key} type="button" aria-pressed={on}
                                        onClick={() => setActionMode(on ? null : m.key)}
                                        style={{ flex: '1 1 0', minWidth: 0, padding: '6px 2px', minHeight: 0, borderRadius: 10, boxShadow: 'none', lineHeight: 1.15, fontSize: 13, fontWeight: 700, whiteSpace: 'normal', background: on ? m.color : '#F3ECDD', color: on ? '#fff' : '#5B4636', border: `2px solid ${on ? m.color : '#d8cfb8'}`, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                                        <span>{m.nombre}</span>
                                        <span style={{ fontSize: 12, fontWeight: 600 }}>({modeSets[m.key].size})</span>
                                      </button>
                                    )
                                  })}
                                </div>
                                {activo && (
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
                                    <span style={{ flex: 1, fontSize: 12, color: '#7a7060' }}>Marca las casillas de las plantas que quieras.</span>
                                    <button type="button" onClick={terminar}
                                      style={{ padding: '6px 16px', fontSize: 14, fontWeight: 700, minHeight: 0, lineHeight: 1.2, borderRadius: 10, boxShadow: 'none', background: activo.color, color: '#fff', border: 'none', whiteSpace: 'nowrap' }}>
                                      ✔ Terminar ({selectedLabels.size})
                                    </button>
                                  </div>
                                )}
                              </div>
                            )
                          })()}
                        </div>

                        {lastLabelsPdf && (
                          <div style={{ margin: '8px 0', padding: '10px 12px', background: '#fff8e1', border: '1px solid #e0c97a', borderRadius: 10, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                            <div style={{ flex: '1 1 200px', minWidth: 0 }}>
                              <strong>📄 PDF de etiquetas guardado</strong>
                              <div style={{ fontSize: 12, color: '#7a7060' }}>
                                {[lastLabelsPdf.idCount ? `${lastLabelsPdf.idCount} identificaciones` : null, lastLabelsPdf.nameCount ? `${lastLabelsPdf.nameCount} etiquetas` : null, new Date(lastLabelsPdf.createdAt).toLocaleString()].filter(Boolean).join(' · ')}
                              </div>
                            </div>
                            <button type="button" onClick={openLastLabelsPdf} style={{ padding: '6px 10px', fontSize: '0.8rem', minHeight: 0, lineHeight: 1.2, borderRadius: 8, boxShadow: 'none', whiteSpace: 'nowrap' }}>📄 Abrir</button>
                            {!isWideScreen && typeof navigator !== 'undefined' && navigator.share && (
                              <button type="button" onClick={shareLastLabelsPdf} style={{ padding: '6px 10px', fontSize: '0.8rem', minHeight: 0, lineHeight: 1.2, borderRadius: 8, boxShadow: 'none', whiteSpace: 'nowrap' }}>📤 Compartir</button>
                            )}
                            <button type="button" onClick={markLastLabelsPrinted} style={{ padding: '6px 10px', fontSize: '0.8rem', minHeight: 0, lineHeight: 1.2, borderRadius: 8, boxShadow: 'none', whiteSpace: 'nowrap', background: '#4a5d3a', color: '#fff', border: 'none' }}>🖨️ Ya se imprimió</button>
                            <button type="button" onClick={discardLastLabelsPdf} aria-label="Descartar PDF guardado" title="Descartar sin marcar como impreso" style={{ padding: '6px 10px', fontSize: '0.8rem', minHeight: 0, lineHeight: 1.2, borderRadius: 8, boxShadow: 'none', whiteSpace: 'nowrap', background: '#fff', border: '1px solid #ccc' }}>🗑️</button>
                          </div>
                        )}
                        {activeChips.length > 0 && (
                          <div className="filter-chips-row">
                            {activeChips.map(chip => (
                              <span key={chip.key} className="filter-chip">
                                {chip.label}
                                <button type="button" onClick={chip.onRemove}>✕</button>
                              </span>
                            ))}
                            <button type="button" className="filter-chip filter-chip-clear" onClick={clearAllGalleryFilters}>Limpiar todo</button>
                          </div>
                        )}

                        {galleryFiltersOpen && (
                          <div className="filter-sheet-overlay" onClick={() => setGalleryFiltersOpen(false)}>
                            <div className="filter-sheet" onClick={e => e.stopPropagation()}>
                              <div className="filter-sheet-header">
                                <h3>🎛️ Filtros</h3>
                                <button type="button" onClick={() => setGalleryFiltersOpen(false)}>✕</button>
                              </div>

                              <div className="filter-sheet-body">
                                <details className="attr-panel" open>
                                  <summary className="attr-title" style={{ cursor: 'pointer' }}>Atributos rápidos</summary>
                                  <div className="attr-row" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                                    {iconPills}
                                  </div>

                                  {renderGroupPanels(false)}
                                </details>
                                <details className="attr-panel">
                                  <summary className="attr-title" style={{ cursor: 'pointer' }}>🎨 Color y orden</summary>
                                  <div className="attr-row">
                                    {PLANT_COLORS.filter(c => colorCounts[c.name] || galleryColorFilter === c.name).map(c => {
                                      const on = galleryColorFilter === c.name
                                      return (
                                        <button key={c.name} type="button" onClick={() => setGalleryColorFilter(on ? 'all' : c.name)}
                                          className={`attr-pill${on ? ' is-active' : ''}`}>
                                          <span style={{ ...colorDotStyle(c.name, 13), marginRight: 6, verticalAlign: 'middle' }} />
                                          {c.name} ({colorCounts[c.name] || 0}){on ? ' ✓' : ''}
                                        </button>
                                      )
                                    })}
                                    <button type="button" onClick={() => setGalleryColorFilter(galleryColorFilter === '__none__' ? 'all' : '__none__')}
                                      className={`attr-pill${galleryColorFilter === '__none__' ? ' is-active is-neg' : ''}`}>
                                      <span className="attr-icon">❔</span>Sin color ({plantsSinColor.length}){galleryColorFilter === '__none__' ? ' ✓' : ''}
                                    </button>
                                  </div>

                                  <p className="attr-label">Ordenar</p>
                                  <div className="attr-row">
                                    <button type="button" onClick={() => setGallerySortBy('nombre')} className={`attr-pill${gallerySortBy === 'nombre' ? ' is-active' : ''}`}>
                                      <span className="attr-icon">🔤</span>Por nombre{gallerySortBy === 'nombre' ? ' ✓' : ''}
                                    </button>
                                    <button type="button" onClick={() => setGallerySortBy('color')} className={`attr-pill${gallerySortBy === 'color' ? ' is-active' : ''}`}>
                                      <span className="attr-icon">🎨</span>Por color{gallerySortBy === 'color' ? ' ✓' : ''}
                                    </button>
                                  </div>

                                  <p className="attr-label">Detección automática</p>
                                  <div className="attr-row">
                                    <button type="button" disabled={!!colorScan || plantsPorDetectar.length === 0}
                                      onClick={() => runColorDetection(plantsPorDetectar)}
                                      className="attr-pill attr-pill--big">
                                      <span className="attr-icon">🪄</span>
                                      <span className="attr-text">
                                        <span>{colorScan ? `Detectando ${colorScan.done}/${colorScan.total}...` : 'Detectar colores'}</span>
                                        <small className="attr-state">{plantsPorDetectar.length} con foto sin color</small>
                                      </span>
                                    </button>
                                  </div>
                                  <p style={{ fontSize: 12, color: '#8a7a5c', margin: '6px 2px 0' }}>
                                    Si alguna sale mal, toca el 🎨 de su tarjeta para corregirla. Las que corrijas a mano no se vuelven a cambiar.
                                  </p>
                                </details>
                                </div>


                              <div className="filter-sheet-footer">

                                <button type="button" className="clear-btn" onClick={clearAllGalleryFilters}>Limpiar todo</button>
                                <button type="button" className="apply-btn" onClick={() => setGalleryFiltersOpen(false)}>
                                  Aplicar filtros ({galleryPlants.length} resultado{galleryPlants.length === 1 ? '' : 's'})
                                </button>
                              </div>
                            </div>

                          </div>
                        )}
                        {activeSelector && (() => {
                              const config = {
                                categoria: {
                                  title: 'Seleccionar categoría',
                                  placeholder: 'Buscar categoría...',
                                  search: catFilterSearch,
                                  setSearch: setCatFilterSearch,
                                  currentValue: galleryFilter,
                                  options: [
                                    { value: 'all', label: 'Todas las categorías' },
                                    ...(() => {
                                      const term = catFilterSearch.trim().toLowerCase()
                                      const result = []
                                      ;[...categories.filter(c => !c.parent_id)].sort((a, b) => (/semilla/i.test(b.name) ? 1 : 0) - (/semilla/i.test(a.name) ? 1 : 0)).forEach(parent => {
                                        const children = categories.filter(c => c.parent_id === parent.id)
                                        const parentMatches = parent.name.toLowerCase().includes(term)
                                        const matchingChildren = children.filter(ch => term === '' || ch.name.toLowerCase().includes(term))
                                        if (term === '' || parentMatches || matchingChildren.length > 0) {
                                          if (children.length === 0) {
                                            result.push({ value: parent.id, label: `${parent.emoji} ${parent.name}` })
                                          } else {
                                            const expanded = term !== '' || expandedCategoryGroups.has(parent.id)
                                            result.push({
                                              value: parent.id,
                                              label: `${parent.emoji} ${parent.name} — todas (${children.length})`,
                                              isGroupHeader: true,
                                              expanded,
                                            })
                                            if (expanded) {
                                              const childrenToShow = parentMatches ? children : matchingChildren
                                              childrenToShow.forEach(ch => result.push({ value: ch.id, label: `　↳ ${ch.emoji} ${ch.name}` }))
                                            }
                                          }
                                        }
                                      })
                                      return result
                                    })(),
                                  ],
                                },
                                proveedor: {
                                  title: 'Seleccionar proveedor',
                                  placeholder: 'Buscar proveedor...',
                                  search: provFilterSearch,
                                  setSearch: setProvFilterSearch,
                                  currentValue: galleryProveedor,
                                  options: [
                                    { value: 'all', label: 'Todos los proveedores' },
                                    { value: '__none__', label: 'Sin proveedor registrado' },
                                    ...filteredProvs.map(p => ({ value: p, label: p })),
                                  ],
                                },
                                compra: {
                                  title: 'Seleccionar compra',
                                  placeholder: 'Buscar compra...',
                                  search: loteFilterSearch,
                                  setSearch: setLoteFilterSearch,
                                  currentValue: galleryLoteNumero,
                                  options: [
                                    { value: 'all', label: 'Cualquier compra' },
                                    ...filteredLotes.map(l => ({ value: l.id, label: `Compra #${l.numero}${l.proveedor ? ` — ${l.proveedor}` : ''}` })),
                                  ],
                                },
                                ventaLote: {
                                  title: 'Seleccionar venta',
                                  placeholder: 'Buscar venta...',
                                  search: ventaLoteFilterSearch,
                                  setSearch: setVentaLoteFilterSearch,
                                  currentValue: galleryVentaLoteNumero,
                                  options: [
                                    { value: 'all', label: 'Cualquier venta' },
                                    ...filteredVentaLotes.map(l => ({ value: l.id, label: `Venta #${l.numero}${l.cliente ? ` — ${l.cliente}` : ''}` })),
                                  ],
                                },
                              }[activeSelector]

                              return createPortal(
                                <div
                                  className="sub-sheet-overlay"
                                  onClick={() => setActiveSelector(null)}
                                  style={{ position: 'fixed', inset: 0, zIndex: 3000, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
                                >
                                  <div className="sub-sheet" onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 480 }}>
                                    <div className="sub-sheet-handle" />
                                    <h4 className="sub-sheet-title">{config.title}</h4>
                                    <div className="sub-sheet-search">
                                      <span>🔍</span>
                                      <input
                                        placeholder={config.placeholder}
                                        value={config.search}
                                        onChange={e => config.setSearch(e.target.value)}
                                        autoFocus
                                      />
                                    </div>
                                    <div className="sub-sheet-list">
                                      {config.options.map(opt => (
                                        <div
                                          key={opt.value}
                                          className={config.currentValue === opt.value ? 'sub-sheet-option selected' : 'sub-sheet-option'}
                                          onClick={() => selectAndClose(activeSelector, opt.value)}
                                          style={{ cursor: 'pointer', fontWeight: opt.isGroupHeader ? 700 : undefined, display: opt.isGroupHeader ? 'flex' : undefined, alignItems: 'center', justifyContent: 'space-between', gap: 8 }}
                                        >
                                          <span>{config.currentValue === opt.value ? '✓ ' : ''}{opt.label}</span>
                                          {opt.isGroupHeader && (
                                            <button
                                              type="button"
                                              aria-label={opt.expanded ? 'Ocultar subcategorías' : 'Ver subcategorías'}
                                              onClick={e => { e.stopPropagation(); toggleCategoryGroupExpanded(opt.value) }}
                                              style={{ border: 'none', background: 'transparent', fontSize: 16, padding: '2px 10px', cursor: 'pointer' }}
                                            >{opt.expanded ? '▾' : '▸'}</button>
                                          )}
                                        </div>
                                      ))}
                                      {config.options.length === 1 && (
                                        <p className="status-msg" style={{ padding: '10px 14px' }}>Sin resultados</p>
                                      )}
                                    </div>
                                  </div>
                                </div>,
                                document.body
                              )
                            })()}

                        {galleryPlants.length === 0 ? (
                          <p className="status-msg">No se encontraron plantas con esos criterios.</p>
                        ) : (
                          <>
                          <div className="gallery-grid">
                            {galleryPlants.map(p => (
                              <div
                                key={p.id}
                                className="gallery-item"
                                data-plant-id={p.id}
                                onClick={() => {
                                  if (p.isSeed) { openSeedSheet(p.seedBatchId); return }
                                  setPhotoModalPlantId(p.id); setPhotoModalIndex(0); setPhotoModalMenuOpen(false); setPhotoModalSection('fotos'); setSeedVentasFilter('all')
                                }}
                                style={{
                                  position: 'relative',
                                  cursor: 'pointer',
                                  ...(actionMode && selectedLabels.has(p.id) ? { boxShadow: `0 0 0 3px ${modeColors[actionMode]}`, borderRadius: 8 } : null),
                                  ...(highlightPlantId === p.id ? { boxShadow: '0 0 0 4px #E6007E', borderRadius: 8 } : null),
                                }}
                              >
                                {actionMode && (
                                  <label className="gallery-checkbox" title="Elegir esta planta" onClick={e => e.stopPropagation()}>
                                    <input
                                      type="checkbox"
                                      checked={selectedLabels.has(p.id)}
                                      onChange={() => toggleLabelSelect(p.id)}
                                      style={{ accentColor: modeColors[actionMode], outline: `2px solid ${modeColors[actionMode]}`, outlineOffset: 1 }}
                                    />
                                  </label>
                                )}
                                {p.isSeed && <span title="Semilla" style={{ pointerEvents: 'none', position: 'absolute', top: 6, right: 6, zIndex: 2, background: '#fff', borderRadius: 10, padding: '1px 6px', fontSize: '0.85rem', boxShadow: '0 1px 3px rgba(0,0,0,0.25)' }}>🌰</span>}
                                {faltaInfo(p).length > 0 && <span title={`Falta: ${faltaInfo(p).join(', ')}`} style={{ pointerEvents: 'none', position: 'absolute', top: 4, right: 4, zIndex: 2, fontSize: '1.1rem' }}>🚩</span>}
                                <div style={{ position: 'relative' }}>
                                  {p.image_url ? <img src={p.image_url} alt={p.name} /> : <div className="no-img-sm">{p.isSeed ? '🌰 Semillas' : 'Sin foto'}</div>}
                                </div>
                                <span>{p.name}</span>
                                {p.isSeed && <span style={{ fontSize: '0.78rem', fontWeight: 600, color: '#6b5a45' }}>🌰 Semilla · Stock {p.stock} · ${p.price.toFixed(2)}</span>}
                                {!p.isSeed && (
                                  <button
                                    type="button"
                                    onClick={e => { e.stopPropagation(); setColorPickerFor({ ids: [p.id], title: p.name }) }}
                                    style={{
                                      display: 'inline-flex', alignItems: 'center', gap: 5, margin: '3px auto 0', padding: '2px 9px',
                                      width: 'auto', minHeight: 0, lineHeight: 1.3, fontSize: '0.75rem', fontWeight: 600,
                                      border: '1px solid #E8DFC8', borderRadius: 12, background: p.color ? '#fff' : 'transparent',
                                      boxShadow: 'none', color: p.color ? '#5B4636' : '#a89878', cursor: 'pointer',
                                    }}
                                  >
                                    {p.color ? (<><span style={colorDotStyle(p.color, 11)} />{p.color}</>) : '🎨 Sin color'}
                                  </button>
                                )}
                              </div>
                            ))}
                          </div>
                          </>
                        )}

                        {colorPickerFor && createPortal(
                          <div
                            className="admin-sheet-overlay"
                            onClick={() => setColorPickerFor(null)}
                            style={{ position: 'fixed', inset: 0, zIndex: 3100, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', background: 'rgba(0,0,0,0.35)' }}
                          >
                            <div onClick={e => e.stopPropagation()} style={{ background: '#FBF6EA', width: '100%', maxWidth: 520, borderRadius: '18px 18px 0 0', padding: '14px 14px 22px', maxHeight: '80vh', overflowY: 'auto', boxSizing: 'border-box' }}>
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                                <strong style={{ color: '#5B4636', fontSize: 15 }}>🎨 Color — {colorPickerFor.title}</strong>
                                <button type="button" onClick={() => setColorPickerFor(null)} style={{ border: 'none', background: 'none', boxShadow: 'none', fontSize: 18, cursor: 'pointer', width: 'auto' }}>✕</button>
                              </div>
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                                {PLANT_COLORS.map(c => {
                                  const current = colorPickerFor.ids.length === 1 && plants.find(x => x.id === colorPickerFor.ids[0])?.color === c.name
                                  return (
                                    <button key={c.name} type="button"
                                      onClick={() => { setPlantsColor(colorPickerFor.ids, c.name); setColorPickerFor(null) }}
                                      style={{
                                        display: 'inline-flex', alignItems: 'center', gap: 7, width: 'auto', padding: '9px 14px',
                                        border: `2px solid ${current ? '#2E8B57' : '#E8DFC8'}`, borderRadius: 18, background: current ? '#E6F3EA' : '#fff',
                                        boxShadow: 'none', fontSize: 14, fontWeight: current ? 700 : 600, color: '#5B4636', cursor: 'pointer',
                                      }}>
                                      <span style={colorDotStyle(c.name, 16)} />{c.name}
                                    </button>
                                  )
                                })}
                              </div>
                              <button type="button"
                                onClick={() => { const ids = colorPickerFor.ids; setColorPickerFor(null); redetectColors(ids) }}
                                style={{ marginTop: 14, width: '100%', padding: '10px 14px', border: '2px dashed #C9B98E', borderRadius: 14, background: 'transparent', boxShadow: 'none', fontSize: 14, fontWeight: 600, color: '#5B4636', cursor: 'pointer' }}>
                                🪄 Detectar de nuevo con la foto
                              </button>
                            </div>
                          </div>,
                          document.body
                        )}

                        {shareModalOpen && (() => {
                          const items = labelItemsList().filter(x => selectedLabels.has(x.id))
                          const conFoto = items.filter(x => !x.isSeed && x.image_url).length
                          const chico = { padding: '6px 10px', fontSize: 13, minHeight: 0, lineHeight: 1.2, borderRadius: 8, boxShadow: 'none', whiteSpace: 'nowrap' }
                          return createPortal(
                            <div
                              className="admin-sheet-overlay"
                              onClick={() => setShareModalOpen(false)}
                              style={{ position: 'fixed', inset: 0, zIndex: 3000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                            >
                              <div className="free-note-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 460, width: '100%', maxHeight: '88vh', display: 'flex', flexDirection: 'column' }}>
                                <div className="free-note-modal-header">
                                  <h4>📲 Fotos ({items.length})</h4>
                                  <button type="button" className="modal-close-btn" onClick={() => setShareModalOpen(false)}>✕</button>
                                </div>
                                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', padding: '2px 2px 8px', borderBottom: '2px solid #E8DFC8' }}>
                                  <button type="button" onClick={() => selectAllLabels(galleryPlants)} style={chico}>☑ Todas</button>
                                  <button type="button" onClick={() => clearLabels()} style={chico}>🧹 Limpiar</button>
                                  <span style={{ flex: 1, textAlign: 'right', fontSize: 12, color: '#7a7060' }}>Con foto: {conFoto}</span>
                                </div>
                                <div style={{ overflowY: 'auto', maxHeight: '42vh', padding: '2px' }}>
                                  {items.length === 0 && <p className="status-msg">No hay plantas en la lista.</p>}
                                  {items.map(x => (
                                    <div key={x.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 2px', borderBottom: '1px solid #eee' }}>
                                      {x.image_url ? (
                                        <img src={x.image_url} alt="" loading="lazy" style={{ width: 36, height: 36, objectFit: 'cover', borderRadius: 8, flexShrink: 0, border: '1px solid #ddd' }} />
                                      ) : (
                                        <div style={{ width: 36, height: 36, borderRadius: 8, flexShrink: 0, border: '1px dashed #ccc', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#bbb' }}>🌱</div>
                                      )}
                                      <span style={{ flex: 1, minWidth: 0, fontSize: 14, lineHeight: 1.2, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{x.name}</span>
                                      <button type="button" aria-label="Quitar de la lista" title="Quitar de la lista" onClick={() => toggleLabelSelect(x.id)}
                                        style={{ width: 24, border: 'none', background: 'none', boxShadow: 'none', padding: 0, minHeight: 0, fontSize: 16, color: '#b03434', cursor: 'pointer' }}>✕</button>
                                    </div>
                                  ))}
                                </div>
                                <p style={{ margin: '8px 2px 0', fontSize: 12, color: '#7a7060' }}>Se envían las fotos con el nombre de cada planta, sin precio.</p>
                                <button type="button" className="save-note-btn-inline" disabled={conFoto === 0 || sharingNotes} onClick={() => shareSelectedPhotosDirect(galleryRealPlants)} style={{ marginTop: 8 }}>
                                  {sharingNotes ? 'Preparando...' : `📲 Enviar fotos (${conFoto})`}
                                </button>
                              </div>
                            </div>,
                            document.body
                          )
                        })()}

                        {carouselModalOpen && (() => {
                          const items = labelItemsList().filter(x => selectedLabels.has(x.id))
                          const idsReales = items.filter(x => !x.isSeed).map(x => x.id)
                          const fotoDe = x => x.carousel_image_url || x.image_url
                          const enCarrusel = plants.filter(x => x.coming_soon).slice().sort((a, b) => String(a.name).localeCompare(String(b.name), 'es'))
                          const visibles = enCarrusel.filter(x => x.marcado_cliente && fotoDe(x)).slice(0, 8)
                          const visiblesIds = new Set(visibles.map(x => x.id))
                          const motivo = x => (!x.marcado_cliente ? 'No se ve: no está en la tienda' : !fotoDe(x) ? 'No se ve: no tiene foto' : !visiblesIds.has(x.id) ? 'No se ve: ya hay 8' : '✓ Se ve en la tienda')
                          const chico = { padding: '6px 10px', fontSize: 13, minHeight: 0, lineHeight: 1.2, borderRadius: 8, boxShadow: 'none', whiteSpace: 'nowrap' }
                          const titulo = txt => <p style={{ margin: '12px 2px 6px', fontSize: 12, fontWeight: 700, color: '#7a7060', letterSpacing: '0.04em', textTransform: 'uppercase' }}>{txt}</p>
                          const guardar = async () => {
                            const marcadas = new Set(idsReales)
                            const aQuitar = enCarrusel.filter(x => !marcadas.has(x.id)).map(x => x.id)
                            const aPoner = idsReales.filter(id => !enCarrusel.some(x => x.id === id))
                            if (aQuitar.length === 0 && aPoner.length === 0) { alert('El carrusel ya está igual a lo que marcaste.'); return }
                            if (idsReales.length === 0 && !confirm('No marcaste ninguna planta: se quitarán todas del carrusel. ¿Seguro?')) return
                            if (aPoner.length) await setComingSoonBulk(aPoner, true)
                            if (aQuitar.length) await setComingSoonBulk(aQuitar, false)
                            const fuera = items.filter(x => !x.isSeed && !x.marcado_cliente)
                            if (fuera.length && confirm(`${fuera.length} planta(s) no están en la tienda y no se verían en el carrusel. ¿Ponerlas también en la tienda?`)) {
                              markSelectedClienteAll(new Set(fuera.map(x => x.id)), true)
                            }
                          }
                          return createPortal(
                            <div
                              className="admin-sheet-overlay"
                              onClick={() => { setCarouselModalOpen(false); setCarouselPickFor(null) }}
                              style={{ position: 'fixed', inset: 0, zIndex: 3000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                            >
                              <div className="free-note-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 460, width: '100%', maxHeight: '88vh', display: 'flex', flexDirection: 'column' }}>
                                <div className="free-note-modal-header">
                                  <h4>🎠 Carrusel ({visibles.length} de 8)</h4>
                                  <button type="button" className="modal-close-btn" onClick={() => { setCarouselModalOpen(false); setCarouselPickFor(null) }}>✕</button>
                                </div>
                                <p style={{ margin: '0 2px 6px', fontSize: 12, color: '#7a7060' }}>Es el carrusel de arriba de la tienda (🔜 Próximamente). Sale una foto por planta, hasta 8, en orden alfabético, y deben estar en la tienda.</p>

                                <div style={{ overflowY: 'auto', maxHeight: '46vh', padding: '2px' }}>
                                  {enCarrusel.length === 0 && <p className="status-msg">Todavía no hay plantas en el carrusel.</p>}
                                  {enCarrusel.map(x => {
                                    const fotos = [['Foto 1', x.image_url], ['Foto 2', x.extra_image_1], ['Foto 3', x.extra_image_2], ['Foto 4', x.extra_image_3]].filter(f => f[1])
                                    return (
                                      <div key={x.id} style={{ borderBottom: '1px solid #eee', padding: '6px 2px' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                          {fotoDe(x) ? (
                                            <img src={fotoDe(x)} alt="" loading="lazy" style={{ width: 44, height: 44, objectFit: 'cover', borderRadius: 8, flexShrink: 0, border: '1px solid #ddd' }} />
                                          ) : (
                                            <div style={{ width: 44, height: 44, borderRadius: 8, flexShrink: 0, border: '1px dashed #ccc', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#bbb' }}>🌱</div>
                                          )}
                                          <div style={{ flex: 1, minWidth: 0 }}>
                                            <div style={{ fontSize: 14, lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{x.name}</div>
                                            <small style={{ color: visiblesIds.has(x.id) ? '#2E6B47' : '#b06a00' }}>{motivo(x)}</small>
                                          </div>
                                          <button type="button" aria-label="Elegir la foto del carrusel" title="Elegir la foto" onClick={() => setCarouselPickFor(carouselPickFor === x.id ? null : x.id)} style={chico}>📷</button>
                                          <button type="button" aria-label="Quitar del carrusel" title="Quitar del carrusel" onClick={() => { setComingSoonBulk([x.id], false); setModeSets(prev => ({ ...prev, carrusel: new Set(Array.from(prev.carrusel).filter(id => id !== x.id)) })) }}
                                            style={{ width: 24, border: 'none', background: 'none', boxShadow: 'none', padding: 0, minHeight: 0, fontSize: 16, color: '#b03434', cursor: 'pointer' }}>✕</button>
                                        </div>
                                        {carouselPickFor === x.id && (
                                          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', padding: '8px 0 2px' }}>
                                            {fotos.length === 0 && <small style={{ color: '#7a7060' }}>Esta planta no tiene fotos.</small>}
                                            {fotos.map(([nombre, url]) => (
                                              <button key={nombre} type="button" onClick={() => setCarouselPhoto(x.id, url)}
                                                style={{ padding: 3, width: 'auto', minHeight: 0, borderRadius: 10, boxShadow: 'none', background: '#fff', border: `3px solid ${fotoDe(x) === url ? '#4a5d3a' : '#E8DFC8'}`, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                                                <img src={url} alt={nombre} style={{ width: 62, height: 62, objectFit: 'cover', borderRadius: 7 }} />
                                                <small style={{ fontSize: 11 }}>{nombre}{fotoDe(x) === url ? ' ✓' : ''}</small>
                                              </button>
                                            ))}
                                          </div>
                                        )}
                                      </div>
                                    )
                                  })}
                                </div>

                                {titulo(`Marcadas (${items.length})`)}
                                <button type="button" className="save-note-btn-inline" onClick={guardar}>💾 Guardar carrusel ({idsReales.length})</button>
                                <p style={{ margin: '6px 2px 0', fontSize: 12, color: '#7a7060' }}>El carrusel queda con las plantas que marcaste: las nuevas se agregan y las que desmarcaste se quitan.</p>
                              </div>
                            </div>,
                            document.body
                          )
                        })()}

                        {storeModalOpen && (() => {
                          const items = labelItemsList().filter(x => selectedLabels.has(x.id))
                          const idsReales = items.filter(x => !x.isSeed).map(x => x.id)
                          const enTienda = items.filter(x => x.marcado_cliente).length
                          const chico = { padding: '6px 10px', fontSize: 13, minHeight: 0, lineHeight: 1.2, borderRadius: 8, boxShadow: 'none', whiteSpace: 'nowrap' }
                          const titulo = txt => <p style={{ margin: '12px 2px 6px', fontSize: 12, fontWeight: 700, color: '#7a7060', letterSpacing: '0.04em', textTransform: 'uppercase' }}>{txt}</p>
                          return createPortal(
                            <div
                              className="admin-sheet-overlay"
                              onClick={() => setStoreModalOpen(false)}
                              style={{ position: 'fixed', inset: 0, zIndex: 3000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                            >
                              <div className="free-note-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 460, width: '100%', maxHeight: '88vh', display: 'flex', flexDirection: 'column' }}>
                                <div className="free-note-modal-header">
                                  <h4>🛍️ Tienda ({items.length})</h4>
                                  <button type="button" className="modal-close-btn" onClick={() => setStoreModalOpen(false)}>✕</button>
                                </div>

                                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', padding: '2px 2px 8px', borderBottom: '2px solid #E8DFC8' }}>
                                  <button type="button" onClick={() => selectAllLabels(galleryPlants)} style={chico}>☑ Todas</button>
                                  <button type="button" onClick={() => clearLabels()} style={chico}>🧹 Limpiar</button>
                                  <span style={{ flex: 1, textAlign: 'right', fontSize: 12, color: '#7a7060' }}>En la tienda: {enTienda} de {items.length}</span>
                                </div>

                                <div style={{ overflowY: 'auto', maxHeight: '32vh', padding: '2px' }}>
                                  {items.length === 0 && <p className="status-msg">No hay plantas en la lista.</p>}
                                  {items.map(x => (
                                    <div key={x.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 2px', borderBottom: '1px solid #eee' }}>
                                      {x.image_url ? (
                                        <img src={x.image_url} alt="" loading="lazy" style={{ width: 36, height: 36, objectFit: 'cover', borderRadius: 8, flexShrink: 0, border: '1px solid #ddd' }} />
                                      ) : (
                                        <div style={{ width: 36, height: 36, borderRadius: 8, flexShrink: 0, border: '1px dashed #ccc', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#bbb' }}>🌱</div>
                                      )}
                                      <span style={{ flex: 1, minWidth: 0, fontSize: 14, lineHeight: 1.2, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{x.name}</span>
                                      <span style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                                        {x.marcado_cliente ? '🟢' : '⚪'}{!x.isSeed && x.coming_soon ? ' 🔜' : ''}{!x.isSeed && Number(x.discount_percent) > 0 ? ` −${x.discount_percent}%` : ''}
                                      </span>
                                      <button type="button" aria-label="Quitar de la lista" title="Quitar de la lista" onClick={() => toggleLabelSelect(x.id)}
                                        style={{ width: 24, border: 'none', background: 'none', boxShadow: 'none', padding: 0, minHeight: 0, fontSize: 16, color: '#b03434', cursor: 'pointer' }}>✕</button>
                                    </div>
                                  ))}
                                </div>

                                {titulo('En la tienda')}
                                <div style={{ display: 'flex', gap: 8 }}>
                                  <button type="button" className="save-note-btn-inline" disabled={items.length === 0} onClick={() => markSelectedClienteAll(selectedLabels, true)} style={{ flex: 1 }}>🟢 Poner</button>
                                  <button type="button" disabled={items.length === 0} onClick={() => markSelectedClienteAll(selectedLabels, false)} style={{ flex: 1 }}>⚪ Quitar</button>
                                </div>

                                {titulo('Descuento')}
                                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                  <input
                                    type="number"
                                    inputMode="decimal"
                                    min="0"
                                    max="100"
                                    placeholder="% (0 lo quita)"
                                    value={storeDiscount}
                                    onChange={e => setStoreDiscount(e.target.value)}
                                    style={{ flex: 1, minWidth: 0, boxSizing: 'border-box' }}
                                  />
                                  <button type="button" disabled={idsReales.length === 0} onClick={() => applyDiscountPercent(idsReales, storeDiscount)}>Aplicar</button>
                                </div>

                                {titulo('Link de la tienda')}
                                <div style={{ display: 'flex', gap: 8 }}>
                                  <button type="button" className="save-note-btn-inline" onClick={sendStoreLink} style={{ flex: 1 }}>🔗 Enviar link</button>
                                  <button type="button" onClick={copySharedLink} style={{ flex: 1 }}>📋 Copiar link</button>
                                </div>
                                <p style={{ margin: '6px 2px 0', fontSize: 12, color: '#7a7060' }}>El cliente ve las plantas que están en la tienda (🟢): fotos y precio.</p>
                              </div>
                            </div>,
                            document.body
                          )
                        })()}
                      </>
                    )
                  })()}

              {!loading && view === 'categorias' && (
                <>
                  <form className="admin-form" onSubmit={addCategory}>
                    <h3>Agregar categoría nueva</h3>
                    <input placeholder="Nombre de la categoría" value={newCatName} onChange={e => setNewCatName(e.target.value)} />
                    <input placeholder="Emoji (ej: 🌷)" value={newCatEmoji} onChange={e => setNewCatEmoji(e.target.value)} />
                    <select value={newCatParentId} onChange={e => setNewCatParentId(e.target.value)}>
                      <option value="">Sin agrupar (categoría normal)</option>
                      {categories.filter(c => !c.parent_id).map(c => (
                        <option key={c.id} value={c.id}>Agrupar dentro de: {c.emoji} {c.name}</option>
                      ))}
                    </select>
                    <button type="submit">Agregar categoría</button>
                  </form>
                  <input
                    className="order-search"
                    placeholder="Buscar categoría por nombre..."
                    value={categoriesSearch}
                    onChange={e => setCategoriesSearch(e.target.value)}
                  />
                  <div className="admin-list">
                    {categories
                      .filter(c => !c.parent_id)
                      .filter(parentCat =>
                        parentCat.name.toLowerCase().includes(categoriesSearch.trim().toLowerCase()) ||
                        categories.some(child => child.parent_id === parentCat.id && child.name.toLowerCase().includes(categoriesSearch.trim().toLowerCase()))
                      )
                      .map(c => {
                        const children = categories.filter(child => child.parent_id === c.id)
                        return (
                          <div key={c.id}>
                            <div className="admin-item">
                              {c.image_url ? <img src={c.image_url} alt={c.name} /> : <div className="no-img-sm">{c.emoji}</div>}
                              <div className="admin-item-info">
                                <input defaultValue={c.name} onBlur={e => updateCategoryName(c.id, e.target.value)} style={{ fontWeight: 'bold', fontSize: '1rem', width: '100%', boxSizing: 'border-box' }} />
                                <label>Emoji: <input defaultValue={c.emoji} onBlur={e => updateCategoryEmoji(c.id, e.target.value)} style={{ width: 50 }} /></label>
                                <label className="file-label" title="Subir imagen de categoría" style={{ background: 'transparent', color: 'inherit', border: '1px solid #ccc', display: 'inline-block' }}>
                                  📷 Imagen
                                  <input
                                    type="file"
                                    accept="image/*"
                                    style={{ display: 'none' }}
                                    onChange={e => { uploadCategoryImage(c.id, e.target.files[0]); e.target.value = '' }}
                                  />
                                </label>
                                <button type="button" className="danger" onClick={() => deleteCategory(c.id)} style={{ marginLeft: 6 }}>🗑️ Borrar</button>
                                {children.length > 0 ? (
                                  <p style={{ fontSize: 12, color: '#7a7060', margin: '4px 0 0' }}>
                                    📁 Agrupa: {children.map(ch => ch.name).join(', ')} — no se puede asignar directo a una planta
                                  </p>
                                ) : (
                                  <label>Grupo:
                                    <select value="" onChange={e => updateCategoryParent(c.id, e.target.value)}>
                                      <option value="">Sin agrupar</option>
                                      {categories.filter(x => !x.parent_id && x.id !== c.id).map(x => (
                                        <option key={x.id} value={x.id}>{x.emoji} {x.name}</option>
                                      ))}
                                    </select>
                                  </label>
                                )}
                              </div>
                            </div>
                            {children
                              .filter(child => categoriesSearch.trim() === '' || child.name.toLowerCase().includes(categoriesSearch.trim().toLowerCase()))
                              .map(child => (
                                <div key={child.id} className="admin-item" style={{ marginLeft: 24, borderLeft: '2px solid #E8DFC8' }}>
                                  {child.image_url ? <img src={child.image_url} alt={child.name} /> : <div className="no-img-sm">{child.emoji}</div>}
                                  <div className="admin-item-info">
                                    <input defaultValue={child.name} onBlur={e => updateCategoryName(child.id, e.target.value)} style={{ fontWeight: 'bold', fontSize: '1rem', width: '100%', boxSizing: 'border-box' }} />
                                    <label>Emoji: <input defaultValue={child.emoji} onBlur={e => updateCategoryEmoji(child.id, e.target.value)} style={{ width: 50 }} /></label>
                                    <label className="file-label" title="Subir imagen de categoría" style={{ background: 'transparent', color: 'inherit', border: '1px solid #ccc', display: 'inline-block' }}>
                                      📷 Imagen
                                      <input
                                        type="file"
                                        accept="image/*"
                                        style={{ display: 'none' }}
                                        onChange={e => { uploadCategoryImage(child.id, e.target.files[0]); e.target.value = '' }}
                                      />
                                    </label>
                                    <label>Grupo:
                                      <select value={child.parent_id || ''} onChange={e => updateCategoryParent(child.id, e.target.value)}>
                                        <option value="">Sin agrupar</option>
                                        {categories.filter(x => !x.parent_id && x.id !== child.id).map(x => (
                                          <option key={x.id} value={x.id}>{x.emoji} {x.name}</option>
                                        ))}
                                      </select>
                                    </label>
                                    <button type="button" className="danger" onClick={() => deleteCategory(child.id)} style={{ marginLeft: 6 }}>🗑️ Borrar</button>
                                  </div>
                                </div>
                              ))}
                          </div>
                        )
                      })}
                  </div>
                </>
              )}

              {seedSheetId && (() => {
                const sb = seedBatches.find(b => b.id === seedSheetId)
                if (!sb) return null
                const closeSheet = () => { setSeedSheetId(null); setSeedSheetMenuOpen(false); setSeedSheetSection('resumen') }
                const goSection = sec => { setSeedSheetSection(sec); setSeedSheetMenuOpen(false); if (sec === 'ventas') setSeedVentasFilter('all') }
                const blocks = Array.isArray(sb.content_blocks) ? sb.content_blocks : []
                const fotosDelLote = [
                  ...blocks.filter(b => b && b.type === 'photo' && b.url).map(b => b.url),
                  ...seedBatchEvents.filter(ev => ev.seed_batch_id === sb.id && ev.photo_url).map(ev => ev.photo_url),
                ]
                const cat = categories.find(c => c.id === sb.category_id)
                const plantaOrigen = plants.find(p => p.id === sb.plant_id)
                const stockSb = Number(sb.stock) || 0
                const ventasDelLote = decrementos
                  .filter(d => d.seed_batch_id === sb.id)
                  .map(d => {
                    const lote = d.lote_id ? ventaLotes.find(vl => vl.id === d.lote_id) : null
                    return { id: d.id, busyId: d.id, d, toggle: (flag, val) => toggleDecrementoFlag(d, flag, val), saveAnticipo: val => updateDecrementoAnticipo(d, val), cantidad: Number(d.quantity) || 0, cliente: lote?.cliente || '', numero: lote?.numero, fecha: d.created_at, motivo: d.motivo, unit_price: Number(d.unit_price) || 0, pagado: pagadoDe(d), entregado: entregadoDe(d), anticipo: Number(d.anticipo) || 0 }
                  })
                  .sort((a, b) => new Date(b.fecha) - new Date(a.fecha))
                const totalVendidas = ventasDelLote.reduce((sum, v) => sum + v.cantidad, 0)
                const entregadasQty = ventasDelLote.filter(v => v.entregado).reduce((sum, v) => sum + v.cantidad, 0)
                const porEntregarQty = totalVendidas - entregadasQty
                const compradasQty = Number(sb.cantidad_semillas) || 0
                const sembradasQty = Number(sb.sembradas) || 0
                const deberianQuedar = compradasQty - totalVendidas - sembradasQty
                const stockNoCoincide = compradasQty > 0 && deberianQuedar !== stockSb
                const vendidoSb = ventasDelLote.reduce((sum, v) => sum + v.cantidad * v.unit_price, 0)
                const cobradoSb = ventasDelLote.reduce((sum, v) => sum + (v.pagado ? v.cantidad * v.unit_price : (v.anticipo || 0)), 0)
                const costoTotal = (Number(sb.costo) || 0) + (Number(sb.envio1) || 0) + (Number(sb.envio2) || 0) + (Number(sb.varios) || 0)
                return createPortal(
                  <div className="admin-sheet-overlay" onClick={closeSheet} style={{ position: 'fixed', inset: 0, zIndex: 3000 }}>
                    <div className="free-note-modal" onClick={e => e.stopPropagation()} style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, width: '100%', height: '100%', maxWidth: 'none', maxHeight: 'none', borderRadius: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                      <div className="free-note-modal-header" style={{ flexShrink: 0 }}>
                        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                          <button type="button" onClick={() => setSeedSheetMenuOpen(o => !o)}>☰</button>
                          <h4>🌰 {seedBatchRawName(sb)}</h4>
                        </div>
                        <button type="button" className="modal-close-btn" onClick={closeSheet}>✕</button>
                      </div>

                      {seedSheetMenuOpen && (
                        <>
                          <div className="photo-modal-menu-overlay" onClick={() => setSeedSheetMenuOpen(false)} />
                          <div className="photo-modal-side-menu">
                            <button type="button" onClick={() => goSection('resumen')}>🌰 Resumen</button>
                            <button type="button" onClick={() => goSection('fotos')}>🖼️ Fotos ({fotosDelLote.length})</button>
                            <button type="button" onClick={() => goSection('notas')}>📓 Notas ({blocks.length})</button>
                            <button type="button" onClick={() => goSection('compras')}>📦 Compras</button>
                            <button type="button" onClick={() => goSection('ventas')}>🛒 Ventas ({ventasDelLote.length})</button>
                          </div>
                        </>
                      )}

                      <div className="free-note-sheet" style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
                        {seedSheetSection === 'resumen' && (
                          <div className="historial-block">
                            {fotosDelLote[0] && <img src={fotosDelLote[0]} alt={seedBatchRawName(sb)} style={{ width: '100%', maxHeight: 240, objectFit: 'cover', borderRadius: 10, marginBottom: 8 }} />}
                            <p className="historial-entry">{cat ? `${cat.emoji} ${cat.name}` : 'Sin categoría'} · {sb.origen === 'cosecha' ? `Cosecha de ${plantaOrigen?.name || 'planta'}` : `Compra${sb.proveedor ? ` a ${sb.proveedor}` : ''}`}</p>
                            <p className="historial-entry"><strong>Stock:</strong> {stockSb} semillas · <strong>Precio:</strong> {sb.price ? `$${Number(sb.price).toFixed(2)}` : 'sin precio'}</p>
                            <p className="historial-entry">
                              <strong>Vendidas:</strong> {totalVendidas}{totalVendidas > 0 ? ` (${entregadasQty} entregadas, ${porEntregarQty} por entregar)` : ''}
                              {sembradasQty > 0 ? ` · Sembradas: ${sembradasQty}` : ''} · <strong>Estado:</strong> {sb.estado}
                            </p>
                            {compradasQty > 0 && (
                              <p className="historial-entry" style={stockNoCoincide ? { color: '#b03434', fontWeight: 600 } : undefined}>
                                🧮 Compradas: {compradasQty} − Vendidas: {totalVendidas}{sembradasQty > 0 ? ` − Sembradas: ${sembradasQty}` : ''} = deberían quedar {deberianQuedar} · Stock guardado: {stockSb}
                                {stockNoCoincide && ' ⚠️ no coincide — revisa el campo "Stock semillas" en Ingresos → Semillas (puede que se haya escrito a mano en algún momento)'}
                              </p>
                            )}
                            {renderMoneyCard({ vendido: vendidoSb, cobrado: cobradoSb, comprado: costoTotal, extra: stockSb > 0 && sb.price ? <div style={{ fontSize: 12.5 }}>📦 Stock restante: {stockSb} × {money(sb.price)} = {money(stockSb * Number(sb.price))} (si se vende todo)</div> : null })}
                            {(() => {
                              const reps = blocks.filter(b => b && b.kind === 'replanteo').sort((a, b) => new Date(b.at) - new Date(a.at))
                              if (reps.length === 0) return null
                              return (
                                <div style={{ margin: '8px 0', padding: 8, background: '#f3f8ee', borderRadius: 8 }}>
                                  <strong>🪴 Replanteos</strong>
                                  {reps.map((b, i) => (
                                    <p key={i} className="historial-entry" style={{ margin: '4px 0 0' }}>
                                      <span style={{ color: '#8a8a7a', fontSize: 11.5 }}>{new Date(b.at).toLocaleDateString()}</span> · {b.content.replace(/^🪴 Replanteo — /, '')}
                                    </p>
                                  ))}
                                </div>
                              )
                            })()}
                            <p className="historial-empty">Al guardar una venta con este lote, el stock se descuenta del lote. Cuando ya sean plantitas, usa 🪴 Convertir en planta en Ingresos → Semillas.</p>
                            <div className="admin-item-actions" style={{ marginTop: 8, flexWrap: 'wrap' }}>
                              <button type="button" onClick={() => sellSeedBatch(sb)} disabled={stockSb <= 0}>
                                {stockSb <= 0 ? '🛒 Sin stock' : '🛒 Vender'}
                              </button>
                              <button type="button" onClick={() => sembrarSemillas(sb)} disabled={stockSb <= 0}>🌱 Sembrar semillas</button>
                              <button type="button" onClick={() => anotarGerminacion(sb)}>🌿 Anotar germinación</button>
                              <button type="button" onClick={() => setReplanteoForm({ batchId: sb.id, fecha: localDateISO(), texto: '', file: null })}>🪴 Replanteo</button>
                              <label className="icon-btn-text" style={{ cursor: 'pointer' }}>
                                📷 Agregar foto
                                <input type="file" accept="image/*" style={{ display: 'none' }} onChange={e => { addSeedBatchPhoto(sb, e.target.files[0]); e.target.value = '' }} />
                              </label>
                              {sb.en_venta && (
                                <button type="button" onClick={() => { toggleSeedBatchEnVenta(sb, false); closeSheet() }} className="danger">
                                  Quitar de la venta
                                </button>
                              )}
                            </div>
                          </div>
                        )}

                        {seedSheetSection === 'fotos' && (
                          <div className="historial-block">
                            <h4>🖼️ Fotos</h4>
                            {fotosDelLote.length === 0 ? (
                              <p className="historial-empty">Todavía no hay fotos. Usa "📷 Agregar foto" en Resumen o en Ingresos → Semillas.</p>
                            ) : (
                              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8 }}>
                                {fotosDelLote.map((url, i) => <img key={i} src={url} alt="" style={{ width: '100%', aspectRatio: '1 / 1', objectFit: 'cover', borderRadius: 8 }} />)}
                              </div>
                            )}
                          </div>
                        )}

                        {seedSheetSection === 'notas' && (
                          <div className="historial-block">
                            <h4>📓 Notas de seguimiento</h4>
                            {blocks.length === 0 ? (
                              <p className="historial-empty">Sin notas todavía.</p>
                            ) : (
                              blocks.map((b, i) => (
                                <div key={i} className="note-sheet-block">
                                  {(b.at || b.type === 'text') && (
                                    <div style={{ fontSize: 11.5, color: '#8a8a7a', marginBottom: 2 }}>
                                      {formatBlockDate(b.at)}{b.editedAt ? ' · editado' : ''}
                                    </div>
                                  )}
                                  {b.type === 'text' && <p>{b.content}</p>}
                                  {b.type === 'photo' && b.url && <img src={b.url} alt="" className="note-sheet-photo" />}
                                  {b.type === 'video' && b.url && <video src={b.url} controls className="note-video" />}
                                </div>
                              ))
                            )}
                            <button type="button" style={{ marginTop: 8 }} onClick={() => { closeSheet(); setView('ingresos'); setIngresosSubTab('semillas'); openSbNote(sb) }}>
                              ✏️ Editar notas
                            </button>
                          </div>
                        )}

                        {seedSheetSection === 'compras' && (
                          <div className="historial-block">
                            <h4>📦 Compra</h4>
                            <p className="historial-entry">{sb.origen === 'cosecha' ? `Cosecha de ${plantaOrigen?.name || 'planta'}` : `Compra${sb.proveedor ? ` a ${sb.proveedor}` : ''}`}</p>
                            <p className="historial-entry">Fecha: {sb.fecha ? new Date(sb.fecha + 'T00:00:00').toLocaleDateString() : '—'}</p>
                            <p className="historial-entry" style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                              Semillas del lote:
                              <input
                                type="number" step="1" min="0" defaultValue={sb.cantidad_semillas}
                                onBlur={e => updateSeedBatchField(sb.id, 'cantidad_semillas', Number(e.target.value) || 0)}
                                style={{ width: 60 }}
                              />
                              · Stock actual: {stockSb}
                            </p>
                            <p style={{ fontSize: 11.5, color: '#8a8a7a', margin: '0 0 6px' }}>
                              Esta cantidad no cambia el stock por sí sola; solo se usa para la cuenta de "deberían quedar" de más abajo.
                            </p>
                            <p className="historial-entry">Costo: ${(Number(sb.costo) || 0).toFixed(2)} · Envío 1: ${(Number(sb.envio1) || 0).toFixed(2)} · Envío 2: ${(Number(sb.envio2) || 0).toFixed(2)} · Varios: ${(Number(sb.varios) || 0).toFixed(2)}</p>
                            <p className="historial-entry"><strong>Total comprado: ${costoTotal.toFixed(2)}</strong></p>
                            {renderMoneyCard({ vendido: vendidoSb, cobrado: cobradoSb, comprado: costoTotal })}
                          </div>
                        )}

                        {seedSheetSection === 'ventas' && (
                          <div className="historial-block">
                            <h4>🛒 Ventas</h4>
                            {ventasDelLote.length > 0 && renderMoneyCard({ vendido: vendidoSb, cobrado: cobradoSb, comprado: costoTotal })}
                            {renderVentasConEstado(ventasDelLote)}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>,
                  document.body
                )
              })()}

              {replanteoForm && createPortal(
                <div className="admin-sheet-overlay" onClick={() => setReplanteoForm(null)} style={{ position: 'fixed', inset: 0, zIndex: 3200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <div className="free-note-modal" onClick={e => e.stopPropagation()} style={{ padding: 16, maxWidth: 420, width: '92%', display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <h4 style={{ margin: 0 }}>🪴 Replanteo — {(() => { const b = seedBatches.find(x => x.id === replanteoForm.batchId); return b ? seedBatchRawName(b) : '' })()}</h4>
                    <label className="seed-form-field-label">
                      Fecha
                      <input type="date" value={replanteoForm.fecha} onChange={e => setReplanteoForm(f => ({ ...f, fecha: e.target.value }))} />
                    </label>
                    <textarea
                      className="note-sheet-textarea"
                      rows={4}
                      autoFocus
                      placeholder="¿Qué está pasando? (ej. pasé 20 plántulas a bandeja, 5 no sobrevivieron...)"
                      value={replanteoForm.texto}
                      onChange={e => setReplanteoForm(f => ({ ...f, texto: e.target.value }))}
                    />
                    <label className="seed-form-field-label">
                      📷 Foto (opcional)
                      <input type="file" accept="image/*" onChange={e => setReplanteoForm(f => ({ ...f, file: e.target.files[0] || null }))} />
                    </label>
                    <div className="admin-item-actions">
                      <button type="button" onClick={saveReplanteo} disabled={savingReplanteo}>{savingReplanteo ? 'Guardando…' : 'Guardar replanteo'}</button>
                      <button type="button" onClick={() => setReplanteoForm(null)}>Cancelar</button>
                    </div>
                  </div>
                </div>,
                document.body
              )}

              {photoModalPlantId && (() => {
                const p = plants.find(pl => pl.id === photoModalPlantId)
                if (!p) return null
                const notesForPlant = plantNotes.filter(n => n.plant_id === p.id)
                const nameNormalized = p.name.trim().toLowerCase()
                const comprasDeEstaPlanta = compras
                  .filter(c => c.plant_id === p.id || (!c.plant_id && c.plant_name && c.plant_name.trim().toLowerCase() === nameNormalized))
                  .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
                const ventasWebDeEstaPlanta = orders.flatMap(o =>
                  (o.order_items || [])
                    .filter(it => it.plant_id === p.id)
                    .map(it => ({ id: `o-${o.id}-${it.id}`, busyId: o.id, cantidad: Number(it.quantity) || 0, cliente: o.customer_name, fecha: o.created_at, motivo: null, pagado: pagadoDe(o), entregado: entregadoDe(o), anticipo: Number(o.anticipo) || 0, unit_price: Number(it.price ?? p.price) || 0, numero: null, toggle: (flag, val) => toggleOrderFlag(o, flag, val), saveAnticipo: val => updateOrderAnticipo(o, val) }))
                )
                const ventasManualesDeEstaPlanta = decrementos
                  .filter(d => d.plant_id === p.id)
                  .map(d => ({ id: `d-${d.id}`, busyId: d.id, cantidad: Number(d.quantity) || 0, cliente: d.lote_id ? (ventaLotes.find(vl => vl.id === d.lote_id)?.cliente || '') : '', numero: d.lote_id ? ventaLotes.find(vl => vl.id === d.lote_id)?.numero : null, fecha: d.created_at, motivo: d.motivo, pagado: pagadoDe(d), entregado: entregadoDe(d), anticipo: Number(d.anticipo) || 0, unit_price: Number(d.unit_price) || 0, toggle: (flag, val) => toggleDecrementoFlag(d, flag, val), saveAnticipo: val => updateDecrementoAnticipo(d, val) }))
                const ventasDeEstaPlanta = [...ventasWebDeEstaPlanta, ...ventasManualesDeEstaPlanta]
                  .sort((a, b) => new Date(b.fecha) - new Date(a.fecha))
                const vendidoP = ventasDeEstaPlanta.reduce((sum, v) => sum + v.cantidad * v.unit_price, 0)
                const cobradoP = ventasDeEstaPlanta.reduce((sum, v) => sum + (v.pagado ? v.cantidad * v.unit_price : (v.anticipo || 0)), 0)
                // Compras con su total real (incluye la parte proporcional de envíos y varios de cada compra)
                const comprasConTotal = comprasDeEstaPlanta.map(c => {
                  const loteC = lotes.find(l => l.id === c.lote_id)
                  let total = (Number(c.unit_cost) || 0) * (Number(c.quantity) || 0)
                  if (loteC) {
                    const { lineas } = loteProration(loteC, compras.filter(x => x.lote_id === loteC.id))
                    const lp = lineas.find(x => x.id === c.id)
                    if (lp) total = lp._lineTotal
                  }
                  return { ...c, _total: total, _lote: loteC }
                })
                const compradoP = comprasConTotal.reduce((sum, c) => sum + c._total, 0)
                const floracionesDeEstaPlanta = floraciones.filter(f => f.plant_id === p.id)
                const pupsDeEstaPlanta = pups.filter(x => x.plant_id === p.id).sort((a, b) => new Date(b.fecha) - new Date(a.fecha))
                const hijosDisponibles = hijosEnDesarrollo(p.id)
                // Panel "Compra e inventario" (datos leídos de la BD al abrir el modal)
                const inv = plantInv && plantInv.plantId === p.id ? plantInv : null
                const invDraft = plantInvDraft && plantInvDraft.plantId === p.id ? plantInvDraft : null
                const invCompra = inv && invDraft ? inv.compras.find(c => String(c.id) === String(invDraft.compraId)) : null
                const invLote = invCompra && invCompra.lote_id ? inv.lotes.find(l => l.id === invCompra.lote_id) : null
                const invDirty = !!(invDraft && plantInvBase && JSON.stringify(invDraft) !== JSON.stringify(plantInvBase))
                const setInvDraft = patch => setPlantInvDraft(d => ({ ...d, ...patch }))
                const proveedoresSugeridos = [...new Set([...lotes.map(l => l.proveedor), ...compras.map(c => c.proveedor)].filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b)))
                const invInputStyle = { width: '100%', boxSizing: 'border-box' }
                const invGridStyle = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8, margin: '6px 0' }
                const invField = (label, control, hint) => (
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 12, color: '#5B4636' }}>
                    {label}
                    {control}
                    {hint && <span style={{ fontSize: 11, color: '#888' }}>{hint}</span>}
                  </label>
                )
                const slides = [
                  { type: 'image', url: p.image_url, label: 'Foto 1', onUpload: f => updatePlantImage(p.id, f) },
                  { type: 'image', url: p.extra_image_1, label: 'Foto 2', field: 'extra_image_1', onUpload: f => updatePlantExtraImage(p.id, 'extra_image_1', f) },
                  { type: 'image', url: p.extra_image_2, label: 'Foto 3', field: 'extra_image_2', onUpload: f => updatePlantExtraImage(p.id, 'extra_image_2', f) },
                  { type: 'image', url: p.extra_image_3, label: 'Foto 4', field: 'extra_image_3', onUpload: f => updatePlantExtraImage(p.id, 'extra_image_3', f) },
                  { type: 'video', url: p.video_url, label: 'Video', onUpload: f => updatePlantVideo(p.id, f) },
                ]
                const current = slides[photoModalIndex] || slides[0]
                return createPortal(
                  <div
                    className="admin-sheet-overlay"
                    onClick={() => { setPhotoModalPlantId(null); setPhotoModalMenuOpen(false); setPhotoModalSection('fotos') }}
                    style={{ position: 'fixed', inset: 0, zIndex: 3000 }}
                  >
                    <div className="free-note-modal" onClick={e => e.stopPropagation()} style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, width: '100%', height: '100%', maxWidth: 'none', maxHeight: 'none', borderRadius: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                      <div className="free-note-modal-header" style={{ flexShrink: 0 }}>
                        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                          <button type="button" onClick={() => setPhotoModalMenuOpen(!photoModalMenuOpen)}>☰</button>
                          <h4>{p.name}</h4>
                        </div>
                        <button type="button" className="modal-close-btn" onClick={() => { setPhotoModalPlantId(null); setPhotoModalMenuOpen(false); setPhotoModalSection('fotos') }}>✕</button>
                      </div>

                      {photoModalMenuOpen && (
                        <>
                          <div className="photo-modal-menu-overlay" onClick={() => setPhotoModalMenuOpen(false)} />
                          <div className="photo-modal-side-menu">
                            <button type="button" onClick={() => { setPhotoModalSection('fotos'); setPhotoModalMenuOpen(false); if (photoModalSheetRef.current) photoModalSheetRef.current.scrollTop = 0 }}>🖼️ Fotos</button>
                            <button type="button" onClick={() => { setPhotoModalSection('notas'); setPhotoModalMenuOpen(false); if (photoModalSheetRef.current) photoModalSheetRef.current.scrollTop = 0 }}>📓 Notas ({notesForPlant.length})</button>
                            <button type="button" onClick={() => { setPhotoModalSection('compras'); setPhotoModalMenuOpen(false); if (photoModalSheetRef.current) photoModalSheetRef.current.scrollTop = 0 }}>📦 Compras</button>
                            <button type="button" onClick={() => { setPhotoModalSection('ventas'); setSeedVentasFilter('all'); setPhotoModalMenuOpen(false); if (photoModalSheetRef.current) photoModalSheetRef.current.scrollTop = 0 }}>🛒 Ventas</button>
                            <button type="button" onClick={() => { setPhotoModalSection('floraciones'); setPhotoModalMenuOpen(false); if (photoModalSheetRef.current) photoModalSheetRef.current.scrollTop = 0 }}>🌸 Floraciones</button>
                            <button type="button" onClick={() => { setPhotoModalSection('hijos'); setPhotoModalMenuOpen(false); if (photoModalSheetRef.current) photoModalSheetRef.current.scrollTop = 0 }}>🌱 Hijos</button>
                            <button type="button" onClick={() => { setPhotoModalSection('separar'); setMixRows([{ name: '', qty: '' }, { name: '', qty: '' }]); setPhotoModalMenuOpen(false); if (photoModalSheetRef.current) photoModalSheetRef.current.scrollTop = 0 }}>🔀 Separar mix</button>
                          </div>
                        </>
                      )}

                      <div ref={photoModalSheetRef} className="free-note-sheet" style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
                        {photoModalSection === 'fotos' && (
                          <>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <button type="button" onClick={() => setPhotoModalIndex((photoModalIndex + slides.length - 1) % slides.length)}>‹</button>
                              <div style={{ flex: 1, textAlign: 'center' }}>
                                {current.type === 'image' ? (
                                  current.url ? <img src={current.url} alt={current.label} style={{ width: '100%', maxHeight: '55vh', objectFit: 'contain', borderRadius: 8 }} /> : <div className="no-img-sm" style={{ height: 200 }}>Sin foto</div>
                                ) : (
                                  current.url ? <video src={current.url} controls className="note-video" style={{ width: '100%', maxHeight: '55vh' }} /> : <div className="no-img-sm" style={{ height: 200 }}>Sin video</div>
                                )}
                                <div style={{ marginTop: 4, fontSize: 13, color: '#888' }}>{current.label} ({photoModalIndex + 1}/{slides.length})</div>
                                <label className="file-label" style={{ display: 'inline-block', marginTop: 4, background: 'transparent', color: 'inherit', border: '1px solid #ccc' }}>
                                  {current.url ? `Cambiar ${current.label}` : `Subir ${current.label}`}
                                  <input
                                    type="file"
                                    accept={current.type === 'video' ? 'video/*' : 'image/*'}
                                    style={{ display: 'none' }}
                                    onChange={e => { current.onUpload(e.target.files[0]); e.target.value = '' }}
                                  />
                                </label>
                                {current.type === 'image' && current.field && current.url && (
                                  <div>
                                    <button
                                      type="button"
                                      onClick={() => swapPlantCover(p.id, current.field)}
                                      style={{ marginTop: 6, background: 'transparent', color: 'inherit', border: '1px solid #ccc', borderRadius: 6, padding: '6px 10px' }}
                                    >
                                      ⭐ Usar como portada
                                    </button>
                                  </div>
                                )}
                              </div>
                              <button type="button" onClick={() => setPhotoModalIndex((photoModalIndex + 1) % slides.length)}>›</button>
                            </div>

                            <div className="plant-quick-edit">
                              <input
                                key={p.id}
                                defaultValue={p.name}
                                placeholder="Nombre de la planta"
                                onBlur={e => updatePlantName(p.id, e.target.value)}
                                style={{ width: '100%', fontWeight: 700, fontSize: '1.05rem', marginBottom: 8 }}
                              />
                              {(() => {
                                const unidades = comprasConTotal.reduce((sum, c) => sum + (Number(c.quantity) || 0), 0)
                                const costoSolo = comprasConTotal.reduce((sum, c) => sum + (Number(c.unit_cost) || 0) * (Number(c.quantity) || 0), 0)
                                const costoU = unidades > 0 ? costoSolo / unidades : null
                                const costoEnvioU = unidades > 0 ? compradoP / unidades : null
                                const desc = Number(p.discount_percent) || 0
                                const venta = Number(p.price) || 0
                                const conDesc = desc > 0 ? venta * (1 - desc / 100) : null
                                const celda = (titulo, valor, nota) => (
                                  <div style={{ flex: '1 1 45%', minWidth: 120, background: '#faf6ec', border: '1px solid #e6dcc3', borderRadius: 8, padding: '6px 8px' }}>
                                    <div style={{ fontSize: 11, color: '#7a7060' }}>{titulo}</div>
                                    <div style={{ fontWeight: 700 }}>{valor == null ? '—' : money(valor)}</div>
                                    {nota && <div style={{ fontSize: 10.5, color: '#8a8a7a' }}>{nota}</div>}
                                  </div>
                                )
                                return (
                                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                                    {celda('💰 Costo (lo que pagué)', costoU, 'por unidad')}
                                    {celda('🚚 Costo + envíos', costoEnvioU, 'por unidad')}
                                    {celda('🏷️ Precio de venta', venta || null)}
                                    {celda('🔻 Con descuento', conDesc, desc > 0 ? `−${desc}%` : 'sin descuento')}
                                  </div>
                                )
                              })()}
                              <div className="plant-quick-edit-prices">
                                <label>Venta $<input type="number" step="0.01" defaultValue={p.price} onBlur={e => updatePrice(p.id, Number(e.target.value))} /></label>
                                <label>Altura: <input key={p.id} type="text" placeholder="ej: 90 cm" defaultValue={p.height || ''} onBlur={e => updatePlantHeight(p.id, e.target.value)} style={{ width: 80 }} /></label>
                                <label>Descuento: <input key={p.id} type="number" min="0" max="100" placeholder="0" defaultValue={p.discount_percent || ''} onBlur={e => updatePlantDiscount(p.id, e.target.value)} style={{ width: 60 }} />%</label>
                              </div>
                              <div className="plant-quick-edit-actions">
                                <button type="button" className={p.is_new ? 'active' : ''} onClick={() => toggleIsNew(p.id, p.is_new)}>{p.is_new ? '🌱 Nueva ✓' : 'Marcar como nueva'}</button>
                                <button type="button" className={p.on_sale ? 'active' : ''} onClick={() => toggleOnSale(p.id, p.on_sale)}>{p.on_sale ? '🏷️ En descuento ✓' : 'Marcar en descuento'}</button>
                                <button type="button" className={p.coming_soon ? 'active' : ''} onClick={() => toggleComingSoon(p.id, p.coming_soon)}>{p.coming_soon ? '🔜 Próximamente ✓' : 'Marcar como próximamente'}</button>
                                <button
                                  type="button"
                                  className="danger"
                                  onClick={() => deletePlant(p.id, () => { setPhotoModalPlantId(null); setPhotoModalMenuOpen(false); setPhotoModalSection('fotos') })}
                                >
                                  🗑️ Borrar planta permanentemente
                                </button>
                              </div>
                            </div>

                            <div className="plant-quick-edit" style={{ marginTop: 12 }}>
                              <h4 style={{ margin: '0 0 8px', fontSize: '0.9rem', color: 'var(--sage-dark)' }}>
                                🌱 Hijos <span style={{ fontWeight: 400, color: '#7a7060' }}>· {hijosDisponibles} en desarrollo · stock {p.stock || 0}</span>
                              </h4>
                              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                                <input type="number" min="1" inputMode="numeric" placeholder="Cantidad" value={newPupCantidad} onChange={e => setNewPupCantidad(e.target.value)} style={{ width: 90 }} />
                                <button type="button" onClick={() => addPupRegistro(p.id, localDateISO(), newPupCantidad)}>🌱 Separé hijos hoy</button>
                                <button type="button" disabled={hijosDisponibles <= 0}
                                  onClick={() => { setPhotoModalSection('hijos'); setShowMoverPupsForm(true); if (photoModalSheetRef.current) photoModalSheetRef.current.scrollTop = 0 }}>
                                  ➡️ Pasar a stock
                                </button>
                              </div>
                              <p style={{ fontSize: 11, color: '#888', margin: '6px 0 0' }}>
                                Los hijos no suman al stock hasta que los pases a stock.{' '}
                                <button type="button" className="historial-link-btn" onClick={() => { setPhotoModalSection('hijos'); if (photoModalSheetRef.current) photoModalSheetRef.current.scrollTop = 0 }}>
                                  Ver historial ({pupsDeEstaPlanta.length})
                                </button>
                              </p>
                            </div>

                            <div className="plant-quick-edit" style={{ marginTop: 12 }}>
                              <h4 style={{ margin: '0 0 8px', fontSize: '0.9rem', color: 'var(--sage-dark)' }}>📦 Compra e inventario</h4>
                              {!invDraft || !inv ? (
                                <p className="status-msg">Cargando datos de la planta…</p>
                              ) : (
                                <>
                                  {(() => {
                                    const intsPlanta = intercambioItems.filter(x => String(x.plant_id) === String(p.id))
                                    if (intsPlanta.length === 0) return null
                                    return (
                                      <div style={{ margin: '2px 0 10px', padding: '8px 10px', borderRadius: 10, background: '#FFF8E6', border: '1px solid #E6C76A' }}>
                                        <div style={{ fontSize: 12, fontWeight: 700, color: '#5B4636', marginBottom: 4 }}>🔄 Intercambios de esta planta</div>
                                        {intsPlanta.map(x => {
                                          const cab = intercambios.find(c => c.id === x.intercambio_id)
                                          const est = x.direccion === 'recibido' ? (INT_ESTADOS[x.estado] || INT_ESTADOS.cuarentena) : null
                                          return (
                                            <div key={x.id} style={{ fontSize: 13, padding: '3px 0', display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'baseline' }}>
                                              <span>
                                                {x.direccion === 'recibido' ? '📥 Ingresó por intercambio' : '📤 Entregada en intercambio'} {cab ? <b>{folioInt(cab)}</b> : null}
                                                {cab && cab.contacto ? ` con ${cab.contacto}` : ''} · ×{x.quantity}
                                                {cab && cab.fecha ? ` · ${new Date(`${cab.fecha}T12:00:00`).toLocaleDateString()}` : ''}
                                                {est ? ` · ${est.icon} ${est.corto}` : ''}
                                              </span>
                                              <button type="button" className="historial-link-btn"
                                                onClick={() => { if (cab) setIntSearch(folioInt(cab)); setIntEstadoFilter('all'); setPhotoModalPlantId(null); setPhotoModalMenuOpen(false); setPhotoModalSection('fotos'); setView('intercambios') }}>
                                                Ver
                                              </button>
                                            </div>
                                          )
                                        })}
                                        {intsPlanta.some(x => x.direccion === 'recibido') && inv.compras.length === 0 && (
                                          <p style={{ fontSize: 11, color: '#888', margin: '4px 0 0' }}>Esta planta ingresó por intercambio, no por compra.</p>
                                        )}
                                      </div>
                                    )
                                  })()}
                                  <div style={{ fontSize: 12, fontWeight: 700, color: '#5B4636', margin: '2px 0' }}>Datos de compra</div>
                                  {inv.compras.length === 0 ? (
                                    <>
                                      {intercambioItems.some(x => x.direccion === 'recibido' && String(x.plant_id) === String(p.id)) ? (
                                        <p className="historial-empty" style={{ margin: '4px 0' }}>Sin compra: esta planta llegó por intercambio.</p>
                                      ) : (
                                        <p className="historial-empty" style={{ margin: '4px 0' }}>Esta planta todavía no tiene una compra registrada.</p>
                                      )}
                                      <button
                                        type="button"
                                        className="historial-link-btn"
                                        onClick={() => { setPhotoModalSection('compras'); setShowRetroCompraForm(true); if (photoModalSheetRef.current) photoModalSheetRef.current.scrollTop = 0 }}
                                      >
                                        + Agregar dato de compra
                                      </button>
                                    </>
                                  ) : (
                                    <>
                                      {inv.compras.length > 1 && (
                                        <div style={{ margin: '6px 0' }}>
                                          {invField('Compra a editar', (
                                            <select
                                              value={invDraft.compraId}
                                              onChange={e => setInvDraft(invCompraFields(inv.compras, inv.lotes, e.target.value))}
                                              style={invInputStyle}
                                            >
                                              {inv.compras.map(c => {
                                                const l = c.lote_id ? inv.lotes.find(x => x.id === c.lote_id) : null
                                                return (
                                                  <option key={c.id} value={c.id}>
                                                    {l ? `Compra #${l.numero ?? '—'}` : 'Compra manual'} · {new Date((l || c).created_at).toLocaleDateString()} · {c.quantity} u.
                                                  </option>
                                                )
                                              })}
                                            </select>
                                          ))}
                                        </div>
                                      )}
                                      <div style={invGridStyle}>
                                        {invField('N.° de compra', (
                                          <input
                                            type="number"
                                            min="1"
                                            step="1"
                                            inputMode="numeric"
                                            value={invDraft.numero}
                                            disabled={!invLote}
                                            placeholder={invLote ? '' : '—'}
                                            onChange={e => setInvDraft({ numero: e.target.value })}
                                            style={invInputStyle}
                                          />
                                        ), invLote ? null : 'Compra registrada a mano (sin N.°)')}
                                        {invField('Fecha de compra', (
                                          <input type="date" value={invDraft.fecha} onChange={e => setInvDraft({ fecha: e.target.value })} style={invInputStyle} />
                                        ))}
                                        {invField('Proveedor', (
                                          <>
                                            <input
                                              type="text"
                                              list={`proveedores-sugeridos-${p.id}`}
                                              placeholder="Proveedor"
                                              value={invDraft.proveedor}
                                              onChange={e => setInvDraft({ proveedor: e.target.value })}
                                              style={invInputStyle}
                                            />
                                            <datalist id={`proveedores-sugeridos-${p.id}`}>
                                              {proveedoresSugeridos.map(nombre => <option key={nombre} value={nombre} />)}
                                            </datalist>
                                          </>
                                        ))}
                                      </div>
                                      {invLote && (
                                        <p style={{ fontSize: 11, color: '#888', margin: '2px 0 6px' }}>
                                          Estos datos son de la compra #{invLote.numero ?? '—'} completa ({compras.filter(c => c.lote_id === invLote.id).length} líneas): al guardar se actualizan para todas sus plantas.
                                        </p>
                                      )}
                                    </>
                                  )}

                                  <div style={{ fontSize: 12, fontWeight: 700, color: '#5B4636', margin: '10px 0 2px' }}>Inventario</div>
                                  <div style={invGridStyle}>
                                    {invField('Categoría', (
                                      <select
                                        value={invDraft.categoryId || ''}
                                        onChange={e => {
                                          if (e.target.value === '__new__') { setShowInlineNewCategory(true); return }
                                          setInvDraft({ categoryId: e.target.value })
                                        }}
                                        style={invInputStyle}
                                      >
                                        <option value="">Sin categoría</option>
                                        {assignableCategories().map(cat => (
                                          <option key={cat.id} value={cat.id}>{cat.emoji} {cat.name}</option>
                                        ))}
                                        <option value="__new__">➕ Crear nueva categoría...</option>
                                      </select>
                                    ))}
                                    {invField('Stock total (en el jardín)', (
                                      <input type="number" min="0" step="1" inputMode="numeric" value={invDraft.stock} onChange={e => {
                                        const nuevo = e.target.value
                                        const disp = Math.min(parseInt(invDraft.stockDisponible, 10) || 0, parseInt(nuevo, 10) || 0)
                                        setInvDraft({ stock: nuevo, stockDisponible: String(disp) })
                                      }} style={invInputStyle} />
                                    ))}
                                    {invField('Disponible para el cliente', (
                                      <input type="number" min="0" max={parseInt(invDraft.stock, 10) || 0} step="1" inputMode="numeric" value={invDraft.stockDisponible} onChange={e => setInvDraft({ stockDisponible: e.target.value })} style={invInputStyle} />
                                    ), 'Cuántas de las de arriba ya están listas para ofrecer en la tienda')}
                                  </div>
                                  {(parseInt(invDraft.stock, 10) || 0) > (parseInt(invDraft.stockDisponible, 10) || 0) && (
                                    <button type="button" style={{ marginTop: 4 }} onClick={() => setInvDraft({ stockDisponible: invDraft.stock })}>
                                      ✅ Todas listas ({(parseInt(invDraft.stock, 10) || 0) - (parseInt(invDraft.stockDisponible, 10) || 0)} de sobra)
                                    </button>
                                  )}
                                  {showInlineNewCategory && (
                                    <div className="seed-form" style={{ marginTop: 8 }}>
                                      <div style={{ display: 'flex', gap: 8 }}>
                                        <input
                                          placeholder="Emoji"
                                          value={inlineNewCategoryEmoji}
                                          onChange={e => setInlineNewCategoryEmoji(e.target.value)}
                                          style={{ width: 50, textAlign: 'center' }}
                                        />
                                        <input
                                          placeholder="Nombre de la categoría (ej: Orq. Phalenopsis)"
                                          value={inlineNewCategoryName}
                                          onChange={e => setInlineNewCategoryName(e.target.value)}
                                          style={{ flex: 1 }}
                                        />
                                      </div>
                                      <div className="admin-item-actions">
                                        <button type="button" onClick={createCategoryForPlantInv}>Crear y elegir</button>
                                        <button type="button" onClick={() => { setShowInlineNewCategory(false); setInlineNewCategoryName('') }}>Cancelar</button>
                                      </div>
                                    </div>
                                  )}
                                  <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, flexWrap: 'wrap', margin: '6px 0' }}>
                                    <span style={{ fontSize: 13, color: '#5B4636', alignSelf: 'center' }}>🏷️ Etiquetas:</span>
                                    <label style={{ fontSize: 12, color: '#5B4636' }}>Impresas<br /><input type="number" min="0" step="1" inputMode="numeric" value={invDraft.printed} onChange={e => setInvDraft({ printed: e.target.value })} style={{ width: 70 }} /></label>
                                    <label style={{ fontSize: 12, color: '#5B4636' }}>Colocadas<br /><input type="number" min="0" step="1" inputMode="numeric" max={parseInt(invDraft.printed, 10) || 0} value={invDraft.placed} onChange={e => setInvDraft({ placed: e.target.value })} style={{ width: 70 }} /></label>
                                    {(parseInt(invDraft.printed, 10) || 0) > (parseInt(invDraft.placed, 10) || 0) && (
                                      <button type="button" onClick={() => setInvDraft({ placed: String((parseInt(invDraft.placed, 10) || 0) + 1) })}>
                                        +1 colocada ({(parseInt(invDraft.printed, 10) || 0) - (parseInt(invDraft.placed, 10) || 0)} de sobra)
                                      </button>
                                    )}
                                  </div>

                                  <div className="admin-item-actions" style={{ marginTop: 10, alignItems: 'center' }}>
                                    <button type="button" className="full-form-btn" onClick={savePlantInv} disabled={savingPlantInv || !invDirty}>
                                      {savingPlantInv ? 'Guardando…' : '💾 Guardar cambios'}
                                    </button>
                                    {invDirty && !savingPlantInv && (
                                      <button type="button" onClick={() => setPlantInvDraft(plantInvBase)}>↩ Descartar</button>
                                    )}
                                  </div>
                                  {invDirty && !savingPlantInv && <p style={{ fontSize: 12, color: '#b07a1f', margin: '4px 0 0' }}>Hay cambios sin guardar.</p>}
                                  {plantInvMsg && <p style={{ fontSize: 12, color: '#4a7a3a', margin: '4px 0 0' }}>{plantInvMsg}</p>}
                                </>
                              )}
                            </div>

                            <div className="plant-quick-edit" style={{ marginTop: 12 }}>
                              {faltaInfo(p).length > 0 ? (
                                <h4 style={{ margin: 0, fontSize: '0.9rem', color: '#b03434' }}>🚩 Falta: {faltaInfo(p).join(', ')}</h4>
                              ) : (
                                <h4 style={{ margin: 0, fontSize: '0.9rem', color: 'var(--sage-dark)' }}>✅ Información completa</h4>
                              )}
                            </div>

                            <div className="plant-quick-edit" style={{ marginTop: 12 }}>
                              <h4 style={{ margin: '0 0 8px', fontSize: '0.9rem', color: 'var(--sage-dark)' }}>📝 Descripción</h4>
                              <textarea
                                key={p.id}
                                className="plant-description-input"
                                placeholder="Escribe una descripción para esta planta…"
                                defaultValue={p.description || ''}
                                rows={4}
                                onBlur={e => updatePlantDescription(p.id, e.target.value)}
                                onInput={e => { e.target.style.height = 'auto'; e.target.style.height = e.target.scrollHeight + 'px' }}
                                ref={el => { if (el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px' } }}
                                style={{ overflow: 'hidden', resize: 'none', minHeight: 90, width: '100%', boxSizing: 'border-box' }}
                              />
                            </div>
                          </>
                        )}

                        {photoModalSection === 'notas' && (
                          <div className="plant-notes-panel">
                            <button type="button" className="full-form-btn" onClick={() => openNewPlantNote(p.id)}>📝 Nueva nota</button>
                            {notesForPlant.length === 0 && <p className="status-msg">Todavía no hay notas para esta planta.</p>}
                            {notesForPlant.map((n, i) => (
                              <div key={n.id} className={`note-blocks-view plant-note-entry pastel-${i % 5}`}>
                                <div className="day-task-row">
                                  <span className="task-note">{new Date(n.created_at).toLocaleDateString()}</span>
                                  <button type="button" className="task-edit-btn" onClick={() => openEditPlantNote(n)}>✏️</button>
                                  <button type="button" className="task-edit-btn" onClick={() => sharePlantNote(n)} disabled={sharingNotes} title="Compartir por WhatsApp">📲</button>
                                  <button type="button" className="task-delete-btn" onClick={() => deletePlantNote(n.id)}>✕</button>
                                </div>
                                {(n.content_blocks || []).map((b, i) => (
                                  <div key={i}>
                                    {b.type === 'text' && <p className="task-note">{b.content}</p>}
                                    {b.type === 'photo' && <img src={b.url} alt="" className="note-block-photo" />}
                                    {b.type === 'video' && <video src={b.url} controls className="note-video" />}
                                  </div>
                                ))}
                              </div>
                            ))}
                          </div>
                        )}

                        {photoModalSection === 'compras' && (
                          <div className="historial-block">
                            <h4>📦 Compras</h4>
                            {seedBatches.filter(sb => sb.converted_plant_id === p.id).map(sb => {
                              const bl = Array.isArray(sb.content_blocks) ? sb.content_blocks : []
                              const totalSb = (Number(sb.costo) || 0) + (Number(sb.envio1) || 0) + (Number(sb.envio2) || 0) + (Number(sb.varios) || 0)
                              return (
                                <div key={sb.id} style={{ background: '#f3f8ee', border: '1px solid #cfe0c2', borderRadius: 10, padding: '8px 10px', margin: '6px 0' }}>
                                  <div><strong>🌰 Viene de semillas</strong> · {sb.origen === 'cosecha' ? 'Cosecha propia' : `Compra${sb.proveedor ? ` a ${sb.proveedor}` : ''}`}</div>
                                  <div style={{ fontSize: 12.5, color: '#5B4636' }}>
                                    {sb.fecha ? new Date(sb.fecha + 'T00:00:00').toLocaleDateString() : '—'} · {Number(sb.cantidad_semillas) || 0} semillas · Sembradas: {Number(sb.sembradas) || 0} · Costo total: {money(totalSb)}
                                  </div>
                                  {!plantNotes.some(n => n.plant_id === p.id && (n.content_blocks || []).some(b => b && b.fromSeedBatch === sb.id)) && (
                                    <button type="button" style={{ marginTop: 6 }} onClick={async () => { if (await traerSeguimientoSemillas(sb, p.id)) loadData() }}>
                                      📓 Copiar este seguimiento a las notas de la planta
                                    </button>
                                  )}
                                  {bl.length > 0 && (
                                    <div style={{ marginTop: 6 }}>
                                      <strong style={{ fontSize: 12.5 }}>Seguimiento (germinación, replanteo, notas)</strong>
                                      {bl.map((b, i) => (
                                        <div key={i} style={{ marginTop: 4 }}>
                                          {b.at && <div style={{ fontSize: 11.5, color: '#8a8a7a' }}>{formatBlockDate(b.at)}</div>}
                                          {b.type === 'text' && <p style={{ margin: 0 }}>{b.content}</p>}
                                          {b.type === 'photo' && b.url && <img src={b.url} alt="" style={{ width: 110, height: 110, objectFit: 'cover', borderRadius: 8 }} />}
                                          {b.type === 'video' && b.url && <video src={b.url} controls style={{ width: '100%', maxWidth: 260 }} />}
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                  {seedBatchEvents.filter(ev => ev.seed_batch_id === sb.id).map(ev => (
                                    <div key={ev.id} style={{ marginTop: 4, fontSize: 12.5 }}>
                                      {ev.fecha ? new Date(String(ev.fecha).slice(0, 10) + 'T00:00:00').toLocaleDateString() : ''} · {ev.tipo || ev.evento || ''} {ev.nota || ev.notas || ev.descripcion || ''}
                                      {ev.photo_url && <img src={ev.photo_url} alt="" style={{ display: 'block', width: 110, height: 110, objectFit: 'cover', borderRadius: 8, marginTop: 2 }} />}
                                    </div>
                                  ))}
                                </div>
                              )
                            })}
                            {comprasConTotal.length > 0 && renderMoneyCard({ vendido: vendidoP, cobrado: cobradoP, comprado: compradoP, extra: <div style={{ fontSize: 12, color: '#8a8a7a' }}>La ganancia no descuenta lo que todavía tienes en stock.</div> })}
                            {comprasConTotal.length === 0 ? (
                              <p className="historial-empty">Sin compras registradas.</p>
                            ) : (
                              comprasConTotal.map(c => {
                                const cPagado = pagadoDe(c), cRecibido = recibidoDe(c)
                                const est = cRecibido && cPagado ? { icon: '📦', label: 'Recibido y pagado', bg: '#DCEFD9', border: '#9CCB92' }
                                  : cRecibido && !cPagado ? { icon: '⚠️', label: 'Recibido, falta pagar', bg: '#FBEEEF', border: '#EFC7CB' }
                                  : cPagado && !cRecibido ? { icon: '💵', label: 'Pagado, falta recibir', bg: '#DCEBF9', border: '#9CC2E6' }
                                  : { icon: '🕒', label: 'Pedido', bg: '#FFF1CC', border: '#E6C76A' }
                                const anticipoC = Number(c.anticipo) || 0
                                return (
                                  <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, background: est.bg, border: `1px solid ${est.border}`, borderRadius: 10, padding: '8px 10px', margin: '6px 0' }}>
                                    <div style={{ minWidth: 0 }}>
                                      <div><strong>Compra #{c._lote?.numero ?? '—'}</strong> · {c.proveedor || 'Sin proveedor'}</div>
                                      <div style={{ fontSize: 12.5, color: '#5B4636' }}>
                                        {new Date((c._lote || c).created_at).toLocaleDateString()} · {c.quantity} u. · {money(c.unit_cost)} c/u · Total con envío: {money(c._total)}
                                      </div>
                                      {!cPagado && anticipoC > 0 && (
                                        <div style={{ fontSize: 12, color: '#8a6d3b' }}>Abonado: {money(anticipoC)} · Saldo: {money(c._total - anticipoC)}</div>
                                      )}
                                      <div style={{ marginTop: 4, fontWeight: 700, fontSize: 13 }}>{est.icon} {est.label}</div>
                                    </div>
                                    <StatusChecklist
                                      steps={[{ key: 'pedido', label: 'Pedido' }, { key: 'pagado', label: 'Pagado' }, { key: 'recibido', label: 'Recibido' }]}
                                      values={{ pedido: true, pagado: cPagado, recibido: cRecibido }}
                                      onToggle={(flag, val) => toggleCompraFlag(c, flag, val)}
                                      disabled={approvingIds.includes(c.id)}
                                      anticipo={anticipoC}
                                      onAnticipoSave={val => updateCompraAnticipo(c, val)}
                                    />
                                  </div>
                                )
                              })
                            )}
                            <button
                              type="button"
                              className="historial-link-btn"
                              onClick={() => setShowRetroCompraForm(!showRetroCompraForm)}
                            >
                              {showRetroCompraForm ? '✕ Cancelar' : '+ Agregar dato de compra'}
                            </button>
                            {showRetroCompraForm && (
                              <div className="historial-retro-form">
                                <input
                                  placeholder="Proveedor (opcional)"
                                  value={retroCompraForm.proveedor}
                                  onChange={e => setRetroCompraForm({ ...retroCompraForm, proveedor: e.target.value })}
                                />
                                <input
                                  type="date"
                                  value={retroCompraForm.fecha}
                                  onChange={e => setRetroCompraForm({ ...retroCompraForm, fecha: e.target.value })}
                                />
                                <input
                                  placeholder="Cantidad"
                                  type="number"
                                  value={retroCompraForm.quantity}
                                  onChange={e => setRetroCompraForm({ ...retroCompraForm, quantity: e.target.value })}
                                />
                                <input
                                  placeholder="Precio de compra (por unidad, opcional)"
                                  type="number"
                                  step="0.01"
                                  value={retroCompraForm.unit_cost}
                                  onChange={e => setRetroCompraForm({ ...retroCompraForm, unit_cost: e.target.value })}
                                />
                                <button type="button" onClick={() => addRetroCompra(p, retroCompraForm)}>
                                  Guardar
                                </button>
                              </div>
                            )}
                          </div>
                        )}

                        {photoModalSection === 'ventas' && (
                          <div className="historial-block">
                            <h4>🛒 Ventas</h4>
                            {ventasDeEstaPlanta.length > 0 && renderMoneyCard({ vendido: vendidoP, cobrado: cobradoP, comprado: compradoP, extra: <div style={{ fontSize: 12, color: '#8a8a7a' }}>La ganancia no descuenta lo que todavía tienes en stock.</div> })}
                            {renderVentasConEstado(ventasDeEstaPlanta)}
                          </div>
                        )}

                        {photoModalSection === 'floraciones' && (
                          <div className="historial-block">
                            <h4>🌸 Floraciones</h4>
                            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
                              <button type="button" onClick={() => addFloracion(p.id, localDateISO())}>
                                🌸 Registrar floración de hoy
                              </button>
                              <button
                                type="button"
                                className="historial-link-btn"
                                onClick={() => setShowCustomFloracionDate(!showCustomFloracionDate)}
                              >
                                Elegir otra fecha
                              </button>
                            </div>
                            {showCustomFloracionDate && (
                              <div style={{ display: 'flex', gap: 8, marginBottom: 10, alignItems: 'center' }}>
                                <input type="date" value={customFloracionDate} onChange={e => setCustomFloracionDate(e.target.value)} />
                                <button type="button" onClick={() => customFloracionDate && addFloracion(p.id, customFloracionDate)} disabled={!customFloracionDate}>
                                  Guardar
                                </button>
                              </div>
                            )}
                            {floracionesDeEstaPlanta.length === 0 ? (
                              <p className="historial-empty">Sin floraciones registradas.</p>
                            ) : (
                              floracionesDeEstaPlanta.map(f => (
                                <div key={f.id} className="day-task-row">
                                  <span className="task-note">🌸 {new Date(f.fecha + 'T00:00:00').toLocaleDateString()}</span>
                                  <button type="button" className="task-delete-btn" onClick={() => deleteFloracion(f.id)}>✕</button>
                                </div>
                              ))
                            )}
                          </div>
                        )}

                        {photoModalSection === 'hijos' && (
                          <div className="historial-block">
                            <h4>🌱 Hijos</h4>
                            <p className="historial-entry" style={{ fontWeight: 'bold', border: 'none' }}>
                              {hijosDisponibles} hijo{hijosDisponibles === 1 ? '' : 's'} en desarrollo
                            </p>

                            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8, marginBottom: 4 }}>
                              <input
                                type="number"
                                placeholder="Cantidad"
                                value={newPupCantidad}
                                onChange={e => setNewPupCantidad(e.target.value)}
                                style={{ width: 90 }}
                              />
                              <button type="button" onClick={() => addPupRegistro(p.id, localDateISO(), newPupCantidad)}>
                                🌱 Separé hijos hoy
                              </button>
                            </div>
                            <button
                              type="button"
                              className="historial-link-btn"
                              onClick={() => setShowCustomPupDate(!showCustomPupDate)}
                            >
                              Elegir otra fecha
                            </button>
                            {showCustomPupDate && (
                              <div style={{ display: 'flex', gap: 8, marginTop: 8, marginBottom: 10, alignItems: 'center' }}>
                                <input type="date" value={customPupDate} onChange={e => setCustomPupDate(e.target.value)} />
                                <button type="button" onClick={() => customPupDate && addPupRegistro(p.id, customPupDate, newPupCantidad)} disabled={!customPupDate}>
                                  Guardar
                                </button>
                              </div>
                            )}

                            <div style={{ marginTop: 14, marginBottom: 4 }}>
                              <button
                                type="button"
                                className="historial-link-btn"
                                onClick={() => setShowMoverPupsForm(!showMoverPupsForm)}
                                disabled={hijosDisponibles <= 0}
                              >
                                {showMoverPupsForm ? '✕ Cancelar' : '➡️ Pasar a stock'}
                              </button>
                            </div>
                            {showMoverPupsForm && (
                              <div style={{ display: 'flex', gap: 8, marginBottom: 10, alignItems: 'center' }}>
                                <input
                                  type="number"
                                  placeholder={`Máx. ${hijosDisponibles}`}
                                  value={moverPupsCantidad}
                                  onChange={e => setMoverPupsCantidad(e.target.value)}
                                  style={{ width: 100 }}
                                />
                                <button type="button" onClick={() => moverPupsAStock(p, moverPupsCantidad)}>
                                  Confirmar
                                </button>
                              </div>
                            )}

                            {pupsDeEstaPlanta.length === 0 ? (
                              <p className="historial-empty">Sin registros de hijos.</p>
                            ) : (
                              pupsDeEstaPlanta.map(x => (
                                <div key={x.id} className="day-task-row">
                                  <span className="task-note">
                                    {x.tipo === 'movido' ? '➡️' : '🌱'} {new Date(x.fecha + 'T00:00:00').toLocaleDateString()} · {x.tipo === 'movido' ? `Pasó ${x.cantidad} a stock` : `Separó ${x.cantidad}`}
                                  </span>
                                  <button type="button" className="task-delete-btn" onClick={() => deletePup(x.id)}>✕</button>
                                </div>
                              ))
                            )}
                          </div>
                        )}

                        {photoModalSection === 'separar' && (() => {
                          const asignadas = mixRows.reduce((sum, r) => sum + (Math.floor(Number(r.qty) || 0)), 0)
                          const stockMix = Number(p.stock) || 0
                          const quedan = stockMix - asignadas
                          return (
                            <div className="historial-block">
                              <h4>🔀 Separar mix</h4>
                              <p className="historial-entry" style={{ border: 'none' }}>
                                «{p.name}» tiene <strong>{stockMix}</strong> en stock. Escribe cómo salió cada variedad: se crean como plantas nuevas y se descuentan de este mix. El costo de la compra se reparte por igual por unidad.
                              </p>
                              {mixRows.map((r, i) => (
                                <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                                  <input
                                    placeholder="Nombre (ej. Lilium blanco)"
                                    value={r.name}
                                    onChange={e => setMixRows(rows => rows.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                                    style={{ flex: 1, minWidth: 0 }}
                                  />
                                  <input
                                    type="number"
                                    inputMode="numeric"
                                    min="1"
                                    placeholder="Cant."
                                    value={r.qty}
                                    onChange={e => setMixRows(rows => rows.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))}
                                    style={{ width: 70 }}
                                  />
                                  {mixRows.length > 1 && (
                                    <button type="button" onClick={() => setMixRows(rows => rows.filter((_, j) => j !== i))} aria-label="Quitar fila">✕</button>
                                  )}
                                </div>
                              ))}
                              <button type="button" className="historial-link-btn" onClick={() => setMixRows(rows => [...rows, { name: '', qty: '' }])}>
                                ➕ Agregar otra variedad
                              </button>
                              <p className="historial-entry" style={{ border: 'none', color: quedan < 0 ? '#b03434' : '#5a5040', fontWeight: 600 }}>
                                Separadas: {asignadas} · Quedan en el mix: {quedan}
                              </p>
                              <button
                                type="button"
                                disabled={splittingMix || quedan < 0 || asignadas <= 0}
                                onClick={() => splitMix(p, mixRows)}
                                style={{ background: '#4a5d3a', color: '#fff', border: 'none', padding: '12px 16px', borderRadius: 8, fontWeight: 700, width: '100%', opacity: (splittingMix || quedan < 0 || asignadas <= 0) ? 0.5 : 1 }}
                              >
                                {splittingMix ? 'Separando…' : '🔀 Separar'}
                              </button>
                            </div>
                          )
                        })()}
                      </div>

                    </div>
                  </div>,
                  document.body
                )
              })()}

              {plantNoteModalOpen && createPortal(
                <div className="admin-sheet-overlay" style={{ position: 'fixed', inset: 0, zIndex: 3000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <div className="free-note-modal" onClick={e => e.stopPropagation()}>
                    <div className="free-note-modal-header">
                      <h4>{editingPlantNoteId ? 'Editar nota' : 'Nota'} — {plants.find(p => p.id === currentNotePlantId)?.name || ''}</h4>
                      <button
                        type="button"
                        className="modal-close-btn"
                        onClick={() => {
                          const hasUnsaved = plantNoteCurrentText.trim().length > 0
                          if (hasUnsaved && !confirm('¿Cerrar sin guardar? Perderás lo que escribiste.')) return
                          setPlantNoteModalOpen(false)
                          setEditingPlantNoteId(null)
                        }}
                      >✕</button>
                    </div>
                    <div className="free-note-sheet">
                      {plantNoteBlocks.map((b, i) => (
                        <div key={i} className="note-sheet-block">
                          {(b.at || b.type === 'text') && (
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11.5, color: '#8a8a7a', marginBottom: 2 }}>
                              <span>{formatBlockDate(b.at)}{b.editedAt ? ' · editado' : ''}</span>
                              <span style={{ display: 'flex', gap: 8 }}>
                                {b.type === 'text' && plantNoteEditIndex !== i && (
                                  <button type="button" onClick={() => startEditPlantNoteBlock(i)} style={{ border: 'none', background: 'none', boxShadow: 'none', padding: 0, color: '#4a5d3a', cursor: 'pointer' }}>✏️ Editar</button>
                                )}
                                <button type="button" onClick={() => deletePlantNoteBlock(i)} style={{ border: 'none', background: 'none', boxShadow: 'none', padding: 0, color: '#b03434', cursor: 'pointer' }}>🗑</button>
                              </span>
                            </div>
                          )}
                          {b.type === 'text' && plantNoteEditIndex === i ? (
                            <div>
                              <textarea className="note-sheet-textarea" value={plantNoteEditText} onChange={e => setPlantNoteEditText(e.target.value)} rows={3} autoFocus />
                              <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                                <button type="button" onClick={saveEditPlantNoteBlock}>💾 Guardar</button>
                                <button type="button" onClick={cancelEditPlantNoteBlock}>Cancelar</button>
                              </div>
                            </div>
                          ) : (
                            <>
                              {b.type === 'text' && <p>{b.content}</p>}
                              {b.type === 'photo' && <img src={b.url || URL.createObjectURL(b.file)} alt="" className="note-sheet-photo" />}
                              {b.type === 'video' && (
                                <video src={b.url || URL.createObjectURL(b.file)} controls className="note-video" />
                              )}
                            </>
                          )}
                        </div>
                      ))}
                      <textarea
                        className="note-sheet-textarea"
                        placeholder={plantNoteBlocks.length > 0 ? 'Sigue escribiendo...' : 'Escribe una nota para esta planta...'}
                        rows={plantNoteBlocks.length > 0 ? 2 : 4}
                        value={plantNoteCurrentText}
                        onChange={e => setPlantNoteCurrentText(e.target.value)}
                        autoFocus
                      />
                      {plantNoteCurrentText.trim() && (
                        <button type="button" className="icon-btn-text" onClick={commitPlantNoteText} style={{ alignSelf: 'flex-start', marginBottom: 6 }}>
                          ➕ Agregar como entrada de hoy
                        </button>
                      )}
                      <div className="note-sheet-toolbar">
                        <label className="icon-btn" title="Elegir foto de galería">
                          🖼️
                          <input
                            type="file"
                            accept="image/*"
                            multiple
                            style={{ display: 'none' }}
                            onChange={e => { insertPhotoBlockToPlantNote(e.target.files); e.target.value = '' }}
                          />
                        </label>
                        <label className="icon-btn" title="Tomar foto">
                          📷
                          <input
                            type="file"
                            accept="image/*"
                            capture="environment"
                            style={{ display: 'none' }}
                            onChange={e => { insertPhotoBlockToPlantNote(e.target.files[0]); e.target.value = '' }}
                          />
                        </label>
                        <label className="icon-btn" title="Insertar video aquí">
                          🎥
                          <input
                            type="file"
                            accept="video/*"
                            style={{ display: 'none' }}
                            onChange={e => { insertVideoBlockToPlantNote(e.target.files[0]); e.target.value = '' }}
                          />
                        </label>
                        <button
                          type="button"
                          className="icon-btn"
                          title={isDictatingPlantNote ? 'Detener dictado' : 'Dictar por voz'}
                          onClick={togglePlantNoteDictation}
                          style={isDictatingPlantNote ? { background: '#D32F2F', color: '#fff', borderRadius: '50%' } : undefined}
                        >
                          {isDictatingPlantNote ? '⏹️' : '🎤'}
                        </button>
                        {plantNoteBlocks.length > 0 && (
                          <button type="button" className="icon-btn-text" onClick={removeLastPlantNoteBlock}>Deshacer</button>
                        )}
                        {editingPlantNoteId && (
                          <button
                            type="button"
                            className="icon-btn"
                            title="Compartir por WhatsApp"
                            disabled={sharingNotes}
                            onClick={() => sharePlantNote(plantNotes.find(n => n.id === editingPlantNoteId))}
                          >
                            📲
                          </button>
                        )}
                        <button type="button" className="save-note-btn-inline" onClick={savePlantNote} disabled={savingPlantNote}>
                          {savingPlantNote ? 'Guardando...' : 'Guardar'}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>,
                document.body
              )}

              {!loading && view === 'pedidos' && (
                <>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
                    <button type="button" onClick={() => setVentaLoteBuilderOpen(true)}>
                      🧾 Nueva venta (factura)
                    </button>
                    <button
                      type="button"
                      onClick={() => setMovStatusFilter(prev => (prev === 'por_entregar' ? 'all' : 'por_entregar'))}
                      style={movStatusFilter === 'por_entregar' ? { background: PILL_ACTIVE_BG, borderColor: '#6E8161', fontWeight: 700 } : undefined}
                    >
                      📦 Por entregar ({porEntregarCount})
                    </button>
                    <button
                      type="button"
                      onClick={() => setMovStatusFilter(prev => (prev === 'por_cobrar' ? 'all' : 'por_cobrar'))}
                      style={movStatusFilter === 'por_cobrar' ? { background: PILL_ACTIVE_BG, borderColor: '#6E8161', fontWeight: 700 } : undefined}
                    >
                      💰 Por cobrar ({porCobrarCount})
                    </button>
                  </div>

                  {ventaLoteBuilderOpen && (
                    <div className="admin-form" style={{ marginBottom: 12 }}>
                      <h3>Nueva venta</h3>
                      <input placeholder="Cliente (opcional)" list="clientes-list" value={ventaLoteCliente} onChange={e => setVentaLoteCliente(e.target.value)} />
                      <datalist id="clientes-list">
                        {[...new Set(ventaLotes.map(l => l.cliente).filter(Boolean))].map(cli => (
                          <option key={cli} value={cli} />
                        ))}
                      </datalist>

                      <select className="gallery-select" value={decPlantCategory} onChange={e => setDecPlantCategory(e.target.value)}>
                        <option value="all">Todas las categorías</option>
                        {categories.map(c => <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>)}
                      </select>
                      <input
                        className="order-search"
                        placeholder="Buscar planta por nombre..."
                        value={decPlantSearch}
                        onChange={e => setDecPlantSearch(e.target.value)}
                      />
                      {(decPlantSearch.trim() || decPlantCategory !== 'all') ? (
                        <PlantPicker
                          list={[
                            ...plants
                              .filter(p => decPlantCategory === 'all' || p.category_id === decPlantCategory)
                              .filter(p => p.name.toLowerCase().includes(decPlantSearch.trim().toLowerCase()))
                              .map(p => ({ id: p.id, name: p.name })),
                            ...seedBatches
                              .filter(sb => (sb.stock || 0) > 0)
                              .filter(sb => decPlantCategory === 'all' || sb.category_id === decPlantCategory)
                              .filter(sb => seedBatchDisplayName(sb).toLowerCase().includes(decPlantSearch.trim().toLowerCase()))
                              .map(sb => ({ id: `seed:${sb.id}`, name: `${seedBatchDisplayName(sb)} — ${sb.stock || 0} disponibles` })),
                          ]}
                          selectedId={ventaLineForm.plant_id}
                          onSelect={id => setVentaLineForm({ ...ventaLineForm, plant_id: id })}
                        />
                      ) : ventaLineForm.plant_id ? (
                        <p className="status-msg" style={{ margin: '4px 0' }}>
                          {`✓ ${resolveVentaTarget(ventaLineForm.plant_id).isSeed ? seedBatchDisplayName(resolveVentaTarget(ventaLineForm.plant_id).seedBatch) : (resolveVentaTarget(ventaLineForm.plant_id).plant?.name || '')}`}
                        </p>
                      ) : null}
                      <input placeholder="Cantidad" type="number" value={ventaLineForm.quantity} onChange={e => setVentaLineForm({ ...ventaLineForm, quantity: e.target.value })} />
                      <select
                        value={ventaLineForm.motivo}
                        onChange={e => {
                          const motivo = e.target.value
                          const autoZero = motivo === 'Planta muerta / Pérdida' || motivo === 'Regalo / Obsequio'
                          setVentaLineForm({ ...ventaLineForm, motivo, unit_price: autoZero ? '0' : ventaLineForm.unit_price })
                        }}
                      >
                        <option value="Venta manual (con precio)">Venta manual (con precio)</option>
                        <option value="Planta muerta / Pérdida">Planta muerta / Pérdida</option>
                        <option value="Regalo / Obsequio">Regalo / Obsequio</option>
                      </select>
                      <input
                        placeholder="Precio unitario"
                        type="number"
                        step="0.01"
                        value={ventaLineForm.unit_price}
                        onChange={e => setVentaLineForm({ ...ventaLineForm, unit_price: e.target.value })}
                        disabled={ventaLineForm.motivo === 'Planta muerta / Pérdida' || ventaLineForm.motivo === 'Regalo / Obsequio'}
                      />
                      <button type="button" onClick={addLineToVentaLote}>➕ Agregar planta a la factura</button>

                      {ventaLoteLines.length > 0 && (
                        <div className="admin-list" style={{ marginTop: 8 }}>
                          {ventaLoteLines.map((l, i) => (
                            <div key={i} className="admin-item">
                              <div className="admin-item-info">
                                <strong>{l.plant_name}</strong>
                                <span>{l.motivo} — Cant: {l.quantity} — $ {Number(l.unit_price).toFixed(2)} c/u</span>
                                <button type="button" onClick={() => removeVentaLoteLine(i)} className="danger">Quitar</button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      <div className="admin-item-actions" style={{ marginTop: 8 }}>
                        <button
                          type="button"
                          onClick={saveVentaLote}
                          disabled={savingVentaLote}
                          style={{ background: '#4a5d3a', color: '#fff', border: 'none', padding: '10px 16px', borderRadius: 8, fontWeight: 600 }}
                        >
                          {savingVentaLote ? 'Guardando...' : 'Guardar venta'}
                        </button>
                        <button
                          type="button"
                          onClick={() => { setVentaLoteBuilderOpen(false); setVentaLoteLines([]); setVentaLoteCliente('') }}
                          style={{ background: '#fff', color: '#4a5d3a', border: '1px solid #4a5d3a', padding: '10px 16px', borderRadius: 8, fontWeight: 600 }}
                        >
                          Cancelar
                        </button>
                      </div>
                    </div>
                  )}

                  <button type="button" onClick={() => setMovMenuOpen(!movMenuOpen)} style={{ marginBottom: 10 }}>
                    ☰ Buscar / filtrar
                  </button>
                  {movMenuOpen && (
                    <div className="admin-form" style={{ marginBottom: 10 }}>
                      <input
                        className="order-search"
                        placeholder="Buscar por cliente, planta o motivo..."
                        value={movSearch}
                        onChange={e => setMovSearch(e.target.value)}
                      />
                      <div className="mov-filters">
                        <select className="gallery-select" value={movTypeFilter} onChange={e => setMovTypeFilter(e.target.value)}>
                          <option value="all">Ventas y decrementos</option>
                          <option value="venta">Solo ventas</option>
                          <option value="decremento">Solo decrementos</option>
                        </select>
                        <select className="gallery-select" value={movStatusFilter} onChange={e => setMovStatusFilter(e.target.value)}>
                          <option value="all">Todos los estados</option>
                          <option value="pedido">Pedido</option>
                          <option value="pagado">Pagado</option>
                          <option value="entregado">Entregado</option>
                          <option value="por_entregar">📦 Por entregar (falta entregar)</option>
                          <option value="por_cobrar">💰 Por cobrar (falta pagar)</option>
                        </select>
                      </div>
                    </div>
                  )}

                  <div className="admin-list">
                    {ventaLotesFiltrados.map(lote => {
                      const lineas = decrementos.filter(d => d.lote_id === lote.id)
                      if (lineas.length === 0) return null
                      const { subtotal, lineas: lineasConProrrateo, total: totalLote } = ventaLoteProration(lote, lineas)
                      const editingV = editingVentaLoteId === lote.id
                      return (
                        <div key={`vl-${lote.id}`} className="admin-item lote-group collapsible-card" data-open={(openCards.has(`vl-${lote.id}`) || editingV) ? 'true' : 'false'} style={{ width: '100%', maxWidth: '100%', minWidth: 0, overflow: 'hidden', boxSizing: 'border-box', opacity: lote.status === 'cancelada' ? 0.6 : 1, background: ventaPastelBg(lineas) }}>
                          <div className="admin-item-info" style={{ width: '100%', maxWidth: '100%', minWidth: 0, boxSizing: 'border-box' }}>
                            <div className="card-title-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                              <strong onClick={() => toggleCard(`vl-${lote.id}`)} style={{ flex: 1, minWidth: 0, cursor: 'pointer', ...(lote.status === 'cancelada' ? { textDecoration: 'line-through' } : {}) }}>
                                {(openCards.has(`vl-${lote.id}`) || editingV) ? '▾' : '▸'} 🧾 Venta #{lote.numero}{lote.cliente ? ` — ${lote.cliente}` : ''}
                              </strong>
                              <button type="button" onClick={() => setEditingVentaLoteId(editingV ? null : lote.id)}>
                                {editingV ? '✅ Listo' : '✏️ Editar'}
                              </button>
                            </div>
                            {lote.status === 'cancelada' && (
                              <p style={{ color: '#b03434', fontSize: '0.8rem', fontWeight: 600, margin: '2px 0' }}>
                                ❌ Cancelada — {lote.motivo_cancelacion || 'Sin motivo especificado'}
                              </p>
                            )}
                            <span>Fecha: {new Date(lote.created_at).toLocaleDateString()}</span>

                            {editingV && (
                              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, margin: '8px 0', fontSize: '0.85rem', color: '#5a5040' }}>
                                Nombre del cliente / compradora
                                <input
                                  key={`cli-${lote.id}-${lote.cliente || ''}`}
                                  defaultValue={lote.cliente || ''}
                                  placeholder="Cliente"
                                  onBlur={e => { if ((e.target.value || '').trim() !== (lote.cliente || '')) updateVentaLoteCliente(lote, e.target.value) }}
                                  style={{ width: '100%', boxSizing: 'border-box', padding: '10px', fontSize: '1rem', borderRadius: 6, border: '1px solid #ccc' }}
                                />
                              </label>
                            )}

                            <p style={{ fontSize: '0.7rem', color: '#8a8a7a', margin: '8px 0 2px', textAlign: 'center' }}>◀ Deslizá la tabla para ver más columnas ▶</p>
                            <div style={{ width: '100%', maxWidth: '100%', minWidth: 0, overflowX: 'auto', WebkitOverflowScrolling: 'touch', touchAction: 'pan-x pan-y', marginTop: 2, borderRadius: 8, border: '1px solid #ddd', boxShadow: '0 1px 2px rgba(0,0,0,0.06)', boxSizing: 'border-box' }}>
                              <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 460, fontSize: 11 }}>
                                <thead>
                                  <tr style={{ background: '#f3ecdd' }}>
                                    <th style={{ padding: '3px 2px', border: '1px solid #ddd', whiteSpace: 'nowrap' }}>Foto</th>
                                    <th style={{ padding: '3px 2px', border: '1px solid #ddd', whiteSpace: 'normal', maxWidth: 120, wordBreak: 'break-word' }}>Nombre</th>
                                    <th style={{ padding: '3px 2px', border: '1px solid #ddd', whiteSpace: 'nowrap' }} title="Motivo">🏷️</th>
                                    <th style={{ padding: '3px 2px', border: '1px solid #ddd', whiteSpace: 'nowrap' }}>Cant</th>
                                    <th style={{ padding: '3px 2px', border: '1px solid #ddd', whiteSpace: 'nowrap' }}>P.Unit</th>
                                    <th style={{ padding: '3px 2px', border: '1px solid #ddd', whiteSpace: 'nowrap' }}>P.Tot</th>
                                    <th style={{ padding: '3px 2px', border: '1px solid #ddd', whiteSpace: 'nowrap' }}>Estado</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {lineasConProrrateo.map(d => {
                                    const plant = plants.find(p => p.id === d.plant_id)
                                    return (
                                    <tr key={d.id}>
                                      <td style={{ padding: 2, border: '1px solid #ddd', textAlign: 'center', whiteSpace: 'nowrap' }}>
                                        {plant && plant.image_url ? <img src={plant.image_url} alt={d.plant_name} style={{ width: 22, height: 22, objectFit: 'cover', borderRadius: 3 }} /> : '—'}
                                      </td>
                                      <td style={{ padding: 2, border: '1px solid #ddd', whiteSpace: 'normal', maxWidth: 120, wordBreak: 'break-word' }}>
                                        {editingV ? <input defaultValue={d.plant_name} onBlur={e => updateDecrementoField(d, 'plant_name', e.target.value)} style={{ width: 90, fontSize: 11 }} /> : d.plant_name}
                                      </td>
                                      <td style={{ padding: 2, border: '1px solid #ddd', textAlign: 'center', whiteSpace: 'nowrap' }} title={d.motivo}>
                                        {editingV ? (
                                          <select defaultValue={d.motivo} onChange={e => updateDecrementoField(d, 'motivo', e.target.value)} style={{ fontSize: 11 }}>
                                            <option value="Venta manual (con precio)">Venta manual (con precio)</option>
                                            <option value="Planta muerta / Pérdida">Planta muerta / Pérdida</option>
                                            <option value="Regalo / Obsequio">Regalo / Obsequio</option>
                                          </select>
                                        ) : (
                                          d.motivo === 'Planta muerta / Pérdida' ? '💀' : d.motivo === 'Regalo / Obsequio' ? '🎁' : '🛒'
                                        )}
                                      </td>
                                      <td style={{ padding: 2, border: '1px solid #ddd', textAlign: 'center', whiteSpace: 'nowrap' }}>
                                        {editingV ? <input type="number" defaultValue={d.quantity} onBlur={e => updateDecrementoField(d, 'quantity', e.target.value)} style={{ width: 34, fontSize: 11 }} /> : d.quantity}
                                      </td>
                                      <td style={{ padding: 2, border: '1px solid #ddd', textAlign: 'right', whiteSpace: 'nowrap' }}>
                                        {editingV ? <input type="number" step="0.01" defaultValue={d.unit_price || 0} onBlur={e => updateDecrementoField(d, 'unit_price', e.target.value)} style={{ width: 48, fontSize: 11 }} /> : `$${Number(d.unit_price || 0).toFixed(2)}`}
                                      </td>
                                      <td style={{ padding: 2, border: '1px solid #ddd', textAlign: 'right', whiteSpace: 'nowrap' }}>${d._value.toFixed(2)}</td>
                                      <td style={{ padding: 2, border: '1px solid #ddd', textAlign: 'center', whiteSpace: 'nowrap' }}>
                                        <StatusChecklist
                                          steps={[{ key: 'pedido', label: 'Pedido' }, { key: 'pagado', label: 'Pagado' }, { key: 'entregado', label: 'Entregado' }]}
                                          values={{ pedido: true, pagado: pagadoDe(d), entregado: entregadoDe(d) }}
                                          onToggle={(flag, val) => toggleDecrementoFlag(d, flag, val)}
                                          disabled={approvingIds.includes(d.id)}
                                          anticipo={Number(d.anticipo) || 0}
                                          onAnticipoSave={val => updateDecrementoAnticipo(d, val)}
                                        />
                                      </td>
                                    </tr>
                                    )
                                  })}
                                </tbody>
                                <tfoot>
                                  <tr><td colSpan={5} style={{ padding: '3px 2px', border: '1px solid #ddd', whiteSpace: 'nowrap' }}>Subtotal</td><td colSpan={2} style={{ padding: '3px 2px', border: '1px solid #ddd', textAlign: 'right', whiteSpace: 'nowrap' }}>${subtotal.toFixed(2)}</td></tr>
                                  <tr><td colSpan={5} style={{ padding: '3px 2px', border: '1px solid #ddd', whiteSpace: 'nowrap' }}>Envío 1</td><td colSpan={2} style={{ padding: '3px 2px', border: '1px solid #ddd', textAlign: 'right', whiteSpace: 'nowrap' }}>{editingV ? <input type="number" step="0.01" defaultValue={lote.envio1 || 0} onBlur={e => updateVentaLoteExtra(lote, 'envio1', e.target.value)} style={{ width: 70, fontSize: 11 }} /> : `$${Number(lote.envio1 || 0).toFixed(2)}`}</td></tr>
                                  <tr><td colSpan={5} style={{ padding: '3px 2px', border: '1px solid #ddd', whiteSpace: 'nowrap' }}>Envío 2</td><td colSpan={2} style={{ padding: '3px 2px', border: '1px solid #ddd', textAlign: 'right', whiteSpace: 'nowrap' }}>{editingV ? <input type="number" step="0.01" defaultValue={lote.envio2 || 0} onBlur={e => updateVentaLoteExtra(lote, 'envio2', e.target.value)} style={{ width: 70, fontSize: 11 }} /> : `$${Number(lote.envio2 || 0).toFixed(2)}`}</td></tr>
                                  <tr><td colSpan={5} style={{ padding: '3px 2px', border: '1px solid #ddd', whiteSpace: 'nowrap' }}>Varios</td><td colSpan={2} style={{ padding: '3px 2px', border: '1px solid #ddd', textAlign: 'right', whiteSpace: 'nowrap' }}>{editingV ? <input type="number" step="0.01" defaultValue={lote.varios || 0} onBlur={e => updateVentaLoteExtra(lote, 'varios', e.target.value)} style={{ width: 70, fontSize: 11 }} /> : `$${Number(lote.varios || 0).toFixed(2)}`}</td></tr>
                                  <tr style={{ background: '#f3ecdd' }}><td colSpan={5} style={{ padding: '3px 2px', border: '1px solid #ddd', whiteSpace: 'nowrap' }}><strong>Total</strong></td><td colSpan={2} style={{ padding: '3px 2px', border: '1px solid #ddd', textAlign: 'right', whiteSpace: 'nowrap' }}><strong>${totalLote.toFixed(2)}</strong></td></tr>
                                </tfoot>
                              </table>
                            </div>

                            {addToVentaLoteId === lote.id ? (
                              <div className="admin-form" style={{ marginTop: 8, width: '100%', maxWidth: '100%', boxSizing: 'border-box' }}>
                                <select className="gallery-select" value={decPlantCategory} onChange={e => setDecPlantCategory(e.target.value)} style={{ width: '100%', boxSizing: 'border-box' }}>
                                  <option value="all">Todas las categorías</option>
                                  {categories.map(c => <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>)}
                                </select>
                                <input
                                  className="order-search"
                                  placeholder="Buscar planta por nombre..."
                                  value={decPlantSearch}
                                  onChange={e => setDecPlantSearch(e.target.value)}
                                  style={{ width: '100%', boxSizing: 'border-box' }}
                                />
                                {(decPlantSearch.trim() || decPlantCategory !== 'all') ? (
                                  <PlantPicker
                                    list={[
                                      ...plants
                                        .filter(p => decPlantCategory === 'all' || p.category_id === decPlantCategory)
                                        .filter(p => p.name.toLowerCase().includes(decPlantSearch.trim().toLowerCase()))
                                        .map(p => ({ id: p.id, name: p.name })),
                                      ...seedBatches
                                        .filter(sb => (sb.stock || 0) > 0)
                                        .filter(sb => decPlantCategory === 'all' || sb.category_id === decPlantCategory)
                                        .filter(sb => seedBatchDisplayName(sb).toLowerCase().includes(decPlantSearch.trim().toLowerCase()))
                                        .map(sb => ({ id: `seed:${sb.id}`, name: `${seedBatchDisplayName(sb)} — ${sb.stock || 0} disponibles` })),
                                    ]}
                                    selectedId={ventaLineForm.plant_id}
                                    onSelect={id => setVentaLineForm({ ...ventaLineForm, plant_id: id })}
                                  />
                                ) : ventaLineForm.plant_id ? (
                                  <p className="status-msg" style={{ margin: '4px 0' }}>
                                    {`✓ ${resolveVentaTarget(ventaLineForm.plant_id).isSeed ? seedBatchDisplayName(resolveVentaTarget(ventaLineForm.plant_id).seedBatch) : (resolveVentaTarget(ventaLineForm.plant_id).plant?.name || '')}`}
                                  </p>
                                ) : null}
                                <input placeholder="Cantidad" type="number" value={ventaLineForm.quantity} onChange={e => setVentaLineForm({ ...ventaLineForm, quantity: e.target.value })} style={{ width: '100%', boxSizing: 'border-box' }} />
                                <select
                                  value={ventaLineForm.motivo}
                                  onChange={e => {
                                    const motivo = e.target.value
                                    const autoZero = motivo === 'Planta muerta / Pérdida' || motivo === 'Regalo / Obsequio'
                                    setVentaLineForm({ ...ventaLineForm, motivo, unit_price: autoZero ? '0' : ventaLineForm.unit_price })
                                  }}
                                  style={{ width: '100%', boxSizing: 'border-box' }}
                                >
                                  <option value="Venta manual (con precio)">Venta manual (con precio)</option>
                                  <option value="Planta muerta / Pérdida">Planta muerta / Pérdida</option>
                                  <option value="Regalo / Obsequio">Regalo / Obsequio</option>
                                </select>
                                <input
                                  placeholder="Precio unitario"
                                  type="number"
                                  step="0.01"
                                  value={ventaLineForm.unit_price}
                                  onChange={e => setVentaLineForm({ ...ventaLineForm, unit_price: e.target.value })}
                                  disabled={ventaLineForm.motivo === 'Planta muerta / Pérdida' || ventaLineForm.motivo === 'Regalo / Obsequio'}
                                  style={{ width: '100%', boxSizing: 'border-box' }}
                                />
                                <div className="admin-item-actions" style={{ flexWrap: 'wrap' }}>
                                  <button type="button" onClick={() => addPlantToVentaLote(lote.id)}>Guardar</button>
                                  <button type="button" onClick={() => { setAddToVentaLoteId(null); setVentaLineForm({ plant_id: '', quantity: '', unit_price: '', motivo: 'Venta manual (con precio)' }) }}>Cancelar</button>
                                </div>
                              </div>
                            ) : (
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8, position: 'relative', alignItems: 'center' }}>
                                <button
                                  type="button"
                                  onClick={() => setAddToVentaLoteId(lote.id)}
                                  style={{ padding: '6px 10px', fontSize: '0.8rem', minHeight: 0, lineHeight: 1.2, borderRadius: 8, boxShadow: 'none', whiteSpace: 'nowrap', flex: '0 0 auto', boxSizing: 'border-box' }}
                                >
                                  ➕ Agregar planta
                                </button>
                                <button
                                  type="button"
                                  onClick={() => deleteVentaLote(lote.id)}
                                  className="danger"
                                  aria-label="Eliminar venta"
                                  style={{ padding: '6px 10px', fontSize: '0.8rem', minHeight: 0, lineHeight: 1.2, borderRadius: 8, boxShadow: 'none', whiteSpace: 'nowrap', flex: '0 0 auto', boxSizing: 'border-box' }}
                                >
                                  🗑️ Eliminar
                                </button>
                                {lote.status !== 'cancelada' && (
                                  <button
                                    type="button"
                                    onClick={() => cancelVentaLote(lote.id)}
                                    aria-label="Cancelar venta"
                                    style={{ ...({ padding: '6px 10px', fontSize: '0.8rem', minHeight: 0, lineHeight: 1.2, borderRadius: 8, boxShadow: 'none', whiteSpace: 'nowrap', flex: '0 0 auto', boxSizing: 'border-box' }), background: '#fff', color: '#b03434', border: '1px solid #b03434' }}
                                  >
                                    ❌ Cancelar
                                  </button>
                                )}
                                <div style={{ position: 'relative' }}>
                                  <button
                                    type="button"
                                    onClick={() => setShareVentaMenuId(shareVentaMenuId === lote.id ? null : lote.id)}
                                    aria-label="Compartir factura"
                                    style={{ ...({ padding: '6px 10px', fontSize: '0.8rem', minHeight: 0, lineHeight: 1.2, borderRadius: 8, boxShadow: 'none', whiteSpace: 'nowrap', flex: '0 0 auto', boxSizing: 'border-box' }), background: '#fff', color: '#4a5d3a', border: '1px solid #4a5d3a', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}
                                  >
                                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                      <circle cx="18" cy="5" r="3" />
                                      <circle cx="6" cy="12" r="3" />
                                      <circle cx="18" cy="19" r="3" />
                                      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
                                      <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
                                    </svg>
                                    Factura
                                  </button>
                                  {shareVentaMenuId === lote.id && (
                                    <div style={{ position: 'absolute', right: 0, bottom: '110%', background: '#fff', border: '1px solid #ddd', borderRadius: 8, boxShadow: '0 2px 8px rgba(0,0,0,0.18)', overflow: 'hidden', zIndex: 5, minWidth: 170 }}>
                                      <button
                                        type="button"
                                        onClick={() => { shareVentaInvoiceImage(lote, lineasConProrrateo, subtotal, totalLote); setShareVentaMenuId(null) }}
                                        style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 14px', background: '#fff', border: 'none', borderBottom: '1px solid #eee', fontSize: '0.85rem', color: '#4a5d3a', fontWeight: 600, boxSizing: 'border-box' }}
                                      >
                                        📷 Enviar como foto
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => { sendVentaInvoiceWhatsApp(lote, lineasConProrrateo, subtotal, totalLote); setShareVentaMenuId(null) }}
                                        style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 14px', background: '#fff', border: 'none', borderBottom: '1px solid #eee', fontSize: '0.85rem', color: '#25D366', fontWeight: 600, boxSizing: 'border-box' }}
                                      >
                                        💬 WhatsApp
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => { downloadVentaInvoicePDF(lote, lineasConProrrateo, subtotal, totalLote); setShareVentaMenuId(null) }}
                                        style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 14px', background: '#fff', border: 'none', fontSize: '0.85rem', color: '#4a5d3a', fontWeight: 600, boxSizing: 'border-box' }}
                                      >
                                        ⬇️ Descargar PDF
                                      </button>
                                    </div>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      )
                    })}

                    {movimientosFiltrados.filter(m => !(m._type === 'decremento' && m.lote_id)).length === 0 && ventaLotesFiltrados.length === 0 && <p className="status-msg">No se encontraron movimientos.</p>}
                    {movimientosFiltrados.filter(m => !(m._type === 'decremento' && m.lote_id)).map(m => (
                      m._type === 'venta' ? (
                        <div key={`o-${m.id}`} className="admin-item collapsible-card" data-open={openCards.has(`o-${m.id}`) ? 'true' : 'false'} style={{ width: '100%', maxWidth: '100%', minWidth: 0, overflow: 'hidden', boxSizing: 'border-box' }}>
                          <div className="admin-item-info" style={{ width: '100%', maxWidth: '100%', minWidth: 0, boxSizing: 'border-box' }}>
                            <strong className="card-title-row" onClick={() => toggleCard(`o-${m.id}`)} style={{ display: 'block', cursor: 'pointer' }}>{openCards.has(`o-${m.id}`) ? '▾' : '▸'} 🛒 Pedido #{m.id}{m.customer_name ? ` — ${m.customer_name}` : ''}</strong>
                            <span>{m.customer_phone}</span>
                            <span className={`order-badge order-${m.status}`}>{m.status}</span>
                            <span>Pedido: {new Date(m.created_at).toLocaleDateString()}</span>
                            {m.fecha_pago && <span>Pagado: {new Date(m.fecha_pago).toLocaleDateString()}</span>}
                            {m.fecha_entrega && <span>Entregado: {new Date(m.fecha_entrega).toLocaleDateString()}</span>}

                            {(() => {
                              const { subtotal, items, total } = orderProration(m)
                              return (
                                <>
                                  <p style={{ fontSize: '0.7rem', color: '#8a8a7a', margin: '8px 0 2px', textAlign: 'center' }}>◀ Deslizá la tabla para ver más columnas ▶</p>
                                  <div style={{ width: '100%', maxWidth: '100%', minWidth: 0, overflowX: 'auto', WebkitOverflowScrolling: 'touch', touchAction: 'pan-x pan-y', marginTop: 2, borderRadius: 8, border: '1px solid #ddd', boxShadow: '0 1px 2px rgba(0,0,0,0.06)', boxSizing: 'border-box' }}>
                                    <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 420, fontSize: 11 }}>
                                      <thead>
                                        <tr style={{ background: '#f3ecdd' }}>
                                          <th style={{ padding: '3px 2px', border: '1px solid #ddd', whiteSpace: 'nowrap' }}>Foto</th>
                                          <th style={{ padding: '3px 2px', border: '1px solid #ddd', whiteSpace: 'normal', maxWidth: 100, wordBreak: 'break-word' }}>Nombre</th>
                                          <th style={{ padding: '3px 2px', border: '1px solid #ddd', whiteSpace: 'nowrap' }}>Cant</th>
                                          <th style={{ padding: '3px 2px', border: '1px solid #ddd', whiteSpace: 'nowrap' }}>P.Unit</th>
                                          <th style={{ padding: '3px 2px', border: '1px solid #ddd', whiteSpace: 'nowrap' }}>P.Tot</th>
                                          <th style={{ padding: '3px 2px', border: '1px solid #ddd', whiteSpace: 'nowrap' }}>Pror.</th>
                                          <th style={{ padding: '3px 2px', border: '1px solid #ddd', whiteSpace: 'nowrap' }}>Total</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {items.map(it => (
                                          <tr key={it.id}>
                                            <td style={{ padding: 2, border: '1px solid #ddd', textAlign: 'center', whiteSpace: 'nowrap' }}>{it._plant?.image_url ? <img src={it._plant.image_url} alt={it._plant.name} style={{ width: 22, height: 22, objectFit: 'cover', borderRadius: 3 }} /> : '—'}</td>
                                            <td style={{ padding: 2, border: '1px solid #ddd', whiteSpace: 'normal', maxWidth: 100, wordBreak: 'break-word' }}>{it._plant ? it._plant.name : 'Planta'}</td>
                                            <td style={{ padding: 2, border: '1px solid #ddd', textAlign: 'center', whiteSpace: 'nowrap' }}>{it.quantity}</td>
                                            <td style={{ padding: 2, border: '1px solid #ddd', textAlign: 'right', whiteSpace: 'nowrap' }}>${it._unitPrice.toFixed(2)}</td>
                                            <td style={{ padding: 2, border: '1px solid #ddd', textAlign: 'right', whiteSpace: 'nowrap' }}>${it._value.toFixed(2)}</td>
                                            <td style={{ padding: 2, border: '1px solid #ddd', textAlign: 'right', whiteSpace: 'nowrap' }}>${it._prorated.toFixed(2)}</td>
                                            <td style={{ padding: 2, border: '1px solid #ddd', textAlign: 'right', whiteSpace: 'nowrap' }}>${it._lineTotal.toFixed(2)}</td>
                                          </tr>
                                        ))}
                                      </tbody>
                                      <tfoot>
                                        <tr><td colSpan={4} style={{ padding: '3px 2px', border: '1px solid #ddd', whiteSpace: 'nowrap' }}>Subtotal</td><td colSpan={3} style={{ padding: '3px 2px', border: '1px solid #ddd', textAlign: 'right', whiteSpace: 'nowrap' }}>${subtotal.toFixed(2)}</td></tr>
                                        <tr><td colSpan={4} style={{ padding: '3px 2px', border: '1px solid #ddd', whiteSpace: 'nowrap' }}>Envío 1</td><td colSpan={3} style={{ padding: '3px 2px', border: '1px solid #ddd', textAlign: 'right', whiteSpace: 'nowrap' }}><input type="number" step="0.01" defaultValue={m.envio1 || 0} onBlur={e => updateOrderExtra(m, 'envio1', e.target.value)} style={{ width: 70, fontSize: 11 }} /></td></tr>
                                        <tr><td colSpan={4} style={{ padding: '3px 2px', border: '1px solid #ddd', whiteSpace: 'nowrap' }}>Envío 2</td><td colSpan={3} style={{ padding: '3px 2px', border: '1px solid #ddd', textAlign: 'right', whiteSpace: 'nowrap' }}><input type="number" step="0.01" defaultValue={m.envio2 || 0} onBlur={e => updateOrderExtra(m, 'envio2', e.target.value)} style={{ width: 70, fontSize: 11 }} /></td></tr>
                                        <tr><td colSpan={4} style={{ padding: '3px 2px', border: '1px solid #ddd', whiteSpace: 'nowrap' }}>Varios</td><td colSpan={3} style={{ padding: '3px 2px', border: '1px solid #ddd', textAlign: 'right', whiteSpace: 'nowrap' }}><input type="number" step="0.01" defaultValue={m.varios || 0} onBlur={e => updateOrderExtra(m, 'varios', e.target.value)} style={{ width: 70, fontSize: 11 }} /></td></tr>
                                        <tr style={{ background: '#f3ecdd' }}><td colSpan={4} style={{ padding: '3px 2px', border: '1px solid #ddd', whiteSpace: 'nowrap' }}><strong>Total</strong></td><td colSpan={3} style={{ padding: '3px 2px', border: '1px solid #ddd', textAlign: 'right', whiteSpace: 'nowrap' }}><strong>${total.toFixed(2)}</strong></td></tr>
                                      </tfoot>
                                    </table>
                                  </div>

                                  <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center' }}>
                                    <div className="admin-item-actions" style={{ flex: '1 1 auto', margin: 0 }}>
                                      <StatusChecklist
                                        steps={[{ key: 'pedido', label: 'Pedido' }, { key: 'pagado', label: 'Pagado' }, { key: 'entregado', label: 'Entregado' }]}
                                        values={{ pedido: true, pagado: pagadoDe(m), entregado: entregadoDe(m) }}
                                        onToggle={(flag, val) => toggleOrderFlag(m, flag, val)}
                                        disabled={approvingIds.includes(m.id)}
                                        anticipo={Number(m.anticipo) || 0}
                                        onAnticipoSave={val => updateOrderAnticipo(m, val)}
                                      />
                                    </div>
                                    <div style={{ position: 'relative' }}>
                                      <button
                                        type="button"
                                        onClick={() => setShareOrderMenuId(shareOrderMenuId === m.id ? null : m.id)}
                                        aria-label="Compartir factura"
                                        style={{ background: '#fff', color: '#4a5d3a', border: '1px solid #4a5d3a', padding: '10px 14px', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                                      >
                                        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                          <circle cx="18" cy="5" r="3" />
                                          <circle cx="6" cy="12" r="3" />
                                          <circle cx="18" cy="19" r="3" />
                                          <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
                                          <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
                                        </svg>
                                      </button>
                                      {shareOrderMenuId === m.id && (
                                        <div style={{ position: 'absolute', right: 0, bottom: '110%', background: '#fff', border: '1px solid #ddd', borderRadius: 8, boxShadow: '0 2px 8px rgba(0,0,0,0.18)', overflow: 'hidden', zIndex: 5, minWidth: 170 }}>
                                          <button
                                            type="button"
                                            onClick={() => { shareOrderInvoiceImage(m, items, subtotal, total); setShareOrderMenuId(null) }}
                                            style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 14px', background: '#fff', border: 'none', borderBottom: '1px solid #eee', fontSize: '0.85rem', color: '#4a5d3a', fontWeight: 600, boxSizing: 'border-box' }}
                                          >
                                            📷 Enviar como foto
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => { sendOrderInvoiceWhatsApp(m, items, subtotal, total); setShareOrderMenuId(null) }}
                                            style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 14px', background: '#fff', border: 'none', borderBottom: '1px solid #eee', fontSize: '0.85rem', color: '#25D366', fontWeight: 600, boxSizing: 'border-box' }}
                                          >
                                            💬 WhatsApp
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => { downloadOrderInvoicePDF(m, items, subtotal, total); setShareOrderMenuId(null) }}
                                            style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 14px', background: '#fff', border: 'none', fontSize: '0.85rem', color: '#4a5d3a', fontWeight: 600, boxSizing: 'border-box' }}
                                          >
                                            ⬇️ Descargar PDF
                                          </button>
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                </>
                              )
                            })()}
                          </div>
                        </div>
                      ) : (
                        <div key={`d-${m.id}`} className="admin-item">
                          <div className="admin-item-info">
                            <strong>{m.motivo === 'Venta manual (con precio)' ? '🛒' : m.motivo === 'Regalo / Obsequio' ? '🎁' : '🥀'} {m.plant_name}</strong>
                            <span>{m.motivo}</span>
                            <span>Registrado: {new Date(m.created_at).toLocaleDateString()}</span>
                            <span>Cantidad: -{m.quantity}</span>
                            {m.motivo === 'Venta manual (con precio)' && (
                              <>
                                <span>Precio unit.: ${Number(m.unit_price || 0).toFixed(2)}</span>
                                <span><strong>Total: ${(Number(m.unit_price || 0) * Number(m.quantity)).toFixed(2)}</strong></span>
                              </>
                            )}
                          </div>
                        </div>
                      )
                    ))}
                  </div>
                </>
              )}

              {!loading && view === 'intercambios' && (() => {
                const term = normalizarBusqueda(intSearch.trim())
                const itemsDe = i => intercambioItems.filter(x => x.intercambio_id === i.id)
                const cuenta = e => intercambioItems.filter(x => x.direccion === 'recibido' && x.estado === e).length
                const fechaDe = i => (i.fecha ? new Date(`${i.fecha}T12:00:00`).toLocaleDateString() : '')
                const filtrados = intercambios.filter(i => {
                  const its = itemsDe(i)
                  if (intEstadoFilter !== 'all' && !its.some(x => x.direccion === 'recibido' && x.estado === intEstadoFilter)) return false
                  if (!term) return true
                  return [folioInt(i), i.contacto, i.nota, ...its.map(x => x.plant_name)].some(t => normalizarBusqueda(t).includes(term))
                })
                const chip = (key, texto) => (
                  <button key={key} type="button" onClick={() => setIntEstadoFilter(key)}
                    style={{ padding: '6px 12px', fontSize: 13, minHeight: 0, lineHeight: 1.2, borderRadius: 16, boxShadow: 'none', whiteSpace: 'nowrap', fontWeight: intEstadoFilter === key ? 700 : 500, background: intEstadoFilter === key ? '#E8F1E0' : '#fff', border: `2px solid ${intEstadoFilter === key ? '#4a5d3a' : '#d8cfb8'}`, color: '#5B4636' }}>
                    {texto}
                  </button>
                )
                const lineaForm = (lado, r, idx) => {
                  const pl = resolverPlantaFila(r)
                  const setRow = patch => setIntForm(f => ({ ...f, [lado]: f[lado].map((x, j) => (j === idx ? { ...x, ...patch } : x)) }))
                  let pista = ''
                  let colorPista = '#7a7060'
                  if (r.name.trim()) {
                    if (lado === 'entregados') {
                      if (!pl) { pista = '⚠️ No existe en tu galería'; colorPista = '#b03434' }
                      else {
                        // al editar, lo que esta misma línea ya entregó cuenta como disponible
                        const disp = (Number(pl.stock) || 0) + (r.itemId && r.origPlantId === String(pl.id) ? (Number(r.origQty) || 0) : 0)
                        if (disp < (Number(r.qty) || 0)) { pista = `⚠️ Solo tienes ${disp} disponible${disp === 1 ? '' : 's'}`; colorPista = '#b03434' }
                        else pista = `Stock: ${pl.stock || 0}${r.itemId ? ` (+${Number(r.origQty) || 0} de este intercambio)` : ''}`
                      }
                    } else pista = pl ? `Ya existe (stock ${pl.stock || 0}). Lo recibido no se suma hasta que quede Establecida.` : '🌱 Planta nueva: se crea oculta y sin stock.'
                  }
                  const clave = `${lado}-${idx}`
                  const escrito = r.name.trim()
                  const sugerencias = (intFocus === clave && escrito && !(pl && normalizarBusqueda(pl.name) === normalizarBusqueda(escrito)))
                    ? plants.filter(x => coincideBusqueda(x.name, escrito)).sort((a, b) => String(a.name).localeCompare(String(b.name), 'es', { numeric: true, sensitivity: 'base' })).slice(0, 6)
                    : []
                  const miniatura = (pl2, size) => (pl2 && pl2.image_url
                    ? <img src={pl2.image_url} alt="" loading="lazy" style={{ width: size, height: size, objectFit: 'cover', borderRadius: 8, flexShrink: 0, border: '1px solid #ddd' }} />
                    : <div style={{ width: size, height: size, borderRadius: 8, flexShrink: 0, border: '1px dashed #ccc', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: size * 0.45, color: '#bbb' }}>🌱</div>)
                  return (
                    <div key={idx} style={{ position: 'relative', display: 'flex', gap: 6, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
                      {pl ? miniatura(pl, 40) : null}
                      <input placeholder={lado === 'entregados' ? 'Planta que entregas' : 'Planta que recibes'} value={r.name}
                        onChange={e => setRow({ name: e.target.value })}
                        onFocus={() => setIntFocus(clave)}
                        onBlur={() => setTimeout(() => setIntFocus(f => (f === clave ? null : f)), 200)}
                        style={{ flex: '1 1 130px', minWidth: 0, boxSizing: 'border-box' }} />
                      <button type="button" aria-label="Elegir planta con fotos" title="Elegir con fotos"
                        onClick={() => setIntPicker({ lado, idx, term: '' })}
                        style={{ width: 36, height: 36, minHeight: 0, padding: 0, fontSize: 18, borderRadius: 10, boxShadow: 'none', cursor: 'pointer' }}>🖼️</button>
                      <input type="number" inputMode="numeric" min="1" value={r.qty} onChange={e => setRow({ qty: e.target.value })} style={{ width: 62, boxSizing: 'border-box' }} aria-label="Cantidad" />
                      <button type="button" aria-label="Quitar fila" onClick={() => setIntForm(f => ({ ...f, [lado]: f[lado].filter((_, j) => j !== idx) }))}
                        style={{ width: 28, border: 'none', background: 'none', boxShadow: 'none', padding: 0, minHeight: 0, fontSize: 16, color: '#b03434', cursor: 'pointer' }}>✕</button>
                      {sugerencias.length > 0 && (
                        <div style={{ flex: '1 0 100%', background: '#fff', border: '1px solid #d8cfb8', borderRadius: 10, overflow: 'hidden', boxShadow: '0 4px 12px rgba(0,0,0,0.12)' }}>
                          {sugerencias.map(x => (
                            <button key={x.id} type="button"
                              onMouseDown={e => e.preventDefault()}
                              onClick={() => { setRow({ name: x.name }); setIntFocus(null) }}
                              style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', background: '#fff', border: 'none', borderBottom: '1px solid #f0eadb', borderRadius: 0, boxShadow: 'none', padding: '6px 8px', minHeight: 0, color: '#3b3b32', cursor: 'pointer' }}>
                              {miniatura(x, 44)}
                              <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                                <span style={{ fontWeight: 600, fontSize: 14, lineHeight: 1.2 }}>{x.name}</span>
                                <small style={{ color: '#7a7060' }}>Stock {x.stock || 0}</small>
                              </span>
                            </button>
                          ))}
                        </div>
                      )}
                      {pista && <small style={{ flex: '1 0 100%', color: colorPista }}>{pista}</small>}
                    </div>
                  )
                }
                return (
                  <div>
                    {!intercambiosOk && (
                      <div style={{ background: '#fff8e1', border: '1px solid #e0c97a', borderRadius: 10, padding: 12 }}>
                        <strong>Falta crear las tablas de Intercambios</strong>
                        <p style={{ fontSize: 13, margin: '6px 0' }}>Se hace una sola vez: abre Supabase → SQL Editor, pega esto y toca Run. Después recarga la app.</p>
                        <pre style={{ fontSize: 11, whiteSpace: 'pre-wrap', background: '#fff', padding: 8, borderRadius: 8, border: '1px solid #eee', maxHeight: 220, overflow: 'auto' }}>{INT_SQL}</pre>
                        <button type="button" onClick={() => { if (navigator.clipboard) navigator.clipboard.writeText(INT_SQL).then(() => alert('SQL copiado.')) }}>📋 Copiar SQL</button>
                      </div>
                    )}
                    {intercambiosOk && (
                      <>
                        <button type="button" className="save-note-btn-inline" onClick={abrirNuevoIntercambio} style={{ marginBottom: 8 }}>➕ Nuevo intercambio</button>
                        <input className="order-search" placeholder="🔍 Folio, persona o planta…" value={intSearch} onChange={e => setIntSearch(e.target.value)} style={{ width: '100%', boxSizing: 'border-box', marginBottom: 8 }} />
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
                          {chip('all', 'Todos')}
                          {chip('cuarentena', `🌱 En cuarentena (${cuenta('cuarentena')})`)}
                          {chip('establecida', `✅ Establecidas (${cuenta('establecida')})`)}
                          {chip('baja', `🥀 Bajas (${cuenta('baja')})`)}
                        </div>
                        {filtrados.length === 0 && <p className="status-msg">{intercambios.length === 0 ? 'Todavía no hay intercambios. Toca "Nuevo intercambio".' : 'No se encontraron intercambios.'}</p>}
                        {filtrados.map(i => {
                          const its = itemsDe(i)
                          const ent = its.filter(x => x.direccion === 'entregado')
                          const rec = its.filter(x => x.direccion === 'recibido')
                          const key = `int-${i.id}`
                          const abierto = openCards.has(key)
                          const resumen = Object.keys(INT_ESTADOS).map(e => ({ e, n: rec.filter(x => (x.estado || 'cuarentena') === e).length })).filter(x => x.n > 0).map(x => `${INT_ESTADOS[x.e].icon} ${x.n}`).join(' ')
                          return (
                            <div key={i.id} className="admin-item lote-group collapsible-card" data-open={abierto ? 'true' : 'false'}
                              style={{ width: '100%', maxWidth: '100%', minWidth: 0, overflow: 'hidden', boxSizing: 'border-box', background: '#FBF7EC', marginBottom: 8 }}>
                              <div className="admin-item-info" style={{ width: '100%' }}>
                                <div className="card-title-row" onClick={() => toggleCard(key)} style={{ cursor: 'pointer' }}>
                                  <strong>{abierto ? '▾' : '▸'} 🔄 {folioInt(i)} — {i.contacto || 'Sin nombre'}</strong>
                                  <div style={{ fontSize: 12, color: '#7a7060' }}>{fechaDe(i)} · {ent.length} entregada{ent.length === 1 ? '' : 's'} · {rec.length} recibida{rec.length === 1 ? '' : 's'}{resumen ? ` · ${resumen}` : ''}</div>
                                </div>
                                {i.nota && <p style={{ margin: '8px 0 0', fontSize: 13, color: '#5a5040' }}>📝 {i.nota}</p>}
                                <p className="attr-label" style={{ margin: '12px 0 4px' }}>📤 Lo que entregué</p>
                                {ent.length === 0 ? <small style={{ color: '#7a7060' }}>— nada —</small> : ent.map(x => (
                                  <div key={x.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '5px 0', borderBottom: '1px solid #eee' }}>
                                    <span>{x.plant_name}</span><span>× {x.quantity}</span>
                                  </div>
                                ))}
                                <p className="attr-label" style={{ margin: '12px 0 4px' }}>📥 Lo que recibí</p>
                                {rec.length === 0 ? <small style={{ color: '#7a7060' }}>— nada —</small> : rec.map(x => {
                                  const est = INT_ESTADOS[x.estado] || INT_ESTADOS.cuarentena
                                  return (
                                    <div key={x.id} style={{ padding: '6px 0', borderBottom: '1px solid #eee' }}>
                                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><span>{x.plant_name}</span><span>× {x.quantity}</span></div>
                                      <select value={x.estado || 'cuarentena'} onChange={e => cambiarEstadoIntercambio(x, e.target.value)}
                                        style={{ marginTop: 4, width: '100%', boxSizing: 'border-box', background: est.bg, color: est.color, fontWeight: 700, border: `1px solid ${est.color}`, borderRadius: 8, padding: 6 }}>
                                        {Object.entries(INT_ESTADOS).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
                                      </select>
                                      {x.estado_fecha && <small style={{ color: '#7a7060' }}>{est.corto} desde {new Date(x.estado_fecha).toLocaleDateString()}</small>}
                                    </div>
                                  )
                                })}
                                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                                  <button type="button" onClick={() => abrirEditarIntercambio(i)} style={{ background: '#fff', color: '#4a5d3a', border: '1px solid #4a5d3a' }}>✏️ Editar intercambio</button>
                                  <button type="button" onClick={() => eliminarIntercambio(i)} style={{ background: '#fff', color: '#b03434', border: '1px solid #b03434' }}>🗑️ Eliminar intercambio</button>
                                </div>
                              </div>
                            </div>
                          )
                        })}
                      </>
                    )}

                    {intPicker && createPortal(
                      (() => {
                        const lista = plants
                          .filter(x => coincideBusqueda(x.name, intPicker.term))
                          .sort((a, b) => String(a.name).localeCompare(String(b.name), 'es', { numeric: true, sensitivity: 'base' }))
                        const elegir = x => {
                          const { lado, idx } = intPicker
                          setIntForm(f => ({ ...f, [lado]: f[lado].map((q, j) => (j === idx ? { ...q, name: x.name } : q)) }))
                          setIntPicker(null)
                        }
                        return (
                          <div className="admin-sheet-overlay" onClick={() => setIntPicker(null)}
                            style={{ position: 'fixed', inset: 0, zIndex: 3100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <div className="free-note-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 520, width: '100%', height: '88vh', display: 'flex', flexDirection: 'column' }}>
                              <div className="free-note-modal-header">
                                <h4>🖼️ Elegir planta ({lista.length})</h4>
                                <button type="button" className="modal-close-btn" onClick={() => setIntPicker(null)}>✕</button>
                              </div>
                              <input autoFocus className="order-search" placeholder="🔍 Buscar por nombre…" value={intPicker.term}
                                onChange={e => setIntPicker(v => ({ ...v, term: e.target.value }))}
                                style={{ width: '100%', maxWidth: 'none', boxSizing: 'border-box', marginBottom: 8 }} />
                              <div style={{ overflowY: 'auto', flex: 1, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(104px, 1fr))', gap: 8, alignContent: 'start', paddingBottom: 8 }}>
                                {lista.length === 0 && <p className="status-msg" style={{ gridColumn: '1 / -1' }}>No se encontraron plantas.</p>}
                                {lista.slice(0, 150).map(x => (
                                  <button key={x.id} type="button" onClick={() => elegir(x)}
                                    style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: 6, background: '#fff', border: '1px solid #E8DFC8', borderRadius: 10, boxShadow: 'none', minHeight: 0, color: '#3b3b32', cursor: 'pointer' }}>
                                    {x.image_url
                                      ? <img src={x.image_url} alt="" loading="lazy" style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', borderRadius: 8 }} />
                                      : <div style={{ width: '100%', aspectRatio: '1', borderRadius: 8, border: '1px dashed #ccc', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26, color: '#bbb' }}>🌱</div>}
                                    <span style={{ fontSize: 12, fontWeight: 600, lineHeight: 1.15, textAlign: 'center', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{x.name}</span>
                                    <small style={{ color: '#7a7060' }}>Stock {x.stock || 0}</small>
                                  </button>
                                ))}
                                {lista.length > 150 && <p className="status-msg" style={{ gridColumn: '1 / -1' }}>Mostrando 150. Escribe para acotar la búsqueda.</p>}
                              </div>
                            </div>
                          </div>
                        )
                      })(),
                      document.body
                    )}

                    {intFormOpen && createPortal(
                      <div className="admin-sheet-overlay" onClick={() => setIntFormOpen(false)}
                        style={{ position: 'fixed', inset: 0, zIndex: 3000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <div className="free-note-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 480, width: '100%', maxHeight: '90vh', overflowY: 'auto' }}>
                          <div className="free-note-modal-header">
                            <h4>{intForm.id ? '✏️ Editar intercambio' : '🔄 Nuevo intercambio'}</h4>
                            <button type="button" className="modal-close-btn" onClick={() => setIntFormOpen(false)}>✕</button>
                          </div>
                          <datalist id="int-plantas">{plants.map(pl => <option key={pl.id} value={pl.name} />)}</datalist>
                          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
                            <input placeholder="Persona o contacto" value={intForm.contacto} onChange={e => setIntForm(f => ({ ...f, contacto: e.target.value }))} style={{ flex: '1 1 180px', minWidth: 0, boxSizing: 'border-box' }} />
                            <input type="date" value={intForm.fecha} onChange={e => setIntForm(f => ({ ...f, fecha: e.target.value }))} style={{ flex: '0 1 150px', boxSizing: 'border-box' }} />
                          </div>
                          <input placeholder="Nota (opcional)" value={intForm.nota} onChange={e => setIntForm(f => ({ ...f, nota: e.target.value }))} style={{ width: '100%', boxSizing: 'border-box', marginBottom: 6 }} />

                          <p style={{ margin: '12px 2px 6px', fontSize: 13, fontWeight: 700, color: '#5B4636' }}>📤 Lo que entregué <span style={{ fontWeight: 400, color: '#7a7060' }}>(sale del stock)</span></p>
                          {intForm.entregados.map((r, idx) => lineaForm('entregados', r, idx))}
                          <button type="button" onClick={() => setIntForm(f => ({ ...f, entregados: [...f.entregados, { name: '', qty: 1 }] }))} style={{ padding: '6px 12px', fontSize: 13, minHeight: 0 }}>➕ Agregar planta</button>

                          <p style={{ margin: '16px 2px 6px', fontSize: 13, fontWeight: 700, color: '#5B4636' }}>📥 Lo que recibí <span style={{ fontWeight: 400, color: '#7a7060' }}>(entra en cuarentena)</span></p>
                          {intForm.recibidos.map((r, idx) => lineaForm('recibidos', r, idx))}
                          <button type="button" onClick={() => setIntForm(f => ({ ...f, recibidos: [...f.recibidos, { name: '', qty: 1 }] }))} style={{ padding: '6px 12px', fontSize: 13, minHeight: 0 }}>➕ Agregar planta</button>

                          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                            <button type="button" onClick={() => setIntFormOpen(false)}>Cancelar</button>
                            <button type="button" className="save-note-btn-inline" disabled={intSaving} onClick={guardarIntercambio} style={{ flex: 1 }}>{intSaving ? 'Guardando…' : (intForm.id ? '💾 Guardar cambios' : '💾 Guardar intercambio')}</button>
                          </div>
                        </div>
                      </div>,
                      document.body
                    )}
                  </div>
                )
              })()}

              {!loading && view === 'notas' && (() => {
                const term = globalNoteSearch.trim().toLowerCase()
                const globalResults = []
                if (term) {
                  plantNotes.forEach(note => {
                    ;(note.content_blocks || []).forEach(b => {
                      if (b.type === 'text' && b.content.toLowerCase().includes(term)) {
                        const plant = plants.find(p => p.id === note.plant_id)
                        globalResults.push({
                          key: `pn-${note.id}`, icon: '🪴',
                          title: plant ? plant.name : 'Planta',
                          snippet: b.content,
                          onOpen: () => { setView('galeria'); setPhotoModalPlantId(note.plant_id); setPhotoModalSection('notas') },
                        })
                      }
                    })
                  })
                  lotes.forEach(lote => {
                    ;(lote.content_blocks || []).forEach(b => {
                      if (b.type === 'text' && b.content.toLowerCase().includes(term)) {
                        globalResults.push({
                          key: `lt-${lote.id}`, icon: '📦',
                          title: `Compra #${lote.numero}${lote.proveedor ? ` — ${lote.proveedor}` : ''}`,
                          snippet: b.content,
                          onOpen: () => { setView('ingresos'); setIngresosSubTab('compras'); openLoteNote(lote) },
                        })
                      }
                    })
                  })
                  seedBatches.forEach(batch => {
                    ;(batch.content_blocks || []).forEach(b => {
                      if (b.type === 'text' && b.content.toLowerCase().includes(term)) {
                        globalResults.push({
                          key: `sb-${batch.id}`, icon: '🌰',
                          title: batch.es_noid ? 'NOID' : (batch.nombre || 'Lote de semillas'),
                          snippet: b.content,
                          onOpen: () => { setView('ingresos'); setIngresosSubTab('semillas'); openSbNote(batch) },
                        })
                      }
                    })
                  })
                  categoryNotes.forEach(note => {
                    ;(note.content_blocks || []).forEach(b => {
                      if (b.type === 'text' && b.content.toLowerCase().includes(term)) {
                        const cat = categories.find(c => c.id === note.category_id)
                        globalResults.push({
                          key: `cn-${note.id}`, icon: '📝',
                          title: cat ? `${cat.emoji} ${cat.name}` : 'General (sin categoría)',
                          snippet: b.content,
                          onOpen: () => openEditCategoryNote(note),
                        })
                      }
                    })
                  })
                }

                const filteredNotes = categoryNotes.filter(n => noteFilterCategory === 'all' || (noteFilterCategory === '__none__' ? !n.category_id : n.category_id === noteFilterCategory))
                return (
                  <>
                    <input
                      className="order-search"
                      placeholder="🔍 Buscar en todas las notas (plantas, compras, semillas, categorías)..."
                      value={globalNoteSearch}
                      onChange={e => setGlobalNoteSearch(e.target.value)}
                      style={{ marginBottom: 10 }}
                    />

                    {term ? (
                      <>
                        <p style={{ margin: '0 0 8px', color: '#7a7060', fontSize: 13 }}>{globalResults.length} resultado(s)</p>
                        {globalResults.length === 0 && <p className="status-msg">No se encontró nada con "{globalNoteSearch}".</p>}
                        <div className="admin-list">
                          {globalResults.map(r => (
                            <div key={r.key} className="admin-item" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <strong>{r.icon} {r.title}</strong>
                                <button type="button" onClick={r.onOpen}>Abrir</button>
                              </div>
                              <p className="task-note" style={{ margin: '4px 0 0' }}>{r.snippet}</p>
                            </div>
                          ))}
                        </div>
                      </>
                    ) : (
                      <>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                          <select value={noteFilterCategory} onChange={e => setNoteFilterCategory(e.target.value)} style={{ flex: '1 1 200px' }}>
                            <option value="all">Todas las categorías</option>
                            <option value="__none__">Sin categoría (generales)</option>
                            {categories.map(c => <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>)}
                          </select>
                          <button type="button" onClick={openNewCategoryNote} style={{ background: '#4a5d3a', color: '#fff', border: 'none', padding: '10px 16px', borderRadius: 8, fontWeight: 600 }}>
                            + Nueva nota
                          </button>
                        </div>

                        {filteredNotes.length === 0 && <p className="status-msg">No hay notas todavía.</p>}

                        <div className="admin-list">
                          {filteredNotes.map(note => {
                            const cat = categories.find(c => c.id === note.category_id)
                            return (
                              <div key={note.id} className="admin-item collapsible-card" data-open={openCards.has(`n-${note.id}`) ? 'true' : 'false'} style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                                <div className="card-title-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                                  <strong onClick={() => toggleCard(`n-${note.id}`)} style={{ flex: 1, minWidth: 0, cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: openCards.has(`n-${note.id}`) ? 'normal' : 'nowrap' }}>{openCards.has(`n-${note.id}`) ? '▾ ' : '▸ '}{cat ? `${cat.emoji} ${cat.name}` : '📝 General (sin categoría)'}{!openCards.has(`n-${note.id}`) && (() => { const t = ((note.content_blocks || []).find(b => b.type === 'text') || {}).content; return t ? ` — ${String(t).replace(/\s+/g, ' ').slice(0, 40)}${String(t).length > 40 ? '…' : ''}` : '' })()}</strong>
                                  <div style={{ display: 'flex', gap: 6 }}>
                                    <button type="button" onClick={() => openEditCategoryNote(note)}>✏️ Editar</button>
                                    <button type="button" className="danger" onClick={() => deleteCategoryNote(note.id)}>🗑️</button>
                                  </div>
                                </div>
                                <p style={{ fontSize: 12, color: '#7a7060', margin: '4px 0' }}>
                                  {new Date(note.updated_at || note.created_at).toLocaleString()}
                                </p>
                                <div className="note-blocks-view">
                                  {(note.content_blocks || []).map((b, i) => (
                                    <div key={i}>
                                      {b.type === 'text' && <p className="task-note">{b.content}</p>}
                                      {b.type === 'photo' && <img src={b.url} alt="" className="note-block-photo" />}
                                      {b.type === 'video' && <video src={b.url} controls className="note-video" />}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      </>
                    )}
                  </>
                )
              })()}

              {!loading && view === 'tabla' && (() => {
                const tableRows = [...plants, ...seedBatchesAsItems()].map(p => {
                  const compraDePlanta = compras.find(c => c.plant_id === p.id)
                  const loteDePlanta = compraDePlanta ? lotes.find(l => l.id === compraDePlanta.lote_id) : null
                  let precioSugerido = null
                  let costoSinEnvio = compraDePlanta && Number(compraDePlanta.unit_cost) > 0 ? Number(compraDePlanta.unit_cost) : null
                  if (compraDePlanta && loteDePlanta) {
                    const lineasDelLote = compras.filter(c => c.lote_id === loteDePlanta.id)
                    const { lineas: lineasProrrateadas } = loteProration(loteDePlanta, lineasDelLote)
                    const miLinea = lineasProrrateadas.find(l => l.id === compraDePlanta.id)
                    if (miLinea && Number(miLinea.quantity) > 0) {
                      precioSugerido = miLinea._lineTotal / Number(miLinea.quantity)
                    }
                  }
                  if (p.isSeed && p.costoSemilla != null) { costoSinEnvio = p.costoSemilla.solo; precioSugerido = p.costoSemilla.conEnvio }
                  const decrementoDePlanta = decrementos.find(d => d.plant_id === p.id)
                  const ventaLoteDePlanta = decrementoDePlanta ? ventaLotes.find(l => l.id === decrementoDePlanta.lote_id) : null
                  const orderDePlanta = orders.find(o => (o.order_items || []).some(it => it.plant_id === p.id))
                  const categoria = categories.find(cat => cat.id === p.category_id)
                  const vendido = !!(orderDePlanta || decrementoDePlanta)
                  const florecio = floraciones.some(f => f.plant_id === p.id)
                  const discountPercent = Number(p.discount_percent) || 0
                  const price = Number(p.price) || 0
                  return {
                    id: p.id,
                    image_url: p.image_url,
                    hasPhoto: !!p.image_url,
                    name: p.name || '',
                    isSeed: !!p.isSeed,
                    seedBatchId: p.seedBatchId || null,
                    categoria: p.isSeed ? `🌰 Semilla${categoria ? ` · ${categoria.name}` : ''}` : (categoria ? categoria.name : ''),
                    categoriaEmoji: p.isSeed ? '' : (categoria ? categoria.emoji : ''),
                    categoriaId: p.category_id || '',
                    categoriaParentId: categoria?.parent_id || '',
                    proveedor: compraDePlanta?.proveedor || p.proveedor || '',
                    price,
                    precioSugerido,
                    costoSinEnvio,
                    discountPercent,
                    priceWithDiscount: discountPercent > 0 ? price * (1 - discountPercent / 100) : price,
                    stock: Number(p.stock) || 0,
                    height: p.height || '',
                    is_new: !!p.is_new,
                    on_sale: !!p.on_sale,
                    coming_soon: !!p.coming_soon,
                    flagged: faltaInfo(p).length > 0,
                    florecio,
                    vendido,
                    loteNumero: loteDePlanta ? loteDePlanta.numero : null,
                    fechaCompra: loteDePlanta ? loteDePlanta.created_at : (compraDePlanta ? compraDePlanta.created_at : null),
                    ventaNumero: ventaLoteDePlanta ? ventaLoteDePlanta.numero : null,
                    fechaVenta: ventaLoteDePlanta ? ventaLoteDePlanta.created_at : (orderDePlanta ? orderDePlanta.created_at : (decrementoDePlanta ? decrementoDePlanta.created_at : null)),
                  }
                })

                const f = tableFilters
                const filteredRows = tableRows.filter(r => {
                  if (gallerySearch && !coincideBusqueda(textoBuscableItem(r), gallerySearch)) return false
                  if (f.categoria === '__seed__') { if (!r.isSeed) return false }
                  else if (f.categoria === '__plants__') { if (r.isSeed) return false }
                  else if (f.categoria !== 'all' && r.categoriaId !== f.categoria && r.categoriaParentId !== f.categoria) return false
                  if (f.proveedor && !r.proveedor.toLowerCase().includes(f.proveedor.trim().toLowerCase())) return false
                  if (f.precioMin !== '' && r.price < Number(f.precioMin)) return false
                  if (f.precioMax !== '' && r.price > Number(f.precioMax)) return false
                  if (f.stockMin !== '' && r.stock < Number(f.stockMin)) return false
                  if (f.stockMax !== '' && r.stock > Number(f.stockMax)) return false
                  if (f.altura && !r.height.toLowerCase().includes(f.altura.trim().toLowerCase())) return false
                  if (f.nueva !== 'all' && (f.nueva === 'si') !== r.is_new) return false
                  if (f.descuento !== 'all' && (f.descuento === 'si') !== r.on_sale) return false
                  if (f.proximamente !== 'all' && (f.proximamente === 'si') !== r.coming_soon) return false
                  if (f.revisar !== 'all' && (f.revisar === 'si') !== r.flagged) return false
                  if (f.florecio !== 'all' && (f.florecio === 'si') !== r.florecio) return false
                  if (f.vendido !== 'all' && (f.vendido === 'si') !== r.vendido) return false
                  if (f.foto !== 'all' && (f.foto === 'si') !== r.hasPhoto) return false
                  return true
                })

                // Orden natural (Epidendrum 2 antes que Epidendrum 10); los vacíos siempre quedan al final.
                const collator = new Intl.Collator('es', { numeric: true, sensitivity: 'base' })
                const isDateField = tableSort.field === 'fechaCompra' || tableSort.field === 'fechaVenta'
                const normSortValue = v => {
                  if (v == null || v === '') return null
                  if (tableSort.field === 'name' && esNombreCodigo(v)) return null
                  if (isDateField) return new Date(v).getTime()
                  if (typeof v === 'boolean') return v ? 1 : 0
                  return v
                }
                const sortedRows = [...filteredRows].sort((a, b) => {
                  const av = normSortValue(a[tableSort.field])
                  const bv = normSortValue(b[tableSort.field])
                  if (av === null && bv === null) return collator.compare(a.name, b.name)
                  if (av === null) return 1
                  if (bv === null) return -1
                  const cmp = (typeof av === 'string' || typeof bv === 'string')
                    ? collator.compare(String(av), String(bv))
                    : av - bv
                  if (cmp !== 0) return tableSort.dir === 'asc' ? cmp : -cmp
                  return collator.compare(a.name, b.name)
                })

                const arrow = field => tableSort.field === field
                  ? <span style={{ color: '#4a5d3a' }}>{tableSort.dir === 'asc' ? ' ▲' : ' ▼'}</span>
                  : <span style={{ opacity: 0.35 }}> ⇅</span>
                const sortOptions = [
                  ['name', 'Nombre'], ['categoria', 'Categoría'], ['proveedor', 'Proveedor'], ['price', 'Precio'],
                  ['priceWithDiscount', 'Precio con desc.'], ['costoSinEnvio', 'Costo'], ['precioSugerido', 'Costo + envío'], ['stock', 'Stock'], ['height', 'Altura'],
                  ['loteNumero', 'N° compra'], ['fechaCompra', 'Fecha compra'], ['ventaNumero', 'N° venta'], ['fechaVenta', 'Fecha venta'],
                ]
                const thStyle = { padding: '6px 8px', border: '1px solid #ddd', background: '#F3ECDD', cursor: 'pointer', textAlign: 'left', verticalAlign: 'top', position: 'sticky', top: 0, zIndex: 2, boxShadow: 'inset 0 -1px 0 #ddd', userSelect: 'none' }
                const thTitleStyle = { display: 'block', whiteSpace: 'nowrap', fontWeight: 700, marginBottom: 4 }
                const tdStyle = { padding: '6px 8px', border: '1px solid #ddd', whiteSpace: 'nowrap', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', verticalAlign: 'middle' }
                // Columnas fijas a la izquierda (Foto + Nombre) para saber qué planta es al deslizar de lado.
                const FOTO_W = 76, NOMBRE_W = 110
                const stickyBg = '#FBF7EE'
                const thFotoStyle = { ...thStyle, width: FOTO_W, left: 0, zIndex: 4 }
                const thNombreStyle = { ...thStyle, width: NOMBRE_W, left: FOTO_W, zIndex: 4, boxShadow: '3px 0 4px -2px rgba(0,0,0,0.18), inset 0 -1px 0 #ddd' }
                const tdFotoStyle = { ...tdStyle, position: 'sticky', left: 0, zIndex: 1, background: stickyBg }
                const tdNombreStyle = { ...tdStyle, position: 'sticky', left: FOTO_W, zIndex: 1, background: stickyBg, whiteSpace: 'normal', wordBreak: 'break-word', boxShadow: '3px 0 4px -2px rgba(0,0,0,0.18)' }
                const filterInputStyle = { display: 'block', width: 90, maxWidth: '100%', boxSizing: 'border-box', fontSize: 12, padding: '3px 4px' }

                return (
                  <>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
                      <p style={{ margin: 0, color: '#7a7060', fontSize: 13 }}>
                        {sortedRows.length} de {tableRows.length} ítem(s) — toca un encabezado (⇅) para ordenar
                      </p>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%' }}>
                        <label style={{ fontSize: 13, fontWeight: 600, color: '#5B4636', whiteSpace: 'nowrap' }}>Ordenar por</label>
                        <select
                          value={tableSort.field}
                          onChange={e => setTableSort(prev => ({ ...prev, field: e.target.value }))}
                          style={{ flex: 1, minWidth: 0, padding: '8px 6px', fontSize: 14 }}
                        >
                          {sortOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                        </select>
                        <button
                          type="button"
                          onClick={() => setTableSort(prev => ({ ...prev, dir: prev.dir === 'asc' ? 'desc' : 'asc' }))}
                          style={{ padding: '8px 12px', fontSize: 14, fontWeight: 700, whiteSpace: 'nowrap', cursor: 'pointer' }}
                          aria-label="Cambiar dirección del orden"
                        >
                          {tableSort.dir === 'asc' ? '▲ Ascendente' : '▼ Descendente'}
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={() => exportTableToExcel(sortedRows)}
                        style={{
                          background: QUICK_FILTER_TONES.sage.bg, border: `2px solid ${QUICK_FILTER_TONES.sage.border}`,
                          borderRadius: 18, padding: '9px 14px', fontWeight: 700, color: '#5B4636', fontSize: 13.5, cursor: 'pointer',
                        }}
                      >
                        ⬇️ Exportar a Excel ({sortedRows.length})
                      </button>
                    </div>
                    <div style={{ overflow: 'auto', maxHeight: '75vh', WebkitOverflowScrolling: 'touch', border: '1px solid #E8DFC8', borderRadius: 8 }}>
                      <table style={{ borderCollapse: 'separate', borderSpacing: 0, width: '100%', minWidth: 1806, tableLayout: 'fixed' }}>
                        <thead>
                          <tr>
                            <th style={thFotoStyle} onClick={() => toggleTableSort('hasPhoto')}>
                              <span style={thTitleStyle}>Foto{arrow('hasPhoto')}</span>
                              <select onClick={e => e.stopPropagation()} value={f.foto} onChange={e => setTableFilter('foto', e.target.value)} style={filterInputStyle}>
                                <option value="all">Todas</option><option value="si">Con foto</option><option value="no">Sin foto</option>
                              </select>
                            </th>
                            <th style={thNombreStyle} onClick={() => toggleTableSort('name')}>
                              <span style={thTitleStyle}>Nombre{arrow('name')}</span>
                              <input onClick={e => e.stopPropagation()} value={gallerySearch} onChange={e => setGallerySearch(e.target.value)} placeholder="Buscar..." style={filterInputStyle} />
                            </th>
                            <th style={{ ...thStyle, width: 120 }} onClick={() => toggleTableSort('categoria')}>
                              <span style={thTitleStyle}>Categoría{arrow('categoria')}</span>
                              <select onClick={e => e.stopPropagation()} value={f.categoria} onChange={e => setTableFilter('categoria', e.target.value)} style={filterInputStyle}>
                                <option value="all">Todas</option>
                                <option value="__seed__">🌰 Semillas</option>
                                <option value="__plants__">🪴 Solo plantas</option>
                                {categories.filter(c => !c.parent_id).map(parent => {
                                  const children = categories.filter(c => c.parent_id === parent.id)
                                  if (children.length === 0) {
                                    return <option key={parent.id} value={parent.id}>{parent.emoji} {parent.name}</option>
                                  }
                                  return (
                                    <optgroup key={parent.id} label={`${parent.emoji} ${parent.name}`}>
                                      <option value={parent.id}>{parent.emoji} {parent.name} (todas)</option>
                                      {children.map(ch => <option key={ch.id} value={ch.id}>　↳ {ch.emoji} {ch.name}</option>)}
                                    </optgroup>
                                  )
                                })}
                              </select>
                            </th>
                            <th style={{ ...thStyle, width: 110 }} onClick={() => toggleTableSort('proveedor')}>
                              <span style={thTitleStyle}>Proveedor{arrow('proveedor')}</span>
                              <input onClick={e => e.stopPropagation()} value={f.proveedor} onChange={e => setTableFilter('proveedor', e.target.value)} placeholder="Buscar..." style={filterInputStyle} />
                            </th>
                            <th style={{ ...thStyle, width: 90 }} onClick={() => toggleTableSort('costoSinEnvio')}>
                              <span style={thTitleStyle}>Costo{arrow('costoSinEnvio')}</span>
                            </th>
                            <th style={{ ...thStyle, width: 100 }} onClick={() => toggleTableSort('precioSugerido')}>
                              <span style={thTitleStyle}>Costo + envío{arrow('precioSugerido')}</span>
                            </th>
                            <th style={{ ...thStyle, width: 100 }} onClick={() => toggleTableSort('price')}>
                              <span style={thTitleStyle}>Precio{arrow('price')}</span>
                              <div style={{ display: 'flex', gap: 3 }}>
                                <input onClick={e => e.stopPropagation()} type="number" value={f.precioMin} onChange={e => setTableFilter('precioMin', e.target.value)} placeholder="Min" style={{ ...filterInputStyle, width: 44 }} />
                                <input onClick={e => e.stopPropagation()} type="number" value={f.precioMax} onChange={e => setTableFilter('precioMax', e.target.value)} placeholder="Max" style={{ ...filterInputStyle, width: 44 }} />
                              </div>
                            </th>
                            <th style={{ ...thStyle, width: 90 }} onClick={() => toggleTableSort('priceWithDiscount')}>
                              <span style={thTitleStyle}>Con desc.{arrow('priceWithDiscount')}</span>
                            </th>
                            <th style={{ ...thStyle, width: 90 }} onClick={() => toggleTableSort('stock')}>
                              <span style={thTitleStyle}>Stock{arrow('stock')}</span>
                              <div style={{ display: 'flex', gap: 3 }}>
                                <input onClick={e => e.stopPropagation()} type="number" value={f.stockMin} onChange={e => setTableFilter('stockMin', e.target.value)} placeholder="Min" style={{ ...filterInputStyle, width: 40 }} />
                                <input onClick={e => e.stopPropagation()} type="number" value={f.stockMax} onChange={e => setTableFilter('stockMax', e.target.value)} placeholder="Max" style={{ ...filterInputStyle, width: 40 }} />
                              </div>
                            </th>
                            <th style={{ ...thStyle, width: 90 }} onClick={() => toggleTableSort('height')}>
                              <span style={thTitleStyle}>Altura{arrow('height')}</span>
                              <input onClick={e => e.stopPropagation()} value={f.altura} onChange={e => setTableFilter('altura', e.target.value)} placeholder="Buscar..." style={filterInputStyle} />
                            </th>
                            <th style={{ ...thStyle, width: 80 }} onClick={() => toggleTableSort('is_new')}>
                              <span style={thTitleStyle}>Nueva{arrow('is_new')}</span>
                              <select onClick={e => e.stopPropagation()} value={f.nueva} onChange={e => setTableFilter('nueva', e.target.value)} style={filterInputStyle}>
                                <option value="all">Todas</option><option value="si">Sí</option><option value="no">No</option>
                              </select>
                            </th>
                            <th style={{ ...thStyle, width: 90 }} onClick={() => toggleTableSort('on_sale')}>
                              <span style={thTitleStyle}>Descuento{arrow('on_sale')}</span>
                              <select onClick={e => e.stopPropagation()} value={f.descuento} onChange={e => setTableFilter('descuento', e.target.value)} style={filterInputStyle}>
                                <option value="all">Todas</option><option value="si">Sí</option><option value="no">No</option>
                              </select>
                            </th>
                            <th style={{ ...thStyle, width: 80 }} onClick={() => toggleTableSort('coming_soon')}>
                              <span style={thTitleStyle}>Próx.{arrow('coming_soon')}</span>
                              <select onClick={e => e.stopPropagation()} value={f.proximamente} onChange={e => setTableFilter('proximamente', e.target.value)} style={filterInputStyle}>
                                <option value="all">Todas</option><option value="si">Sí</option><option value="no">No</option>
                              </select>
                            </th>
                            <th style={{ ...thStyle, width: 80 }} onClick={() => toggleTableSort('flagged')}>
                              <span style={thTitleStyle}>Falta info{arrow('flagged')}</span>
                              <select onClick={e => e.stopPropagation()} value={f.revisar} onChange={e => setTableFilter('revisar', e.target.value)} style={filterInputStyle}>
                                <option value="all">Todas</option><option value="si">Sí</option><option value="no">No</option>
                              </select>
                            </th>
                            <th style={{ ...thStyle, width: 90 }} onClick={() => toggleTableSort('florecio')}>
                              <span style={thTitleStyle}>Floreció{arrow('florecio')}</span>
                              <select onClick={e => e.stopPropagation()} value={f.florecio} onChange={e => setTableFilter('florecio', e.target.value)} style={filterInputStyle}>
                                <option value="all">Todas</option><option value="si">Sí</option><option value="no">No</option>
                              </select>
                            </th>
                            <th style={{ ...thStyle, width: 80 }} onClick={() => toggleTableSort('vendido')}>
                              <span style={thTitleStyle}>Vendió{arrow('vendido')}</span>
                              <select onClick={e => e.stopPropagation()} value={f.vendido} onChange={e => setTableFilter('vendido', e.target.value)} style={filterInputStyle}>
                                <option value="all">Todas</option><option value="si">Sí</option><option value="no">No</option>
                              </select>
                            </th>
                            <th style={{ ...thStyle, width: 90 }} onClick={() => toggleTableSort('loteNumero')}>N° compra{arrow('loteNumero')}</th>
                            <th style={{ ...thStyle, width: 100 }} onClick={() => toggleTableSort('fechaCompra')}>Fecha compra{arrow('fechaCompra')}</th>
                            <th style={{ ...thStyle, width: 90 }} onClick={() => toggleTableSort('ventaNumero')}>N° venta{arrow('ventaNumero')}</th>
                            <th style={{ ...thStyle, width: 100 }} onClick={() => toggleTableSort('fechaVenta')}>Fecha venta{arrow('fechaVenta')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {sortedRows.map(r => (
                            <tr
                              key={r.id}
                              onClick={() => { if (r.isSeed) { openSeedSheet(r.seedBatchId); return } setPhotoModalPlantId(r.id); setPhotoModalIndex(0); setPhotoModalSection('fotos') }}
                              style={{ cursor: 'pointer' }}
                            >
                              <td style={tdFotoStyle}>{r.image_url ? <img src={r.image_url} alt={r.name} loading="lazy" style={{ width: 55, height: 55, objectFit: 'cover', borderRadius: 8, display: 'block' }} /> : <div style={{ width: 55, height: 55, borderRadius: 8, background: '#F3ECDD', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#aaa' }}>—</div>}</td>
                              <td style={tdNombreStyle}>{r.isSeed ? '🌰 ' : ''}{r.name}</td>
                              <td style={tdStyle}>{r.categoriaEmoji} {r.categoria || '—'}</td>
                              <td style={tdStyle}>{r.proveedor || '—'}</td>
                              <td style={tdStyle}>{r.costoSinEnvio != null ? `$${r.costoSinEnvio.toFixed(2)}` : '—'}</td>
                              <td style={tdStyle}>{r.precioSugerido != null ? `$${r.precioSugerido.toFixed(2)}` : '—'}</td>
                              <td style={tdStyle}>${r.price.toFixed(2)}</td>
                              <td style={tdStyle}>{r.discountPercent > 0 ? `$${r.priceWithDiscount.toFixed(2)} (-${r.discountPercent}%)` : '—'}</td>
                              <td style={tdStyle}>{r.stock}</td>
                              <td style={tdStyle}>{r.height || '—'}</td>
                              <td style={tdStyle}>
                                {r.is_new ? (
                                  <button type="button" onClick={e => { e.stopPropagation(); toggleIsNew(r.id, true) }} style={{ background: 'none', border: '1px solid #ddd', borderRadius: 4, cursor: 'pointer', fontSize: 11, padding: '1px 5px' }}>✓ ✕</button>
                                ) : ''}
                              </td>
                              <td style={tdStyle}>{r.on_sale ? '✓' : ''}</td>
                              <td style={tdStyle}>
                                {r.coming_soon ? (
                                  <button type="button" onClick={e => { e.stopPropagation(); toggleComingSoon(r.id, true) }} style={{ background: 'none', border: '1px solid #ddd', borderRadius: 4, cursor: 'pointer', fontSize: 11, padding: '1px 5px' }}>✓ ✕</button>
                                ) : ''}
                              </td>
                              <td style={tdStyle}>{r.flagged ? '🚩' : ''}</td>
                              <td style={tdStyle}>{r.florecio ? '🌸' : ''}</td>
                              <td style={tdStyle}>{r.vendido ? '🛒' : ''}</td>
                              <td style={tdStyle}>{r.loteNumero ?? '—'}</td>
                              <td style={tdStyle}>{r.fechaCompra ? new Date(r.fechaCompra).toLocaleDateString() : '—'}</td>
                              <td style={tdStyle}>{r.ventaNumero ?? '—'}</td>
                              <td style={tdStyle}>{r.fechaVenta ? new Date(r.fechaVenta).toLocaleDateString() : '—'}</td>
                            </tr>
                          ))}
                          {sortedRows.length === 0 && (
                            <tr><td colSpan={20} style={{ ...tdStyle, textAlign: 'center' }}>No hay plantas con esos filtros.</td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </>
                )
              })()}

              {!loading && view === 'ingresos' && (() => {
                function compraCategoryId(c) {
                  if (c.new_plant_category) return c.new_plant_category
                  const plant = plants.find(p => p.id === c.plant_id)
                  return plant ? plant.category_id : null
                }

                const filteredCompras = compras
                  .filter(c => {
                    const term = ingresosSearch.trim().toLowerCase()
                    if (!term) return true
                    const catC = categories.find(k => k.id === compraCategoryId(c))
                    return coincideBusqueda(`${c.proveedor || ''} ${compraNombre(c)} ${c.plant_name || ''} ${c.new_plant_name || ''} ${catC ? catC.name : ''}`, term)
                  })
                  .filter(c => !ingresosDate || (c.created_at || '').slice(0, 10) === ingresosDate)
                  .filter(c => ingresosCategoria === 'all' || compraCategoryId(c) === ingresosCategoria)
                  .filter(c => ingresosStatus === 'all' || c.status === ingresosStatus)

                const comprasByLote = {}
                const comprasSinLote = []
                filteredCompras.forEach(c => {
                  if (c.lote_id) {
                    if (!comprasByLote[c.lote_id]) comprasByLote[c.lote_id] = []
                    comprasByLote[c.lote_id].push(c)
                  } else {
                    comprasSinLote.push(c)
                  }
                })
                return (
                  <>
                    <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
                      <button
                        type="button"
                        onClick={() => setIngresosSubTab('compras')}
                        className={ingresosSubTab === 'compras' ? 'ingresos-tab active' : 'ingresos-tab'}
                      >
                        🌱 Plantas
                      </button>
                      <button
                        type="button"
                        onClick={() => setIngresosSubTab('semillas')}
                        className={ingresosSubTab === 'semillas' ? 'ingresos-tab active' : 'ingresos-tab'}
                      >
                        🌰 Semillas
                      </button>
                    </div>

                    {ingresosSubTab === 'compras' && (
                    <>
                    {!loteBuilderOpen && (
                      <>
                        <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
                          <button
                            type="button"
                            className="full-form-btn"
                            onClick={() => { setLoteBuilderOpen(true); setLoteStep('method'); setLoteAddMode('choose') }}
                            style={{ background: '#4a5d3a', color: '#fff', border: 'none', padding: '14px 22px', borderRadius: 8, fontSize: '1.05rem', fontWeight: 700, boxShadow: '0 3px 6px rgba(0,0,0,0.2)', flex: '1 1 auto' }}
                          >
                            🧺 Nueva compra
                          </button>
                          <button
                            type="button"
                            onClick={() => setIngresosMenuOpen(!ingresosMenuOpen)}
                            style={{ background: '#fff', color: '#4a5d3a', border: '1px solid #4a5d3a', padding: '14px 18px', borderRadius: 8, fontSize: '0.95rem', fontWeight: 600 }}
                          >
                            🔍 Buscar compra
                          </button>
                        </div>

                        {ingresosMenuOpen && (
                          <div className="admin-form" style={{ marginBottom: 10, padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
                            <input
                              className="order-search"
                              placeholder="Buscar por proveedor o planta..."
                              value={ingresosSearch}
                              onChange={e => setIngresosSearch(e.target.value)}
                              style={{ width: '100%', boxSizing: 'border-box', padding: '10px', fontSize: '1rem', borderRadius: 6, border: '1px solid #ccc' }}
                            />
                            <div className="mov-filters" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                              <input
                                type="date"
                                className="gallery-select"
                                value={ingresosDate}
                                onChange={e => setIngresosDate(e.target.value)}
                                style={{ padding: '10px', borderRadius: 6, border: '1px solid #ccc' }}
                              />
                              <select className="gallery-select" value={ingresosCategoria} onChange={e => setIngresosCategoria(e.target.value)} style={{ padding: '10px', borderRadius: 6, border: '1px solid #ccc' }}>
                                <option value="all">Todas las categorías</option>
                                {categories.map(c => <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>)}
                              </select>
                              <select className="gallery-select" value={ingresosStatus} onChange={e => setIngresosStatus(e.target.value)} style={{ padding: '10px', borderRadius: 6, border: '1px solid #ccc' }}>
                                <option value="all">Todos los estados</option>
                                <option value="pedido">Pedido</option>
                                <option value="pagado">Pagado</option>
                                <option value="recibido">Recibido</option>
                              </select>
                              {(ingresosSearch || ingresosDate || ingresosCategoria !== 'all' || ingresosStatus !== 'all') && (
                                <button
                                  type="button"
                                  onClick={() => { setIngresosSearch(''); setIngresosDate(''); setIngresosCategoria('all'); setIngresosStatus('all') }}
                                >
                                  Limpiar filtros
                                </button>
                              )}
                            </div>
                          </div>
                        )}
                      </>
                    )}

                    {/* ---------- PASO 0: Elegir cómo se ingresa la compra ---------- */}
                    {loteBuilderOpen && loteStep === 'method' && (
                      <div className="admin-form" style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 14 }}>
                        <h3 style={{ margin: '4px 0 0' }}>🧺 Nueva compra</h3>
                        <div style={{ fontSize: '0.95rem', color: '#6b6b5f', marginTop: -4 }}>¿Cómo quieres ingresarla?</div>

                        <label
                          style={{ background: '#4a5d3a', color: '#fff', padding: '16px 14px', borderRadius: 8, fontSize: '1rem', fontWeight: 600, cursor: scanningFactura ? 'wait' : 'pointer', display: 'flex', flexDirection: 'column', gap: 2, opacity: scanningFactura ? 0.7 : 1 }}
                        >
                          <span>{scanningFactura ? '⏳ Leyendo factura...' : '📷 Escanear factura'}</span>
                          <span style={{ fontSize: '0.82rem', fontWeight: 400, opacity: 0.9 }}>Toma una foto de la factura y los productos se leen solos</span>
                          <input
                            type="file"
                            accept="image/*"
                            onChange={handleScanFacturaFile}
                            disabled={scanningFactura}
                            style={{ display: 'none' }}
                          />
                        </label>

                        <button
                          type="button"
                          onClick={() => { setLoteMethod('fotos'); setLoteAddMode('choose'); setLoteStep('header') }}
                          style={{ background: '#fff', color: '#4a5d3a', padding: '16px 14px', borderRadius: 8, border: '2px solid #4a5d3a', fontSize: '1rem', fontWeight: 600, textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 2 }}
                        >
                          <span>📸 Ingreso por fotografías</span>
                          <span style={{ fontSize: '0.82rem', fontWeight: 400, color: '#6b6b5f' }}>Sube varias fotos y cada una se agrega a la compra</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => { setLoteMethod('manual'); setLoteAddMode('choose'); setLoteStep('header') }}
                          style={{ background: '#fff', color: '#4a5d3a', padding: '16px 14px', borderRadius: 8, border: '2px solid #4a5d3a', fontSize: '1rem', fontWeight: 600, textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 2 }}
                        >
                          <span>✍️ Manual</span>
                          <span style={{ fontSize: '0.82rem', fontWeight: 400, color: '#6b6b5f' }}>Busca la planta en el catálogo o registra una nueva</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => { setLoteBuilderOpen(false); setLoteLines([]); setLoteNota(''); setLoteProveedor(''); setLoteStep('header'); setLoteAddMode('choose') }}
                          style={{ background: '#fff', color: '#b03434', padding: '10px 16px', borderRadius: 6, border: '1px solid #b03434', width: '100%', boxSizing: 'border-box' }}
                        >
                          Cancelar
                        </button>
                      </div>
                    )}

                    {/* ---------- PASO 1: Cabecera de la compra (Proveedor) ---------- */}
                    {loteBuilderOpen && loteStep === 'header' && (
                      <div className="admin-form" style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 14 }}>
                        <div style={{ fontSize: '0.8rem', color: '#6b6b5f', marginBottom: -4, fontWeight: 600 }}>PASO 1 DE 2 · Datos de la compra</div>
                        <h3 style={{ margin: '4px 0' }}>Nueva compra · {loteMethod === 'fotos' ? '📸 Por fotografías' : '✍️ Manual'}</h3>
                        <button
                          type="button"
                          onClick={() => setLoteStep('method')}
                          style={{ alignSelf: 'flex-start', fontSize: '0.8rem', background: 'none', border: 'none', color: '#4a5d3a', textDecoration: 'underline', cursor: 'pointer', padding: 0, marginTop: -4 }}
                        >
                          ↩ Cambiar forma de ingreso
                        </button>
                        <input
                          placeholder="Proveedor (opcional)"
                          list="proveedores-list"
                          value={loteProveedor}
                          onChange={e => setLoteProveedor(e.target.value)}
                          style={{ width: '100%', boxSizing: 'border-box', padding: '12px 10px', fontSize: '1rem', borderRadius: 6, border: '1px solid #ccc' }}
                        />
                        <datalist id="proveedores-list">
                          {[...new Set(lotes.map(l => l.proveedor).filter(Boolean))].map(prov => (
                            <option key={prov} value={prov} />
                          ))}
                        </datalist>

                        <div className="admin-item-actions" style={{ flexDirection: 'column', gap: 8, marginTop: 6 }}>
                          <button
                            type="button"
                            onClick={() => setLoteStep('products')}
                            style={{ background: '#4a5d3a', color: '#fff', padding: '14px 16px', borderRadius: 8, border: 'none', fontSize: '1rem', fontWeight: 600, width: '100%' }}
                          >
                            Comenzar a agregar productos →
                          </button>
                          <button
                            type="button"
                            onClick={() => { setLoteBuilderOpen(false); setLoteLines([]); setLoteNota(''); setLoteProveedor(''); setLoteStep('header') }}
                            style={{ background: '#fff', color: '#b03434', padding: '10px 16px', borderRadius: 6, border: '1px solid #b03434', width: '100%', boxSizing: 'border-box' }}
                          >
                            Cancelar
                          </button>
                        </div>
                      </div>
                    )}

                    {/* ---------- PASO 2: Agregar productos + resumen ---------- */}
                    {loteBuilderOpen && loteStep === 'products' && (
                      <div className="admin-form" style={{ padding: 14 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4, gap: 8 }}>
                          <div style={{ fontSize: '0.8rem', color: '#6b6b5f', fontWeight: 600 }}>PASO 2 DE 2 · Agregar productos</div>
                          <button
                            type="button"
                            onClick={() => setLoteStep('header')}
                            style={{ fontSize: '0.75rem', background: 'none', border: 'none', color: '#4a5d3a', textDecoration: 'underline', cursor: 'pointer', whiteSpace: 'nowrap' }}
                          >
                            ✏️ Editar proveedor/nota
                          </button>
                        </div>
                        <h3 style={{ margin: '4px 0 12px' }}>
                          {loteProveedor ? `Compra a ${loteProveedor}` : 'Nueva compra'}
                          {loteNota ? ` — ${loteNota}` : ''}
                        </h3>

                        {/* Agregar planta: primero la acción, sin ningún texto ni contador por encima */}
                        {loteAddMode === 'choose' && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 14 }}>
                            <input
                              ref={bulkLoteBuilderPhotoInputRef}
                              type="file"
                              accept="image/*"
                              multiple
                              style={{ display: 'none' }}
                              onChange={e => { addBulkPhotosToLoteBuilder(e.target.files); e.target.value = '' }}
                            />
                            {loteMethod === 'fotos' ? (
                              <>
                                <button
                                  type="button"
                                  onClick={() => setBulkCategoryPickerFor('loteBuilder')}
                                  style={{ background: '#4a5d3a', color: '#fff', padding: '16px 14px', borderRadius: 8, border: 'none', fontSize: '1rem', fontWeight: 600, textAlign: 'left', display: 'flex', alignItems: 'center', gap: 10 }}
                                >
                                  📸 Elegir fotos
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setLoteMethod('manual')}
                                  style={{ background: 'none', border: 'none', color: '#4a5d3a', textDecoration: 'underline', cursor: 'pointer', fontSize: '0.85rem', alignSelf: 'flex-start', padding: 0 }}
                                >
                                  ✍️ Agregar una planta a mano
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  onClick={() => setLoteAddMode('search')}
                                  style={{ background: '#4a5d3a', color: '#fff', padding: '16px 14px', borderRadius: 8, border: 'none', fontSize: '1rem', fontWeight: 600, textAlign: 'left', display: 'flex', alignItems: 'center', gap: 10 }}
                                >
                                  🔍 Buscar planta existente en catálogo
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setLoteAddMode('new')}
                                  style={{ background: '#fff', color: '#4a5d3a', padding: '16px 14px', borderRadius: 8, border: '2px solid #4a5d3a', fontSize: '1rem', fontWeight: 600, textAlign: 'left', display: 'flex', alignItems: 'center', gap: 10 }}
                                >
                                  🌱 Registrar planta nueva
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setLoteMethod('fotos')}
                                  style={{ background: 'none', border: 'none', color: '#4a5d3a', textDecoration: 'underline', cursor: 'pointer', fontSize: '0.85rem', alignSelf: 'flex-start', padding: 0 }}
                                >
                                  📸 Cargar varias fotos
                                </button>
                              </>
                            )}
                          </div>
                        )}

                        {/* Al entrar a buscar o registrar, solo se ve el formulario correspondiente — sin encabezados de más */}

                        {/* Paso B1: Buscar planta existente */}
                        {loteAddMode === 'search' && !lineForm.plant_id && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            <button
                              type="button"
                              onClick={() => setLoteAddMode('choose')}
                              style={{ background: '#fff', color: '#b03434', border: '1px solid #b03434', padding: '10px 14px', borderRadius: 6, fontSize: '0.9rem', fontWeight: 600, alignSelf: 'flex-start' }}
                            >
                              ← Cancelar / Volver a opciones
                            </button>
                            <select
                              className="gallery-select"
                              value={loteLinePlantCategory}
                              onChange={e => setLoteLinePlantCategory(e.target.value)}
                              style={{ fontSize: '1rem', width: '100%', boxSizing: 'border-box', padding: '10px', borderRadius: 6, border: '1px solid #ccc' }}
                            >
                              <option value="all">Todas las categorías</option>
                              {categories.map(c => <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>)}
                            </select>
                            <input
                              className="order-search"
                              placeholder="🔍 Buscar planta por nombre..."
                              value={loteLinePlantSearch}
                              onChange={e => setLoteLinePlantSearch(e.target.value)}
                              style={{ fontSize: '1rem', padding: 10, width: '100%', boxSizing: 'border-box', borderRadius: 6, border: '1px solid #ccc' }}
                            />
                            {(loteLinePlantSearch.trim() || loteLinePlantCategory !== 'all') ? (
                              <PlantPicker
                                list={plants
                                  .filter(p => loteLinePlantCategory === 'all' || p.category_id === loteLinePlantCategory)
                                  .filter(p => p.name.toLowerCase().includes(loteLinePlantSearch.trim().toLowerCase()))}
                                selectedId={lineForm.plant_id}
                                onSelect={id => setLineForm({ ...lineForm, plant_id: id, new_plant_name: '', new_plant_category: '' })}
                              />
                            ) : (
                              <p className="status-msg" style={{ margin: '4px 0' }}>Elige una categoría o escribe para buscar</p>
                            )}
                          </div>
                        )}

                        {/* Paso B2: formulario limpio para planta nueva */}
                        {loteAddMode === 'new' && (
                          <div style={{ background: '#f3ecdd', padding: 12, borderRadius: 8, marginTop: 4, border: '1px solid #d8cdb0', display: 'flex', flexDirection: 'column', gap: 8 }}>
                            <strong>🌱 Registrando planta nueva</strong>
                            <button
                              type="button"
                              onClick={() => { setLineForm({ plant_id: '', new_plant_name: '', new_plant_category: '', quantity: '', unit_cost: '', sale_price: '', file: null }); setLoteAddMode('choose') }}
                              style={{ background: '#fff', color: '#b03434', border: '1px solid #b03434', padding: '10px 14px', borderRadius: 6, fontSize: '0.9rem', fontWeight: 600, alignSelf: 'flex-start' }}
                            >
                              ← Cancelar / Volver a opciones
                            </button>
                            <input placeholder="Nombre de la planta" value={lineForm.new_plant_name} onChange={e => setLineForm({ ...lineForm, plant_id: '', new_plant_name: e.target.value })} style={{ width: '100%', boxSizing: 'border-box', padding: 10, borderRadius: 6, border: '1px solid #ccc' }} />
                            <select value={lineForm.new_plant_category} onChange={e => setLineForm({ ...lineForm, new_plant_category: e.target.value })} style={{ width: '100%', boxSizing: 'border-box', padding: 10, borderRadius: 6, border: '1px solid #ccc' }}>
                              <option value="">Selecciona categoría (crea la categoría primero en Categorías si no existe)</option>
                              {assignableCategories().map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                            </select>
                           <div style={{ marginBottom: '10px' }}>
  <label style={{ display: 'block', fontWeight: 'bold', fontSize: '13px', marginBottom: '4px' }}>
    📷 Foto de la compra / etiqueta (Autocompletar)
  </label>
  <input 
    type="file" 
    accept="image/*"
    disabled={isAnalyzingImage}
    onChange={async (e) => {
      const file = e.target.files[0];
      if (file) {
        setLineForm(prev => ({ ...prev, file }));
        await handleAutoFillFromImage(file);
      }
    }} 
  />

  {isAnalyzingImage && (
    <p style={{ color: '#2563eb', marginTop: '4px', fontSize: '13px', fontWeight: 'bold' }}>
      🔍 Leyendo datos de la foto con IA...
    </p>
  )}
</div>
                            <input placeholder="Cantidad" type="number" value={lineForm.quantity} onChange={e => setLineForm({ ...lineForm, quantity: e.target.value })} style={{ width: '100%', boxSizing: 'border-box', padding: 10, borderRadius: 6, border: '1px solid #ccc' }} />
                            <input placeholder="Precio de compra (por unidad)" type="number" step="0.01" value={lineForm.unit_cost} onChange={e => setLineForm({ ...lineForm, unit_cost: e.target.value })} style={{ width: '100%', boxSizing: 'border-box', padding: 10, borderRadius: 6, border: '1px solid #ccc' }} />
                            <input placeholder="Precio de venta (opcional)" type="number" step="0.01" value={lineForm.sale_price} onChange={e => setLineForm({ ...lineForm, sale_price: e.target.value })} style={{ width: '100%', boxSizing: 'border-box', padding: 10, borderRadius: 6, border: '1px solid #ccc' }} />
                            <button
                              type="button"
                              onClick={e => { if (addLineToLote(e)) { setLoteAddMode('choose'); setLoteLinePlantSearch(''); setLoteLinePlantCategory('all') } }}
                              style={{ background: '#4a5d3a', color: '#fff', padding: '10px 16px', borderRadius: 6, border: 'none', marginTop: 4, width: '100%' }}
                            >
                              ➕ Agregar a la lista
                            </button>
                          </div>
                        )}

                        {/* Paso C: planta existente ya seleccionada — solo faltan cantidad/precios */}
                        {loteAddMode === 'search' && lineForm.plant_id && (
                          <div style={{ background: '#f3ecdd', padding: 12, borderRadius: 8, marginTop: 8, border: '1px solid #d8cdb0', display: 'flex', flexDirection: 'column', gap: 8 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <strong>✓ {plants.find(p => p.id === lineForm.plant_id)?.name || ''}</strong>
                              <button
                                type="button"
                                onClick={() => setLineForm({ ...lineForm, plant_id: '' })}
                                style={{ fontSize: '0.75rem', background: 'none', border: 'none', color: '#4a5d3a', textDecoration: 'underline', cursor: 'pointer' }}
                              >
                                Cambiar selección
                              </button>
                            </div>
                            <input placeholder="Cantidad" type="number" value={lineForm.quantity} onChange={e => setLineForm({ ...lineForm, quantity: e.target.value })} style={{ width: '100%', boxSizing: 'border-box', padding: 10, borderRadius: 6, border: '1px solid #ccc' }} />
                            <input placeholder="Precio de compra (por unidad)" type="number" step="0.01" value={lineForm.unit_cost} onChange={e => setLineForm({ ...lineForm, unit_cost: e.target.value })} style={{ width: '100%', boxSizing: 'border-box', padding: 10, borderRadius: 6, border: '1px solid #ccc' }} />
                            <input placeholder="Precio de venta (opcional)" type="number" step="0.01" value={lineForm.sale_price} onChange={e => setLineForm({ ...lineForm, sale_price: e.target.value })} style={{ width: '100%', boxSizing: 'border-box', padding: 10, borderRadius: 6, border: '1px solid #ccc' }} />
                            <input type="file" accept="image/*" onChange={e => setLineForm({ ...lineForm, file: e.target.files[0] })} />
                            <button
                              type="button"
                              onClick={e => { if (addLineToLote(e)) { setLoteAddMode('choose'); setLoteLinePlantSearch(''); setLoteLinePlantCategory('all') } }}
                              style={{ background: '#4a5d3a', color: '#fff', padding: '10px 16px', borderRadius: 6, border: 'none', marginTop: 4, width: '100%' }}
                            >
                              ➕ Agregar a la lista
                            </button>
                            <button
                              type="button"
                              onClick={() => { setLineForm({ ...lineForm, plant_id: '' }); setLoteAddMode('choose') }}
                              style={{ background: '#fff', color: '#b03434', border: '1px solid #b03434', padding: '10px 14px', borderRadius: 6, fontSize: '0.9rem', fontWeight: 600 }}
                            >
                              ← Cancelar / Volver a opciones
                            </button>
                          </div>
                        )}

                        {/* Resumen: aparece solo cuando ya hay productos, y siempre debajo de las acciones */}
                        {loteLines.length > 0 && (
                          <div style={{ marginTop: 18 }}>
                            <h4 style={{ margin: '0 0 8px' }}>Productos agregados ({loteLines.length})</h4>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
                              <thead>
                                <tr style={{ borderBottom: '2px solid #4a5d3a' }}>
                                  <th style={{ textAlign: 'left', padding: '6px 4px' }}>Nombre</th>
                                  <th style={{ textAlign: 'center', padding: '6px 4px' }}>Cant.</th>
                                  <th style={{ textAlign: 'right', padding: '6px 4px' }}>Total</th>
                                  <th style={{ padding: '6px 4px' }}></th>
                                </tr>
                              </thead>
                              <tbody>
                                {loteLines.map((line, i) => (
                                  <tr key={i} style={{ borderBottom: '1px solid #ddd' }}>
                                    <td style={{ padding: '6px 4px' }}>{line.plant_name}</td>
                                    <td style={{ textAlign: 'center', padding: '6px 4px' }}>{line.quantity}</td>
                                    <td style={{ textAlign: 'right', padding: '6px 4px' }}>${(Number(line.quantity || 0) * Number(line.unit_cost || 0)).toFixed(2)}</td>
                                    <td style={{ textAlign: 'right', padding: '6px 4px' }}>
                                      <button onClick={() => removeLoteLine(i)} className="danger" style={{ fontSize: '0.75rem' }}>Quitar</button>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}

                        {/* Guardar/Cancelar: solo visibles y activos si ya hay al menos un producto */}
                        {loteLines.length > 0 && (
                          <div className="admin-item-actions" style={{ marginTop: 12 }}>
                            <button
                              type="button"
                              onClick={saveLote}
                              disabled={savingLote}
                              style={{ background: '#4a5d3a', color: '#fff', padding: '10px 16px', borderRadius: 6, border: 'none' }}
                            >
                              {savingLote ? 'Guardando...' : 'Guardar compra'}
                            </button>
                            <button
                              type="button"
                              onClick={() => { setLoteBuilderOpen(false); setLoteLines([]); setLoteNota(''); setLoteProveedor(''); setLoteStep('header'); setLoteAddMode('choose') }}
                              style={{ background: '#fff', color: '#b03434', padding: '10px 16px', borderRadius: 6, border: '1px solid #b03434' }}
                            >
                              Cancelar
                            </button>
                          </div>
                        )}
                      </div>
                    )}

                    <div className="admin-list">
                      {lotes.length === 0 && comprasSinLote.length === 0 && <p className="status-msg">No hay ingresos registrados.</p>}
                      {lotes.map(lote => {
                        const lineas = comprasByLote[lote.id] || []
                        if (lineas.length === 0) return null
                        const { subtotal, extras, total: totalLote, lineas: lineasConProrrateo } = loteProration(lote, lineas)
                        const editing = editingLoteId === lote.id
                        const loteDraft = loteDrafts[lote.id] || {}
                        return (
                          <div key={lote.id} className="admin-item lote-group collapsible-card" data-open={(openCards.has(`cl-${lote.id}`) || editing) ? 'true' : 'false'} style={{ width: '100%', maxWidth: '100%', minWidth: 0, overflow: 'hidden', boxSizing: 'border-box', background: statusPastelBg(lineas, 'recibido') }}>
                            <div className="admin-item-info" style={{ width: '100%', maxWidth: '100%', minWidth: 0, boxSizing: 'border-box' }}>
                              <div className="card-title-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                                <strong onClick={() => toggleCard(`cl-${lote.id}`)} style={{ flex: 1, minWidth: 0, cursor: 'pointer' }}>{(openCards.has(`cl-${lote.id}`) || editing) ? `▾ 🧺 Compra #${lote.numero}${lote.nota ? ` — ${lote.nota}` : ''}` : `▸ 🧺 Compra #${lote.numero}${(lote.proveedor || lote.nota) ? ` — ${lote.proveedor || lote.nota}` : ''}`}</strong>
                                <button type="button" onClick={() => editing ? finishEditingLote(lote, lineasConProrrateo) : setEditingLoteId(lote.id)}>
                                  {editing ? '✅ Listo' : '✏️ Editar'}
                                </button>
                              </div>
                              {editing ? (
                                <label>Proveedor: <input value={loteDraft.proveedor ?? (lote.proveedor || '')} onChange={e => setLoteDraftField(lote.id, 'proveedor', e.target.value)} /></label>
                              ) : (
                                <span>Proveedor: {lote.proveedor || '—'}</span>
                              )}
                              {editing ? (
                                <label>Fecha: <input type="date" value={loteDraft.fecha ?? dateToInputValue(lote.created_at)} onChange={e => setLoteDraftField(lote.id, 'fecha', e.target.value)} /></label>
                              ) : (
                                <span>Fecha: {new Date(lote.created_at).toLocaleDateString()}</span>
                              )}

                              <p style={{ fontSize: '0.7rem', color: '#8a8a7a', margin: '8px 0 2px', textAlign: 'center' }}>◀ Deslizá la tabla para ver más columnas ▶</p>
                              <div style={{ width: '100%', maxWidth: '100%', minWidth: 0, overflowX: 'auto', WebkitOverflowScrolling: 'touch', touchAction: 'pan-x pan-y', marginTop: 2, borderRadius: 8, border: '1px solid #ddd', boxShadow: '0 1px 2px rgba(0,0,0,0.06)', boxSizing: 'border-box' }}>
                                <table className="invoice-table" style={{ borderCollapse: 'collapse', width: '100%', minWidth: 380, fontSize: 11 }}>
                                  <thead>
                                    <tr style={{ background: '#f3ecdd' }}>
                                      <th style={{ padding: '3px 2px', border: '1px solid #ddd', whiteSpace: 'nowrap' }}>Foto</th>
                                      <th style={{ padding: '3px 2px', border: '1px solid #ddd', whiteSpace: 'normal', maxWidth: 60, wordBreak: 'break-word' }}>Nombre</th>
                                      <th style={{ padding: '3px 2px', border: '1px solid #ddd', whiteSpace: 'nowrap' }}>Cant</th>
                                      <th style={{ padding: '3px 2px', border: '1px solid #ddd', whiteSpace: 'nowrap' }}>P.Unit</th>
                                      <th style={{ padding: '3px 2px', border: '1px solid #ddd', whiteSpace: 'nowrap' }}>P.Tot</th>
                                      <th style={{ padding: '3px 2px', border: '1px solid #ddd', whiteSpace: 'nowrap' }}>Pror.</th>
                                      <th style={{ padding: '3px 2px', border: '1px solid #ddd', whiteSpace: 'nowrap' }}>Total</th>
                                      <th style={{ padding: '3px 2px', border: '1px solid #ddd', whiteSpace: 'nowrap' }}>Estado</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {lineasConProrrateo.map(c => {
                                      const lineDraft = compraDrafts[c.id] || {}
                                      return (
                                      <tr key={c.id}>
                                        <td style={{ padding: 2, border: '1px solid #ddd', textAlign: 'center', whiteSpace: 'nowrap' }}>
                                          {c.image_url ? <img src={c.image_url} alt={compraNombre(c)} style={{ width: 22, height: 22, objectFit: 'cover', borderRadius: 3 }} /> : '—'}
                                          {editing && (
                                            <label className="file-label" style={{ display: 'block', marginTop: 1, fontSize: 8, background: 'transparent', color: 'inherit', border: '1px solid #ccc' }}>
                                              📷
                                              <input
                                                type="file"
                                                accept="image/*"
                                                style={{ display: 'none' }}
                                                onChange={async e => {
                                                  const file = e.target.files[0]
                                                  e.target.value = ''
                                                  if (!file) return
                                                  const url = await uploadImage(file)
                                                  if (url) updateCompraField(c, 'image_url', url)
                                                }}
                                              />
                                            </label>
                                          )}
                                        </td>
                                        <td style={{ padding: 2, border: '1px solid #ddd', whiteSpace: 'normal', maxWidth: 60, wordBreak: 'break-word' }}>
                                          {editing ? <input value={lineDraft.plant_name ?? compraNombre(c)} onChange={e => setLineDraft(c.id, 'plant_name', e.target.value)} style={{ width: 60, fontSize: 11 }} /> : compraNombre(c)}
                                        </td>
                                        <td style={{ padding: 2, border: '1px solid #ddd', textAlign: 'center', whiteSpace: 'nowrap' }}>
                                          {editing ? <input type="number" value={lineDraft.quantity ?? c.quantity} onChange={e => setLineDraft(c.id, 'quantity', e.target.value)} style={{ width: 34, fontSize: 11 }} /> : c.quantity}
                                        </td>
                                        <td style={{ padding: 2, border: '1px solid #ddd', textAlign: 'right', whiteSpace: 'nowrap' }}>
                                          {editing ? <input type="number" step="0.01" value={lineDraft.unit_cost ?? c.unit_cost} onChange={e => setLineDraft(c.id, 'unit_cost', e.target.value)} style={{ width: 48, fontSize: 11 }} /> : `$${Number(c.unit_cost).toFixed(2)}`}
                                        </td>
                                        <td style={{ padding: 2, border: '1px solid #ddd', textAlign: 'right', whiteSpace: 'nowrap' }}>${c._value.toFixed(2)}</td>
                                        <td style={{ padding: 2, border: '1px solid #ddd', textAlign: 'right', whiteSpace: 'nowrap' }}>${c._prorated.toFixed(2)}</td>
                                        <td style={{ padding: 2, border: '1px solid #ddd', textAlign: 'right', whiteSpace: 'nowrap' }}>${c._lineTotal.toFixed(2)}</td>
                                        <td style={{ padding: 2, border: '1px solid #ddd', textAlign: 'center', whiteSpace: 'nowrap' }}>
                                          <StatusChecklist
                                            steps={[{ key: 'pedido', label: 'Pedido' }, { key: 'pagado', label: 'Pagado' }, { key: 'recibido', label: 'Recibido' }]}
                                            values={{ pedido: true, pagado: pagadoDe(c), recibido: recibidoDe(c) }}
                                            onToggle={(flag, val) => toggleCompraFlag(c, flag, val)}
                                            disabled={approvingIds.includes(c.id)}
                                            anticipo={Number(c.anticipo) || 0}
                                            onAnticipoSave={val => updateCompraAnticipo(c, val)}
                                          />
                                        </td>
                                      </tr>
                                      )
                                    })}
                                  </tbody>
                                  <tfoot>
                                    <tr><td colSpan={4} style={{ padding: '3px 2px', border: '1px solid #ddd', whiteSpace: 'nowrap' }}>Subtotal</td><td colSpan={4} style={{ padding: '3px 2px', border: '1px solid #ddd', textAlign: 'right', whiteSpace: 'nowrap' }}>${subtotal.toFixed(2)}</td></tr>
                                    <tr><td colSpan={4} style={{ padding: '3px 2px', border: '1px solid #ddd', whiteSpace: 'nowrap' }}>Envío 1</td><td colSpan={4} style={{ padding: '3px 2px', border: '1px solid #ddd', textAlign: 'right', whiteSpace: 'nowrap' }}>{editing ? <input type="number" step="0.01" value={loteDraft.envio1 ?? (lote.envio1 || 0)} onChange={e => setLoteDraftField(lote.id, 'envio1', e.target.value)} style={{ width: 70, fontSize: 11 }} /> : `$${Number(lote.envio1 || 0).toFixed(2)}`}</td></tr>
                                    <tr><td colSpan={4} style={{ padding: '3px 2px', border: '1px solid #ddd', whiteSpace: 'nowrap' }}>Envío 2</td><td colSpan={4} style={{ padding: '3px 2px', border: '1px solid #ddd', textAlign: 'right', whiteSpace: 'nowrap' }}>{editing ? <input type="number" step="0.01" value={loteDraft.envio2 ?? (lote.envio2 || 0)} onChange={e => setLoteDraftField(lote.id, 'envio2', e.target.value)} style={{ width: 70, fontSize: 11 }} /> : `$${Number(lote.envio2 || 0).toFixed(2)}`}</td></tr>
                                    <tr><td colSpan={4} style={{ padding: '3px 2px', border: '1px solid #ddd', whiteSpace: 'nowrap' }}>Varios</td><td colSpan={4} style={{ padding: '3px 2px', border: '1px solid #ddd', textAlign: 'right', whiteSpace: 'nowrap' }}>{editing ? <input type="number" step="0.01" value={loteDraft.varios ?? (lote.varios || 0)} onChange={e => setLoteDraftField(lote.id, 'varios', e.target.value)} style={{ width: 70, fontSize: 11 }} /> : `$${Number(lote.varios || 0).toFixed(2)}`}</td></tr>
                                    <tr style={{ background: '#f3ecdd' }}><td colSpan={4} style={{ padding: '3px 2px', border: '1px solid #ddd' }}><strong>Total</strong></td><td colSpan={4} style={{ padding: '3px 2px', border: '1px solid #ddd', textAlign: 'right' }}><strong>${totalLote.toFixed(2)}</strong></td></tr>
                                  </tfoot>
                                </table>
                              </div>

                              <div className="admin-item-actions" style={{ marginTop: 8 }}>
                                {lineas.some(c => c.status === 'pedido') && (
                                  <button onClick={() => markLotePagado(lote.id)} disabled={lineas.some(c => approvingIds.includes(c.id))}>
                                    Marcar toda la compra como pagada
                                  </button>
                                )}
                                {lineas.some(c => c.status === 'pagado') && (
                                  <button onClick={() => markLoteRecibido(lote.id)} disabled={lineas.some(c => approvingIds.includes(c.id))}>
                                    Marcar toda la compra como recibida
                                  </button>
                                )}
                                <button onClick={() => openLoteNote(lote)}>
                                  📝 {(lote.content_blocks && lote.content_blocks.length > 0) ? 'Editar nota de la compra' : 'Agregar nota de la compra'}
                                </button>
                                <button onClick={() => setAddToLoteId(addToLoteId === lote.id ? null : lote.id)}>
                                  ➕ Agregar planta
                                </button>
                                <button onClick={() => sendCompraInvoiceWhatsApp(lote, lineasConProrrateo, subtotal, totalLote)}>
                                  💬 Enviar factura por WhatsApp
                                </button>
                                <button onClick={() => deleteLote(lote.id)} className="danger">
                                  🗑️ Eliminar compra
                                </button>
                              </div>
                              {addToLoteId === lote.id && (
                                <div className="admin-form" style={{ marginTop: 8 }}>
                                  <h4>Agregar planta olvidada a esta compra</h4>
                                  <select className="gallery-select" value={loteLinePlantCategory} onChange={e => setLoteLinePlantCategory(e.target.value)}>
                                    <option value="all">Todas las categorías</option>
                                    {categories.map(c => <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>)}
                                  </select>
                                  <input
                                    className="order-search"
                                    placeholder="Buscar planta por nombre..."
                                    value={loteLinePlantSearch}
                                    onChange={e => setLoteLinePlantSearch(e.target.value)}
                                  />
                                  {(loteLinePlantSearch.trim() || loteLinePlantCategory !== 'all') ? (
                                    <PlantPicker
                                      list={plants
                                        .filter(p => loteLinePlantCategory === 'all' || p.category_id === loteLinePlantCategory)
                                        .filter(p => p.name.toLowerCase().includes(loteLinePlantSearch.trim().toLowerCase()))}
                                      selectedId={addToLoteForm.plant_id}
                                      onSelect={id => setAddToLoteForm({ ...addToLoteForm, plant_id: id, new_plant_name: '', new_plant_category: '' })}
                                    />
                                  ) : (
                                    <p className="status-msg" style={{ margin: '4px 0' }}>
                                      {addToLoteForm.plant_id ? `✓ ${plants.find(p => p.id === addToLoteForm.plant_id)?.name || ''}` : 'Elige una categoría o escribe para buscar'}
                                    </p>
                                  )}
                                  <p style={{ margin: '4px 0', fontSize: '0.8rem', color: '#6b6b5f' }}>— o registra una planta nueva —</p>
                                  <input placeholder="Nombre de planta nueva" value={addToLoteForm.new_plant_name} onChange={e => setAddToLoteForm({ ...addToLoteForm, plant_id: '', new_plant_name: e.target.value })} />
                                  <select value={addToLoteForm.new_plant_category} onChange={e => setAddToLoteForm({ ...addToLoteForm, new_plant_category: e.target.value })}>
                                    <option value="">Selecciona categoría</option>
                                    {assignableCategories().map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                  </select>
                                  <input placeholder="Cantidad" type="number" value={addToLoteForm.quantity} onChange={e => setAddToLoteForm({ ...addToLoteForm, quantity: e.target.value })} />
                                  <input placeholder="Precio de compra (opcional)" type="number" step="0.01" value={addToLoteForm.unit_cost} onChange={e => setAddToLoteForm({ ...addToLoteForm, unit_cost: e.target.value })} />
                                  <input placeholder="Precio de venta (opcional)" type="number" step="0.01" value={addToLoteForm.sale_price} onChange={e => setAddToLoteForm({ ...addToLoteForm, sale_price: e.target.value })} />
                                  <input type="file" accept="image/*" onChange={e => setAddToLoteForm({ ...addToLoteForm, file: e.target.files[0] })} />
                                  <div className="admin-item-actions">
                                    <button type="button" onClick={() => saveAddToLote(lote)} disabled={savingAddToLote}>
                                      {savingAddToLote ? 'Guardando...' : 'Guardar planta'}
                                    </button>
                                    <button type="button" onClick={() => setAddToLoteId(null)}>Cancelar</button>
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        )
                      })}
                      {comprasSinLote.map(c => (
                        <div key={c.id} className="admin-item">
                          {c.image_url ? <img src={c.image_url} alt={compraNombre(c)} /> : <div className="no-img-sm">Sin foto</div>}
                          <div className="admin-item-info">
                            <input
                              key={`${c.id}-${compraNombre(c)}`}
                              defaultValue={compraNombre(c)}
                              onBlur={e => updateCompraField(c, 'plant_name', e.target.value)}
                              style={{ fontWeight: 'bold', fontSize: '1rem', width: '100%', boxSizing: 'border-box' }}
                            />
                            <label>Procedencia: <input defaultValue={c.proveedor || ''} onBlur={e => updateCompraField(c, 'proveedor', e.target.value)} /></label>
                            <span className={`order-badge order-${c.status}`}>{c.status}</span>
                            <span>Pedido: {new Date(c.created_at).toLocaleDateString()}</span>
                            {c.fecha_pago && <span>Pagado: {new Date(c.fecha_pago).toLocaleDateString()}</span>}
                            {c.fecha_recibido && <span>Recibido: {new Date(c.fecha_recibido).toLocaleDateString()}</span>}
                            <div className="admin-item-controls">
                              <label>Cant.: <input type="number" defaultValue={c.quantity} onBlur={e => updateCompraField(c, 'quantity', e.target.value)} /></label>
                              <label>Costo: $<input type="number" step="0.01" defaultValue={c.unit_cost} onBlur={e => updateCompraField(c, 'unit_cost', e.target.value)} /></label>
                              <label>Venta: $<input type="number" step="0.01" defaultValue={c.sale_price ?? ''} onBlur={e => updateCompraField(c, 'sale_price', e.target.value)} /></label>
                            </div>
                            <span>Total compra: ${Number(c.total).toFixed(2)}</span>
                            <div className="admin-item-actions">
                              {c.status === 'pedido' && (
                                <button onClick={() => toggleCompraFlag(c, 'pagado', true)} disabled={approvingIds.includes(c.id)}>
                                  {approvingIds.includes(c.id) ? 'Procesando...' : 'Marcar como pagado'}
                                </button>
                              )}
                              {c.status === 'pagado' && (
                                <button onClick={() => toggleCompraFlag(c, 'recibido', true)} disabled={approvingIds.includes(c.id)}>
                                  {approvingIds.includes(c.id) ? 'Procesando...' : 'Marcar como recibido'}
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>

                    {loteNoteModalOpen && createPortal(
                      <div className="admin-sheet-overlay" style={{ position: 'fixed', inset: 0, zIndex: 3000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <div className="free-note-modal" onClick={e => e.stopPropagation()}>
                          <div className="free-note-modal-header">
                            <h4>Nota de la compra #{lotes.find(l => l.id === currentNoteLoteId)?.numero || ''}</h4>
                            <button
                              type="button"
                              className="modal-close-btn"
                              onClick={() => {
                                const hasUnsaved = loteNoteCurrentText.trim().length > 0
                                if (hasUnsaved && !confirm('¿Cerrar sin guardar? Perderás lo que escribiste.')) return
                                setLoteNoteModalOpen(false)
                              }}
                            >✕</button>
                          </div>
                          <div className="free-note-sheet">
                            {loteNoteBlocks.map((b, i) => (
                              <div key={i} className="note-sheet-block">
                                {b.type === 'text' && <p>{b.content}</p>}
                                {b.type === 'photo' && <img src={b.url || URL.createObjectURL(b.file)} alt="" className="note-sheet-photo" />}
                                {b.type === 'video' && (
                                  <video src={b.url || URL.createObjectURL(b.file)} controls className="note-video" />
                                )}
                              </div>
                            ))}
                            <textarea
                              className="note-sheet-textarea"
                              placeholder={loteNoteBlocks.length > 0 ? 'Sigue escribiendo...' : 'Escribe cómo fue esta compra...'}
                              rows={loteNoteBlocks.length > 0 ? 2 : 4}
                              value={loteNoteCurrentText}
                              onChange={e => setLoteNoteCurrentText(e.target.value)}
                              autoFocus
                            />
                            <div className="note-sheet-toolbar">
                              <label className="icon-btn" title="Elegir foto de galería">
                                🖼️
                                <input
                                  type="file"
                                  accept="image/*"
                                  style={{ display: 'none' }}
                                  onChange={e => { insertPhotoBlockToLoteNote(e.target.files[0]); e.target.value = '' }}
                                />
                              </label>
                              <label className="icon-btn" title="Tomar foto">
                                📷
                                <input
                                  type="file"
                                  accept="image/*"
                                  capture="environment"
                                  style={{ display: 'none' }}
                                  onChange={e => { insertPhotoBlockToLoteNote(e.target.files[0]); e.target.value = '' }}
                                />
                              </label>
                              <label className="icon-btn" title="Insertar video aquí">
                                🎥
                                <input
                                  type="file"
                                  accept="video/*"
                                  style={{ display: 'none' }}
                                  onChange={e => { insertVideoBlockToLoteNote(e.target.files[0]); e.target.value = '' }}
                                />
                              </label>
                              {loteNoteBlocks.length > 0 && (
                                <button type="button" className="icon-btn-text" onClick={removeLastLoteNoteBlock}>Deshacer</button>
                              )}
                              <button
                                type="button"
                                className="icon-btn"
                                title="Compartir por WhatsApp"
                                disabled={sharingNotes}
                                onClick={() => shareLoteNote(lotes.find(l => l.id === currentNoteLoteId))}
                              >
                                📲
                              </button>
                              <button type="button" className="save-note-btn-inline" onClick={saveLoteNote} disabled={savingLoteNote}>
                                {savingLoteNote ? 'Guardando...' : 'Guardar'}
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>,
                      document.body
                    )}

                    {facturaScanOpen && createPortal(
                      <div className="admin-sheet-overlay" onClick={() => setFacturaScanOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 3000 }}>
                        <div className="admin-sheet" onClick={e => e.stopPropagation()} style={{ maxWidth: 600 }}>
                          <div className="admin-sheet-header">
                            <button className="admin-sheet-back" onClick={() => setFacturaScanOpen(false)}>← Cancelar</button>
                            <h2>📷 Revisar factura escaneada</h2>
                          </div>
                          <div className="admin-sheet-body" style={{ overflow: 'visible', maxHeight: 'none', height: 'auto' }}>
                            <p style={{ fontSize: '0.8rem', color: '#8a8a7a', marginTop: 0 }}>
                              Revisa y corrige los datos antes de guardar. Si un producto ya existe en tu catálogo (aunque cambien tildes, mayúsculas o comillas) se vincula a esa planta, sin duplicarla ni tocar sus fotos y notas. Revisa la línea de estado bajo cada producto.
                            </p>

                            <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: 2 }}>Proveedor</label>
                            <input
                              value={facturaData.proveedor}
                              onChange={e => updateFacturaField('proveedor', e.target.value)}
                              style={{ width: '100%', boxSizing: 'border-box', padding: 10, borderRadius: 6, border: '1px solid #ccc', marginBottom: 10 }}
                            />

                            <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: 2 }}>Fecha de la compra</label>
                            <input
                              type="date"
                              value={facturaData.fecha || ''}
                              onChange={e => updateFacturaField('fecha', e.target.value)}
                              style={{ width: '100%', boxSizing: 'border-box', padding: 10, borderRadius: 6, border: '1px solid #ccc', marginBottom: 14 }}
                            />

                            <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: 6 }}>Productos detectados</label>
                            {(() => {
                              const plantasOrdenadas = [...plants].sort((a, b) => String(a.name).localeCompare(String(b.name), 'es', { numeric: true, sensitivity: 'base' }))
                              return facturaData.items.map((item, idx) => {
                                const enlazada = item.plant_id ? plants.find(p => p.id === item.plant_id) : null
                                const sugeridas = enlazada ? [] : buscarPlantaParecida(item.nombre, plants).parecidas
                                return (
                                  <div key={idx} style={{ marginBottom: 12, paddingBottom: 8, borderBottom: '1px solid rgba(0,0,0,0.08)' }}>
                                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                                      <input
                                        placeholder="Nombre del producto"
                                        value={item.nombre}
                                        onChange={e => updateFacturaItem(idx, 'nombre', e.target.value)}
                                        style={{ flex: '2 1 140px', padding: 8, borderRadius: 6, border: '1px solid #ccc', boxSizing: 'border-box' }}
                                      />
                                      <input
                                        type="number"
                                        placeholder="Cant."
                                        value={item.cantidad}
                                        onChange={e => updateFacturaItem(idx, 'cantidad', e.target.value)}
                                        style={{ flex: '1 1 60px', padding: 8, borderRadius: 6, border: '1px solid #ccc', boxSizing: 'border-box' }}
                                      />
                                      <input
                                        type="number"
                                        placeholder="P. Unit"
                                        value={item.precio_unitario}
                                        onChange={e => updateFacturaItem(idx, 'precio_unitario', e.target.value)}
                                        style={{ flex: '1 1 70px', padding: 8, borderRadius: 6, border: '1px solid #ccc', boxSizing: 'border-box' }}
                                      />
                                      <button type="button" className="danger" onClick={() => removeFacturaItem(idx)}>🗑️</button>
                                    </div>
                                    <div style={{ marginTop: 4, fontSize: '0.78rem', fontWeight: 600, color: enlazada ? '#2F5C3A' : '#7a6a2a' }}>
                                      {enlazada ? `🔗 Se vincula a tu planta existente: ${enlazada.name}` : '🆕 Se creará como planta nueva'}
                                    </div>
                                    {sugeridas.length > 0 && (
                                      <div style={{ marginTop: 4, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', fontSize: '0.78rem' }}>
                                        <span>¿Es alguna de estas?</span>
                                        {sugeridas.map(sg => (
                                          <button key={sg.id} type="button" onClick={() => updateFacturaItem(idx, 'plant_id', sg.id)}
                                            style={{ padding: '4px 10px', borderRadius: 14, border: '1px solid #6E8161', background: '#fff', color: '#4B5A46', cursor: 'pointer', fontSize: '0.78rem' }}>
                                            🔗 {sg.name}
                                          </button>
                                        ))}
                                      </div>
                                    )}
                                    <select
                                      value={item.plant_id || ''}
                                      onChange={e => updateFacturaItem(idx, 'plant_id', e.target.value)}
                                      style={{ width: '100%', marginTop: 4, padding: 6, borderRadius: 6, border: '1px solid #ccc', fontSize: '0.8rem', boxSizing: 'border-box' }}
                                    >
                                      <option value="">🆕 Crear como planta nueva</option>
                                      {plantasOrdenadas.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                                    </select>
                                  </div>
                                )
                              })
                            })()}
                            <button type="button" onClick={addFacturaItem} style={{ marginBottom: 14 }}>➕ Agregar producto</button>

                            <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: 2 }}>Envío / delivery (opcional)</label>
                            <input
                              type="number"
                              placeholder="0.00"
                              value={facturaData.envio}
                              onChange={e => updateFacturaField('envio', e.target.value)}
                              style={{ width: '100%', boxSizing: 'border-box', padding: 10, borderRadius: 6, border: '1px solid #ccc', marginBottom: 10 }}
                            />

                            {(facturaData.subtotal || facturaData.total) && (
                              <p style={{ fontSize: '0.8rem', color: '#8a8a7a' }}>
                                Detectado en la factura — Subtotal: {facturaData.subtotal || '—'} · Total: {facturaData.total || '—'}
                                {' '}(referencia; el total real de la compra en el panel se calcula por producto).
                              </p>
                            )}

                            <div className="admin-item-actions" style={{ marginTop: 10 }}>
                              <button type="button" onClick={saveFacturaCompra} disabled={savingFactura}>
                                {savingFactura ? 'Guardando...' : 'Guardar compra'}
                              </button>
                              <button type="button" onClick={() => setFacturaScanOpen(false)}>Cancelar</button>
                            </div>
                          </div>
                        </div>
                      </div>,
                      document.body
                    )}
                    </>
                    )}

                    {ingresosSubTab === 'semillas' && (
                      <div className="seed-batches-tab">
                        {!sbFormOpen ? (
                          <button
                            type="button"
                            className="full-form-btn"
                            onClick={() => { resetSbForm(); setSbFormOpen(true) }}
                            style={{ background: '#4a5d3a', color: '#fff', border: 'none', padding: '14px 22px', borderRadius: 8, fontSize: '1.05rem', fontWeight: 700, boxShadow: '0 3px 6px rgba(0,0,0,0.2)', marginBottom: 14 }}
                          >
                            🌰 Nuevo ingreso de semillas
                          </button>
                        ) : (
                          <div className="seed-form" style={{ marginBottom: 16 }}>
                            <h4 style={{ margin: '0 0 4px', color: 'var(--sage-dark)' }}>🌰 Nuevo ingreso de semillas</h4>
                            <select value={sbForm.origen} onChange={e => setSbForm({ ...sbForm, origen: e.target.value, plant_id: '' })}>
                              <option value="cosecha">🌱 Cosecha de mi planta</option>
                              <option value="compra">🛒 Compra a proveedor</option>
                            </select>

                            {sbForm.origen === 'cosecha' && (
                              <select value={sbForm.plant_id} onChange={e => onSbFormPlantChange(e.target.value)}>
                                <option value="">Elige la planta...</option>
                                {plants.map(pl => (
                                  <option key={pl.id} value={pl.id}>{pl.name}</option>
                                ))}
                              </select>
                            )}

                            {sbForm.origen === 'compra' && (
                              <input
                                placeholder="Proveedor"
                                value={sbForm.proveedor}
                                onChange={e => setSbForm({ ...sbForm, proveedor: e.target.value })}
                              />
                            )}

                            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.85rem', color: 'var(--dark)' }}>
                              <input
                                type="checkbox"
                                checked={sbForm.es_noid}
                                onChange={e => setSbForm({ ...sbForm, es_noid: e.target.checked, category_id: e.target.checked ? '' : sbForm.category_id })}
                              />
                              No sé qué es todavía (NOID)
                            </label>

                            {!sbForm.es_noid && (
                              <>
                                <input
                                  placeholder="Nombre (opcional por ahora)"
                                  value={sbForm.nombre}
                                  onChange={e => setSbForm({ ...sbForm, nombre: e.target.value })}
                                />
                                <select value={sbForm.category_id} onChange={e => setSbForm({ ...sbForm, category_id: e.target.value })} disabled={sbForm.origen === 'cosecha' && !!sbForm.plant_id}>
                                  <option value="">Elige categoría...</option>
                                  {categories.map(cat => (
                                    <option key={cat.id} value={cat.id}>{cat.emoji} {cat.name}</option>
                                  ))}
                                </select>
                              </>
                            )}

                            <input
                              type="number"
                              placeholder="Cantidad de semillas"
                              value={sbForm.cantidad_semillas}
                              onChange={e => setSbForm({ ...sbForm, cantidad_semillas: e.target.value })}
                            />
                            <label className="seed-form-field-label">
                              Fecha
                              <input
                                type="date"
                                value={sbForm.fecha || localDateISO()}
                                onChange={e => setSbForm({ ...sbForm, fecha: e.target.value })}
                              />
                            </label>
                            <input
                              type="number"
                              step="0.01"
                              placeholder="Precio de venta (opcional, para vender las semillas)"
                              value={sbForm.price}
                              onChange={e => setSbForm({ ...sbForm, price: e.target.value })}
                            />
                            <label className="seed-form-field-label">
                              📷 Foto (opcional, es la que se ve en Galería)
                              <input type="file" accept="image/*" onChange={e => setSbFormFile(e.target.files[0] || null)} />
                            </label>
                            {sbFormFile && <img src={URL.createObjectURL(sbFormFile)} alt="" style={{ width: 90, height: 90, objectFit: 'cover', borderRadius: 8 }} />}
                            <div className="admin-item-actions">
                              <button type="button" onClick={saveSeedBatch}>Guardar</button>
                              <button type="button" onClick={() => setSbFormOpen(false)}>Cancelar</button>
                            </div>
                          </div>
                        )}

                        {seedBatches.length === 0 ? (
                          <p className="status-msg">Todavía no has registrado ningún lote de semillas.</p>
                        ) : (
                          <div className="admin-list">
                            {seedBatches.map(batch => {
                              const categoria = categories.find(c => c.id === batch.category_id)
                              const plantaOrigen = plants.find(p => p.id === batch.plant_id)
                              const converting = sbConvertId === batch.id
                              const editingBatch = editingSeedBatchId === batch.id
                              return (
                                <div key={batch.id} className="admin-item lote-group collapsible-card" data-open={(openCards.has(`sb-${batch.id}`) || editingBatch) ? 'true' : 'false'} style={{ width: '100%', maxWidth: '100%', minWidth: 0, overflow: 'hidden', boxSizing: 'border-box' }}>
                                  <div className="admin-item-info" style={{ width: '100%', maxWidth: '100%', minWidth: 0, boxSizing: 'border-box' }}>
                                    <div className="card-title-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                                      <strong onClick={() => toggleCard(`sb-${batch.id}`)} style={{ flex: 1, minWidth: 0, cursor: 'pointer' }}>{(openCards.has(`sb-${batch.id}`) || editingBatch) ? '▾' : '▸'} 🌰 {batch.es_noid ? 'NOID' : (batch.nombre || 'Sin nombre')}{categoria ? ` · ${categoria.emoji} ${categoria.name}` : ''}</strong>
                                      <button type="button" onClick={() => setEditingSeedBatchId(editingBatch ? null : batch.id)}>
                                        {editingBatch ? '✅ Listo' : '✏️ Editar'}
                                      </button>
                                    </div>
                                    {editingBatch ? (
                                      <>
                                        <label>Nombre: <input defaultValue={batch.nombre || ''} onBlur={e => updateSeedBatchField(batch.id, 'nombre', e.target.value)} /></label>
                                        <label>
                                          Categoría:{' '}
                                          <select defaultValue={batch.category_id || ''} onChange={e => updateSeedBatchField(batch.id, 'category_id', e.target.value || null)}>
                                            <option value="">Sin categoría</option>
                                            {assignableCategories().map(cat => (
                                              <option key={cat.id} value={cat.id}>{cat.emoji} {cat.name}</option>
                                            ))}
                                          </select>
                                        </label>
                                        <label>
                                          NOID:{' '}
                                          <input type="checkbox" defaultChecked={batch.es_noid} onChange={e => updateSeedBatchField(batch.id, 'es_noid', e.target.checked)} />
                                        </label>
                                        {batch.origen === 'compra' && (
                                          <label>Proveedor: <input defaultValue={batch.proveedor || ''} onBlur={e => updateSeedBatchField(batch.id, 'proveedor', e.target.value)} /></label>
                                        )}
                                        <label>Fecha: <input type="date" defaultValue={batch.fecha} onChange={e => updateSeedBatchField(batch.id, 'fecha', e.target.value)} /></label>
                                      </>
                                    ) : (
                                      <>
                                        <span>{batch.origen === 'cosecha' ? `Cosecha de ${plantaOrigen?.name || 'planta'}` : `Compra${batch.proveedor ? ` a ${batch.proveedor}` : ''}`}</span>
                                        <span>Fecha: {new Date(batch.fecha + 'T00:00:00').toLocaleDateString()}</span>
                                      </>
                                    )}

                                    <p style={{ fontSize: '0.7rem', color: '#8a8a7a', margin: '8px 0 2px', textAlign: 'center' }}>◀ Deslizá la tabla para ver más columnas ▶</p>
                                    <div style={{ width: '100%', maxWidth: '100%', minWidth: 0, overflowX: 'auto', WebkitOverflowScrolling: 'touch', touchAction: 'pan-x pan-y', marginTop: 2, borderRadius: 8, border: '1px solid #ddd', boxShadow: '0 1px 2px rgba(0,0,0,0.06)', boxSizing: 'border-box' }}>
                                      <table className="invoice-table" style={{ borderCollapse: 'collapse', width: '100%', minWidth: 380, fontSize: 11 }}>
                                        <thead>
                                          <tr style={{ background: '#f3ecdd' }}>
                                            <th style={{ padding: '3px 2px', border: '1px solid #ddd', whiteSpace: 'nowrap' }}>Semillas</th>
                                            <th style={{ padding: '3px 2px', border: '1px solid #ddd', whiteSpace: 'nowrap' }}>Costo</th>
                                            <th style={{ padding: '3px 2px', border: '1px solid #ddd', whiteSpace: 'nowrap' }}>Estado</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          <tr>
                                            <td style={{ padding: 2, border: '1px solid #ddd', textAlign: 'center', whiteSpace: 'nowrap' }}>
                                              <input type="number" step="1" min="0" defaultValue={batch.cantidad_semillas} onBlur={e => updateSeedBatchField(batch.id, 'cantidad_semillas', Number(e.target.value) || 0)} style={{ width: 50, fontSize: 11 }} />
                                            </td>
                                            <td style={{ padding: 2, border: '1px solid #ddd', textAlign: 'center', whiteSpace: 'nowrap' }}>
                                              <input type="number" step="0.01" defaultValue={batch.costo || 0} onBlur={e => updateSeedBatchField(batch.id, 'costo', Number(e.target.value) || 0)} style={{ width: 55, fontSize: 11 }} />
                                            </td>
                                            <td style={{ padding: 2, border: '1px solid #ddd', textAlign: 'center', whiteSpace: 'nowrap' }}>
                                              <select defaultValue={batch.estado} onChange={e => updateSeedBatchField(batch.id, 'estado', e.target.value)} style={{ fontSize: 11 }}>
                                                <option value="semillas">semillas</option>
                                                <option value="sembrado">sembrado</option>
                                                <option value="en_crecimiento">en crecimiento</option>
                                                <option value="catalogado">catalogado</option>
                                              </select>
                                            </td>
                                          </tr>
                                        </tbody>
                                        <tfoot>
                                          <tr><td colSpan={1} style={{ padding: '3px 2px', border: '1px solid #ddd', whiteSpace: 'nowrap' }}>Subtotal</td><td colSpan={2} style={{ padding: '3px 2px', border: '1px solid #ddd', textAlign: 'right', whiteSpace: 'nowrap' }}>${Number(batch.costo || 0).toFixed(2)}</td></tr>
                                          <tr><td colSpan={1} style={{ padding: '3px 2px', border: '1px solid #ddd', whiteSpace: 'nowrap' }}>Envío 1</td><td colSpan={2} style={{ padding: '3px 2px', border: '1px solid #ddd', textAlign: 'right', whiteSpace: 'nowrap' }}><input type="number" step="0.01" defaultValue={batch.envio1 || 0} onBlur={e => updateSeedBatchField(batch.id, 'envio1', Number(e.target.value) || 0)} style={{ width: 60, fontSize: 11 }} /></td></tr>
                                          <tr><td colSpan={1} style={{ padding: '3px 2px', border: '1px solid #ddd', whiteSpace: 'nowrap' }}>Envío 2</td><td colSpan={2} style={{ padding: '3px 2px', border: '1px solid #ddd', textAlign: 'right', whiteSpace: 'nowrap' }}><input type="number" step="0.01" defaultValue={batch.envio2 || 0} onBlur={e => updateSeedBatchField(batch.id, 'envio2', Number(e.target.value) || 0)} style={{ width: 60, fontSize: 11 }} /></td></tr>
                                          <tr><td colSpan={1} style={{ padding: '3px 2px', border: '1px solid #ddd', whiteSpace: 'nowrap' }}>Varios</td><td colSpan={2} style={{ padding: '3px 2px', border: '1px solid #ddd', textAlign: 'right', whiteSpace: 'nowrap' }}><input type="number" step="0.01" defaultValue={batch.varios || 0} onBlur={e => updateSeedBatchField(batch.id, 'varios', Number(e.target.value) || 0)} style={{ width: 60, fontSize: 11 }} /></td></tr>
                                          <tr style={{ background: '#f3ecdd' }}><td colSpan={1} style={{ padding: '3px 2px', border: '1px solid #ddd' }}><strong>Total</strong></td><td colSpan={2} style={{ padding: '3px 2px', border: '1px solid #ddd', textAlign: 'right' }}><strong>${(Number(batch.costo || 0) + Number(batch.envio1 || 0) + Number(batch.envio2 || 0) + Number(batch.varios || 0)).toFixed(2)}</strong></td></tr>
                                        </tfoot>
                                      </table>
                                    </div>

                                    <div className="plant-quick-edit-prices" style={{ marginTop: 8 }}>
                                      <label>Venta $<input type="number" step="0.01" defaultValue={batch.price || ''} onBlur={e => updateSeedBatchField(batch.id, 'price', Number(e.target.value) || null)} /></label>
                                      <label>Stock semillas: <input type="number" defaultValue={batch.stock || 0} onBlur={e => updateSeedBatchField(batch.id, 'stock', Number(e.target.value) || 0)} /></label>
                                    </div>
                                    <div style={{ marginTop: 8, display: 'flex', width: '100%' }}>
                                      <label style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%' }}>Sembradas: <input type="number" step="1" min="0" defaultValue={batch.sembradas || 0} onBlur={e => updateSeedBatchField(batch.id, 'sembradas', Number(e.target.value) || 0)} style={{ width: 70 }} /></label>
                                    </div>
                                    <p className="status-msg" style={{ margin: '4px 0 0', fontSize: 11.5 }}>✏️ "Sembradas" es solo para corregir lotes viejos con la cuenta descuadrada — no descuenta stock por sí solo (eso ya lo hace el botón 🌱 Sembrar semillas).</p>

                                    {batch.converted_plant_id ? (
                                      <p className="status-msg" style={{ margin: '8px 0 0' }}>🪴 Ya se convirtió en planta: se vende desde la ficha de la planta.</p>
                                    ) : (
                                      <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, fontWeight: 600 }}>
                                        <input type="checkbox" checked={!!batch.en_venta} onChange={e => toggleSeedBatchEnVenta(batch, e.target.checked)} />
                                        🛒 Poner a la venta (aparece en Galería y Tabla como 🌰 Semilla)
                                      </label>
                                    )}

                                    <div className="admin-item-actions" style={{ marginTop: 8 }}>
                                      <label className="icon-btn-text" style={{ cursor: 'pointer' }}>
                                        📷 Foto
                                        <input type="file" accept="image/*" style={{ display: 'none' }} onChange={e => { addSeedBatchPhoto(batch, e.target.files[0]); e.target.value = '' }} />
                                      </label>
                                      <button type="button" onClick={() => setReplanteoForm({ batchId: batch.id, fecha: localDateISO(), texto: '', file: null })}>
                                        🪴 Replanteo
                                      </button>
                                      <button type="button" onClick={() => openSbNote(batch)}>
                                        📝 {(batch.content_blocks && batch.content_blocks.length > 0) ? 'Editar notas' : 'Agregar notas'}
                                      </button>
                                      {batch.estado !== 'catalogado' && (
                                        <button type="button" onClick={() => { if (converting) { setSbConvertId(null) } else { openConvertSeedBatch(batch) } }}>
                                          🪴 Convertir en planta
                                        </button>
                                      )}
                                      <button type="button" onClick={() => deleteSeedBatch(batch.id)} className="danger">
                                        🗑️ Eliminar
                                      </button>
                                    </div>

                                    {converting && (
                                      <div className="seed-form" style={{ marginTop: 8 }}>
                                        <h4 style={{ margin: '0 0 4px', color: 'var(--sage-dark)' }}>🪴 Convertir "{batch.es_noid ? 'NOID' : (batch.nombre || 'este lote')}" en planta</h4>
                                        <input
                                          placeholder="Nombre de la planta"
                                          value={sbConvertForm.nombre}
                                          onChange={e => setSbConvertForm({ ...sbConvertForm, nombre: e.target.value })}
                                        />
                                        <select value={sbConvertForm.category_id} onChange={e => setSbConvertForm({ ...sbConvertForm, category_id: e.target.value })}>
                                          <option value="">Elige categoría...</option>
                                          {assignableCategories().map(cat => (
                                            <option key={cat.id} value={cat.id}>{cat.emoji} {cat.name}</option>
                                          ))}
                                        </select>
                                        <input type="number" step="0.01" placeholder="Precio de venta" value={sbConvertForm.price} onChange={e => setSbConvertForm({ ...sbConvertForm, price: e.target.value })} />
                                        <input type="number" placeholder="Cuántas plantas pasan a stock" value={sbConvertForm.stock} onChange={e => setSbConvertForm({ ...sbConvertForm, stock: e.target.value })} />
                                        <div className="admin-item-actions">
                                          <button type="button" onClick={() => confirmConvertSeedBatch(batch)}>Crear planta</button>
                                          <button type="button" onClick={() => setSbConvertId(null)}>Cancelar</button>
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    )}

                    {sbNoteModalOpen && createPortal(
                      <div className="admin-sheet-overlay" style={{ position: 'fixed', inset: 0, zIndex: 3000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <div className="free-note-modal" onClick={e => e.stopPropagation()}>
                          <div className="free-note-modal-header">
                            <h4>Notas — {(() => { const b = seedBatches.find(x => x.id === currentNoteSeedBatchId); return b ? (b.es_noid ? 'NOID' : (b.nombre || 'lote de semillas')) : '' })()}</h4>
                            <button
                              type="button"
                              className="modal-close-btn"
                              onClick={() => {
                                const hasUnsaved = sbNoteCurrentText.trim().length > 0
                                if (hasUnsaved && !confirm('¿Cerrar sin guardar? Perderás lo que escribiste.')) return
                                setSbNoteModalOpen(false)
                              }}
                            >✕</button>
                          </div>
                          <div className="free-note-sheet">
                            {sbNoteBlocks.map((b, i) => (
                              <div key={i} className="note-sheet-block">
                                {(b.at || b.type === 'text') && (
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11.5, color: '#8a8a7a', marginBottom: 2 }}>
                                    <span>{formatBlockDate(b.at)}{b.editedAt ? ' · editado' : ''}</span>
                                    <span style={{ display: 'flex', gap: 8 }}>
                                      {b.type === 'text' && sbNoteEditIndex !== i && (
                                        <button type="button" onClick={() => startEditSbNoteBlock(i)} style={{ border: 'none', background: 'none', boxShadow: 'none', padding: 0, color: '#4a5d3a', cursor: 'pointer' }}>✏️ Editar</button>
                                      )}
                                      <button type="button" onClick={() => deleteSbNoteBlock(i)} style={{ border: 'none', background: 'none', boxShadow: 'none', padding: 0, color: '#b03434', cursor: 'pointer' }}>🗑</button>
                                    </span>
                                  </div>
                                )}
                                {b.type === 'text' && sbNoteEditIndex === i ? (
                                  <div>
                                    <textarea className="note-sheet-textarea" value={sbNoteEditText} onChange={e => setSbNoteEditText(e.target.value)} rows={3} autoFocus />
                                    <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                                      <button type="button" onClick={saveEditSbNoteBlock}>💾 Guardar</button>
                                      <button type="button" onClick={cancelEditSbNoteBlock}>Cancelar</button>
                                    </div>
                                  </div>
                                ) : (
                                  <>
                                    {b.type === 'text' && <p>{b.content}</p>}
                                    {b.type === 'photo' && <img src={b.url || URL.createObjectURL(b.file)} alt="" className="note-sheet-photo" />}
                                    {b.type === 'video' && (
                                      <video src={b.url || URL.createObjectURL(b.file)} controls className="note-video" />
                                    )}
                                  </>
                                )}
                              </div>
                            ))}
                            <textarea
                              className="note-sheet-textarea"
                              placeholder={sbNoteBlocks.length > 0 ? 'Sigue escribiendo...' : 'Escribe el avance de hoy...'}
                              rows={sbNoteBlocks.length > 0 ? 2 : 4}
                              value={sbNoteCurrentText}
                              onChange={e => setSbNoteCurrentText(e.target.value)}
                              autoFocus
                            />
                            {sbNoteCurrentText.trim() && (
                              <button type="button" className="icon-btn-text" onClick={commitSbNoteText} style={{ alignSelf: 'flex-start', marginBottom: 6 }}>
                                ➕ Agregar como entrada de hoy
                              </button>
                            )}
                            <div className="note-sheet-toolbar">
                              <label className="icon-btn" title="Insertar foto aquí">
                                📷
                                <input
                                  type="file"
                                  accept="image/*"
                                  style={{ display: 'none' }}
                                  onChange={e => { insertPhotoBlockToSbNote(e.target.files[0]); e.target.value = '' }}
                                />
                              </label>
                              <label className="icon-btn" title="Insertar video aquí">
                                🎥
                                <input
                                  type="file"
                                  accept="video/*"
                                  style={{ display: 'none' }}
                                  onChange={e => { insertVideoBlockToSbNote(e.target.files[0]); e.target.value = '' }}
                                />
                              </label>
                              {sbNoteBlocks.length > 0 && (
                                <button type="button" className="icon-btn-text" onClick={removeLastSbNoteBlock}>Deshacer</button>
                              )}
                              <button
                                type="button"
                                className="icon-btn"
                                title="Compartir por WhatsApp"
                                disabled={sharingNotes}
                                onClick={() => shareSbNote(seedBatches.find(b => b.id === currentNoteSeedBatchId))}
                              >
                                📲
                              </button>
                              <button type="button" className="save-note-btn-inline" onClick={saveSbNote} disabled={savingSbNote}>
                                {savingSbNote ? 'Guardando...' : 'Guardar'}
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>,
                      document.body
                    )}
                  </>
                )
              })()}

            </div>
          </div>
      </div>

      {/* ---------- HOJA IMPRIMIBLE DE ETIQUETAS (solo visible al imprimir) ---------- */}
      <div className="print-labels-sheet">
        <div className="label-grid">
          {labelItemsList().filter(p => selectedLabels.has(p.id)).flatMap(p => {
            const qty = Math.max(1, Number(labelQuantities[p.id]) || 1)
            return Array.from({ length: qty }, (_, i) => (
              <div
                key={`${p.id}-${i}`}
                className="label-card"
                style={{ width: '50mm', height: '60mm', display: 'flex', flexDirection: 'column', overflow: 'hidden', border: '0.5pt solid #ccc', boxSizing: 'border-box' }}
              >
                <span
                  className="label-name"
                  style={{ background: '#1a2e4a', color: '#fff', fontWeight: 900, textAlign: 'center', padding: '2.5mm 1mm', fontSize: '14pt', lineHeight: 1.1, textTransform: 'uppercase', letterSpacing: '0.5px', textShadow: '1px 1px 0 rgba(0,0,0,0.4)' }}
                >
                  {p.name}
                </span>
                {p.image_url
                  ? <img src={p.image_url} alt={p.name} className="label-photo" style={{ flex: 1, width: '100%', objectFit: 'cover' }} />
                  : <div className="label-photo label-no-img" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Sin foto</div>}
              </div>
            ))
          })}
        </div>
      </div>

      {/* ---------- Revisar cantidades y construir el PDF ---------- */}
      {labelQtyModalOpen && createPortal(
        (() => {
          const items = labelItemsList().filter(p => selectedLabels.has(p.id))
          const isPdf = pendingLabelAction === 'pdf'
          const idOf = id => labelQuantities[id] ?? 1
          const nameOf = id => labelNameQuantities[id] ?? 1
          const totalId = items.reduce((sum, p) => sum + idOf(p.id), 0)
          const totalName = items.reduce((sum, p) => sum + nameOf(p.id), 0)
          const stepBtn = { width: 28, height: 34, minHeight: 0, padding: 0, border: 'none', background: '#F3ECDD', boxShadow: 'none', borderRadius: 0, fontSize: 12, color: '#5B4636', cursor: 'pointer', flex: '0 0 auto' }
          // Contador con flechitas: ▼ baja, ▲ sube (también se puede escribir el número)
          const stepper = (value, min, onChange) => (
            <span style={{ display: 'inline-flex', alignItems: 'stretch', width: 94, border: '1px solid #d8cfb8', borderRadius: 8, overflow: 'hidden', background: '#fff', flex: '0 0 auto' }}>
              <button type="button" aria-label="Menos" onClick={() => onChange(Math.max(min, value - 1))} style={stepBtn}>▼</button>
              <input
                type="number"
                inputMode="numeric"
                className="stepper-input"
                min={min}
                value={value}
                onChange={e => onChange(Math.max(min, Math.floor(Number(e.target.value) || 0)))}
                style={{ flex: 1, minWidth: 0, width: 36, textAlign: 'center', border: 'none', outline: 'none', padding: 0, minHeight: 0, boxShadow: 'none', background: 'transparent', fontSize: 15 }}
              />
              <button type="button" aria-label="Más" onClick={() => onChange(value + 1)} style={stepBtn}>▲</button>
            </span>
          )
          const aplicarATodas = (tipo, v) => {
            setLabelBulk(b => ({ ...b, [tipo]: v }))
            if (tipo === 'id') setLabelQuantities(prev => { const next = { ...prev }; items.forEach(p => { next[p.id] = v }); return next })
            else setLabelNameQuantities(prev => { const next = { ...prev }; items.forEach(p => { next[p.id] = v }); return next })
          }
          const colHead = txt => <span style={{ width: 94, textAlign: 'center', fontSize: 12, fontWeight: 700, color: '#7a7060', flex: '0 0 auto' }}>{txt}</span>
          return (
            <div
              className="admin-sheet-overlay"
              onClick={() => closeLabelModal()}
              style={{ position: 'fixed', inset: 0, zIndex: 3000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              <style>{`.stepper-input::-webkit-outer-spin-button,.stepper-input::-webkit-inner-spin-button{-webkit-appearance:none;margin:0}.stepper-input{-moz-appearance:textfield}`}</style>
              <div className="free-note-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 460, width: '100%', maxHeight: '86vh', display: 'flex', flexDirection: 'column' }}>
                <div className="free-note-modal-header">
                  <h4>🔖 Etiquetas ({items.length})</h4>
                  <button type="button" className="modal-close-btn" onClick={() => closeLabelModal()}>✕</button>
                </div>

                {/* Formato (PDF o PowerPoint) y selección rápida */}
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', padding: '2px 2px 8px' }}>
                  <div style={{ display: 'inline-flex', border: '1px solid #d8cfb8', borderRadius: 10, overflow: 'hidden' }}>
                    {[['pdf', '📄 PDF'], ['pptx', '📽️ PowerPoint']].map(([k, l]) => (
                      <button key={k} type="button" onClick={() => setPendingLabelAction(k)}
                        style={{ padding: '6px 10px', fontSize: 13, minHeight: 0, lineHeight: 1.2, border: 'none', borderRadius: 0, boxShadow: 'none', background: pendingLabelAction === k ? '#E8F1E0' : '#fff', fontWeight: pendingLabelAction === k ? 700 : 500, color: '#5B4636' }}>
                        {l}
                      </button>
                    ))}
                  </div>
                  <span style={{ flex: 1 }} />
                  <button type="button" onClick={() => selectAllLabels(galleryVisibleRef.current)} style={{ padding: '6px 10px', fontSize: 13, minHeight: 0, lineHeight: 1.2, borderRadius: 8, boxShadow: 'none', whiteSpace: 'nowrap' }}>☑ Todas</button>
                  <button type="button" onClick={() => clearLabels()} style={{ padding: '6px 10px', fontSize: 13, minHeight: 0, lineHeight: 1.2, borderRadius: 8, boxShadow: 'none', whiteSpace: 'nowrap' }}>🧹 Limpiar</button>
                </div>

                {/* Encabezados de las columnas: aquí se dice una sola vez qué es cada número */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, padding: '2px 2px 4px' }}>
                  {isPdf ? (<>{colHead('🆔 Identificación')}{colHead('🔖 Etiqueta')}</>) : colHead('📽️ Copias')}
                  <span style={{ width: 28, flex: '0 0 auto' }} />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 2px 8px', borderBottom: '2px solid #E8DFC8' }}>
                  <span style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>Todas ({items.length})</span>
                  {isPdf ? (
                    <>
                      {stepper(labelBulk.id ?? 1, 0, v => aplicarATodas('id', v))}
                      {stepper(labelBulk.name ?? 1, 0, v => aplicarATodas('name', v))}
                    </>
                  ) : stepper(labelBulk.id ?? 1, 1, v => aplicarATodas('id', v))}
                  <span style={{ width: 28, flex: '0 0 auto' }} />
                </div>

                <p style={{ margin: '0 2px 6px', fontSize: 12, color: '#7a7060' }}>
                  🏷️ <b>Nº</b> = número de la etiqueta provisional en el jardín. No cambia al quitar otras plantas y vuelve a empezar en 1 cuando la lista queda vacía.
                </p>
                <div style={{ overflowY: 'auto', padding: '2px 2px' }}>
                  {items.length === 0 && <p className="status-msg">No hay plantas en la lista.</p>}
                  {[...items].sort((a, b) => (labelTemp.nums[a.id] || 1e9) - (labelTemp.nums[b.id] || 1e9)).map(p => (
                    <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 2px', borderBottom: '1px solid #eee' }}>
                      <span title="Número de la etiqueta provisional" style={{ flex: '0 0 auto', minWidth: 38, textAlign: 'center', padding: '4px 6px', borderRadius: 10, background: '#FFF1CC', border: '1px solid #E6C76A', color: '#6b4f00', fontWeight: 800, fontSize: 17, lineHeight: 1.1 }}>
                        {labelTemp.nums[p.id] ?? '·'}
                      </span>
                      {p.image_url ? (
                        <img src={p.image_url} alt="" loading="lazy" style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 8, flexShrink: 0, border: '1px solid #ddd' }} />
                      ) : (
                        <div style={{ width: 40, height: 40, borderRadius: 8, flexShrink: 0, border: '1px dashed #ccc', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, color: '#bbb' }}>🌱</div>
                      )}
                      <span style={{ flex: 1, minWidth: 0, fontSize: 14, lineHeight: 1.2, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{p.name}</span>
                      {isPdf ? (
                        <>
                          {stepper(idOf(p.id), 0, v => setLabelQuantities(prev => ({ ...prev, [p.id]: v })))}
                          {stepper(nameOf(p.id), 0, v => setLabelNameQuantities(prev => ({ ...prev, [p.id]: v })))}
                        </>
                      ) : stepper(idOf(p.id), 1, v => setLabelQuantities(prev => ({ ...prev, [p.id]: v })))}
                      <button type="button" aria-label="Quitar de la lista" title="Quitar de la lista" onClick={() => toggleLabelSelect(p.id)}
                        style={{ width: 28, flex: '0 0 auto', border: 'none', background: 'none', boxShadow: 'none', padding: 0, minHeight: 0, fontSize: 16, color: '#b03434', cursor: 'pointer' }}>✕</button>
                    </div>
                  ))}
                </div>

                {isPdf && (
                  <p style={{ margin: '8px 2px 0', fontSize: 13, color: '#5a5040', fontWeight: 600 }}>
                    {items.length} planta{items.length === 1 ? '' : 's'} · {totalId} identificaciones · {totalName} etiquetas
                  </p>
                )}
                <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                  <button type="button" onClick={() => closeLabelModal()}>Cerrar</button>
                  <button type="button" disabled={items.length === 0} onClick={() => { const ids = requireRealPlantIds(); if (ids.length) markAllPlacedForSelected(ids) }}>✅ Marcar todo colocado</button>
                  <button
                    type="button"
                    className="save-note-btn-inline"
                    disabled={items.length === 0}
                    onClick={() => {
                      setLabelQtyModalOpen(false)
                      setLabelBulk({ id: null, name: null })
                      if (pendingLabelAction === 'print') printLabels()
                      if (pendingLabelAction === 'pdf') downloadLabelsPDF(labelItemsList())
                      if (pendingLabelAction === 'pptx') downloadLabelsPPTX(labelItemsList())
                    }}
                  >
                    {isPdf ? '📄 Construir PDF' : '📽️ Construir PowerPoint'}
                  </button>
                </div>
              </div>
            </div>
          )
        })(),
        document.body
      )}

      {/* ---------- Modal de Notas (separadas de las plantas) ---------- */}
      {categoryNoteModalOpen && createPortal(
        <div className="admin-sheet-overlay" style={{ position: 'fixed', inset: 0, zIndex: 3000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="free-note-modal" onClick={e => e.stopPropagation()}>
            <div className="free-note-modal-header">
              <h4>{editingCategoryNoteId ? 'Editar nota' : 'Nueva nota'}</h4>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => {
                  const hasUnsaved = categoryNoteCurrentText.trim().length > 0
                  if (hasUnsaved && !confirm('¿Salir sin guardar el texto que estabas escribiendo?')) return
                  setCategoryNoteModalOpen(false)
                }}
              >✕</button>
            </div>
            <div className="free-note-sheet">
              <select value={categoryNoteCategoryId} onChange={e => setCategoryNoteCategoryId(e.target.value)} style={{ marginBottom: 8 }}>
                <option value="">📝 General (sin categoría)</option>
                {categories.map(c => <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>)}
              </select>
              {categoryNoteBlocks.map((b, i) => (
                <div key={i} className="note-sheet-block">
                  {(b.at || b.type === 'text') && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11.5, color: '#8a8a7a', marginBottom: 2 }}>
                      <span>{formatBlockDate(b.at)}{b.editedAt ? ' · editado' : ''}</span>
                      <span style={{ display: 'flex', gap: 8 }}>
                        {b.type === 'text' && categoryNoteEditIndex !== i && (
                          <button type="button" onClick={() => startEditCategoryNoteBlock(i)} style={{ border: 'none', background: 'none', boxShadow: 'none', padding: 0, color: '#4a5d3a', cursor: 'pointer' }}>✏️ Editar</button>
                        )}
                        <button type="button" onClick={() => deleteCategoryNoteBlock(i)} style={{ border: 'none', background: 'none', boxShadow: 'none', padding: 0, color: '#b03434', cursor: 'pointer' }}>🗑</button>
                      </span>
                    </div>
                  )}
                  {b.type === 'text' && categoryNoteEditIndex === i ? (
                    <div>
                      <textarea className="note-sheet-textarea" value={categoryNoteEditText} onChange={e => setCategoryNoteEditText(e.target.value)} rows={3} autoFocus />
                      <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                        <button type="button" onClick={saveEditCategoryNoteBlock}>💾 Guardar</button>
                        <button type="button" onClick={cancelEditCategoryNoteBlock}>Cancelar</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      {b.type === 'text' && <p>{b.content}</p>}
                      {b.type === 'photo' && <img src={b.file ? URL.createObjectURL(b.file) : b.url} alt="" className="note-sheet-photo" />}
                      {b.type === 'video' && <video src={b.file ? URL.createObjectURL(b.file) : b.url} controls className="note-video" />}
                    </>
                  )}
                </div>
              ))}
              <textarea
                className="note-sheet-textarea"
                placeholder={categoryNoteBlocks.length > 0 ? 'Sigue escribiendo...' : 'Escribe la nota...'}
                rows={categoryNoteBlocks.length > 0 ? 3 : 5}
                value={categoryNoteCurrentText}
                onChange={e => setCategoryNoteCurrentText(e.target.value)}
                autoFocus
              />
              {categoryNoteCurrentText.trim() && (
                <button type="button" className="icon-btn-text" onClick={commitCategoryNoteText} style={{ alignSelf: 'flex-start', marginBottom: 6 }}>
                  ➕ Agregar como entrada de hoy
                </button>
              )}
              <div className="note-sheet-toolbar">
                <label className="icon-btn" title="Elegir fotos de galería (puedes elegir varias)">
                  🖼️
                  <input type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={e => { insertPhotoBlockToCategoryNote(e.target.files); e.target.value = '' }} />
                </label>
                <label className="icon-btn" title="Tomar foto">
                  📷
                  <input type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={e => { insertPhotoBlockToCategoryNote(e.target.files); e.target.value = '' }} />
                </label>
                <label className="icon-btn" title="Insertar video aquí">
                  🎥
                  <input type="file" accept="video/*" style={{ display: 'none' }} onChange={e => { insertVideoBlockToCategoryNote(e.target.files[0]); e.target.value = '' }} />
                </label>
                <button
                  type="button"
                  className="icon-btn"
                  title={isDictatingCategoryNote ? 'Detener dictado' : 'Dictar por voz'}
                  onClick={toggleCategoryNoteDictation}
                  style={isDictatingCategoryNote ? { background: '#D32F2F', color: '#fff', borderRadius: '50%' } : undefined}
                >
                  {isDictatingCategoryNote ? '⏹️' : '🎤'}
                </button>
                {categoryNoteBlocks.length > 0 && (
                  <button type="button" className="icon-btn-text" onClick={removeLastCategoryNoteBlock}>Deshacer</button>
                )}
              </div>
              <button type="button" className="save-note-btn-inline" onClick={saveCategoryNote} disabled={savingCategoryNote}>
                {savingCategoryNote ? 'Guardando...' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* ---------- Selector de categoría previo a una carga masiva de fotos ---------- */}
      {bulkCategoryPickerFor && createPortal(
        <div
          className="sub-sheet-overlay"
          onClick={() => { setBulkCategoryPickerFor(null); setBulkCategorySearch('') }}
          style={{ position: 'fixed', inset: 0, zIndex: 3000, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
        >
          <div className="sub-sheet" onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 480 }}>
            <div className="sub-sheet-handle" />
            <h4 className="sub-sheet-title">¿Son de una categoría en particular?</h4>
            <div className="sub-sheet-search">
              <span>🔍</span>
              <input
                placeholder="Buscar categoría..."
                value={bulkCategorySearch}
                onChange={e => setBulkCategorySearch(e.target.value)}
                autoFocus
              />
            </div>
            <div className="sub-sheet-list">
              <div className="sub-sheet-option" style={{ cursor: 'pointer' }} onClick={() => chooseBulkCategory(null)}>
                🚩 Sin categoría (decidir después)
              </div>
              {assignableCategories()
                .filter(c => c.name.toLowerCase().includes(bulkCategorySearch.trim().toLowerCase()))
                .map(c => (
                  <div key={c.id} className="sub-sheet-option" style={{ cursor: 'pointer' }} onClick={() => chooseBulkCategory(c.id)}>
                    {c.emoji} {c.name}
                  </div>
                ))}
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>

    {/* ---------- Botones flotantes: menú ☰ y volver arriba ⬆ ---------- */}
    {showFloatNav && createPortal(
      <div style={{
        position: 'fixed', right: 14, bottom: 'calc(20px + env(safe-area-inset-bottom, 0px))', zIndex: 1500,
        display: 'flex', flexDirection: 'column', gap: 10,
      }}>
        {!isWideScreen && (
          <button
            type="button"
            aria-label="Abrir menú"
            onClick={() => setHomeMenuOpen(o => !o)}
            style={{
              width: 48, height: 48, borderRadius: '50%', border: `2px solid ${PILL_BORDER}`, background: PILL_BG,
              color: '#4a5d3a', fontSize: 20, fontWeight: 700, cursor: 'pointer', boxShadow: '0 2px 8px rgba(0,0,0,0.25)', padding: 0,
            }}
          >
            ☰
          </button>
        )}
        <button
          type="button"
          aria-label="Volver arriba"
          onClick={() => {
            window.scrollTo({ top: 0, behavior: 'smooth' })
            document.documentElement.scrollTop = 0
            document.body.scrollTop = 0
          }}
          style={{
            width: 48, height: 48, borderRadius: '50%', border: 'none', background: '#4a5d3a',
            color: '#fff', fontSize: 22, fontWeight: 700, cursor: 'pointer', boxShadow: '0 2px 8px rgba(0,0,0,0.3)', padding: 0,
          }}
        >
          ⬆
        </button>
      </div>,
      document.body
    )}
    </>
  )
}

// Error Boundary: si algo falla durante el render (por ejemplo, algo que solo
// ocurre en ciertos navegadores móviles), esto evita que toda la app quede en
// blanco y en su lugar muestra el error real en pantalla para poder diagnosticarlo.
class AdminErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null, info: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('Error al renderizar Admin:', error, info)
    this.setState({ info })
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 20, fontFamily: 'sans-serif', maxWidth: 600, margin: '0 auto' }}>
          <h2 style={{ color: '#b03434' }}>⚠️ Ocurrió un error al cargar el panel</h2>
          <p style={{ fontSize: 14 }}>
            Copiá este mensaje y compartilo para poder solucionarlo:
          </p>
          <pre style={{
            background: '#f3ecdd',
            padding: 12,
            borderRadius: 8,
            fontSize: 12,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            border: '1px solid #d8cdb0',
          }}>
            {String(this.state.error && (this.state.error.stack || this.state.error.message || this.state.error))}
          </pre>
          <button
            type="button"
            onClick={() => this.setState({ error: null, info: null })}
            style={{ marginTop: 12, background: '#4a5d3a', color: '#fff', border: 'none', padding: '10px 16px', borderRadius: 6, fontWeight: 600 }}
          >
            Reintentar
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

export default function AdminWithErrorBoundary(props) {
  return (
    <AdminErrorBoundary>
      <Admin {...props} />
    </AdminErrorBoundary>
  )
}
