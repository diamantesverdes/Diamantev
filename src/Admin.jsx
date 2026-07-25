import { useState, useEffect } from 'react'
import { supabase } from './supabaseClient'

const ADMIN_KEY = import.meta.env.VITE_ADMIN_KEY

export default function Admin() {
  const [authed, setAuthed] = useState(false)
  const [pass, setPass] = useState('')
  const [failed, setFailed] = useState(false)

  // 'home' | 'plantas' | 'categorias' | 'pedidos' | 'ingresos'
  const [view, setView] = useState('home')
  const [catSubTab, setCatSubTab] = useState('categories')

  const [galleryFilter, setGalleryFilter] = useState('all')
  const [plantsFilter, setPlantsFilter] = useState('all')
  const [plantsSearch, setPlantsSearch] = useState('')
  const [selectedLabels, setSelectedLabels] = useState(new Set())

  const [notes, setNotes] = useState([])
  const [noteForm, setNoteForm] = useState({ category_id: '', text: '', photos: [], video: null })
  const [savingNote, setSavingNote] = useState(false)
  const [selectedNotes, setSelectedNotes] = useState(new Set())
  const [notesCategoryFilter, setNotesCategoryFilter] = useState('all')
  const [notesSearch, setNotesSearch] = useState('')

  const [gardenTags, setGardenTags] = useState([])
  const [gardenTasks, setGardenTasks] = useState([])
  const [calendarMonth, setCalendarMonth] = useState(() => { const d = new Date(); d.setDate(1); return d })
  const [selectedDay, setSelectedDay] = useState(null)
  const [newTagForm, setNewTagForm] = useState({ name: '', color: '#a1665e' })
  const [taskFormOpen, setTaskFormOpen] = useState(false)
  const [taskForm, setTaskForm] = useState({ tag_id: '', date: '', note: '', repeat: 'none' })
  const [sharingNotes, setSharingNotes] = useState(false)

  const [orders, setOrders] = useState([])
  const [approvingIds, setApprovingIds] = useState([])

  const [compras, setCompras] = useState([])
  const [compraForm, setCompraForm] = useState({ plant_id: '', quantity: '', unit_cost: '', sale_price: '', proveedor: '', new_plant_name: '', new_plant_category: '' })
  const [savingCompra, setSavingCompra] = useState(false)

  const [decrementos, setDecrementos] = useState([])
  const [decForm, setDecForm] = useState({ plant_id: '', quantity: '', motivo: '', motivo_otro: '' })
  const [savingDec, setSavingDec] = useState(false)

  const [movSearch, setMovSearch] = useState('')
  const [movStatusFilter, setMovStatusFilter] = useState('all')
  const [movTypeFilter, setMovTypeFilter] = useState('all')

  const [plants, setPlants] = useState([])
  const [categories, setCategories] = useState([])
  const [loading, setLoading] = useState(true)

  const [newCatName, setNewCatName] = useState('')
  const [newCatEmoji, setNewCatEmoji] = useState('🌿')

  useEffect(() => { if (authed) loadData() }, [authed])

  async function loadData() {
    setLoading(true)
    const { data: cats } = await supabase.from('categories').select('*').order('name')
    const { data: pls } = await supabase.from('plants').select('*').order('name')
    const { data: ords } = await supabase.from('orders').select('*, order_items(*)').order('id', { ascending: false })
    const { data: comps } = await supabase.from('compras').select('*').order('created_at', { ascending: false })
    const { data: decs } = await supabase.from('decrementos').select('*').order('created_at', { ascending: false })
    const { data: nts } = await supabase.from('category_notes').select('*').order('created_at', { ascending: false })
    const { data: tags } = await supabase.from('garden_tags').select('*').order('created_at')
    const { data: tasks } = await supabase.from('garden_tasks').select('*').order('date')
    setCategories(cats || [])
    setPlants(pls || [])
    setOrders(ords || [])
    setCompras(comps || [])
    setDecrementos(decs || [])
    setNotes(nts || [])
    setGardenTags(tags || [])
    setGardenTasks(tasks || [])
    setLoading(false)
  }

  async function uploadImage(file, bucket = 'plant-photos') {
    const ext = file.name.split('.').pop()
    const fileName = `${Date.now()}.${ext}`
    const { error } = await supabase.storage.from(bucket).upload(fileName, file)
    if (error) { alert('Error al subir el archivo'); return null }
    const { data } = supabase.storage.from(bucket).getPublicUrl(fileName)
    return data.publicUrl
  }

  // ---------- Ingresos (compras) ----------
  async function addCompra(e) {
    e.preventDefault()
    const usingNew = !compraForm.plant_id && compraForm.new_plant_name
    if ((!compraForm.plant_id && !usingNew) || !compraForm.quantity || !compraForm.unit_cost) {
      alert('Selecciona una planta o escribe el nombre de una nueva, y completa cantidad y costo')
      return
    }
    if (usingNew && !compraForm.new_plant_category) {
      alert('Selecciona una categoría para la planta nueva')
      return
    }
    setSavingCompra(true)
    const quantity = Number(compraForm.quantity)
    const unit_cost = Number(compraForm.unit_cost)
    const sale_price = compraForm.sale_price ? Number(compraForm.sale_price) : null

    let image_url = null
    if (compraForm.file) image_url = await uploadImage(compraForm.file)

    if (usingNew) {
      const { error } = await supabase.from('compras').insert({
        plant_id: null,
        plant_name: compraForm.new_plant_name,
        new_plant_category: compraForm.new_plant_category,
        quantity,
        unit_cost,
        sale_price,
        image_url,
        total: quantity * unit_cost,
        proveedor: compraForm.proveedor,
        status: 'pedido',
      })
      if (error) {
        alert('Error al registrar el ingreso: ' + error.message)
        setSavingCompra(false)
        return
      }
    } else {
      const plant = plants.find(p => p.id === compraForm.plant_id)
      const { error } = await supabase.from('compras').insert({
        plant_id: compraForm.plant_id,
        plant_name: plant ? plant.name : '',
        quantity,
        unit_cost,
        sale_price,
        image_url,
        total: quantity * unit_cost,
        proveedor: compraForm.proveedor,
        status: 'pedido',
      })
      if (error) {
        alert('Error al registrar el ingreso: ' + error.message)
        setSavingCompra(false)
        return
      }
    }
    setCompraForm({ plant_id: '', quantity: '', unit_cost: '', sale_price: '', proveedor: '', new_plant_name: '', new_plant_category: '', file: null })
    setSavingCompra(false)
    loadData()
  }

  async function markCompraPagada(compra) {
    if (compra.status !== 'pedido' || approvingIds.includes(compra.id)) return
    setApprovingIds(prev => [...prev, compra.id])
    await supabase.from('compras').update({ status: 'pagado', fecha_pago: new Date().toISOString() }).eq('id', compra.id)
    await loadData()
    setApprovingIds(prev => prev.filter(id => id !== compra.id))
  }

  async function markCompraRecibida(compra) {
    if (compra.status !== 'pagado' || approvingIds.includes(compra.id)) return
    setApprovingIds(prev => [...prev, compra.id])
    await supabase.from('compras').update({ status: 'recibido', fecha_recibido: new Date().toISOString() }).eq('id', compra.id)

    if (compra.plant_id) {
      const plant = plants.find(p => p.id === compra.plant_id)
      if (plant) {
        await supabase.from('plants').update({ stock: plant.stock + compra.quantity }).eq('id', plant.id)
      }
    } else if (compra.new_plant_category) {
      await supabase.from('plants').insert({
        name: compra.plant_name,
        category_id: compra.new_plant_category,
        price: compra.sale_price || 0,
        stock: compra.quantity,
        image_url: compra.image_url || null,
      })
    }
    await loadData()
    setApprovingIds(prev => prev.filter(id => id !== compra.id))
  }

  // ---------- Ventas ----------
  async function markAsPaid(order) {
    if (order.status !== 'pedido' || approvingIds.includes(order.id)) return
    setApprovingIds(prev => [...prev, order.id])
    await supabase.from('orders').update({ status: 'pagado', fecha_pago: new Date().toISOString() }).eq('id', order.id)
    for (const item of order.order_items) {
      const plant = plants.find(p => p.id === item.plant_id)
      if (plant) {
        await supabase.from('plants').update({ stock: plant.stock - item.quantity }).eq('id', item.plant_id)
      }
    }
    await loadData()
    setApprovingIds(prev => prev.filter(id => id !== order.id))
  }

  async function markAsDelivered(order) {
    if (order.status !== 'pagado' || approvingIds.includes(order.id)) return
    setApprovingIds(prev => [...prev, order.id])
    await supabase.from('orders').update({ status: 'entregado', fecha_entrega: new Date().toISOString() }).eq('id', order.id)
    await loadData()
    setApprovingIds(prev => prev.filter(id => id !== order.id))
  }

  // ---------- Decrementos manuales ----------
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
    await supabase.from('decrementos').insert({
      plant_id: decForm.plant_id,
      plant_name: plant ? plant.name : '',
      quantity,
      motivo: decForm.motivo,
      motivo_otro: decForm.motivo === 'Otro' ? decForm.motivo_otro : null,
    })
    if (plant) {
      await supabase.from('plants').update({ stock: Math.max(0, plant.stock - quantity) }).eq('id', plant.id)
    }
    setDecForm({ plant_id: '', quantity: '', motivo: '', motivo_otro: '' })
    setSavingDec(false)
    loadData()
  }

  // ---------- Stock actual ----------
  async function updateStock(id, newStock) {
    await supabase.from('plants').update({ stock: newStock }).eq('id', id)
    loadData()
  }

  async function updatePrice(id, newPrice) {
    await supabase.from('plants').update({ price: newPrice }).eq('id', id)
    loadData()
  }

  async function toggleActive(id, current) {
    await supabase.from('plants').update({ active: !current }).eq('id', id)
    loadData()
  }

  async function deletePlant(id) {
    if (!confirm('¿Borrar esta planta permanentemente?')) return
    const { error } = await supabase.from('plants').delete().eq('id', id)
    if (error) {
      if (error.code === '23503') {
        alert('Esta planta no se puede borrar porque ya tiene pedidos registrados (se perdería ese historial). Usa "Ocultar" en su lugar.')
      } else {
        alert('Error al borrar la planta: ' + error.message)
      }
      return
    }
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
    await supabase.from('categories').insert({ name: newCatName, emoji: newCatEmoji })
    setNewCatName('')
    setNewCatEmoji('🌿')
    loadData()
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

  function selectAllLabels(list) {
    setSelectedLabels(new Set(list.map(p => p.id)))
  }

  function clearLabels() {
    setSelectedLabels(new Set())
  }

  function printLabels() {
    window.print()
  }

  // ---------- Notas por categoría ----------
  async function addNote(e) {
    e.preventDefault()
    if (!noteForm.category_id) {
      alert('Selecciona la categoría de la nota')
      return
    }
    if (!noteForm.text.trim() && noteForm.photos.length === 0 && !noteForm.video) {
      alert('Agrega texto, fotos o un video a la nota')
      return
    }
    setSavingNote(true)
    const photo_urls = []
    for (const file of noteForm.photos) {
      const url = await uploadImage(file, 'category-notes')
      if (url) photo_urls.push(url)
    }
    let video_url = null
    if (noteForm.video) video_url = await uploadImage(noteForm.video, 'category-notes')

    const { error } = await supabase.from('category_notes').insert({
      category_id: noteForm.category_id,
      text: noteForm.text,
      photo_urls,
      video_url,
    })
    if (error) {
      alert('Error al guardar la nota: ' + error.message)
      setSavingNote(false)
      return
    }
    setNoteForm({ category_id: noteForm.category_id, text: '', photos: [], video: null })
    setSavingNote(false)
    loadData()
  }

  async function deleteNote(id) {
    if (!confirm('¿Borrar esta nota permanentemente?')) return
    await supabase.from('category_notes').delete().eq('id', id)
    setSelectedNotes(prev => {
      const next = new Set(prev)
      next.delete(id)
      return next
    })
    loadData()
  }

  function toggleNoteSelect(id) {
    setSelectedNotes(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function selectAllNotes(list) {
    setSelectedNotes(new Set(list.map(n => n.id)))
  }

  function clearNoteSelection() {
    setSelectedNotes(new Set())
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

  async function shareNotes() {
    const selected = notes.filter(n => selectedNotes.has(n.id))
    if (selected.length === 0) return
    setSharingNotes(true)
    try {
      const textParts = []
      const fileUrls = []
      for (const n of selected) {
        const cat = categories.find(c => c.id === n.category_id)
        const header = `${cat ? (cat.emoji + ' ' + cat.name) : 'Nota'} (${new Date(n.created_at).toLocaleDateString()})`
        textParts.push(n.text ? `${header}:\n${n.text}` : header)
        for (const url of (n.photo_urls || [])) fileUrls.push(url)
        if (n.video_url) fileUrls.push(n.video_url)
      }
      const shareText = textParts.join('\n\n')
      const files = (await Promise.all(fileUrls.map(urlToFile))).filter(Boolean)

      if (navigator.share && files.length > 0 && navigator.canShare && navigator.canShare({ files })) {
        await navigator.share({ title: 'Notas Diamantev', text: shareText, files })
      } else if (navigator.share) {
        await navigator.share({ title: 'Notas Diamantev', text: shareText })
      } else {
        alert('Tu navegador no puede compartir archivos directamente. Se abrirá WhatsApp solo con el texto; las fotos/video deberás adjuntarlas manualmente.')
        window.open(`https://wa.me/?text=${encodeURIComponent(shareText)}`, '_blank')
      }
    } catch (err) {
      if (err.name !== 'AbortError') alert('No se pudo compartir. Intenta de nuevo.')
    }
    setSharingNotes(false)
  }

  // ---------- Calendario de Jardín ----------
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

  async function addTag(e) {
    e.preventDefault()
    if (!newTagForm.name.trim()) return
    const { error } = await supabase.from('garden_tags').insert({ name: newTagForm.name, color: newTagForm.color })
    if (error) { alert('Error al agregar etiqueta: ' + error.message); return }
    setNewTagForm({ name: '', color: '#a1665e' })
    loadData()
  }

  async function updateTagName(id, name) {
    if (!name.trim()) return
    await supabase.from('garden_tags').update({ name }).eq('id', id)
    loadData()
  }

  async function updateTagColor(id, color) {
    await supabase.from('garden_tags').update({ color }).eq('id', id)
    loadData()
  }

  async function deleteTag(id) {
    if (!confirm('¿Borrar esta etiqueta? También se borrarán todas sus tareas.')) return
    await supabase.from('garden_tags').delete().eq('id', id)
    loadData()
  }

  async function quickAddTask(tagId) {
    if (!selectedDay) return
    const { error } = await supabase.from('garden_tasks').insert({ tag_id: tagId, date: selectedDay, note: '', repeat: 'none' })
    if (error) { alert('Error al agregar tarea: ' + error.message); return }
    loadData()
  }

  async function deleteTask(id) {
    await supabase.from('garden_tasks').delete().eq('id', id)
    loadData()
  }

  function buildRepeatDates(startDateStr, repeat) {
    const dates = [startDateStr]
    if (repeat === 'none') return dates
    const [y, m, d] = startDateStr.split('-').map(Number)
    const count = repeat === 'monthly' ? 6 : 8
    for (let i = 1; i < count; i++) {
      const next = new Date(y, m - 1, d)
      if (repeat === 'weekly') next.setDate(next.getDate() + 7 * i)
      else if (repeat === 'biweekly') next.setDate(next.getDate() + 14 * i)
      else if (repeat === 'monthly') next.setMonth(next.getMonth() + i)
      dates.push(formatDateStr(next))
    }
    return dates
  }

  async function addTaskFull(e) {
    e.preventDefault()
    if (!taskForm.tag_id || !taskForm.date) {
      alert('Selecciona una etiqueta y una fecha')
      return
    }
    const dates = buildRepeatDates(taskForm.date, taskForm.repeat)
    const rows = dates.map(date => ({ tag_id: taskForm.tag_id, date, note: taskForm.note, repeat: taskForm.repeat }))
    const { error } = await supabase.from('garden_tasks').insert(rows)
    if (error) { alert('Error al guardar la tarea: ' + error.message); return }
    setTaskForm({ tag_id: '', date: '', note: '', repeat: 'none' })
    setTaskFormOpen(false)
    loadData()
  }

  if (!authed) {
    return (
      <div className="admin-login">
        <h2>Panel de administrador</h2>
        <input
          type="text"
          placeholder="Clave de acceso"
          value={pass}
          onChange={e => setPass(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && (pass === ADMIN_KEY ? setAuthed(true) : setFailed(true))}
        />
        <button onClick={() => pass === ADMIN_KEY ? setAuthed(true) : setFailed(true)}>Entrar</button>
        {failed && (
          <p style={{ color: '#b03434', fontSize: '0.85rem', marginTop: 10 }}>
            Clave incorrecta. Si la olvidaste, revísala en Vercel → Settings → Environment Variables → VITE_ADMIN_KEY.
          </p>
        )}
      </div>
    )
  }

  // Lista unificada de ventas + decrementos manuales, para "Pedidos"
  const movimientos = [
    ...orders.map(o => ({ ...o, _type: 'venta' })),
    ...decrementos.map(d => ({ ...d, _type: 'decremento' })),
  ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))

  const movimientosFiltrados = movimientos
    .filter(m => movTypeFilter === 'all' || m._type === movTypeFilter)
    .filter(m => movStatusFilter === 'all' || (m._type === 'venta' ? m.status === movStatusFilter : true))
    .filter(m => {
      const term = movSearch.toLowerCase()
      if (!term) return true
      if (m._type === 'venta') return (m.customer_name || '').toLowerCase().includes(term)
      return (m.plant_name || '').toLowerCase().includes(term) || (m.motivo || '').toLowerCase().includes(term)
    })

  // Números resumen para las tarjetas de inicio
  const pedidosPendientes = orders.filter(o => o.status === 'pedido').length
  const ingresosEnCurso = compras.filter(c => c.status !== 'recibido').length

  const cards = [
    { key: 'plantas', label: 'Plantas', icon: '🪴', count: plants.length },
    { key: 'categorias', label: 'Categorías', icon: '🏷️', count: categories.length },
    { key: 'pedidos', label: 'Pedidos', icon: '🧾', count: pedidosPendientes },
    { key: 'ingresos', label: 'Ingresos', icon: '📦', count: ingresosEnCurso },
    { key: 'notas', label: 'Notas', icon: '📝', count: notes.length },
    { key: 'calendario', label: 'Calendario', icon: '🌿', count: gardenTasks.filter(t => t.date >= formatDateStr(new Date())).length },
  ]

  const sheetTitles = {
    plantas: '🪴 Plantas',
    categorias: '🏷️ Categorías',
    pedidos: '🧾 Pedidos',
    ingresos: '📦 Ingresos',
    notas: '📝 Notas',
    calendario: '🌿 Calendario de Jardín',
  }

  // Datos del mes visible en el calendario
  const calYear = calendarMonth.getFullYear()
  const calMonth = calendarMonth.getMonth()
  const calFirstDay = new Date(calYear, calMonth, 1)
  const calStartOffset = calFirstDay.getDay()
  const calDaysInMonth = new Date(calYear, calMonth + 1, 0).getDate()
  const calMonthLabel = calendarMonth.toLocaleDateString('es-EC', { month: 'long', year: 'numeric' })
  const todayStr = formatDateStr(new Date())

  const calCells = []
  for (let i = 0; i < calStartOffset; i++) calCells.push(null)
  for (let d = 1; d <= calDaysInMonth; d++) calCells.push(new Date(calYear, calMonth, d))

  const tasksByDay = {}
  gardenTasks.forEach(t => {
    if (!tasksByDay[t.date]) tasksByDay[t.date] = []
    tasksByDay[t.date].push(t)
  })

  return (
    <div className="admin">
      <div className="admin-header">
        <h1>Panel de administrador — Diamantev</h1>
        <a href="/" className="back-to-store">🌿 Ver tienda</a>
      </div>

      <hr className="admin-divider" />

      {/* ---------- PANTALLA DE INICIO ---------- */}
      <div className="admin-home">
        <div className="admin-home-title">
          <span className="admin-script">Panel Diamantev</span>
          <p className="admin-home-sub">Administra tu jardín de un vistazo</p>
        </div>

        {loading ? (
          <p className="status-msg">Cargando...</p>
        ) : (
          <div className="admin-card-grid">
            {cards.map(c => (
              <button key={c.key} className="admin-card" onClick={() => setView(c.key)}>
                <span className="admin-card-icon">{c.icon}</span>
                <span className="admin-card-count">{c.count}</span>
                <span className="admin-card-label">{c.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ---------- HOJA DESLIZANTE ---------- */}
      {view !== 'home' && (
        <div className="admin-sheet-overlay" onClick={() => setView('home')}>
          <div className="admin-sheet" onClick={e => e.stopPropagation()}>
            <div className="admin-sheet-header">
              <button className="admin-sheet-back" onClick={() => setView('home')}>← Volver al inicio</button>
              <h2>{sheetTitles[view]}</h2>
            </div>

            <div className="admin-sheet-body">
              {view === 'plantas' && (
                <>
                  <h3>Plantas existentes ({plants.length})</h3>

                  <select className="gallery-select" value={plantsFilter} onChange={e => setPlantsFilter(e.target.value)}>
                    <option value="all">Todas las categorías</option>
                    {categories.map(c => <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>)}
                  </select>

                  <input
                    className="order-search"
                    placeholder="Buscar planta por nombre..."
                    value={plantsSearch}
                    onChange={e => setPlantsSearch(e.target.value)}
                  />

                  {loading ? <p>Cargando...</p> : (() => {
                    const filteredPlants = plants
                      .filter(p => plantsFilter === 'all' || p.category_id === plantsFilter)
                      .filter(p => p.name.toLowerCase().includes(plantsSearch.trim().toLowerCase()))
                    return (
                    <div className="admin-list">
                      {filteredPlants.length === 0 && <p className="status-msg">No se encontraron plantas.</p>}
                      {filteredPlants.map(p => (
                        <div key={p.id} className={`admin-item ${!p.active ? 'inactive' : ''}`}>
                          {p.image_url ? <img src={p.image_url} alt={p.name} /> : <div className="no-img-sm">Sin foto</div>}
                          <div className="admin-item-info">
                            <strong>{p.name}</strong>
                            <span>{categories.find(c => c.id === p.category_id)?.name || 'Sin categoría'}</span>
                            <div className="admin-item-controls">
                              <label>$<input type="number" step="0.01" defaultValue={p.price} onBlur={e => updatePrice(p.id, Number(e.target.value))} /></label>
                              <label>Stock: <input type="number" defaultValue={p.stock} onBlur={e => updateStock(p.id, Number(e.target.value))} /></label>
                            </div>
                            <div className="admin-item-actions">
                              <button onClick={() => toggleActive(p.id, p.active)}>{p.active ? 'Ocultar' : 'Mostrar'}</button>
                              <button onClick={() => deletePlant(p.id)} className="danger">Borrar</button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                    )
                  })()}
                </>
              )}

              {view === 'categorias' && (
                <>
                  <div className="admin-subtabs">
                    <button className={catSubTab === 'categories' ? 'active' : ''} onClick={() => setCatSubTab('categories')}>Categorías</button>
                    <button className={catSubTab === 'gallery' ? 'active' : ''} onClick={() => setCatSubTab('gallery')}>Galería</button>
                  </div>

                  {catSubTab === 'categories' && (
                    <>
                      <form className="admin-form" onSubmit={addCategory}>
                        <h3>Agregar categoría nueva</h3>
                        <input placeholder="Nombre de la categoría" value={newCatName} onChange={e => setNewCatName(e.target.value)} />
                        <input placeholder="Emoji (ej: 🌷)" value={newCatEmoji} onChange={e => setNewCatEmoji(e.target.value)} />
                        <button type="submit">Agregar categoría</button>
                      </form>
                      <div className="admin-list">
                        {categories.map(c => (
                          <div key={c.id} className="admin-item">
                            {c.image_url ? <img src={c.image_url} alt={c.name} /> : <div className="no-img-sm">{c.emoji}</div>}
                            <div className="admin-item-info">
                              <input defaultValue={c.name} onBlur={e => updateCategoryName(c.id, e.target.value)} style={{ fontWeight: 'bold', fontSize: '1rem', width: '100%', boxSizing: 'border-box' }} />
                              <label>Emoji: <input defaultValue={c.emoji} onBlur={e => updateCategoryEmoji(c.id, e.target.value)} style={{ width: 50 }} /></label>
                              <input type="file" accept="image/*" onChange={e => uploadCategoryImage(c.id, e.target.files[0])} />
                            </div>
                          </div>
                        ))}
                      </div>
                    </>
                  )}

                  {catSubTab === 'gallery' && (
                    <>
                      <select className="gallery-select" value={galleryFilter} onChange={e => setGalleryFilter(e.target.value)}>
                        <option value="all">Todas las categorías</option>
                        {categories.map(c => (
                          <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>
                        ))}
                      </select>

                      {(() => {
                        const galleryPlants = plants.filter(p => galleryFilter === 'all' || p.category_id === galleryFilter)
                        return (
                          <>
                            <div className="label-select-bar">
                              <button type="button" onClick={() => selectAllLabels(galleryPlants)}>Seleccionar todas</button>
                              <button type="button" onClick={clearLabels}>Deseleccionar todas</button>
                              {selectedLabels.size > 0 && (
                                <button type="button" className="print-btn" onClick={printLabels}>
                                  🏷️ Imprimir etiquetas ({selectedLabels.size})
                                </button>
                              )}
                            </div>
                            <div className="gallery-grid">
                              {galleryPlants.map(p => (
                                <div key={p.id} className="gallery-item">
                                  <label className="gallery-checkbox">
                                    <input
                                      type="checkbox"
                                      checked={selectedLabels.has(p.id)}
                                      onChange={() => toggleLabelSelect(p.id)}
                                    />
                                  </label>
                                  {p.image_url ? <img src={p.image_url} alt={p.name} /> : <div className="no-img-sm">Sin foto</div>}
                                  <span>{p.name}</span>
                                </div>
                              ))}
                            </div>
                          </>
                        )
                      })()}
                    </>
                  )}
                </>
              )}

              {view === 'pedidos' && (
                <>
                  <form className="admin-form" onSubmit={addDecremento}>
                    <h3>Registrar decremento manual</h3>
                    <select value={decForm.plant_id} onChange={e => setDecForm({ ...decForm, plant_id: e.target.value })}>
                      <option value="">Selecciona planta</option>
                      {plants.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                    <input placeholder="Cantidad" type="number" value={decForm.quantity} onChange={e => setDecForm({ ...decForm, quantity: e.target.value })} />
                    <select value={decForm.motivo} onChange={e => setDecForm({ ...decForm, motivo: e.target.value })}>
                      <option value="">Selecciona motivo</option>
                      <option value="Dañada / Muerta">Dañada / Muerta</option>
                      <option value="Uso propio">Uso propio</option>
                      <option value="Regalo">Regalo</option>
                      <option value="Otro">Otro</option>
                    </select>
                    {decForm.motivo === 'Otro' && (
                      <input placeholder="Describe el motivo" value={decForm.motivo_otro} onChange={e => setDecForm({ ...decForm, motivo_otro: e.target.value })} />
                    )}
                    <button type="submit" disabled={savingDec}>{savingDec ? 'Guardando...' : 'Registrar decremento'}</button>
                  </form>

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
                    </select>
                  </div>

                  <div className="admin-list">
                    {movimientosFiltrados.length === 0 && <p className="status-msg">No se encontraron movimientos.</p>}
                    {movimientosFiltrados.map(m => (
                      m._type === 'venta' ? (
                        <div key={`o-${m.id}`} className="admin-item">
                          <div className="admin-item-info">
                            <strong>🛒 {m.customer_name}</strong>
                            <span>{m.customer_phone}</span>
                            <span className={`order-badge order-${m.status}`}>{m.status}</span>
                            <span>Pedido: {new Date(m.created_at).toLocaleDateString()}</span>
                            {m.fecha_pago && <span>Pagado: {new Date(m.fecha_pago).toLocaleDateString()}</span>}
                            {m.fecha_entrega && <span>Entregado: {new Date(m.fecha_entrega).toLocaleDateString()}</span>}
                            {(m.order_items || []).map(it => {
                              const plant = plants.find(p => p.id === it.plant_id)
                              return <span key={it.id}>{plant ? plant.name : 'Planta'} x{it.quantity}</span>
                            })}
                            <span>Total: ${Number(m.total).toFixed(2)}</span>
                            <div className="admin-item-actions">
                              {m.status === 'pedido' && (
                                <button onClick={() => markAsPaid(m)} disabled={approvingIds.includes(m.id)}>
                                  {approvingIds.includes(m.id) ? 'Procesando...' : 'Marcar como pagado'}
                                </button>
                              )}
                              {m.status === 'pagado' && (
                                <button onClick={() => markAsDelivered(m)} disabled={approvingIds.includes(m.id)}>
                                  {approvingIds.includes(m.id) ? 'Procesando...' : 'Marcar como entregado'}
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div key={`d-${m.id}`} className="admin-item">
                          <div className="admin-item-info">
                            <strong>{m.motivo === 'Regalo' ? '🎁' : '🗑️'} {m.plant_name}</strong>
                            <span>{m.motivo === 'Otro' ? m.motivo_otro : m.motivo}</span>
                            <span>Registrado: {new Date(m.created_at).toLocaleDateString()}</span>
                            <span>Cantidad: -{m.quantity}</span>
                          </div>
                        </div>
                      )
                    ))}
                  </div>
                </>
              )}

              {view === 'ingresos' && (
                <>
                  <form className="admin-form" onSubmit={addCompra}>
                    <h3>Registrar ingreso (compra o stock inicial)</h3>
                    <select value={compraForm.plant_id} onChange={e => setCompraForm({ ...compraForm, plant_id: e.target.value, new_plant_name: '', new_plant_category: '' })}>
                      <option value="">Selecciona planta existente</option>
                      {plants.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                    <p style={{ margin: '4px 0', fontSize: '0.8rem', color: '#6b6b5f' }}>— o registra una planta nueva —</p>
                    <input placeholder="Nombre de planta nueva" value={compraForm.new_plant_name || ''} onChange={e => setCompraForm({ ...compraForm, plant_id: '', new_plant_name: e.target.value })} />
                    <select value={compraForm.new_plant_category || ''} onChange={e => setCompraForm({ ...compraForm, new_plant_category: e.target.value })}>
                      <option value="">Selecciona categoría (crea la categoría primero en Catálogo si no existe)</option>
                      {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                    <input placeholder="Procedencia / Proveedor" value={compraForm.proveedor} onChange={e => setCompraForm({ ...compraForm, proveedor: e.target.value })} />
                    <input placeholder="Cantidad" type="number" value={compraForm.quantity} onChange={e => setCompraForm({ ...compraForm, quantity: e.target.value })} />
                    <input placeholder="Precio de compra (por unidad)" type="number" step="0.01" value={compraForm.unit_cost} onChange={e => setCompraForm({ ...compraForm, unit_cost: e.target.value })} />
                    <input placeholder="Precio de venta (opcional)" type="number" step="0.01" value={compraForm.sale_price} onChange={e => setCompraForm({ ...compraForm, sale_price: e.target.value })} />
                    <input type="file" accept="image/*" onChange={e => setCompraForm({ ...compraForm, file: e.target.files[0] })} />
                    <button type="submit" disabled={savingCompra}>{savingCompra ? 'Guardando...' : 'Registrar ingreso'}</button>
                  </form>

                  <div className="admin-list">
                    {compras.length === 0 && <p className="status-msg">No hay ingresos registrados.</p>}
                    {compras.map(c => (
                      <div key={c.id} className="admin-item">
                        {c.image_url ? <img src={c.image_url} alt={c.plant_name} /> : <div className="no-img-sm">Sin foto</div>}
                        <div className="admin-item-info">
                          <strong>{c.plant_name}</strong>
                          <span>Procedencia: {c.proveedor || 'Sin especificar'}</span>
                          <span className={`order-badge order-${c.status}`}>{c.status}</span>
                          <span>Pedido: {new Date(c.created_at).toLocaleDateString()}</span>
                          {c.fecha_pago && <span>Pagado: {new Date(c.fecha_pago).toLocaleDateString()}</span>}
                          {c.fecha_recibido && <span>Recibido: {new Date(c.fecha_recibido).toLocaleDateString()}</span>}
                          <span>Cantidad: {c.quantity}</span>
                          <span>Total compra: ${Number(c.total).toFixed(2)}</span>
                          <div className="admin-item-actions">
                            {c.status === 'pedido' && (
                              <button onClick={() => markCompraPagada(c)} disabled={approvingIds.includes(c.id)}>
                                {approvingIds.includes(c.id) ? 'Procesando...' : 'Marcar como pagado'}
                              </button>
                            )}
                            {c.status === 'pagado' && (
                              <button onClick={() => markCompraRecibida(c)} disabled={approvingIds.includes(c.id)}>
                                {approvingIds.includes(c.id) ? 'Procesando...' : 'Marcar como recibido'}
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {view === 'notas' && (
                <>
                  <form className="admin-form" onSubmit={addNote}>
                    <h3>Agregar nota</h3>
                    <select value={noteForm.category_id} onChange={e => setNoteForm({ ...noteForm, category_id: e.target.value })}>
                      <option value="">Selecciona categoría</option>
                      {categories.map(c => <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>)}
                    </select>
                    <textarea
                      placeholder="Escribe tu nota..."
                      rows={3}
                      value={noteForm.text}
                      onChange={e => setNoteForm({ ...noteForm, text: e.target.value })}
                    />
                    <label className="file-label">
                      📷 Agregar fotos
                      <input
                        type="file"
                        accept="image/*"
                        multiple
                        style={{ display: 'none' }}
                        onChange={e => setNoteForm({ ...noteForm, photos: Array.from(e.target.files) })}
                      />
                    </label>
                    {noteForm.photos.length > 0 && <span className="note-file-count">{noteForm.photos.length} foto(s) seleccionadas</span>}
                    <label className="file-label">
                      🎥 Agregar video
                      <input
                        type="file"
                        accept="video/*"
                        style={{ display: 'none' }}
                        onChange={e => setNoteForm({ ...noteForm, video: e.target.files[0] || null })}
                      />
                    </label>
                    {noteForm.video && <span className="note-file-count">Video: {noteForm.video.name}</span>}
                    <button type="submit" disabled={savingNote}>{savingNote ? 'Guardando...' : 'Guardar nota'}</button>
                  </form>

                  <select className="gallery-select" value={notesCategoryFilter} onChange={e => setNotesCategoryFilter(e.target.value)}>
                    <option value="all">Todas las categorías</option>
                    {categories.map(c => <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>)}
                  </select>

                  <input
                    className="order-search"
                    placeholder="Buscar en las notas..."
                    value={notesSearch}
                    onChange={e => setNotesSearch(e.target.value)}
                  />

                  {(() => {
                    const filteredNotes = notes
                      .filter(n => notesCategoryFilter === 'all' || n.category_id === notesCategoryFilter)
                      .filter(n => {
                        const term = notesSearch.trim().toLowerCase()
                        if (!term) return true
                        const cat = categories.find(c => c.id === n.category_id)
                        return (n.text || '').toLowerCase().includes(term) || (cat?.name || '').toLowerCase().includes(term)
                      })
                    return (
                      <>
                        <div className="label-select-bar">
                          <button type="button" onClick={() => selectAllNotes(filteredNotes)}>Seleccionar todas</button>
                          <button type="button" onClick={clearNoteSelection}>Deseleccionar todas</button>
                          {selectedNotes.size > 0 && (
                            <button type="button" className="print-btn" onClick={shareNotes} disabled={sharingNotes}>
                              {sharingNotes ? 'Preparando...' : `📲 Compartir seleccionadas (${selectedNotes.size})`}
                            </button>
                          )}
                        </div>

                        {filteredNotes.length === 0 && <p className="status-msg">Todavía no hay notas en esta categoría.</p>}
                        <div className="admin-list">
                          {filteredNotes.map(n => {
                            const cat = categories.find(c => c.id === n.category_id)
                            return (
                              <div key={n.id} className="admin-item note-item">
                                <label className="gallery-checkbox note-checkbox">
                                  <input type="checkbox" checked={selectedNotes.has(n.id)} onChange={() => toggleNoteSelect(n.id)} />
                                </label>
                                <div className="admin-item-info">
                                  <strong>{cat ? `${cat.emoji} ${cat.name}` : 'Sin categoría'}</strong>
                                  <span>{new Date(n.created_at).toLocaleDateString()}</span>
                                  {n.text && <p className="note-text">{n.text}</p>}
                                  {n.photo_urls && n.photo_urls.length > 0 && (
                                    <div className="note-photos">
                                      {n.photo_urls.map((url, i) => <img key={i} src={url} alt="" />)}
                                    </div>
                                  )}
                                  {n.video_url && (
                                    <video src={n.video_url} controls className="note-video" />
                                  )}
                                  <div className="admin-item-actions">
                                    <button onClick={() => deleteNote(n.id)} className="danger">Borrar</button>
                                  </div>
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      </>
                    )
                  })()}
                </>
              )}

              {view === 'calendario' && (
                <>
                  <div className="garden-tags-section">
                    <h3>Etiquetas de tareas</h3>
                    <div className="garden-tags-list">
                      {gardenTags.map(tag => (
                        <div key={tag.id} className="garden-tag-chip">
                          <input
                            type="color"
                            className="tag-color-input"
                            value={tag.color}
                            onChange={e => updateTagColor(tag.id, e.target.value)}
                          />
                          <input
                            className="tag-name-input"
                            defaultValue={tag.name}
                            onBlur={e => updateTagName(tag.id, e.target.value)}
                          />
                          <button type="button" className="tag-delete-btn" onClick={() => deleteTag(tag.id)}>✕</button>
                        </div>
                      ))}
                    </div>
                    <form className="admin-form garden-tag-form" onSubmit={addTag}>
                      <input
                        placeholder="Nueva etiqueta (ej: Riego delantero)"
                        value={newTagForm.name}
                        onChange={e => setNewTagForm({ ...newTagForm, name: e.target.value })}
                      />
                      <input
                        type="color"
                        value={newTagForm.color}
                        onChange={e => setNewTagForm({ ...newTagForm, color: e.target.value })}
                      />
                      <button type="submit">Agregar etiqueta</button>
                    </form>
                  </div>

                  <div className="calendar-header">
                    <button type="button" onClick={() => changeMonth(-1)}>←</button>
                    <h3>{calMonthLabel}</h3>
                    <button type="button" onClick={() => changeMonth(1)}>→</button>
                  </div>

                  <div className="calendar-grid">
                    {['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'].map(d => (
                      <div key={d} className="calendar-weekday">{d}</div>
                    ))}
                    {calCells.map((cell, i) => {
                      if (!cell) return <div key={`empty-${i}`} className="calendar-day outside" />
                      const dateStr = formatDateStr(cell)
                      const dayTasks = tasksByDay[dateStr] || []
                      return (
                        <div
                          key={dateStr}
                          className={`calendar-day ${dateStr === todayStr ? 'today' : ''} ${selectedDay === dateStr ? 'selected' : ''}`}
                          onClick={() => setSelectedDay(dateStr)}
                        >
                          <span className="calendar-day-num">{cell.getDate()}</span>
                          <div className="calendar-day-tasks">
                            {dayTasks.slice(0, 3).map(t => {
                              const tag = gardenTags.find(g => g.id === t.tag_id)
                              return (
                                <span
                                  key={t.id}
                                  className={`calendar-task-label ${dateStr < todayStr ? 'done' : ''}`}
                                  style={{ background: tag?.color || '#a1665e' }}
                                  title={tag?.name}
                                >
                                  {tag?.name || '•'}
                                </span>
                              )
                            })}
                            {dayTasks.length > 3 && (
                              <span className="calendar-task-more">+{dayTasks.length - 3}</span>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>

                  {selectedDay && (
                    <div className="day-panel">
                      <h4>{new Date(selectedDay + 'T00:00:00').toLocaleDateString('es-EC', { weekday: 'long', day: 'numeric', month: 'long' })}</h4>

                      {gardenTags.length === 0 ? (
                        <p className="status-msg">Agrega una etiqueta arriba para poder añadir tareas.</p>
                      ) : (
                        <div className="day-tag-buttons">
                          {gardenTags.map(tag => (
                            <button
                              key={tag.id}
                              type="button"
                              className="day-tag-btn"
                              style={{ borderColor: tag.color, color: tag.color }}
                              onClick={() => quickAddTask(tag.id)}
                            >
                              + {tag.name}
                            </button>
                          ))}
                        </div>
                      )}

                      <button
                        type="button"
                        className="full-form-btn"
                        onClick={() => { setTaskForm({ tag_id: '', date: selectedDay, note: '', repeat: 'none' }); setTaskFormOpen(true) }}
                      >
                        📋 Tarea con nota o repetición
                      </button>

                      <div className="day-task-list">
                        {(tasksByDay[selectedDay] || []).length === 0 && (
                          <p className="status-msg">No hay tareas este día.</p>
                        )}
                        {(tasksByDay[selectedDay] || []).map(t => {
                          const tag = gardenTags.find(g => g.id === t.tag_id)
                          const isPast = selectedDay < todayStr
                          return (
                            <div key={t.id} className={`day-task-item ${isPast ? 'done' : ''}`}>
                              <span className="task-tag-dot" style={{ background: tag?.color || '#a1665e' }} />
                              <span className="task-tag-name">{tag?.name || 'Etiqueta borrada'}</span>
                              {t.note && <span className="task-note">— {t.note}</span>}
                              <button type="button" className="task-delete-btn" onClick={() => deleteTask(t.id)}>✕</button>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}

                  {taskFormOpen && (
                    <div className="admin-sheet-overlay" onClick={() => setTaskFormOpen(false)}>
                      <div className="task-form-modal" onClick={e => e.stopPropagation()}>
                        <form className="admin-form" onSubmit={addTaskFull}>
                          <h3>Nueva tarea</h3>
                          <select value={taskForm.tag_id} onChange={e => setTaskForm({ ...taskForm, tag_id: e.target.value })}>
                            <option value="">Selecciona etiqueta</option>
                            {gardenTags.map(tag => <option key={tag.id} value={tag.id}>{tag.name}</option>)}
                          </select>
                          <input
                            type="date"
                            value={taskForm.date}
                            onChange={e => setTaskForm({ ...taskForm, date: e.target.value })}
                          />
                          <input
                            placeholder="Nota (opcional)"
                            value={taskForm.note}
                            onChange={e => setTaskForm({ ...taskForm, note: e.target.value })}
                          />
                          <select value={taskForm.repeat} onChange={e => setTaskForm({ ...taskForm, repeat: e.target.value })}>
                            <option value="none">No se repite</option>
                            <option value="weekly">Cada semana</option>
                            <option value="biweekly">Cada 2 semanas</option>
                            <option value="monthly">Cada mes</option>
                          </select>
                          <button type="submit">Guardar tarea</button>
                          <button type="button" onClick={() => setTaskFormOpen(false)}>Cancelar</button>
                        </form>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ---------- HOJA IMPRIMIBLE DE ETIQUETAS (solo visible al imprimir) ---------- */}
      <div className="print-labels-sheet">
        <div className="label-grid">
          {plants.filter(p => selectedLabels.has(p.id)).map(p => (
            <div key={p.id} className="label-card">
              <span className="label-name">{p.name}</span>
              {p.image_url
                ? <img src={p.image_url} alt={p.name} className="label-photo" />
                : <div className="label-photo label-no-img">Sin foto</div>}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
