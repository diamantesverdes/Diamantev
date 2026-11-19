import { Component, useState, useEffect, useRef } from 'react'
import { supabase, supabaseStorage } from './supabaseClient'
import './tailwind.css'
import AgendaVista from './AgendaVista'
import { usePendientesDiamantev, DvLista } from './enlaceDiamantev'

// Ícono de "compartir" propio (SVG), para que se vea igual en cualquier
// dispositivo/navegador -- a diferencia del emoji 📤/📲, que renderiza distinto
// según el sistema (por eso en Windows se veía como un cuadro de colores raro).
function ShareIcon({ size = 18 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      style={{ display: 'inline-block', verticalAlign: 'middle' }}
    >
      <path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92 1.61 0 2.92-1.31 2.92-2.92s-1.31-2.92-2.92-2.92z" />
    </svg>
  )
}

// Tipos de clima que se pueden registrar por día. "color" es el de las barras de las
// estadísticas; siempre van acompañadas de icono y nombre (el color solo no basta).
const WEATHER_OPTIONS = [
  { key: 'sunny', icon: '☀️', label: 'Soleado', color: '#D99A1E' },
  { key: 'cloudy', icon: '☁️', label: 'Nuboso', color: '#7F8C9B' },
  { key: 'rainy', icon: '🌧️', label: 'Lluvioso', color: '#3F7CAC' },
]
// Nombre(s) de la etiqueta que se marca sola cuando el día es lluvioso. Se compara sin
// tildes, mayúsculas ni espacios, así que "RAtras", "R Atras" o "Riego atrás" funcionan igual.
const RAIN_TAG_NAMES = ['ratras', 'riegoatras']
// Texto de la entrada automática de lluvia; también sirve para reconocerla si luego
// cambias el clima y hay que quitarla (solo se quita si no la has editado).
const RAIN_AUTO_NOTE = 'Lluvia 🌧️'

// ---------- Formato de texto en las notas ----------
// El formato se guarda dentro del propio texto con marcas simples: [b]negrita[/b], [i]cursiva[/i],
// [u]subrayado[/u] y [f=serif]tipo de letra[/f]. Así no hace falta cambiar la base de datos.
const FMT_TAG_REGEX = /\[(\/?)(b|i|u|f)(?:=([a-z]+))?\]/g
const FMT_FONTS = {
  serif: { label: 'Clásica', css: 'Georgia, "Times New Roman", serif' },
  sans: { label: 'Simple', css: 'Arial, Helvetica, sans-serif' },
  maquina: { label: 'Máquina', css: '"Courier New", Courier, monospace' },
  manuscrita: { label: 'Manuscrita', css: '"Segoe Print", "Bradley Hand", "Comic Sans MS", "Marker Felt", cursive' },
}

// Interlineado de la nota: se guarda como marca al inicio del texto, p. ej. [ls=1.9]
const LS_REGEX = /^\[ls=(\d(?:\.\d)?)\]/
const FMT_SPACING = [
  { v: '1.2', label: 'Compacto' },
  { v: '1.5', label: 'Normal' },
  { v: '1.9', label: 'Amplio' },
  { v: '2.4', label: 'Doble' },
]

function stripFormatting(s) {
  return String(s || '').replace(/^\[ls=\d(?:\.\d)?\]/, '').replace(/\[\/?(?:b|i|u)\]|\[f=[a-z]+\]|\[\/f\]/g, '')
}

// Para WhatsApp/correo: negrita y cursiva usan las marcas propias de WhatsApp (*así* y _así_).
function formatForShare(s) {
  return String(s || '').replace(/\[t\]\n?/g, '').replace(/\n?\[\/t\]/g, '').replace(/^\[ls=\d(?:\.\d)?\]/, '').replace(/\[\/?b\]/g, '*').replace(/\[\/?i\]/g, '_').replace(/\[\/?u\]|\[f=[a-z]+\]|\[\/f\]/g, '')
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// Marcas de texto → HTML (negrita, cursiva, subrayado, letra) de una sola pieza, sin tablas.
function inlineTagsToHtml(text) {
  const str = String(text || '')
  let html = ''
  const open = []
  const seg = (t) => { html += escapeHtml(t).replace(/\n/g, '<br>') }
  const re = new RegExp(FMT_TAG_REGEX.source, 'g')
  let last = 0
  let m
  while ((m = re.exec(str)) !== null) {
    const closing = m[1] === '/'
    const kind = m[2]
    if (kind === 'f' && !closing && !FMT_FONTS[m[3]]) continue
    seg(str.slice(last, m.index))
    last = m.index + m[0].length
    if (!closing) {
      const tag = kind === 'f' ? '<font face="' + FMT_FONTS[m[3]].css.replace(/"/g, '&quot;') + '">' : '<' + kind + '>'
      open.push({ kind, tag })
      html += tag
    } else {
      let idx = -1
      for (let k = open.length - 1; k >= 0; k--) { if (open[k].kind === kind) { idx = k; break } }
      if (idx === -1) continue
      const after = open.slice(idx + 1)
      for (let k = open.length - 1; k >= idx; k--) html += open[k].kind === 'f' ? '</font>' : '</' + open[k].kind + '>'
      open.length = idx
      after.forEach(o => { open.push(o); html += o.tag })
    }
  }
  seg(str.slice(last))
  for (let k = open.length - 1; k >= 0; k--) html += open[k].kind === 'f' ? '</font>' : '</' + open[k].kind + '>'
  return html
}

// Las tablas se guardan dentro del texto así (se leen bien aunque se compartan como texto):
//   [t]
//   Encabezado 1 | Encabezado 2
//   dato | dato
//   [/t]
const TABLE_SPLIT_SOURCE = '\\[t\\]\\n([\\s\\S]*?)\\n\\[\\/t\\]'

function tableToHtml(body) {
  const rows = String(body).split('\n')
  return '<table class="note-table"><tbody>' + rows.map(r =>
    '<tr>' + r.split('|').map(c => '<td>' + (inlineTagsToHtml(c.trim()) || '<br>') + '</td>').join('') + '</tr>'
  ).join('') + '</tbody></table>'
}

// Marcas de texto → HTML para mostrar dentro del editor (formato + tablas).
function tagsToHtml(text) {
  const str = String(text || '')
  if (str.indexOf('[t]') === -1) return inlineTagsToHtml(str)
  const re = new RegExp(TABLE_SPLIT_SOURCE, 'g')
  let html = ''
  let last = 0
  let m
  while ((m = re.exec(str)) !== null) {
    let before = str.slice(last, m.index)
    if (before.slice(-1) === '\n') before = before.slice(0, -1)
    html += inlineTagsToHtml(before) + tableToHtml(m[1])
    last = m.index + m[0].length
    if (str.charAt(last) === '\n') last++
  }
  const rest = str.slice(last)
  html += rest ? inlineTagsToHtml(rest) : '<div><br></div>'
  return html
}

function fontKeyFromFace(face) {
  const f = String(face || '').toLowerCase()
  if (f.includes('courier')) return 'maquina'
  if (f.includes('segoe print') || f.includes('bradley') || f.includes('comic') || f.includes('marker') || f.includes('cursive')) return 'manuscrita'
  if (f.includes('georgia') || f.includes('times')) return 'serif'
  if (f.includes('arial') || f.includes('helvetica')) return 'sans'
  return null
}

// Lo que hay en el editor → texto con marcas (lo que se guarda).
function serializeEditor(root) {
  const BLOCK = { DIV: 1, P: 1, LI: 1, UL: 1, OL: 1, TABLE: 1 }
  const isBlock = (n) => n.nodeType === 1 && BLOCK[n.tagName]

  function inl(n) {
    if (n.nodeType === 3) return n.nodeValue.replace(/ /g, ' ')
    if (n.nodeType !== 1) return ''
    if (n.tagName === 'BR') return '\n'
    let inner = ''
    n.childNodes.forEach(c => { inner += isBlock(c) ? '\n' + (c.tagName === 'TABLE' ? tableToTags(c) : ser(c)) : inl(c) })
    if (!inner) return inner
    let b = false, i = false, u = false, f = null
    const t = n.tagName
    if (t === 'B' || t === 'STRONG') b = true
    if (t === 'I' || t === 'EM') i = true
    if (t === 'U') u = true
    if (t === 'FONT' && n.getAttribute('face')) f = fontKeyFromFace(n.getAttribute('face'))
    const st = n.style
    if (st) {
      const fw = st.fontWeight
      if (fw === 'bold' || parseInt(fw, 10) >= 600) b = true
      if (st.fontStyle === 'italic') i = true
      if (String(st.textDecorationLine || st.textDecoration || '').indexOf('underline') !== -1) u = true
      if (st.fontFamily) f = fontKeyFromFace(st.fontFamily) || f
    }
    if (b) inner = '[b]' + inner + '[/b]'
    if (i) inner = '[i]' + inner + '[/i]'
    if (u) inner = '[u]' + inner + '[/u]'
    if (f) inner = '[f=' + f + ']' + inner + '[/f]'
    return inner
  }

  function tableToTags(tbl) {
    const rows = []
    tbl.querySelectorAll('tr').forEach(tr => {
      const cells = []
      tr.querySelectorAll('td,th').forEach(td => {
        cells.push(ser(td).replace(/\n+/g, ' ').replace(/\|/g, '¦').trim())
      })
      rows.push(cells.join(' | '))
    })
    return '[t]\n' + rows.join('\n') + '\n[/t]'
  }

  function ser(container) {
    const lines = []
    let cur = ''
    let hasCur = false
    container.childNodes.forEach(c => {
      if (isBlock(c)) {
        if (hasCur) { lines.push(cur); cur = ''; hasCur = false }
        if (c.tagName === 'TABLE') {
          lines.push(tableToTags(c))
        } else if (c.tagName === 'UL' || c.tagName === 'OL') {
          c.childNodes.forEach(li => { lines.push('• ' + ser(li)) })
        } else {
          let t = ser(c)
          if (c.lastChild && c.lastChild.nodeName === 'BR') t = t.replace(/\n$/, '')
          lines.push(t)
        }
      } else {
        cur += inl(c)
        hasCur = true
      }
    })
    if (hasCur) lines.push(cur)
    return lines.join('\n')
  }

  return ser(root)
}

// Casillas de verificación: ☐ (pendiente) y ☑ (hecho). Si el cursor quedó pegado a una, la cambia.
function toggleCheckAtCaret() {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return false
  const node = sel.anchorNode
  if (!node || node.nodeType !== 3) return false
  const o = sel.anchorOffset
  const text = node.nodeValue
  const idx = (text[o] === '☐' || text[o] === '☑') ? o : ((o > 0 && (text[o - 1] === '☐' || text[o - 1] === '☑')) ? o - 1 : -1)
  if (idx === -1) return false
  node.replaceData(idx, 1, text[idx] === '☐' ? '☑' : '☐')
  return true
}

// Pone (o quita) una casilla ☐ al inicio de cada línea con texto dentro de la selección.
// Sin selección actúa sobre la línea donde está el cursor. Devuelve true si cambió algo.
function applyChecklist(el, r) {
  const lines = serializeEditor(el).split('\n')
  const upTo = (node, off) => {
    const rg = document.createRange()
    rg.setStart(el, 0)
    rg.setEnd(node, off)
    const tmp = document.createElement('div')
    tmp.appendChild(rg.cloneContents())
    return serializeEditor(tmp)
  }
  const count = (t) => (t.match(/\n/g) || []).length
  let a = 0
  let z = 0
  const single = !r || r.collapsed
  if (r) {
    a = count(upTo(r.startContainer, r.startOffset))
    const s2 = upTo(r.endContainer, r.endOffset)
    z = count(s2)
    // al seleccionar líneas completas el final queda al inicio de la siguiente: no se cuenta
    if (!single && z > a && s2.slice(-1) === '\n') z--
  }
  a = Math.min(a, lines.length - 1)
  z = Math.min(Math.max(z, a), lines.length - 1)
  const idxs = []
  for (let k = a; k <= z; k++) {
    if (single || lines[k].trim() !== '') idxs.push(k)
  }
  if (idxs.length === 0) return false
  // las líneas dentro de una tabla no se tocan
  const inTable = []
  let open = false
  lines.forEach((l, k) => {
    const t = l.trim()
    if (t === '[t]') { open = true; inTable[k] = true; return }
    if (t === '[/t]') { open = false; inTable[k] = true; return }
    inTable[k] = open
  })
  for (let k = idxs.length - 1; k >= 0; k--) { if (inTable[idxs[k]]) idxs.splice(k, 1) }
  if (idxs.length === 0) return false
  const hasBox = (l) => /^[☐☑] /.test(l)
  const all = idxs.every(k => hasBox(lines[k]))
  idxs.forEach(k => {
    if (all) lines[k] = lines[k].replace(/^[☐☑] /, '')
    else if (!hasBox(lines[k])) lines[k] = '☐ ' + lines[k]
  })
  lines[idxs[idxs.length - 1]] += '\uE000'
  el.innerHTML = tagsToHtml(lines.join('\n'))
  // deja el cursor al final de la última línea cambiada
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  let n
  while ((n = walker.nextNode())) {
    const i = n.nodeValue.indexOf('\uE000')
    if (i !== -1) {
      n.deleteData(i, 1)
      try {
        const rg = document.createRange()
        rg.setStart(n, i)
        rg.collapse(true)
        const sel = window.getSelection()
        sel.removeAllRanges()
        sel.addRange(rg)
      } catch (e) { /* ignorar */ }
      break
    }
  }
  return true
}

// Registro del campo de texto que está activo: una sola barra fija al pie actúa sobre él.
const richStore = { active: null, subs: new Set(), lastSelText: '' }
function richSetActive(ref) {
  richStore.active = ref
  richStore.subs.forEach(f => f())
}

// Editor de texto con formato que se ve mientras escribes (negrita, cursiva, subrayado, tipo de letra).
// Guarda el resultado como texto con marcas, igual que antes, así no cambia la base de datos.
// Los botones de formato están en <FormatDock />, una sola barra al pie del editor.
function RichField({ value, onChange, placeholder, className, minHeight, fieldId }) {
  const ref = useRef(null)
  const lastRef = useRef(null)
  const rangeRef = useRef(null)
  const apiRef = useRef(null)
  const [lh, setLh] = useState(null)
  const lhRef = useRef(null)

  function refreshEmpty() {
    const el = ref.current
    if (el) el.setAttribute('data-empty', el.textContent === '' ? 'true' : 'false')
  }

  // Si el texto cambia desde afuera (dictado, limpiar al guardar...) se vuelve a dibujar el editor.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const v = value || ''
    if (v !== lastRef.current) {
      const lm = v.match(LS_REGEX)
      lhRef.current = lm ? lm[1] : null
      setLh(lhRef.current)
      el.innerHTML = tagsToHtml(lm ? v.slice(lm[0].length) : v)
      lastRef.current = v
      refreshEmpty()
      if (document.activeElement === el) {
        try {
          const r = document.createRange()
          r.selectNodeContents(el)
          r.collapse(false)
          const sel = window.getSelection()
          sel.removeAllRanges()
          sel.addRange(r)
        } catch (e) { /* ignorar */ }
      }
    }
  }, [value])

  // Recuerda dónde está el cursor/selección para que los botones actúen sobre eso.
  useEffect(() => {
    function onSel() {
      const el = ref.current
      const sel = window.getSelection()
      if (!el || !sel || sel.rangeCount === 0) return
      const r = sel.getRangeAt(0)
      if (el.contains(r.commonAncestorContainer)) {
        rangeRef.current = r.cloneRange()
        richStore.lastSelText = r.collapsed ? '' : sel.toString()
      }
    }
    document.addEventListener('selectionchange', onSel)
    return () => document.removeEventListener('selectionchange', onSel)
  }, [])

  useEffect(() => () => {
    if (richStore.active === apiRef) richSetActive(null)
    richStore.lastSelText = ''
  }, [])

  function emit() {
    const el = ref.current
    if (!el) return
    const v = (lhRef.current ? '[ls=' + lhRef.current + ']' : '') + serializeEditor(el)
    lastRef.current = v
    refreshEmpty()
    onChange(v)
  }

  function exec(cmd, arg) {
    const el = ref.current
    if (!el) return
    el.focus()
    const sel = window.getSelection()
    if (rangeRef.current && sel) {
      sel.removeAllRanges()
      sel.addRange(rangeRef.current)
    }
    try { document.execCommand('styleWithCSS', false, false) } catch (e) { /* ignorar */ }
    try { document.execCommand(cmd, false, arg) } catch (e) { /* ignorar */ }
    emit()
  }

  function clearFormat() {
    const el = ref.current
    if (!el) return
    const sel = window.getSelection()
    const collapsed = !rangeRef.current || rangeRef.current.collapsed
    if (collapsed) {
      // sin selección: se limpia toda la nota
      const plain = stripFormatting(serializeEditor(el))
      el.innerHTML = tagsToHtml(plain)
      emit()
      return
    }
    el.focus()
    if (sel) { sel.removeAllRanges(); sel.addRange(rangeRef.current) }
    try { document.execCommand('removeFormat', false, null) } catch (e) { /* ignorar */ }
    emit()
  }

  // Lo que la barra del pie puede pedirle a este campo (se actualiza en cada render)
  apiRef.current = {
    exec,
    clearFormat,
    checklist: () => {
      const el = ref.current
      if (!el) return
      el.focus()
      if (applyChecklist(el, rangeRef.current)) emit()
    },
    setSpacing: (v) => {
      lhRef.current = v === '1.5' ? null : v
      setLh(lhRef.current)
      emit()
    },
    getLh: () => lhRef.current,
    fieldId,
    // Parte el texto de este campo en "antes" y "después" del cursor (o de la selección), para meter una foto en medio.
    splitAtCaret: () => {
      const el = ref.current
      if (!el) return null
      const marker = lhRef.current ? '[ls=' + lhRef.current + ']' : ''
      const ser = (rg) => { const t = document.createElement('div'); t.appendChild(rg.cloneContents()); return serializeEditor(t) }
      const r = rangeRef.current
      if (!r || !el.contains(r.startContainer) || !el.contains(r.endContainer)) {
        return { fieldId, before: marker + serializeEditor(el), after: '', atEnd: true }
      }
      const node = r.endContainer.nodeType === 3 ? r.endContainer.parentNode : r.endContainer
      const tbl = node && node.closest ? node.closest('table') : null
      const rgB = document.createRange()
      rgB.setStart(el, 0)
      const rgA = document.createRange()
      rgA.setEnd(el, el.childNodes.length)
      if (tbl && el.contains(tbl)) {
        rgB.setEndAfter(tbl)
        rgA.setStartAfter(tbl)
      } else {
        rgB.setEnd(r.endContainer, r.endOffset)
        rgA.setStart(r.endContainer, r.endOffset)
      }
      const trim = (t) => t.replace(/^\n+/, '').replace(/\n+$/, '')
      return { fieldId, before: marker + trim(ser(rgB)), after: marker + trim(ser(rgA)), atEnd: false }
    },
    insertTable: (r, c) => {
      const el = ref.current
      if (!el) return
      el.focus()
      const sel = window.getSelection()
      if (rangeRef.current && sel) { sel.removeAllRanges(); sel.addRange(rangeRef.current) }
      let n = sel && sel.rangeCount ? sel.anchorNode : null
      if (n && n.nodeType === 3) n = n.parentNode
      if (n && n.closest && n.closest('td')) return // no se mete una tabla dentro de otra
      const row = '<tr>' + '<td><br></td>'.repeat(c) + '</tr>'
      const html = '<table class="note-table"><tbody>' + row.repeat(r) + '</tbody></table><div><br></div>'
      try { document.execCommand('insertHTML', false, html) } catch (e) { /* ignorar */ }
      emit()
    },
    tableOp: (op) => {
      const el = ref.current
      if (!el) return
      const sel = window.getSelection()
      let n = sel && sel.rangeCount ? sel.anchorNode : null
      if ((!n || !el.contains(n)) && rangeRef.current) n = rangeRef.current.startContainer
      if (n && n.nodeType === 3) n = n.parentNode
      const td = n && n.closest ? n.closest('td') : null
      if (!td || !el.contains(td)) return
      const tr = td.parentNode
      const table = td.closest('table')
      const col = td.cellIndex
      const rows = table.rows
      const newCell = () => { const c = document.createElement('td'); c.appendChild(document.createElement('br')); return c }
      let focusCell = td
      if (op === 'addRow') {
        const nr = document.createElement('tr')
        for (let i = 0; i < tr.cells.length; i++) nr.appendChild(newCell())
        tr.parentNode.insertBefore(nr, tr.nextSibling)
        focusCell = nr.cells[col]
      } else if (op === 'addCol') {
        Array.from(rows).forEach(r => { r.insertBefore(newCell(), r.cells[col] ? r.cells[col].nextSibling : null) })
        focusCell = tr.cells[col + 1]
      } else if (op === 'delRow') {
        if (rows.length <= 1) return
        const next = rows[tr.rowIndex + 1] || rows[tr.rowIndex - 1]
        tr.parentNode.removeChild(tr)
        focusCell = next.cells[Math.min(col, next.cells.length - 1)]
      } else if (op === 'delCol') {
        if (tr.cells.length <= 1) return
        Array.from(rows).forEach(r => { if (r.cells[col]) r.removeChild(r.cells[col]) })
        focusCell = tr.cells[Math.min(col, tr.cells.length - 1)]
      } else if (op === 'delTable') {
        table.parentNode.removeChild(table)
        focusCell = null
      }
      emit()
      if (focusCell && sel) {
        try {
          const r = document.createRange()
          r.selectNodeContents(focusCell)
          r.collapse(true)
          sel.removeAllRanges()
          sel.addRange(r)
        } catch (e) { /* ignorar */ }
      }
    },
  }

  return (
    <div className="rich-field">
      <div
        ref={ref}
        className={'rich-editor ' + (className || '')}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        data-placeholder={placeholder || ''}
        style={{ minHeight: minHeight || '10em', lineHeight: lh || undefined }}
        onFocus={() => richSetActive(apiRef)}
        onInput={emit}
        onClick={() => { if (toggleCheckAtCaret()) emit() }}
        onPaste={e => {
          // Se pega solo el texto (sin colores ni letras de otras páginas)
          e.preventDefault()
          const t = (e.clipboardData || window.clipboardData).getData('text/plain')
          try { document.execCommand('insertText', false, t) } catch (err) { /* ignorar */ }
        }}
      />
    </div>
  )
}

// Texto que hay seleccionado en un editor de notas (o el último que se seleccionó), o ''.
function getSelectedEditorText() {
  try {
    const sel = window.getSelection()
    if (sel && !sel.isCollapsed && sel.rangeCount) {
      const n = sel.getRangeAt(0).commonAncestorContainer
      const el = n.nodeType === 3 ? n.parentNode : n
      if (el && el.closest && el.closest('.rich-editor')) return sel.toString().trim()
    }
  } catch (e) { /* ignorar */ }
  return String(richStore.lastSelText || '').trim()
}

// Barra de formato fija al pie del editor (una sola, sirve para el cuadro de texto donde estés escribiendo).
function FormatDock() {
  const [, setTick] = useState(0)
  const [fmt, setFmt] = useState({ b: false, i: false, u: false })
  const [panel, setPanel] = useState(null)
  const [inTable, setInTable] = useState(false)
  const [tRows, setTRows] = useState(3)
  const [tCols, setTCols] = useState(3)

  useEffect(() => {
    const refresh = () => setTick(t => t + 1)
    richStore.subs.add(refresh)
    function onSel() {
      try {
        const next = {
          b: document.queryCommandState('bold'),
          i: document.queryCommandState('italic'),
          u: document.queryCommandState('underline'),
        }
        setFmt(prev => (prev.b === next.b && prev.i === next.i && prev.u === next.u ? prev : next))
      } catch (e) { /* ignorar */ }
      try {
        const sel = window.getSelection()
        let n = sel && sel.rangeCount ? sel.anchorNode : null
        if (n && n.nodeType === 3) n = n.parentNode
        setInTable(Boolean(n && n.closest && n.closest('.rich-editor td')))
      } catch (e) { /* ignorar */ }
    }
    document.addEventListener('selectionchange', onSel)
    return () => {
      richStore.subs.delete(refresh)
      document.removeEventListener('selectionchange', onSel)
    }
  }, [])

  const api = () => (richStore.active && richStore.active.current) || null
  const ready = Boolean(api())
  const run = (fn) => { const a = api(); if (a) fn(a) }
  const keep = (e) => e.preventDefault()
  const btn = (label, onClick, title, style, on) => (
    <button
      type="button"
      className={'format-btn' + (on ? ' on' : '')}
      title={title}
      aria-label={title}
      disabled={!ready}
      onMouseDown={keep}
      onClick={onClick}
      style={style}
    >{label}</button>
  )
  const curLh = (ready && api().getLh()) || '1.5'

  return (
    <div className="format-dock">
      {inTable && (
        <div className="format-dock-row">
          <span className="format-dock-label">Tabla:</span>
          <button type="button" className="format-btn" onMouseDown={keep} onClick={() => run(a => a.tableOp('addRow'))}>＋ Fila</button>
          <button type="button" className="format-btn" onMouseDown={keep} onClick={() => run(a => a.tableOp('addCol'))}>＋ Columna</button>
          <button type="button" className="format-btn" onMouseDown={keep} onClick={() => run(a => a.tableOp('delRow'))}>－ Fila</button>
          <button type="button" className="format-btn" onMouseDown={keep} onClick={() => run(a => a.tableOp('delCol'))}>－ Columna</button>
          <button type="button" className="format-btn" onMouseDown={keep} onClick={() => { if (confirm('¿Borrar esta tabla?')) run(a => a.tableOp('delTable')) }}>🗑️ Tabla</button>
        </div>
      )}
      {panel === 'table' && !inTable && (
        <div className="format-dock-row">
          <span className="format-dock-label">Filas</span>
          <button type="button" className="format-btn" onMouseDown={keep} onClick={() => setTRows(v => Math.max(1, v - 1))}>−</button>
          <strong>{tRows}</strong>
          <button type="button" className="format-btn" onMouseDown={keep} onClick={() => setTRows(v => Math.min(20, v + 1))}>＋</button>
          <span className="format-dock-label">Columnas</span>
          <button type="button" className="format-btn" onMouseDown={keep} onClick={() => setTCols(v => Math.max(1, v - 1))}>−</button>
          <strong>{tCols}</strong>
          <button type="button" className="format-btn" onMouseDown={keep} onClick={() => setTCols(v => Math.min(6, v + 1))}>＋</button>
          <button type="button" className="format-btn on" onMouseDown={keep} onClick={() => { run(a => a.insertTable(tRows, tCols)); setPanel(null) }}>Insertar tabla</button>
        </div>
      )}
      {panel === 'fonts' && (
        <div className="format-dock-row">
          {Object.keys(FMT_FONTS).map(k => (
            <button
              key={k}
              type="button"
              className="format-btn"
              onMouseDown={keep}
              onClick={() => { run(a => a.exec('fontName', FMT_FONTS[k].css)); setPanel(null) }}
              style={{ fontFamily: FMT_FONTS[k].css }}
            >{FMT_FONTS[k].label}</button>
          ))}
        </div>
      )}
      {panel === 'spacing' && (
        <div className="format-dock-row">
          {FMT_SPACING.map(o => (
            <button
              key={o.v}
              type="button"
              className={'format-btn' + (curLh === o.v ? ' on' : '')}
              onMouseDown={keep}
              onClick={() => { run(a => a.setSpacing(o.v)); setPanel(null) }}
            >{o.label}</button>
          ))}
        </div>
      )}
      <div className="format-dock-row format-dock-main">
        {btn('N', () => run(a => a.exec('bold')), 'Negrita', { fontWeight: 800 }, fmt.b)}
        {btn('K', () => run(a => a.exec('italic')), 'Cursiva', { fontStyle: 'italic', fontFamily: 'Georgia, serif' }, fmt.i)}
        {btn('S', () => run(a => a.exec('underline')), 'Subrayado', { textDecoration: 'underline' }, fmt.u)}
        {btn('Aa', () => setPanel(p => (p === 'fonts' ? null : 'fonts')), 'Tipo de letra', null, panel === 'fonts')}
        {btn('↕', () => setPanel(p => (p === 'spacing' ? null : 'spacing')), 'Interlineado', null, panel === 'spacing')}
        {btn('•', () => run(a => a.exec('insertUnorderedList')), 'Lista con viñetas')}
        {btn('☐', () => run(a => a.checklist()), 'Casillas de verificación en las líneas seleccionadas')}
        {btn('▦', () => setPanel(p => (p === 'table' ? null : 'table')), 'Insertar tabla', null, panel === 'table')}
        {btn('✖', () => run(a => a.clearFormat()), 'Quitar formato')}
      </div>
    </div>
  )
}

// ---------- Escaneo de documentos: mejorar la foto y detectar la hoja ----------
// mode: 'documento' (fondo blanco parejo, conserva colores) o 'bn' (blanco y negro nítido)
// ---------- Respaldo completo: archivo .zip sin librerías (sin comprimir) ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
function crc32(bytes) {
  let c = 0xFFFFFFFF
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8)
  return (c ^ 0xFFFFFFFF) >>> 0
}
// files: [{ name, data: Uint8Array }] -> Blob .zip
function makeZipBlob(files) {
  const enc = new TextEncoder()
  const parts = []
  const central = []
  let offset = 0
  const now = new Date()
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()
  for (const f of files) {
    const name = enc.encode(f.name)
    const crc = crc32(f.data)
    const size = f.data.length
    const lh = new DataView(new ArrayBuffer(30))
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true)
    lh.setUint16(10, dosTime, true); lh.setUint16(12, dosDate, true); lh.setUint32(14, crc, true)
    lh.setUint32(18, size, true); lh.setUint32(22, size, true); lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true)
    parts.push(lh.buffer, name, f.data)
    const ch = new DataView(new ArrayBuffer(46))
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true)
    ch.setUint16(12, dosTime, true); ch.setUint16(14, dosDate, true); ch.setUint32(16, crc, true)
    ch.setUint32(20, size, true); ch.setUint32(24, size, true); ch.setUint16(28, name.length, true)
    ch.setUint32(42, offset, true)
    central.push(ch.buffer, name)
    offset += 30 + name.length + size
  }
  let centralSize = 0
  central.forEach(c => { centralSize += c.byteLength !== undefined ? c.byteLength : c.length })
  const end = new DataView(new ArrayBuffer(22))
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true)
  end.setUint32(12, centralSize, true); end.setUint32(16, offset, true)
  return new Blob([...parts, ...central, end.buffer], { type: 'application/zip' })
}

// ---------- Recordatorios: se guardan en el calendario del celular (archivo .ics) ----------
// El calendario del celular es quien avisa (suena aunque la app esté cerrada) y sabe repetir cada año.
function buildReminderIcs({ title, notes, date, time, repeat, alert }) {
  const esc = t => String(t || '').replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
  const d = date.replace(/-/g, '')
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '')
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Days//Recordatorio//ES', 'CALSCALE:GREGORIAN', 'BEGIN:VEVENT',
    'UID:days-' + Date.now() + '@days.app', 'DTSTAMP:' + stamp]
  if (time) {
    const t = time.replace(':', '') + '00'
    const [hh, mm] = time.split(':').map(Number)
    const endMin = hh * 60 + mm + 30
    const et = String(Math.floor(endMin / 60) % 24).padStart(2, '0') + String(endMin % 60).padStart(2, '0') + '00'
    lines.push('DTSTART:' + d + 'T' + t, 'DTEND:' + d + 'T' + et)
  } else {
    const next = new Date(date + 'T00:00:00')
    next.setDate(next.getDate() + 1)
    const nd = next.getFullYear() + String(next.getMonth() + 1).padStart(2, '0') + String(next.getDate()).padStart(2, '0')
    lines.push('DTSTART;VALUE=DATE:' + d, 'DTEND;VALUE=DATE:' + nd)
  }
  lines.push('SUMMARY:' + esc('🔔 ' + title))
  if (notes) lines.push('DESCRIPTION:' + esc(notes.slice(0, 900)))
  const rule = { year: 'YEARLY', month: 'MONTHLY', week: 'WEEKLY' }[repeat]
  if (rule) lines.push('RRULE:FREQ=' + rule)
  // Aviso: a la hora, antes, o (si no hay hora) a las 9:00 del día / del día anterior
  const trig = time
    ? { now: 'PT0S', m10: '-PT10M', h1: '-PT1H', d1: '-P1D' }[alert] || 'PT0S'
    : (alert === 'd1' ? '-PT15H' : 'PT9H')
  lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + esc(title), 'TRIGGER:' + trig, 'END:VALARM')
  lines.push('END:VEVENT', 'END:VCALENDAR')
  return lines.join('\r\n')
}

function downloadReminderIcs(data) {
  const blob = new Blob([buildReminderIcs(data)], { type: 'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'recordatorio.ics'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}

// ---------- Dibujar a mano alzada (lienzo con lápiz de dedo o stylus) ----------
// Los trazos, formas y resaltador van sobre una "capa base". El texto y las imágenes son
// objetos aparte que se pueden mover, cambiar de tamaño, editar o quitar hasta que pulsas Listo.
const DRAW_COLORS = ['#222222', '#D32F2F', '#1976D2', '#2E7D32', '#FFD600', '#7B1FA2', '#FF4081', '#00BCD4']
const DRAW_SIZES = [['Fino', 2, 6], ['Medio', 5, 11], ['Grueso', 11, 18]]
const DRAW_TOOLS = [
  ['mover', '✋', 'Mover'],
  ['lapiz', '✏️', 'Lápiz'],
  ['resaltador', '🖍️', 'Resaltador'],
  ['balde', '🎨', 'Rellenar'],
  ['linea', '╱', 'Línea'],
  ['flecha', '➜', 'Flecha'],
  ['rect', '▭', 'Rectángulo'],
  ['circulo', '◯', 'Círculo'],
  ['texto', '🔤', 'Texto'],
  ['imagen', '🖼️', 'Imagen'],
  ['borrador', '🧽', 'Borrador'],
]
const DRAW_LINE_STYLES = [['solid', '━━', 'Continua'], ['dashed', '╌╌', 'Rayas'], ['dotted', '···', 'Puntos']]

function DrawingPad({ onDone, onCancel, initialSrc }) {
  const wrapRef = useRef(null)
  const canvasRef = useRef(null) // lo que se ve
  const baseRef = useRef(null) // capa base (trazos)
  const fileRef = useRef(null)
  const stRef = useRef(null) // gesto en curso
  const undoRef = useRef([])
  const objsRef = useRef([]) // textos e imágenes movibles
  const selRef = useRef(-1)
  const [sel, setSelState] = useState(-1)
  const [selType, setSelType] = useState('')
  const [tool, setTool] = useState('lapiz')
  const [color, setColor] = useState(DRAW_COLORS[0])
  const [size, setSize] = useState(5)
  const [lineStyle, setLineStyle] = useState('solid')
  const [canUndo, setCanUndo] = useState(false)
  const [hint, setHint] = useState('')
  const [textEdit, setTextEdit] = useState(null) // { value, idx, x, y, k, fs, color } cuadro de texto abierto sobre el lienzo
  const textEditRef = useRef(null)
  textEditRef.current = textEdit

  const setSel = i => {
    selRef.current = i
    setSelState(i)
    setSelType(i >= 0 && objsRef.current[i] ? objsRef.current[i].type : '')
  }

  const FONT = fs => '600 ' + fs + 'px Arial, Helvetica, sans-serif'

  const objBox = (o, ctx) => {
    if (o.type === 'img') return { x: o.x, y: o.y, w: o.w, h: o.h }
    ctx.font = FONT(o.fs)
    const lines = o.text.split('\n')
    const w = Math.max(...lines.map(l => ctx.measureText(l).width), 10)
    return { x: o.x, y: o.y, w, h: lines.length * o.fs * 1.2 }
  }

  const redraw = (withSel = true) => {
    const c = canvasRef.current
    const base = baseRef.current
    if (!c || !base) return
    const ctx = c.getContext('2d')
    ctx.setLineDash([])
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'
    ctx.drawImage(base, 0, 0)
    objsRef.current.forEach(o => {
      if (o.editing) return
      if (o.type === 'img') ctx.drawImage(o.im, o.x, o.y, o.w, o.h)
      else {
        ctx.fillStyle = o.color
        ctx.font = FONT(o.fs)
        ctx.textBaseline = 'top'
        o.text.split('\n').forEach((line, n) => ctx.fillText(line, o.x, o.y + n * o.fs * 1.2))
      }
    })
    const si = selRef.current
    if (withSel && si >= 0 && objsRef.current[si]) {
      const b = objBox(objsRef.current[si], ctx)
      const k = c.width / c.getBoundingClientRect().width
      ctx.save()
      ctx.strokeStyle = '#1E88E5'
      ctx.lineWidth = 2 * k
      ctx.setLineDash([6 * k, 4 * k])
      ctx.strokeRect(b.x - 3 * k, b.y - 3 * k, b.w + 6 * k, b.h + 6 * k)
      ctx.setLineDash([])
      ctx.fillStyle = '#1E88E5'
      ctx.fillRect(b.x + b.w - 7 * k, b.y + b.h - 7 * k, 18 * k, 18 * k)
      ctx.restore()
    }
  }

  useEffect(() => {
    const wrap = wrapRef.current
    const canvas = canvasRef.current
    if (!wrap || !canvas) return
    let cancelled = false
    const setup = im => {
      if (cancelled) return
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      const availW = Math.max(200, Math.floor(wrap.clientWidth))
      const availH = Math.max(200, Math.floor(wrap.clientHeight))
      let cssW = availW
      let cssH = availH
      let pxW = Math.round(availW * dpr)
      let pxH = Math.round(availH * dpr)
      if (im) {
        // seguir dibujando sobre una imagen: el lienzo toma la forma de la imagen
        const ar = im.width / im.height
        cssW = Math.min(availW, availH * ar)
        cssH = cssW / ar
        pxW = Math.min(im.width, 2000)
        pxH = Math.round(pxW / ar)
      }
      canvas.style.width = cssW + 'px'
      canvas.style.height = cssH + 'px'
      canvas.style.margin = '0 auto'
      canvas.width = pxW
      canvas.height = pxH
      const base = document.createElement('canvas')
      base.width = pxW
      base.height = pxH
      const bctx = base.getContext('2d')
      bctx.fillStyle = '#ffffff'
      bctx.fillRect(0, 0, pxW, pxH)
      if (im) bctx.drawImage(im, 0, 0, pxW, pxH)
      baseRef.current = base
      redraw()
    }
    if (!initialSrc) { setup(null); return () => { cancelled = true } }
    ;(async () => {
      try {
        let src = initialSrc
        if (!initialSrc.startsWith('blob:') && !initialSrc.startsWith('data:')) {
          const res = await fetch(initialSrc, { mode: 'cors', cache: 'reload' })
          src = URL.createObjectURL(await res.blob())
        }
        const im = new Image()
        im.onload = () => setup(im)
        im.onerror = () => { alert('No se pudo abrir la imagen para dibujar encima.'); onCancel() }
        im.src = src
      } catch {
        alert('No se pudo abrir la imagen para dibujar encima.')
        onCancel()
      }
    })()
    return () => { cancelled = true }
  }, [])

  const pos = e => {
    const r = canvasRef.current.getBoundingClientRect()
    const k = canvasRef.current.width / r.width
    return { x: (e.clientX - r.left) * k, y: (e.clientY - r.top) * k, k }
  }

  const snapshot = () => {
    const b = baseRef.current
    let img = null
    try { img = b.getContext('2d').getImageData(0, 0, b.width, b.height) } catch { /* sin memoria: no se podrá deshacer este paso */ }
    return { img, objs: objsRef.current.map(o => ({ ...o })) }
  }

  const pushUndo = snap => {
    undoRef.current.push(snap || snapshot())
    if (undoRef.current.length > 25) undoRef.current.shift()
    setCanUndo(true)
  }

  const restore = snap => {
    if (!snap) return
    if (snap.img) baseRef.current.getContext('2d').putImageData(snap.img, 0, 0)
    objsRef.current = snap.objs.map(o => ({ ...o }))
  }

  // Ajusta el pincel: color, grosor y tipo de línea (continua, rayas o puntos)
  const applyStroke = (ctx, k) => {
    const erasing = tool === 'borrador'
    const hl = tool === 'resaltador'
    const col = erasing ? '#ffffff' : color
    const lw = (erasing ? size * 3 : hl ? size * 3 + 8 : size) * k
    ctx.strokeStyle = col
    ctx.fillStyle = col
    ctx.lineWidth = lw
    ctx.lineCap = hl ? 'square' : 'round'
    ctx.lineJoin = 'round'
    ctx.globalAlpha = hl ? 0.4 : 1
    ctx.globalCompositeOperation = hl ? 'multiply' : 'source-over'
    if (erasing || hl || lineStyle === 'solid') ctx.setLineDash([])
    else if (lineStyle === 'dashed') ctx.setLineDash([lw * 3.2, lw * 2.4])
    else ctx.setLineDash([0.1, lw * 2.2]) // puntos redondos
  }

  const resetCtx = ctx => { ctx.setLineDash([]); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over' }

  const drawShape = (ctx, kind, a, b, k) => {
    applyStroke(ctx, k)
    ctx.beginPath()
    if (kind === 'linea' || kind === 'flecha') {
      ctx.moveTo(a.x, a.y)
      ctx.lineTo(b.x, b.y)
      ctx.stroke()
      if (kind === 'flecha') {
        const ang = Math.atan2(b.y - a.y, b.x - a.x)
        const len = Math.max(14 * k, size * 3.2 * k)
        ctx.setLineDash([])
        ctx.beginPath()
        ctx.moveTo(b.x, b.y)
        ctx.lineTo(b.x - len * Math.cos(ang - Math.PI / 7), b.y - len * Math.sin(ang - Math.PI / 7))
        ctx.moveTo(b.x, b.y)
        ctx.lineTo(b.x - len * Math.cos(ang + Math.PI / 7), b.y - len * Math.sin(ang + Math.PI / 7))
        ctx.stroke()
      }
    } else if (kind === 'rect') {
      ctx.rect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y))
      ctx.stroke()
    } else if (kind === 'circulo') {
      ctx.ellipse((a.x + b.x) / 2, (a.y + b.y) / 2, Math.max(1, Math.abs(b.x - a.x) / 2), Math.max(1, Math.abs(b.y - a.y) / 2), 0, 0, Math.PI * 2)
      ctx.stroke()
    }
    resetCtx(ctx)
  }

  const strokePath = (ctx, pts) => {
    ctx.beginPath()
    if (pts.length === 1) { ctx.moveTo(pts[0].x, pts[0].y); ctx.lineTo(pts[0].x + 0.01, pts[0].y) }
    else {
      ctx.moveTo(pts[0].x, pts[0].y)
      for (let i = 1; i < pts.length - 1; i++) {
        const mx = (pts[i].x + pts[i + 1].x) / 2
        const my = (pts[i].y + pts[i + 1].y) / 2
        ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my)
      }
      const last = pts[pts.length - 1]
      ctx.lineTo(last.x, last.y)
    }
    ctx.stroke()
  }

  const hitObject = (p, k) => {
    const ctx = canvasRef.current.getContext('2d')
    for (let i = objsRef.current.length - 1; i >= 0; i--) {
      const b = objBox(objsRef.current[i], ctx)
      const m = 8 * k
      if (p.x >= b.x - m && p.x <= b.x + b.w + m && p.y >= b.y - m && p.y <= b.y + b.h + m) return i
    }
    return -1
  }

  const onHandle = (p, k) => {
    const si = selRef.current
    if (si < 0 || !objsRef.current[si]) return false
    const b = objBox(objsRef.current[si], canvasRef.current.getContext('2d'))
    return Math.abs(p.x - (b.x + b.w)) < 26 * k && Math.abs(p.y - (b.y + b.h)) < 26 * k
  }

  const addText = p => {
    setTextEdit({ value: '', idx: null, x: p.x, y: p.y, k: p.k, fs: size * 4 + 16, color })
  }

  // Termina de escribir: guarda el texto (nuevo o editado) como objeto movible
  const commitText = () => {
    const te = textEditRef.current
    if (!te) return
    setTextEdit(null)
    textEditRef.current = null
    const val = te.value
    if (te.idx !== null && objsRef.current[te.idx]) {
      const o = objsRef.current[te.idx]
      o.editing = false
      if (val.trim() && val !== o.text) { pushUndo(); o.text = val }
      redraw()
      return
    }
    if (!val.trim()) return
    pushUndo()
    objsRef.current.push({ type: 'text', text: val, x: te.x, y: te.y, fs: te.fs * te.k, color: te.color })
    setSel(objsRef.current.length - 1)
    setTool('mover')
    setHint('Arrastra para mover · la esquina azul cambia el tamaño')
    redraw()
  }

  const cancelText = () => {
    const te = textEditRef.current
    if (te && te.idx !== null && objsRef.current[te.idx]) objsRef.current[te.idx].editing = false
    setTextEdit(null)
    textEditRef.current = null
    redraw()
  }

  // Rellena con el color elegido la zona donde tocas (hasta chocar con una línea)
  const floodFill = (px, py) => {
    const b = baseRef.current
    const bctx = b.getContext('2d')
    const w = b.width
    const h = b.height
    const x0 = Math.max(0, Math.min(w - 1, Math.round(px)))
    const y0 = Math.max(0, Math.min(h - 1, Math.round(py)))
    let img
    try { img = bctx.getImageData(0, 0, w, h) } catch { return }
    const d = img.data
    const hex = color.replace('#', '')
    const fr = parseInt(hex.slice(0, 2), 16)
    const fg = parseInt(hex.slice(2, 4), 16)
    const fb = parseInt(hex.slice(4, 6), 16)
    const si = (y0 * w + x0) * 4
    const tr = d[si], tg = d[si + 1], tb = d[si + 2]
    if (Math.abs(tr - fr) + Math.abs(tg - fg) + Math.abs(tb - fb) < 12) return
    const TOL = 90
    const near = i => Math.abs(d[i] - tr) + Math.abs(d[i + 1] - tg) + Math.abs(d[i + 2] - tb) <= TOL
    const mask = new Uint8Array(w * h)
    const stack = [y0 * w + x0]
    mask[y0 * w + x0] = 1
    while (stack.length) {
      const n = stack.pop()
      const x = n % w
      const y = (n - x) / w
      if (x > 0 && !mask[n - 1] && near((n - 1) * 4)) { mask[n - 1] = 1; stack.push(n - 1) }
      if (x < w - 1 && !mask[n + 1] && near((n + 1) * 4)) { mask[n + 1] = 1; stack.push(n + 1) }
      if (y > 0 && !mask[n - w] && near((n - w) * 4)) { mask[n - w] = 1; stack.push(n - w) }
      if (y < h - 1 && !mask[n + w] && near((n + w) * 4)) { mask[n + w] = 1; stack.push(n + w) }
    }
    // se agranda 1 punto para tapar el borde suavizado de la línea y que no quede un halo blanco
    const grown = mask.slice()
    for (let n = 0; n < mask.length; n++) {
      if (!mask[n]) continue
      const x = n % w
      if (x > 0) grown[n - 1] = 1
      if (x < w - 1) grown[n + 1] = 1
      if (n >= w) grown[n - w] = 1
      if (n < mask.length - w) grown[n + w] = 1
    }
    for (let n = 0; n < grown.length; n++) {
      if (!grown[n]) continue
      const i = n * 4
      d[i] = fr; d[i + 1] = fg; d[i + 2] = fb; d[i + 3] = 255
    }
    bctx.putImageData(img, 0, 0)
  }

  const onDown = e => {
    e.preventDefault()
    const p = pos(e)
    if (textEditRef.current) { commitText(); return }
    if (tool === 'texto') { addText(p); return }
    if (tool === 'imagen') { fileRef.current && fileRef.current.click(); return }
    try { canvasRef.current.setPointerCapture(e.pointerId) } catch { /* no pasa nada */ }

    if (tool === 'mover') {
      if (onHandle(p, p.k)) {
        const o = objsRef.current[selRef.current]
        const b = objBox(o, canvasRef.current.getContext('2d'))
        stRef.current = { kind: 'resize', snap: snapshot(), start: p, orig: { ...o }, bw: b.w, moved: false }
        return
      }
      const hit = hitObject(p, p.k)
      if (hit >= 0) {
        setSel(hit)
        redraw()
        stRef.current = { kind: 'move', snap: snapshot(), start: p, orig: { ...objsRef.current[hit] }, moved: false }
      } else {
        setSel(-1)
        redraw()
      }
      return
    }

    // herramientas de dibujo: se suelta cualquier selección
    if (selRef.current >= 0) { setSel(-1); redraw() }
    if (tool === 'balde') {
      pushUndo()
      floodFill(p.x, p.y)
      redraw()
      return
    }
    const snap = snapshot()
    pushUndo(snap)
    const bctx = baseRef.current.getContext('2d')
    if (tool === 'lapiz' || tool === 'borrador' || tool === 'resaltador') {
      applyStroke(bctx, p.k)
      stRef.current = { kind: 'free', img: snap.img, pts: [{ x: p.x, y: p.y }], k: p.k, drawn: 0 }
      if ((lineStyle === 'solid' && tool === 'lapiz') || tool === 'borrador') {
        bctx.beginPath()
        bctx.arc(p.x, p.y, bctx.lineWidth / 2, 0, Math.PI * 2)
        bctx.fill()
        resetCtx(bctx)
        redraw()
      }
    } else {
      stRef.current = { kind: 'shape', img: snap.img, a: { x: p.x, y: p.y }, k: p.k }
    }
  }

  const onMove = e => {
    const st = stRef.current
    if (!st) return
    e.preventDefault()
    const bctx = baseRef.current.getContext('2d')
    if (st.kind === 'move' || st.kind === 'resize') {
      const q = pos(e)
      const dx = q.x - st.start.x
      const dy = q.y - st.start.y
      if (Math.abs(dx) + Math.abs(dy) > 3) st.moved = true
      const o = objsRef.current[selRef.current]
      if (!o) return
      if (st.kind === 'move') {
        o.x = st.orig.x + dx
        o.y = st.orig.y + dy
      } else if (o.type === 'img') {
        const w = Math.max(30, st.orig.w + dx)
        o.w = w
        o.h = w * (st.orig.h / st.orig.w)
      } else {
        o.fs = Math.max(10, st.orig.fs * Math.max(0.2, (st.bw + dx) / st.bw))
      }
      redraw()
      return
    }
    if (st.kind === 'free') {
      const evs = e.nativeEvent.getCoalescedEvents ? e.nativeEvent.getCoalescedEvents() : [e.nativeEvent]
      for (const ev of (evs.length ? evs : [e.nativeEvent])) {
        const q = pos(ev)
        st.pts.push({ x: q.x, y: q.y })
      }
      const solidPen = tool === 'borrador' || (tool === 'lapiz' && lineStyle === 'solid')
      if (solidPen) {
        applyStroke(bctx, st.k)
        const seg = st.pts.slice(Math.max(0, st.drawn - 1))
        if (seg.length > 1) strokePath(bctx, seg)
        st.drawn = st.pts.length - 1
      } else {
        // resaltador y líneas de rayas/puntos: se redibuja el trazo completo para que se vea parejo
        if (st.img) bctx.putImageData(st.img, 0, 0)
        applyStroke(bctx, st.k)
        strokePath(bctx, st.pts)
      }
      resetCtx(bctx)
      redraw()
    } else {
      const q = pos(e)
      if (st.img) bctx.putImageData(st.img, 0, 0)
      drawShape(bctx, tool, st.a, { x: q.x, y: q.y }, st.k)
      redraw()
    }
  }

  const onUp = e => {
    const st = stRef.current
    stRef.current = null
    if (!st) return
    if (st.kind === 'move' || st.kind === 'resize') {
      if (st.moved) pushUndo(st.snap)
      return
    }
    if (st.kind === 'shape' && e && e.clientX !== undefined) {
      const q = pos(e)
      if (Math.abs(q.x - st.a.x) < 3 && Math.abs(q.y - st.a.y) < 3) {
        if (st.img) baseRef.current.getContext('2d').putImageData(st.img, 0, 0)
        undoRef.current.pop()
        setCanUndo(undoRef.current.length > 0)
        redraw()
      }
    }
  }

  const undo = () => {
    const snap = undoRef.current.pop()
    restore(snap)
    setSel(-1)
    setCanUndo(undoRef.current.length > 0)
    redraw()
  }

  const clearAll = () => {
    if (!window.confirm('¿Borrar todo el dibujo?')) return
    pushUndo()
    const b = baseRef.current
    const bctx = b.getContext('2d')
    bctx.fillStyle = '#ffffff'
    bctx.fillRect(0, 0, b.width, b.height)
    objsRef.current = []
    setSel(-1)
    redraw()
  }

  const pickImage = file => {
    if (!file) return
    const url = URL.createObjectURL(file)
    const im = new Image()
    im.onload = () => {
      const c = canvasRef.current
      const w = Math.min(c.width * 0.6, im.width)
      const h = w * (im.height / im.width)
      pushUndo()
      objsRef.current.push({ type: 'img', im, x: (c.width - w) / 2, y: (c.height - h) / 2, w, h })
      setSel(objsRef.current.length - 1)
      setTool('mover')
      setHint('Arrastra para mover · la esquina azul cambia el tamaño')
      redraw()
    }
    im.onerror = () => { alert('No se pudo abrir esa imagen'); URL.revokeObjectURL(url) }
    im.src = url
  }

  const removeSelected = () => {
    const i = selRef.current
    if (i < 0) return
    pushUndo()
    objsRef.current.splice(i, 1)
    setSel(-1)
    redraw()
  }

  const editSelectedText = () => {
    const idx = selRef.current
    const o = objsRef.current[idx]
    if (!o || o.type !== 'text') return
    const k = canvasRef.current.width / canvasRef.current.getBoundingClientRect().width
    o.editing = true
    setSel(-1)
    redraw()
    setTextEdit({ value: o.text, idx, x: o.x, y: o.y, k, fs: o.fs / k, color: o.color })
  }

  const chooseColor = c => {
    setColor(c)
    const o = objsRef.current[selRef.current]
    if (o && o.type === 'text') { pushUndo(); o.color = c; redraw(); return }
    if (tool === 'borrador' || tool === 'mover' || tool === 'texto' || tool === 'imagen') setTool('lapiz')
  }

  const chooseTool = id => {
    setTool(id)
    if (id !== 'mover' && selRef.current >= 0) { setSel(-1); redraw() }
    setHint(id === 'texto' ? 'Toca donde quieres escribir' : id === 'mover' ? 'Toca un texto o imagen para moverlo o cambiarle el tamaño' : id === 'resaltador' ? 'Pasa el dedo sobre lo que quieres resaltar' : id === 'balde' ? 'Elige un color y toca dentro de una forma para pintarla' : '')
    if (id === 'imagen') fileRef.current && fileRef.current.click()
  }

  const finish = () => {
    if (textEditRef.current) commitText()
    setSel(-1)
    redraw(false)
    canvasRef.current.toBlob(blob => {
      if (!blob) { onCancel(); return }
      onDone(new File([blob], 'dibujo_' + Date.now() + '.png', { type: 'image/png' }))
    }, 'image/png')
  }

  const barBtn = { border: 'none', borderRadius: 10, padding: '8px 12px', fontWeight: 700, fontSize: '0.9rem', background: 'rgba(255,255,255,0.18)', color: '#fff' }
  const chip = on => ({ ...barBtn, padding: '7px 10px', flex: '0 0 auto', background: on ? '#fff' : 'rgba(255,255,255,0.18)', color: on ? '#222' : '#fff' })
  const lineStyleApplies = ['lapiz', 'linea', 'flecha', 'rect', 'circulo'].includes(tool)

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 100000, background: '#2b2b2b', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', gap: 8, padding: '10px 10px 8px', alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="button" title="Cancelar" aria-label="Cancelar" style={barBtn} onClick={onCancel}>✕</button>
        <button type="button" title="Deshacer" aria-label="Deshacer" style={{ ...barBtn, opacity: canUndo ? 1 : 0.4 }} onClick={undo} disabled={!canUndo}>↩️</button>
        <button type="button" title="Limpiar todo" aria-label="Limpiar todo" style={barBtn} onClick={clearAll}>🗑️</button>
        <button type="button" title="Listo" aria-label="Listo" style={{ ...barBtn, marginLeft: 'auto', background: '#4CAF50' }} onClick={finish}>✔</button>
      </div>
      <div ref={wrapRef} style={{ flex: 1, minHeight: 0, margin: '0 10px', background: '#fff', borderRadius: 10, overflow: 'hidden', position: 'relative' }}>
        <canvas
          ref={canvasRef}
          style={{ touchAction: 'none', display: 'block', cursor: tool === 'texto' ? 'text' : tool === 'mover' ? 'move' : 'crosshair' }}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={() => { stRef.current = null }}
        />
        {textEdit && (() => {
          const wrap = wrapRef.current
          const maxW = wrap ? wrap.clientWidth : 300
          const cv = canvasRef.current
          const offL = cv ? cv.offsetLeft : 0
          const offT = cv ? cv.offsetTop : 0
          const left = Math.max(2, Math.min(offL + textEdit.x / textEdit.k, maxW - 170))
          const top = Math.max(2, offT + textEdit.y / textEdit.k)
          return (
            <div style={{ position: 'absolute', left, top, width: Math.min(260, maxW - left - 4), zIndex: 5 }}>
              <textarea
                autoFocus
                value={textEdit.value}
                placeholder="Escribe aquí…"
                rows={Math.max(1, textEdit.value.split('\n').length)}
                onChange={e => setTextEdit(t => ({ ...t, value: e.target.value }))}
                style={{
                  width: '100%', boxSizing: 'border-box', resize: 'none', border: '2px dashed #1E88E5', borderRadius: 6, outline: 'none',
                  background: 'rgba(255,255,255,0.92)', padding: 2, margin: 0, overflow: 'hidden',
                  font: '600 ' + textEdit.fs + 'px/1.2 Arial, Helvetica, sans-serif', color: textEdit.color,
                }}
              />
              <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                <button type="button" title="Aceptar" aria-label="Aceptar" onClick={commitText} style={{ border: 'none', borderRadius: 8, padding: '6px 14px', background: '#4CAF50', color: '#fff', fontWeight: 700, fontSize: '1rem' }}>✔</button>
                <button type="button" title="Cancelar" aria-label="Cancelar texto" onClick={cancelText} style={{ border: 'none', borderRadius: 8, padding: '6px 14px', background: '#e0e0e0', fontWeight: 700, fontSize: '1rem' }}>✕</button>
              </div>
            </div>
          )
        })()}
      </div>
      <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={e => { pickImage(e.target.files[0]); e.target.value = '' }} />
      <div style={{ display: 'flex', gap: 6, justifyContent: 'center', alignItems: 'center', minHeight: 34, padding: '4px 10px 0', flexWrap: 'wrap' }}>
        {sel >= 0 ? (
          <>
            <button type="button" title="Quitar" aria-label="Quitar" style={{ ...chip(false), background: '#C62828' }} onClick={removeSelected}>🗑️</button>
            {selType === 'text' && <button type="button" title="Editar texto" aria-label="Editar texto" style={chip(false)} onClick={editSelectedText}>✏️</button>}
            <span style={{ color: 'rgba(255,255,255,0.75)', fontSize: '0.78rem' }}>Arrastra para mover · esquina azul = tamaño</span>
          </>
        ) : (
          <span style={{ color: 'rgba(255,255,255,0.75)', fontSize: '0.8rem', textAlign: 'center' }}>{hint}</span>
        )}
      </div>
      <div style={{ display: 'flex', gap: 6, padding: '6px 10px', overflowX: 'auto' }}>
        {DRAW_TOOLS.map(([id, icon, label]) => (
          <button key={id} type="button" title={label} aria-label={label} style={{ ...chip(tool === id), fontSize: '1.15rem', minWidth: 44 }} onClick={() => chooseTool(id)}>{id === 'lapiz' ? <span style={{ display: 'inline-block', transform: 'scaleX(-1)' }}>{icon}</span> : icon}</button>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, padding: '4px 10px', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap' }}>
        {DRAW_COLORS.map(c => (
          <button
            key={c}
            type="button"
            aria-label={'Color ' + c}
            onClick={() => chooseColor(c)}
            style={{ width: 30, height: 30, borderRadius: '50%', background: c, border: color === c && tool !== 'borrador' ? '3px solid #fff' : '3px solid rgba(255,255,255,0.25)', padding: 0 }}
          />
        ))}
      </div>
      <div style={{ display: 'flex', gap: 6, padding: '6px 10px 12px', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap' }}>
        {DRAW_SIZES.map(([label, v, dot]) => (
          <button key={v} type="button" title={label} aria-label={label} onClick={() => setSize(v)} style={{ ...chip(size === v), width: 44, height: 38, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}>
            <span style={{ width: dot, height: dot, borderRadius: '50%', background: size === v ? '#222' : '#fff', display: 'block' }} />
          </button>
        ))}
        {lineStyleApplies && DRAW_LINE_STYLES.map(([id, icon, label]) => (
          <button key={id} type="button" title={label} aria-label={label} onClick={() => setLineStyle(id)} style={{ ...chip(lineStyle === id), minWidth: 44 }}>{icon}</button>
        ))}
      </div>
    </div>
  )
}

function applyDocFilter(src, mode) {
  const w = src.width
  const h = src.height
  const out = document.createElement('canvas')
  out.width = w
  out.height = h
  const ctx = out.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(src, 0, 0)
  const img = ctx.getImageData(0, 0, w, h)
  const d = img.data

  // 1) Mapa de "cómo se ve el papel en blanco": el máximo de luz por celda, suavizado.
  //    Así la sombra o la luz desigual se compensan y el fondo queda parejo.
  const cell = Math.max(8, Math.round(Math.max(w, h) / 70))
  const gw = Math.ceil(w / cell)
  const gh = Math.ceil(h / cell)
  let g = new Float32Array(gw * gh)
  for (let y = 0; y < h; y += 2) {
    for (let x = 0; x < w; x += 2) {
      const i = (y * w + x) * 4
      const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
      const k = Math.floor(y / cell) * gw + Math.floor(x / cell)
      if (l > g[k]) g[k] = l
    }
  }
  const filt = (arr, fn) => {
    const o = new Float32Array(arr.length)
    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++) {
        let acc = fn.init
        let n = 0
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const yy = Math.min(gh - 1, Math.max(0, y + dy))
            const xx = Math.min(gw - 1, Math.max(0, x + dx))
            acc = fn.step(acc, arr[yy * gw + xx])
            n++
          }
        }
        o[y * gw + x] = fn.done(acc, n)
      }
    }
    return o
  }
  const maxF = { init: 0, step: (a, v) => (v > a ? v : a), done: (a) => a }
  const avgF = { init: 0, step: (a, v) => a + v, done: (a, n) => a / n }
  g = filt(g, maxF)
  g = filt(g, maxF)
  g = filt(g, avgF)
  g = filt(g, avgF)

  // 2) Cada punto se divide por su papel en blanco y se ajusta el contraste.
  const smooth = (e0, e1, v) => { const t = Math.min(1, Math.max(0, (v - e0) / (e1 - e0))); return t * t * (3 - 2 * t) }
  for (let y = 0; y < h; y++) {
    const fy = Math.min(gh - 1, Math.max(0, y / cell - 0.5))
    const y0 = Math.floor(fy)
    const y1 = Math.min(gh - 1, y0 + 1)
    const wy = fy - y0
    for (let x = 0; x < w; x++) {
      const fx = Math.min(gw - 1, Math.max(0, x / cell - 0.5))
      const x0 = Math.floor(fx)
      const x1 = Math.min(gw - 1, x0 + 1)
      const wx = fx - x0
      const bg = (g[y0 * gw + x0] * (1 - wx) + g[y0 * gw + x1] * wx) * (1 - wy) + (g[y1 * gw + x0] * (1 - wx) + g[y1 * gw + x1] * wx) * wy
      const scale = 255 / Math.max(bg, 50)
      const i = (y * w + x) * 4
      if (mode === 'bn') {
        const l = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) * scale / 255
        const v = smooth(0.5, 0.82, l) * 255
        d[i] = d[i + 1] = d[i + 2] = v
      } else {
        for (let c = 0; c < 3; c++) {
          const v = d[i + c] * scale / 255
          d[i + c] = smooth(0.12, 0.93, v) * 255
        }
      }
    }
  }
  ctx.putImageData(img, 0, 0)
  return out
}

// Tramo más largo seguido de valores >= umbral: [inicio, fin] o null.
function longestRun(arr, thr) {
  let best = null
  let start = -1
  for (let i = 0; i <= arr.length; i++) {
    const ok = i < arr.length && arr[i] >= thr
    if (ok && start === -1) start = i
    if (!ok && start !== -1) {
      if (!best || i - 1 - start > best[1] - best[0]) best = [start, i - 1]
      start = -1
    }
  }
  return best
}

// Busca la hoja (la zona clara más grande) y devuelve el recorte {x,y,w,h} en fracciones 0-1, o null.
// Funciona bien con una hoja sobre una mesa más oscura; no corrige la perspectiva.
function detectPaperCrop(canvas) {
  const sw = 160
  const sh = Math.max(1, Math.round(canvas.height * sw / canvas.width))
  const c = document.createElement('canvas')
  c.width = sw
  c.height = sh
  const cx = c.getContext('2d', { willReadFrequently: true })
  cx.drawImage(canvas, 0, 0, sw, sh)
  const d = cx.getImageData(0, 0, sw, sh).data
  const lum = new Uint8Array(sw * sh)
  const hist = new Array(256).fill(0)
  for (let i = 0; i < sw * sh; i++) {
    const l = Math.round(0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2])
    lum[i] = l
    hist[l]++
  }
  // umbral de Otsu: separa lo claro (hoja) de lo oscuro (fondo)
  const total = sw * sh
  let sum = 0
  for (let t = 0; t < 256; t++) sum += t * hist[t]
  let sumB = 0
  let wB = 0
  let best = 0
  let thr = 128
  for (let t = 0; t < 256; t++) {
    wB += hist[t]
    if (!wB) continue
    const wF = total - wB
    if (!wF) break
    sumB += t * hist[t]
    const mB = sumB / wB
    const mF = (sum - sumB) / wF
    const between = wB * wF * (mB - mF) * (mB - mF)
    if (between > best) { best = between; thr = t }
  }
  const rows = new Float32Array(sh)
  const cols = new Float32Array(sw)
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      if (lum[y * sw + x] > thr) { rows[y]++; cols[x]++ }
    }
  }
  for (let y = 0; y < sh; y++) rows[y] /= sw
  for (let x = 0; x < sw; x++) cols[x] /= sh
  const ry = longestRun(rows, 0.4)
  const rx = longestRun(cols, 0.4)
  if (!ry || !rx) return null
  let x0 = rx[0] / sw
  let x1 = (rx[1] + 1) / sw
  let y0 = ry[0] / sh
  let y1 = (ry[1] + 1) / sh
  const area = (x1 - x0) * (y1 - y0)
  if (area < 0.2 || area > 0.96) return null
  // un poquito hacia adentro para no dejar el borde oscuro de la mesa
  x0 += 0.004
  y0 += 0.004
  x1 -= 0.004
  y1 -= 0.004
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

function AppInner() {
  // ---------- Lista compartida pública (sin login) ----------
  const sharedListId = new URLSearchParams(window.location.search).get('list')
  const [sharedList, setSharedList] = useState(null)
  const [sharedItems, setSharedItems] = useState([])
  const [sharedLoading, setSharedLoading] = useState(true)
  const [sharedNewItemText, setSharedNewItemText] = useState('')

  useEffect(() => {
    if (!sharedListId) return
    loadSharedList()
  }, [sharedListId])

  // Refresca la lista sola (al volver a abrir la app y cada 30 s) para ver lo que agregaron los demás.
  useEffect(() => {
    if (!sharedListId) return
    const refresh = () => { if (document.visibilityState === 'visible') loadSharedList(true) }
    document.addEventListener('visibilitychange', refresh)
    const timer = setInterval(refresh, 30000)
    return () => { document.removeEventListener('visibilitychange', refresh); clearInterval(timer) }
  }, [sharedListId])

  // ---------- Guardar la lista en la pantalla de inicio (para que nadie pierda el enlace) ----------
  const [installEvent, setInstallEvent] = useState(null)
  const [linkCopied, setLinkCopied] = useState(false)
  const [copiedListId, setCopiedListId] = useState(null) // lista cuyo enlace se acaba de copiar (vista del dueño)
  const pinKey = `days_list_pin_hidden_${sharedListId}`
  const [pinHidden, setPinHidden] = useState(() => { try { return !!localStorage.getItem(pinKey) } catch { return false } })
  const isStandalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true
  const isIOS = /iphone|ipad|ipod/i.test(window.navigator.userAgent)

  useEffect(() => {
    if (!sharedListId) return
    const onPrompt = e => { e.preventDefault(); setInstallEvent(e) }
    window.addEventListener('beforeinstallprompt', onPrompt)
    return () => window.removeEventListener('beforeinstallprompt', onPrompt)
  }, [sharedListId])

 useEffect(() => {
  if (!sharedListId || !sharedList?.title) return
  const link = document.querySelector('link[rel="manifest"]')
  if (!link) return
  const originalHref = link.href
  const params = new URLSearchParams({
    title: sharedList.title,
    short: String(sharedList.title).slice(0, 12),
    start: window.location.href,
  })
  link.href = `/api/manifest?${params.toString()}`
  return () => { link.href = originalHref }
}, [sharedListId, sharedList?.title])

  async function copyListLink() {
    try {
      await navigator.clipboard.writeText(window.location.href)
      setLinkCopied(true)
      setTimeout(() => setLinkCopied(false), 2500)
    } catch {
      window.prompt('Copia este enlace:', window.location.href)
    }
  }

  useEffect(() => {
    setPendingSync(getOfflineQueue().length)
    const goOnline = () => { setIsOffline(false); flushOfflineQueue() }
    const goOffline = () => setIsOffline(true)
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [])

  async function loadSharedList(quiet = false) {
    if (!quiet) setSharedLoading(true)
    const { data: list } = await supabase.from('shopping_lists').select('*').eq('id', sharedListId).single()
    const { data: items } = await supabase.from('shopping_list_items').select('*').eq('list_id', sharedListId).order('created_at')
    setSharedList(list || null)
    setSharedItems(items || [])
    setSharedLoading(false)
  }

  async function sharedAddItem(e) {
    e.preventDefault()
    if (!sharedNewItemText.trim()) return
    await supabase.from('shopping_list_items').insert({ list_id: sharedListId, content: sharedNewItemText })
    setSharedNewItemText('')
    loadSharedList()
  }

  async function sharedToggleItem(item) {
    await supabase.from('shopping_list_items').update({ done: !item.done }).eq('id', item.id)
    loadSharedList()
  }

  // ---------- Autenticación ----------
  const [authed, setAuthed] = useState(false)
  const [checkingSession, setCheckingSession] = useState(true)
  const [isOffline, setIsOffline] = useState(!navigator.onLine)
  const [pendingSync, setPendingSync] = useState(0)
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

  // ---------- Calendario / Diario ----------
  const [loading, setLoading] = useState(true)
  // Si la URL trae ?view=notas (o cualquier otra vista válida), la app arranca ahí
  // directo en vez del calendario. Esto permite crear un ícono en la pantalla de
  // inicio que apunte a esa URL y entre de una a "Notas rápidas", sin pasar por
  // el calendario ni el menú.
  const [view, setView] = useState(() => {
    if (typeof window === 'undefined') return 'calendario'
    const requestedView = new URLSearchParams(window.location.search).get('view')
    const validViews = ['calendario', 'agenda', 'buscar', 'etiquetas', 'notas', 'listas', 'tareas', 'clima', 'revision', 'importar', 'carpetas']
    return validViews.includes(requestedView) ? requestedView : 'calendario'
  })
  const [mainMenuOpen, setMainMenuOpen] = useState(false)
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem('days-dark-mode') === '1')
  const [calendarSubmenuOpen, setCalendarSubmenuOpen] = useState(false)
  const [dayTags, setDayTags] = useState([])
  const [visibleTagIds, setVisibleTagIds] = useState([])
  const [expandedFilterGroup, setExpandedFilterGroup] = useState(null)
  const [quickAddToast, setQuickAddToast] = useState('')
  const [dayEntries, setDayEntries] = useState([])
  const [quickNotes, setQuickNotes] = useState([])
  const [shoppingLists, setShoppingLists] = useState([])
  // Clima registrado por día: { 'YYYY-MM-DD': 'sunny' | 'cloudy' | 'rainy' } (tabla day_weather).
  const [dayWeather, setDayWeather] = useState({})
  const [weatherNotice, setWeatherNotice] = useState('')
  // Pendientes (lista con casillas) de cada día, tabla day_todos. Los no hechos de días
  // anteriores pasan solos a hoy (ver loadTodos).
  const [todos, setTodos] = useState([])
  const [newTodoText, setNewTodoText] = useState('')
  // Rango que se muestra en la pantalla de estadísticas del clima.
  const [weatherStatsRange, setWeatherStatsRange] = useState('3months')
  const [openListId, setOpenListId] = useState(null)
  const [listItemsByList, setListItemsByList] = useState({})
  const [newListTitle, setNewListTitle] = useState('')
  const [newListColor, setNewListColor] = useState('#FDE68A')
  const [newListItemText, setNewListItemText] = useState('')
  const [creatingList, setCreatingList] = useState(false)
  const [newTaskText, setNewTaskText] = useState('')
  const [newTaskTagId, setNewTaskTagId] = useState('')
  const [newTaskDate, setNewTaskDate] = useState('')
  const [noteFolderFilter, setNoteFolderFilter] = useState('all')
  const [expandedFolders, setExpandedFolders] = useState(() => {
    try { return JSON.parse(localStorage.getItem('days_expanded_folders') || '[]') } catch { return [] }
  })
  const [folderPath, setFolderPath] = useState('') // carpeta abierta en la pestaña Carpetas ('' = inicio)
  const [quickNoteFolder, setQuickNoteFolder] = useState(null) // carpeta de la nota que se está editando
  const [folderPicker, setFolderPicker] = useState(null) // null | { mode: 'editor' | 'bulk', value: '' }
  const [folderForm, setFolderForm] = useState(null) // null | { mode: 'new' | 'rename', old, value }
  const [extraFolders, setExtraFolders] = useState(() => {
    try { return JSON.parse(localStorage.getItem('days_extra_folders') || '[]') } catch { return [] }
  }) // carpetas creadas vacías (en este celular)
  const [quickNoteSearch, setQuickNoteSearch] = useState('')
  const [movingNoteId, setMovingNoteId] = useState(null)
  const [colorPickerForTag, setColorPickerForTag] = useState(null)
  const [newFolderInput, setNewFolderInput] = useState('')
  const [quickNoteModalOpen, setQuickNoteModalOpen] = useState(false)
  const [editingQuickNoteId, setEditingQuickNoteId] = useState(null)
  const [quickNoteTitle, setQuickNoteTitle] = useState('')
  const QUICK_NOTE_PASTELS = ['#FBEBD4', '#FBD9E3', '#D9EAF7', '#DCF2E3', '#E7E0F7']
  const [quickNoteColor, setQuickNoteColor] = useState('#FBEBD4')
  // Notas temporales: se marcan con una fecha de revisión; al llegar esa fecha aparecen
  // en "Revisar notas" para decidir si se mantienen, se vuelven permanentes o se borran.
  const [quickNoteTemporary, setQuickNoteTemporary] = useState(false)
  const [quickNoteFavorite, setQuickNoteFavorite] = useState(false)
  const [quickNoteReviewAt, setQuickNoteReviewAt] = useState('')
  const [quickNoteBlocks, setQuickNoteBlocks] = useState([])
  const [quickNoteCurrentText, setQuickNoteCurrentText] = useState('')
  const [isDictatingQuickNote, setIsDictatingQuickNote] = useState(false)
  const quickNoteRecognitionRef = useRef(null)
  const [isDictatingDayNote, setIsDictatingDayNote] = useState(false)
  const dayNoteRecognitionRef = useRef(null)
  // Lo que el micrófono va oyendo y todavía no se confirmó (se muestra en vivo mientras dictas).
  const [dictationInterim, setDictationInterim] = useState('')
  // Mientras sea true, el dictado se reinicia solo cuando el navegador lo corta por silencio.
  const dictationWantedRef = useRef({ day: false, quick: false })
  const [savingQuickNote, setSavingQuickNote] = useState(false)
  const [calendarMonth, setCalendarMonth] = useState(() => { const d = new Date(); d.setDate(1); return d })
  const [selectedDay, setSelectedDay] = useState(null)
  const [dayModalOpen, setDayModalOpen] = useState(false)
  const [newTagForm, setNewTagForm] = useState({ name: '', color: '#FDE68A', parent_id: '', kind: 'principal' })
  const [taskFormOpen, setTaskFormOpen] = useState(false)
  const [editingSeriesId, setEditingSeriesId] = useState(null)
  const [taskSearch, setTaskSearch] = useState('')
  const [taskSearchSubmitted, setTaskSearchSubmitted] = useState('')
  // Orden de los resultados de búsqueda: 'newest' (más nuevas primero, por defecto),
  // 'oldest' (más antiguas primero) o 'important' (⭐ primero, luego más nuevas).
  const [searchOrder, setSearchOrder] = useState('newest')
  const [freeNoteModalOpen, setFreeNoteModalOpen] = useState(false)
  const [editingTaskId, setEditingTaskId] = useState(null)
  const [tagMenuOpen, setTagMenuOpen] = useState(false)
  const [freeNoteBlocks, setFreeNoteBlocks] = useState([])
  const [freeNoteCurrentText, setFreeNoteCurrentText] = useState('')
  const [savingFreeNote, setSavingFreeNote] = useState(false)
  const [noteTagIds, setNoteTagIds] = useState([])
  const [dayEntryTitle, setDayEntryTitle] = useState('')
  const [dayEntryColor, setDayEntryColor] = useState('#FBEBD4')
  const [dayEntryImportant, setDayEntryImportant] = useState(false)
  const [dayEntryFolder, setDayEntryFolder] = useState(null)
  const [folderEntries, setFolderEntries] = useState([]) // entradas del día que están en alguna carpeta
  const [dayNoteSaveStatus, setDayNoteSaveStatus] = useState('saved') // 'saved' | 'pending' | 'saving'
  const [expandedEntryId, setExpandedEntryId] = useState(null) // null = nada expandido | 'new' = nueva entrada en blanco | <id> = esa entrada expandida ahí mismo
  const [quickTagName, setQuickTagName] = useState('')
  const [quickTagColor, setQuickTagColor] = useState('#FDE68A')
  const [creatingQuickTag, setCreatingQuickTag] = useState(false)
  const [photoEditorOpen, setPhotoEditorOpen] = useState(false)
  const [drawingTarget, setDrawingTarget] = useState(null) // null | 'day' | 'quicknote'
  const [viewingPhotoEdit, setViewingPhotoEdit] = useState(null) // { url, kind, index | key } foto abierta desde un editor, para poder dibujar encima
  const [drawingEdit, setDrawingEdit] = useState(null) // al seguir dibujando sobre una imagen ya puesta: { index | key, src }
  const [reminder, setReminder] = useState(null) // null | { title, notes, date, time, repeat, alert }
  const [photoEditorFilter, setPhotoEditorFilter] = useState('original') // 'original' | 'documento' | 'bn'
  const [photoEditorNotice, setPhotoEditorNotice] = useState('')
  const [viewingPhotoUrl, setViewingPhotoUrl] = useState(null)
  const [photoEditorPreview, setPhotoEditorPreview] = useState(null) // data URL actual (tras rotar) para mostrar
  const [photoEditorCrop, setPhotoEditorCrop] = useState({ x: 0, y: 0, w: 1, h: 1 }) // fracciones 0-1 relativas a la imagen mostrada
  const workingCanvasRef = useRef(null) // canvas oculto: fuente de verdad de la imagen tras cada rotación
  const cropDragRef = useRef(null) // estado del arrastre en curso (mover o redimensionar una esquina)
  const cropBoxDisplayRef = useRef(null) // el <div> que muestra la imagen, para medir tamaño real en pantalla
  const photoEditorTargetRef = useRef('day') // 'day' (diario del día) o 'quicknote' (nota rápida): a cuál se anexa al confirmar
  const autosaveTimerRef = useRef(null)
  const noteEntryIdRef = useRef(null) // fuente de verdad síncrona del id de la nota actual (evita duplicados)
  const freeNoteGenRef = useRef(0) // sube en cada edición real de freeNoteBlocks; descarta guardados en vuelo que quedaron obsoletos

  // ---- Refs espejo para el autoguardado del día ----
  // Motivo: persistDayNote() se dispara desde un setTimeout (debounce). Si leyera
  // freeNoteBlocks/freeNoteCurrentText/noteTagIds directamente, leería el valor que
  // esas variables tenían en el render donde se programó el guardado -- es decir,
  // el estado de *justo antes* del último cambio (edición/borrado), no el actual.
  // Eso es lo que hacía que un bloque borrado "reapareciera": el guardado programado
  // en el mismo clic de borrar todavía tenía, en su clausura, el bloque sin borrar.
  // Los refs, en cambio, son mutables y compartidos entre renders: persistDayNote
  // siempre lee ahí el valor más reciente, sin importar cuándo se programó el guardado.
  const freeNoteBlocksRef = useRef([])
  const freeNoteCurrentTextRef = useRef('')
  const noteTagIdsRef = useRef([])
  const dayEntryTitleRef = useRef('')
  const dayEntryColorRef = useRef('#FBEBD4')
  const dayEntryImportantRef = useRef(false)
  const dayEntryFolderRef = useRef(null)
  const dayEntryFolderTouchedRef = useRef(false)

  function setFreeNoteBlocksSynced(updater) {
    setFreeNoteBlocks(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater
      freeNoteBlocksRef.current = next
      return next
    })
  }
  function setFreeNoteCurrentTextSynced(updater) {
    setFreeNoteCurrentText(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater
      freeNoteCurrentTextRef.current = next
      return next
    })
  }
  function setNoteTagIdsSynced(updater) {
    setNoteTagIds(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater
      noteTagIdsRef.current = next
      return next
    })
  }
  function setDayEntryTitleSynced(updater) {
    setDayEntryTitle(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater
      dayEntryTitleRef.current = next
      return next
    })
  }
  function setDayEntryColorSynced(updater) {
    setDayEntryColor(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater
      dayEntryColorRef.current = next
      return next
    })
  }
  function setDayEntryFolderSynced(value, touched = false) {
    dayEntryFolderRef.current = value || null
    dayEntryFolderTouchedRef.current = touched
    setDayEntryFolder(value || null)
  }
  function setDayEntryImportantSynced(updater) {
    setDayEntryImportant(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater
      dayEntryImportantRef.current = next
      return next
    })
  }

  const [taskForm, setTaskForm] = useState({ tag_id: '', date: '', note: '', repeat: 'weekly', customDays: '' })
  const [sharingNotes, setSharingNotes] = useState(false)
  const [shareMenuNoteId, setShareMenuNoteId] = useState(null)
  // Selección de varias notas rápidas (para borrar o unir de una vez)
  const [selectMode, setSelectMode] = useState(false)
  const [selectedNoteIds, setSelectedNoteIds] = useState([])
  const [showOnlyFavNotes, setShowOnlyFavNotes] = useState(false)
  const [lastBackupDate, setLastBackupDate] = useState(() => { try { return localStorage.getItem('days_last_backup') || '' } catch (e) { return '' } })
  const [backingUp, setBackingUp] = useState(false)
  // ---------- Papelera ----------
  const [trashOpen, setTrashOpen] = useState(false)
  const [trashItems, setTrashItems] = useState([])
  const [trashLoading, setTrashLoading] = useState(false)
  const [trashDays, setTrashDays] = useState(() => {
    try { const v = localStorage.getItem('days_trash_days'); return v === null ? 30 : Number(v) } catch { return 30 }
  }) // 0 = nunca se borra sola
  const [shareSelText, setShareSelText] = useState('')
  useEffect(() => {
    setSelectMode(false)
    setSelectedNoteIds([])
    if (view !== 'notas') setShowOnlyFavNotes(false)
  }, [view])
  const [shareMenuEntryId, setShareMenuEntryId] = useState(null)

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

  useEffect(() => { if (authed) { loadData(); if (navigator.onLine) flushOfflineQueue() } }, [authed])

  // Enlace con Diamantev (solo lectura): ventas por entregar y cuentas por cobrar con día asignado.
  const dv = usePendientesDiamantev(authed)
  const [dvDia, setDvDia] = useState(null) // 'hoy' (hoy + atrasados) o una fecha YYYY-MM-DD

  // Si dejas la app abierta de un día para otro, al volver a verla los pendientes sin marcar pasan a hoy.
  useEffect(() => {
    if (!authed) return
    const onVisible = () => { if (document.visibilityState === 'visible') loadTodos() }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [authed])

  // Mientras hay una vista a pantalla completa abierta (diario del día, editor de nota
  // rápida, o cualquiera de las vistas del menú), bloqueamos el scroll de la página de
  // fondo con la técnica que de verdad funciona en iOS Safari: overflow: hidden por sí
  // solo no evita que iOS "empuje" la página al enfocar un campo de texto, así que además
  // fijamos el body en su posición actual. Al cerrar el editor de nota rápida, la vista de
  // "Notas rápidas" sigue abierta detrás, así que el bloqueo NO debe soltarse todavía --
  // soltarlo ahí es lo que dejaba la pantalla descolocada y el botón ✕ fuera de alcance.
  const anyFullScreenViewOpen = dayModalOpen || quickNoteModalOpen || view !== 'calendario'
  useEffect(() => {
    if (anyFullScreenViewOpen) {
      const scrollY = window.scrollY
      const body = document.body
      const prev = { position: body.style.position, top: body.style.top, width: body.style.width, overflow: body.style.overflow }
      body.style.position = 'fixed'
      body.style.top = `-${scrollY}px`
      body.style.width = '100%'
      body.style.overflow = 'hidden'
      return () => {
        body.style.position = prev.position
        body.style.top = prev.top
        body.style.width = prev.width
        body.style.overflow = prev.overflow
        window.scrollTo(0, scrollY)
      }
    }
  }, [anyFullScreenViewOpen])

  useEffect(() => {
    if (!quickNoteModalOpen && quickNoteRecognitionRef.current) {
      dictationWantedRef.current.quick = false
      quickNoteRecognitionRef.current.stop()
    }
  }, [quickNoteModalOpen])

  useEffect(() => {
    if (!dayModalOpen && dayNoteRecognitionRef.current) {
      dictationWantedRef.current.day = false
      dayNoteRecognitionRef.current.stop()
    }
  }, [dayModalOpen])

  // 100dvh no siempre reacciona al teclado en iOS Safari (ahí el teclado reduce el
  // "viewport visual" pero no el "viewport de layout", que es lo que mide dvh/vh).
  // window.visualViewport sí refleja el alto real y visible en todo momento, así que
  // lo usamos para fijar la altura exacta del panel del día vía una variable CSS.
  useEffect(() => {
    if (!(dayModalOpen || quickNoteModalOpen)) return
    const vv = window.visualViewport
    function updateAppVh() {
      const h = vv ? vv.height : window.innerHeight
      document.documentElement.style.setProperty('--app-vh', h + 'px')
    }
    updateAppVh()
    vv?.addEventListener('resize', updateAppVh)
    window.addEventListener('resize', updateAppVh)
    return () => {
      vv?.removeEventListener('resize', updateAppVh)
      window.removeEventListener('resize', updateAppVh)
      document.documentElement.style.removeProperty('--app-vh')
    }
  }, [dayModalOpen, quickNoteModalOpen])

  function getOfflineQueue() {
    try { return JSON.parse(localStorage.getItem('days_offline_queue') || '[]') } catch { return [] }
  }
  function setOfflineQueueStorage(q) {
    localStorage.setItem('days_offline_queue', JSON.stringify(q))
    setPendingSync(q.length)
  }
  // "Failed to fetch" = el celular dice tener internet pero la petición no llegó (señal inestable).
  function isNetworkError(err) {
    return !!err && !err.code && /fetch|network|load failed/i.test(err.message || '')
  }
  function queueOfflineOp(op) {
    const q = getOfflineQueue()
    q.push(op)
    setOfflineQueueStorage(q)
  }
  async function flushOfflineQueue() {
    let q = getOfflineQueue()
    if (q.length === 0) return
    while (q.length > 0) {
      const op = q[0]
      let res = null
      try {
        let query = supabase.from(op.table)
        if (op.action === 'insert') {
          res = await query.insert(op.payload)
        } else if (op.action === 'upsert') {
          res = await query.upsert(op.payload, { onConflict: op.onConflict || 'id' })
        } else if (op.action === 'update') {
          let u = query.update(op.payload)
          for (const [k, v] of Object.entries(op.match || {})) u = u.eq(k, v)
          if (op.matchGte) for (const [k, v] of Object.entries(op.matchGte)) u = u.gte(k, v)
          res = await u
        } else if (op.action === 'delete') {
          let d = query.delete()
          for (const [k, v] of Object.entries(op.match || {})) d = d.eq(k, v)
          if (op.matchGte) for (const [k, v] of Object.entries(op.matchGte)) d = d.gte(k, v)
          res = await d
        }
        // Si no hay señal, supabase no lanza excepción: devuelve error. Dejamos la operación en cola.
        if (res && res.error && isNetworkError(res.error)) return
        q = q.slice(1)
        setOfflineQueueStorage(q)
      } catch (err) {
        return
      }
    }
    loadData()
  }

  // Trae TODAS las filas de una tabla, sin importar cuántas haya: Supabase por
  // defecto corta cualquier consulta en 1000 filas, así que si vas ordenando
  // por fecha ascendente y ya pasaste las 1000 filas en total, las fechas más
  // recientes (las últimas en ese orden) simplemente nunca llegan a la app --
  // no se borran, pero tampoco se ven. Acá pedimos en tandas de 1000 hasta
  // que una tanda vuelva incompleta (esa es la señal de que ya no queda más).
  async function fetchAllRows(table, orderCol, options = {}) {
    const pageSize = 1000
    let from = 0
    let all = []
    while (true) {
      const { data, error } = await supabase
        .from(table)
        .select('*')
        .order(orderCol, options)
        .range(from, from + pageSize - 1)
      if (error) {
        console.error(`Error cargando ${table}:`, error.message)
        break
      }
      all = all.concat(data || [])
      if (!data || data.length < pageSize) break
      from += pageSize
    }
    return all
  }

  async function loadData() {
    setLoading(true)
    const tags = await fetchAllRows('day_tags', 'created_at')
    const entries = await fetchAllRows('day_entries', 'date')
    const notes = await fetchAllRows('quick_notes', 'created_at', { ascending: false })
    const lists = await fetchAllRows('shopping_lists', 'created_at', { ascending: false })
    const weatherRows = await fetchAllRows('day_weather', 'date')
    setDayTags(tags || [])
    setDayEntries(entries || [])
    setQuickNotes(notes || [])
    setShoppingLists(lists || [])
    setDayWeather(Object.fromEntries((weatherRows || []).map(r => [r.date, r.weather])))
    setLoading(false)
    loadTodos() // sin esperar: no frena la pantalla
  }

  // ---------- Pendientes por día ----------
  // Al cargar, todo pendiente (sin marcar) de un día anterior pasa a hoy. Los marcados se quedan
  // en su día como historial. origin_date guarda el día en que se creó, para mostrar "desde ...".
  async function loadTodos() {
    if (!navigator.onLine) return
    const today = formatDateStr(new Date())
    try {
      await supabase.from('day_todos').update({ date: today }).eq('done', false).lt('date', today)
    } catch { /* si la tabla aún no existe, no pasa nada */ }
    // Si la carga falla (señal mala), se conserva lo que ya se ve en vez de vaciar la lista.
    const { data, error } = await supabase.from('day_todos').select('*').order('created_at').range(0, 4999)
    if (!error && data) setTodos(data)
  }

  async function addTodo(e) {
    e.preventDefault()
    const text = newTodoText.trim()
    if (!text || !selectedDay) return
    const row = { id: crypto.randomUUID(), date: selectedDay, origin_date: selectedDay, text, done: false }
    setTodos(prev => [...prev, { ...row, created_at: new Date().toISOString() }])
    setNewTodoText('')
    if (!navigator.onLine) {
      queueOfflineOp({ table: 'day_todos', action: 'insert', payload: row })
      return
    }
    const { error } = await supabase.from('day_todos').insert(row)
    if (error && isNetworkError(error)) {
      queueOfflineOp({ table: 'day_todos', action: 'insert', payload: row })
      return
    }
    if (error) {
      setTodos(prev => prev.filter(t => t.id !== row.id))
      alert('No se pudo guardar el pendiente: ' + error.message)
    }
  }

  async function toggleTodo(t) {
    const done = !t.done
    setTodos(prev => prev.map(x => (x.id === t.id ? { ...x, done } : x)))
    if (!navigator.onLine) {
      queueOfflineOp({ table: 'day_todos', action: 'update', payload: { done }, match: { id: t.id } })
      return
    }
    const { error } = await supabase.from('day_todos').update({ done }).eq('id', t.id)
    if (error && isNetworkError(error)) {
      queueOfflineOp({ table: 'day_todos', action: 'update', payload: { done }, match: { id: t.id } })
      return
    }
    if (error) {
      setTodos(prev => prev.map(x => (x.id === t.id ? { ...x, done: t.done } : x)))
      alert('No se pudo actualizar el pendiente: ' + error.message)
    }
  }

  async function deleteTodo(t) {
    setTodos(prev => prev.filter(x => x.id !== t.id))
    if (!navigator.onLine) {
      queueOfflineOp({ table: 'day_todos', action: 'delete', match: { id: t.id } })
      return
    }
    const { error } = await supabase.from('day_todos').delete().eq('id', t.id)
    if (error && isNetworkError(error)) {
      queueOfflineOp({ table: 'day_todos', action: 'delete', match: { id: t.id } })
      return
    }
    if (error) {
      setTodos(prev => [...prev, t])
      alert('No se pudo borrar el pendiente: ' + error.message)
    }
  }

  // ---------- Clima del día ----------
  function showWeatherNotice(msg) {
    setWeatherNotice(msg)
    setTimeout(() => setWeatherNotice(''), 7000)
  }

  function findRainTag() {
    return dayTags.find(t => RAIN_TAG_NAMES.includes(normalizeSearchText(t.name).replace(/\s+/g, '')))
  }

  // Registra el clima de un día. Tocar de nuevo el clima ya elegido lo quita.
  // Si el día queda "lluvioso", se registra solo la etiqueta "riego atras" en ese día
  // (si no la tenía ya); si deja de serlo, se quita la entrada automática que se creó.
  async function setWeatherForDay(dateStr, weather) {
    const previous = dayWeather[dateStr] || null
    const next = previous === weather ? null : weather

    const applyLocal = value => setDayWeather(prev => {
      const copy = { ...prev }
      if (value) copy[dateStr] = value
      else delete copy[dateStr]
      return copy
    })
    applyLocal(next)

    if (!navigator.onLine) {
      if (next) queueOfflineOp({ table: 'day_weather', action: 'upsert', payload: { date: dateStr, weather: next }, onConflict: 'date' })
      else queueOfflineOp({ table: 'day_weather', action: 'delete', match: { date: dateStr } })
    } else {
      const { error } = next
        ? await supabase.from('day_weather').upsert({ date: dateStr, weather: next }, { onConflict: 'date' })
        : await supabase.from('day_weather').delete().eq('date', dateStr)
      if (error) {
        applyLocal(previous)
        alert('No se pudo guardar el clima: ' + error.message)
        return
      }
    }

    if (next === 'rainy') await addRainWateringEntry(dateStr)
    else if (previous === 'rainy') await removeRainWateringEntry(dateStr)
  }

  async function addRainWateringEntry(dateStr) {
    const tag = findRainTag()
    if (!tag) {
      showWeatherNotice('Clima guardado. No encontré la etiqueta «RAtras», así que no se marcó el riego.')
      return
    }
    const alreadyTagged = dayEntries.some(e => e.date === dateStr && (e.tag_id === tag.id || (e.tag_ids || []).includes(tag.id)))
    if (alreadyTagged) return

    // Entrada sin texto, solo con la etiqueta, ya marcada como hecha: la lluvia regó.
    const entry = {
      id: (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : 'id_' + Date.now() + '_' + Math.random().toString(36).slice(2),
      tag_id: null,
      tag_ids: [tag.id],
      date: dateStr,
      note: RAIN_AUTO_NOTE,
      repeat: 'none',
      content_blocks: [],
      title: '',
      color: tag.color,
      important: false,
      done: true,
    }
    if (!navigator.onLine) {
      queueOfflineOp({ table: 'day_entries', action: 'upsert', payload: entry, onConflict: 'id' })
    } else {
      let { error } = await supabase.from('day_entries').insert(entry)
      // Igual que el guardado de notas: si faltan las columnas title/color/important, se reintenta sin ellas.
      if (error && error.message && (error.message.includes('title') || error.message.includes('color') || error.message.includes('important'))) {
        const { title, color, important, ...entryWithoutNewFields } = entry
        const retry = await supabase.from('day_entries').insert(entryWithoutNewFields)
        error = retry.error
      }
      if (error) {
        showWeatherNotice('Clima guardado, pero no se pudo marcar el riego: ' + error.message)
        return
      }
    }
    setDayEntries(prev => [...prev, entry])
    showWeatherNotice('🌧️ Lluvia: se marcó «' + tag.name + '» en este día.')
  }

  async function removeRainWateringEntry(dateStr) {
    const tag = findRainTag()
    if (!tag) return
    // Solo se quita la entrada automática intacta (misma nota, sin contenido, solo esa etiqueta).
    const auto = dayEntries.filter(e =>
      e.date === dateStr &&
      e.note === RAIN_AUTO_NOTE &&
      (!e.content_blocks || e.content_blocks.length === 0) &&
      (e.tag_ids || []).length === 1 && e.tag_ids[0] === tag.id
    )
    if (auto.length === 0) return
    const ids = auto.map(e => e.id)
    setDayEntries(prev => prev.filter(e => !ids.includes(e.id)))
    if (!navigator.onLine) {
      ids.forEach(id => queueOfflineOp({ table: 'day_entries', action: 'delete', match: { id } }))
    } else {
      await supabase.from('day_entries').delete().in('id', ids)
    }
    showWeatherNotice('Se quitó la marca de «' + tag.name + '» de este día.')
  }

  async function loadListItems(listId) {
    if (!navigator.onLine) return
    const { data } = await supabase.from('shopping_list_items').select('*').eq('list_id', listId).order('created_at')
    setListItemsByList(prev => ({ ...prev, [listId]: data || [] }))
  }

  async function createShoppingList(e) {
    e.preventDefault()
    if (!newListTitle.trim()) return
    if (!navigator.onLine) {
      const localId = crypto.randomUUID()
      const payload = { id: localId, title: newListTitle, color: newListColor }
      setShoppingLists(prev => [{ ...payload, created_at: new Date().toISOString() }, ...prev])
      queueOfflineOp({ table: 'shopping_lists', action: 'insert', payload })
      setNewListTitle('')
      setOpenListId(localId)
      setListItemsByList(prev => ({ ...prev, [localId]: [] }))
      return
    }
    setCreatingList(true)
    const { data, error } = await supabase.from('shopping_lists').insert({ title: newListTitle, color: newListColor }).select().single()
    setCreatingList(false)
    if (error) { alert('Error al crear la lista: ' + error.message); return }
    setNewListTitle('')
    await loadData()
    setOpenListId(data.id)
    setListItemsByList(prev => ({ ...prev, [data.id]: [] }))
  }

  async function deleteShoppingList(list) {
    if (!confirm(`¿Borrar la lista "${list.title}" y todos sus artículos?`)) return
    setShoppingLists(prev => prev.filter(l => l.id !== list.id))
    if (openListId === list.id) setOpenListId(null)
    if (!navigator.onLine) {
      queueOfflineOp({ table: 'shopping_lists', action: 'delete', match: { id: list.id } })
      return
    }
    await supabase.from('shopping_lists').delete().eq('id', list.id)
    loadData()
  }

  async function addListItem(listId) {
    if (!newListItemText.trim()) return
    if (!navigator.onLine) {
      const localId = crypto.randomUUID()
      const payload = { id: localId, list_id: listId, content: newListItemText, done: false }
      setListItemsByList(prev => ({ ...prev, [listId]: [...(prev[listId] || []), payload] }))
      queueOfflineOp({ table: 'shopping_list_items', action: 'insert', payload })
      setNewListItemText('')
      return
    }
    const { error } = await supabase.from('shopping_list_items').insert({ list_id: listId, content: newListItemText })
    if (error) { alert('Error al agregar: ' + error.message); return }
    setNewListItemText('')
    loadListItems(listId)
  }

  async function toggleListItem(item) {
    const newDone = !item.done
    setListItemsByList(prev => ({ ...prev, [item.list_id]: (prev[item.list_id] || []).map(i => i.id === item.id ? { ...i, done: newDone } : i) }))
    if (!navigator.onLine) {
      queueOfflineOp({ table: 'shopping_list_items', action: 'update', payload: { done: newDone }, match: { id: item.id } })
      return
    }
    await supabase.from('shopping_list_items').update({ done: newDone }).eq('id', item.id)
    loadListItems(item.list_id)
  }

  async function deleteListItem(item) {
    setListItemsByList(prev => ({ ...prev, [item.list_id]: (prev[item.list_id] || []).filter(i => i.id !== item.id) }))
    if (!navigator.onLine) {
      queueOfflineOp({ table: 'shopping_list_items', action: 'delete', match: { id: item.id } })
      return
    }
    await supabase.from('shopping_list_items').delete().eq('id', item.id)
    loadListItems(item.list_id)
  }

  function shoppingListUrl(list) {
    return `${window.location.origin}${window.location.pathname}?list=${list.id}`
  }

  function shareShoppingList(list) {
    const url = shoppingListUrl(list)
    const message = encodeURIComponent(`🛒 Te comparto la lista "${list.title}" en Days, puedes ver y agregar cosas aquí: ${url}\n\n📌 Al abrirla, toca "Guardar esta lista" para dejarla en tu pantalla de inicio y no perder el enlace.`)
    window.open(`https://wa.me/?text=${message}`, '_blank')
  }

  async function copyShoppingListLink(list) {
    const url = shoppingListUrl(list)
    try {
      await navigator.clipboard.writeText(url)
      setCopiedListId(list.id)
      setTimeout(() => setCopiedListId(null), 2500)
    } catch {
      window.prompt('Copia este enlace:', url)
    }
  }

  async function uploadFile(file, bucket = 'day-notes') {
    const ext = file.name.split('.').pop()
    const fileName = `${Date.now()}.${ext}`
    const { error } = await supabaseStorage.storage.from(bucket).upload(fileName, file)
    if (error) { alert('Error al subir el archivo'); return null }
    const { data } = supabaseStorage.storage.from(bucket).getPublicUrl(fileName)
    return data.publicUrl
  }

  // ---------- Importar fotos (y títulos) desde una exportación de Diarium ----------
  // No vuelve a crear texto que ya se haya importado antes: por cada entrada de Diarium
  // busca una nota del mismo día con el mismo texto y le agrega las fotos; si no encuentra
  // ninguna (por ejemplo, una entrada que en Diarium quedó solo con foto, sin texto), crea
  // una nota nueva. Solo mira entradas con fotos o con título, para no tocar lo demás.
  const [diariumZipFile, setDiariumZipFile] = useState(null)
  const [diariumLoading, setDiariumLoading] = useState(false)
  const [diariumError, setDiariumError] = useState('')
  const [diariumOps, setDiariumOps] = useState(null)
  const [diariumSelected, setDiariumSelected] = useState({})
  const [diariumDoneSet, setDiariumDoneSet] = useState(() => new Set())
  const [diariumImporting, setDiariumImporting] = useState(false)
  const [diariumProgress, setDiariumProgress] = useState({ done: 0, total: 0 })
  const [diariumSummary, setDiariumSummary] = useState(null)
  const diariumZipRef = useRef(null)
  const DIARIUM_DONE_KEY = 'days_diarium_imported_entry_dates'

  function getDiariumDoneSet() {
    try { return new Set(JSON.parse(localStorage.getItem(DIARIUM_DONE_KEY) || '[]')) } catch { return new Set() }
  }
  function addDiariumDone(entryDates) {
    const set = getDiariumDoneSet()
    entryDates.forEach(d => set.add(d))
    try { localStorage.setItem(DIARIUM_DONE_KEY, JSON.stringify([...set])) } catch { /* ignorar */ }
    setDiariumDoneSet(set)
  }

  function loadJSZip() {
    if (window.JSZip) return Promise.resolve(window.JSZip)
    return new Promise((resolve, reject) => {
      const s = document.createElement('script')
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js'
      s.onload = () => resolve(window.JSZip)
      s.onerror = () => reject(new Error('No se pudo cargar la librería para leer el .zip. Revisa tu conexión e intenta de nuevo.'))
      document.head.appendChild(s)
    })
  }

  function diariumHtmlToText(html) {
    if (!html) return ''
    const div = document.createElement('div')
    div.innerHTML = html
    const text = div.textContent || div.innerText || ''
    return text.replace(/\u200b/g, '').replace(/\n{3,}/g, '\n\n').trim()
  }
  function diariumNorm(t) {
    return (t || '').toLowerCase().replace(/\s+/g, ' ').trim()
  }

  async function analyzeDiariumZip(file) {
    setDiariumError('')
    setDiariumOps(null)
    setDiariumSummary(null)
    setDiariumLoading(true)
    try {
      const JSZip = await loadJSZip()
      const zip = await JSZip.loadAsync(file)
      diariumZipRef.current = zip

      const jsonPath = Object.keys(zip.files).find(p => p.toLowerCase().endsWith('.json') && !zip.files[p].dir)
      if (!jsonPath) throw new Error('No se encontró el archivo .json dentro del .zip. Revisa que hayas exportado en formato JSON.')
      const jsonText = await zip.file(jsonPath).async('string')
      const entries = JSON.parse(jsonText)

      // Agrupar fotos por carpeta de adjuntos (cada carpeta trae la fecha y hora exactas de su entrada)
      const folderRe = /^media\/([^/]+)\/([^/]+)$/
      const folders = {}
      for (const path of Object.keys(zip.files)) {
        const f = zip.files[path]
        if (f.dir) continue
        const m = path.match(folderRe)
        if (!m) continue
        const [, folder, filename] = m
        if (!/\.(jpe?g|png|gif|webp)$/i.test(filename)) continue // por ahora, solo fotos (no audio ni pdf)
        ;(folders[folder] = folders[folder] || []).push({ path, filename })
      }
      const folderKeyRe = /^(\d{4}-\d{2}-\d{2})_(\d{2})(\d{2})(\d{2})/
      const photosByEntryIndex = {}
      for (const [folder, files] of Object.entries(folders)) {
        const m = folder.match(folderKeyRe)
        if (!m) continue
        const iso = `${m[1]}T${m[2]}:${m[3]}:${m[4]}`
        const idx = entries.findIndex(e => e.date.slice(0, 19) === iso)
        if (idx >= 0) (photosByEntryIndex[idx] = photosByEntryIndex[idx] || []).push(...files)
      }

      // Solo entradas con fotos y/o con título -- el resto ya se cargó como texto antes
      const candidates = entries
        .map((e, idx) => ({ e, photos: photosByEntryIndex[idx] || [] }))
        .filter(({ e, photos }) => photos.length > 0 || (e.heading && e.heading.trim()))

      if (candidates.length === 0) { setDiariumOps([]); setDiariumLoading(false); return }

      const dates = candidates.map(c => c.e.date.slice(0, 10))
      const minDate = dates.reduce((a, b) => (a < b ? a : b))
      const maxDate = dates.reduce((a, b) => (a > b ? a : b))
      const { data: existingRows, error } = await supabase
        .from('day_entries').select('*').is('tag_id', null).gte('date', minDate).lte('date', maxDate)
      if (error) throw error

      const existingByDate = {}
      for (const row of existingRows || []) (existingByDate[row.date] = existingByDate[row.date] || []).push(row)
      const claimed = new Set()

      // Las entradas con texto propio se emparejan primero (comparación más confiable);
      // las de texto vacío (una receta que quedó solo en la foto, por ejemplo) van al final.
      const sorted = [...candidates].sort((a, b) => (diariumHtmlToText(b.e.html) ? 1 : 0) - (diariumHtmlToText(a.e.html) ? 1 : 0))

      const ops = []
      for (const { e, photos } of sorted) {
        const date = e.date.slice(0, 10)
        const text = diariumHtmlToText(e.html)
        const heading = (e.heading || '').trim()
        const rowsHere = (existingByDate[date] || []).filter(r => !claimed.has(r.id))
        let match = null
        if (text) {
          const nt = diariumNorm(text)
          match = rowsHere.find(r => {
            const rt = diariumNorm((r.content_blocks || []).filter(b => b.type === 'text').map(b => b.content).join('\n'))
            return rt && (rt === nt || rt.includes(nt) || nt.includes(rt))
          })
        } else if (rowsHere.length === 1) {
          const r = rowsHere[0]
          const rt = (r.content_blocks || []).filter(b => b.type === 'text').map(b => b.content).join('\n').trim()
          if (!rt) match = r
        }
        if (match) claimed.add(match.id)
        ops.push({
          id: `${date}-${e.date}-${Math.random().toString(36).slice(2, 7)}`,
          date, heading, text, photos, entryDate: e.date,
          action: match ? 'update' : 'create',
          matchedRow: match || null,
        })
      }
      ops.sort((a, b) => (a.entryDate < b.entryDate ? -1 : 1))

      const done = getDiariumDoneSet()
      setDiariumDoneSet(done)
      const sel = {}
      ops.forEach(op => { sel[op.id] = !done.has(op.entryDate) })
      setDiariumSelected(sel)
      setDiariumOps(ops)
    } catch (err) {
      setDiariumError(err.message || 'No se pudo leer el archivo.')
    } finally {
      setDiariumLoading(false)
    }
  }

  async function runDiariumImport() {
    const zip = diariumZipRef.current
    if (!zip || !diariumOps) return
    const toRun = diariumOps.filter(op => diariumSelected[op.id])
    if (toRun.length === 0) return
    setDiariumImporting(true)
    setDiariumProgress({ done: 0, total: toRun.length })
    let created = 0, updated = 0, photosOk = 0
    const failed = []
    const okEntryDates = []
    for (const op of toRun) {
      try {
        const photoBlocks = []
        for (const photo of op.photos) {
          const blob = await zip.file(photo.path).async('blob')
          const file = new File([blob], photo.filename, { type: blob.type || 'image/jpeg' })
          const url = await uploadFile(file)
          if (url) { photoBlocks.push({ type: 'photo', url }); photosOk++ }
        }
        if (op.action === 'update' && op.matchedRow) {
          const patch = {
            content_blocks: [...(op.matchedRow.content_blocks || []), ...photoBlocks],
            title: op.matchedRow.title || op.heading || null,
          }
          const { error } = await supabase.from('day_entries').update(patch).eq('id', op.matchedRow.id)
          if (error) throw error
          setDayEntries(prev => prev.map(r => (r.id === op.matchedRow.id ? { ...r, ...patch } : r)))
          updated++
        } else {
          const id = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `id-${Date.now()}-${Math.random().toString(36).slice(2)}`
          const content_blocks = [...(op.text ? [{ type: 'text', content: op.text }] : []), ...photoBlocks]
          const payload = { id, tag_id: null, tag_ids: [], date: op.date, note: '', repeat: 'none', content_blocks, title: op.heading || null, color: null, important: false }
          const { error } = await supabase.from('day_entries').insert(payload)
          if (error) throw error
          setDayEntries(prev => [...prev, { ...payload, done: false }])
          created++
        }
        okEntryDates.push(op.entryDate)
      } catch (err) {
        failed.push({ op, message: err.message })
      }
      setDiariumProgress(p => ({ ...p, done: p.done + 1 }))
    }
    addDiariumDone(okEntryDates)
    setDiariumSummary({ created, updated, photosOk, failed })
    setDiariumImporting(false)
  }

  // ---------- Login / recuperación ----------
  async function handleLogin(e) {
    e.preventDefault()
    setLoggingIn(true)
    setFailed(false)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setFailed(true)
    setLoggingIn(false)
  }

  async function handleLogout() {
    await supabase.auth.signOut()
  }

  function toggleDarkMode() {
    setDarkMode(prev => {
      localStorage.setItem('days-dark-mode', prev ? '0' : '1')
      return !prev
    })
  }

  // Respaldo COMPLETO: vuelve a leer todo de la base de datos (no solo lo que está en pantalla)
  // e incluye etiquetas, entradas, notas rápidas, listas, clima. Las fotos y videos quedan como enlaces.
  async function exportBackup() {
    if (backingUp) return
    if (!navigator.onLine) { alert('Sin conexión: el respaldo necesita internet para leer todos tus datos.'); return }
    setBackingUp(true)
    try {
      const [tags, entries, notes, lists, listItems, weather, todosRows] = await Promise.all([
        fetchAllRows('day_tags', 'created_at'),
        fetchAllRows('day_entries', 'date'),
        fetchAllRows('quick_notes', 'created_at'),
        fetchAllRows('shopping_lists', 'created_at'),
        fetchAllRows('shopping_list_items', 'created_at'),
        fetchAllRows('day_weather', 'date'),
        fetchAllRows('day_todos', 'created_at'),
      ])
      const backup = {
        exportado_el: new Date().toISOString(),
        aviso: 'Las fotos y videos están guardados en Supabase Storage; aquí aparecen sus enlaces.',
        etiquetas: tags,
        entradas: entries,
        notas_rapidas: notes,
        listas: lists,
        items_de_listas: listItems,
        clima: weather,
        pendientes: todosRows,
      }
      const today = formatDateStr(new Date())
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `days-respaldo-${today}.json`
      a.click()
      URL.revokeObjectURL(url)
      try { localStorage.setItem('days_last_backup', today) } catch (e) { /* ignorar */ }
      setLastBackupDate(today)
    } catch (err) {
      alert('No se pudo hacer el respaldo: ' + (err && err.message ? err.message : 'intenta de nuevo'))
    }
    setBackingUp(false)
  }

  // Respaldo COMPLETO: igual que el 💾 pero además descarga las fotos, videos y dibujos y lo junta todo en un .zip
  const [fullBackupMsg, setFullBackupMsg] = useState('')
  async function exportFullBackup() {
    if (backingUp) return
    if (!navigator.onLine) { alert('Sin conexión: el respaldo necesita internet.'); return }
    if (!confirm('Se descargarán tus datos y TODAS tus fotos, videos y dibujos en un solo archivo .zip.\n\nPuede tardar y pesar bastante: conviene usar wifi y no cerrar la app mientras trabaja. ¿Continuar?')) return
    setBackingUp(true)
    setMainMenuOpen(false)
    try {
      setFullBackupMsg('Leyendo tus datos…')
      const [tags, entries, notes, lists, listItems, weather, todosRows] = await Promise.all([
        fetchAllRows('day_tags', 'created_at'),
        fetchAllRows('day_entries', 'date'),
        fetchAllRows('quick_notes', 'created_at'),
        fetchAllRows('shopping_lists', 'created_at'),
        fetchAllRows('shopping_list_items', 'created_at'),
        fetchAllRows('day_weather', 'date'),
        fetchAllRows('day_todos', 'created_at'),
      ])
      let trash = []
      try { trash = await fetchAllRows('trash', 'deleted_at') } catch { /* la papelera puede no existir todavía */ }

      // Todas las direcciones de fotos y videos que usan las notas y entradas
      const urls = new Set()
      const addUrl = u => { if (u && typeof u === 'string' && /^https?:/.test(u)) urls.add(u) }
      ;[...entries, ...notes, ...trash.map(t => t.payload || {})].forEach(r => {
        addUrl(r.photo_url)
        ;(r.content_blocks || []).forEach(b => { if (b && (b.type === 'photo' || b.type === 'video')) addUrl(b.url) })
      })
      const list = [...urls]
      const files = []
      const index = {}
      const failed = []
      for (let k = 0; k < list.length; k++) {
        setFullBackupMsg(`Descargando archivos ${k + 1} de ${list.length}…`)
        const u = list[k]
        try {
          const res = await fetch(u, { mode: 'cors', cache: 'no-cache' })
          if (!res.ok) throw new Error('HTTP ' + res.status)
          const data = new Uint8Array(await res.arrayBuffer())
          const base = decodeURIComponent(u.split('?')[0].split('/').pop() || 'archivo').replace(/[^\w.\-]+/g, '_')
          const name = 'archivos/' + String(k + 1).padStart(4, '0') + '_' + base
          files.push({ name, data })
          index[u] = name
        } catch (err) {
          failed.push(u)
        }
      }
      const today = formatDateStr(new Date())
      const backup = {
        exportado_el: new Date().toISOString(),
        aviso: 'Las fotos, videos y dibujos están en la carpeta "archivos" de este zip. El archivo indice_de_archivos.json dice a qué dirección original corresponde cada uno.',
        etiquetas: tags,
        entradas: entries,
        notas_rapidas: notes,
        listas: lists,
        items_de_listas: listItems,
        clima: weather,
        pendientes: todosRows,
        papelera: trash,
      }
      const enc = new TextEncoder()
      const out = [
        { name: 'datos.json', data: enc.encode(JSON.stringify(backup, null, 2)) },
        { name: 'indice_de_archivos.json', data: enc.encode(JSON.stringify(index, null, 2)) },
        { name: 'LEEME.txt', data: enc.encode('Respaldo completo de Days — ' + today + '\r\n\r\ndatos.json: todo el texto (entradas, notas, etiquetas, listas, clima, papelera).\r\narchivos/: fotos, videos y dibujos.\r\nindice_de_archivos.json: de qué dirección viene cada archivo.\r\n' + (failed.length ? '\r\nNo se pudieron descargar ' + failed.length + ' archivos:\r\n' + failed.join('\r\n') : '')) },
        ...files,
      ]
      setFullBackupMsg('Armando el archivo…')
      const blob = makeZipBlob(out)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `days-respaldo-completo-${today}.zip`
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 60000)
      try { localStorage.setItem('days_last_backup', today) } catch (e) { /* ignorar */ }
      setLastBackupDate(today)
      if (failed.length) alert(`Listo, pero ${failed.length} de ${list.length} archivos no se pudieron descargar (quedan anotados en LEEME.txt).`)
    } catch (err) {
      alert('No se pudo hacer el respaldo completo: ' + (err && err.message ? err.message : 'intenta de nuevo'))
    }
    setFullBackupMsg('')
    setBackingUp(false)
  }

  async function handleForgotPassword(e) {
    e.preventDefault()
    if (!resetEmail.trim()) return
    setSendingReset(true)
    const { error } = await supabase.auth.resetPasswordForEmail(resetEmail, {
      redirectTo: window.location.origin + window.location.pathname,
    })
    setSendingReset(false)
    if (error) { alert('Error al enviar el correo: ' + error.message); return }
    setResetSent(true)
  }

  async function handleUpdatePassword(e) {
    e.preventDefault()
    if (!newPassword.trim()) return
    setUpdatingPassword(true)
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    setUpdatingPassword(false)
    if (error) { alert('Error al actualizar la contraseña: ' + error.message); return }
    setNewPassword('')
    setRecoveryMode(false)
    alert('Contraseña actualizada. Ya puedes usarla la próxima vez que entres.')
  }

  // ---------- Papelera: lo que se borra se guarda aquí hasta que pase el tiempo elegido ----------
  function trashTitleOf(kind, row) {
    const clean = t => String(t || '').replace(LS_REGEX, '').replace(FMT_TAG_REGEX, '').trim()
    let t = clean(row.title)
    if (!t && kind === 'quick_note') t = clean((row.content || '').split('\n').find(l => l.trim()))
    if (!t && kind === 'day_entry') {
      const blockText = (row.content_blocks || []).filter(b => b.type === 'text').map(b => b.content).join(' ')
      t = clean(blockText || row.note)
    }
    return (t || (kind === 'quick_note' ? 'Nota sin título' : 'Entrada sin título')).slice(0, 80)
  }

  // Manda copias a la papelera. Devuelve true si se puede seguir con el borrado.
  async function sendToTrash(kind, rows) {
    if (!rows || rows.length === 0) return true
    if (!navigator.onLine) return true // sin internet no se puede usar la papelera: se borra como antes
    const { error } = await supabase.from('trash').insert(rows.map(r => ({
      kind,
      original_id: String(r.id),
      title: trashTitleOf(kind, r),
      payload: r,
    })))
    if (error) {
      return confirm('No se pudo mandar a la papelera (' + error.message + ').\n\n¿Borrar de todas formas, sin posibilidad de recuperarlo?')
    }
    return true
  }

  async function purgeOldTrash(days) {
    if (!days || !navigator.onLine) return
    const cutoff = new Date(Date.now() - days * 86400000).toISOString()
    try { await supabase.from('trash').delete().lt('deleted_at', cutoff) } catch { /* si la tabla aún no existe, no pasa nada */ }
  }

  async function openTrash() {
    setTrashOpen(true)
    setMainMenuOpen(false)
    setTrashLoading(true)
    await purgeOldTrash(trashDays)
    const { data, error } = await supabase.from('trash').select('*').order('deleted_at', { ascending: false })
    if (error) alert('No se pudo abrir la papelera. ¿Ya ejecutaste el archivo supabase_papelera.sql en Supabase?\n\n' + error.message)
    setTrashItems(data || [])
    setTrashLoading(false)
  }

  function changeTrashDays(v) {
    const n = Number(v)
    setTrashDays(n)
    try { localStorage.setItem('days_trash_days', String(n)) } catch { /* no pasa nada */ }
    purgeOldTrash(n).then(() => { if (trashOpen) openTrash() })
  }

  async function restoreTrashItem(item) {
    const table = item.kind === 'quick_note' ? 'quick_notes' : 'day_entries'
    const { error } = await supabase.from(table).insert(item.payload)
    if (error && !String(error.message).includes('duplicate')) { alert('No se pudo restaurar: ' + error.message); return }
    await supabase.from('trash').delete().eq('id', item.id)
    setTrashItems(prev => prev.filter(x => x.id !== item.id))
    await loadData()
  }

  async function deleteTrashItemForever(item) {
    if (!confirm('¿Borrar para siempre «' + (item.title || 'esto') + '»? Ya no se podrá recuperar.')) return
    await supabase.from('trash').delete().eq('id', item.id)
    setTrashItems(prev => prev.filter(x => x.id !== item.id))
  }

  async function emptyTrash() {
    if (trashItems.length === 0) return
    if (!confirm('¿Vaciar la papelera? Se borrarán para siempre ' + trashItems.length + ' elementos.')) return
    const { error } = await supabase.from('trash').delete().in('id', trashItems.map(x => x.id))
    if (error) { alert('No se pudo vaciar: ' + error.message); return }
    setTrashItems([])
  }

  // ---------- Etiquetas ----------
  async function deleteQuickNote(id) {
    if (!confirm('¿Borrar esta nota? Irá a la papelera.')) return
    if (!(await sendToTrash('quick_note', quickNotes.filter(n => n.id === id)))) return
    setQuickNotes(prev => prev.filter(n => n.id !== id))
    if (!navigator.onLine) {
      queueOfflineOp({ table: 'quick_notes', action: 'delete', match: { id } })
      return
    }
    await supabase.from('quick_notes').delete().eq('id', id)
    loadData()
  }

  // ---------- Selección múltiple de notas rápidas ----------
  function toggleNoteSelected(id) {
    setSelectedNoteIds(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]))
  }

  function exitSelectMode() {
    setSelectMode(false)
    setSelectedNoteIds([])
  }

  // En modo selección, tocar la nota la marca (lo hace la tarjeta); fuera de él, abre la nota.
  function openNoteUnlessSelecting(note) {
    if (!selectMode) openEditQuickNoteFull(note)
  }

  async function bulkDeleteQuickNotes() {
    const ids = selectedNoteIds
    if (ids.length === 0) return
    if (!confirm(`¿Borrar ${ids.length} ${ids.length === 1 ? 'nota' : 'notas'}? Irán a la papelera.`)) return
    if (!(await sendToTrash('quick_note', quickNotes.filter(n => ids.includes(n.id))))) return
    setQuickNotes(prev => prev.filter(n => !ids.includes(n.id)))
    exitSelectMode()
    if (!navigator.onLine) {
      ids.forEach(id => queueOfflineOp({ table: 'quick_notes', action: 'delete', match: { id } }))
      return
    }
    const { error } = await supabase.from('quick_notes').delete().in('id', ids)
    if (error) alert('No se pudieron borrar todas las notas: ' + error.message)
    loadData()
  }

  // Junta las notas elegidas (de la más antigua a la más nueva) en una sola nota nueva y borra las originales.
  async function mergeSelectedQuickNotes() {
    const picked = quickNotes
      .filter(n => selectedNoteIds.includes(n.id))
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
    if (picked.length < 2) { alert('Elige al menos 2 notas para unirlas.'); return }
    if (!navigator.onLine) { alert('Para unir notas necesitas conexión a internet.'); return }
    if (!confirm(`Se unirán ${picked.length} notas en una sola y las notas originales se borrarán. ¿Continuar?`)) return

    const blocks = []
    const pushText = (t) => {
      const clean = String(t || '').replace(LS_REGEX, '')
      if (!clean.trim()) return
      const last = blocks[blocks.length - 1]
      if (last && last.type === 'text') blocks[blocks.length - 1] = { ...last, content: last.content + '\n' + clean }
      else blocks.push({ type: 'text', content: clean })
    }
    picked.forEach((n, idx) => {
      if (idx > 0) pushText('────────────')
      if (n.title && n.title.trim()) pushText('[b]' + n.title.trim() + '[/b]')
      const nb = (n.content_blocks && n.content_blocks.length > 0)
        ? n.content_blocks
        : (n.content ? [{ type: 'text', content: n.content }] : [])
      nb.forEach(b => { if (b.type === 'text') pushText(b.content); else blocks.push(b) })
    })

    const firstPhoto = blocks.find(b => b.type === 'photo')
    const allTemp = picked.every(n => n.is_temporary)
    const folders = [...new Set(picked.map(n => n.folder || null))]
    const payload = {
      title: `Notas unidas (${picked.length})`,
      content: blocks.filter(b => b.type === 'text').map(b => b.content).join('\n'),
      content_blocks: blocks,
      color: picked[0].color,
      photo_url: firstPhoto ? firstPhoto.url : null,
      updated_at: new Date().toISOString(),
      folder: folders.length === 1 ? folders[0] : null,
      is_temporary: allTemp,
      review_at: allTemp ? (picked.map(n => n.review_at).filter(Boolean).sort().pop() || dateStrInDays(30)) : null,
      ...(picked.some(n => n.is_favorite) ? { is_favorite: true } : {}),
    }
    let { data: created, error } = await supabase.from('quick_notes').insert(payload).select().single()
    if (error && error.message && (error.message.includes('is_temporary') || error.message.includes('review_at'))) {
      const { is_temporary, review_at, ...rest } = payload
      const retry = await supabase.from('quick_notes').insert(rest).select().single()
      created = retry.data
      error = retry.error
    }
    if (error || !created) { alert('No se pudieron unir las notas: ' + (error ? error.message : 'intenta de nuevo')); return }

    // Solo después de crear la nota unida se borran las originales, para no perder nada si algo falla.
    await sendToTrash('quick_note', picked)
    const del = await supabase.from('quick_notes').delete().in('id', picked.map(n => n.id))
    if (del.error) alert('La nota unida se creó, pero no se pudieron borrar las originales: ' + del.error.message)
    exitSelectMode()
    await loadData()
    openEditQuickNoteFull(created) // se abre para que revises y le cambies el título si quieres
  }

  async function fetchFolderEntries() {
    if (!navigator.onLine) return
    const { data, error } = await supabase.from('day_entries').select('*').not('folder', 'is', null).order('date', { ascending: false })
    if (!error) setFolderEntries(data || [])
  }
  useEffect(() => { if (view === 'carpetas') fetchFolderEntries() }, [view, folderPath])

  // Abre una entrada del día (desde la pestaña Carpetas) en su día
  function openEntryFromFolder(entry) {
    setView('calendario')
    setDayEntries(prev => (prev.some(e => e.id === entry.id) ? prev : [...prev, entry]))
    openDayJournal(entry.date)
    openEditNote(entry)
  }

  // ---------- Carpetas de notas rápidas (con subcarpetas) ----------
  // Una subcarpeta se guarda como ruta con "/": «Familia/Cumpleaños». No hace falta cambiar la base de datos.
  const folderParent = f => (f.includes('/') ? f.slice(0, f.lastIndexOf('/')) : '')
  const folderLeaf = f => f.slice(f.lastIndexOf('/') + 1)
  const folderLabel = f => String(f || '').split('/').join(' › ')
  const inFolder = (n, f) => !!n.folder && (n.folder === f || n.folder.startsWith(f + '/'))
  const cleanFolderPath = raw => String(raw || '').split('/').map(x => x.trim().slice(0, 40)).filter(Boolean).join('/')

  // Todas las rutas, incluyendo las carpetas "padre" que solo existen porque tienen subcarpetas
  const allFolders = (() => {
    const set = new Set()
    ;[...quickNotes.map(n => n.folder).filter(Boolean), ...folderEntries.map(e => e.folder).filter(Boolean), ...extraFolders].forEach(path => {
      const parts = path.split('/')
      for (let k = 1; k <= parts.length; k++) set.add(parts.slice(0, k).join('/'))
    })
    return [...set].sort((a, b) => a.localeCompare(b, 'es'))
  })()

  function saveExtraFolders(list) {
    setExtraFolders(list)
    try { localStorage.setItem('days_extra_folders', JSON.stringify(list)) } catch { /* no pasa nada */ }
  }

  function createFolder(name, parent = '') {
    const leaf = cleanFolderPath(name)
    if (!leaf) return null
    const full = parent ? parent + '/' + leaf : leaf
    if (!allFolders.includes(full)) saveExtraFolders([...extraFolders, full])
    return full
  }

  async function moveNotesToFolder(ids, folder) {
    if (!ids || ids.length === 0) return
    const f = folder || null
    setQuickNotes(prev => prev.map(n => (ids.includes(n.id) ? { ...n, folder: f } : n)))
    if (!navigator.onLine) {
      ids.forEach(id => queueOfflineOp({ table: 'quick_notes', action: 'update', payload: { folder: f }, match: { id } }))
      return
    }
    const { error } = await supabase.from('quick_notes').update({ folder: f }).in('id', ids)
    if (error) alert('No se pudo mover a la carpeta: ' + error.message)
    loadData()
  }

  // Aplica un cambio de ruta a todas las notas (y carpetas vacías) de una carpeta y sus subcarpetas
  async function remapFolderTree(oldPath, mapFn) {
    const inTree = f => f && (f === oldPath || f.startsWith(oldPath + '/'))
    const affected = [...new Set([...quickNotes.map(n => n.folder), ...folderEntries.map(e => e.folder)].filter(inTree))]
    setQuickNotes(prev => prev.map(n => (n.folder && (n.folder === oldPath || n.folder.startsWith(oldPath + '/')) ? { ...n, folder: mapFn(n.folder) } : n)))
    saveExtraFolders([...new Set(extraFolders.map(f => (f === oldPath || f.startsWith(oldPath + '/') ? mapFn(f) : f)).filter(Boolean))])
    for (const f of affected) {
      const { error } = await supabase.from('quick_notes').update({ folder: mapFn(f) }).eq('folder', f)
      if (error) { alert('No se pudo actualizar la carpeta: ' + error.message); break }
      await supabase.from('day_entries').update({ folder: mapFn(f) }).eq('folder', f)
    }
    setFolderEntries(prev => prev.map(e => (inTree(e.folder) ? { ...e, folder: mapFn(e.folder) } : e)))
  }

  async function renameFolder(oldPath, newLeaf) {
    const leaf = cleanFolderPath(newLeaf).replace(/\//g, ' ')
    if (!leaf || leaf === folderLeaf(oldPath)) return
    const parent = folderParent(oldPath)
    const full = parent ? parent + '/' + leaf : leaf
    if (allFolders.includes(full)) { alert('Ya existe una carpeta con ese nombre aquí.'); return }
    if (!navigator.onLine) { alert('Para cambiar el nombre de una carpeta necesitas internet.'); return }
    await remapFolderTree(oldPath, f => full + f.slice(oldPath.length))
    if (noteFolderFilter === oldPath) setNoteFolderFilter(full)
    if (folderPath === oldPath || folderPath.startsWith(oldPath + '/')) setFolderPath(full + folderPath.slice(oldPath.length))
    loadData()
  }

  // Al borrar una carpeta, sus notas y subcarpetas suben un nivel (a la carpeta de arriba); no se borra ninguna nota
  async function deleteFolder(path) {
    const count = quickNotes.filter(n => inFolder(n, path)).length + folderEntries.filter(e => inFolder(e, path)).length
    const parent = folderParent(path)
    const where = parent ? `a «${folderLabel(parent)}»` : 'a "Sin carpeta"'
    if (!confirm(`¿Borrar la carpeta «${folderLabel(path)}»? ${count > 0 ? `Sus ${count} ${count === 1 ? 'nota' : 'notas'} no se borran: pasan ${where}.` : ''}`)) return
    if (!navigator.onLine) { alert('Para borrar una carpeta necesitas internet.'); return }
    await remapFolderTree(path, f => {
      const rest = f.slice(path.length).replace(/^\//, '')
      return [parent, rest].filter(Boolean).join('/') || null
    })
    if (noteFolderFilter === path) setNoteFolderFilter('all')
    if (folderPath === path || folderPath.startsWith(path + '/')) setFolderPath(parent)
    loadData()
  }

  function openNewQuickNoteIn(path) {
    openNewQuickNote()
    setQuickNoteFolder(path || null)
  }

  function renderSelectBar(visible) {
    if (!selectMode) return null
    const n = selectedNoteIds.length
    const allSel = visible.length > 0 && visible.every(x => selectedNoteIds.includes(x.id))
    return (
      <div className="select-bar" role="toolbar">
        <span className="select-bar-count">{n} {n === 1 ? 'elegida' : 'elegidas'}</span>
        <button type="button" onClick={() => setSelectedNoteIds(allSel ? [] : visible.map(x => x.id))}>{allSel ? 'Ninguna' : 'Todas'}</button>
        <button type="button" disabled={n === 0} onClick={() => setFolderPicker({ mode: 'bulk', value: '' })}>📁 Mover</button>
        <button type="button" disabled={n < 2} onClick={mergeSelectedQuickNotes}>🔗 Unir</button>
        <button type="button" className="select-bar-danger" disabled={n === 0} onClick={bulkDeleteQuickNotes}>🗑️ Borrar</button>
        <button type="button" onClick={exitSelectMode}>Cancelar</button>
      </div>
    )
  }

  function renderSelectToggle() {
    return (
      <div className="select-toggle-row">
        <button type="button" className={'select-toggle-btn' + (selectMode ? ' on' : '')} onClick={() => (selectMode ? exitSelectMode() : setSelectMode(true))}>
          {selectMode ? '✕ Salir de selección' : '☑ Elegir varias notas'}
        </button>
      </div>
    )
  }

  async function moveQuickNoteToFolder(id, folder) {
    setQuickNotes(prev => prev.map(n => n.id === id ? { ...n, folder: folder || null } : n))
    setMovingNoteId(null)
    setNewFolderInput('')
    if (!navigator.onLine) {
      queueOfflineOp({ table: 'quick_notes', action: 'update', payload: { folder: folder || null }, match: { id } })
      return
    }
    await supabase.from('quick_notes').update({ folder: folder || null }).eq('id', id)
    loadData()
  }

  // 'YYYY-MM-DD' de hoy + n días (para programar la revisión de notas temporales).
  function dateStrInDays(n) {
    const d = new Date()
    d.setDate(d.getDate() + n)
    return formatDateStr(d)
  }

  // Cambia solo los campos de temporal/revisión de una nota rápida (desde la pantalla de revisión).
  function toggleQuickNoteFavorite(note) {
    updateQuickNoteTemp(note.id, { is_favorite: !note.is_favorite })
  }

  async function updateQuickNoteTemp(id, fields) {
    setQuickNotes(prev => prev.map(n => n.id === id ? { ...n, ...fields } : n))
    if (!navigator.onLine) {
      queueOfflineOp({ table: 'quick_notes', action: 'update', payload: fields, match: { id } })
      return
    }
    const { error } = await supabase.from('quick_notes').update(fields).eq('id', id)
    if (error) {
      alert('No se pudo actualizar la nota: ' + error.message)
      loadData()
    }
  }

  // Evita que el teclado se abra solo al mostrar un editor de nota: si el toque
  // que abrió el editor dejó el foco en un input/botón anterior, se lo quitamos
  // antes de dibujar el nuevo editor (en algunos celulares el foco "sobrevive"
  // al cambio de pantalla y hace saltar el teclado sin que hayas tocado el texto).
  function blurActiveElement() {
    if (document.activeElement && typeof document.activeElement.blur === 'function') {
      document.activeElement.blur()
    }
  }

  // ---------- Editor de página completa para notas rápidas ----------
  function openReminder(kind) {
    const isDay = kind === 'day'
    const blocks = isDay ? freeNoteBlocks : quickNoteBlocks
    const current = isDay ? freeNoteCurrentText : quickNoteCurrentText
    const body = [...(blocks || []).filter(b => b.type === 'text').map(b => b.content || ''), current || '']
      .map(t => stripFormatting(String(t))).join('\n').trim()
    const ownTitle = (isDay ? dayEntryTitle : quickNoteTitle) || ''
    const firstLine = body.split('\n').find(l => l.trim()) || ''
    const tomorrow = new Date(Date.now() + 86400000)
    const iso = tomorrow.getFullYear() + '-' + String(tomorrow.getMonth() + 1).padStart(2, '0') + '-' + String(tomorrow.getDate()).padStart(2, '0')
    setReminder({
      title: (ownTitle.trim() || firstLine.trim()).slice(0, 80),
      notes: body,
      date: iso,
      time: '',
      repeat: 'none',
      alert: 'now',
    })
  }

  function openNewQuickNote() {
    blurActiveElement()
    setShareMenuNoteId(null)
    setEditingQuickNoteId(null)
    setQuickNoteTitle('')
    setQuickNoteColor('#FBEBD4')
    setQuickNoteTemporary(false)
    setQuickNoteFavorite(false)
    setQuickNoteFolder(noteFolderFilter !== 'all' && noteFolderFilter !== 'none' ? noteFolderFilter : null)
    setQuickNoteReviewAt('')
    setQuickNoteBlocks([])
    setQuickNoteCurrentText('')
    setQuickNoteModalOpen(true)
  }

  function openEditQuickNoteFull(note) {
    blurActiveElement()
    setShareMenuNoteId(null)
    setEditingQuickNoteId(note.id)
    setQuickNoteTitle(note.title || '')
    setQuickNoteColor(note.color || '#FBEBD4')
    setQuickNoteTemporary(!!note.is_temporary)
    setQuickNoteFavorite(!!note.is_favorite)
    setQuickNoteFolder(note.folder || null)
    setQuickNoteReviewAt(note.review_at || '')
    const hasBlocks = note.content_blocks && note.content_blocks.length > 0
    setQuickNoteBlocks(hasBlocks ? note.content_blocks : (note.photo_url ? [{ type: 'photo', url: note.photo_url }] : []))
    setQuickNoteCurrentText(hasBlocks ? '' : (note.content || ''))
    setQuickNoteModalOpen(true)
  }

  // Dictado por voz (nota rápida y diario del día), con el reconocimiento de voz nativo
  // del navegador (Chrome en Android lo soporta bien; no necesita librerías).
  // Cada frase reconocida se agrega al texto que ya había, así se puede alternar
  // entre escribir y dictar sin perder nada.
  //
  // El navegador corta la escucha solo después de unos segundos de silencio (y a veces
  // antes), aunque "continuous" esté activado. Por eso mientras tú no pulses ⏹️ el
  // dictado se reinicia solo, y lo que ya se había oído pero aún no se confirmaba como
  // frase final se guarda en vez de perderse.
  function startDictation(kind) {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SpeechRecognition) {
      alert('Tu navegador no soporta dictado por voz. Prueba con Chrome en Android.')
      return
    }
    const isDay = kind === 'day'
    const recRef = isDay ? dayNoteRecognitionRef : quickNoteRecognitionRef
    const setActive = isDay ? setIsDictatingDayNote : setIsDictatingQuickNote
    const appendText = text => {
      const join = prev => (prev.trim() ? prev.trim() + ' ' : '') + text
      if (isDay) {
        setFreeNoteCurrentTextSynced(join)
        scheduleDayNoteAutosave()
      } else {
        setQuickNoteCurrentText(join)
      }
    }

    // En Chrome del celular cada resultado trae TODO lo dicho desde que empezó la escucha
    // ("hoy", "hoy fuimos", "hoy fuimos a..."). Por eso solo se agrega lo que es nuevo
    // respecto a lo último que ya se había guardado en esta escucha.
    let sessionText = ''
    const commitText = raw => {
      const text = (raw || '').trim()
      if (!text) return
      const norm = t => t.toLowerCase().replace(/\s+/g, ' ').trim()
      const t = norm(text)
      const prev = norm(sessionText)
      if (prev && t === prev) return
      if (prev && prev.startsWith(t)) return // llegó una versión más corta de lo ya guardado
      if (prev && t.startsWith(prev)) {
        // Versión más larga: se agrega solo lo que sigue
        const rest = text.slice(sessionText.trim().length).trim()
        sessionText = text
        if (rest) appendText(rest)
        return
      }
      sessionText = text
      appendText(text)
    }

    dictationWantedRef.current[kind] = true
    let pendingInterim = ''
    let lastHeardAt = Date.now() // momento en que se oyó voz por última vez
    const IDLE_LIMIT_MS = 60000 // si pasa 1 minuto sin oír nada, se apaga solo

    const begin = () => {
      sessionText = ''
      const recognition = new SpeechRecognition()
      recognition.lang = 'es-ES'
      recognition.continuous = true
      recognition.interimResults = true

      recognition.onresult = event => {
        lastHeardAt = Date.now()
        let interim = ''
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i]
          if (result.isFinal) {
            commitText(result[0].transcript)
            pendingInterim = ''
          } else {
            interim += result[0].transcript
          }
        }
        if (interim) pendingInterim = interim
        setDictationInterim(interim)
      }

      recognition.onerror = event => {
        const code = event && event.error
        if (code === 'not-allowed' || code === 'service-not-allowed') {
          dictationWantedRef.current[kind] = false
          alert('No se pudo usar el micrófono. Revisa que el navegador tenga permiso para usarlo.')
        } else if (code === 'audio-capture') {
          dictationWantedRef.current[kind] = false
          alert('No se encontró un micrófono disponible.')
        } else if (code === 'network') {
          dictationWantedRef.current[kind] = false
          alert('El dictado necesita conexión a internet y se perdió la señal.')
        }
        // 'no-speech' y 'aborted' no son fallos: onend reinicia la escucha mientras sigas dictando.
      }

      recognition.onend = () => {
        if (pendingInterim.trim()) {
          commitText(pendingInterim)
          pendingInterim = ''
        }
        setDictationInterim('')
        // Si pasa más de un minuto sin oír nada, se apaga solo para no dejar el micrófono abierto.
        if (dictationWantedRef.current[kind] && Date.now() - lastHeardAt > IDLE_LIMIT_MS) dictationWantedRef.current[kind] = false
        if (dictationWantedRef.current[kind]) {
          setTimeout(() => {
            if (!dictationWantedRef.current[kind]) { setActive(false); return }
            try { begin() } catch { dictationWantedRef.current[kind] = false; setActive(false) }
          }, 400)
          return
        }
        setActive(false)
      }

      recRef.current = recognition
      recognition.start()
    }

    try {
      begin()
      setActive(true)
    } catch {
      dictationWantedRef.current[kind] = false
      setActive(false)
    }
  }

  function toggleDictation(kind) {
    const isActive = kind === 'day' ? isDictatingDayNote : isDictatingQuickNote
    if (isActive) {
      dictationWantedRef.current[kind] = false
      const rec = kind === 'day' ? dayNoteRecognitionRef.current : quickNoteRecognitionRef.current
      rec?.stop()
      return
    }
    startDictation(kind)
  }

  function toggleQuickNoteDictation() { toggleDictation('quick') }
  function toggleDayNoteDictation() { toggleDictation('day') }

  // Mete una foto/video justo donde está el cursor (si tocaste un cuadro de texto); si no, al final.
  function insertQuickNoteMedia(block) {
    const act = richStore.active && richStore.active.current
    const sp = act && act.splitAtCaret ? act.splitAtCaret() : null
    const id = sp ? String(sp.fieldId || '') : ''
    const hasText = (t) => String(t || '').replace(LS_REGEX, '').trim() !== ''
    const textBlock = (t) => ({ type: 'text', content: t })
    if (sp && id === 'q:current') {
      setQuickNoteBlocks(prev => [...prev, ...(hasText(sp.before) ? [textBlock(sp.before)] : []), block])
      setQuickNoteCurrentText(hasText(sp.after) ? sp.after : '')
      return
    }
    if (sp && id.indexOf('q:') === 0) {
      const i = parseInt(id.slice(2), 10)
      setQuickNoteBlocks(prev => {
        if (!prev[i] || prev[i].type !== 'text') return [...prev, block]
        return [
          ...prev.slice(0, i),
          ...(hasText(sp.before) ? [textBlock(sp.before)] : []),
          block,
          ...(hasText(sp.after) ? [textBlock(sp.after)] : []),
          ...prev.slice(i + 1),
        ]
      })
      return
    }
    setQuickNoteBlocks(prev => {
      const next = [...prev]
      if (quickNoteCurrentText.trim()) next.push(textBlock(quickNoteCurrentText))
      next.push(block)
      return next
    })
    setQuickNoteCurrentText('')
  }

  function insertPhotoBlockToQuickNote(file) {
    if (!file) return
    insertQuickNoteMedia({ type: 'photo', file })
  }

  function insertVideoBlockToQuickNote(file) {
    if (!file) return
    insertQuickNoteMedia({ type: 'video', file })
  }

  function removeLastQuickNoteBlock() {
    setQuickNoteBlocks(prev => prev.slice(0, -1))
  }

  async function saveQuickNoteFull() {
    const blocks = [...quickNoteBlocks]
    if (quickNoteCurrentText.trim()) blocks.push({ type: 'text', content: quickNoteCurrentText })
    if (blocks.length === 0 && !quickNoteTitle.trim()) return
    setSavingQuickNote(true)

    const finalBlocks = []
    for (const b of blocks) {
      if (b.type === 'text') finalBlocks.push(b)
      else if (b.url) finalBlocks.push(b)
      else {
        const url = await uploadFile(b.file)
        if (url) finalBlocks.push({ type: b.type, url, ...(b.size ? { size: b.size } : {}) })
      }
    }
    const textContent = finalBlocks.filter(b => b.type === 'text').map(b => b.content).join('\n')
    const firstPhoto = finalBlocks.find(b => b.type === 'photo')
    const payload = {
      title: quickNoteTitle,
      content: textContent,
      content_blocks: finalBlocks,
      color: quickNoteColor,
      photo_url: firstPhoto ? firstPhoto.url : null,
      updated_at: new Date().toISOString(),
      is_temporary: quickNoteTemporary,
      review_at: quickNoteTemporary ? (quickNoteReviewAt || dateStrInDays(30)) : null,
      is_favorite: quickNoteFavorite,
      folder: quickNoteFolder || null,
    }
    const saveWith = (pl) => (editingQuickNoteId
      ? supabase.from('quick_notes').update(pl).eq('id', editingQuickNoteId)
      : supabase.from('quick_notes').insert(pl))
    let { error } = await saveWith(payload)

    // Si en Supabase todavía falta alguna columna nueva (fecha de edición, notas temporales,
    // favoritas), la nota se guarda igual sin ese dato y se avisa, para no perder lo escrito.
    const attempt = { ...payload }
    const dropped = []
    for (let k = 0; k < 4 && error && error.message; k++) {
      const col = ['updated_at', 'is_temporary', 'review_at', 'is_favorite'].find(c => error.message.includes(c) && c in attempt)
      if (!col) break
      delete attempt[col]
      dropped.push(col)
      const retry = await saveWith(attempt)
      error = retry.error
    }
    if (!error && dropped.length > 0) {
      if ((dropped.includes('is_temporary') || dropped.includes('review_at')) && quickNoteTemporary) {
        alert('La nota se guardó, pero sin la marca de temporal: faltan las columnas nuevas en Supabase (ejecuta el SQL de notas temporales).')
      }
      if (dropped.includes('is_favorite') && quickNoteFavorite) {
        alert('La nota se guardó, pero sin la estrella: falta ejecutar el SQL de favoritas en Supabase.')
      }
    }

    if (error) { alert('Error al guardar la nota: ' + error.message); setSavingQuickNote(false); return }
    setQuickNoteModalOpen(false)
    setEditingQuickNoteId(null)
    setQuickNoteTitle('')
    setQuickNoteColor('#FBEBD4')
    setQuickNoteTemporary(false)
    setQuickNoteFavorite(false)
    setQuickNoteFolder(null)
    setQuickNoteReviewAt('')
    setQuickNoteBlocks([])
    setQuickNoteCurrentText('')
    setSavingQuickNote(false)
    loadData()
  }

  function wrapText(ctx, text, maxWidth) {
    const words = text.split(' ')
    const lines = []
    let current = ''
    for (const word of words) {
      const test = current ? current + ' ' + word : word
      if (ctx.measureText(test).width > maxWidth && current) {
        lines.push(current)
        current = word
      } else {
        current = test
      }
    }
    if (current) lines.push(current)
    return lines.length > 0 ? lines : ['']
  }

  async function loadImage(url) {
    return new Promise(resolve => {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => resolve(img)
      img.onerror = () => resolve(null)
      img.src = url
    })
  }

  async function renderNoteToImageBlob(note) {
    const width = 720
    const padding = 32
    const contentWidth = width - padding * 2
    const titleFont = 'bold 34px Georgia, serif'
    const bodyFont = '24px Georgia, serif'
    const lineHeight = 34
    const titleLineHeight = 42
    const maxImgHeight = 600

    const hasBlocks = note.content_blocks && note.content_blocks.length > 0
    const blocks = hasBlocks
      ? note.content_blocks
      : (note.content ? [{ type: 'text', content: note.content }] : [])
    const fallbackPhotoUrl = !hasBlocks && note.photo_url ? note.photo_url : null

    const photoUrls = [...blocks.filter(b => b.type === 'photo' && b.url).map(b => b.url), ...(fallbackPhotoUrl ? [fallbackPhotoUrl] : [])]
    const loaded = {}
    for (const url of [...new Set(photoUrls)]) {
      loaded[url] = await loadImage(url)
    }

    const measureCanvas = document.createElement('canvas')
    const mctx = measureCanvas.getContext('2d')

    let y = padding
    let titleLines = []
    if (note.title) {
      mctx.font = titleFont
      titleLines = note.title.split('\n').flatMap(l => wrapText(mctx, l, contentWidth))
      y += titleLines.length * titleLineHeight + 16
    }

    mctx.font = bodyFont
    const captionFont = 'italic 20px Georgia, serif'
    const captionLineHeight = 28
    const measured = blocks.map(b => {
      if (b.type === 'text') {
        const lines = stripFormatting(b.content).replace(/\[t\]\n?/g, '').replace(/\n?\[\/t\]/g, '').split('\n').flatMap(l => wrapText(mctx, l, contentWidth))
        y += lines.length * lineHeight + 16
        return { ...b, lines }
      } else if (b.type === 'photo') {
        const img = loaded[b.url]
        const h = img ? Math.min(img.height * (contentWidth / img.width), maxImgHeight) : 0
        y += h + 16
        let captionLines = []
        if (b.caption) {
          mctx.font = captionFont
          captionLines = wrapText(mctx, b.caption, contentWidth)
          y += captionLines.length * captionLineHeight + 12
          mctx.font = bodyFont
        }
        return { ...b, imgH: h, captionLines }
      }
      return b
    })

    let fallbackImgH = 0
    if (fallbackPhotoUrl) {
      const img = loaded[fallbackPhotoUrl]
      fallbackImgH = img ? Math.min(img.height * (contentWidth / img.width), maxImgHeight) : 0
      y += fallbackImgH + 16
    }

    y += padding

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = Math.max(y, 200)
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = note.color || '#FBEBD4'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.fillStyle = '#3a2f28'
    ctx.textBaseline = 'alphabetic'

    let cursorY = padding
    if (note.title) {
      ctx.font = titleFont
      for (const line of titleLines) {
        cursorY += titleLineHeight
        ctx.fillText(line, padding, cursorY)
      }
      cursorY += 16
    }

    ctx.font = bodyFont
    for (const b of measured) {
      if (b.type === 'text') {
        for (const line of b.lines) {
          cursorY += lineHeight
          ctx.fillText(line, padding, cursorY)
        }
        cursorY += 16
      } else if (b.type === 'photo') {
        const img = loaded[b.url]
        if (img && b.imgH) {
          ctx.drawImage(img, padding, cursorY, contentWidth, b.imgH)
          cursorY += b.imgH + 12
        }
        if (b.captionLines && b.captionLines.length > 0) {
          ctx.font = captionFont
          for (const line of b.captionLines) {
            cursorY += captionLineHeight
            ctx.fillText(line, padding, cursorY)
          }
          ctx.font = bodyFont
          cursorY += 12
        } else {
          cursorY += 4
        }
      }
    }
    if (fallbackPhotoUrl) {
      const img = loaded[fallbackPhotoUrl]
      if (img && fallbackImgH) {
        ctx.drawImage(img, padding, cursorY, contentWidth, fallbackImgH)
        cursorY += fallbackImgH + 16
      }
    }

    return await new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
  }

  // Arma el texto plano de una nota (título + contenido), reutilizado por compartir y descargar.
  function buildQuickNoteText(note) {
    const blocks = (note.content_blocks && note.content_blocks.length > 0)
      ? note.content_blocks
      : (note.content ? [{ type: 'text', content: note.content }] : [])
    const text = blocks.filter(b => b.type === 'text').map(b => formatForShare(b.content)).join('\n\n')
    return (note.title ? note.title + '\n\n' : '') + text
  }

  // Comparte el texto de la nota directo por WhatsApp o correo, con un enlace simple
  // (funciona igual en el celular y en la computadora, sin depender de qué apps tenga
  // registradas el sistema operativo -- eso es lo que hace que en Windows solo salgan
  // apps de Microsoft en el panel nativo).
  // Arma una nota con lo que hay ahora mismo en el editor (incluye lo que aún no se guarda),
  // para que "Compartir" mande siempre lo último que ves.
  function getActiveQuickNoteForShare() {
    const blocks = [...quickNoteBlocks]
    if (quickNoteCurrentText.trim()) blocks.push({ type: 'text', content: quickNoteCurrentText })
    const firstPhoto = blocks.find(b => b.type === 'photo' && b.url)
    return {
      title: quickNoteTitle.trim(),
      content: blocks.filter(b => b.type === 'text').map(b => b.content).join('\n'),
      content_blocks: blocks,
      photo_url: firstPhoto ? firstPhoto.url : null,
      color: quickNoteColor,
    }
  }

  function shareQuickNoteViaWhatsApp(note) {
    const text = buildQuickNoteText(note)
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank')
    setShareMenuNoteId(null)
  }

  function shareQuickNoteViaEmail(note) {
    const subject = note.title || 'Nota de Days'
    const body = buildQuickNoteText(note)
    window.location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
    setShareMenuNoteId(null)
  }

  // Compartir con una cadena de respaldos, para que "no se pueda compartir" deje de pasar:
  // 1) si la nota tiene foto, intenta compartirla como imagen (se ve mejor)
  // 2) si eso falla (CORS, navegador sin soporte, etc.) o la nota es solo texto, comparte el texto
  // 3) si el navegador no tiene navigator.share, copia el texto al portapapeles
  // 4) como último recurso, descarga un .txt
  async function shareQuickNote(note) {
    setShareMenuNoteId(null)
    setSharingNotes(true)
    const textContent = buildQuickNoteText(note)
    const hasPhoto = Boolean(note.photo_url) || (note.content_blocks || []).some(b => b.type === 'photo')

    try {
      if (hasPhoto) {
        try {
          const blob = await renderNoteToImageBlob(note)
          if (blob) {
            const fileName = `${(note.title || 'nota').replace(/[^a-z0-9-_ ]/gi, '').trim() || 'nota'}.png`
            const file = new File([blob], fileName, { type: 'image/png' })
            if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
              await navigator.share({ title: note.title || 'Nota de Days', files: [file] })
              setSharingNotes(false)
              return
            }
          }
        } catch (imgErr) {
          // No se pudo armar/compartir la imagen (típicamente CORS con la foto) --
          // seguimos abajo al respaldo de texto en vez de dejar al usuario sin nada.
        }
      }

      if (navigator.share) {
        await navigator.share({ title: note.title || 'Nota de Days', text: textContent })
      } else if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(textContent)
        alert('Tu navegador no admite compartir directo: se copió el texto de la nota al portapapeles.')
      } else {
        downloadQuickNote(note)
      }
    } catch (err) {
      if (err.name !== 'AbortError') alert('No se pudo compartir la nota. Intenta de nuevo.')
    }
    setSharingNotes(false)
  }

  function downloadQuickNote(note) {
    const full = buildQuickNoteText(note)
    const blob = new Blob([full], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${(note.title || 'nota').replace(/[^a-z0-9-_ ]/gi, '')}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  async function addTag(e) {
    e.preventDefault()
    if (!newTagForm.name.trim()) return
    if (newTagForm.kind === 'secundaria' && !newTagForm.parent_id) {
      alert('Elige a qué etiqueta principal pertenece')
      return
    }
    const payload = {
      name: newTagForm.name,
      color: newTagForm.color,
      parent_id: newTagForm.kind === 'secundaria' ? newTagForm.parent_id : null,
    }
    if (!navigator.onLine) {
      const localId = 'local_' + Date.now()
      setDayTags(prev => [...prev, { id: localId, ...payload }])
      queueOfflineOp({ table: 'day_tags', action: 'insert', payload })
      setNewTagForm({ name: '', color: '#FDE68A', parent_id: '', kind: 'principal' })
      return
    }
    const { error } = await supabase.from('day_tags').insert(payload)
    if (error) { alert('Error al agregar etiqueta: ' + error.message); return }
    setNewTagForm({ name: '', color: '#FDE68A', parent_id: '', kind: 'principal' })
    loadData()
  }

  async function updateTagName(id, name) {
    if (!name.trim()) return
    setDayTags(prev => prev.map(t => t.id === id ? { ...t, name } : t))
    if (!navigator.onLine) {
      queueOfflineOp({ table: 'day_tags', action: 'update', payload: { name }, match: { id } })
      return
    }
    await supabase.from('day_tags').update({ name }).eq('id', id)
    loadData()
  }

  async function updateTagColor(id, color) {
    setDayTags(prev => prev.map(t => t.id === id ? { ...t, color } : t))
    if (!navigator.onLine) {
      queueOfflineOp({ table: 'day_tags', action: 'update', payload: { color }, match: { id } })
      return
    }
    await supabase.from('day_tags').update({ color }).eq('id', id)
    loadData()
  }

  async function deleteTag(id) {
    if (!confirm('¿Borrar esta etiqueta? También se borrarán todas sus entradas.')) return
    setDayTags(prev => prev.filter(t => t.id !== id))
    if (!navigator.onLine) {
      queueOfflineOp({ table: 'day_tags', action: 'delete', match: { id } })
      return
    }
    await supabase.from('day_tags').delete().eq('id', id)
    loadData()
  }

  async function quickAddTask(tagId, dateOverride) {
    const targetDate = dateOverride || selectedDay
    if (!targetDate) return
    const payload = { tag_id: tagId, date: targetDate, note: '', repeat: 'none' }
    if (!navigator.onLine) {
      const localId = 'local_' + Date.now()
      setDayEntries(prev => [...prev, { id: localId, done: false, ...payload }])
      queueOfflineOp({ table: 'day_entries', action: 'insert', payload })
      return
    }
    const { error } = await supabase.from('day_entries').insert(payload)
    if (error) { alert('Error al agregar: ' + error.message); return }
    loadData()
  }

  async function addQuickTask(e) {
    e.preventDefault()
    if (!newTaskText.trim()) return
    const payload = {
      tag_id: newTaskTagId || null,
      date: newTaskDate || todayStr,
      note: newTaskText,
      repeat: 'none',
      done: false,
    }
    if (!navigator.onLine) {
      const localId = 'local_' + Date.now()
      setDayEntries(prev => [...prev, { id: localId, ...payload }])
      queueOfflineOp({ table: 'day_entries', action: 'insert', payload })
      setNewTaskText('')
      return
    }
    const { error } = await supabase.from('day_entries').insert(payload)
    if (error) { alert('Error al guardar la tarea: ' + error.message); return }
    setNewTaskText('')
    loadData()
  }

  async function toggleEntryDone(entry) {
    const newDone = !entry.done
    setDayEntries(prev => prev.map(e => e.id === entry.id ? { ...e, done: newDone } : e))
    if (!navigator.onLine) {
      queueOfflineOp({ table: 'day_entries', action: 'update', payload: { done: newDone }, match: { id: entry.id } })
      return
    }
    await supabase.from('day_entries').update({ done: newDone }).eq('id', entry.id)
    loadData()
  }

  // ---------- Nota libre (con autosave) ----------
  function makeBlockKey() {
    return 'blk_' + Date.now() + '_' + Math.random().toString(36).slice(2)
  }

  // Asegura que cada bloque tenga un _key local estable (no se guarda en la base,
  // solo sirve para identificar el bloque en la UI sin depender de su posición/índice).
  function withStableKeys(blocks) {
    return (blocks || []).map(b => b._key ? b : { ...b, _key: makeBlockKey() })
  }

  // ---------- Editor de fotos (rotar + recortar) antes de anexar ----------

  function canvasToDataUrl(canvas) {
    return canvas.toDataURL('image/jpeg', 0.92)
  }

  // Vista previa del editor: con filtro de documento se calcula sobre una versión reducida para que sea rápida.
  function makePreviewUrl(canvas, filter) {
    if (!filter || filter === 'original') return canvasToDataUrl(canvas)
    const scale = Math.min(1, 1100 / Math.max(canvas.width, canvas.height))
    const small = document.createElement('canvas')
    small.width = Math.max(1, Math.round(canvas.width * scale))
    small.height = Math.max(1, Math.round(canvas.height * scale))
    small.getContext('2d').drawImage(canvas, 0, 0, small.width, small.height)
    return canvasToDataUrl(applyDocFilter(small, filter))
  }

  function changePhotoFilter(f) {
    setPhotoEditorFilter(f)
    setPhotoEditorNotice('')
    if (workingCanvasRef.current) setPhotoEditorPreview(makePreviewUrl(workingCanvasRef.current, f))
  }

  // Busca la hoja en la foto y deja el recuadro de recorte ajustado a ella.
  function detectSheetInEditor() {
    const c = workingCanvasRef.current
    if (!c) return
    const crop = detectPaperCrop(c)
    if (crop) {
      setPhotoEditorCrop(crop)
      setPhotoEditorNotice('Hoja detectada. Ajusta las esquinas si hace falta.')
    } else {
      setPhotoEditorNotice('No pude ver bien los bordes de la hoja. Ajusta el recuadro a mano.')
    }
  }

  // Lee el tag de orientación EXIF (0x0112) directo del header del JPEG, sin librerías.
  // Los celulares guardan la foto "acostada" tal como la capturó el sensor y agregan
  // este dato para decir "hay que rotarla N grados al mostrarla". Si no lo leemos antes
  // de dibujar en el canvas, la foto queda girada -- por eso salían en vertical/horizontal
  // al revés de como se veían en la cámara.
  function readExifOrientation(file) {
    return new Promise(resolve => {
      const reader = new FileReader()
      reader.onload = e => {
        try {
          const view = new DataView(e.target.result)
          if (view.getUint16(0, false) !== 0xFFD8) { resolve(1); return }
          const length = view.byteLength
          let offset = 2
          while (offset < length - 1) {
            const marker = view.getUint16(offset, false)
            offset += 2
            if (marker === 0xFFE1) {
              if (view.getUint32(offset + 2, false) !== 0x45786966) { resolve(1); return }
              const tiffOffset = offset + 8
              const little = view.getUint16(tiffOffset, false) === 0x4949
              const firstIFDOffset = view.getUint32(tiffOffset + 4, little)
              const dirOffset = tiffOffset + firstIFDOffset
              const entries = view.getUint16(dirOffset, little)
              for (let i = 0; i < entries; i++) {
                const entryOffset = dirOffset + 2 + i * 12
                if (view.getUint16(entryOffset, little) === 0x0112) {
                  resolve(view.getUint16(entryOffset + 8, little))
                  return
                }
              }
              resolve(1)
              return
            } else if ((marker & 0xFF00) !== 0xFF00) {
              break
            } else {
              offset += view.getUint16(offset, false)
            }
          }
        } catch (err) { /* JPEG sin EXIF legible: seguimos sin rotar */ }
        resolve(1)
      }
      reader.onerror = () => resolve(1)
      reader.readAsArrayBuffer(file.slice(0, 128 * 1024))
    })
  }

  // Aplica al contexto la transformación que corresponde a cada valor de orientación EXIF
  // (1 = ya viene derecha, no hace falta nada). width/height son los del archivo ORIGINAL,
  // antes de rotar.
  function applyExifTransform(ctx, orientation, width, height) {
    switch (orientation) {
      case 2: ctx.transform(-1, 0, 0, 1, width, 0); break
      case 3: ctx.transform(-1, 0, 0, -1, width, height); break
      case 4: ctx.transform(1, 0, 0, -1, 0, height); break
      case 5: ctx.transform(0, 1, 1, 0, 0, 0); break
      case 6: ctx.transform(0, 1, -1, 0, height, 0); break
      case 7: ctx.transform(0, -1, -1, 0, height, width); break
      case 8: ctx.transform(0, -1, 1, 0, 0, width); break
      default: break // 1: normal
    }
  }

  // Carga el archivo elegido/tomado en un canvas de trabajo oculto y abre el editor.
  // Ya rotado según su EXIF y forzando sRGB (evita que las fotos con colores anchos,
  // típicas de iPhone, salgan artificialmente sobresaturadas al re-codificarlas).
  function openPhotoEditor(file, target = 'day', scan = false) {
    if (!file) return
    photoEditorTargetRef.current = target
    readExifOrientation(file).then(orientation => {
      const img = new Image()
      const objectUrl = URL.createObjectURL(file)
      img.onload = () => {
        const swapped = orientation >= 5 && orientation <= 8
        const w = swapped ? img.naturalHeight : img.naturalWidth
        const h = swapped ? img.naturalWidth : img.naturalHeight
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d', { colorSpace: 'srgb' })
        applyExifTransform(ctx, orientation, img.naturalWidth, img.naturalHeight)
        ctx.drawImage(img, 0, 0)
        workingCanvasRef.current = canvas
        URL.revokeObjectURL(objectUrl)
        const filter = scan ? 'documento' : 'original'
        const crop = scan ? detectPaperCrop(canvas) : null
        setPhotoEditorFilter(filter)
        setPhotoEditorNotice(scan ? (crop ? 'Hoja detectada. Ajusta las esquinas si hace falta.' : 'Ajusta el recuadro a la hoja.') : '')
        setPhotoEditorCrop(crop || { x: 0, y: 0, w: 1, h: 1 })
        setPhotoEditorPreview(makePreviewUrl(canvas, filter))
        setPhotoEditorOpen(true)
      }
      img.src = objectUrl
    })
  }

  // Rota 90° el canvas de trabajo (izquierda o derecha) y refresca la vista previa.
  function rotatePhotoEditor(dir) {
    const src = workingCanvasRef.current
    if (!src) return
    const rotated = document.createElement('canvas')
    rotated.width = src.height
    rotated.height = src.width
    const ctx = rotated.getContext('2d', { colorSpace: 'srgb' })
    if (dir === 'right') {
      ctx.translate(rotated.width, 0)
      ctx.rotate(Math.PI / 2)
    } else {
      ctx.translate(0, rotated.height)
      ctx.rotate(-Math.PI / 2)
    }
    ctx.drawImage(src, 0, 0)
    workingCanvasRef.current = rotated
    setPhotoEditorCrop({ x: 0, y: 0, w: 1, h: 1 })
    setPhotoEditorPreview(makePreviewUrl(rotated, photoEditorFilter))
  }

  // Arrastre del recuadro de recorte: 'move' o una esquina ('nw','ne','sw','se').
  function startCropDrag(mode, e) {
    e.preventDefault()
    e.stopPropagation()
    const point = e.touches ? e.touches[0] : e
    cropDragRef.current = { mode, startX: point.clientX, startY: point.clientY, startCrop: photoEditorCrop }
    window.addEventListener('mousemove', onCropDragMove)
    window.addEventListener('mouseup', onCropDragEnd)
    window.addEventListener('touchmove', onCropDragMove, { passive: false })
    window.addEventListener('touchend', onCropDragEnd)
  }

  function onCropDragMove(e) {
    if (!cropDragRef.current || !cropBoxDisplayRef.current) return
    e.preventDefault()
    const point = e.touches ? e.touches[0] : e
    const rect = cropBoxDisplayRef.current.getBoundingClientRect()
    const { mode, startX, startY, startCrop } = cropDragRef.current
    const dx = (point.clientX - startX) / rect.width
    const dy = (point.clientY - startY) / rect.height
    let { x, y, w, h } = startCrop

    if (mode === 'move') {
      x = clamp(startCrop.x + dx, 0, 1 - startCrop.w)
      y = clamp(startCrop.y + dy, 0, 1 - startCrop.h)
    } else {
      let x2 = startCrop.x + startCrop.w
      let y2 = startCrop.y + startCrop.h
      if (mode.includes('w')) x = clamp(startCrop.x + dx, 0, x2 - 0.05)
      if (mode.includes('e')) x2 = clamp(x2 + dx, startCrop.x + 0.05, 1)
      if (mode.includes('n')) y = clamp(startCrop.y + dy, 0, y2 - 0.05)
      if (mode.includes('s')) y2 = clamp(y2 + dy, startCrop.y + 0.05, 1)
      w = x2 - x
      h = y2 - y
    }
    setPhotoEditorCrop({ x, y, w, h })
  }

  function onCropDragEnd() {
    cropDragRef.current = null
    window.removeEventListener('mousemove', onCropDragMove)
    window.removeEventListener('mouseup', onCropDragEnd)
    window.removeEventListener('touchmove', onCropDragMove)
    window.removeEventListener('touchend', onCropDragEnd)
  }

  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n))
  }

  function closePhotoEditor() {
    setPhotoEditorOpen(false)
    setPhotoEditorPreview(null)
    setPhotoEditorFilter('original')
    setPhotoEditorNotice('')
    workingCanvasRef.current = null
    cropDragRef.current = null
  }

  // Aplica el recorte actual sobre el canvas de trabajo y anexa el resultado como bloque de foto.
  function confirmPhotoEditor() {
    const src = workingCanvasRef.current
    if (!src) { closePhotoEditor(); return }
    const { x, y, w, h } = photoEditorCrop
    const sx = Math.round(x * src.width)
    const sy = Math.round(y * src.height)
    const sw = Math.round(w * src.width)
    const sh = Math.round(h * src.height)
    const out = document.createElement('canvas')
    out.width = sw
    out.height = sh
    out.getContext('2d', { colorSpace: 'srgb' }).drawImage(src, sx, sy, sw, sh, 0, 0, sw, sh)
    let finalCanvas = out
    if (photoEditorFilter !== 'original') {
      // el documento se guarda a un tamaño razonable (máx. 2400 px) con el filtro ya aplicado
      const scale = Math.min(1, 2400 / Math.max(sw, sh))
      const base = document.createElement('canvas')
      base.width = Math.max(1, Math.round(sw * scale))
      base.height = Math.max(1, Math.round(sh * scale))
      base.getContext('2d').drawImage(out, 0, 0, base.width, base.height)
      finalCanvas = applyDocFilter(base, photoEditorFilter)
    }
    finalCanvas.toBlob(blob => {
      if (blob) {
        const file = new File([blob], 'foto_' + Date.now() + '.jpg', { type: 'image/jpeg' })
        if (photoEditorTargetRef.current === 'quicknote') {
          insertPhotoBlockToQuickNote(file)
        } else {
          insertPhotoBlockToNote(file)
        }
      }
      closePhotoEditor()
    }, 'image/jpeg', photoEditorFilter === 'original' ? 0.92 : 0.9)
  }

  // Igual que en notas rápidas: la foto/video entra donde está el cursor; si no hay cursor, al final.
  function insertDayNoteMedia(block) {
    const act = richStore.active && richStore.active.current
    const sp = act && act.splitAtCaret ? act.splitAtCaret() : null
    const id = sp ? String(sp.fieldId || '') : ''
    const hasText = (t) => String(t || '').replace(LS_REGEX, '').trim() !== ''
    const mkText = (t) => ({ type: 'text', content: t, _key: makeBlockKey() })
    const media = () => ({ ...block, _key: makeBlockKey() })
    freeNoteGenRef.current++
    if (sp && id === 'd:current') {
      setFreeNoteBlocksSynced(prev => [...prev, ...(hasText(sp.before) ? [mkText(sp.before)] : []), media()])
      setFreeNoteCurrentTextSynced(hasText(sp.after) ? sp.after : '')
    } else if (sp && id.indexOf('d:') === 0) {
      const key = id.slice(2)
      setFreeNoteBlocksSynced(prev => {
        const i = prev.findIndex(x => x._key === key)
        if (i === -1 || prev[i].type !== 'text') return [...prev, media()]
        return [
          ...prev.slice(0, i),
          ...(hasText(sp.before) ? [{ ...prev[i], content: sp.before }] : []),
          media(),
          ...(hasText(sp.after) ? [mkText(sp.after)] : []),
          ...prev.slice(i + 1),
        ]
      })
    } else {
      setFreeNoteBlocksSynced(prev => {
        const next = [...prev]
        if (freeNoteCurrentText.trim()) next.push(mkText(freeNoteCurrentText))
        next.push(media())
        return next
      })
      setFreeNoteCurrentTextSynced('')
    }
    scheduleDayNoteAutosave()
  }

  // Tamaño con el que se ve una imagen dentro de la nota al editarla: pequeña, mediana o grande
  const PHOTO_SIZES = ['p', 'm', 'g']
  const photoSizeStyle = size => {
    if (size === 'p') return { maxHeight: 70 }
    if (size === 'g') return { maxHeight: 'none', width: '100%' }
    return { maxHeight: 240 }
  }
  function changePhotoSize(kind, ref, dir) {
    const bump = b => {
      const cur = PHOTO_SIZES.indexOf(b.size || 'm')
      const next = Math.max(0, Math.min(PHOTO_SIZES.length - 1, cur + dir))
      return { ...b, size: PHOTO_SIZES[next] }
    }
    if (kind === 'quicknote') {
      setQuickNoteBlocks(prev => prev.map((b, i) => (i === ref ? bump(b) : b)))
    } else {
      freeNoteGenRef.current++
      setFreeNoteBlocksSynced(prev => prev.map(b => (b._key === ref ? bump(b) : b)))
      scheduleDayNoteAutosave()
    }
  }

  // Reemplaza una imagen de la nota por su versión con lo nuevo que se dibujó encima
  function replaceDrawnBlock(kind, edit, file) {
    if (!file) return
    if (kind === 'quicknote') {
      setQuickNoteBlocks(prev => prev.map((b, i) => (i === edit.index ? { type: 'photo', file, size: b.size } : b)))
    } else {
      freeNoteGenRef.current++
      setFreeNoteBlocksSynced(prev => prev.map(b => (b._key === edit.key ? { type: 'photo', file, _key: b._key, size: b.size } : b)))
      scheduleDayNoteAutosave()
    }
  }

  function insertPhotoBlockToNote(file) {
    if (!file) return
    insertDayNoteMedia({ type: 'photo', file })
  }

  function insertVideoBlockToNote(file) {
    if (!file) return
    insertDayNoteMedia({ type: 'video', file })
  }

  function removeLastNoteBlock() {
    freeNoteGenRef.current++
    setFreeNoteBlocksSynced(prev => prev.slice(0, -1))
    scheduleDayNoteAutosave()
  }

  function updateNoteBlockText(key, content) {
    freeNoteGenRef.current++
    setFreeNoteBlocksSynced(prev => prev.map(blk => blk._key === key ? { ...blk, content } : blk))
    scheduleDayNoteAutosave()
  }

  function deleteNoteBlock(key) {
    freeNoteGenRef.current++
    setFreeNoteBlocksSynced(prev => prev.filter(blk => blk._key !== key))
    scheduleDayNoteAutosave()
  }

  function openEditNote(t) {
    setEditingTaskId(t.id)
    noteEntryIdRef.current = t.id
    setFreeNoteBlocksSynced(withStableKeys(t.content_blocks))
    setFreeNoteCurrentTextSynced('')
    setNoteTagIdsSynced(t.tag_ids || (t.tag_id ? [t.tag_id] : []))
    setDayEntryTitleSynced(t.title || '')
    setDayEntryColorSynced(t.color || '#FBEBD4')
    setDayEntryImportantSynced(!!t.important)
    setDayEntryFolderSynced(t.folder || null)
    setDayNoteSaveStatus('saved')
    setExpandedEntryId(t.id)
  }

  function openDayJournal(dateStr) {
    blurActiveElement()
    setWeatherNotice('')
    setSelectedDay(dateStr)
    setDayModalOpen(true)
    const items = dayEntries.filter(t => t.date === dateStr)
    // Si el día ya tiene algo, se ve la lista de tarjetas, todas colapsadas (nada
    // expandido). Tocas ✏️ en la que quieras y se abre ahí mismo, sin cambiar de
    // pantalla. Si el día está vacío, se abre directo un editor en blanco.
    setEditingTaskId(null)
    noteEntryIdRef.current = null
    setFreeNoteBlocksSynced([])
    setNoteTagIdsSynced([])
    setFreeNoteCurrentTextSynced('')
    setDayEntryTitleSynced('')
    setDayEntryColorSynced('#FBEBD4')
    setDayEntryImportantSynced(false)
    setDayEntryFolderSynced(null)
    setDayNoteSaveStatus('saved')
    setExpandedEntryId(items.length > 0 ? null : 'new')
  }

  async function backToDayList() {
    await flushDayNoteAutosave()
    setEditingTaskId(null)
    noteEntryIdRef.current = null
    setFreeNoteBlocksSynced([])
    setNoteTagIdsSynced([])
    setFreeNoteCurrentTextSynced('')
    setDayEntryTitleSynced('')
    setDayEntryColorSynced('#FBEBD4')
    setDayEntryImportantSynced(false)
    setDayEntryFolderSynced(null)
    setDayNoteSaveStatus('saved')
    setExpandedEntryId(null)
  }

  async function startNewEntryFromList() {
    // Si ya había algo abierto (otra entrada expandida), lo guardamos primero --
    // antes esto se borraba sin guardar si tocabas "+ Nueva entrada" con algo
    // abierto en pantalla.
    if (expandedEntryId) await flushDayNoteAutosave()
    blurActiveElement()
    setEditingTaskId(null)
    noteEntryIdRef.current = null
    setFreeNoteBlocksSynced([])
    setNoteTagIdsSynced([])
    setFreeNoteCurrentTextSynced('')
    setDayEntryTitleSynced('')
    setDayEntryColorSynced('#FBEBD4')
    setDayEntryImportantSynced(false)
    setDayEntryFolderSynced(null)
    setDayNoteSaveStatus('saved')
    setExpandedEntryId('new')
  }

  // Devuelve (y fija si hace falta) el id de la entrada que se está editando.
  // Se guarda en un ref -- no en useState -- para que esté disponible al instante,
  // sin esperar al siguiente render. Así todos los autosaves de una misma sesión
  // de edición apuntan siempre al mismo id y nunca se dispara un INSERT duplicado.
  function ensureDayNoteId() {
    if (noteEntryIdRef.current) return noteEntryIdRef.current
    const id = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : 'id_' + Date.now() + '_' + Math.random().toString(36).slice(2)
    noteEntryIdRef.current = id
    setEditingTaskId(id)
    // Si estábamos en "+ Nueva entrada" (expandedEntryId === 'new'), el editor debe
    // pasar a apuntar a este id real apenas se crea -- si no, la nota ya guardada
    // (que ahora sí aparece al instante en la lista) se dibuja duplicada: una vez
    // como tarjeta y otra vez como el editor en blanco que sigue creyendo que es "nueva".
    setExpandedEntryId(prev => prev === 'new' ? id : prev)
    return id
  }

  const isPersistingNoteRef = useRef(false)
  const pendingResaveRef = useRef(false)

  // Guarda la nota del día (texto, bloques y etiquetas) en segundo plano mediante UPSERT
  // por id: si el id ya existe en la tabla lo actualiza, si no, lo crea -- una sola fila
  // por sesión de edición, nunca duplicados. Se llama sola tras el debounce, o de
  // inmediato al cerrar/navegar/cambiar de etiqueta.
  async function persistDayNote() {
    if (!selectedDay) return

    // Si ya hay un guardado en vuelo, no lancemos otro en paralelo (evita carreras
    // de red que puedan pisarse entre sí); marcamos que hace falta un guardado más
    // y lo disparamos apenas termine el actual, con el contenido más reciente.
    if (isPersistingNoteRef.current) {
      pendingResaveRef.current = true
      return
    }

    const draftText = freeNoteCurrentTextRef.current
    const currentBlocks = freeNoteBlocksRef.current
    const currentTagIds = noteTagIdsRef.current
    const currentTitle = dayEntryTitleRef.current
    const currentColor = dayEntryColorRef.current
    const currentImportant = dayEntryImportantRef.current
    const currentFolder = dayEntryFolderRef.current
    const folderFields = (currentFolder || dayEntryFolderTouchedRef.current) ? { folder: currentFolder || null } : {}

    if (currentBlocks.length === 0 && !draftText.trim() && currentTagIds.length === 0 && !currentTitle.trim() && !noteEntryIdRef.current) {
      setDayNoteSaveStatus('saved')
      return
    }

    const id = ensureDayNoteId()
    const startGen = freeNoteGenRef.current
    isPersistingNoteRef.current = true
    setDayNoteSaveStatus('saving')
    setSavingFreeNote(true)

    try {
      if (!navigator.onLine) {
        // Lo que se guarda incluye el borrador en curso (para no perder texto),
        // pero freeNoteBlocks (el estado que dibuja las cajas separadas) NO se toca:
        // el borrador sigue viviendo solo en la caja de abajo hasta que se "cierre" a propósito.
        const blocksToSave = [...currentBlocks]
        if (draftText.trim()) blocksToSave.push({ type: 'text', content: draftText })
        // _key es solo interno de la UI, nunca se guarda en la base.
        const textBlocks = blocksToSave.filter(b => b.type === 'text' || b.url).map(({ _key, ...b }) => b)
        const payload = { id, tag_id: null, tag_ids: currentTagIds, date: selectedDay, note: '', repeat: 'none', content_blocks: textBlocks, title: currentTitle, color: currentColor, important: currentImportant, ...folderFields }
        setDayEntries(prev => prev.some(e => e.id === id)
          ? prev.map(e => e.id === id ? { ...e, content_blocks: textBlocks, tag_ids: currentTagIds, title: currentTitle, color: currentColor, important: currentImportant, ...folderFields } : e)
          : [...prev, { done: false, ...payload }])
        queueOfflineOp({ table: 'day_entries', action: 'upsert', payload, onConflict: 'id' })
        setDayNoteSaveStatus('saved')
        return
      }

      // Resuelve a URL solo los bloques YA comprometidos (fotos/videos pendientes de subir).
      // El borrador en curso se agrega aparte, únicamente para lo que se envía a la base.
      // Conservamos _key en el estado local (para que la UI no pierda identidad de cada
      // bloque), pero lo quitamos de lo que efectivamente viaja a Supabase.
      const resolvedBlocks = []
      for (const b of currentBlocks) {
        if (b.type === 'text' || b.url) {
          resolvedBlocks.push(b)
        } else {
          const url = await uploadFile(b.file)
          if (url) resolvedBlocks.push({ type: b.type, url, caption: b.caption || '', _key: b._key, ...(b.size ? { size: b.size } : {}) })
        }
      }
      const blocksForDb = resolvedBlocks.map(({ _key, ...b }) => b)
      if (draftText.trim()) blocksForDb.push({ type: 'text', content: draftText })

      const fullPayload = { id, tag_id: null, tag_ids: currentTagIds, date: selectedDay, note: '', repeat: 'none', content_blocks: blocksForDb, title: currentTitle, color: currentColor, important: currentImportant, ...folderFields }
      let { error } = await supabase.from('day_entries').upsert(fullPayload, { onConflict: 'id' })

      // Si en Supabase todavía no se agregaron las columnas title/color/important, no
      // dejamos que eso bloquee el autoguardado: reintentamos sin esos campos.
      if (error && error.message && error.message.includes('folder') && 'folder' in fullPayload) {
        const { folder, ...withoutFolder } = fullPayload
        const retryF = await supabase.from('day_entries').upsert(withoutFolder, { onConflict: 'id' })
        error = retryF.error
        if (!error && currentFolder) alert('La entrada se guardó, pero sin carpeta: falta ejecutar el SQL de carpetas para entradas (supabase_carpetas_entradas.sql) en Supabase.')
      }
      if (error && error.message && (error.message.includes('title') || error.message.includes('color') || error.message.includes('important'))) {
        const { title, color, important, ...payloadWithoutNewFields } = fullPayload
        const retry = await supabase.from('day_entries').upsert(payloadWithoutNewFields, { onConflict: 'id' })
        error = retry.error
      }

      if (error) {
        console.error('Error autoguardando la nota:', error.message)
        setDayNoteSaveStatus('error')
        alert('No se pudo guardar la nota: ' + error.message)
        return
      }

      // Actualizamos dayEntries en memoria YA MISMO con el resultado del guardado exitoso
      // (igual que hace la rama offline), en vez de depender únicamente del loadData() de
      // abajo -- ese loadData() no se espera (no lleva await) porque hace 5 consultas
      // seguidas y sería lento bloquear la UI por eso, pero eso mismo abría una ventana:
      // si cerrabas el editor antes de que loadData() terminara, la lista se pintaba
      // todavía con los datos viejos (sin esta entrada) y parecía "no haberse guardado".
      setDayEntries(prev => prev.some(e => e.id === id)
        ? prev.map(e => e.id === id ? { ...e, content_blocks: blocksForDb, tag_ids: currentTagIds, title: currentTitle, color: currentColor, important: currentImportant, ...folderFields } : e)
        : [...prev, { id, tag_id: null, tag_ids: currentTagIds, date: selectedDay, note: '', repeat: 'none', done: false, content_blocks: blocksForDb, title: currentTitle, color: currentColor, important: currentImportant, ...folderFields }])

      // Solo sincronizamos freeNoteBlocks con las URLs recién subidas (si las hubo),
      // y SOLO si nada cambió localmente (editar/borrar un bloque) mientras este guardado
      // estaba en vuelo. Si algo cambió, este resultado ya quedó obsoleto: lo descartamos
      // en vez de pisar la edición más nueva (esto es lo que causaba que un bloque borrado
      // "reapareciera").
      if (freeNoteGenRef.current === startGen) {
        setFreeNoteBlocksSynced(resolvedBlocks)
      }
      setDayNoteSaveStatus('saved')
      // Ya no llamamos a loadData() acá: dayEntries se acaba de actualizar arriba con el
      // resultado real del guardado, así que una recarga completa de fondo (que tarda por
      // hacer 5 consultas seguidas) solo podía llegar tarde y pisar esto con datos viejos
      // -- eso era lo que hacía "parpadear" la nota y que pareciera no guardada.
    } finally {
      setSavingFreeNote(false)
      isPersistingNoteRef.current = false
      if (pendingResaveRef.current) {
        pendingResaveRef.current = false
        persistDayNote()
      }
    }
  }

  // Debounce de 1.5s: agenda un guardado mientras el usuario sigue escribiendo/editando.
  function scheduleDayNoteAutosave() {
    setDayNoteSaveStatus('pending')
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current)
    autosaveTimerRef.current = setTimeout(() => {
      autosaveTimerRef.current = null
      persistDayNote()
    }, 1500)
  }

  // Cancela el debounce pendiente y guarda de inmediato (usado al cerrar o cambiar de día).
  async function flushDayNoteAutosave() {
    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current)
      autosaveTimerRef.current = null
    }
    await persistDayNote()
    // Si persistDayNote se topó con un guardado en vuelo y solo dejó marcada la bandera,
    // esperamos un instante y lo intentamos una vez más para no cerrar con cambios sin guardar.
    if (isPersistingNoteRef.current || pendingResaveRef.current) {
      await persistDayNote()
    }
  }

  function toggleNoteTag(tagId) {
    setNoteTagIdsSynced(prev => prev.includes(tagId) ? prev.filter(id => id !== tagId) : [...prev, tagId])
    scheduleDayNoteAutosave()
  }

  async function createQuickNoteTag(e) {
    e.preventDefault()
    if (!quickTagName.trim()) return
    setCreatingQuickTag(true)
    const payload = { name: quickTagName.trim(), color: quickTagColor, parent_id: null }
    if (!navigator.onLine) {
      const localId = 'local_' + Date.now()
      setDayTags(prev => [...prev, { id: localId, ...payload }])
      queueOfflineOp({ table: 'day_tags', action: 'insert', payload })
      setNoteTagIdsSynced(prev => [...prev, localId])
      setQuickTagName('')
      setCreatingQuickTag(false)
      scheduleDayNoteAutosave()
      return
    }
    const { data, error } = await supabase.from('day_tags').insert(payload).select().single()
    setCreatingQuickTag(false)
    if (error) { alert('Error al crear la etiqueta: ' + error.message); return }
    setQuickTagName('')
    setDayTags(prev => [...prev, data])
    setNoteTagIdsSynced(prev => [...prev, data.id])
    scheduleDayNoteAutosave()
  }

  async function navigateDay(delta) {
    if (!selectedDay) return
    await flushDayNoteAutosave()
    const d = new Date(selectedDay + 'T00:00:00')
    d.setDate(d.getDate() + delta)
    openDayJournal(formatDateStr(d))
  }

  // Guarda la entrada actual (si tenía algo) y abre un editor en blanco para un
  // tema nuevo. La entrada anterior queda guardada con su propio id y aparece en
  // "Otras entradas de este día"; la nueva arranca su propio autosave/id la
  // primera vez que se escriba en ella, así que nunca se mezclan entre sí.
  async function startNewDayNoteBlock() {
    await flushDayNoteAutosave()
    setEditingTaskId(null)
    noteEntryIdRef.current = null
    setFreeNoteBlocksSynced([])
    setFreeNoteCurrentTextSynced('')
    setNoteTagIdsSynced([])
    setDayEntryTitleSynced('')
    setDayEntryColorSynced('#FBEBD4')
    setDayEntryImportantSynced(false)
    setDayEntryFolderSynced(null)
    setTagMenuOpen(false)
    setDayNoteSaveStatus('saved')
    setExpandedEntryId('new')
  }

  async function closeDayJournal() {
    await flushDayNoteAutosave()
    setDayModalOpen(false)
    setEditingTaskId(null)
    noteEntryIdRef.current = null
    setFreeNoteBlocksSynced([])
    setFreeNoteCurrentTextSynced('')
    setNoteTagIdsSynced([])
    setDayEntryTitleSynced('')
    setDayEntryColorSynced('#FBEBD4')
    setDayEntryImportantSynced(false)
    setDayEntryFolderSynced(null)
    setTagMenuOpen(false)
    setDayNoteSaveStatus('saved')
    setExpandedEntryId(null)
  }

  // Ajusta la altura del textarea al contenido real (nada de espacio sobrante ni scroll).
  // Se usa tanto como ref (al montar/reabrir el día) como en cada onChange (mientras escribes).
  function autoGrowTextarea(el) {
    if (!el) return
    el.style.height = 'auto'
    el.style.height = el.scrollHeight + 'px'
  }

  function formatDayHeader(dateStr) {
    const s = new Date(dateStr + 'T00:00:00').toLocaleDateString('es-EC', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    return `${s.charAt(0).toUpperCase() + s.slice(1)} · ${formatElapsedFull(dateStr)}`
  }

  // Fecha relativa en español ("hace 5 min", "ayer", "12 sep 2026") para mostrar
  // cuándo se creó o editó una nota, sin ser tan preciso como para resultar frío.
  // Suaviza cualquier color hex a un tono pastel (baja la saturación, sube la
  // luminosidad). Se aplica al pintar tarjetas de notas para que se vean parejas
  // y suaves sin importar qué color se haya guardado -- incluye notas viejas,
  // sin necesidad de volver a guardarlas ni tocar la base de datos.
  function pastelize(hex) {
    if (!hex) return hex
    const clean = hex.replace('#', '')
    const full = clean.length === 3 ? clean.split('').map(c => c + c).join('') : clean
    const bigint = parseInt(full, 16)
    if (isNaN(bigint)) return hex
    const r = (bigint >> 16) & 255, g = (bigint >> 8) & 255, b = bigint & 255
    const r1 = r / 255, g1 = g / 255, b1 = b / 255
    const max = Math.max(r1, g1, b1), min = Math.min(r1, g1, b1)
    let h = 0, s = 0
    const l = (max + min) / 2
    if (max !== min) {
      const d = max - min
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
      if (max === r1) h = (g1 - b1) / d + (g1 < b1 ? 6 : 0)
      else if (max === g1) h = (b1 - r1) / d + 2
      else h = (r1 - g1) / d + 4
      h /= 6
    }
    const newS = Math.min(s, 0.45)
    const newL = Math.max(l, 0.82)
    function hue2rgb(p, q, t) {
      if (t < 0) t += 1
      if (t > 1) t -= 1
      if (t < 1 / 6) return p + (q - p) * 6 * t
      if (t < 1 / 2) return q
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
      return p
    }
    let r2, g2, b2
    if (newS === 0) { r2 = g2 = b2 = newL }
    else {
      const q = newL < 0.5 ? newL * (1 + newS) : newL + newS - newL * newS
      const p = 2 * newL - q
      r2 = hue2rgb(p, q, h + 1 / 3)
      g2 = hue2rgb(p, q, h)
      b2 = hue2rgb(p, q, h - 1 / 3)
    }
    const toHex = v => Math.round(v * 255).toString(16).padStart(2, '0')
    return `#${toHex(r2)}${toHex(g2)}${toHex(b2)}`
  }

  // Título mostrado de una nota: el que escribió el usuario, o si no puso ninguno,
  // la primera línea del contenido (recortada). El resto del contenido se ve
  // como vista previa aparte, truncada por CSS -- así todas las tarjetas quedan
  // del mismo tamaño sin importar qué tan larga sea la nota.
  function getQuickNoteTitle(note) {
    if (note.title && note.title.trim()) return note.title.trim()
    const firstLine = (note.content || '').replace(LS_REGEX, '').split('\n').find(l => l.trim())
    if (!firstLine || firstLine.trim() === '[t]') return '' // si empieza con una tabla, no hay título automático
    return firstLine.length > 60 ? firstLine.slice(0, 60) + '…' : firstLine
  }

  // Vista previa del contenido: si el título vino de la primera línea (no hay título
  // propio), no la repetimos aquí abajo -- mostramos desde la segunda línea en adelante.
  function getQuickNotePreview(note) {
    if (!note.title || !note.title.trim()) {
      const lines = (note.content || '').replace(LS_REGEX, '').split('\n')
      const firstIdx = lines.findIndex(l => l.trim())
      if (firstIdx !== -1 && lines[firstIdx].trim() === '[t]') return lines.join('\n')
      if (firstIdx !== -1) return lines.slice(firstIdx + 1).join('\n').trim()
    }
    return note.content || ''
  }

  // Quita tildes/diacríticos y pasa a minúsculas, para que "operacion" encuentre
  // "Operación" sin importar el acento.
  function normalizeSearchText(s) {
    return (s || '').toString().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  }

  // Una búsqueda con varias palabras (ej. "mami operacion") encuentra resultados
  // donde aparezcan TODAS esas palabras en cualquier parte del texto -- no exige
  // que estén pegadas ni en ese orden, como antes.
  function matchesSearch(haystack, query) {
    const terms = normalizeSearchText(query).split(/\s+/).filter(Boolean)
    if (terms.length === 0) return true
    const normalizedHay = normalizeSearchText(haystack)
    return terms.every(term => normalizedHay.includes(term))
  }

  function formatRelativeDate(dateStr) {
    if (!dateStr) return ''
    const date = new Date(dateStr)
    if (isNaN(date.getTime())) return ''
    const diffMs = Date.now() - date.getTime()
    const diffMin = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMs / 3600000)
    const diffDays = Math.floor(diffMs / 86400000)
    if (diffMin < 1) return 'ahora mismo'
    if (diffMin < 60) return `hace ${diffMin} min`
    if (diffHours < 24) return `hace ${diffHours} h`
    if (diffDays === 1) return 'ayer'
    if (diffDays < 7) return `hace ${diffDays} días`
    return `${date.toLocaleDateString('es-EC', { day: 'numeric', month: 'short', year: 'numeric' })} · ${formatElapsedFull(date)}`
  }

  // Tiempo transcurrido detallado (años, meses, días) para mostrar junto a cualquier fecha.
  // Acepta un string 'YYYY-MM-DD' o una fecha/ISO completa. Cálculo exacto por calendario.
  function formatElapsedFull(input) {
    const start = (typeof input === 'string' && !input.includes('T'))
      ? new Date(input + 'T00:00:00')
      : new Date(input)
    const now = new Date()
    const future = start > now
    const [from, to] = future ? [now, start] : [start, now]

    let years = to.getFullYear() - from.getFullYear()
    let months = to.getMonth() - from.getMonth()
    let days = to.getDate() - from.getDate()
    if (days < 0) {
      months -= 1
      days += new Date(to.getFullYear(), to.getMonth(), 0).getDate()
    }
    if (months < 0) {
      years -= 1
      months += 12
    }
    if (years === 0 && months === 0 && days === 0) return 'Hoy'
    const parts = []
    if (years > 0) parts.push(`${years} año${years === 1 ? '' : 's'}`)
    if (months > 0) parts.push(`${months} mes${months === 1 ? '' : 'es'}`)
    if (days > 0 || parts.length === 0) parts.push(`${days} día${days === 1 ? '' : 's'}`)
    return (future ? 'En ' : 'Hace ') + parts.join(', ')
  }

  // Se guarda también al desmontar el modal (ej. cierre abrupto) para no perder cambios pendientes.
  useEffect(() => {
    return () => {
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current)
        autosaveTimerRef.current = null
      }
    }
  }, [])

  async function deleteTask(id) {
    if (!(await sendToTrash('day_entry', dayEntries.filter(e => e.id === id)))) return
    setDayEntries(prev => prev.filter(e => e.id !== id))
    if (!navigator.onLine) {
      queueOfflineOp({ table: 'day_entries', action: 'delete', match: { id } })
      return
    }
    await supabase.from('day_entries').delete().eq('id', id)
    loadData()
  }

  async function deleteSeries(seriesId) {
    if (!confirm('¿Eliminar esta tarea repetitiva y todas sus fechas futuras? El historial pasado no se borra.')) return
    if (!(await sendToTrash('day_entry', dayEntries.filter(e => e.series_id === seriesId && e.date >= todayStr)))) return
    setDayEntries(prev => prev.filter(e => !(e.series_id === seriesId && e.date >= todayStr)))
    if (!navigator.onLine) {
      queueOfflineOp({ table: 'day_entries', action: 'delete', match: { series_id: seriesId }, matchGte: { date: todayStr } })
      return
    }
    await supabase.from('day_entries').delete().eq('series_id', seriesId).gte('date', todayStr)
    loadData()
  }

  async function rescheduleTask(entry) {
    const newDate = prompt('Nueva fecha (AAAA-MM-DD):', entry.date)
    if (!newDate || newDate === entry.date) return
    setDayEntries(prev => prev.map(e => e.id === entry.id ? { ...e, date: newDate } : e))
    if (!navigator.onLine) {
      queueOfflineOp({ table: 'day_entries', action: 'update', payload: { date: newDate }, match: { id: entry.id } })
      return
    }
    await supabase.from('day_entries').update({ date: newDate }).eq('id', entry.id)
    loadData()
  }

  function buildRepeatDates(startDateStr, repeat, customDays) {
    const dates = [startDateStr]
    if (repeat === 'none') return dates
    const [y, m, d] = startDateStr.split('-').map(Number)
    const count = repeat === 'monthly' ? 12 : repeat === 'custom' ? 20 : 16
    for (let i = 1; i < count; i++) {
      const next = new Date(y, m - 1, d)
      if (repeat === 'weekly') next.setDate(next.getDate() + 7 * i)
      else if (repeat === 'biweekly') next.setDate(next.getDate() + 14 * i)
      else if (repeat === 'monthly') next.setMonth(next.getMonth() + i)
      else if (repeat === 'custom') next.setDate(next.getDate() + (Number(customDays) || 1) * i)
      dates.push(formatDateStr(next))
    }
    return dates
  }

  async function addTaskFull(e) {
    e.preventDefault()
    const effectiveDate = taskForm.date || todayStr
    if (!taskForm.tag_id || !effectiveDate) {
      alert('Selecciona una etiqueta y una fecha')
      return
    }
    if (taskForm.repeat === 'custom' && !taskForm.customDays) {
      alert('Escribe cada cuántos días se repite')
      return
    }
    const dates = buildRepeatDates(effectiveDate, taskForm.repeat, taskForm.customDays)
    const seriesId = editingSeriesId || crypto.randomUUID()
    const rows = dates.map(date => ({ tag_id: taskForm.tag_id, date, note: taskForm.note, repeat: taskForm.repeat, series_id: seriesId }))

    if (!navigator.onLine) {
      if (editingSeriesId) {
        setDayEntries(prev => prev.filter(en => !(en.series_id === editingSeriesId && en.date >= todayStr)))
        queueOfflineOp({ table: 'day_entries', action: 'delete', match: { series_id: editingSeriesId }, matchGte: { date: todayStr } })
      }
      setDayEntries(prev => [...prev, ...rows.map((r, i) => ({ id: 'local_' + Date.now() + '_' + i, done: false, ...r }))])
      queueOfflineOp({ table: 'day_entries', action: 'insert', payload: rows })
      setTaskForm({ tag_id: '', date: '', note: '', repeat: 'weekly', customDays: '' })
      setEditingSeriesId(null)
      setTaskFormOpen(false)
      return
    }

    if (editingSeriesId) {
      // Borra solo las ocurrencias futuras/hoy de esta serie; conserva el historial pasado
      await supabase.from('day_entries').delete().eq('series_id', editingSeriesId).gte('date', todayStr)
    }

    const { error } = await supabase.from('day_entries').insert(rows)
    if (error) { alert('Error al guardar: ' + error.message); return }
    setTaskForm({ tag_id: '', date: '', note: '', repeat: 'weekly', customDays: '' })
    setEditingSeriesId(null)
    setTaskFormOpen(false)
    loadData()
  }

  function editTaskSeries(entry) {
    setEditingSeriesId(entry.series_id)
    setTaskForm({
      tag_id: entry.tag_id || '',
      date: entry.date >= todayStr ? entry.date : todayStr,
      note: entry.note || '',
      repeat: entry.repeat && entry.repeat !== 'none' ? entry.repeat : 'weekly',
      customDays: '',
    })
    setTimeout(() => {
      document.getElementById('recurring-task-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 50)
  }

  async function urlToFile(url) {
    try {
      const res = await fetch(url)
      const blob = await res.blob()
      const name = url.split('/').pop().split('?')[0]
      return new File([blob], name, { type: blob.type })
    } catch {
      return null
    }
  }

  // Arma un objeto "entrada" con lo que hay ahora mismo en pantalla para la nota
  // activa del día -- incluye lo que todavía no terminó de autoguardarse, para
  // que "Compartir" siempre mande lo último que ves, no una versión vieja.
  function getActiveEntryForShare() {
    const blocks = [...freeNoteBlocks]
    if (freeNoteCurrentText.trim()) blocks.push({ type: 'text', content: freeNoteCurrentText })
    return { date: selectedDay, content_blocks: blocks }
  }

  function buildDayEntryText(t) {
    const header = `📓 Days (${new Date(t.date + 'T00:00:00').toLocaleDateString()})`
    const textBlocks = (t.content_blocks || []).filter(b => b.type === 'text').map(b => formatForShare(b.content)).join('\n')
    return textBlocks ? `${header}:\n${textBlocks}` : header
  }

  function shareDayEntryViaWhatsApp(t) {
    window.open(`https://wa.me/?text=${encodeURIComponent(buildDayEntryText(t))}`, '_blank')
    setShareMenuEntryId(null)
  }

  function shareDayEntryViaEmail(t) {
    const subject = `Nota de Days — ${new Date(t.date + 'T00:00:00').toLocaleDateString()}`
    window.location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(buildDayEntryText(t))}`
    setShareMenuEntryId(null)
  }

  async function shareEntry(t) {
    setShareMenuEntryId(null)
    setSharingNotes(true)
    const shareText = buildDayEntryText(t)
    const hasVideo = (t.content_blocks || []).some(b => b.type === 'video')
    const hasPhoto = (t.content_blocks || []).some(b => b.type === 'photo' && b.url)

    try {
      if (hasPhoto && !hasVideo) {
        // Texto + fotos (con su descripción) combinados en UNA sola imagen, para que
        // se vea completo en WhatsApp/correo/etc. en vez de mandar varios archivos
        // sueltos sin conexión visual entre ellos.
        try {
          const blob = await renderNoteToImageBlob({ content_blocks: t.content_blocks })
          if (blob) {
            const file = new File([blob], 'nota_' + Date.now() + '.png', { type: 'image/png' })
            if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
              await navigator.share({ title: 'Nota de Days', files: [file] })
              setSharingNotes(false)
              return
            }
          }
        } catch (imgErr) {
          // No se pudo armar la imagen combinada (típicamente CORS) -- seguimos
          // abajo al respaldo de solo texto en vez de dejar al usuario sin nada.
        }
      } else if (hasVideo) {
        // Un video no se puede "pintar" dentro de una imagen combinada: se comparte
        // como archivo aparte (junto con cualquier foto que también tenga la nota).
        const fileUrls = (t.content_blocks || []).filter(b => (b.type === 'photo' || b.type === 'video') && b.url).map(b => b.url)
        const files = (await Promise.all(fileUrls.map(urlToFile))).filter(Boolean)
        if (navigator.share && files.length > 0 && navigator.canShare && navigator.canShare({ files })) {
          await navigator.share({ title: 'Nota de Days', text: shareText, files })
          setSharingNotes(false)
          return
        }
      }

      if (navigator.share) {
        await navigator.share({ title: 'Nota de Days', text: shareText })
      } else if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(shareText)
        alert('Tu navegador no admite compartir directo: se copió el texto al portapapeles.')
      } else {
        window.open(`https://wa.me/?text=${encodeURIComponent(shareText)}`, '_blank')
      }
    } catch (err) {
      if (err.name !== 'AbortError') alert('No se pudo compartir. Intenta de nuevo.')
    }
    setSharingNotes(false)
  }

  function highlightMatch(text, term) {
    if (!term) return text
    const parts = text.split(new RegExp(`(${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'ig'))
    return parts.map((part, i) =>
      part.toLowerCase() === term.toLowerCase()
        ? <mark key={i} className="search-highlight">{part}</mark>
        : part
    )
  }

  // ---------- Enlaces dentro del texto de las notas ----------
  // Detecta http(s):// y www. (solo esos esquemas, nunca javascript:) y los convierte en
  // enlaces que se abren en una pestaña nueva, sin abrir la nota al tocarlos.
  const URL_SPLIT_REGEX = /((?:https?:\/\/|www\.)[^\s<>"]+)/gi

  // Separa un enlace de la puntuación pegada al final ("mira https://x.com/a)." → enlace + ").")
  function splitUrlTrail(raw) {
    const m = raw.match(/^(.*?)([.,;:!?)\]}'»”]*)$/)
    const url = m ? m[1] : raw
    const trail = m ? m[2] : ''
    return { url, trail, href: /^www\./i.test(url) ? 'https://' + url : url }
  }

  function extractUrls(text) {
    const found = (String(text || '').match(URL_SPLIT_REGEX) || []).map(splitUrlTrail)
    const seen = new Set()
    return found.filter(f => f.url && !seen.has(f.href) && seen.add(f.href))
  }

  // Texto con enlaces clicables (y lo buscado resaltado), sin formato.
  function renderPlainLinked(text, term) {
    return String(text).split(URL_SPLIT_REGEX).map((part, i) => {
      if (i % 2 === 1) {
        const { url, trail, href } = splitUrlTrail(part)
        return (
          <span key={i}>
            <a href={href} target="_blank" rel="noopener noreferrer" className="note-link" onClick={e => e.stopPropagation()}>{url}</a>
            {trail}
          </span>
        )
      }
      return <span key={i}>{term ? highlightMatch(part, term) : part}</span>
    })
  }

  // Devuelve el texto con enlaces clicables y con su formato (negrita, cursiva, subrayado, letra).
  // Marcas sin cerrar se aplican hasta el final del texto (útil en vistas previas cortadas).
  function renderLinkedText(text, term) {
    if (!text) return text
    let str = String(text)
    if (str.indexOf('[') === -1) return renderPlainLinked(str, term)
    let lineH = null
    const lsm = str.match(LS_REGEX)
    if (lsm) { lineH = lsm[1]; str = str.slice(lsm[0].length) }
    if (str.indexOf('[t]') !== -1) {
      // texto con tablas: cada tabla se dibuja como tabla y el resto como texto con formato
      const re = new RegExp(TABLE_SPLIT_SOURCE, 'g')
      const lsPrefix = lineH ? '[ls=' + lineH + ']' : ''
      const parts = []
      let last = 0
      let tm
      let k = 0
      while ((tm = re.exec(str)) !== null) {
        let before = str.slice(last, tm.index)
        if (before.slice(-1) === '\n') before = before.slice(0, -1)
        if (before) parts.push(<span key={'p' + k++}>{renderLinkedText(lsPrefix + before, term)}</span>)
        const rows = tm[1].split('\n').map(r => r.split('|').map(c => c.trim()))
        parts.push(
          <span key={'t' + k++} className="note-table-wrap">
            <table className="note-table note-table-view">
              <tbody>
                {rows.map((r, ri) => (
                  <tr key={ri}>{r.map((c, ci) => <td key={ci}>{renderLinkedText(c, term)}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </span>
        )
        last = tm.index + tm[0].length
        if (str.charAt(last) === '\n') last++
      }
      const rest = str.slice(last)
      if (rest) parts.push(<span key={'p' + k++}>{renderLinkedText(lsPrefix + rest, term)}</span>)
      return parts
    }
    const out = []
    const st = { b: 0, i: 0, u: 0, f: [] }
    let last = 0
    let n = 0
    const push = (seg) => {
      if (!seg) return
      const style = {}
      if (lineH) style.lineHeight = lineH
      if (st.b > 0) style.fontWeight = 700
      if (st.i > 0) style.fontStyle = 'italic'
      if (st.u > 0) style.textDecoration = 'underline'
      if (st.f.length > 0) style.fontFamily = FMT_FONTS[st.f[st.f.length - 1]].css
      out.push(<span key={'f' + n++} style={style}>{renderPlainLinked(seg, term)}</span>)
    }
    const re = new RegExp(FMT_TAG_REGEX.source, 'g')
    let m
    while ((m = re.exec(str)) !== null) {
      const closing = m[1] === '/'
      const kind = m[2]
      if (kind === 'f' && !closing && !FMT_FONTS[m[3]]) continue
      push(str.slice(last, m.index))
      last = m.index + m[0].length
      if (kind === 'f') {
        if (closing) st.f.pop()
        else st.f.push(m[3])
      } else {
        st[kind] = Math.max(0, st[kind] + (closing ? -1 : 1))
      }
    }
    push(str.slice(last))
    return out
  }

  function textColorFor(hex) {
    if (!hex) return '#fff'
    const h = hex.replace('#', '')
    const r = parseInt(h.substring(0, 2), 16)
    const g = parseInt(h.substring(2, 4), 16)
    const b = parseInt(h.substring(4, 6), 16)
    const brightness = (r * 299 + g * 587 + b * 114) / 1000
    return brightness > 165 ? '#3a3a2e' : '#fff'
  }

  function formatDateStr(d) {
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
  }

  function changeMonth(delta) {
    setCalendarMonth(prev => {
      const d = new Date(prev)
      d.setMonth(d.getMonth() + delta)
      return d
    })
    setSelectedDay(null)
  }

  // ---------- Pantallas de autenticación ----------
  if (sharedListId) {
    return (
      <div className="admin" style={{ maxWidth: 480 }}>
        <div className="admin-header">
          <h1>🛒 {sharedList?.title || 'Lista'}</h1>
        </div>
        <hr className="admin-divider" />
        {sharedLoading ? (
          <p className="status-msg">Cargando...</p>
        ) : !sharedList ? (
          <p className="status-msg">No se encontró esta lista.</p>
        ) : (
          <>
            {!isStandalone && !pinHidden && (
              <div className="admin-form" style={{ gap: 8 }}>
                <strong>📌 Guarda esta lista en tu celular</strong>
                <span style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>Así la abres con un toque, sin buscar el enlace en WhatsApp.</span>
                {installEvent ? (
                  <button type="button" onClick={async () => { installEvent.prompt(); try { await installEvent.userChoice } catch { /* ignorar */ } setInstallEvent(null) }}>
                    📲 Agregar a la pantalla de inicio
                  </button>
                ) : (
                  <span style={{ fontSize: '0.85rem' }}>
                    {isIOS
                      ? 'iPhone: toca el botón Compartir (el cuadro con una flecha) y elige “Añadir a pantalla de inicio”.'
                      : 'Android: toca el menú ⋮ del navegador y elige “Agregar a la pantalla de inicio” (o “Instalar app”).'}
                  </span>
                )}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <button type="button" onClick={copyListLink}>{linkCopied ? '✅ Enlace copiado' : '🔗 Copiar enlace'}</button>
                  <button
                    type="button"
                    onClick={() => { try { localStorage.setItem(pinKey, '1') } catch { /* ignorar */ } setPinHidden(true) }}
                    style={{ background: 'none', border: 'none', boxShadow: 'none', color: 'var(--muted)', textDecoration: 'underline', fontWeight: 600 }}
                  >
                    Ya la guardé
                  </button>
                </div>
              </div>
            )}
            <form className="admin-form" onSubmit={sharedAddItem} style={{ flexDirection: 'row', gap: 8 }}>
              <input
                placeholder="Agregar algo a la lista..."
                value={sharedNewItemText}
                onChange={e => setSharedNewItemText(e.target.value)}
                style={{ flex: 1 }}
              />
              <button type="submit">➕</button>
            </form>
            <div className="day-task-list">
              {sharedItems.length === 0 ? (
                <p className="status-msg">La lista está vacía. Agrega el primer artículo arriba.</p>
              ) : (
                sharedItems.map(item => (
                  <div key={item.id} className={`day-task-item ${item.done ? 'done' : ''}`}>
                    <div className="day-task-row">
                      <input type="checkbox" checked={!!item.done} onChange={() => sharedToggleItem(item)} />
                      <span className="task-tag-name">{item.content}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
            <p style={{ fontSize: '0.75rem', color: 'var(--muted)', marginTop: 16, textAlign: 'center' }}>
              Esta lista se comparte por Days — cualquiera con este link puede ver y agregar artículos.
            </p>
          </>
        )}
      </div>
    )
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
        <h2>Days</h2>
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

  // ---------- Datos derivados del calendario ----------
  const calYear = calendarMonth.getFullYear()
  const calMonth = calendarMonth.getMonth()
  const calFirstDay = new Date(calYear, calMonth, 1)
  const calStartOffset = calFirstDay.getDay()
  const calDaysInMonth = new Date(calYear, calMonth + 1, 0).getDate()
  const calMonthLabel = calendarMonth.toLocaleDateString('es-EC', { month: 'long', year: 'numeric' })
  const todayStr = formatDateStr(new Date())
  // Notas temporales: las que ya llegaron a su fecha de revisión y las que aún están programadas.
  const temporaryQuickNotes = quickNotes.filter(n => n.is_temporary && n.review_at)
  const dueQuickNotes = temporaryQuickNotes
    .filter(n => n.review_at <= todayStr)
    .sort((x, y) => x.review_at.localeCompare(y.review_at))
  const upcomingQuickNotes = temporaryQuickNotes
    .filter(n => n.review_at > todayStr)
    .sort((x, y) => x.review_at.localeCompare(y.review_at))

  const calCells = []
  for (let i = 0; i < calStartOffset; i++) calCells.push(null)
  for (let d = 1; d <= calDaysInMonth; d++) calCells.push(new Date(calYear, calMonth, d))

  const entriesByDay = {}
  dayEntries.forEach(t => {
    if (!entriesByDay[t.date]) entriesByDay[t.date] = []
    entriesByDay[t.date].push(t)
  })

  const entriesByDayFiltered = {}
  function groupIdOf(tagId) {
    const tag = dayTags.find(t => t.id === tagId)
    if (!tag) return tagId
    return tag.parent_id || tag.id
  }
  dayEntries
    .filter(t => visibleTagIds.length === 0 || visibleTagIds.includes(groupIdOf(t.tag_id)))
    .forEach(t => {
      if (!entriesByDayFiltered[t.date]) entriesByDayFiltered[t.date] = []
      entriesByDayFiltered[t.date].push(t)
    })

  function toggleVisibleTag(id) {
    setVisibleTagIds(prev => prev.includes(id) ? prev.filter(t => t !== id) : [...prev, id])
  }

  return (
    <div className={`admin ${darkMode ? 'dark-mode' : ''}`}>
      <div className="admin-header admin-header-banner">
        <button className="hamburger-btn" onClick={() => setMainMenuOpen(true)} aria-label="Menú">☰</button>
        <img src="/logo-days.png" alt="Days" className="app-logo-banner-img" />
      </div>
      {fullBackupMsg && (
        <p className="offline-banner offline-banner-syncing">📦 Respaldo completo: {fullBackupMsg}</p>
      )}
      {isOffline && (
        <p className="offline-banner">📡 Sin conexión — puedes seguir escribiendo, se guardará en tu celular y se subirá solo cuando vuelva la señal</p>
      )}
      {!isOffline && pendingSync > 0 && (
        <p className="offline-banner offline-banner-syncing">🔄 Subiendo {pendingSync} cambio{pendingSync > 1 ? 's' : ''} pendiente{pendingSync > 1 ? 's' : ''}...</p>
      )}
      <hr className="admin-divider" />
      <div className="home-shortcuts-row">
        <div className="home-shortcuts-left">
          <button type="button" className="quick-note-shortcut-btn" onClick={() => setView('buscar')} title="Buscar" aria-label="Buscar">🔍</button>
          <button type="button" className="quick-note-shortcut-btn" onClick={() => { setShowOnlyFavNotes(true); setView('notas') }} title="Notas favoritas" aria-label="Notas favoritas">⭐</button>
          <button
            type="button"
            className={'quick-note-shortcut-btn backup-btn' + (lastBackupDate !== formatDateStr(new Date()) ? ' pending' : '')}
            onClick={exportBackup}
            disabled={backingUp}
            title={lastBackupDate === formatDateStr(new Date()) ? 'Respaldo de hoy listo (toca para repetirlo)' : 'Falta el respaldo de hoy: toca para guardarlo'}
            aria-label="Respaldo"
          >💾</button>
          <button type="button" className="quick-note-shortcut-btn" onClick={() => setView('carpetas')} title="Carpetas" aria-label="Carpetas">📁</button>
        </div>
        <button type="button" className="quick-note-shortcut-btn" onClick={() => { setShowOnlyFavNotes(false); setView('notas') }} title="Notas rápidas" style={{ position: 'relative' }}>
          📓
          {dueQuickNotes.length > 0 && <span className="temp-count-badge" aria-label={`${dueQuickNotes.length} notas temporales por revisar`}>{dueQuickNotes.length}</span>}
        </button>
      </div>

      <div className={`tag-menu-overlay main-menu-overlay ${mainMenuOpen ? 'open' : ''}`} onClick={() => setMainMenuOpen(false)}>
        <div className="tag-menu-panel main-menu-panel" onClick={e => e.stopPropagation()}>
            <div className="tag-menu-header">
              <h4>Menú</h4>
              <button type="button" className="modal-close-btn" onClick={() => setMainMenuOpen(false)}>✕</button>
            </div>
            <div className="tag-menu-list">
              <div className="menu-item-with-submenu">
                <button type="button" className="tag-menu-item" style={{ flex: 1 }} onClick={() => { setView('calendario'); setMainMenuOpen(false) }}>📅 Calendario</button>
                {dayTags.length > 0 && (
                  <button type="button" className="menu-submenu-toggle" onClick={() => setCalendarSubmenuOpen(o => !o)}>
                    {calendarSubmenuOpen ? '▴' : '▾'}
                  </button>
                )}
              </div>
              {calendarSubmenuOpen && (
                <div className="menu-submenu-filter">
                  <p className="filter-section-label">Filtro</p>
                  <div className="tag-filter-row">
                    <button
                      type="button"
                      className={visibleTagIds.length === 0 ? 'active' : ''}
                      onClick={() => { setVisibleTagIds([]); setView('calendario'); setMainMenuOpen(false) }}
                    >
                      Todas
                    </button>
                    {dayTags.filter(tag => !tag.parent_id).map(tag => (
                      <button
                        key={tag.id}
                        type="button"
                        className={visibleTagIds.includes(tag.id) ? 'active' : ''}
                        style={visibleTagIds.includes(tag.id) ? { background: tag.color, borderColor: tag.color, color: textColorFor(tag.color) } : {}}
                        onClick={() => { toggleVisibleTag(tag.id); setView('calendario'); setMainMenuOpen(false) }}
                      >
                        <span className="tag-filter-dot" style={{ background: tag.color }} />
                        {tag.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <button type="button" className="tag-menu-item" onClick={() => { setView('agenda'); setMainMenuOpen(false) }}>📓 Agenda</button>
              <button type="button" className="tag-menu-item" onClick={() => { setView('etiquetas'); setMainMenuOpen(false) }}>🏷️ Etiquetas</button>
              <button type="button" className="tag-menu-item" onClick={() => { setView('carpetas'); setMainMenuOpen(false) }}>📁 Carpetas</button>
              {temporaryQuickNotes.length > 0 && (
                <button type="button" className="tag-menu-item" onClick={() => { setView('revision'); setMainMenuOpen(false) }}>
                  ⏳ Revisar notas temporales{dueQuickNotes.length > 0 ? ` (${dueQuickNotes.length})` : ''}
                </button>
              )}
              <button type="button" className="tag-menu-item" onClick={() => { setView('listas'); setMainMenuOpen(false) }}>🛒 Listas</button>
              <button type="button" className="tag-menu-item" onClick={() => { setView('tareas'); setMainMenuOpen(false) }}>📋 Tareas repetitivas</button>
              <button type="button" className="tag-menu-item" onClick={() => { setView('clima'); setMainMenuOpen(false) }}>🌦️ Clima y estadísticas</button>
              <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '6px 0' }} />
              <button type="button" className="tag-menu-item" onClick={toggleDarkMode}>{darkMode ? '☀️ Modo claro' : '🌙 Modo oscuro'}</button>
              <button type="button" className="tag-menu-item" onClick={openTrash}>🗑️ Papelera</button>
              <button type="button" className="tag-menu-item" onClick={exportFullBackup} disabled={backingUp}>📦 Respaldo completo (con fotos)</button>
              <button type="button" className="tag-menu-item" onClick={() => { setView('importar'); setMainMenuOpen(false) }}>📥 Importar Diarium</button>
              <button type="button" className="tag-menu-item" onClick={handleLogout} style={{ color: '#b03434' }}>🚪 Cerrar sesión</button>
            </div>
        </div>
      </div>


      {loading ? (
        <p className="status-msg">Cargando...</p>
      ) : (
        <>
          <hr className="quick-nav-divider" />

          {(dv.estado === 'sin-config' || dv.estado === 'sin-clave' || dv.estado === 'error') && (
            <button type="button" className="dv-estado" onClick={() => dv.recargar()} title="Toca para volver a consultar">
              {dv.estado === 'sin-config' && '🌿 Diamantev: faltan o están mal las variables VITE_DIAMANTEV_URL / VITE_DIAMANTEV_ANON_KEY en Vercel'}
              {dv.estado === 'sin-clave' && '🌿 Diamantev: Days no puede leer la clave (revisa la tabla integraciones y la regla de acceso)'}
              {dv.estado === 'error' && `🌿 Diamantev: error · ${dv.errorMsg}`}
            </button>
          )}

          {dvDia && (
            <div className="dv-overlay" onClick={() => setDvDia(null)}>
              <div className="dv-modal" onClick={ev => ev.stopPropagation()}>
                <div className="dv-modal-head">
                  <h4>{dvDia === 'hoy' ? '🌿 Diamantev: hoy' : `🌿 Diamantev · ${dvDia}`}</h4>
                  <button type="button" className="dv-cerrar" onClick={() => setDvDia(null)}>✕ Cerrar</button>
                </div>
                <DvLista items={dvDia === 'hoy' ? dv.hoyYAtrasados : (dv.porFecha[dvDia] || [])} hoy={todayStr} onMarcar={dv.marcar} />
                <p className="dv-nota">Al marcar aquí, también queda marcado en Diamantev.</p>
              </div>
            </div>
          )}

          <div className="calendar-header">
            <button type="button" onClick={() => changeMonth(-1)}>←</button>
            <label className="journal-date-label">
              <h3>{calMonthLabel}</h3>
              <p className="calendar-today-label">
                Hoy es {(() => { const s = new Date().toLocaleDateString('es-EC', { weekday: 'long', day: 'numeric' }); return s.charAt(0).toUpperCase() + s.slice(1) })()}
              </p>
              <input
                type="date"
                value={formatDateStr(calendarMonth)}
                onChange={e => { if (e.target.value) setCalendarMonth(new Date(e.target.value + 'T00:00:00')) }}
                className="journal-date-input"
              />
            </label>
            <button type="button" onClick={() => changeMonth(1)}>→</button>
          </div>

          <div className="calendar-grid">
            {['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'].map(d => (
              <div key={d} className="calendar-weekday">{d}</div>
            ))}
            {calCells.map((cell, i) => {
              if (!cell) return <div key={`empty-${i}`} className="calendar-day outside" />
              const dateStr = formatDateStr(cell)
              const dayItems = entriesByDay[dateStr] || []
              const dayItemsShown = entriesByDayFiltered[dateStr] || []
              // Combina el campo viejo (tag_id, una sola etiqueta) con el nuevo (tag_ids,
              // varias etiquetas por nota) para que el calendario muestre TODAS las
              // etiquetas del día, vengan de donde vengan, sin repetir la misma dos veces.
              const dayTagIds = [...new Set(dayItemsShown.flatMap(t => t.tag_id ? [t.tag_id] : (t.tag_ids || [])))]
              const hasFreeNote = dayItems.some(t => t.content_blocks && t.content_blocks.length > 0 && !t.tag_id)
              return (
                <div
                  key={dateStr}
                  className={`calendar-day ${dateStr === todayStr ? 'today' : ''} ${selectedDay === dateStr ? 'selected' : ''} ${hasFreeNote ? 'has-note' : ''} ${dayWeather[dateStr] ? 'weather-' + dayWeather[dateStr] : ''}`}
                  onClick={() => openDayJournal(dateStr)}
                >
                  <span className="calendar-day-num">{cell.getDate()}</span>
                  {(dv.porFecha[dateStr] || []).length > 0 && (() => {
                    const lista = dv.porFecha[dateStr]
                    const e = lista.filter(x => x.tipo === 'entrega').length
                    const c = lista.filter(x => x.tipo === 'cobro').length
                    return (
                      <button type="button" className={`calendar-dv ${dateStr < todayStr ? 'atrasado' : ''}`}
                        onClick={ev => { ev.stopPropagation(); setDvDia(dateStr) }} title="Pendientes de Diamantev">
                        {e > 0 && <span>🚚{e}</span>}{c > 0 && <span>💵{c}</span>}
                      </button>
                    )
                  })()}
                  {dayWeather[dateStr] && (
                    <span className="calendar-day-weather" title={WEATHER_OPTIONS.find(w => w.key === dayWeather[dateStr])?.label}>
                      {WEATHER_OPTIONS.find(w => w.key === dayWeather[dateStr])?.icon}
                    </span>
                  )}
                  {(() => {
                    const firstPhoto = dayItems.flatMap(t => t.content_blocks || []).find(b => b.type === 'photo')
                    return firstPhoto && <img src={firstPhoto.url} alt="" className="calendar-day-thumb" />
                  })()}
                  <div className="calendar-day-tasks">
                    {dayTagIds.slice(0, 3).map(tagId => {
                      const tag = dayTags.find(g => g.id === tagId)
                      if (!tag) return null
                      return (
                        <span
                          key={tagId}
                          className="calendar-task-label"
                          style={{ background: tag.color, color: textColorFor(tag.color) }}
                          title={tag.name}
                        >
                          {tag.name}
                        </span>
                      )
                    })}
                    {dayTagIds.length > 3 && (
                      <span className="calendar-task-more">+{dayTagIds.length - 3}</span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          <hr className="quick-nav-divider" />
          <div className="days-footer-divider">
            <img src="/floral-divider.png" alt="" />
          </div>

      {view === 'agenda' && (
        <AgendaVista
          dateStr={todayStr}
          entries={dayEntries}
          todos={todos}
          quickNotes={quickNotes}
          diamantev={dv.hoyYAtrasados}
          onDiamantevMarcar={dv.marcar}
          weather={dayWeather[todayStr] || null}
          weatherOptions={WEATHER_OPTIONS}
          onToggleTodo={toggleTodo}
          onWeather={setWeatherForDay}
          onOpenDay={d => { setView('calendario'); openDayJournal(d) }}
          onOpenNotes={() => { setShowOnlyFavNotes(false); setView('notas') }}
          onClose={() => setView('calendario')}
        />
      )}

      {view !== 'calendario' && view !== 'agenda' && (
        <div className="admin-sheet-overlay" onClick={() => setView('calendario')}>
          <div className="admin-sheet" onClick={e => e.stopPropagation()}>
            <div className="admin-sheet-header">
              <h2>
                {view === 'etiquetas' && '🏷️ Etiquetas'}
                {view === 'tareas' && '📋 Tareas repetitivas'}
                {view === 'notas' && '🗒️ Notas rápidas'}
                {view === 'carpetas' && '📁 Carpetas'}
                {view === 'buscar' && '🔍 Buscar'}
                {view === 'clima' && '🌦️ Clima'}
                {view === 'revision' && '⏳ Revisar notas'}
                {view === 'listas' && '🛒 Listas'}
                {view === 'importar' && '📥 Importar Diarium'}
              </h2>
              <button type="button" className="modal-close-btn" onClick={() => setView('calendario')}>✕</button>
            </div>
            <div className="admin-sheet-body">

        {view === 'buscar' && (
          <>
          <div className="task-search-row">
            <input
              className="order-search"
              placeholder="Buscar entrada por palabra o etiqueta..."
              value={taskSearch}
              onChange={e => setTaskSearch(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && (e.target.blur(), setTaskSearchSubmitted(taskSearch))}
            />
            <button
              type="button"
              className="task-search-btn"
              onClick={() => { document.activeElement && document.activeElement.blur(); setTaskSearchSubmitted(taskSearch) }}
            >
              🔍 Buscar
            </button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '0 0 12px' }}>
            <label htmlFor="search-order-select" className="filter-section-label" style={{ margin: 0 }}>Ordenar:</label>
            <select
              id="search-order-select"
              value={searchOrder}
              onChange={e => setSearchOrder(e.target.value)}
              style={{ padding: '6px 10px', borderRadius: 999, border: '2px solid var(--parch-border)', background: 'var(--pill-bg)', color: 'var(--pill-text)', fontFamily: 'inherit', fontWeight: 700, fontSize: '0.8rem' }}
            >
              <option value="newest">Más nuevas primero</option>
              <option value="oldest">Más antiguas primero</option>
              <option value="important">⭐ Importantes primero</option>
            </select>
          </div>

          {taskSearchSubmitted.trim() && (() => {
            const term = taskSearchSubmitted.trim()
            const matches = dayEntries
              .filter(t => {
                const tag = dayTags.find(g => g.id === t.tag_id)
                // Entradas nuevas guardan sus etiquetas en tag_ids (varias); las viejas en tag_id (una).
                const multiTagNames = (t.tag_ids || []).map(id => dayTags.find(g => g.id === id)?.name || '').join(' ')
                const blocksText = (t.content_blocks || [])
                  .filter(b => b.type === 'text')
                  .map(b => b.content)
                  .join(' ')
                const haystack = [t.note || '', tag?.name || '', multiTagNames, blocksText].join(' ')
                return matchesSearch(haystack, term)
              })
              .sort((a, b) => {
                if (searchOrder === 'important' && !!a.important !== !!b.important) return a.important ? -1 : 1
                // Misma fecha: la entrada creada más recientemente va primero (salvo en "más antiguas").
                const byDate = a.date.localeCompare(b.date)
                if (searchOrder === 'oldest') return byDate || String(a.created_at || '').localeCompare(String(b.created_at || ''))
                return -byDate || String(b.created_at || '').localeCompare(String(a.created_at || ''))
              })
            return (
              <div className="day-panel">
                <h4>Resultados de búsqueda ({matches.length})</h4>
                {matches.length === 0 && <p className="status-msg">No se encontraron entradas.</p>}
                <div className="day-task-list">
                  {matches.map(t => {
                    const tag = dayTags.find(g => g.id === t.tag_id)
                    const hasBlocks = t.content_blocks && t.content_blocks.length > 0
                    const previewText = hasBlocks
                      ? (t.content_blocks || []).filter(b => b.type === 'text').map(b => b.content).join(' ')
                      : ''
                    const hasPhoto = hasBlocks && (t.content_blocks || []).some(b => b.type === 'photo')
                    const hasVideo = hasBlocks && (t.content_blocks || []).some(b => b.type === 'video')
                    return (
                      <div
                        key={t.id}
                        className="day-task-item"
                        onClick={() => {
                          setTaskSearch('')
                          setTaskSearchSubmitted('')
                          setSelectedDay(t.date)
                          setDayModalOpen(true)
                          if (hasBlocks) openEditNote(t)
                        }}
                      >
                        <div className="day-task-row">
                          <span className="task-tag-dot" style={{ background: tag?.color || '#a1665e' }} />
                          <span className="task-tag-name">{new Date(t.date + 'T00:00:00').toLocaleDateString('es-EC', { day: 'numeric', month: 'short', year: 'numeric' })} · {formatElapsedFull(t.date)} — {tag?.name || (t.tag_id ? 'Etiqueta borrada' : '📝 Nota libre')}</span>
                        </div>
                        {t.important && (
                          <div style={{ display: 'inline-block', background: 'rgba(0,0,0,0.08)', borderRadius: 999, padding: '2px 8px', fontSize: '0.7rem', fontWeight: 700, color: '#7a5c00', margin: '4px 0 0 20px' }}>
                            ⭐ {new Date(t.date + 'T00:00:00').toLocaleDateString('es-EC', { day: 'numeric', month: 'short', year: 'numeric' })} · {formatElapsedFull(t.date)}
                          </div>
                        )}
                        {t.note && <span className="task-note">— {renderLinkedText(t.note, term)}</span>}
                        {previewText && (
                          <p className="task-note" style={{ margin: '2px 0 0 20px', whiteSpace: 'pre-wrap' }}>
                            {renderLinkedText(previewText, term)}
                            {(hasPhoto || hasVideo) && <span> {hasPhoto ? '📷' : ''}{hasVideo ? '🎥' : ''}</span>}
                          </p>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })()}

          {taskSearchSubmitted.trim() && (() => {
            const term = taskSearchSubmitted.trim()
            const noteMatches = quickNotes
              .filter(n => matchesSearch(`${n.title || ''} ${n.content || ''}`, term))
              .sort((a, b) => {
                const ta = new Date(a.updated_at || a.created_at).getTime()
                const tb = new Date(b.updated_at || b.created_at).getTime()
                return searchOrder === 'oldest' ? ta - tb : tb - ta
              })
            if (noteMatches.length === 0) return null
            return (
              <div className="day-panel">
                <h4>🗒️ Notas rápidas ({noteMatches.length})</h4>
                <div className="quick-notes-grid">
                  {noteMatches.map(note => (
                    <div key={note.id} className="quick-note-card" style={{ background: pastelize(note.color), cursor: 'pointer' }} onClick={() => openEditQuickNoteFull(note)}>
                      <strong className="quick-note-title">{renderLinkedText(getQuickNoteTitle(note), term)}</strong>
                      <div className="quick-note-text">{renderLinkedText(getQuickNotePreview(note), term)}</div>
                      <span style={{ display: 'block', fontSize: '0.72rem', color: 'rgba(0,0,0,0.5)' }}>
                        {note.updated_at && note.updated_at !== note.created_at
                          ? `Editada ${formatRelativeDate(note.updated_at)}`
                          : `Creada ${formatRelativeDate(note.created_at)}`}
                      </span>
                      {note.folder && <span className="quick-note-folder-tag">📁 {folderLabel(note.folder)}</span>}
                    </div>
                  ))}
                </div>
              </div>
            )
          })()}
          </>
        )}

        {view === 'clima' && (() => {
          const now = new Date()
          const rangeStart = weatherStatsRange === 'month'
            ? formatDateStr(new Date(now.getFullYear(), now.getMonth(), 1))
            : weatherStatsRange === '3months'
              ? formatDateStr(new Date(now.getFullYear(), now.getMonth() - 2, 1))
              : weatherStatsRange === 'year'
                ? `${now.getFullYear()}-01-01`
                : '0000-00-00'
          const rows = Object.entries(dayWeather)
            .filter(([d]) => d >= rangeStart)
            .sort((a, b) => a[0].localeCompare(b[0]))
          const total = rows.length
          const counts = Object.fromEntries(WEATHER_OPTIONS.map(w => [w.key, 0]))
          rows.forEach(([, w]) => { if (counts[w] !== undefined) counts[w] += 1 })

          // Mayor racha de cada tipo: días seguidos (uno tras otro en el calendario) con el mismo clima.
          const bestStreak = Object.fromEntries(WEATHER_OPTIONS.map(w => [w.key, { len: 0, end: '' }]))
          let run = 0
          rows.forEach(([d, w], i) => {
            const prev = rows[i - 1]
            const isNextDay = prev && prev[1] === w &&
              Math.round((new Date(d + 'T00:00:00') - new Date(prev[0] + 'T00:00:00')) / 86400000) === 1
            run = isNextDay ? run + 1 : 1
            if (bestStreak[w] && run > bestStreak[w].len) bestStreak[w] = { len: run, end: d }
          })

          // Resumen por mes (el más reciente primero).
          const byMonth = {}
          rows.forEach(([d, w]) => {
            const m = d.slice(0, 7)
            if (!byMonth[m]) byMonth[m] = Object.fromEntries(WEATHER_OPTIONS.map(o => [o.key, 0]))
            if (byMonth[m][w] !== undefined) byMonth[m][w] += 1
          })
          const months = Object.keys(byMonth).sort().reverse()
          const monthLabel = ym => new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1, 1).toLocaleDateString('es-EC', { month: 'long', year: 'numeric' })
          const pct = n => (total ? Math.round((n / total) * 100) : 0)
          const dayWord = n => (n === 1 ? 'día' : 'días')

          return (
            <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '0 0 12px', flexWrap: 'wrap' }}>
              <label htmlFor="weather-range-select" className="filter-section-label" style={{ margin: 0 }}>Período:</label>
              <select
                id="weather-range-select"
                value={weatherStatsRange}
                onChange={e => setWeatherStatsRange(e.target.value)}
                style={{ padding: '6px 10px', borderRadius: 999, border: '2px solid var(--parch-border)', background: 'var(--pill-bg)', color: 'var(--pill-text)', fontFamily: 'inherit', fontWeight: 700, fontSize: '0.8rem' }}
              >
                <option value="month">Este mes</option>
                <option value="3months">Últimos 3 meses</option>
                <option value="year">Este año</option>
                <option value="all">Todo el registro</option>
              </select>
            </div>

            {total === 0 ? (
              <p className="status-msg">Todavía no hay clima registrado en este período. Abre un día en el calendario y elige ☀️ ☁️ o 🌧️.</p>
            ) : (
              <>
                <div className="day-panel">
                  <h4>Resumen ({total} {dayWord(total)} con clima)</h4>
                  <div className="weather-legend">
                    {WEATHER_OPTIONS.map(w => (
                      <span key={w.key} className="weather-legend-item">
                        <span className={`weather-swatch ${w.key}`} /> {w.icon} {w.label}
                      </span>
                    ))}
                  </div>
                  {WEATHER_OPTIONS.map(w => (
                    <div key={w.key} className="weather-stat-row">
                      <span className="weather-stat-label">{w.icon} {w.label}</span>
                      <div className="weather-bar-track" title={`${w.label}: ${counts[w.key]} ${dayWord(counts[w.key])}`}>
                        {counts[w.key] > 0 && <div className={`weather-bar-fill ${w.key}`} style={{ width: `${pct(counts[w.key])}%` }} />}
                      </div>
                      <span className="weather-stat-value">{counts[w.key]} · {pct(counts[w.key])}%</span>
                    </div>
                  ))}
                  <div style={{ marginTop: 10, fontSize: '0.8rem', color: 'var(--muted)' }}>
                    {WEATHER_OPTIONS.filter(w => bestStreak[w.key].len > 1).map(w => (
                      <div key={w.key}>
                        {w.icon} Mayor racha de {w.label.toLowerCase()}: {bestStreak[w.key].len} días seguidos (hasta el {new Date(bestStreak[w.key].end + 'T00:00:00').toLocaleDateString('es-EC', { day: 'numeric', month: 'short', year: 'numeric' })})
                      </div>
                    ))}
                  </div>
                </div>

                <div className="day-panel">
                  <h4>Mes a mes</h4>
                  {months.map(ym => {
                    const c = byMonth[ym]
                    const monthTotal = WEATHER_OPTIONS.reduce((s, w) => s + c[w.key], 0)
                    return (
                      <div key={ym} className="weather-month-row">
                        <div className="weather-month-head">
                          <span style={{ textTransform: 'capitalize', fontWeight: 700 }}>{monthLabel(ym)}</span>
                          <span className="weather-month-counts">
                            {WEATHER_OPTIONS.map(w => <span key={w.key}>{w.icon} {c[w.key]}</span>)}
                          </span>
                        </div>
                        <div className="weather-stack" role="img" aria-label={WEATHER_OPTIONS.map(w => `${w.label} ${c[w.key]}`).join(', ')}>
                          {WEATHER_OPTIONS.filter(w => c[w.key] > 0).map(w => (
                            <div
                              key={w.key}
                              className={`weather-stack-seg ${w.key}`}
                              style={{ flexGrow: c[w.key] }}
                              title={`${w.label}: ${c[w.key]} de ${monthTotal} ${dayWord(monthTotal)} registrados`}
                            />
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

        {view === 'tareas' && (
          <>
          <form id="recurring-task-form" className="admin-form recurring-task-form" onSubmit={addTaskFull} style={editingSeriesId ? { border: '2px solid var(--pink)' } : {}}>
            <p className="filter-section-label" style={{ margin: '0 0 4px' }}>
              {editingSeriesId ? 'Editando tarea repetitiva' : 'Nueva tarea repetitiva'}
            </p>
            <select value={taskForm.tag_id} onChange={e => setTaskForm({ ...taskForm, tag_id: e.target.value })}>
              <option value="">Selecciona una etiqueta</option>
              {dayTags.map(tag => (
                <option key={tag.id} value={tag.id}>{tag.parent_id ? '— ' : ''}{tag.name}</option>
              ))}
            </select>
            <div className="quick-note-color-row">
              <input
                type="date"
                value={taskForm.date || todayStr}
                onChange={e => setTaskForm({ ...taskForm, date: e.target.value })}
                style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid var(--sage)', fontFamily: 'inherit' }}
              />
              <select value={taskForm.repeat} onChange={e => setTaskForm({ ...taskForm, repeat: e.target.value })}>
                <option value="weekly">Cada semana</option>
                <option value="biweekly">Cada 2 semanas</option>
                <option value="monthly">Cada mes</option>
                <option value="custom">Cada N días...</option>
              </select>
              {taskForm.repeat === 'custom' && (
                <input
                  type="number"
                  placeholder="días"
                  value={taskForm.customDays || ''}
                  onChange={e => setTaskForm({ ...taskForm, customDays: e.target.value })}
                  style={{ width: 60, padding: '6px 8px', borderRadius: 6, border: '1px solid var(--sage)', fontFamily: 'inherit' }}
                />
              )}
              <button type="submit" className="quick-note-add-btn">{editingSeriesId ? 'Guardar cambios' : 'Guardar'}</button>
              {editingSeriesId && (
                <button
                  type="button"
                  className="quick-note-add-btn"
                  style={{ background: 'transparent', color: 'var(--dark)', border: '1px solid var(--sage)' }}
                  onClick={() => { setEditingSeriesId(null); setTaskForm({ tag_id: '', date: '', note: '', repeat: 'weekly', customDays: '' }) }}
                >
                  Cancelar
                </button>
              )}
            </div>
          </form>

          {(() => {
            const repeatLabel = { weekly: 'Cada semana', biweekly: 'Cada 2 semanas', monthly: 'Cada mes', custom: 'Frecuencia personalizada' }
            const listEntries = dayEntries
              .filter(t => !(t.content_blocks && t.content_blocks.length > 0))
              .filter(t => visibleTagIds.length === 0 || visibleTagIds.includes(groupIdOf(t.tag_id)))
              .filter(t => t.date >= todayStr)
              .sort((a, b) => a.date.localeCompare(b.date))

            // Una sola tarjeta resumen por serie (la próxima ocurrencia); las tareas sin serie se listan individualmente
            const seenSeries = new Set()
            const summaryEntries = []
            for (const t of listEntries) {
              if (t.series_id) {
                if (seenSeries.has(t.series_id)) continue
                seenSeries.add(t.series_id)
              }
              summaryEntries.push(t)
              if (summaryEntries.length >= 30) break
            }

            return summaryEntries.length === 0 ? (
              <p className="status-msg">No hay tareas próximas{visibleTagIds.length > 0 ? ' para este filtro' : ''}.</p>
            ) : (
              <div className="recurring-tasks-list">
                {summaryEntries.map(t => {
                  const tag = dayTags.find(g => g.id === t.tag_id)
                  const bg = tag?.color || '#E8E4D8'
                  const seriesDates = t.series_id
                    ? dayEntries.filter(e => e.series_id === t.series_id).map(e => e.date).sort()
                    : [t.date]
                  const rangeStart = seriesDates[0]
                  const rangeEnd = seriesDates[seriesDates.length - 1]
                  const fmt = d => new Date(d + 'T00:00:00').toLocaleDateString('es-EC', { day: 'numeric', month: 'short', year: 'numeric' })
                  return (
                    <div key={t.id} className="task-card-v2" style={{ background: bg, color: textColorFor(bg) }}>
                      <p className="task-card-v2-tag">{tag ? tag.name : 'Sin etiqueta'}</p>
                      <p className="task-card-v2-freq">{t.repeat && t.repeat !== 'none' ? (repeatLabel[t.repeat] || 'Repetitiva') : 'Una sola vez'}</p>
                      {t.series_id && rangeStart !== rangeEnd && (
                        <p className="task-card-v2-range">Del {fmt(rangeStart)} al {fmt(rangeEnd)}</p>
                      )}
                      <p className="task-card-v2-next">Próxima: {fmt(t.date)} · {formatElapsedFull(t.date)}</p>
                      {t.note && <p className="task-card-v2-note">{t.note}</p>}
                      <label className="task-card-v2-check">
                        <input type="checkbox" checked={!!t.done} onChange={() => toggleEntryDone(t)} />
                        Marcar próxima como hecha
                      </label>
                      <div className="task-card-v2-actions">
                        {t.series_id && (
                          <button type="button" onClick={() => editTaskSeries(t)}>✏️ Editar</button>
                        )}
                        <button type="button" onClick={() => rescheduleTask(t)}>📅 Cambiar fecha</button>
                        <button type="button" onClick={() => openDayJournal(t.date)}>👁️ Ver día</button>
                        {t.series_id ? (
                          <button type="button" className="task-card-v2-delete" onClick={() => deleteSeries(t.series_id)}>🗑️ Eliminar serie</button>
                        ) : (
                          <button type="button" className="task-card-v2-delete" onClick={() => deleteTask(t.id)}>🗑️ Eliminar</button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )
          })()}
          </>
        )}

        {view === 'revision' && (
          <>
          {temporaryQuickNotes.length === 0 ? (
            <p className="status-msg">No tienes notas temporales. Al crear o editar una nota rápida, activa «⏳ Temporal» y elige cuándo revisarla.</p>
          ) : (
            <>
              <div className="day-panel">
                <h4>Por revisar ({dueQuickNotes.length})</h4>
                {dueQuickNotes.length === 0 && <p className="status-msg" style={{ padding: '12px 8px' }}>No hay notas por revisar hoy. 🎉</p>}
                {dueQuickNotes.length > 0 && renderSelectToggle()}
                <div className={'quick-notes-grid' + (selectMode ? ' select-mode' : '')}>
                  {dueQuickNotes.map(note => (
                    <div key={note.id} className={'quick-note-card temp-review-card' + (selectMode && selectedNoteIds.includes(note.id) ? ' selected' : '')} style={{ background: pastelize(note.color) }} onClick={selectMode ? () => toggleNoteSelected(note.id) : undefined}>
                      {selectMode && <span className={'note-select-mark' + (selectedNoteIds.includes(note.id) ? ' on' : '')}>{selectedNoteIds.includes(note.id) ? '☑' : '☐'}</span>}
                      <strong className="quick-note-title" onClick={() => openNoteUnlessSelecting(note)} style={{ cursor: 'pointer', display: 'block' }}>{renderLinkedText(getQuickNoteTitle(note))}</strong>
                      <div className="quick-note-text" onClick={() => openNoteUnlessSelecting(note)} style={{ cursor: 'pointer' }}>{renderLinkedText(getQuickNotePreview(note))}</div>
                      <span style={{ display: 'block', fontSize: '0.72rem', color: 'rgba(0,0,0,0.55)', margin: '4px 0 8px' }}>
                        Creada {formatRelativeDate(note.created_at)} · revisión: {new Date(note.review_at + 'T00:00:00').toLocaleDateString('es-EC', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </span>
                      <div className="temp-review-actions">
                        <button type="button" onClick={() => updateQuickNoteTemp(note.id, { review_at: dateStrInDays(7) })}>↻ +1 semana</button>
                        <button type="button" onClick={() => updateQuickNoteTemp(note.id, { review_at: dateStrInDays(30) })}>↻ +1 mes</button>
                        <button type="button" onClick={() => updateQuickNoteTemp(note.id, { is_temporary: false, review_at: null })}>📌 Hacer permanente</button>
                        <button type="button" className="temp-review-delete" onClick={() => deleteQuickNote(note.id)}>🗑️ Borrar</button>
                      </div>
                    </div>
                  ))}
                </div>
                {renderSelectBar(dueQuickNotes)}
              </div>

              {upcomingQuickNotes.length > 0 && (
                <div className="day-panel">
                  <h4>Programadas ({upcomingQuickNotes.length})</h4>
                  <div className="day-task-list">
                    {upcomingQuickNotes.map(note => {
                      const days = Math.round((new Date(note.review_at + 'T00:00:00') - new Date(todayStr + 'T00:00:00')) / 86400000)
                      return (
                        <div key={note.id} className="day-task-item" onClick={() => openEditQuickNoteFull(note)} style={{ cursor: 'pointer' }}>
                          <div className="day-task-row">
                            <span className="task-tag-dot" style={{ background: note.color || '#FBEBD4' }} />
                            <span className="task-tag-name">{getQuickNoteTitle(note)}</span>
                          </div>
                          <span className="task-note" style={{ marginLeft: 18 }}>
                            Se revisa el {new Date(note.review_at + 'T00:00:00').toLocaleDateString('es-EC', { day: 'numeric', month: 'short', year: 'numeric' })} (en {days} {days === 1 ? 'día' : 'días'})
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </>
          )}
          </>
        )}

        {view === 'notas' && (
          <>
          <button type="button" className="full-form-btn" onClick={openNewQuickNote}>➕ Nueva nota</button>

          {dueQuickNotes.length > 0 && (
            <button type="button" className="temp-review-banner" onClick={() => setView('revision')}>
              ⏳ Tienes {dueQuickNotes.length} {dueQuickNotes.length === 1 ? 'nota temporal' : 'notas temporales'} por revisar — Revisar ahora
            </button>
          )}

          <div className="notes-search-row">
            <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
              <input
                placeholder="🔍 Buscar en tus notas rápidas..."
                value={quickNoteSearch}
                onChange={e => setQuickNoteSearch(e.target.value)}
                style={{ width: '100%', boxSizing: 'border-box', padding: '10px 36px 10px 12px', borderRadius: 10, fontSize: '0.95rem', border: '1px solid var(--sage)' }}
              />
              {quickNoteSearch && (
                <button
                  type="button"
                  onClick={() => setQuickNoteSearch('')}
                  title="Borrar búsqueda"
                  style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', color: '#888', fontSize: '1rem', minWidth: 32, minHeight: 32 }}
                >✕</button>
              )}
            </div>
            <button
              type="button"
              className={'notes-tool-btn' + (selectMode ? ' on' : '')}
              title={selectMode ? 'Salir de la selección' : 'Elegir varias notas'}
              aria-label={selectMode ? 'Salir de la selección' : 'Elegir varias notas'}
              aria-pressed={selectMode}
              onClick={() => (selectMode ? exitSelectMode() : setSelectMode(true))}
            >{selectMode ? '✕' : '☑'}</button>
            <button
              type="button"
              className={'notes-tool-btn' + (showOnlyFavNotes ? ' on' : '')}
              title={showOnlyFavNotes ? 'Ver todas las notas' : 'Ver solo las favoritas'}
              aria-label={showOnlyFavNotes ? 'Ver todas las notas' : 'Ver solo las favoritas'}
              aria-pressed={showOnlyFavNotes}
              onClick={() => setShowOnlyFavNotes(f => !f)}
            >{showOnlyFavNotes ? '⭐' : '☆'}</button>
          </div>

          {(() => {
            const term = quickNoteSearch.trim()
            const searched = term
              ? quickNotes.filter(n => matchesSearch(`${n.title || ''} ${n.content || ''}`, term))
              : quickNotes
            const folders = allFolders
            const filtered = searched.filter(n => {
              if (showOnlyFavNotes && !n.is_favorite) return false
              if (noteFolderFilter === 'all') return true
              if (noteFolderFilter === 'none') return !n.folder
              return inFolder(n, noteFolderFilter)
            }).sort((a, b) => new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at))
            return (
              <>
                <div className="tag-filter-row">
                  <button type="button" className={noteFolderFilter === 'all' ? 'active' : ''} onClick={() => setNoteFolderFilter('all')}>Todas ({quickNotes.length})</button>
                  {folders.length > 0 && <button type="button" className={noteFolderFilter === 'none' ? 'active' : ''} onClick={() => setNoteFolderFilter('none')}>Sin carpeta ({quickNotes.filter(n => !n.folder).length})</button>}
                  {folders.filter(f => !f.includes('/')).map(f => (
                    <button key={f} type="button" className={noteFolderFilter === f ? 'active' : ''} onClick={() => setNoteFolderFilter(f)}>📁 {f} ({quickNotes.filter(n => inFolder(n, f)).length})</button>
                  ))}
                  <button type="button" title="Administrar carpetas" aria-label="Administrar carpetas" onClick={() => setView('carpetas')}>⚙️ 📁</button>
                </div>
                {filtered.length === 0 ? (
                  <p className="status-msg">{term ? `Sin resultados para "${quickNoteSearch}".` : (showOnlyFavNotes ? 'Todavía no tienes notas favoritas. Toca ☆ en una nota para marcarla.' : 'No hay notas todavía.')}</p>
                ) : (
                  <>
                  <div className={'quick-notes-grid' + (selectMode ? ' select-mode' : '')}>
                    {filtered.map(note => {
                      const startsWithPhoto = note.content_blocks && note.content_blocks[0] && note.content_blocks[0].type === 'photo'
                      return (
                      <div key={note.id} className={'quick-note-card' + (selectMode && selectedNoteIds.includes(note.id) ? ' selected' : '')} style={{ background: pastelize(note.color) }} onClick={selectMode ? () => toggleNoteSelected(note.id) : undefined}>
                        {selectMode && <span className={'note-select-mark' + (selectedNoteIds.includes(note.id) ? ' on' : '')}>{selectedNoteIds.includes(note.id) ? '☑' : '☐'}</span>}
                        <strong className="quick-note-title" onClick={() => openNoteUnlessSelecting(note)} style={{ cursor: 'pointer', display: 'block' }}>{renderLinkedText(getQuickNoteTitle(note))}</strong>
                        <div className="quick-note-text" onClick={() => openNoteUnlessSelecting(note)} style={{ cursor: 'pointer' }}>{renderLinkedText(getQuickNotePreview(note))}</div>
                        {(note.photo_url || (note.content_blocks || []).some(bl => bl.type === 'photo' || bl.type === 'video')) && <span className="quick-note-media-badge" onClick={() => openNoteUnlessSelecting(note)}>📷 Tiene foto o video</span>}
                        <span style={{ display: 'block', fontSize: '0.72rem', color: 'rgba(0,0,0,0.5)', marginTop: 2, marginBottom: 4 }}>
                          {note.updated_at && note.updated_at !== note.created_at
                            ? `Editada ${formatRelativeDate(note.updated_at)}`
                            : `Creada ${formatRelativeDate(note.created_at)}`}
                        </span>
                        {note.is_temporary && note.review_at && (
                          <span className="temp-note-badge">
                            ⏳ Temporal · {note.review_at <= todayStr ? 'por revisar' : `se revisa el ${new Date(note.review_at + 'T00:00:00').toLocaleDateString('es-EC', { day: 'numeric', month: 'short', year: 'numeric' })}`}
                          </span>
                        )}
                        <div className="quick-note-actions" style={{ position: 'relative' }}>
                          <button type="button" onClick={() => toggleQuickNoteFavorite(note)} title={note.is_favorite ? 'Quitar de favoritas' : 'Marcar como favorita'}>{note.is_favorite ? '⭐' : '☆'}</button>
                          <button type="button" onClick={() => openEditQuickNoteFull(note)} title="Editar">✏️</button>
                          <button type="button" onClick={() => setShareMenuNoteId(shareMenuNoteId === note.id ? null : note.id)} disabled={sharingNotes} title="Compartir"><ShareIcon /></button>
                          <button type="button" onClick={() => downloadQuickNote(note)} title="Descargar">⬇️</button>
                          <button type="button" onClick={() => setMovingNoteId(movingNoteId === note.id ? null : note.id)} title="Mover a carpeta">📁</button>
                          {shareMenuNoteId === note.id && (
                            <div
                              style={{
                                position: 'absolute',
                                bottom: '110%',
                                right: 0,
                                background: '#fff',
                                borderRadius: 10,
                                boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
                                overflow: 'hidden',
                                zIndex: 20,
                                minWidth: 190,
                              }}
                            >
                              <button
                                type="button"
                                onClick={() => shareQuickNoteViaWhatsApp(note)}
                                style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '10px 14px', border: 'none', background: 'transparent', textAlign: 'left', cursor: 'pointer', color: '#3a3a2e' }}
                              >💬 WhatsApp (solo texto)</button>
                              <button
                                type="button"
                                onClick={() => shareQuickNoteViaEmail(note)}
                                style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '10px 14px', border: 'none', background: 'transparent', textAlign: 'left', cursor: 'pointer', color: '#3a3a2e' }}
                              >📧 Correo (solo texto)</button>
                              <button
                                type="button"
                                onClick={() => shareQuickNote(note)}
                                style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '10px 14px', border: 'none', background: 'transparent', textAlign: 'left', cursor: 'pointer', color: '#3a3a2e', borderTop: '1px solid #eee' }}
                              ><ShareIcon /> Compartir con foto/video...</button>
                            </div>
                          )}
                          <button type="button" onClick={() => deleteQuickNote(note.id)} title="Borrar">✕</button>
                        </div>
                        {note.folder && <span className="quick-note-folder-tag">📁 {folderLabel(note.folder)}</span>}
                        {movingNoteId === note.id && (
                          <div className="quick-note-move-panel">
                            <button type="button" onClick={() => moveQuickNoteToFolder(note.id, null)}>Sin carpeta</button>
                            {folders.map(f => (
                              <button key={f} type="button" onClick={() => moveQuickNoteToFolder(note.id, f)}>📁 {folderLabel(f)}</button>
                            ))}
                            <input
                              placeholder="Nueva carpeta..."
                              value={newFolderInput}
                              onChange={e => setNewFolderInput(e.target.value)}
                              onKeyDown={e => e.key === 'Enter' && newFolderInput.trim() && moveQuickNoteToFolder(note.id, newFolderInput.trim())}
                            />
                          </div>
                        )}
                      </div>
                    )})}
                  </div>
                  </>
                )}
                {renderSelectBar(filtered)}
              </>
            )
          })()}
          </>
        )}

        {view === 'carpetas' && (() => {
          const notesHere = quickNotes
            .filter(n => (n.folder || '') === folderPath)
            .sort((a, b) => new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at))
          const entriesHere = folderEntries.filter(e => e.folder === folderPath)
          const countIn = f => quickNotes.filter(n => inFolder(n, f)).length + folderEntries.filter(e => inFolder(e, f)).length
          const hasKids = f => allFolders.some(x => folderParent(x) === f)
          const toggleOpen = f => {
            const next = expandedFolders.includes(f) ? expandedFolders.filter(x => x !== f) : [...expandedFolders, f]
            setExpandedFolders(next)
            try { localStorage.setItem('days_expanded_folders', JSON.stringify(next)) } catch { /* no pasa nada */ }
          }
          const selectFolder = f => {
            setFolderPath(f)
            if (hasKids(f) && !expandedFolders.includes(f)) toggleOpen(f)
          }
          // Árbol: solo se dibujan los hijos de las carpetas abiertas
          const rows = []
          const walk = (parent, depth) => {
            allFolders.filter(f => folderParent(f) === parent).forEach(f => {
              rows.push({ f, depth })
              if (expandedFolders.includes(f)) walk(f, depth + 1)
            })
          }
          walk('', 0)
          return (
            <>
            <button type="button" className="full-form-btn" onClick={() => setFolderForm({ mode: 'new', old: '', value: '' })}>
              ➕ {folderPath ? `Nueva subcarpeta en «${folderLeaf(folderPath)}»` : 'Nueva carpeta'}
            </button>

            {folderForm && (
              <form
                style={{ display: 'flex', gap: 6, margin: '10px 0' }}
                onSubmit={e => {
                  e.preventDefault()
                  const v = folderForm.value.trim()
                  if (!v) return
                  if (folderForm.mode === 'new') {
                    const made = createFolder(v, folderPath)
                    if (made && folderPath && !expandedFolders.includes(folderPath)) toggleOpen(folderPath)
                  } else renameFolder(folderForm.old, v)
                  setFolderForm(null)
                }}
              >
                <input
                  autoFocus
                  value={folderForm.value}
                  onChange={e => setFolderForm(f => ({ ...f, value: e.target.value }))}
                  placeholder={folderForm.mode === 'new' ? (folderPath ? 'Nombre de la subcarpeta' : 'Nombre de la carpeta') : 'Nuevo nombre'}
                  style={{ flex: 1, padding: 8, borderRadius: 8, border: '1px solid #c9b48a', fontSize: '1rem' }}
                />
                <button type="submit" className="notes-tool-btn" title="Guardar" aria-label="Guardar">✔</button>
                <button type="button" className="notes-tool-btn" title="Cancelar" aria-label="Cancelar" onClick={() => setFolderForm(null)}>✕</button>
              </form>
            )}

            <div role="tree" style={{ marginTop: 10, background: 'rgba(255,255,255,0.55)', border: '1px solid #c9b48a', borderRadius: 12, padding: '6px 4px' }}>
              {rows.length === 0 && (
                <p className="status-msg" style={{ margin: 8 }}>Todavía no tienes carpetas. Toca ➕ para crear la primera.</p>
              )}
              {rows.map(({ f, depth }) => {
                const open = expandedFolders.includes(f)
                const kids = hasKids(f)
                const selected = folderPath === f
                return (
                  <div
                    key={f}
                    role="treeitem"
                    aria-expanded={kids ? open : undefined}
                    style={{ display: 'flex', alignItems: 'center', gap: 2, paddingLeft: depth * 22, background: selected ? 'rgba(75,127,82,0.16)' : 'transparent', borderRadius: 8 }}
                  >
                    <button
                      type="button"
                      aria-label={open ? 'Cerrar carpeta' : 'Abrir carpeta'}
                      onClick={() => kids && toggleOpen(f)}
                      style={{ width: 30, minHeight: 38, border: 'none', background: 'transparent', fontSize: '1.1rem', fontWeight: 700, color: '#5a4a35', visibility: kids ? 'visible' : 'hidden', padding: 0 }}
                    ><span style={{ display: 'inline-block', transition: 'transform .15s', transform: open ? 'rotate(90deg)' : 'none' }}>›</span></button>
                    <button
                      type="button"
                      onClick={() => selectFolder(f)}
                      style={{ flex: 1, textAlign: 'left', border: 'none', background: 'transparent', fontSize: '1rem', fontWeight: selected ? 800 : 600, padding: '8px 4px', minWidth: 0, color: '#3b2f22' }}
                    >
                      {selected || open ? '📂' : '📁'} {folderLeaf(f)} <span style={{ fontWeight: 400, opacity: 0.6 }}>({countIn(f)})</span>
                    </button>
                    {selected && (
                      <>
                        <button type="button" className="notes-tool-btn" title="Cambiar nombre" aria-label="Cambiar nombre" onClick={() => setFolderForm({ mode: 'rename', old: f, value: folderLeaf(f) })}>✏️</button>
                        <button type="button" className="notes-tool-btn" title="Borrar carpeta" aria-label="Borrar carpeta" onClick={() => deleteFolder(f)}>🗑️</button>
                      </>
                    )}
                  </div>
                )
              })}
              <button
                type="button"
                onClick={() => { setNoteFolderFilter('none'); setShowOnlyFavNotes(false); setView('notas') }}
                style={{ width: '100%', textAlign: 'left', border: 'none', borderTop: rows.length ? '1px dashed #c9b48a' : 'none', background: 'transparent', padding: '10px 12px', marginTop: 4, fontSize: '0.95rem', fontWeight: 600, color: '#3b2f22' }}
              >📄 Notas sin carpeta ({quickNotes.filter(n => !n.folder).length})</button>
            </div>

            {folderPath !== '' && (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '14px 0 8px' }}>
                  <strong style={{ flex: 1 }}>Notas en «{folderLeaf(folderPath)}» ({notesHere.length})</strong>
                  <button type="button" className="notes-tool-btn" title="Nueva nota aquí" aria-label="Nueva nota aquí" onClick={() => openNewQuickNoteIn(folderPath)}>➕</button>
                </div>
                {notesHere.length === 0 && entriesHere.length === 0 && <p className="status-msg">No hay notas directamente en esta carpeta.</p>}
                <div className="quick-notes-grid">
                  {notesHere.map(note => (
                    <div key={note.id} className="quick-note-card" style={{ background: pastelize(note.color), cursor: 'pointer' }} onClick={() => openEditQuickNoteFull(note)}>
                      <strong className="quick-note-title" style={{ display: 'block' }}>{getQuickNoteTitle(note) || 'Nota sin título'}</strong>
                      <div className="quick-note-text">{renderLinkedText(getQuickNotePreview(note))}</div>
                    </div>
                  ))}
                </div>
                {entriesHere.length > 0 && (
                  <>
                    <strong style={{ display: 'block', margin: '14px 0 8px' }}>📅 Entradas del día ({entriesHere.length})</strong>
                    <div className="quick-notes-grid">
                      {entriesHere.map(e => {
                        const body = (e.content_blocks || []).filter(b => b.type === 'text').map(b => b.content).join(' ') || e.note || ''
                        return (
                          <div key={e.id} className="quick-note-card" style={{ background: pastelize(e.color || '#FBEBD4'), cursor: 'pointer' }} onClick={() => openEntryFromFolder(e)}>
                            <strong className="quick-note-title" style={{ display: 'block' }}>{e.title || trashTitleOf('day_entry', e)}</strong>
                            <div className="quick-note-text">{renderLinkedText(body)}</div>
                            <span style={{ display: 'block', fontSize: '0.72rem', opacity: 0.6, marginTop: 4 }}>📅 {new Date(e.date + 'T00:00:00').toLocaleDateString('es-EC', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</span>
                          </div>
                        )
                      })}
                    </div>
                  </>
                )}
              </>
            )}
            </>
          )
        })()}

        {view === 'listas' && (
          <>
          <form className="admin-form" onSubmit={createShoppingList}>
            <input
              placeholder="Título de la lista (ej: Lista de compras)"
              value={newListTitle}
              onChange={e => setNewListTitle(e.target.value)}
            />
            <div className="quick-note-color-row">
              {['#FDE68A', '#FBCFE8', '#BFDBFE', '#BBF7D0', '#FCA5A5', '#DDD6FE'].map(color => (
                <button
                  key={color}
                  type="button"
                  className={`quick-note-swatch ${newListColor === color ? 'active' : ''}`}
                  style={{ background: color }}
                  onClick={() => setNewListColor(color)}
                />
              ))}
              <button type="submit" className="quick-note-add-btn" disabled={creatingList}>{creatingList ? '...' : '➕ Nueva'}</button>
            </div>
          </form>

          {shoppingLists.length === 0 ? (
            <p className="status-msg">No tienes listas todavía.</p>
          ) : (
            <div className="day-task-list">
              {shoppingLists.map(list => {
                const isOpen = openListId === list.id
                const items = listItemsByList[list.id] || []
                const pending = items.filter(i => !i.done).length
                const bg = list.color || '#FDE68A'
                return (
                  <div key={list.id} className="day-panel" style={{ marginBottom: 10, background: bg }}>
                    <div className="day-task-row">
                      <span
                        className="task-tag-name"
                        style={{ flex: 1, cursor: 'pointer', color: textColorFor(bg) }}
                        onClick={() => { const next = isOpen ? null : list.id; setOpenListId(next); if (next) loadListItems(next) }}
                      >
                        🛒 {list.title} {items.length > 0 ? `(${pending}/${items.length})` : ''}
                      </span>
                      <button type="button" className="task-edit-btn" onClick={() => shareShoppingList(list)} title="Compartir por WhatsApp"><ShareIcon /></button>
                      <button type="button" className="task-delete-btn" onClick={() => deleteShoppingList(list)}>✕</button>
                    </div>

                    {isOpen && (
                      <div style={{ marginTop: 10 }}>
                        <div style={{ background: 'rgba(255,255,255,0.6)', borderRadius: 10, padding: 10, marginBottom: 10, display: 'flex', flexDirection: 'column', gap: 6, color: '#4a3a2a' }}>
                          <strong>👨‍👩‍👧 Enlace para la familia</strong>
                          <span style={{ fontSize: '0.8rem' }}>
                            Pégalo en la descripción del grupo de WhatsApp para que no se pierda, y pídeles que la guarden en su pantalla de inicio.
                          </span>
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            <button type="button" className="full-form-btn" style={{ width: 'auto', display: 'inline-block', margin: 0, padding: '8px 14px' }} onClick={() => shareShoppingList(list)}>📤 WhatsApp</button>
                            <button type="button" className="full-form-btn" style={{ width: 'auto', display: 'inline-block', margin: 0, padding: '8px 14px' }} onClick={() => copyShoppingListLink(list)}>
                              {copiedListId === list.id ? '✅ Copiado' : '🔗 Copiar enlace'}
                            </button>
                            <button type="button" className="full-form-btn" style={{ width: 'auto', display: 'inline-block', margin: 0, padding: '8px 14px' }} onClick={() => window.open(shoppingListUrl(list), '_blank')}>👁 Ver como familia</button>
                          </div>
                        </div>
                        <form
                          onSubmit={e => { e.preventDefault(); addListItem(list.id) }}
                          style={{ display: 'flex', gap: 6, marginBottom: 10 }}
                        >
                          <input
                            placeholder="Agregar artículo..."
                            value={newListItemText}
                            onChange={e => setNewListItemText(e.target.value)}
                            style={{ flex: 1, padding: 8, border: '1px solid var(--sage)', borderRadius: 6, fontFamily: 'inherit' }}
                            autoFocus
                          />
                          <button type="submit">➕</button>
                        </form>
                        {items.length === 0 ? (
                          <p className="status-msg">Todavía no hay artículos.</p>
                        ) : (
                          items.map(item => (
                            <div key={item.id} className={`day-task-item ${item.done ? 'done' : ''}`}>
                              <div className="day-task-row">
                                <input type="checkbox" checked={!!item.done} onChange={() => toggleListItem(item)} />
                                <span className="task-tag-name" style={{ flex: 1 }}>{item.content}</span>
                                <button type="button" className="task-delete-btn" onClick={() => deleteListItem(item)}>✕</button>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
          </>
        )}

        {view === 'etiquetas' && (
          <>
          <div className="garden-tags-section">
            <p style={{ fontSize: '0.85rem', color: 'var(--dark)', opacity: 0.75, margin: '0 0 8px' }}>Para registrar rápido en el calendario, toca una etiqueta ahí y usa el panel de "Registrar hoy".</p>
            <div className="garden-tags-list garden-tags-grouped">
              {dayTags.filter(tag => !tag.parent_id).map(group => (
                <div key={group.id} className="tag-group-block">
                  <div className="garden-tag-chip">
                    <button
                      type="button"
                      className="tag-quick-add-btn"
                      onClick={() => { quickAddTask(group.id, todayStr); setQuickAddToast(`✅ "${group.name}" agregado a hoy`); setTimeout(() => setQuickAddToast(''), 2000) }}
                      title={`Agregar "${group.name}" a hoy`}
                    >➕</button>
                    <div className="tag-color-edit-wrap">
                      <button
                        type="button"
                        className="tag-color-input"
                        style={{ background: group.color, border: 'none' }}
                        onClick={() => setColorPickerForTag(colorPickerForTag === group.id ? null : group.id)}
                      />
                      {colorPickerForTag === group.id && (
                        <div className="tag-color-popover">
                          {['#FDE68A', '#FBCFE8', '#BFDBFE', '#BBF7D0', '#FCA5A5', '#DDD6FE', '#FDBA74', '#A7F3D0', '#C7D2FE', '#F9A8D4'].map(color => (
                            <button
                              key={color}
                              type="button"
                              className="tag-color-swatch"
                              style={{ background: color }}
                              onClick={() => { updateTagColor(group.id, color); setColorPickerForTag(null) }}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                    <input
                      className="tag-name-input"
                      defaultValue={group.name}
                      onBlur={e => updateTagName(group.id, e.target.value)}
                      style={{ fontWeight: 'bold' }}
                    />
                    <button type="button" className="tag-delete-btn" onClick={() => deleteTag(group.id)}>✕</button>
                  </div>
                  <div className="tag-subgroup-list">
                    {dayTags.filter(tag => tag.parent_id === group.id).map(tag => (
                      <div key={tag.id} className="garden-tag-chip tag-sub-chip">
                        <button
                          type="button"
                          className="tag-quick-add-btn"
                          onClick={() => { quickAddTask(tag.id, todayStr); setQuickAddToast(`✅ "${tag.name}" agregado a hoy`); setTimeout(() => setQuickAddToast(''), 2000) }}
                          title={`Agregar "${tag.name}" a hoy`}
                        >➕</button>
                        <div className="tag-color-edit-wrap">
                          <button
                            type="button"
                            className="tag-color-input"
                            style={{ background: tag.color, border: 'none' }}
                            onClick={() => setColorPickerForTag(colorPickerForTag === tag.id ? null : tag.id)}
                          />
                          {colorPickerForTag === tag.id && (
                            <div className="tag-color-popover">
                              {['#FDE68A', '#FBCFE8', '#BFDBFE', '#BBF7D0', '#FCA5A5', '#DDD6FE', '#FDBA74', '#A7F3D0', '#C7D2FE', '#F9A8D4'].map(color => (
                                <button
                                  key={color}
                                  type="button"
                                  className="tag-color-swatch"
                                  style={{ background: color }}
                                  onClick={() => { updateTagColor(tag.id, color); setColorPickerForTag(null) }}
                                />
                              ))}
                            </div>
                          )}
                        </div>
                        <input
                          className="tag-name-input"
                          defaultValue={tag.name}
                          onBlur={e => updateTagName(tag.id, e.target.value)}
                        />
                        <button type="button" className="tag-delete-btn" onClick={() => deleteTag(tag.id)}>✕</button>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <form className="admin-form garden-tag-form new-tag-form" onSubmit={addTag}>
              <div className="tag-kind-row">
                <button
                  type="button"
                  className={!newTagForm.parent_id && newTagForm.kind !== 'secundaria' ? 'active' : ''}
                  onClick={() => setNewTagForm({ ...newTagForm, kind: 'principal', parent_id: '' })}
                >
                  ⭐ Principal
                </button>
                <button
                  type="button"
                  className={newTagForm.kind === 'secundaria' ? 'active' : ''}
                  onClick={() => setNewTagForm({ ...newTagForm, kind: 'secundaria' })}
                  disabled={dayTags.filter(t => !t.parent_id).length === 0}
                >
                  🔗 Secundaria
                </button>
              </div>

              {newTagForm.kind === 'secundaria' && (
                <select
                  value={newTagForm.parent_id}
                  onChange={e => setNewTagForm({ ...newTagForm, parent_id: e.target.value })}
                >
                  <option value="">Elige el grupo principal...</option>
                  {dayTags.filter(tag => !tag.parent_id).map(tag => (
                    <option key={tag.id} value={tag.id}>Dentro de "{tag.name}"</option>
                  ))}
                </select>
              )}

              <input
                placeholder="Nombre de la etiqueta (ej: Riego, Gratitud)"
                value={newTagForm.name}
                onChange={e => setNewTagForm({ ...newTagForm, name: e.target.value })}
              />

              <div className="tag-color-palette">
                {['#FDE68A', '#FBCFE8', '#BFDBFE', '#BBF7D0', '#FCA5A5', '#DDD6FE', '#FDBA74', '#A7F3D0', '#C7D2FE', '#F9A8D4'].map(color => (
                  <button
                    key={color}
                    type="button"
                    className={`tag-color-swatch ${newTagForm.color === color ? 'active' : ''}`}
                    style={{ background: color }}
                    onClick={() => setNewTagForm({ ...newTagForm, color })}
                  />
                ))}
              </div>

              <button type="submit">Agregar etiqueta</button>
            </form>
          </div>
          </>
        )}

        {view === 'importar' && (
          <div className="admin-form" style={{ gap: 10 }}>
            <p style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>
              Trae las fotos (y los títulos que falten) desde una exportación de Diarium en JSON, con
              "Crear archivos separados para los adjuntos" activado. No vuelve a crear texto que ya
              hayas cargado antes: agrega las fotos a la nota del mismo día cuando encuentra su texto,
              o crea una nota nueva cuando no hay ninguna coincidencia (por ejemplo, una entrada que en
              Diarium quedó solo con foto, sin texto). Los audios y PDF de Diarium no se importan todavía.
            </p>

            {!diariumOps && (
              <>
                <input
                  type="file"
                  accept=".zip"
                  onChange={e => { const f = e.target.files[0]; if (f) { setDiariumZipFile(f); analyzeDiariumZip(f) } }}
                  disabled={diariumLoading}
                />
                {diariumLoading && <p className="status-msg">Leyendo el archivo…</p>}
                {diariumError && <p className="status-msg" style={{ color: '#b03434' }}>{diariumError}</p>}
              </>
            )}

            {diariumOps && diariumOps.length === 0 && (
              <>
                <p className="status-msg">No se encontraron fotos ni títulos nuevos en este archivo.</p>
                <button type="button" onClick={() => { setDiariumOps(null); setDiariumZipFile(null); diariumZipRef.current = null }}>Elegir otro archivo</button>
              </>
            )}

            {diariumOps && diariumOps.length > 0 && !diariumSummary && (
              <>
                <p style={{ fontSize: '0.85rem' }}>
                  <strong>{diariumOps.length}</strong> entrada{diariumOps.length === 1 ? '' : 's'} encontrada{diariumOps.length === 1 ? '' : 's'}:{' '}
                  {diariumOps.filter(o => o.action === 'update').length} se agregará{diariumOps.filter(o => o.action === 'update').length === 1 ? '' : 'n'} a una nota que ya existe,{' '}
                  {diariumOps.filter(o => o.action === 'create').length} se creará{diariumOps.filter(o => o.action === 'create').length === 1 ? '' : 'n'} como nota nueva.
                </p>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="button" onClick={() => setDiariumSelected(Object.fromEntries(diariumOps.map(o => [o.id, true])))}>Marcar todas</button>
                  <button type="button" onClick={() => setDiariumSelected({})}>Desmarcar todas</button>
                </div>
                <div style={{ maxHeight: '46vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {diariumOps.map(op => (
                    <label key={op.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', background: 'rgba(0,0,0,0.04)', borderRadius: 10, padding: 8 }}>
                      <input
                        type="checkbox"
                        checked={!!diariumSelected[op.id]}
                        onChange={() => setDiariumSelected(prev => ({ ...prev, [op.id]: !prev[op.id] }))}
                        style={{ marginTop: 4 }}
                      />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 700 }}>
                          {new Date(op.entryDate).toLocaleDateString()}{op.heading ? ` — ${op.heading}` : ''}
                        </div>
                        {op.text && (
                          <div style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>
                            {op.text.slice(0, 140)}{op.text.length > 140 ? '…' : ''}
                          </div>
                        )}
                        <div style={{ fontSize: '0.78rem', marginTop: 2 }}>
                          {op.photos.length > 0 && `📷 ${op.photos.length} foto${op.photos.length === 1 ? '' : 's'} · `}
                          {op.action === 'update' ? 'Se agregará a una nota existente' : 'Se creará una nota nueva'}
                          {diariumDoneSet.has(op.entryDate) ? ' · ya se importó antes' : ''}
                        </div>
                      </div>
                    </label>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={runDiariumImport}
                  disabled={diariumImporting || Object.values(diariumSelected).every(v => !v)}
                >
                  {diariumImporting
                    ? `Importando… ${diariumProgress.done}/${diariumProgress.total}`
                    : `Importar seleccionadas (${Object.values(diariumSelected).filter(Boolean).length})`}
                </button>
              </>
            )}

            {diariumSummary && (
              <>
                <p className="status-msg">
                  ✅ Listo. {diariumSummary.updated} nota{diariumSummary.updated === 1 ? '' : 's'} recibió{diariumSummary.updated === 1 ? '' : 'eron'} fotos nuevas,{' '}
                  {diariumSummary.created} nota{diariumSummary.created === 1 ? '' : 's'} nueva{diariumSummary.created === 1 ? '' : 's'} se creó{diariumSummary.created === 1 ? '' : 'aron'}
                  {diariumSummary.photosOk ? `, ${diariumSummary.photosOk} foto${diariumSummary.photosOk === 1 ? '' : 's'} subida${diariumSummary.photosOk === 1 ? '' : 's'}` : ''}.
                </p>
                {diariumSummary.failed.length > 0 && (
                  <p className="status-msg" style={{ color: '#b03434' }}>
                    {diariumSummary.failed.length} entrada{diariumSummary.failed.length === 1 ? '' : 's'} no se pudo{diariumSummary.failed.length === 1 ? '' : 'ieron'} importar. Puedes intentarlo de nuevo con el mismo archivo: las que ya quedaron listas se marcan como "ya se importó antes" y no se repiten al volver a analizarlo.
                  </p>
                )}
                <button type="button" onClick={() => { setDiariumOps(null); setDiariumSummary(null); setDiariumZipFile(null); diariumZipRef.current = null }}>
                  Importar otro archivo
                </button>
              </>
            )}
          </div>
        )}

            </div>
          </div>
        </div>
      )}
        </>
      )}

          {selectedDay && dayModalOpen && (
            <div className="admin-sheet-overlay" onClick={closeDayJournal}>
              <div className="day-panel day-panel-modal journal-panel journal-panel-flex" onClick={e => e.stopPropagation()}>
                <div className="journal-header" style={{ position: 'relative' }}>
                  <button type="button" className="journal-nav-btn" onClick={() => navigateDay(-1)}>←</button>
                  <label className="journal-date-label">
                    <h4>{formatDayHeader(selectedDay)}</h4>
                    <input
                      type="date"
                      value={selectedDay}
                      onChange={async e => { const v = e.target.value; if (v) { await flushDayNoteAutosave(); openDayJournal(v) } }}
                      className="journal-date-input"
                    />
                  </label>
                  <button type="button" className="journal-nav-btn" onClick={() => navigateDay(1)}>→</button>
                  <button
                    type="button"
                    className="modal-close-btn"
                    onClick={closeDayJournal}
                    aria-label="Cerrar y volver al calendario"
                    title="Cerrar y volver al calendario"
                    style={{
                      color: '#D32F2F',
                      fontSize: '1.4rem',
                      fontWeight: 'bold',
                      lineHeight: 1,
                      minWidth: 44,
                      minHeight: 44,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      background: 'transparent',
                      border: 'none',
                    }}
                  >✕</button>
                </div>

                {(() => {
                  const items = dayEntries.filter(t => t.date === selectedDay)
                  const isEditing = !!expandedEntryId

                  return (
                    <>
                      <div className="journal-scroll-body">
                        <div className="weather-row">
                          <span className="filter-section-label" style={{ margin: 0 }}>Clima:</span>
                          {WEATHER_OPTIONS.map(w => (
                            <button
                              key={w.key}
                              type="button"
                              className={`weather-pill ${dayWeather[selectedDay] === w.key ? 'active' : ''}`}
                              aria-pressed={dayWeather[selectedDay] === w.key}
                              onClick={() => setWeatherForDay(selectedDay, w.key)}
                            >{w.icon} {w.label}</button>
                          ))}
                        </div>
                        {weatherNotice && <p className="weather-notice">{weatherNotice}</p>}
                        {(() => {
                          const dayTodos = todos
                            .filter(t => t.date === selectedDay)
                            .sort((a, b) => (Number(!!a.done) - Number(!!b.done)) || String(a.created_at || '').localeCompare(String(b.created_at || '')))
                          const doneCount = dayTodos.filter(t => t.done).length
                          return (
                            <div className="todo-panel">
                              <div className="todo-head">
                                <span className="filter-section-label" style={{ margin: 0 }}>✅ Pendientes</span>
                                {dayTodos.length > 0 && <span className="todo-count">{doneCount}/{dayTodos.length}</span>}
                              </div>
                              {dayTodos.map(t => (
                                <div key={t.id} className={'todo-item' + (t.done ? ' done' : '')}>
                                  <button
                                    type="button"
                                    className="todo-check"
                                    onClick={() => toggleTodo(t)}
                                    aria-label={t.done ? 'Marcar como pendiente' : 'Marcar como hecho'}
                                    aria-pressed={!!t.done}
                                  >{t.done ? '☑' : '☐'}</button>
                                  <span className="todo-text">
                                    {t.text}
                                    {t.origin_date && t.origin_date !== t.date && (
                                      <small className="todo-from"> ↪ desde {new Date(t.origin_date + 'T00:00:00').toLocaleDateString('es-EC', { day: 'numeric', month: 'short' })}</small>
                                    )}
                                  </span>
                                  <button type="button" className="todo-del" onClick={() => deleteTodo(t)} title="Borrar pendiente" aria-label="Borrar pendiente">✕</button>
                                </div>
                              ))}
                              <form className="todo-add" onSubmit={addTodo}>
                                <input
                                  value={newTodoText}
                                  onChange={e => setNewTodoText(e.target.value)}
                                  placeholder="Agregar pendiente..."
                                  aria-label="Nuevo pendiente"
                                />
                                <button type="submit" className="todo-add-btn" aria-label="Agregar pendiente">➕</button>
                              </form>
                            </div>
                          )
                        })()}
                        {isEditing ? (
                          <div className="quick-note-card" style={{ background: '#fff', border: 'none', boxShadow: 'none', minHeight: '100%' }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                              <span style={{ fontSize: '0.78rem', color: dayNoteSaveStatus === 'saved' ? '#4CAF50' : dayNoteSaveStatus === 'error' ? '#D32F2F' : '#8a8a8a' }}>
                                {dayNoteSaveStatus === 'saved' ? 'Guardado ✔️' : dayNoteSaveStatus === 'error' ? 'Error al guardar ⚠️' : 'Guardando...'}
                              </span>
                              <button
                                type="button"
                                onClick={backToDayList}
                                style={{ background: 'var(--sage)', color: '#fff', border: 'none', borderRadius: 999, padding: '6px 16px', fontSize: '0.85rem', cursor: 'pointer', fontWeight: 600 }}
                              >✓ Listo</button>
                            </div>

                            <div style={{ marginBottom: 8 }}>
                              <input
                                className="quick-note-title-input"
                                style={{ width: '100%', boxSizing: 'border-box', fontWeight: 'bold', fontSize: '1.05rem' }}
                                placeholder="Título"
                                value={dayEntryTitle}
                                onChange={e => { setDayEntryTitleSynced(e.target.value); scheduleDayNoteAutosave() }}
                              />
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                              <div style={{ display: 'flex', gap: 5, flexShrink: 0 }}>
                                {QUICK_NOTE_PASTELS.map(color => (
                                  <button
                                    key={color}
                                    type="button"
                                    onClick={() => { setDayEntryColorSynced(color); scheduleDayNoteAutosave() }}
                                    title="Elegir color"
                                    style={{
                                      width: 22,
                                      height: 22,
                                      borderRadius: '50%',
                                      background: color,
                                      border: dayEntryColor === color ? '2px solid #3a3a2e' : '1px solid rgba(0,0,0,0.15)',
                                      padding: 0,
                                      flexShrink: 0,
                                      cursor: 'pointer',
                                    }}
                                  />
                                ))}
                              </div>
                              <button
                                type="button"
                                onClick={() => { setDayEntryImportantSynced(v => !v); scheduleDayNoteAutosave() }}
                                title={dayEntryImportant ? 'Quitar de fechas importantes' : 'Marcar como fecha importante'}
                                style={{
                                  flexShrink: 0,
                                  background: 'transparent',
                                  border: 'none',
                                  fontSize: '1.3rem',
                                  cursor: 'pointer',
                                  padding: 0,
                                  opacity: dayEntryImportant ? 1 : 0.35,
                                }}
                              >⭐</button>
                              <button
                                type="button"
                                onClick={() => setFolderPicker({ mode: 'day', value: '' })}
                                title={dayEntryFolder ? 'Carpeta: ' + folderLabel(dayEntryFolder) : 'Poner en una carpeta'}
                                aria-label="Carpeta"
                                style={{ flexShrink: 0, background: 'transparent', border: 'none', fontSize: '1.3rem', cursor: 'pointer', padding: 0, opacity: dayEntryFolder ? 1 : 0.35 }}
                              >📁</button>
                            </div>
                            {dayEntryFolder && (
                              <div style={{ padding: '0 2px 8px', fontSize: '0.8rem', fontWeight: 700 }}>📁 {folderLabel(dayEntryFolder)}</div>
                            )}

                            {noteTagIds.length > 0 && (
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '0 2px 10px' }}>
                                {noteTagIds.map(tagId => {
                                  const tag = dayTags.find(t => t.id === tagId)
                                  if (!tag) return null
                                  return (
                                    <span
                                      key={tagId}
                                      style={{
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: 4,
                                        background: tag.color,
                                        color: '#3a3a3a',
                                        borderRadius: 999,
                                        padding: '4px 10px',
                                        fontSize: '0.8rem',
                                        fontWeight: 600,
                                      }}
                                    >
                                      {tag.name}
                                      <button
                                        type="button"
                                        onClick={() => toggleNoteTag(tagId)}
                                        title="Quitar etiqueta"
                                        style={{
                                          background: 'transparent',
                                          border: 'none',
                                          cursor: 'pointer',
                                          fontSize: '0.75rem',
                                          lineHeight: 1,
                                          padding: 0,
                                          color: '#3a3a3a',
                                        }}
                                      >✕</button>
                                    </span>
                                  )
                                })}
                              </div>
                            )}

                            {freeNoteBlocks.map((b, i) => (
                              <div key={b._key || i} className="note-sheet-block" style={{ position: 'relative' }}>
                                {b.type === 'text' && (
                                  <RichField
                                    fieldId={'d:' + b._key}
                                    className="note-sheet-block-edit"
                                    value={b.content}
                                    onChange={v => updateNoteBlockText(b._key, v)}
                                    minHeight="3.5em"
                                  />
                                )}
                                {b.type === 'photo' && (() => {
                                  const src = b.url || URL.createObjectURL(b.file)
                                  return (
                                    <div style={{ position: 'relative', display: b.size === 'g' ? 'block' : 'inline-block', maxWidth: '100%' }}>
                                      <img
                                        src={src}
                                        alt=""
                                        className="note-sheet-photo"
                                        style={photoSizeStyle(b.size)}
                                        onClick={() => { setViewingPhotoUrl(src); setViewingPhotoEdit({ url: src, kind: 'day', key: b._key }) }}
                                      />
                                      <div style={{ position: 'absolute', left: 4, bottom: 4, display: 'flex', gap: 4 }}>
                                        <button type="button" title="Imagen más pequeña" aria-label="Imagen más pequeña" disabled={(b.size || 'm') === 'p'} onClick={e => { e.preventDefault(); e.stopPropagation(); changePhotoSize('day', b._key, -1) }} style={{ minWidth: 30, minHeight: 30, background: 'rgba(255,255,255,0.9)', borderRadius: '50%', border: 'none', fontWeight: 700, boxShadow: '0 1px 4px rgba(0,0,0,0.3)', opacity: (b.size || 'm') === 'p' ? 0.4 : 1 }}>➖</button>
                                        <button type="button" title="Imagen más grande" aria-label="Imagen más grande" disabled={(b.size || 'm') === 'g'} onClick={e => { e.preventDefault(); e.stopPropagation(); changePhotoSize('day', b._key, 1) }} style={{ minWidth: 30, minHeight: 30, background: 'rgba(255,255,255,0.9)', borderRadius: '50%', border: 'none', fontWeight: 700, boxShadow: '0 1px 4px rgba(0,0,0,0.3)', opacity: (b.size || 'm') === 'g' ? 0.4 : 1 }}>➕</button>
                                      </div>
                                      <button
                                        type="button"
                                        title="Dibujar sobre esta imagen"
                                        aria-label="Dibujar sobre esta imagen"
                                        onClick={e => { e.preventDefault(); e.stopPropagation(); setDrawingEdit({ key: b._key, src }); setDrawingTarget('day') }}
                                        style={{ position: 'absolute', right: 4, bottom: 4, minWidth: 30, minHeight: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.9)', borderRadius: '50%', border: 'none', boxShadow: '0 1px 4px rgba(0,0,0,0.3)' }}
                                      ><span style={{ display: 'inline-block', transform: 'scaleX(-1)' }}>✏️</span></button>
                                    </div>
                                  )
                                })()}
                                {b.type === 'video' && (
                                  <video src={b.url || URL.createObjectURL(b.file)} controls className="note-video" />
                                )}
                                <button
                                  type="button"
                                  className="note-block-delete"
                                  onClick={e => { e.preventDefault(); e.stopPropagation(); deleteNoteBlock(b._key) }}
                                  title="Quitar este bloque"
                                  style={{
                                    position: 'absolute',
                                    top: 6,
                                    right: 6,
                                    zIndex: 5,
                                    pointerEvents: 'auto',
                                    minWidth: 32,
                                    minHeight: 32,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    color: '#D32F2F',
                                    background: 'rgba(255,255,255,0.85)',
                                    borderRadius: '50%',
                                    border: 'none',
                                    cursor: 'pointer',
                                  }}
                                >✕</button>
                              </div>
                            ))}
                            <RichField
                              fieldId="d:current"
                              className="note-sheet-textarea journal-textarea"
                              placeholder="Texto..."
                              value={freeNoteCurrentText}
                              onChange={v => { setFreeNoteCurrentTextSynced(v); scheduleDayNoteAutosave() }}
                              minHeight="11em"
                            />
                          </div>
                        ) : (
                          <div style={{ padding: '4px 4px 16px' }}>
                            <button type="button" className="full-form-btn" onClick={startNewEntryFromList}>➕ Nueva entrada</button>
                            {items.length === 0 ? (
                              <p className="status-msg">No hay entradas todavía para este día.</p>
                            ) : (
                              <div className="quick-notes-grid" style={{ marginTop: 12 }}>
                                {items.map(t => {
                                  const hasBlocks = t.content_blocks && t.content_blocks.length > 0
                                  const allTagIds = t.tag_id ? [t.tag_id] : (t.tag_ids || [])
                                  const tags = allTagIds.map(id => dayTags.find(g => g.id === id)).filter(Boolean)
                                  // Color: el propio de la entrada (si lo elegiste) tiene prioridad; si no,
                                  // se usa el de su etiqueta; si tampoco tiene, el pastel por defecto.
                                  const cardColor = t.color ? pastelize(t.color) : (tags[0] ? pastelize(tags[0].color) : '#FBEBD4')
                                  // Si le pusiste título propio, ese siempre se muestra en negrita arriba
                                  // y la nota completa va debajo. Si no le pusiste título, mostramos la
                                  // nota completa sola, bloque por bloque, sin inventar un título cortando
                                  // la primera línea.
                                  const bodyItems = []
                                  if (hasBlocks) {
                                    t.content_blocks.forEach((b, idx) => {
                                      if (b.type === 'text' && b.content.trim()) {
                                        bodyItems.push({ key: idx, type: 'text', content: b.content })
                                      } else if (b.type === 'photo') {
                                        bodyItems.push({ key: idx, type: 'photo', url: b.url })
                                      }
                                    })
                                  }
                                  const ownTitle = t.title && t.title.trim() ? t.title.trim() : null
                                  const taskTitle = !hasBlocks ? (ownTitle || tags[0]?.name || 'Entrada') : ownTitle
                                  return (
                                    <div key={t.id} className="quick-note-card" style={{ background: cardColor, position: 'relative' }}>
                                      {!hasBlocks && (
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                                          <input
                                            type="checkbox"
                                            checked={!!t.done}
                                            onChange={() => toggleEntryDone(t)}
                                            title="Confirmar que se llevó a cabo"
                                          />
                                          <span style={{ fontSize: '0.68rem', fontWeight: 700, color: t.done ? '#4CAF50' : '#B08968' }}>
                                            {t.done ? '✅ Hecho' : '⏳ Programada'}
                                          </span>
                                        </div>
                                      )}
                                      {t.important && (
                                        <div style={{ display: 'inline-block', background: 'rgba(0,0,0,0.08)', borderRadius: 999, padding: '3px 10px', fontSize: '0.75rem', fontWeight: 700, color: '#7a5c00', marginBottom: 6 }}>
                                          ⭐ {new Date(t.date + 'T00:00:00').toLocaleDateString('es-EC', { day: 'numeric', month: 'short', year: 'numeric' })} · {formatElapsedFull(t.date)}
                                        </div>
                                      )}
                                      {taskTitle && (
                                        <strong className="quick-note-title" onClick={() => openEditNote(t)} style={{ cursor: 'pointer', display: 'block' }}>{taskTitle}</strong>
                                      )}
                                      {!hasBlocks && t.note && (
                                        <div className="day-entry-card-text" onClick={() => openEditNote(t)} style={{ cursor: 'pointer' }}>{renderLinkedText(t.note)}</div>
                                      )}
                                      {bodyItems.map(item => item.type === 'text' ? (
                                        <div key={item.key} className="day-entry-card-text" onClick={() => openEditNote(t)} style={{ cursor: 'pointer' }}>{renderLinkedText(item.content)}</div>
                                      ) : (
                                        <img
                                          key={item.key}
                                          src={item.url}
                                          alt=""
                                          className="quick-note-photo"
                                          onClick={() => setViewingPhotoUrl(item.url)}
                                          style={{ cursor: 'zoom-in' }}
                                        />
                                      ))}
                                      {t.created_at && (
                                        <span style={{ display: 'block', fontSize: '0.72rem', color: 'rgba(0,0,0,0.5)', marginTop: 2 }}>
                                          Creada {formatRelativeDate(t.created_at)}
                                        </span>
                                      )}
                                      {tags.length > 0 && (
                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
                                          {tags.map(tag => (
                                            <span key={tag.id} className="quick-note-folder-tag">🏷️ {tag.name}</span>
                                          ))}
                                        </div>
                                      )}
                                      <div className="quick-note-actions">
                                        <button type="button" onClick={() => openEditNote(t)} title="Editar">✏️</button>
                                        <button type="button" onClick={() => setShareMenuEntryId(shareMenuEntryId === t.id ? null : t.id)} disabled={sharingNotes} title="Compartir"><ShareIcon /></button>
                                        <button type="button" onClick={() => deleteTask(t.id)} title="Borrar">✕</button>
                                      </div>
                                      {shareMenuEntryId === t.id && (
                                        <div
                                          style={{
                                            position: 'absolute',
                                            bottom: '110%',
                                            right: 0,
                                            background: '#fff',
                                            borderRadius: 10,
                                            boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
                                            overflow: 'hidden',
                                            zIndex: 20,
                                            minWidth: 190,
                                          }}
                                        >
                                          <button
                                            type="button"
                                            onClick={() => shareDayEntryViaWhatsApp(t)}
                                            style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '10px 14px', border: 'none', background: 'transparent', textAlign: 'left', cursor: 'pointer', color: '#3a3a2e' }}
                                          >💬 WhatsApp (solo texto)</button>
                                          <button
                                            type="button"
                                            onClick={() => shareDayEntryViaEmail(t)}
                                            style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '10px 14px', border: 'none', background: 'transparent', textAlign: 'left', cursor: 'pointer', color: '#3a3a2e' }}
                                          >📧 Correo (solo texto)</button>
                                          <button
                                            type="button"
                                            onClick={() => shareEntry(t)}
                                            style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '10px 14px', border: 'none', background: 'transparent', textAlign: 'left', cursor: 'pointer', color: '#3a3a2e', borderTop: '1px solid #eee' }}
                                          ><ShareIcon /> Compartir con foto/video...</button>
                                        </div>
                                      )}
                                    </div>
                                  )
                                })}
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                      {isEditing && isDictatingDayNote && (
                        <div className="dictation-live" role="status">🎙️ Escuchando… {dictationInterim || 'habla cuando quieras; toca ⏹️ para terminar'}</div>
                      )}
                      {isEditing && <FormatDock />}
                      {isEditing && (
                        <div className="note-sheet-toolbar note-sheet-toolbar-fixed">
                          <label className="icon-btn" title="Elegir foto de galería">
                            🖼️
                            <input
                              type="file"
                              accept="image/*"
                              style={{ display: 'none' }}
                              onChange={e => { openPhotoEditor(e.target.files[0]); e.target.value = '' }}
                            />
                          </label>
                          <label className="icon-btn" title="Tomar foto">
                            📷
                            <input
                              type="file"
                              accept="image/*"
                              capture="environment"
                              style={{ display: 'none' }}
                              onChange={e => { openPhotoEditor(e.target.files[0]); e.target.value = '' }}
                            />
                          </label>
                          <label className="icon-btn" title="Escanear documento">
                            📄
                            <input
                              type="file"
                              accept="image/*"
                              capture="environment"
                              style={{ display: 'none' }}
                              onChange={e => { openPhotoEditor(e.target.files[0], 'day', true); e.target.value = '' }}
                            />
                          </label>
                          <button type="button" className="icon-btn" title="Dibujar" onClick={() => setDrawingTarget('day')}>✏️</button>
                          <button type="button" className="icon-btn" title="Recordatorio" onClick={() => openReminder('day')}>🔔</button>
                          <label className="icon-btn" title="Agregar video">
                            🎥
                            <input
                              type="file"
                              accept="video/*"
                              style={{ display: 'none' }}
                              onChange={e => { insertVideoBlockToNote(e.target.files[0]); e.target.value = '' }}
                            />
                          </label>
                          <button type="button" className="icon-btn" title="Agregar etiqueta" onClick={() => setTagMenuOpen(true)}>🏷️</button>
                          <button
                            type="button"
                            className="icon-btn"
                            title={isDictatingDayNote ? 'Detener dictado' : 'Dictar por voz'}
                            onClick={toggleDayNoteDictation}
                            style={isDictatingDayNote ? { background: '#D32F2F', color: '#fff', borderRadius: '50%' } : undefined}
                          >
                            {isDictatingDayNote ? '⏹️' : '🎤'}
                          </button>
                          {(freeNoteBlocks.length > 0 || freeNoteCurrentText.trim() || editingTaskId) && (
                            <div style={{ position: 'relative' }}>
                              <button
                                type="button"
                                className="icon-btn"
                                title="Compartir esta nota"
                                onClick={() => setShareMenuEntryId(shareMenuEntryId === 'active' ? null : 'active')}
                                disabled={sharingNotes}
                              ><ShareIcon /></button>
                              {shareMenuEntryId === 'active' && (
                                <div
                                  style={{
                                    position: 'absolute',
                                    bottom: '110%',
                                    left: 0,
                                    background: '#fff',
                                    borderRadius: 10,
                                    boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
                                    overflow: 'hidden',
                                    zIndex: 20,
                                    minWidth: 190,
                                  }}
                                >
                                  <button
                                    type="button"
                                    onClick={() => shareDayEntryViaWhatsApp(getActiveEntryForShare())}
                                    style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '10px 14px', border: 'none', background: 'transparent', textAlign: 'left', cursor: 'pointer', color: '#3a3a2e' }}
                                  >💬 WhatsApp (solo texto)</button>
                                  <button
                                    type="button"
                                    onClick={() => shareDayEntryViaEmail(getActiveEntryForShare())}
                                    style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '10px 14px', border: 'none', background: 'transparent', textAlign: 'left', cursor: 'pointer', color: '#3a3a2e' }}
                                  >📧 Correo (solo texto)</button>
                                  <button
                                    type="button"
                                    onClick={() => shareEntry(getActiveEntryForShare())}
                                    style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '10px 14px', border: 'none', background: 'transparent', textAlign: 'left', cursor: 'pointer', color: '#3a3a2e', borderTop: '1px solid #eee' }}
                                  ><ShareIcon /> Compartir con foto/video...</button>
                                </div>
                              )}
                            </div>
                          )}
                          {freeNoteBlocks.length > 0 && (
                            <button type="button" className="icon-btn-text" onClick={removeLastNoteBlock}>Deshacer</button>
                          )}
                          {(freeNoteBlocks.length > 0 || freeNoteCurrentText.trim() || editingTaskId) && (
                            <button
                              type="button"
                              className="icon-btn-text"
                              title="Guarda esta entrada y abre una nueva vacía para otro tema"
                              onClick={startNewDayNoteBlock}
                            >+ Nueva entrada</button>
                          )}
                        </div>
                      )}
                    </>
                  )
                })()}

                {tagMenuOpen && (
                  <div className="tag-menu-overlay" onClick={() => setTagMenuOpen(false)}>
                    <div className="tag-menu-panel" onClick={e => e.stopPropagation()}>
                      <div className="tag-menu-header">
                        <h4>Etiquetas de este día</h4>
                        <button type="button" className="modal-close-btn" onClick={() => setTagMenuOpen(false)}>✕</button>
                      </div>
                      <div className="tag-menu-list">
                        {dayTags.length === 0 && <p className="status-msg">Aún no tienes etiquetas. Crea una abajo.</p>}
                        {dayTags.map(tag => {
                          const selected = noteTagIds.includes(tag.id)
                          return (
                            <button
                              key={tag.id}
                              type="button"
                              className="tag-menu-item"
                              onClick={() => toggleNoteTag(tag.id)}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                background: selected ? tag.color + '55' : undefined,
                                fontWeight: selected ? 700 : 400,
                              }}
                            >
                              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <span className="tag-menu-dot" style={{ background: tag.color }} />
                                {tag.name}
                              </span>
                              {selected && <span style={{ color: '#4CAF50' }}>✔️</span>}
                            </button>
                          )
                        })}
                      </div>

                      <form
                        onSubmit={createQuickNoteTag}
                        style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '10px 4px 4px', borderTop: '1px solid rgba(0,0,0,0.08)', marginTop: 8 }}
                      >
                        <input
                          placeholder="Nueva etiqueta..."
                          value={quickTagName}
                          onChange={e => setQuickTagName(e.target.value)}
                          style={{ width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 10, fontSize: '0.95rem' }}
                        />
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                          {['#FDE68A', '#FBCFE8', '#BFDBFE', '#BBF7D0', '#FCA5A5', '#DDD6FE', '#FDBA74', '#A7F3D0', '#C7D2FE', '#F9A8D4'].map(color => (
                            <button
                              key={color}
                              type="button"
                              className={`tag-color-swatch ${quickTagColor === color ? 'active' : ''}`}
                              style={{ background: color, width: 26, height: 26, borderRadius: '50%', border: quickTagColor === color ? '2px solid #333' : '1px solid rgba(0,0,0,0.1)' }}
                              onClick={() => setQuickTagColor(color)}
                            />
                          ))}
                        </div>
                        <button
                          type="submit"
                          disabled={creatingQuickTag || !quickTagName.trim()}
                          className="save-note-btn-inline"
                          style={{ width: '100%', minHeight: 44 }}
                        >
                          {creatingQuickTag ? 'Creando...' : '+ Crear y agregar etiqueta'}
                        </button>
                      </form>
                    </div>
                  </div>
                )}

              </div>
            </div>
          )}

          {quickNoteModalOpen && (
            <div className="admin-sheet-overlay" onClick={() => setQuickNoteModalOpen(false)}>
              <div className="day-panel day-panel-modal journal-panel journal-panel-flex" onClick={e => e.stopPropagation()}>
                <div className="journal-header">
                  <input
                    className="quick-note-title-input"
                    style={{ flex: 1, minWidth: 0, fontWeight: 'bold', fontSize: '1.05rem' }}
                    placeholder="Título de la nota"
                    value={quickNoteTitle}
                    onChange={e => setQuickNoteTitle(e.target.value)}
                  />
                  <button type="button" className="modal-close-btn" onClick={() => setQuickNoteModalOpen(false)} style={{ flexShrink: 0 }}>✕</button>
                </div>

                <div className="journal-scroll-body">
                  <div style={{ display: 'flex', gap: 6, padding: '0 2px 10px' }}>
                    {QUICK_NOTE_PASTELS.map(color => (
                      <button
                        key={color}
                        type="button"
                        onClick={() => setQuickNoteColor(color)}
                        title="Elegir color"
                        style={{
                          width: 26,
                          height: 26,
                          borderRadius: '50%',
                          background: color,
                          border: quickNoteColor === color ? '2px solid #3a3a2e' : '1px solid rgba(0,0,0,0.15)',
                          padding: 0,
                          flexShrink: 0,
                          cursor: 'pointer',
                        }}
                      />
                    ))}
                  </div>

                  {quickNoteFolder && (
                    <div className="temp-note-row">
                      <span className="filter-section-label" style={{ margin: 0 }}>📁 Carpeta: {folderLabel(quickNoteFolder)}</span>
                    </div>
                  )}

                  {quickNoteTemporary && (
                    <div className="temp-note-row">
                      <span className="filter-section-label" style={{ margin: 0 }}>🚩 Temporal · revisar en:</span>
                      {[{ d: 7, t: '1 semana' }, { d: 30, t: '1 mes' }, { d: 90, t: '3 meses' }].map(o => (
                        <button
                          key={o.d}
                          type="button"
                          className={`weather-pill ${quickNoteReviewAt === dateStrInDays(o.d) ? 'active' : ''}`}
                          onClick={() => setQuickNoteReviewAt(dateStrInDays(o.d))}
                        >{o.t}</button>
                      ))}
                      <input
                        type="date"
                        value={quickNoteReviewAt}
                        onChange={e => setQuickNoteReviewAt(e.target.value)}
                        className="temp-note-date"
                        aria-label="Fecha de revisión"
                      />
                    </div>
                  )}

                  <div className="free-note-sheet" style={{ background: quickNoteColor + '55' }}>
                    {quickNoteBlocks.map((b, i) => (
                      <div key={i} className="note-sheet-block">
                        {b.type === 'text' && (
                          <RichField
                            fieldId={'q:' + i}
                            value={b.content}
                            onChange={v => setQuickNoteBlocks(prev => prev.map((x, idx) => (idx === i ? { ...x, content: v } : x)))}
                            minHeight="2.5em"
                          />
                        )}
                        {b.type === 'photo' && (() => {
                          const src = b.url || URL.createObjectURL(b.file)
                          return (
                            <div style={{ position: 'relative', display: b.size === 'g' ? 'block' : 'inline-block', maxWidth: '100%' }}>
                              <img
                                src={src}
                                alt=""
                                className="note-sheet-photo"
                                style={photoSizeStyle(b.size)}
                                onClick={() => { setViewingPhotoUrl(src); setViewingPhotoEdit({ url: src, kind: 'quicknote', index: i }) }}
                              />
                                      <div style={{ position: 'absolute', left: 4, bottom: 4, display: 'flex', gap: 4 }}>
                                        <button type="button" title="Imagen más pequeña" aria-label="Imagen más pequeña" disabled={(b.size || 'm') === 'p'} onClick={e => { e.preventDefault(); e.stopPropagation(); changePhotoSize('quicknote', i, -1) }} style={{ minWidth: 30, minHeight: 30, background: 'rgba(255,255,255,0.9)', borderRadius: '50%', border: 'none', fontWeight: 700, boxShadow: '0 1px 4px rgba(0,0,0,0.3)', opacity: (b.size || 'm') === 'p' ? 0.4 : 1 }}>➖</button>
                                        <button type="button" title="Imagen más grande" aria-label="Imagen más grande" disabled={(b.size || 'm') === 'g'} onClick={e => { e.preventDefault(); e.stopPropagation(); changePhotoSize('quicknote', i, 1) }} style={{ minWidth: 30, minHeight: 30, background: 'rgba(255,255,255,0.9)', borderRadius: '50%', border: 'none', fontWeight: 700, boxShadow: '0 1px 4px rgba(0,0,0,0.3)', opacity: (b.size || 'm') === 'g' ? 0.4 : 1 }}>➕</button>
                                      </div>
                              <button
                                type="button"
                                title="Dibujar sobre esta imagen"
                                aria-label="Dibujar sobre esta imagen"
                                onClick={e => { e.preventDefault(); e.stopPropagation(); setDrawingEdit({ index: i, src }); setDrawingTarget('quicknote') }}
                                style={{ position: 'absolute', right: 4, bottom: 4, minWidth: 30, minHeight: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.9)', borderRadius: '50%', border: 'none', boxShadow: '0 1px 4px rgba(0,0,0,0.3)' }}
                              ><span style={{ display: 'inline-block', transform: 'scaleX(-1)' }}>✏️</span></button>
                            </div>
                          )
                        })()}
                        {b.type === 'video' && <video src={b.url || URL.createObjectURL(b.file)} controls className="note-video" />}
                        <button
                          type="button"
                          className="note-block-delete"
                          onClick={() => setQuickNoteBlocks(prev => prev.filter((_, idx) => idx !== i))}
                          title="Quitar este bloque"
                        >✕</button>
                      </div>
                    ))}
                    <RichField
                      fieldId="q:current"
                      className="note-sheet-textarea journal-textarea"
                      placeholder="Escribe aquí..."
                      value={quickNoteCurrentText}
                      onChange={setQuickNoteCurrentText}
                      minHeight={quickNoteBlocks.length > 0 ? '4.5em' : '11em'}
                    />
                    {(() => {
                      // El cuadro de texto no permite tocar enlaces, así que se listan aquí para abrirlos.
                      const urls = extractUrls([...quickNoteBlocks.filter(b => b.type === 'text').map(b => b.content), quickNoteCurrentText].join('\n'))
                      if (urls.length === 0) return null
                      return (
                        <div className="note-links-row">
                          <span className="filter-section-label" style={{ margin: 0 }}>Enlaces:</span>
                          {urls.map(u => {
                            const label = u.url.replace(/^https?:\/\/(www\.)?/i, '')
                            return (
                              <a key={u.href} href={u.href} target="_blank" rel="noopener noreferrer" className="note-link-chip" title={u.href}>
                                🔗 {label.length > 38 ? label.slice(0, 38) + '…' : label}
                              </a>
                            )
                          })}
                        </div>
                      )
                    })()}
                  </div>
                </div>

                {isDictatingQuickNote && (
                  <div className="dictation-live" role="status">🎙️ Escuchando… {dictationInterim || 'habla cuando quieras; toca ⏹️ para terminar'}</div>
                )}
                <FormatDock />
                <div className="note-sheet-toolbar note-sheet-toolbar-fixed" style={{ position: 'relative' }}>
                  <label className="icon-btn" title="Elegir foto de galería">
                    🖼️
                    <input
                      type="file"
                      accept="image/*"
                      style={{ display: 'none' }}
                      onChange={e => { openPhotoEditor(e.target.files[0], 'quicknote'); e.target.value = '' }}
                    />
                  </label>
                  <label className="icon-btn" title="Tomar foto">
                    📷
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      style={{ display: 'none' }}
                      onChange={e => { openPhotoEditor(e.target.files[0], 'quicknote'); e.target.value = '' }}
                    />
                  </label>
                  <label className="icon-btn" title="Escanear documento">
                    📄
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      style={{ display: 'none' }}
                      onChange={e => { openPhotoEditor(e.target.files[0], 'quicknote', true); e.target.value = '' }}
                    />
                  </label>
                  <button type="button" className="icon-btn" title="Dibujar" onClick={() => setDrawingTarget('quicknote')}>✏️</button>
                  <button type="button" className="icon-btn" title="Recordatorio" onClick={() => openReminder('quicknote')}>🔔</button>
                  <label className="icon-btn" title="Agregar video">
                    🎥
                    <input
                      type="file"
                      accept="video/*"
                      style={{ display: 'none' }}
                      onChange={e => { insertVideoBlockToQuickNote(e.target.files[0]); e.target.value = '' }}
                    />
                  </label>
                  <button
                    type="button"
                    className="icon-btn"
                    title={isDictatingQuickNote ? 'Detener dictado' : 'Dictar por voz'}
                    onClick={toggleQuickNoteDictation}
                    style={isDictatingQuickNote ? { background: '#D32F2F', color: '#fff', borderRadius: '50%' } : undefined}
                  >
                    {isDictatingQuickNote ? '⏹️' : '🎤'}
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    title={quickNoteTemporary ? 'Nota temporal (toca para quitar)' : 'Marcar como temporal'}
                    aria-pressed={quickNoteTemporary}
                    onClick={() => {
                      const next = !quickNoteTemporary
                      setQuickNoteTemporary(next)
                      if (next && !quickNoteReviewAt) setQuickNoteReviewAt(dateStrInDays(30))
                    }}
                    style={quickNoteTemporary ? { background: '#fde0dc', borderColor: '#D32F2F' } : { opacity: 0.75 }}
                  >🚩</button>
                  <button
                    type="button"
                    className="icon-btn"
                    title={quickNoteFavorite ? 'Favorita (toca para quitar)' : 'Marcar como favorita'}
                    aria-pressed={quickNoteFavorite}
                    onClick={() => setQuickNoteFavorite(f => !f)}
                    style={quickNoteFavorite ? { background: '#fff3c4', borderColor: '#D99A1E' } : undefined}
                  >{quickNoteFavorite ? '⭐' : '☆'}</button>
                  <button
                    type="button"
                    className="icon-btn"
                    title={quickNoteFolder ? 'Carpeta: ' + folderLabel(quickNoteFolder) : 'Poner en una carpeta'}
                    aria-label="Carpeta"
                    onClick={() => setFolderPicker({ mode: 'editor', value: '' })}
                    style={quickNoteFolder ? { background: '#e3f0dc', borderColor: '#4B7F52' } : { opacity: 0.75 }}
                  >📁</button>
                  {(quickNoteBlocks.length > 0 || quickNoteCurrentText.trim() || quickNoteTitle.trim()) && (
                    <>
                      <button
                        type="button"
                        className="icon-btn"
                        title="Compartir esta nota"
                        onMouseDown={e => e.preventDefault()}
                        onClick={() => {
                          if (shareMenuNoteId === 'active') { setShareMenuNoteId(null); return }
                          setShareSelText(getSelectedEditorText())
                          setShareMenuNoteId('active')
                        }}
                        disabled={sharingNotes}
                      ><ShareIcon /></button>
                      {shareMenuNoteId === 'active' && (
                        <div
                          style={{
                            position: 'absolute',
                            bottom: '100%',
                            left: 12,
                            background: '#fff',
                            borderRadius: 10,
                            boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
                            overflow: 'hidden',
                            zIndex: 30,
                            minWidth: 230,
                            maxHeight: '60vh',
                            overflowY: 'auto',
                          }}
                        >
                          {shareSelText && (() => {
                            const selNote = { title: '', content: shareSelText, content_blocks: [{ type: 'text', content: shareSelText }] }
                            const photos = getActiveQuickNoteForShare().content_blocks.filter(b => b.type === 'photo')
                            const itemStyle = { display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '10px 14px', border: 'none', background: 'transparent', textAlign: 'left', cursor: 'pointer', color: '#3a3a2e' }
                            return (
                              <div style={{ background: '#fffaf0', borderBottom: '2px solid #e5d9bd' }}>
                                <div style={{ padding: '8px 14px 2px', fontSize: '0.78rem', color: '#6b6b5a' }}>
                                  Solo lo que seleccionaste: «{shareSelText.length > 30 ? shareSelText.slice(0, 30) + '…' : shareSelText}»
                                </div>
                                <button type="button" style={itemStyle} onClick={() => shareQuickNoteViaWhatsApp(selNote)}>💬 WhatsApp</button>
                                <button type="button" style={itemStyle} onClick={() => shareQuickNoteViaEmail(selNote)}>📧 Correo</button>
                                <button type="button" style={itemStyle} onClick={() => shareQuickNote(selNote)}><ShareIcon /> Otras apps</button>
                                {photos.length > 0 && (
                                  <button type="button" style={itemStyle} onClick={() => shareQuickNote({ ...selNote, content_blocks: [...selNote.content_blocks, ...photos] })}>📷 Selección + fotos de la nota</button>
                                )}
                                <div style={{ padding: '6px 14px 2px', fontSize: '0.78rem', color: '#6b6b5a' }}>O toda la nota:</div>
                              </div>
                            )
                          })()}
                          <button
                            type="button"
                            onClick={() => shareQuickNoteViaWhatsApp(getActiveQuickNoteForShare())}
                            style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '10px 14px', border: 'none', background: 'transparent', textAlign: 'left', cursor: 'pointer', color: '#3a3a2e' }}
                          >💬 WhatsApp (solo texto)</button>
                          <button
                            type="button"
                            onClick={() => shareQuickNoteViaEmail(getActiveQuickNoteForShare())}
                            style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '10px 14px', border: 'none', background: 'transparent', textAlign: 'left', cursor: 'pointer', color: '#3a3a2e' }}
                          >📧 Correo (solo texto)</button>
                          <button
                            type="button"
                            onClick={() => shareQuickNote(getActiveQuickNoteForShare())}
                            style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '10px 14px', border: 'none', background: 'transparent', textAlign: 'left', cursor: 'pointer', color: '#3a3a2e', borderTop: '1px solid #eee' }}
                          ><ShareIcon /> Compartir con foto...</button>
                        </div>
                      )}
                    </>
                  )}
                  {quickNoteBlocks.length > 0 && (
                    <button type="button" className="icon-btn-text" onClick={removeLastQuickNoteBlock}>Deshacer</button>
                  )}
                  <button type="button" className="save-note-btn-inline" onClick={saveQuickNoteFull} disabled={savingQuickNote}>
                    {savingQuickNote ? 'Guardando...' : 'Guardar'}
                  </button>
                </div>
              </div>
            </div>
          )}

      {viewingPhotoUrl && (
        <div
          className="admin-sheet-overlay"
          style={{ zIndex: 55, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.9)' }}
          onClick={() => setViewingPhotoUrl(null)}
        >
          <button
            type="button"
            onClick={() => setViewingPhotoUrl(null)}
            style={{ position: 'absolute', top: 16, right: 16, color: '#fff', background: 'transparent', border: 'none', fontSize: '1.8rem', minWidth: 44, minHeight: 44 }}
          >✕</button>
          <img src={viewingPhotoUrl} alt="" style={{ maxWidth: '95%', maxHeight: '90vh', objectFit: 'contain' }} onClick={e => e.stopPropagation()} />
          {viewingPhotoEdit && viewingPhotoEdit.url === viewingPhotoUrl && (
            <button
              type="button"
              onClick={e => {
                e.stopPropagation()
                const ve = viewingPhotoEdit
                setDrawingEdit(ve.kind === 'quicknote' ? { index: ve.index, src: ve.url } : { key: ve.key, src: ve.url })
                setDrawingTarget(ve.kind)
                setViewingPhotoUrl(null)
              }}
              style={{ position: 'absolute', bottom: 22, left: '50%', transform: 'translateX(-50%)', border: 'none', borderRadius: 24, padding: '12px 20px', fontWeight: 700, fontSize: '1rem', background: '#fff', color: '#222', boxShadow: '0 2px 10px rgba(0,0,0,0.4)' }}
            ><span style={{ display: 'inline-block', transform: 'scaleX(-1)' }}>✏️</span> Dibujar sobre la imagen</button>
          )}
        </div>
      )}

      {folderPicker && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 100000, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 14 }} onClick={() => setFolderPicker(null)}>
          <div style={{ background: '#FBF3E4', borderRadius: 16, padding: 14, width: '100%', maxWidth: 360, maxHeight: '88vh', overflowY: 'auto', color: '#3b2f22' }} onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 10px' }}>📁 {folderPicker.mode === 'bulk' ? `Mover ${selectedNoteIds.length} ${selectedNoteIds.length === 1 ? 'nota' : 'notas'} a…` : 'Poner en…'}</h3>
            {(() => {
              const pick = f => {
                if (folderPicker.mode === 'bulk') { moveNotesToFolder(selectedNoteIds, f); exitSelectMode() }
                else if (folderPicker.mode === 'day') { setDayEntryFolderSynced(f, true); scheduleDayNoteAutosave() }
                else setQuickNoteFolder(f)
                setFolderPicker(null)
              }
              const rowStyle = on => ({ display: 'block', width: '100%', textAlign: 'left', padding: '10px 12px', marginBottom: 6, borderRadius: 10, border: on ? '2px solid #4B7F52' : '1px solid #c9b48a', background: on ? '#e3f0dc' : '#fff', fontSize: '1rem', fontWeight: 600 })
              return (
                <>
                  <button type="button" style={rowStyle(folderPicker.mode !== 'bulk' && !(folderPicker.mode === 'day' ? dayEntryFolder : quickNoteFolder))} onClick={() => pick(null)}>Sin carpeta</button>
                  {allFolders.map(f => (
                    <button key={f} type="button" style={{ ...rowStyle(folderPicker.mode !== 'bulk' && (folderPicker.mode === 'day' ? dayEntryFolder : quickNoteFolder) === f), paddingLeft: 12 + (f.split('/').length - 1) * 18 }} onClick={() => pick(f)}>📁 {folderLeaf(f)}</button>
                  ))}
                  <form
                    style={{ display: 'flex', gap: 6, marginTop: 8 }}
                    onSubmit={e => { e.preventDefault(); const made = createFolder(folderPicker.value); if (made) pick(made) }}
                  >
                    <input
                      value={folderPicker.value}
                      onChange={e => setFolderPicker(p => ({ ...p, value: e.target.value }))}
                      placeholder="➕ Carpeta nueva (Familia/Fiestas = subcarpeta)"
                      style={{ flex: 1, padding: 9, borderRadius: 10, border: '1px solid #c9b48a', fontSize: '1rem' }}
                    />
                    <button type="submit" disabled={!folderPicker.value.trim()} style={{ border: 'none', borderRadius: 10, padding: '0 14px', fontWeight: 700, background: '#4B7F52', color: '#fff' }}>✔</button>
                  </form>
                </>
              )
            })()}
          </div>
        </div>
      )}
      {trashOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 100000, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12 }} onClick={() => setTrashOpen(false)}>
          <div style={{ background: '#FBF3E4', borderRadius: 16, padding: 14, width: '100%', maxWidth: 440, maxHeight: '92vh', display: 'flex', flexDirection: 'column', color: '#3b2f22' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
              <h3 style={{ margin: 0, flex: 1 }}>🗑️ Papelera</h3>
              <button type="button" onClick={() => setTrashOpen(false)} style={{ border: 'none', background: 'transparent', fontSize: '1.3rem' }} aria-label="Cerrar">✕</button>
            </div>
            <label style={{ fontSize: '0.8rem', fontWeight: 700, display: 'block', marginBottom: 8 }}>
              Borrar para siempre después de
              <select value={trashDays} onChange={e => changeTrashDays(e.target.value)} style={{ display: 'block', width: '100%', marginTop: 3, padding: 8, borderRadius: 8, border: '1px solid #c9b48a', fontSize: '1rem' }}>
                <option value={7}>7 días</option>
                <option value={15}>15 días</option>
                <option value={30}>30 días</option>
                <option value={60}>60 días</option>
                <option value={90}>90 días</option>
                <option value={365}>1 año</option>
                <option value={0}>Nunca (yo la vacío)</option>
              </select>
            </label>
            <div style={{ overflowY: 'auto', flex: 1, minHeight: 80 }}>
              {trashLoading ? <p>Cargando…</p> : trashItems.length === 0 ? (
                <p style={{ opacity: 0.7 }}>La papelera está vacía.</p>
              ) : trashItems.map(item => {
                const left = trashDays ? Math.max(0, Math.ceil(trashDays - (Date.now() - new Date(item.deleted_at).getTime()) / 86400000)) : null
                return (
                  <div key={item.id} style={{ background: '#fff', borderRadius: 10, padding: 10, marginBottom: 8, boxShadow: '0 1px 3px rgba(0,0,0,0.12)' }}>
                    <div style={{ fontWeight: 700 }}>{item.kind === 'quick_note' ? '📓' : '📅'} {item.title}</div>
                    <div style={{ fontSize: '0.75rem', opacity: 0.7, margin: '2px 0 6px' }}>
                      Borrada {formatRelativeDate(item.deleted_at)}{left !== null ? ` · se borra para siempre en ${left} ${left === 1 ? 'día' : 'días'}` : ''}
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button type="button" onClick={() => restoreTrashItem(item)} style={{ border: 'none', borderRadius: 8, padding: '7px 12px', fontWeight: 700, background: '#4B7F52', color: '#fff' }}>↩️ Restaurar</button>
                      <button type="button" onClick={() => deleteTrashItemForever(item)} style={{ border: 'none', borderRadius: 8, padding: '7px 12px', fontWeight: 700, background: '#e6dcc6' }}>Borrar ya</button>
                    </div>
                  </div>
                )
              })}
            </div>
            {trashItems.length > 0 && (
              <button type="button" onClick={emptyTrash} style={{ marginTop: 6, border: 'none', borderRadius: 10, padding: '9px', fontWeight: 700, background: '#C62828', color: '#fff' }}>Vaciar papelera</button>
            )}
          </div>
        </div>
      )}
      {reminder && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 100000, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 14 }} onClick={() => setReminder(null)}>
          <div style={{ background: '#FBF3E4', borderRadius: 16, padding: 16, width: '100%', maxWidth: 380, maxHeight: '92vh', overflowY: 'auto', color: '#3b2f22' }} onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 10px' }}>🔔 Recordatorio</h3>
            {[
              ['Qué recordar', <input key="t" type="text" value={reminder.title} onChange={e => setReminder(r => ({ ...r, title: e.target.value }))} placeholder="Ej: Cumpleaños de Ana" style={{ width: '100%', boxSizing: 'border-box', padding: 8, borderRadius: 8, border: '1px solid #c9b48a', fontSize: '1rem' }} />],
              ['Fecha', <input key="d" type="date" value={reminder.date} onChange={e => setReminder(r => ({ ...r, date: e.target.value }))} style={{ width: '100%', boxSizing: 'border-box', padding: 8, borderRadius: 8, border: '1px solid #c9b48a', fontSize: '1rem' }} />],
              ['Hora (déjala vacía si es todo el día)', <input key="h" type="time" value={reminder.time} onChange={e => setReminder(r => ({ ...r, time: e.target.value }))} style={{ width: '100%', boxSizing: 'border-box', padding: 8, borderRadius: 8, border: '1px solid #c9b48a', fontSize: '1rem' }} />],
              ['Repetir', <select key="r" value={reminder.repeat} onChange={e => setReminder(r => ({ ...r, repeat: e.target.value }))} style={{ width: '100%', padding: 8, borderRadius: 8, border: '1px solid #c9b48a', fontSize: '1rem' }}>
                <option value="none">No repetir</option>
                <option value="year">Cada año (cumpleaños)</option>
                <option value="month">Cada mes</option>
                <option value="week">Cada semana</option>
              </select>],
              ['Avisar', reminder.time ? (
                <select key="a" value={reminder.alert} onChange={e => setReminder(r => ({ ...r, alert: e.target.value }))} style={{ width: '100%', padding: 8, borderRadius: 8, border: '1px solid #c9b48a', fontSize: '1rem' }}>
                  <option value="now">A la hora</option>
                  <option value="m10">10 minutos antes</option>
                  <option value="h1">1 hora antes</option>
                  <option value="d1">1 día antes</option>
                </select>
              ) : (
                <select key="a" value={reminder.alert === 'd1' ? 'd1' : 'now'} onChange={e => setReminder(r => ({ ...r, alert: e.target.value }))} style={{ width: '100%', padding: 8, borderRadius: 8, border: '1px solid #c9b48a', fontSize: '1rem' }}>
                  <option value="now">Ese día a las 9:00</option>
                  <option value="d1">El día anterior a las 9:00</option>
                </select>
              )],
            ].map(([label, field]) => (
              <label key={label} style={{ display: 'block', marginBottom: 10, fontSize: '0.8rem', fontWeight: 700 }}>
                {label}
                <div style={{ marginTop: 3, fontWeight: 400 }}>{field}</div>
              </label>
            ))}
            <p style={{ fontSize: '0.75rem', margin: '0 0 10px', opacity: 0.8 }}>Se abrirá tu calendario del celular para guardarlo. Ahí es donde suena el aviso, aunque la app esté cerrada.</p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => setReminder(null)} style={{ border: 'none', borderRadius: 10, padding: '9px 14px', fontWeight: 700, background: '#e6dcc6' }}>Cancelar</button>
              <button
                type="button"
                onClick={() => {
                  if (!reminder.title.trim()) { alert('Escribe qué quieres recordar.'); return }
                  if (!reminder.date) { alert('Elige la fecha.'); return }
                  downloadReminderIcs(reminder)
                  setReminder(null)
                }}
                style={{ border: 'none', borderRadius: 10, padding: '9px 14px', fontWeight: 700, background: '#4B7F52', color: '#fff' }}
              >📅 Agregar al calendario</button>
            </div>
          </div>
        </div>
      )}
      {drawingTarget && (
        <DrawingPad
          initialSrc={drawingEdit ? drawingEdit.src : null}
          onCancel={() => { setDrawingTarget(null); setDrawingEdit(null) }}
          onDone={file => {
            if (drawingEdit) replaceDrawnBlock(drawingTarget, drawingEdit, file)
            else if (drawingTarget === 'quicknote') insertPhotoBlockToQuickNote(file)
            else insertPhotoBlockToNote(file)
            setDrawingTarget(null)
            setDrawingEdit(null)
          }}
        />
      )}
      {photoEditorOpen && photoEditorPreview && (
        <div
          className="admin-sheet-overlay"
          style={{ zIndex: 60, display: 'flex', flexDirection: 'column', background: 'rgba(0,0,0,0.85)' }}
          onClick={e => e.stopPropagation()}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px' }}>
            <button
              type="button"
              onClick={closePhotoEditor}
              style={{ color: '#fff', background: 'transparent', border: 'none', fontSize: '1rem', minHeight: 44, minWidth: 44 }}
            >Cancelar</button>
            <span style={{ color: '#fff', fontWeight: 600 }}>Editar foto</span>
            <button
              type="button"
              onClick={confirmPhotoEditor}
              style={{ color: '#4CAF50', background: 'transparent', border: 'none', fontSize: '1rem', fontWeight: 700, minHeight: 44, minWidth: 44 }}
            >Agregar ✔️</button>
          </div>

          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12, minHeight: 0 }}>
            <div
              ref={cropBoxDisplayRef}
              style={{ position: 'relative', maxWidth: '100%', maxHeight: '100%', touchAction: 'none', overflow: 'hidden', lineHeight: 0 }}
            >
              <img
                src={photoEditorPreview}
                alt=""
                draggable={false}
                style={{ display: 'block', maxWidth: '100%', maxHeight: '70vh', userSelect: 'none' }}
              />
              {/* Recuadro de recorte: su propia sombra "gigante" oscurece todo lo que queda afuera */}
              <div
                onMouseDown={e => startCropDrag('move', e)}
                onTouchStart={e => startCropDrag('move', e)}
                style={{
                  position: 'absolute',
                  left: (photoEditorCrop.x * 100) + '%',
                  top: (photoEditorCrop.y * 100) + '%',
                  width: (photoEditorCrop.w * 100) + '%',
                  height: (photoEditorCrop.h * 100) + '%',
                  border: '2px solid #fff',
                  boxShadow: '0 0 0 9999px rgba(0,0,0,0.55)',
                  cursor: 'move',
                  touchAction: 'none',
                }}
              >
                {['nw', 'ne', 'sw', 'se'].map(corner => (
                  <div
                    key={corner}
                    onMouseDown={e => startCropDrag(corner, e)}
                    onTouchStart={e => startCropDrag(corner, e)}
                    style={{
                      position: 'absolute',
                      width: 26,
                      height: 26,
                      borderRadius: '50%',
                      background: '#fff',
                      border: '2px solid #D32F2F',
                      cursor: corner + '-resize',
                      touchAction: 'none',
                      top: corner.includes('n') ? -13 : undefined,
                      bottom: corner.includes('s') ? -13 : undefined,
                      left: corner.includes('w') ? -13 : undefined,
                      right: corner.includes('e') ? -13 : undefined,
                    }}
                  />
                ))}
              </div>
            </div>
          </div>

          {photoEditorNotice && (
            <div style={{ color: '#fff', textAlign: 'center', fontSize: '0.85rem', padding: '0 16px 6px', opacity: 0.9 }}>{photoEditorNotice}</div>
          )}
          <div style={{ display: 'flex', justifyContent: 'center', gap: 8, padding: '4px 12px 0', flexWrap: 'wrap' }}>
            {[['original', 'Original'], ['documento', '📄 Documento'], ['bn', '◼︎ Blanco y negro']].map(([f, label]) => (
              <button
                key={f}
                type="button"
                onClick={() => changePhotoFilter(f)}
                style={{
                  color: '#fff', border: photoEditorFilter === f ? '2px solid #4CAF50' : '2px solid transparent',
                  background: photoEditorFilter === f ? 'rgba(76,175,80,0.3)' : 'rgba(255,255,255,0.15)',
                  borderRadius: 999, minHeight: 40, padding: '4px 14px', fontSize: '0.85rem',
                }}
              >{label}</button>
            ))}
            <button
              type="button"
              onClick={detectSheetInEditor}
              style={{ color: '#fff', border: '2px solid transparent', background: 'rgba(255,255,255,0.15)', borderRadius: 999, minHeight: 40, padding: '4px 14px', fontSize: '0.85rem' }}
            >📐 Detectar hoja</button>
          </div>

          <div style={{ display: 'flex', justifyContent: 'center', gap: 16, padding: '14px 16px 24px' }}>
            <button
              type="button"
              onClick={() => rotatePhotoEditor('left')}
              title="Rotar a la izquierda"
              style={{ color: '#fff', background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: 12, minWidth: 52, minHeight: 52, fontSize: '1.3rem' }}
            >↺</button>
            <button
              type="button"
              onClick={() => setPhotoEditorCrop({ x: 0, y: 0, w: 1, h: 1 })}
              title="Restablecer recorte"
              style={{ color: '#fff', background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: 12, minWidth: 52, minHeight: 52, fontSize: '0.85rem' }}
            >Sin recorte</button>
            <button
              type="button"
              onClick={() => rotatePhotoEditor('right')}
              title="Rotar a la derecha"
              style={{ color: '#fff', background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: 12, minWidth: 52, minHeight: 52, fontSize: '1.3rem' }}
            >↻</button>
          </div>
        </div>
      )}

    </div>
  )
}


// ---------- Muestra el error en pantalla en vez de dejarla en blanco ----------
function mostrarErrorPantalla(msg) {
  try {
    let box = document.getElementById('days-error-box')
    if (!box) {
      box = document.createElement('pre')
      box.id = 'days-error-box'
      box.style.cssText = 'position:fixed;inset:0;z-index:99999;margin:0;padding:16px;background:#fff;color:#b00020;font:13px/1.4 monospace;white-space:pre-wrap;overflow:auto'
      document.body.appendChild(box)
    }
    box.textContent = 'Error en Days (mándale una captura a Claude):\n\n' + msg
  } catch (e) { /* ignorar */ }
}
if (typeof window !== 'undefined') {
  window.addEventListener('error', (e) => mostrarErrorPantalla(String(e.message) + '\n' + (e.filename || '') + ':' + (e.lineno || '')))
  window.addEventListener('unhandledrejection', (e) => mostrarErrorPantalla('Promesa: ' + String((e.reason && (e.reason.stack || e.reason.message)) || e.reason)))
}

class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null } }
  static getDerivedStateFromError(error) { return { error } }
  render() {
    if (this.state.error) {
      return <pre style={{ padding: 16, color: '#b00020', whiteSpace: 'pre-wrap', font: '13px/1.4 monospace' }}>{'Error en Days (mándale una captura a Claude):\n\n' + String(this.state.error && (this.state.error.stack || this.state.error.message || this.state.error))}</pre>
    }
    return this.props.children
  }
}

export default function App() {
  return <ErrorBoundary><AppInner /></ErrorBoundary>
}
