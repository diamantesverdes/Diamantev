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

  const [gardenTags, setGardenTags] = useState([])
  const [gardenTasks, setGardenTasks] = useState([])
  const [calendarMonth, setCalendarMonth] = useState(() => { const d = new Date(); d.setDate(1); return d })
  const [selectedDay, setSelectedDay] = useState(null)
  const [newTagForm, setNewTagForm] = useState({ name: '', color: '#a1665e' })
  const [taskFormOpen, setTaskFormOpen] = useState(false)
  const [taskSearch, setTaskSearch] = useState('')
  const [taskSearchSubmitted, setTaskSearchSubmitted] = useState('')
  const [freeNoteModalOpen, setFreeNoteModalOpen] = useState(false)
  const [editingTaskId, setEditingTaskId] = useState(null)
  const [tagMenuOpen, setTagMenuOpen] = useState(false)
  const [freeNoteBlocks, setFreeNoteBlocks] = useState([])
  const [freeNoteCurrentText, setFreeNoteCurrentText] = useState('')
  const [savingFreeNote, setSavingFreeNote] = useState(false)
  const [taskForm, setTaskForm] = useState({ tag_id: '', date: '', note: '', repeat: 'none' })
  const [sharingNotes, setSharingNotes] = useState(false)

  const [orders, setOrders] = useState([])
  const [approvingIds, setApprovingIds] = useState([])

  const [compras, setCompras] = useState([])
  const [lotes, setLotes] = useState([])
  const [loteBuilderOpen, setLoteBuilderOpen] = useState(false)
  const [loteNota, setLoteNota] = useState('')
  const [loteProveedor, setLoteProveedor] = useState('')
  const [loteLines, setLoteLines] = useState([])
  const [lineForm, setLineForm] = useState({ plant_id: '', new_plant_name: '', new_plant_category: '', quantity: '', unit_cost: '', sale_price: '', file: null })
  const [savingLote, setSavingLote] = useState(false)

  const [decrementos, setDecrementos] = useState([])
  const [decForm, setDecForm] = useState({ plant_id: '', quantity: '', motivo: '', motivo_otro: '' })
  const [savingDec, setSavingDec] = useState(false)

  const [movSearch, setMovSearch] = useState('')
  const [movStatusFilter, setMovStatusFilter] = useState('all')
  const [movTypeFilter, setMovTypeFilter] = useState('all')

  const [plants, setPlants] = useState([])
  const [categories, setCategories] = useState([])
  const [loading, setLoading] = useState(true)

  const [plantNotes, setPlantNotes] = useState([])
  const [plantNoteModalOpen, setPlantNoteModalOpen] = useState(false)
  const [currentNotePlantId, setCurrentNotePlantId] = useState(null)
  const [editingPlantNoteId, setEditingPlantNoteId] = useState(null)
  const [plantNoteBlocks, setPlantNoteBlocks] = useState([])
  const [plantNoteCurrentText, setPlantNoteCurrentText] = useState('')
  const [savingPlantNote, setSavingPlantNote] = useState(false)
  const [openPlantNotesListId, setOpenPlantNotesListId] = useState(null)

  const [newCatName, setNewCatName] = useState('')
  const [newCatEmoji, setNewCatEmoji] = useState('🌿')

  useEffect(() => { if (authed) loadData() }, [authed])

  async function loadData() {
    setLoading(true)
    const { data: cats } = await supabase.from('categories').select('*').order('name')
    const { data: pls } = await supabase.from('plants').select('*').order('name')
    const { data: ords } = await supabase.from('orders').select('*, order_items(*)').order('id', { ascending: false })
    const { data: comps } = await supabase.from('compras').select('*').order('created_at', { ascending: false })
    const { data: lts } = await supabase.from('compra_lotes').select('*').order('numero', { ascending: false })
    const { data: decs } = await supabase.from('decrementos').select('*').order('created_at', { ascending: false })
    const { data: pnts } = await supabase.from('plant_notes').select('*').order('created_at', { ascending: false })
    const { data: tags } = await supabase.from('garden_tags').select('*').order('created_at')
    const { data: tasks } = await supabase.from('garden_tasks').select('*').order('date')
    setCategories(cats || [])
    setPlants(pls || [])
    setOrders(ords || [])
    setCompras(comps || [])
    setLotes(lts || [])
    setDecrementos(decs || [])
    setPlantNotes(pnts || [])
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

  // ---------- Ingresos (compras agrupadas en lotes) ----------
  function addLineToLote(e) {
    e.preventDefault()
    const usingNew = !lineForm.plant_id && lineForm.new_plant_name
    if ((!lineForm.plant_id && !usingNew) || !lineForm.quantity || !lineForm.unit_cost) {
      alert('Selecciona una planta o escribe el nombre de una nueva, y completa cantidad y costo')
      return
    }
    if (usingNew && !lineForm.new_plant_category) {
      alert('Selecciona una categoría para la planta nueva')
      return
    }
    const plant = lineForm.plant_id ? plants.find(p => p.id === lineForm.plant_id) : null
    setLoteLines(prev => [...prev, { ...lineForm, plant_name: usingNew ? lineForm.new_plant_name : (plant ? plant.name : '') }])
    setLineForm({ plant_id: '', new_plant_name: '', new_plant_category: '', quantity: '', unit_cost: '', sale_price: '', file: null })
  }

  function removeLoteLine(index) {
    setLoteLines(prev => prev.filter((_, i) => i !== index))
  }

  async function saveLote() {
    if (loteLines.length === 0) { alert('Agrega al menos una planta a la compra'); return }
    setSavingLote(true)
    const { data: lote, error: loteError } = await supabase
      .from('compra_lotes').insert({ nota: loteNota, proveedor: loteProveedor }).select().single()
    if (loteError) { alert('Error al crear la compra: ' + loteError.message); setSavingLote(false); return }

    for (const line of loteLines) {
      const usingNew = !line.plant_id && line.new_plant_name
      const quantity = Number(line.quantity)
      const unit_cost = Number(line.unit_cost)
      const sale_price = line.sale_price ? Number(line.sale_price) : null
      let image_url = null
      if (line.file) image_url = await uploadImage(line.file)

      const row = usingNew
        ? { plant_id: null, plant_name: line.plant_name, new_plant_category: line.new_plant_category, quantity, unit_cost, sale_price, image_url, total: quantity * unit_cost, proveedor: loteProveedor, status: 'pedido', lote_id: lote.id }
        : { plant_id: line.plant_id, plant_name: line.plant_name, quantity, unit_cost, sale_price, image_url, total: quantity * unit_cost, proveedor: loteProveedor, status: 'pedido', lote_id: lote.id }

      const { error } = await supabase.from('compras').insert(row)
      if (error) alert('Error al guardar una de las plantas: ' + error.message)
    }
    setLoteNota('')
    setLoteProveedor('')
    setLoteLines([])
    setLoteBuilderOpen(false)
    setSavingLote(false)
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
        const updates = { stock: plant.stock + compra.quantity }
        if (compra.image_url) updates.image_url = compra.image_url
        await supabase.from('plants').update(updates).eq('id', plant.id)
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

  async function updatePlantImage(id, file) {
    if (!file) return
    const url = await uploadImage(file)
    if (url) {
      await supabase.from('plants').update({ image_url: url }).eq('id', id)
      loadData()
    }
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

  // ---------- Notas libres por planta ----------
  function openNewPlantNote(plantId) {
    setCurrentNotePlantId(plantId)
    setEditingPlantNoteId(null)
    setPlantNoteBlocks([])
    setPlantNoteCurrentText('')
    setPlantNoteModalOpen(true)
  }

  function openEditPlantNote(note) {
    setCurrentNotePlantId(note.plant_id)
    setEditingPlantNoteId(note.id)
    setPlantNoteBlocks(note.content_blocks || [])
    setPlantNoteCurrentText('')
    setPlantNoteModalOpen(true)
  }

  function insertPhotoBlockToPlantNote(file) {
    if (!file) return
    setPlantNoteBlocks(prev => {
      const next = [...prev]
      if (plantNoteCurrentText.trim()) next.push({ type: 'text', content: plantNoteCurrentText })
      next.push({ type: 'photo', file })
      return next
    })
    setPlantNoteCurrentText('')
  }

  function insertVideoBlockToPlantNote(file) {
    if (!file) return
    setPlantNoteBlocks(prev => {
      const next = [...prev]
      if (plantNoteCurrentText.trim()) next.push({ type: 'text', content: plantNoteCurrentText })
      next.push({ type: 'video', file })
      return next
    })
    setPlantNoteCurrentText('')
  }

  function removeLastPlantNoteBlock() {
    setPlantNoteBlocks(prev => prev.slice(0, -1))
  }

  async function savePlantNote() {
    if (!currentNotePlantId) return
    const blocks = [...plantNoteBlocks]
    if (plantNoteCurrentText.trim()) blocks.push({ type: 'text', content: plantNoteCurrentText })
    if (blocks.length === 0) return
    setSavingPlantNote(true)
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

  async function shareCalendarNote(t) {
    setSharingNotes(true)
    try {
      const header = `🌿 Calendario (${new Date(t.date + 'T00:00:00').toLocaleDateString()})`
      const textBlocks = (t.content_blocks || []).filter(b => b.type === 'text').map(b => b.content).join('\n')
      const shareText = textBlocks ? `${header}:\n${textBlocks}` : header
      const fileUrls = (t.content_blocks || []).filter(b => (b.type === 'photo' || b.type === 'video') && b.url).map(b => b.url)
      const files = (await Promise.all(fileUrls.map(urlToFile))).filter(Boolean)

      if (navigator.share && files.length > 0 && navigator.canShare && navigator.canShare({ files })) {
        await navigator.share({ title: 'Nota del calendario Diamantev', text: shareText, files })
      } else if (navigator.share) {
        await navigator.share({ title: 'Nota del calendario Diamantev', text: shareText })
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
    i
