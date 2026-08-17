import { useState, useEffect } from 'react'
import { supabase, supabaseStorage } from './supabaseClient'
import { addToQueue, isOnline, queueLength, processQueue } from './offlineQueue'

export default function Admin() {
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

  // 'home' | 'plantas' | 'categorias' | 'pedidos' | 'ingresos'
  const [view, setView] = useState('home')
  const [catSubTab, setCatSubTab] = useState('categories')

  const [galleryFilter, setGalleryFilter] = useState('all')
  const [gallerySearch, setGallerySearch] = useState('')
  const [categoriesSearch, setCategoriesSearch] = useState('')
  const [plantsFilter, setPlantsFilter] = useState('all')
  const [plantsSearch, setPlantsSearch] = useState('')
  const [selectedLabels, setSelectedLabels] = useState(new Set())
  const [photoModalPlantId, setPhotoModalPlantId] = useState(null)
  const [openActionMenuId, setOpenActionMenuId] = useState(null)

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
  const [addToLoteId, setAddToLoteId] = useState(null)
  const [addToLoteForm, setAddToLoteForm] = useState({ plant_id: '', new_plant_name: '', new_plant_category: '', quantity: '', unit_cost: '', sale_price: '', file: null })
  const [savingAddToLote, setSavingAddToLote] = useState(false)

  const [decrementos, setDecrementos] = useState([])
  const [decForm, setDecForm] = useState({ plant_id: '', quantity: '', motivo: '', motivo_otro: '' })
  const [savingDec, setSavingDec] = useState(false)

  const [movSearch, setMovSearch] = useState('')
  const [movStatusFilter, setMovStatusFilter] = useState('all')
  const [movTypeFilter, setMovTypeFilter] = useState('all')

  const [ingresosSearch, setIngresosSearch] = useState('')
  const [ingresosDate, setIngresosDate] = useState('')
  const [ingresosCategoria, setIngresosCategoria] = useState('all')
  const [ingresosStatus, setIngresosStatus] = useState('all')

  const [plants, setPlants] = useState([])
  const [categories, setCategories] = useState([])
  const [loading, setLoading] = useState(true)

  const [plantNotes, setPlantNotes] = useState([])
  const [loteNoteModalOpen, setLoteNoteModalOpen] = useState(false)
  const [currentNoteLoteId, setCurrentNoteLoteId] = useState(null)
  const [loteNoteBlocks, setLoteNoteBlocks] = useState([])
  const [loteNoteCurrentText, setLoteNoteCurrentText] = useState('')
  const [savingLoteNote, setSavingLoteNote] = useState(false)
  const [plantNoteModalOpen, setPlantNoteModalOpen] = useState(false)
  const [currentNotePlantId, setCurrentNotePlantId] = useState(null)
  const [editingPlantNoteId, setEditingPlantNoteId] = useState(null)
  const [plantNoteBlocks, setPlantNoteBlocks] = useState([])
  const [plantNoteCurrentText, setPlantNoteCurrentText] = useState('')
  const [savingPlantNote, setSavingPlantNote] = useState(false)
  const [openPlantNotesListId, setOpenPlantNotesListId] = useState(null)

  const [newCatName, setNewCatName] = useState('')
  const [newCatEmoji, setNewCatEmoji] = useState('🌿')
  const [pendingCount, setPendingCount] = useState(0)
  const [syncing, setSyncing] = useState(false)

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

  useEffect(() => { if (authed) loadData() }, [authed])

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
        for (const line of payload.lines) {
          const usingNew = !line.plant_id && line.new_plant_name
          const quantity = Number(line.quantity)
          const unit_cost = Number(line.unit_cost)
          const sale_price = line.sale_price ? Number(line.sale_price) : null
          let image_url = null
          if (line.file) image_url = await uploadImage(line.file)
          const row = usingNew
            ? { plant_id: null, plant_name: line.plant_name, new_plant_category: line.new_plant_category, quantity, unit_cost, sale_price, image_url, total: quantity * unit_cost, proveedor: payload.proveedor, status: 'pedido', lote_id: lote.id }
            : { plant_id: line.plant_id, plant_name: line.plant_name, quantity, unit_cost, sale_price, image_url, total: quantity * unit_cost, proveedor: payload.proveedor, status: 'pedido', lote_id: lote.id }
          const { error } = await supabase.from('compras').insert(row)
          if (error) throw error
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
        const { error } = await supabase.from('compras').insert(row)
        if (error) throw error
        if (payload.status === 'recibido') {
          if (!usingNew && payload.plant_id) {
            const { data: current } = await supabase.from('plants').select('stock').eq('id', payload.plant_id).single()
            if (current) {
              const updates = { stock: current.stock + payload.quantity }
              if (image_url) updates.image_url = image_url
              await supabase.from('plants').update(updates).eq('id', payload.plant_id)
            }
          } else if (usingNew) {
            await supabase.from('plants').insert({
              name: payload.new_plant_name,
              category_id: payload.new_plant_category,
              price: payload.sale_price || 0,
              stock: payload.quantity,
              image_url: image_url || null,
            })
          }
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
    setLoading(true)
    const { data: cats } = await supabase.from('categories').select('*').order('name')
    const { data: pls } = await supabase.from('plants').select('*').order('name')
    const { data: ords } = await supabase.from('orders').select('*, order_items(*)').order('id', { ascending: false })
    const { data: comps } = await supabase.from('compras').select('*').order('created_at', { ascending: false })
    const { data: lts } = await supabase.from('compra_lotes').select('*').order('numero', { ascending: false })
    const { data: decs } = await supabase.from('decrementos').select('*').order('created_at', { ascending: false })
    const { data: pnts } = await supabase.from('plant_notes').select('*').order('created_at', { ascending: false })
    setCategories(cats || [])
    setPlants(pls || [])
    setOrders(ords || [])
    setCompras(comps || [])
    setLotes(lts || [])
    setDecrementos(decs || [])
    setPlantNotes(pnts || [])
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
    if (error) { alert('Error al subir el archivo'); return null }
    const { data } = supabaseStorage.storage.from(bucket).getPublicUrl(fileName)
    return data.publicUrl
  }

  // ---------- Ingresos (compras agrupadas en lotes) ----------
  function addLineToLote(e) {
    e.preventDefault()
    const usingNew = !lineForm.plant_id && lineForm.new_plant_name
    if ((!lineForm.plant_id && !usingNew) || !lineForm.quantity) {
      alert('Selecciona una planta o escribe el nombre de una nueva, y completa la cantidad')
      return
    }
    if (usingNew && !lineForm.new_plant_category) {
      alert('Selecciona una categoría para la planta nueva')
      return
    }
    if (usingNew) {
      const nameNormalized = lineForm.new_plant_name.trim().toLowerCase()
      const existing = plants.find(p => p.name.trim().toLowerCase() === nameNormalized)
      if (existing) {
        alert(`Ya existe una planta llamada "${existing.name}". Selecciónala de la lista "Selecciona planta existente" en vez de escribirla como nueva, para no duplicarla.`)
        return
      }
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

    const { error } = await supabase.from('compras').insert(row)
    if (error) { alert('Error al agregar la planta: ' + error.message); setSavingAddToLote(false); return }

    // Si la compra ya estaba recibida, actualiza el stock de inmediato
    if (status === 'recibido') {
      if (!usingNew && plant) {
        const updates = { stock: plant.stock + quantity }
        if (image_url) updates.image_url = image_url
        await supabase.from('plants').update(updates).eq('id', plant.id)
      } else if (usingNew) {
        await supabase.from('plants').insert({
          name: addToLoteForm.new_plant_name,
          category_id: addToLoteForm.new_plant_category,
          price: sale_price || 0,
          stock: quantity,
          image_url: image_url || null,
        })
      }
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
    for (const c of lineas) {
      await supabase.from('compras').update({ status: 'pagado', fecha_pago: new Date().toISOString() }).eq('id', c.id)
    }
    await loadData()
    setApprovingIds(prev => prev.filter(id => id !== loteId))
  }

  async function markLoteRecibido(loteId) {
    if (approvingIds.includes(loteId)) return
    const lineas = compras.filter(c => c.lote_id === loteId && c.status === 'pagado')
    if (lineas.length === 0) return
    setApprovingIds(prev => [...prev, loteId])
    for (const c of lineas) {
      await supabase.from('compras').update({ status: 'recibido', fecha_recibido: new Date().toISOString() }).eq('id', c.id)
      if (c.plant_id) {
        const plant = plants.find(p => p.id === c.plant_id)
        if (plant) {
          const updates = { stock: plant.stock + c.quantity }
          if (c.image_url) updates.image_url = c.image_url
          await supabase.from('plants').update(updates).eq('id', plant.id)
        }
      } else if (c.new_plant_category) {
        await supabase.from('plants').insert({
          name: c.plant_name,
          category_id: c.new_plant_category,
          price: c.sale_price || 0,
          stock: c.quantity,
          image_url: c.image_url || null,
        })
      }
    }
    await loadData()
    setApprovingIds(prev => prev.filter(id => id !== loteId))
  }

  async function deleteLote(loteId) {
    if (!confirm('¿Eliminar esta compra completa? Se borrarán todas las plantas registradas en ella. Esta acción no se puede deshacer.')) return
    const lineas = compras.filter(c => c.lote_id === loteId)
    for (const c of lineas) {
      if (c.status === 'recibido' && c.plant_id) {
        const { data: current } = await supabase.from('plants').select('stock').eq('id', c.plant_id).single()
        if (current) {
          await supabase.from('plants').update({ stock: Math.max(0, current.stock - c.quantity) }).eq('id', c.plant_id)
        }
      }
    }
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
    loadData()
  }

  async function updateLoteProveedor(lote, value) {
    const { error } = await supabase.from('compra_lotes').update({ proveedor: value }).eq('id', lote.id)
    if (error) { alert('Error al guardar el cambio: ' + error.message); return }
    // Actualiza también el proveedor de todas las líneas de esta compra, para mantenerlo consistente
    await supabase.from('compras').update({ proveedor: value }).eq('lote_id', lote.id)
    loadData()
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
    }
    const { error } = await supabase.from('compras').update(updates).eq('id', compra.id)
    if (error) { alert('Error al guardar el cambio: ' + error.message); return }
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
    const payload = {
      plant_id: decForm.plant_id,
      plant_name: plant ? plant.name : '',
      quantity,
      motivo: decForm.motivo,
      motivo_otro: decForm.motivo === 'Otro' ? decForm.motivo_otro : null,
    }

    if (!isOnline()) {
      await addToQueue('decremento', { decremento: payload, plantId: decForm.plant_id, quantity })
      if (plant) {
        setPlants(prev => prev.map(p => p.id === plant.id ? { ...p, stock: Math.max(0, p.stock - quantity) } : p))
      }
      setDecForm({ plant_id: '', quantity: '', motivo: '', motivo_otro: '' })
      setSavingDec(false)
      setPendingCount(await queueLength())
      alert('Sin conexión: la venta se guardó en el celular y se subirá sola cuando vuelva la señal.')
      return
    }

    await supabase.from('decrementos').insert(payload)
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

  async function copySharedLink() {
    const link = `${window.location.origin}/?shared=1`
    await navigator.clipboard.writeText(link)
    alert('Link copiado. Este link solo muestra las plantas marcadas para compartir. Pégalo en WhatsApp para enviarlo.')
  }

  async function markSelectedShared(idsSet, value) {
    const ids = Array.from(idsSet)
    if (ids.length === 0) return
    await supabase.from('plants').update({ shared_visible: value }).in('id', ids)
    loadData()
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

  async function shareSelectedPhotos(plantsList) {
    const selected = plantsList.filter(p => selectedLabels.has(p.id))
    if (selected.length === 0) return
    setSharingNotes(true)
    try {
      const names = selected.map(p => `- ${p.name}`).join('\n')
      const shareText = `🌿 Plantas Diamantev:\n${names}`
      const fileUrls = selected.filter(p => p.image_url).map(p => p.image_url)
      const files = (await Promise.all(fileUrls.map(urlToFile))).filter(Boolean)

      if (navigator.share && files.length > 0 && navigator.canShare && navigator.canShare({ files })) {
        await navigator.share({ title: 'Plantas Diamantev', text: shareText, files })
      } else if (navigator.share) {
        await navigator.share({ title: 'Plantas Diamantev', text: shareText })
      } else {
        window.open(`https://wa.me/?text=${encodeURIComponent(shareText)}`, '_blank')
      }
    } catch (err) {
      if (err.name !== 'AbortError') alert('No se pudo compartir. Intenta de nuevo.')
    }
    setSharingNotes(false)
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

  // Lista unificada de ventas + decrementos manuales, para "Ventas y Decrementos"
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

  const CLIENT_URL = 'https://diamantev.vercel.app'

  function shareClientLink() {
    const message = encodeURIComponent(`🌿 Visita nuestro catálogo de plantas Diamantev: ${CLIENT_URL}`)
    window.open(`https://wa.me/?text=${message}`, '_blank')
  }

  const cards = [
    { key: 'plantas', label: 'Plantas', icon: '🪴', count: plants.length },
    { key: 'categorias', label: 'Categorías, Galería y Etiquetas', icon: '🏷️', count: categories.length },
    { key: 'pedidos', label: 'Ventas y Decrementos', icon: '🧾', count: pedidosPendientes },
    { key: 'ingresos', label: 'Ingresos', icon: '📦', count: ingresosEnCurso },
  ]

  const sheetTitles = {
    plantas: '🪴 Plantas',
    categorias: '🏷️ Categorías, Galería y Etiquetas',
    pedidos: '🧾 Ventas y Decrementos',
    ingresos: '📦 Ingresos',
  }

  return (
    <div className="admin">
      <div className="admin-header">
        <h1>Panel de administrador — Diamantev</h1>
        <a href="/" target="_blank" rel="noreferrer" className="back-to-store">🌿 Ver tienda</a>
        <button onClick={handleLogout} className="back-to-store" style={{ background: 'transparent', border: '1px solid #b03434', color: '#b03434' }}>
          Cerrar sesión
        </button>
      </div>

      {pendingCount > 0 && (
        <p className={`offline-banner ${syncing ? 'offline-banner-syncing' : ''}`}>
          {syncing ? `Sincronizando ${pendingCount} cambio(s)...` : `${pendingCount} cambio(s) guardados sin conexión, pendientes de subir`}
        </p>
      )}

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
            <button className="admin-card admin-card-share" onClick={shareClientLink}>
              <span className="admin-card-icon">💬</span>
              <span className="admin-card-label">Compartir catálogo<br />por WhatsApp</span>
            </button>
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
                            <select
                              value={p.category_id || ''}
                              onChange={e => updatePlantCategory(p.id, e.target.value)}
                              style={{ maxWidth: 220 }}
                            >
                              <option value="">Sin categoría</option>
                              {categories.map(cat => (
                                <option key={cat.id} value={cat.id}>{cat.emoji} {cat.name}</option>
                              ))}
                            </select>
                            <div className="admin-item-controls">
                              <label>$<input type="number" step="0.01" defaultValue={p.price} onBlur={e => updatePrice(p.id, Number(e.target.value))} /></label>
                              <label>Stock: <input type="number" defaultValue={p.stock} onBlur={e => updateStock(p.id, Number(e.target.value))} /></label>
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
                      <input
                        className="order-search"
                        placeholder="Buscar categoría por nombre..."
                        value={categoriesSearch}
                        onChange={e => setCategoriesSearch(e.target.value)}
                      />
                      <div className="admin-list">
                        {categories
                          .filter(c => c.name.toLowerCase().includes(categoriesSearch.trim().toLowerCase()))
                          .map(c => (
                          <div key={c.id} className="admin-item">
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
                            </div>
                          </div>
                        ))}
                      </div>
                    </>
                  )}

                  {catSubTab === 'gallery' && (
                    <>
                      <button type="button" onClick={copySharedLink} style={{ marginBottom: 10 }}>
                        🔗 Copiar link de plantas compartidas
                      </button>

                      <select className="gallery-select" value={galleryFilter} onChange={e => setGalleryFilter(e.target.value)}>
                        <option value="all">Todas las categorías</option>
                        {categories.map(c => (
                          <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>
                        ))}
                      </select>
                      <input
                        className="order-search"
                        placeholder="Buscar planta por nombre..."
                        value={gallerySearch}
                        onChange={e => setGallerySearch(e.target.value)}
                      />

                      {(() => {
                        const galleryPlants = plants
                          .filter(p => galleryFilter === 'all' || p.category_id === galleryFilter)
                          .filter(p => p.name.toLowerCase().includes(gallerySearch.trim().toLowerCase()))
                        return (
                          <>
                            <div className="label-select-bar">
                              <button type="button" onClick={() => selectAllLabels(galleryPlants)}>Seleccionar todas</button>
                              <button type="button" onClick={clearLabels}>Deseleccionar todas</button>
                              {selectedLabels.size > 0 && (
                                <>
                                  <button type="button" className="print-btn" onClick={printLabels}>
                                    🏷️ Etiquetas ({selectedLabels.size})
                                  </button>
                                  <button type="button" className="print-btn" onClick={() => shareSelectedPhotos(galleryPlants)} disabled={sharingNotes}>
                                    {sharingNotes ? 'Preparando...' : `📲 WhatsApp (${selectedLabels.size})`}
                                  </button>
                                  <button type="button" className="print-btn" onClick={() => markSelectedShared(selectedLabels, true)}>
                                    📤 Marcar para compartir ({selectedLabels.size})
                                  </button>
                                  <button type="button" className="print-btn" onClick={() => markSelectedShared(selectedLabels, false)}>
                                    🚫 Quitar de compartidos ({selectedLabels.size})
                                  </button>
                                </>
                              )}
                            </div>
                            <div className="gallery-grid">
                              {galleryPlants.map(p => {
                                const notesForPlant = plantNotes.filter(n => n.plant_id === p.id)
                                const notesOpen = openPlantNotesListId === p.id
                                const menuOpen = openActionMenuId === p.id
                                return (
                                <div key={p.id} className="gallery-item" style={{ position: 'relative' }}>
                                  <label className="gallery-checkbox">
                                    <input
                                      type="checkbox"
                                      checked={selectedLabels.has(p.id)}
                                      onChange={() => toggleLabelSelect(p.id)}
                                    />
                                  </label>
                                  <button
                                    type="button"
                                    className="gallery-menu-btn"
                                    style={{ position: 'absolute', top: 4, right: 4, zIndex: 2, background: 'rgba(255,255,255,0.85)', border: '1px solid #ccc', borderRadius: 6 }}
                                    onClick={() => setOpenActionMenuId(menuOpen ? null : p.id)}
                                  >⋮</button>
                                  {p.shared_visible && <span title="Compartida" style={{ position: 'absolute', top: 4, left: 24, zIndex: 2 }}>📤</span>}
                                  <div onClick={() => setPhotoModalPlantId(p.id)} style={{ cursor: 'pointer' }}>
                                    {p.image_url ? <img src={p.image_url} alt={p.name} /> : <div className="no-img-sm">Sin foto</div>}
                                  </div>
                                  <span>{p.name}{!p.active ? ' (oculta)' : ''}</span>

                                  {menuOpen && (
                                    <div className="gallery-action-menu" style={{ position: 'absolute', top: 30, right: 4, zIndex: 3, background: '#fff', border: '1px solid #ccc', borderRadius: 8, boxShadow: '0 2px 8px rgba(0,0,0,0.15)', display: 'flex', flexDirection: 'column', minWidth: 170 }}>
                                      <button type="button" onClick={() => { toggleActive(p.id, p.active); setOpenActionMenuId(null) }}>{p.active ? 'Ocultar' : 'Mostrar'}</button>
                                      <button type="button" onClick={() => { toggleIsNew(p.id, p.is_new) }}>{p.is_new ? '🌱 Nueva ✓' : 'Marcar como nueva'}</button>
                                      <button type="button" onClick={() => { toggleOnSale(p.id, p.on_sale) }}>{p.on_sale ? '🏷️ En descuento ✓' : 'Marcar en descuento'}</button>
                                      <button type="button" onClick={() => { setOpenPlantNotesListId(notesOpen ? null : p.id); setOpenActionMenuId(null) }}>📝 Notas ({notesForPlant.length})</button>
                                    </div>
                                  )}

                                  {notesOpen && (
                                    <div className="plant-notes-panel">
                                      <button type="button" className="full-form-btn" onClick={() => openNewPlantNote(p.id)}>📝 Nueva nota</button>
                                      {notesForPlant.length === 0 && <p className="status-msg">Todavía no hay notas para esta planta.</p>}
                                      {notesForPlant.map(n => (
                                        <div key={n.id} className="note-blocks-view plant-note-entry">
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
                                </div>
                                )
                              })}
                            </div>
                          </>
                        )
                      })()}
                    </>
                  )}
                </>
              )}

              {photoModalPlantId && (() => {
                const p = plants.find(pl => pl.id === photoModalPlantId)
                if (!p) return null
                return (
                  <div className="admin-sheet-overlay" onClick={() => setPhotoModalPlantId(null)}>
                    <div className="free-note-modal" onClick={e => e.stopPropagation()}>
                      <div className="free-note-modal-header">
                        <h4>{p.name}</h4>
                        <button type="button" className="modal-close-btn" onClick={() => setPhotoModalPlantId(null)}>✕</button>
                      </div>
                      <div className="free-note-sheet">
                        <div className="gallery-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
                          {[
                            { url: p.image_url, field: 'image_url', label: 'Foto 1', onUpload: f => updatePlantImage(p.id, f) },
                            { url: p.extra_image_1, field: 'extra_image_1', label: 'Foto 2', onUpload: f => updatePlantExtraImage(p.id, 'extra_image_1', f) },
                            { url: p.extra_image_2, field: 'extra_image_2', label: 'Foto 3', onUpload: f => updatePlantExtraImage(p.id, 'extra_image_2', f) },
                          ].map(slot => (
                            <div key={slot.field} style={{ textAlign: 'center' }}>
                              {slot.url ? <img src={slot.url} alt={slot.label} style={{ width: '100%', borderRadius: 8 }} /> : <div className="no-img-sm">Sin foto</div>}
                              <label className="file-label" style={{ display: 'block', marginTop: 4, background: 'transparent', color: 'inherit', border: '1px solid #ccc' }}>
                                {slot.url ? 'Cambiar' : `Subir ${slot.label}`}
                                <input
                                  type="file"
                                  accept="image/*"
                                  style={{ display: 'none' }}
                                  onChange={e => { slot.onUpload(e.target.files[0]); e.target.value = '' }}
                                />
                              </label>
                            </div>
                          ))}
                        </div>

                        {p.video_url && <video src={p.video_url} controls className="note-video" style={{ width: '100%', marginTop: 12 }} />}
                        <label className="file-label" style={{ display: 'block', marginTop: 8, background: 'transparent', color: 'inherit', border: '1px solid #ccc' }}>
                          {p.video_url ? '🎥 Cambiar video' : '🎥 Subir video'}
                          <input
                            type="file"
                            accept="video/*"
                            style={{ display: 'none' }}
                            onChange={e => { updatePlantVideo(p.id, e.target.files[0]); e.target.value = '' }}
                          />
                        </label>

                        <textarea
                          className="plant-description-input"
                          placeholder="Descripción"
                          defaultValue={p.description || ''}
                          rows={3}
                          style={{ marginTop: 12, width: '100%' }}
                          onBlur={e => updatePlantDescription(p.id, e.target.value)}
                        />
                      </div>
                    </div>
                  </div>
                )
              })()}

              {plantNoteModalOpen && (
                <div className="admin-sheet-overlay">
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
                          {b.type === 'text' && <p>{b.content}</p>}
                          {b.type === 'photo' && <img src={b.url || URL.createObjectURL(b.file)} alt="" className="note-sheet-photo" />}
                          {b.type === 'video' && (
                            <video src={b.url || URL.createObjectURL(b.file)} controls className="note-video" />
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
                      <div className="note-sheet-toolbar">
                        <label className="icon-btn" title="Insertar foto aquí">
                          📷
                          <input
                            type="file"
                            accept="image/*"
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
                        {plantNoteBlocks.length > 0 && (
                          <button type="button" className="icon-btn-text" onClick={removeLastPlantNoteBlock}>Deshacer</button>
                        )}
                        <button type="button" className="save-note-btn-inline" onClick={savePlantNote} disabled={savingPlantNote}>
                          {savingPlantNote ? 'Guardando...' : 'Guardar'}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
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

              {view === 'ingresos' && (() => {
                function compraCategoryId(c) {
                  if (c.new_plant_category) return c.new_plant_category
                  const plant = plants.find(p => p.id === c.plant_id)
                  return plant ? plant.category_id : null
                }

                const filteredCompras = compras
                  .filter(c => {
                    const term = ingresosSearch.trim().toLowerCase()
                    if (!term) return true
                    return (c.proveedor || '').toLowerCase().includes(term) || (c.plant_name || '').toLowerCase().includes(term)
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
                    <input
                      className="order-search"
                      placeholder="Buscar por proveedor o planta..."
                      value={ingresosSearch}
                      onChange={e => setIngresosSearch(e.target.value)}
                    />
                    <div className="mov-filters">
                      <input
                        type="date"
                        className="gallery-select"
                        value={ingresosDate}
                        onChange={e => setIngresosDate(e.target.value)}
                      />
                      <select className="gallery-select" value={ingresosCategoria} onChange={e => setIngresosCategoria(e.target.value)}>
                        <option value="all">Todas las categorías</option>
                        {categories.map(c => <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>)}
                      </select>
                      <select className="gallery-select" value={ingresosStatus} onChange={e => setIngresosStatus(e.target.value)}>
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

                    {!loteBuilderOpen ? (
                      <button type="button" className="full-form-btn" onClick={() => setLoteBuilderOpen(true)}>🧺 Nueva compra</button>
                    ) : (
                      <div className="admin-form">
                        <h3>Nueva compra</h3>
                        <input placeholder="Proveedor (opcional)" value={loteProveedor} onChange={e => setLoteProveedor(e.target.value)} />
                        <input placeholder="Nota (ej: 'Iris julio')" value={loteNota} onChange={e => setLoteNota(e.target.value)} />

                        <h4>Agregar planta a esta compra</h4>
                        <select value={lineForm.plant_id} onChange={e => setLineForm({ ...lineForm, plant_id: e.target.value, new_plant_name: '', new_plant_category: '' })}>
                          <option value="">Selecciona planta existente</option>
                          {plants.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                        <p style={{ margin: '4px 0', fontSize: '0.8rem', color: '#6b6b5f' }}>— o registra una planta nueva —</p>
                        <input placeholder="Nombre de planta nueva" value={lineForm.new_plant_name} onChange={e => setLineForm({ ...lineForm, plant_id: '', new_plant_name: e.target.value })} />
                        <select value={lineForm.new_plant_category} onChange={e => setLineForm({ ...lineForm, new_plant_category: e.target.value })}>
                          <option value="">Selecciona categoría (crea la categoría primero en Categorías si no existe)</option>
                          {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                        <input placeholder="Cantidad" type="number" value={lineForm.quantity} onChange={e => setLineForm({ ...lineForm, quantity: e.target.value })} />
                        <input placeholder="Precio de compra (por unidad)" type="number" step="0.01" value={lineForm.unit_cost} onChange={e => setLineForm({ ...lineForm, unit_cost: e.target.value })} />
                        <input placeholder="Precio de venta (opcional)" type="number" step="0.01" value={lineForm.sale_price} onChange={e => setLineForm({ ...lineForm, sale_price: e.target.value })} />
                        <input type="file" accept="image/*" onChange={e => setLineForm({ ...lineForm, file: e.target.files[0] })} />
                        <button type="button" onClick={addLineToLote}>➕ Agregar a la lista</button>

                        {loteLines.length > 0 && (
                          <div className="admin-list">
                            <h4>Plantas en esta compra ({loteLines.length})</h4>
                            {loteLines.map((line, i) => (
                              <div key={i} className="admin-item">
                                <div className="admin-item-info">
                                  <strong>{line.plant_name}</strong>
                                  <span>Cantidad: {line.quantity} — Costo: ${Number(line.unit_cost).toFixed(2)}</span>
                                  <div className="admin-item-actions">
                                    <button onClick={() => removeLoteLine(i)} className="danger">Quitar</button>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}

                        <div className="admin-item-actions">
                          <button
                            type="button"
                            onClick={saveLote}
                            disabled={savingLote || loteLines.length === 0}
                            style={{ background: '#4a5d3a', color: '#fff', padding: '10px 16px', borderRadius: 6, border: 'none' }}
                          >
                            {savingLote ? 'Guardando...' : 'Guardar compra'}
                          </button>
                          <button
                            type="button"
                            onClick={() => { setLoteBuilderOpen(false); setLoteLines([]); setLoteNota(''); setLoteProveedor('') }}
                            style={{ background: '#fff', color: '#b03434', padding: '10px 16px', borderRadius: 6, border: '1px solid #b03434' }}
                          >
                            Cancelar
                          </button>
                        </div>
                      </div>
                    )}

                    <div className="admin-list">
                      {lotes.length === 0 && comprasSinLote.length === 0 && <p className="status-msg">No hay ingresos registrados.</p>}
                      {lotes.map(lote => {
                        const lineas = comprasByLote[lote.id] || []
                        if (lineas.length === 0) return null
                        const totalLote = lineas.reduce((sum, c) => sum + Number(c.total), 0)
                        return (
                          <div key={lote.id} className="admin-item lote-group">
                            <div className="admin-item-info">
                              <strong>🧺 Compra #{lote.numero}{lote.nota ? ` — ${lote.nota}` : ''}</strong>
                              <label>Procedencia: <input defaultValue={lote.proveedor || ''} onBlur={e => updateLoteProveedor(lote, e.target.value)} /></label>
                              <span>Fecha: {new Date(lote.created_at).toLocaleDateString()}</span>
                              <span>Total compra: ${totalLote.toFixed(2)}</span>
                              <div className="admin-item-actions">
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
                                <button onClick={() => deleteLote(lote.id)} className="danger">
                                  🗑️ Eliminar compra
                                </button>
                              </div>
                              {addToLoteId === lote.id && (
                                <div className="admin-form" style={{ marginTop: 8 }}>
                                  <h4>Agregar planta olvidada a esta compra</h4>
                                  <select value={addToLoteForm.plant_id} onChange={e => setAddToLoteForm({ ...addToLoteForm, plant_id: e.target.value, new_plant_name: '', new_plant_category: '' })}>
                                    <option value="">Selecciona planta existente</option>
                                    {plants.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                                  </select>
                                  <p style={{ margin: '4px 0', fontSize: '0.8rem', color: '#6b6b5f' }}>— o registra una planta nueva —</p>
                                  <input placeholder="Nombre de planta nueva" value={addToLoteForm.new_plant_name} onChange={e => setAddToLoteForm({ ...addToLoteForm, plant_id: '', new_plant_name: e.target.value })} />
                                  <select value={addToLoteForm.new_plant_category} onChange={e => setAddToLoteForm({ ...addToLoteForm, new_plant_category: e.target.value })}>
                                    <option value="">Selecciona categoría</option>
                                    {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
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
                              {lote.content_blocks && lote.content_blocks.length > 0 && (
                                <div className="note-blocks-view">
                                  {lote.content_blocks.map((b, i) => (
                                    <div key={i}>
                                      {b.type === 'text' && <p className="task-note">{b.content}</p>}
                                      {b.type === 'photo' && <img src={b.url} alt="" className="note-block-photo" />}
                                      {b.type === 'video' && <video src={b.url} controls className="note-video" />}
                                    </div>
                                  ))}
                                </div>
                              )}
                              {lineas.map(c => (
                                <div key={c.id} className="admin-item" style={{ marginLeft: 12 }}>
                                  {c.image_url ? <img src={c.image_url} alt={c.plant_name} /> : <div className="no-img-sm">Sin foto</div>}
                                  <div className="admin-item-info">
                                    <input
                                      defaultValue={c.plant_name}
                                      onBlur={e => updateCompraField(c, 'plant_name', e.target.value)}
                                      style={{ fontWeight: 'bold', fontSize: '1rem', width: '100%', boxSizing: 'border-box' }}
                                    />
                                    <span className={`order-badge order-${c.status}`}>{c.status}</span>
                                    <label>Procedencia: <input defaultValue={c.proveedor || ''} onBlur={e => updateCompraField(c, 'proveedor', e.target.value)} /></label>
                                    <div className="admin-item-controls">
                                      <label>Cant.: <input type="number" defaultValue={c.quantity} onBlur={e => updateCompraField(c, 'quantity', e.target.value)} /></label>
                                      <label>Costo: $<input type="number" step="0.01" defaultValue={c.unit_cost} onBlur={e => updateCompraField(c, 'unit_cost', e.target.value)} /></label>
                                      <label>Venta: $<input type="number" step="0.01" defaultValue={c.sale_price ?? ''} onBlur={e => updateCompraField(c, 'sale_price', e.target.value)} /></label>
                                    </div>
                                    <span>Subtotal: ${Number(c.total).toFixed(2)}</span>
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
                          </div>
                        )
                      })}
                      {comprasSinLote.map(c => (
                        <div key={c.id} className="admin-item">
                          {c.image_url ? <img src={c.image_url} alt={c.plant_name} /> : <div className="no-img-sm">Sin foto</div>}
                          <div className="admin-item-info">
                            <input
                              defaultValue={c.plant_name}
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

                    {loteNoteModalOpen && (
                      <div className="admin-sheet-overlay">
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
                              <label className="icon-btn" title="Insertar foto aquí">
                                📷
                                <input
                                  type="file"
                                  accept="image/*"
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
                              <button type="button" className="save-note-btn-inline" onClick={saveLoteNote} disabled={savingLoteNote}>
                                {savingLoteNote ? 'Guardando...' : 'Guardar'}
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </>
                )
              })()}

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
