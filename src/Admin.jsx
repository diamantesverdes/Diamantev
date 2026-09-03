import { useState, useEffect, Component } from 'react'
import { jsPDF } from 'jspdf'
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

function StatusChecklist({ steps, currentStatus, onAdvance, disabled }) {
  const currentIndex = steps.findIndex(s => s.key === currentStatus)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 11, textAlign: 'left' }}>
      {steps.map((s, i) => {
        const checked = i <= currentIndex
        const isNext = i === currentIndex + 1
        return (
          <label key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 4, opacity: checked || isNext ? 1 : 0.4 }}>
            <input
              type="checkbox"
              checked={checked}
              disabled={disabled || !isNext}
              onChange={() => isNext && onAdvance(s.key)}
            />
            {s.label}
          </label>
        )
      })}
    </div>
  )
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

  // 'home' | 'plantas' | 'categorias' | 'pedidos' | 'ingresos'
  const [view, setView] = useState('home')

  const [galleryFilter, setGalleryFilter] = useState('all')
  const [galleryActionFilter, setGalleryActionFilter] = useState('all')
  const [gallerySearch, setGallerySearch] = useState('')
  const [categoriesSearch, setCategoriesSearch] = useState('')
  const [selectedLabels, setSelectedLabels] = useState(new Set())
  const [photoModalPlantId, setPhotoModalPlantId] = useState(null)
  const [photoModalIndex, setPhotoModalIndex] = useState(0)
  const [photoModalMenuOpen, setPhotoModalMenuOpen] = useState(false)
  const [photoModalSection, setPhotoModalSection] = useState(null)
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
  const [ventaLineForm, setVentaLineForm] = useState({ plant_id: '', quantity: '', unit_price: '', motivo: 'Venta' })
  const [savingVentaLote, setSavingVentaLote] = useState(false)
  const [addToVentaLoteId, setAddToVentaLoteId] = useState(null)
  const [shareVentaMenuId, setShareVentaMenuId] = useState(null)
  const [loteBuilderOpen, setLoteBuilderOpen] = useState(false)
  const [loteStep, setLoteStep] = useState('header') // 'header' (paso 1) | 'products' (paso 2)
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
    const { data: vlts } = await supabase.from('venta_lotes').select('*').order('numero', { ascending: false })
    const { data: decs } = await supabase.from('decrementos').select('*').order('created_at', { ascending: false })
    const { data: pnts } = await supabase.from('plant_notes').select('*').order('created_at', { ascending: false })
    setCategories(cats || [])
    setPlants(pls || [])
    setOrders(ords || [])
    setCompras(comps || [])
    setLotes(lts || [])
    setVentaLotes(vlts || [])
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
    if (error) { alert('Error al subir el archivo: ' + error.message); return null }
    const { data } = supabaseStorage.storage.from(bucket).getPublicUrl(fileName)
    return data.publicUrl
  }

  // ---------- Ingresos (compras agrupadas en lotes) ----------
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
      const nameNormalized = lineForm.new_plant_name.trim().toLowerCase()
      const existing = plants.find(p => p.name.trim().toLowerCase() === nameNormalized)
      if (existing) {
        alert(`Ya existe una planta llamada "${existing.name}". Selecciónala de la lista "Selecciona planta existente" en vez de escribirla como nueva, para no duplicarla.`)
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

    // La foto se aplica de inmediato si es una planta existente (no afecta el stock)
    if (!usingNew && plant && image_url) {
      await supabase.from('plants').update({ image_url }).eq('id', plant.id)
    }

    // Si la compra ya estaba recibida, actualiza el stock de inmediato
    if (status === 'recibido') {
      if (!usingNew && plant) {
        await supabase.from('plants').update({ stock: plant.stock + quantity }).eq('id', plant.id)
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

  async function updateLoteExtra(lote, field, value) {
    const num = Number(value) || 0
    const { error } = await supabase.from('compra_lotes').update({ [field]: num }).eq('id', lote.id)
    if (error) { alert('Error al guardar el cambio: ' + error.message); return }
    loadData()
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

  // ---------- Ventas agrupadas en factura (venta_lotes) ----------
  function addLineToVentaLote(e) {
    e.preventDefault()
    if (!ventaLineForm.plant_id || !ventaLineForm.quantity || !ventaLineForm.motivo) {
      alert('Selecciona una planta, la cantidad y el motivo')
      return
    }
    const plant = plants.find(p => p.id === ventaLineForm.plant_id)
    setVentaLoteLines(prev => [...prev, {
      ...ventaLineForm,
      plant_name: plant ? plant.name : '',
      unit_price: ventaLineForm.unit_price !== '' ? ventaLineForm.unit_price : 0,
    }])
    setVentaLineForm({ plant_id: '', quantity: '', unit_price: '', motivo: 'Venta' })
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
      const plant = plants.find(p => p.id === line.plant_id)
      const quantity = Number(line.quantity)
      const unit_price = Number(line.unit_price) || 0
      const { error } = await supabase.from('decrementos').insert({
        plant_id: line.plant_id, plant_name: line.plant_name, quantity, motivo: line.motivo, unit_price, lote_id: lote.id, status: 'pedido',
      })
      if (error) { alert('Error al guardar una de las plantas: ' + error.message); continue }
    }
    setVentaLoteCliente('')
    setVentaLoteLines([])
    setVentaLoteBuilderOpen(false)
    setSavingVentaLote(false)
    loadData()
  }

  async function addPlantToVentaLote(loteId) {
    if (!ventaLineForm.plant_id || !ventaLineForm.quantity || !ventaLineForm.motivo) {
      alert('Selecciona una planta, la cantidad y el motivo')
      return
    }
    const plant = plants.find(p => p.id === ventaLineForm.plant_id)
    const quantity = Number(ventaLineForm.quantity)
    const unit_price = Number(ventaLineForm.unit_price) || 0
    const { error } = await supabase.from('decrementos').insert({
      plant_id: ventaLineForm.plant_id, plant_name: plant ? plant.name : '', quantity, motivo: ventaLineForm.motivo, unit_price, lote_id: loteId, status: 'pedido',
    })
    if (error) { alert('Error al guardar la planta: ' + error.message); return }
    setVentaLineForm({ plant_id: '', quantity: '', unit_price: '', motivo: 'Venta' })
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

  async function markDecrementoPagado(d) {
    setApprovingIds(prev => [...prev, d.id])
    const { error } = await supabase.from('decrementos').update({ status: 'pagado' }).eq('id', d.id)
    if (error) alert('Error al actualizar: ' + error.message)
    setApprovingIds(prev => prev.filter(id => id !== d.id))
    loadData()
  }

  async function markDecrementoEntregado(d) {
    setApprovingIds(prev => [...prev, d.id])
    const { error } = await supabase.from('decrementos').update({ status: 'entregado' }).eq('id', d.id)
    if (error) { alert('Error al actualizar: ' + error.message); setApprovingIds(prev => prev.filter(id => id !== d.id)); return }
    const plant = plants.find(p => p.id === d.plant_id)
    if (plant) await supabase.from('plants').update({ stock: Math.max(0, plant.stock - Number(d.quantity)) }).eq('id', plant.id)
    setApprovingIds(prev => prev.filter(id => id !== d.id))
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

  function buildVentaInvoiceText(lote, lineasConProrrateo, subtotal, totalLote) {
    const items = lineasConProrrateo.map(d => `- ${d.plant_name} x${d.quantity} — $${d._lineTotal.toFixed(2)}`).join('\n')
    let text = `🧾 Factura de venta #${lote.numero}\n`
    if (lote.cliente) text += `Cliente: ${lote.cliente}\n`
    text += `Fecha: ${new Date(lote.created_at).toLocaleDateString()}\n\n`
    text += `Detalle:\n${items}\n\n`
    text += `Subtotal: $${subtotal.toFixed(2)}\n`
    if (lote.envio1) text += `Envío 1: $${Number(lote.envio1).toFixed(2)}\n`
    if (lote.envio2) text += `Envío 2: $${Number(lote.envio2).toFixed(2)}\n`
    if (lote.varios) text += `Varios: $${Number(lote.varios).toFixed(2)}\n`
    text += `Total: $${totalLote.toFixed(2)}\n\n`
    text += `¡Gracias por tu compra! - Diamantev 🌿`
    return text
  }

  function sendVentaInvoiceWhatsApp(lote, lineasConProrrateo, subtotal, totalLote) {
    const text = buildVentaInvoiceText(lote, lineasConProrrateo, subtotal, totalLote)
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank')
  }

  async function downloadVentaInvoicePDF(lote, lineasConProrrateo, subtotal, totalLote) {
    try {
      const doc = new jsPDF({ unit: 'mm', format: 'a4' })
      let y = 20
      doc.setFontSize(16)
      doc.text(`Factura de venta #${lote.numero}`, 15, y)
      y += 8
      doc.setFontSize(11)
      if (lote.cliente) { doc.text(`Cliente: ${lote.cliente}`, 15, y); y += 6 }
      doc.text(`Fecha: ${new Date(lote.created_at).toLocaleDateString()}`, 15, y)
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

      lineasConProrrateo.forEach(d => {
        if (y > 270) { doc.addPage(); y = 20 }
        doc.text(String(d.plant_name).slice(0, 45), 15, y)
        doc.text(String(d.quantity), 110, y)
        doc.text(`$${Number(d.unit_price || 0).toFixed(2)}`, 135, y)
        doc.text(`$${d._lineTotal.toFixed(2)}`, 170, y)
        y += 6
      })

      y += 2
      doc.line(15, y, 195, y)
      y += 6
      doc.text(`Subtotal: $${subtotal.toFixed(2)}`, 135, y); y += 6
      if (lote.envio1) { doc.text(`Envío 1: $${Number(lote.envio1).toFixed(2)}`, 135, y); y += 6 }
      if (lote.envio2) { doc.text(`Envío 2: $${Number(lote.envio2).toFixed(2)}`, 135, y); y += 6 }
      if (lote.varios) { doc.text(`Varios: $${Number(lote.varios).toFixed(2)}`, 135, y); y += 6 }
      doc.setFont(undefined, 'bold')
      doc.text(`Total: $${totalLote.toFixed(2)}`, 135, y)

      doc.save(`factura-venta-${lote.numero}.pdf`)
    } catch (err) {
      alert('No se pudo generar el PDF. Intenta de nuevo.')
    }
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
      await supabase.from('plants').update({ stock: Math.max(0, plant.stock - quantity) }).eq('id', plant.id)
    }
    setDecForm({ plant_id: '', quantity: '', motivo: '', motivo_otro: '', unit_price: '' })
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

  async function markPlantsAction(ids, field) {
    if (ids.length === 0) return
    await supabase.from('plants').update({ [field]: new Date().toISOString() }).in('id', ids)
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
    markPlantsAction(Array.from(selectedLabels), 'printed_at')
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

  async function downloadLabelsPDF(list) {
    const selected = list.filter(p => selectedLabels.has(p.id))
    if (selected.length === 0) return
    setSharingNotes(true)
    try {
      const doc = new jsPDF({ unit: 'mm', format: 'a4' })
      const labelW = 50, labelH = 60, marginX = 10, marginY = 10, gapX = 5, gapY = 5
      const cols = Math.max(1, Math.floor((210 - marginX * 2 + gapX) / (labelW + gapX)))
      const rows = Math.max(1, Math.floor((297 - marginY * 2 + gapY) / (labelH + gapY)))
      const perPage = cols * rows
      const bannerH = 10

      for (let i = 0; i < selected.length; i++) {
        const p = selected[i]
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

      doc.save('etiquetas-diamantev.pdf')
      await markPlantsAction(selected.map(p => p.id), 'pdf_generated_at')
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
    { key: 'galeria', label: 'Galería', icon: '🪴', count: plants.length },
    { key: 'categorias', label: 'Categorías', icon: '🏷️', count: categories.length },
    { key: 'pedidos', label: 'Ventas y Decrementos', icon: '🧾', count: pedidosPendientes },
    { key: 'ingresos', label: 'Ingresos', icon: '📦', count: ingresosEnCurso },
  ]

  const sheetTitles = {
    galeria: '🪴 Galería',
    categorias: '🏷️ Categorías',
    pedidos: '🧾 Ventas y Decrementos',
    ingresos: '📦 Ingresos',
  }

  return (
    <div className="admin" style={{ minHeight: '100vh', width: '100%', overflowX: 'hidden', boxSizing: 'border-box' }}>
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
              {view === 'galeria' && (
                <>
                  <select className="gallery-select" value={galleryFilter} onChange={e => setGalleryFilter(e.target.value)}>
                    <option value="all">Todas las categorías</option>
                    {categories.map(c => (
                      <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>
                    ))}
                  </select>
                  <select className="gallery-select" value={galleryActionFilter} onChange={e => setGalleryActionFilter(e.target.value)}>
                    <option value="all">Todas (sin filtrar por acción)</option>
                    <option value="shared">📤 Compartidas en el catálogo</option>
                    <option value="printed">🏷️ Impresas</option>
                    <option value="pdf">📄 Guardadas en PDF</option>
                    <option value="whatsapp">📲 Enviadas por WhatsApp</option>
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
                      .filter(p => {
                        if (galleryActionFilter === 'shared') return p.shared_visible
                        if (galleryActionFilter === 'printed') return !!p.printed_at
                        if (galleryActionFilter === 'pdf') return !!p.pdf_generated_at
                        if (galleryActionFilter === 'whatsapp') return !!p.whatsapp_shared_at
                        return true
                      })
                    return (
                      <>
                        <div className="label-select-bar">
                          <button type="button" onClick={() => selectAllLabels(galleryPlants)}>Seleccionar todas</button>
                          <button type="button" onClick={clearLabels}>Deseleccionar todas</button>
                          {selectedLabels.size > 0 && (
                            <>
                              <button type="button" className="print-btn" onClick={printLabels}>
                                🏷️ Imprimir ({selectedLabels.size})
                              </button>
                              <button type="button" className="print-btn" onClick={() => downloadLabelsPDF(galleryPlants)} disabled={sharingNotes}>
                                {sharingNotes ? 'Generando...' : `📄 Descargar PDF (${selectedLabels.size})`}
                              </button>
                              <button type="button" className="print-btn" onClick={() => setShareModalOpen(true)}>
                                📤 Compartir/Enviar ({selectedLabels.size})
                              </button>
                              <button type="button" className="print-btn" onClick={() => shareSelectedPhotosDirect(galleryPlants)} disabled={sharingNotes}>
                                {sharingNotes ? 'Preparando...' : `📲 Enviar fotos (${selectedLabels.size})`}
                              </button>
                            </>
                          )}
                        </div>
                        <div className="gallery-grid">
                          {galleryPlants.map(p => (
                            <div key={p.id} className="gallery-item" style={{ position: 'relative' }}>
                              <label className="gallery-checkbox">
                                <input
                                  type="checkbox"
                                  checked={selectedLabels.has(p.id)}
                                  onChange={() => toggleLabelSelect(p.id)}
                                />
                              </label>
                              {p.coming_soon && <span title="Próximamente" style={{ position: 'absolute', top: 4, left: 4, zIndex: 2 }}>🔜</span>}
                              <div onClick={() => { setPhotoModalPlantId(p.id); setPhotoModalIndex(0); setPhotoModalMenuOpen(false); setPhotoModalSection(null) }} style={{ cursor: 'pointer' }}>
                                {p.image_url ? <img src={p.image_url} alt={p.name} /> : <div className="no-img-sm">Sin foto</div>}
                              </div>
                              <span>{p.name}{!p.active ? ' (oculta)' : ''}</span>
                            </div>
                          ))}
                        </div>

                        {shareModalOpen && (() => {
                          let toSend = galleryPlants.filter(p => selectedLabels.has(p.id))
                          if (shareOnlyStock) toSend = toSend.filter(p => p.stock > 0)
                          return (
                            <div className="admin-sheet-overlay" onClick={() => setShareModalOpen(false)}>
                              <div className="free-note-modal" onClick={e => e.stopPropagation()}>
                                <div className="free-note-modal-header">
                                  <h4>Marcar y enviar link</h4>
                                  <button type="button" className="modal-close-btn" onClick={() => setShareModalOpen(false)}>✕</button>
                                </div>
                                <div className="free-note-sheet">
                                  <p className="status-msg">Estas plantas se marcarán como disponibles en el link compartido y se enviará solo el enlace por WhatsApp (el cliente ve fotos, precio y stock al abrirlo).</p>
                                  <label style={{ display: 'block', marginBottom: 10 }}>
                                    <input type="checkbox" checked={shareOnlyStock} onChange={e => setShareOnlyStock(e.target.checked)} /> Solo las que tienen stock
                                  </label>

                                  <div className="admin-list">
                                    {toSend.length === 0 && <p className="status-msg">Ninguna planta seleccionada cumple el filtro.</p>}
                                    {toSend.map(p => (
                                      <div key={p.id} className="admin-item">
                                        {p.image_url ? <img src={p.image_url} alt={p.name} /> : <div className="no-img-sm">Sin foto</div>}
                                        <div className="admin-item-info">
                                          <strong>{p.name}</strong>
                                          <span>${Number(p.price).toFixed(2)}</span>
                                        </div>
                                      </div>
                                    ))}
                                  </div>

                                  <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                                    <button type="button" onClick={copySharedLink} style={{ flex: 1 }}>
                                      🔗 Copiar link
                                    </button>
                                    <button type="button" className="save-note-btn-inline" onClick={() => shareSelectedPhotos(galleryPlants)} disabled={sharingNotes || toSend.length === 0} style={{ flex: 1 }}>
                                      {sharingNotes ? 'Preparando...' : `📲 Marcar y enviar (${toSend.length})`}
                                    </button>
                                  </div>
                                </div>
                              </div>
                            </div>
                          )
                        })()}
                      </>
                    )
                  })()}
                </>
              )}

              {view === 'categorias' && (
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

              {photoModalPlantId && (() => {
                const p = plants.find(pl => pl.id === photoModalPlantId)
                if (!p) return null
                const notesForPlant = plantNotes.filter(n => n.plant_id === p.id)
                const slides = [
                  { type: 'image', url: p.image_url, label: 'Foto 1', onUpload: f => updatePlantImage(p.id, f) },
                  { type: 'image', url: p.extra_image_1, label: 'Foto 2', onUpload: f => updatePlantExtraImage(p.id, 'extra_image_1', f) },
                  { type: 'image', url: p.extra_image_2, label: 'Foto 3', onUpload: f => updatePlantExtraImage(p.id, 'extra_image_2', f) },
                  { type: 'video', url: p.video_url, label: 'Video', onUpload: f => updatePlantVideo(p.id, f) },
                ]
                const current = slides[photoModalIndex] || slides[0]
                return (
                  <div className="admin-sheet-overlay" onClick={() => { setPhotoModalPlantId(null); setPhotoModalMenuOpen(false); setPhotoModalSection(null) }}>
                    <div className="free-note-modal" onClick={e => e.stopPropagation()} style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, width: '100%', height: '100%', maxWidth: 'none', maxHeight: 'none', borderRadius: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                      <div className="free-note-modal-header" style={{ flexShrink: 0 }}>
                        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                          <button type="button" onClick={() => setPhotoModalMenuOpen(!photoModalMenuOpen)}>☰</button>
                          <h4>{p.name}</h4>
                        </div>
                        <button type="button" className="modal-close-btn" onClick={() => { setPhotoModalPlantId(null); setPhotoModalMenuOpen(false); setPhotoModalSection(null) }}>✕</button>
                      </div>

                      {photoModalMenuOpen && (
                        <div
                          style={{ position: 'absolute', top: 0, left: 0, bottom: 0, width: '70%', maxWidth: 240, zIndex: 6, background: '#fff', borderRight: '1px solid #ccc', boxShadow: '2px 0 8px rgba(0,0,0,0.15)', display: 'flex', flexDirection: 'column', paddingTop: 50 }}
                        >
                          <button type="button" style={{ textAlign: 'left', padding: '12px 16px' }} onClick={() => { setPhotoModalSection('descripcion'); setPhotoModalMenuOpen(false) }}>📝 Descripción</button>
                          <button type="button" style={{ textAlign: 'left', padding: '12px 16px' }} onClick={() => { setPhotoModalSection('notas'); setPhotoModalMenuOpen(false) }}>📓 Notas ({notesForPlant.length})</button>
                        </div>
                      )}

                      <div className="free-note-sheet" style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
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
                          </div>
                          <button type="button" onClick={() => setPhotoModalIndex((photoModalIndex + 1) % slides.length)}>›</button>
                        </div>

                        <div style={{ marginTop: 12, borderTop: '1px solid #eee', paddingTop: 12 }}>
                          <select
                            value={p.category_id || ''}
                            onChange={e => updatePlantCategory(p.id, e.target.value)}
                            style={{ width: '100%' }}
                          >
                            <option value="">Sin categoría</option>
                            {categories.map(cat => (
                              <option key={cat.id} value={cat.id}>{cat.emoji} {cat.name}</option>
                            ))}
                          </select>
                          <div className="admin-item-controls" style={{ marginTop: 8 }}>
                            <label>$<input type="number" step="0.01" defaultValue={p.price} onBlur={e => updatePrice(p.id, Number(e.target.value))} /></label>
                            <label>Stock: <input type="number" defaultValue={p.stock} onBlur={e => updateStock(p.id, Number(e.target.value))} /></label>
                          </div>
                          <div className="admin-item-actions" style={{ marginTop: 8 }}>
                            <button type="button" onClick={() => toggleActive(p.id, p.active)}>{p.active ? 'Ocultar' : 'Mostrar'}</button>
                            <button type="button" onClick={() => toggleIsNew(p.id, p.is_new)}>{p.is_new ? '🌱 Nueva ✓' : 'Marcar como nueva'}</button>
                            <button type="button" onClick={() => toggleOnSale(p.id, p.on_sale)}>{p.on_sale ? '🏷️ En descuento ✓' : 'Marcar en descuento'}</button>
                            <button type="button" onClick={() => toggleComingSoon(p.id, p.coming_soon)}>{p.coming_soon ? '🔜 Próximamente ✓' : 'Marcar como próximamente'}</button>
                          </div>
                        </div>

                        {photoModalSection === 'descripcion' && (
                          <textarea
                            className="plant-description-input"
                            placeholder="Descripción"
                            defaultValue={p.description || ''}
                            rows={4}
                            style={{ marginTop: 12, width: '100%' }}
                            onBlur={e => updatePlantDescription(p.id, e.target.value)}
                          />
                        )}

                        {photoModalSection === 'notas' && (
                          <div className="plant-notes-panel" style={{ marginTop: 12 }}>
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
                  <button type="button" onClick={() => setVentaLoteBuilderOpen(true)} style={{ marginBottom: 10 }}>
                    🧾 Nueva venta (factura)
                  </button>

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
                          list={plants
                            .filter(p => decPlantCategory === 'all' || p.category_id === decPlantCategory)
                            .filter(p => p.name.toLowerCase().includes(decPlantSearch.trim().toLowerCase()))}
                          selectedId={ventaLineForm.plant_id}
                          onSelect={id => setVentaLineForm({ ...ventaLineForm, plant_id: id })}
                        />
                      ) : (
                        <p className="status-msg" style={{ margin: '4px 0' }}>
                          {ventaLineForm.plant_id ? `✓ ${plants.find(p => p.id === ventaLineForm.plant_id)?.name || ''}` : 'Elige una categoría o escribe para buscar'}
                        </p>
                      )}
                      <input placeholder="Cantidad" type="number" value={ventaLineForm.quantity} onChange={e => setVentaLineForm({ ...ventaLineForm, quantity: e.target.value })} />
                      <select value={ventaLineForm.motivo} onChange={e => setVentaLineForm({ ...ventaLineForm, motivo: e.target.value })}>
                        <option value="Venta">Venta</option>
                        <option value="Dañada / Muerta">Dañada / Muerta</option>
                        <option value="Uso propio">Uso propio</option>
                        <option value="Regalo">Regalo</option>
                        <option value="Otro">Otro</option>
                      </select>
                      <input placeholder="Precio unitario (0 si es decremento/merma)" type="number" step="0.01" value={ventaLineForm.unit_price} onChange={e => setVentaLineForm({ ...ventaLineForm, unit_price: e.target.value })} />
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
                        <button type="button" onClick={saveVentaLote} disabled={savingVentaLote}>
                          {savingVentaLote ? 'Guardando...' : 'Guardar venta'}
                        </button>
                        <button type="button" onClick={() => { setVentaLoteBuilderOpen(false); setVentaLoteLines([]); setVentaLoteCliente('') }}>
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
                        </select>
                      </div>
                    </div>
                  )}

                  <div className="admin-list">
                    {ventaLotes.map(lote => {
                      const lineas = decrementos.filter(d => d.lote_id === lote.id)
                      if (lineas.length === 0) return null
                      const { subtotal, lineas: lineasConProrrateo, total: totalLote } = ventaLoteProration(lote, lineas)
                      const editingV = editingVentaLoteId === lote.id
                      return (
                        <div key={`vl-${lote.id}`} className="admin-item lote-group" style={{ width: '100%', maxWidth: '100%', minWidth: 0, overflow: 'hidden', boxSizing: 'border-box' }}>
                          <div className="admin-item-info" style={{ width: '100%', maxWidth: '100%', minWidth: 0, boxSizing: 'border-box' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <strong>🧾 Venta #{lote.numero}{lote.cliente ? ` — ${lote.cliente}` : ''}</strong>
                              <button type="button" onClick={() => setEditingVentaLoteId(editingV ? null : lote.id)}>
                                {editingV ? '✅ Listo' : '✏️ Editar'}
                              </button>
                            </div>
                            <span>Fecha: {new Date(lote.created_at).toLocaleDateString()}</span>

                            <p style={{ fontSize: '0.7rem', color: '#8a8a7a', margin: '8px 0 2px', textAlign: 'center' }}>◀ Deslizá la tabla para ver más columnas ▶</p>
                            <div style={{ width: '100%', maxWidth: '100%', minWidth: 0, overflowX: 'auto', WebkitOverflowScrolling: 'touch', touchAction: 'pan-x pan-y', marginTop: 2, borderRadius: 8, border: '1px solid #ddd', boxShadow: '0 1px 2px rgba(0,0,0,0.06)', boxSizing: 'border-box' }}>
                              <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 460, fontSize: 11 }}>
                                <thead>
                                  <tr style={{ background: '#f3ecdd' }}>
                                    <th style={{ padding: '3px 2px', border: '1px solid #ddd', whiteSpace: 'nowrap' }}>Foto</th>
                                    <th style={{ padding: '3px 2px', border: '1px solid #ddd', whiteSpace: 'normal', maxWidth: 120, wordBreak: 'break-word' }}>Nombre</th>
                                    <th style={{ padding: '3px 2px', border: '1px solid #ddd', whiteSpace: 'nowrap' }}>Motivo</th>
                                    <th style={{ padding: '3px 2px', border: '1px solid #ddd', whiteSpace: 'nowrap' }}>Cant</th>
                                    <th style={{ padding: '3px 2px', border: '1px solid #ddd', whiteSpace: 'nowrap' }}>P.Unit</th>
                                    <th style={{ padding: '3px 2px', border: '1px solid #ddd', whiteSpace: 'nowrap' }}>P.Tot</th>
                                    <th style={{ padding: '3px 2px', border: '1px solid #ddd', whiteSpace: 'nowrap' }}>Pror.</th>
                                    <th style={{ padding: '3px 2px', border: '1px solid #ddd', whiteSpace: 'nowrap' }}>Total</th>
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
                                      <td style={{ padding: 2, border: '1px solid #ddd', whiteSpace: 'nowrap' }}>
                                        {editingV ? (
                                          <select defaultValue={d.motivo} onChange={e => updateDecrementoField(d, 'motivo', e.target.value)} style={{ fontSize: 11 }}>
                                            <option value="Venta">Venta</option>
                                            <option value="Dañada / Muerta">Dañada / Muerta</option>
                                            <option value="Uso propio">Uso propio</option>
                                            <option value="Regalo">Regalo</option>
                                            <option value="Otro">Otro</option>
                                          </select>
                                        ) : d.motivo}
                                      </td>
                                      <td style={{ padding: 2, border: '1px solid #ddd', textAlign: 'center', whiteSpace: 'nowrap' }}>
                                        {editingV ? <input type="number" defaultValue={d.quantity} onBlur={e => updateDecrementoField(d, 'quantity', e.target.value)} style={{ width: 34, fontSize: 11 }} /> : d.quantity}
                                      </td>
                                      <td style={{ padding: 2, border: '1px solid #ddd', textAlign: 'right', whiteSpace: 'nowrap' }}>
                                        {editingV ? <input type="number" step="0.01" defaultValue={d.unit_price || 0} onBlur={e => updateDecrementoField(d, 'unit_price', e.target.value)} style={{ width: 48, fontSize: 11 }} /> : `$${Number(d.unit_price || 0).toFixed(2)}`}
                                      </td>
                                      <td style={{ padding: 2, border: '1px solid #ddd', textAlign: 'right', whiteSpace: 'nowrap' }}>${d._value.toFixed(2)}</td>
                                      <td style={{ padding: 2, border: '1px solid #ddd', textAlign: 'right', whiteSpace: 'nowrap' }}>${d._prorated.toFixed(2)}</td>
                                      <td style={{ padding: 2, border: '1px solid #ddd', textAlign: 'right', whiteSpace: 'nowrap' }}>${d._lineTotal.toFixed(2)}</td>
                                      <td style={{ padding: 2, border: '1px solid #ddd', textAlign: 'center', whiteSpace: 'nowrap' }}>
                                        <StatusChecklist
                                          steps={[{ key: 'pedido', label: 'Pedido' }, { key: 'pagado', label: 'Pagado' }, { key: 'entregado', label: 'Entregado' }]}
                                          currentStatus={d.status || 'pedido'}
                                          disabled={approvingIds.includes(d.id)}
                                          onAdvance={key => key === 'pagado' ? markDecrementoPagado(d) : markDecrementoEntregado(d)}
                                        />
                                      </td>
                                    </tr>
                                    )
                                  })}
                                </tbody>
                                <tfoot>
                                  <tr><td colSpan={6} style={{ padding: '3px 2px', border: '1px solid #ddd', whiteSpace: 'nowrap' }}>Subtotal</td><td colSpan={3} style={{ padding: '3px 2px', border: '1px solid #ddd', textAlign: 'right', whiteSpace: 'nowrap' }}>${subtotal.toFixed(2)}</td></tr>
                                  <tr><td colSpan={6} style={{ padding: '3px 2px', border: '1px solid #ddd', whiteSpace: 'nowrap' }}>Envío 1</td><td colSpan={3} style={{ padding: '3px 2px', border: '1px solid #ddd', textAlign: 'right', whiteSpace: 'nowrap' }}>{editingV ? <input type="number" step="0.01" defaultValue={lote.envio1 || 0} onBlur={e => updateVentaLoteExtra(lote, 'envio1', e.target.value)} style={{ width: 70, fontSize: 11 }} /> : `$${Number(lote.envio1 || 0).toFixed(2)}`}</td></tr>
                                  <tr><td colSpan={6} style={{ padding: '3px 2px', border: '1px solid #ddd', whiteSpace: 'nowrap' }}>Envío 2</td><td colSpan={3} style={{ padding: '3px 2px', border: '1px solid #ddd', textAlign: 'right', whiteSpace: 'nowrap' }}>{editingV ? <input type="number" step="0.01" defaultValue={lote.envio2 || 0} onBlur={e => updateVentaLoteExtra(lote, 'envio2', e.target.value)} style={{ width: 70, fontSize: 11 }} /> : `$${Number(lote.envio2 || 0).toFixed(2)}`}</td></tr>
                                  <tr><td colSpan={6} style={{ padding: '3px 2px', border: '1px solid #ddd', whiteSpace: 'nowrap' }}>Varios</td><td colSpan={3} style={{ padding: '3px 2px', border: '1px solid #ddd', textAlign: 'right', whiteSpace: 'nowrap' }}>{editingV ? <input type="number" step="0.01" defaultValue={lote.varios || 0} onBlur={e => updateVentaLoteExtra(lote, 'varios', e.target.value)} style={{ width: 70, fontSize: 11 }} /> : `$${Number(lote.varios || 0).toFixed(2)}`}</td></tr>
                                  <tr style={{ background: '#f3ecdd' }}><td colSpan={6} style={{ padding: '3px 2px', border: '1px solid #ddd', whiteSpace: 'nowrap' }}><strong>Total</strong></td><td colSpan={3} style={{ padding: '3px 2px', border: '1px solid #ddd', textAlign: 'right', whiteSpace: 'nowrap' }}><strong>${totalLote.toFixed(2)}</strong></td></tr>
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
                                    list={plants
                                      .filter(p => decPlantCategory === 'all' || p.category_id === decPlantCategory)
                                      .filter(p => p.name.toLowerCase().includes(decPlantSearch.trim().toLowerCase()))}
                                    selectedId={ventaLineForm.plant_id}
                                    onSelect={id => setVentaLineForm({ ...ventaLineForm, plant_id: id })}
                                  />
                                ) : (
                                  <p className="status-msg" style={{ margin: '4px 0' }}>
                                    {ventaLineForm.plant_id ? `✓ ${plants.find(p => p.id === ventaLineForm.plant_id)?.name || ''}` : 'Elige una categoría o escribe para buscar'}
                                  </p>
                                )}
                                <input placeholder="Cantidad" type="number" value={ventaLineForm.quantity} onChange={e => setVentaLineForm({ ...ventaLineForm, quantity: e.target.value })} style={{ width: '100%', boxSizing: 'border-box' }} />
                                <select value={ventaLineForm.motivo} onChange={e => setVentaLineForm({ ...ventaLineForm, motivo: e.target.value })} style={{ width: '100%', boxSizing: 'border-box' }}>
                                  <option value="Venta">Venta</option>
                                  <option value="Dañada / Muerta">Dañada / Muerta</option>
                                  <option value="Uso propio">Uso propio</option>
                                  <option value="Regalo">Regalo</option>
                                  <option value="Otro">Otro</option>
                                </select>
                                <input placeholder="Precio unitario (0 si es merma)" type="number" step="0.01" value={ventaLineForm.unit_price} onChange={e => setVentaLineForm({ ...ventaLineForm, unit_price: e.target.value })} style={{ width: '100%', boxSizing: 'border-box' }} />
                                <div className="admin-item-actions" style={{ flexWrap: 'wrap' }}>
                                  <button type="button" onClick={() => addPlantToVentaLote(lote.id)}>Guardar</button>
                                  <button type="button" onClick={() => { setAddToVentaLoteId(null); setVentaLineForm({ plant_id: '', quantity: '', unit_price: '', motivo: 'Venta' }) }}>Cancelar</button>
                                </div>
                              </div>
                            ) : (
                              <div style={{ display: 'flex', gap: 8, marginTop: 8, position: 'relative' }}>
                                <button
                                  type="button"
                                  onClick={() => setAddToVentaLoteId(lote.id)}
                                  style={{ flex: '1 1 auto', boxSizing: 'border-box' }}
                                >
                                  ➕ Agregar planta
                                </button>
                                <div style={{ position: 'relative' }}>
                                  <button
                                    type="button"
                                    onClick={() => setShareVentaMenuId(shareVentaMenuId === lote.id ? null : lote.id)}
                                    aria-label="Compartir factura"
                                    style={{ background: '#fff', color: '#4a5d3a', border: '1px solid #4a5d3a', padding: '10px 14px', borderRadius: 6, fontSize: '1rem', fontWeight: 600 }}
                                  >
                                    🔗
                                  </button>
                                  {shareVentaMenuId === lote.id && (
                                    <div style={{ position: 'absolute', right: 0, bottom: '110%', background: '#fff', border: '1px solid #ddd', borderRadius: 8, boxShadow: '0 2px 8px rgba(0,0,0,0.18)', overflow: 'hidden', zIndex: 5, minWidth: 170 }}>
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

                    {movimientosFiltrados.length === 0 && ventaLotes.length === 0 && <p className="status-msg">No se encontraron movimientos.</p>}
                    {movimientosFiltrados.filter(m => !(m._type === 'decremento' && m.lote_id)).map(m => (
                      m._type === 'venta' ? (
                        <div key={`o-${m.id}`} className="admin-item">
                          <div className="admin-item-info">
                            <strong>🛒 {m.customer_name}</strong>
                            <span>{m.customer_phone}</span>
                            <span className={`order-badge order-${m.status}`}>{m.status}</span>
                            <span>Pedido: {new Date(m.created_at).toLocaleDateString()}</span>
                            {m.fecha_pago && <span>Pagado: {new Date(m.fecha_pago).toLocaleDateString()}</span>}
                            {m.fecha_entrega && <span>Entregado: {new Date(m.fecha_entrega).toLocaleDateString()}</span>}

                            {(() => {
                              const { subtotal, items, total } = orderProration(m)
                              return (
                                <div style={{ overflowX: 'auto', marginTop: 8 }}>
                                  <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13 }}>
                                    <thead>
                                      <tr style={{ background: '#f3ecdd' }}>
                                        <th style={{ padding: 4, border: '1px solid #ddd' }}>Foto</th>
                                        <th style={{ padding: 4, border: '1px solid #ddd' }}>Nombre</th>
                                        <th style={{ padding: 4, border: '1px solid #ddd' }}>Cant.</th>
                                        <th style={{ padding: 4, border: '1px solid #ddd' }}>Precio unit.</th>
                                        <th style={{ padding: 4, border: '1px solid #ddd' }}>Precio total</th>
                                        <th style={{ padding: 4, border: '1px solid #ddd' }}>+Prorrateo</th>
                                        <th style={{ padding: 4, border: '1px solid #ddd' }}>Total</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {items.map(it => (
                                        <tr key={it.id}>
                                          <td style={{ padding: 4, border: '1px solid #ddd', textAlign: 'center' }}>{it._plant?.image_url ? <img src={it._plant.image_url} alt={it._plant.name} style={{ width: 32, height: 32, objectFit: 'cover', borderRadius: 4 }} /> : '—'}</td>
                                          <td style={{ padding: 4, border: '1px solid #ddd' }}>{it._plant ? it._plant.name : 'Planta'}</td>
                                          <td style={{ padding: 4, border: '1px solid #ddd', textAlign: 'center' }}>{it.quantity}</td>
                                          <td style={{ padding: 4, border: '1px solid #ddd', textAlign: 'right' }}>${it._unitPrice.toFixed(2)}</td>
                                          <td style={{ padding: 4, border: '1px solid #ddd', textAlign: 'right' }}>${it._value.toFixed(2)}</td>
                                          <td style={{ padding: 4, border: '1px solid #ddd', textAlign: 'right' }}>${it._prorated.toFixed(2)}</td>
                                          <td style={{ padding: 4, border: '1px solid #ddd', textAlign: 'right' }}>${it._lineTotal.toFixed(2)}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                    <tfoot>
                                      <tr><td colSpan={4} style={{ padding: 4, border: '1px solid #ddd' }}>Subtotal</td><td colSpan={3} style={{ padding: 4, border: '1px solid #ddd', textAlign: 'right' }}>${subtotal.toFixed(2)}</td></tr>
                                      <tr><td colSpan={4} style={{ padding: 4, border: '1px solid #ddd' }}>Envío 1</td><td colSpan={3} style={{ padding: 4, border: '1px solid #ddd', textAlign: 'right' }}><input type="number" step="0.01" defaultValue={m.envio1 || 0} onBlur={e => updateOrderExtra(m, 'envio1', e.target.value)} style={{ width: 80 }} /></td></tr>
                                      <tr><td colSpan={4} style={{ padding: 4, border: '1px solid #ddd' }}>Envío 2</td><td colSpan={3} style={{ padding: 4, border: '1px solid #ddd', textAlign: 'right' }}><input type="number" step="0.01" defaultValue={m.envio2 || 0} onBlur={e => updateOrderExtra(m, 'envio2', e.target.value)} style={{ width: 80 }} /></td></tr>
                                      <tr><td colSpan={4} style={{ padding: 4, border: '1px solid #ddd' }}>Varios</td><td colSpan={3} style={{ padding: 4, border: '1px solid #ddd', textAlign: 'right' }}><input type="number" step="0.01" defaultValue={m.varios || 0} onBlur={e => updateOrderExtra(m, 'varios', e.target.value)} style={{ width: 80 }} /></td></tr>
                                      <tr style={{ background: '#f3ecdd' }}><td colSpan={4} style={{ padding: 4, border: '1px solid #ddd' }}><strong>Total</strong></td><td colSpan={3} style={{ padding: 4, border: '1px solid #ddd', textAlign: 'right' }}><strong>${total.toFixed(2)}</strong></td></tr>
                                    </tfoot>
                                  </table>
                                </div>
                              )
                            })()}

                            <div className="admin-item-actions">
                              <StatusChecklist
                                steps={[{ key: 'pedido', label: 'Pedido' }, { key: 'pagado', label: 'Pagado' }, { key: 'entregado', label: 'Entregado' }]}
                                currentStatus={m.status}
                                disabled={approvingIds.includes(m.id)}
                                onAdvance={key => key === 'pagado' ? markAsPaid(m) : markAsDelivered(m)}
                              />
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div key={`d-${m.id}`} className="admin-item">
                          <div className="admin-item-info">
                            <strong>{m.motivo === 'Venta' ? '🛒' : m.motivo === 'Regalo' ? '🎁' : '🗑️'} {m.plant_name}</strong>
                            <span>{m.motivo === 'Otro' ? m.motivo_otro : m.motivo}</span>
                            <span>Registrado: {new Date(m.created_at).toLocaleDateString()}</span>
                            <span>Cantidad: -{m.quantity}</span>
                            {m.motivo === 'Venta' && (
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
                    {!loteBuilderOpen && (
                      <>
                        <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
                          <button
                            type="button"
                            className="full-form-btn"
                            onClick={() => { setLoteBuilderOpen(true); setLoteStep('header'); setLoteAddMode('choose') }}
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

                    {/* ---------- PASO 1: Cabecera de la compra (Proveedor) ---------- */}
                    {loteBuilderOpen && loteStep === 'header' && (
                      <div className="admin-form" style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 14 }}>
                        <div style={{ fontSize: '0.8rem', color: '#6b6b5f', marginBottom: -4, fontWeight: 600 }}>PASO 1 DE 2 · Datos de la compra</div>
                        <h3 style={{ margin: '4px 0' }}>Nueva compra</h3>
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
                              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                            </select>
                            <input type="file" accept="image/*" onChange={e => setLineForm({ ...lineForm, file: e.target.files[0] })} />
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
                        return (
                          <div key={lote.id} className="admin-item lote-group" style={{ width: '100%', maxWidth: '100%', minWidth: 0, overflow: 'hidden', boxSizing: 'border-box' }}>
                            <div className="admin-item-info" style={{ width: '100%', maxWidth: '100%', minWidth: 0, boxSizing: 'border-box' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <strong>🧺 Compra #{lote.numero}{lote.nota ? ` — ${lote.nota}` : ''}</strong>
                                <button type="button" onClick={() => setEditingLoteId(editing ? null : lote.id)}>
                                  {editing ? '✅ Listo' : '✏️ Editar'}
                                </button>
                              </div>
                              {editing ? (
                                <label>Proveedor: <input defaultValue={lote.proveedor || ''} onBlur={e => updateLoteProveedor(lote, e.target.value)} /></label>
                              ) : (
                                <span>Proveedor: {lote.proveedor || '—'}</span>
                              )}
                              <span>Fecha: {new Date(lote.created_at).toLocaleDateString()}</span>

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
                                    {lineasConProrrateo.map(c => (
                                      <tr key={c.id}>
                                        <td style={{ padding: 2, border: '1px solid #ddd', textAlign: 'center', whiteSpace: 'nowrap' }}>
                                          {c.image_url ? <img src={c.image_url} alt={c.plant_name} style={{ width: 22, height: 22, objectFit: 'cover', borderRadius: 3 }} /> : '—'}
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
                                          {editing ? <input defaultValue={c.plant_name} onBlur={e => updateCompraField(c, 'plant_name', e.target.value)} style={{ width: 60, fontSize: 11 }} /> : c.plant_name}
                                        </td>
                                        <td style={{ padding: 2, border: '1px solid #ddd', textAlign: 'center', whiteSpace: 'nowrap' }}>
                                          {editing ? <input type="number" defaultValue={c.quantity} onBlur={e => updateCompraField(c, 'quantity', e.target.value)} style={{ width: 34, fontSize: 11 }} /> : c.quantity}
                                        </td>
                                        <td style={{ padding: 2, border: '1px solid #ddd', textAlign: 'right', whiteSpace: 'nowrap' }}>
                                          {editing ? <input type="number" step="0.01" defaultValue={c.unit_cost} onBlur={e => updateCompraField(c, 'unit_cost', e.target.value)} style={{ width: 48, fontSize: 11 }} /> : `$${Number(c.unit_cost).toFixed(2)}`}
                                        </td>
                                        <td style={{ padding: 2, border: '1px solid #ddd', textAlign: 'right', whiteSpace: 'nowrap' }}>${c._value.toFixed(2)}</td>
                                        <td style={{ padding: 2, border: '1px solid #ddd', textAlign: 'right', whiteSpace: 'nowrap' }}>${c._prorated.toFixed(2)}</td>
                                        <td style={{ padding: 2, border: '1px solid #ddd', textAlign: 'right', whiteSpace: 'nowrap' }}>${c._lineTotal.toFixed(2)}</td>
                                        <td style={{ padding: 2, border: '1px solid #ddd', textAlign: 'center', whiteSpace: 'nowrap' }}>
                                          <StatusChecklist
                                            steps={[{ key: 'pedido', label: 'Pedido' }, { key: 'pagado', label: 'Pagado' }, { key: 'recibido', label: 'Recibido' }]}
                                            currentStatus={c.status}
                                            disabled={approvingIds.includes(c.id)}
                                            onAdvance={key => key === 'pagado' ? markCompraPagada(c) : markCompraRecibida(c)}
                                          />
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                  <tfoot>
                                    <tr><td colSpan={4} style={{ padding: '3px 2px', border: '1px solid #ddd', whiteSpace: 'nowrap' }}>Subtotal</td><td colSpan={4} style={{ padding: '3px 2px', border: '1px solid #ddd', textAlign: 'right', whiteSpace: 'nowrap' }}>${subtotal.toFixed(2)}</td></tr>
                                    <tr><td colSpan={4} style={{ padding: '3px 2px', border: '1px solid #ddd', whiteSpace: 'nowrap' }}>Envío 1</td><td colSpan={4} style={{ padding: '3px 2px', border: '1px solid #ddd', textAlign: 'right', whiteSpace: 'nowrap' }}>{editing ? <input type="number" step="0.01" defaultValue={lote.envio1 || 0} onBlur={e => updateLoteExtra(lote, 'envio1', e.target.value)} style={{ width: 70, fontSize: 11 }} /> : `$${Number(lote.envio1 || 0).toFixed(2)}`}</td></tr>
                                    <tr><td colSpan={4} style={{ padding: '3px 2px', border: '1px solid #ddd', whiteSpace: 'nowrap' }}>Envío 2</td><td colSpan={4} style={{ padding: '3px 2px', border: '1px solid #ddd', textAlign: 'right', whiteSpace: 'nowrap' }}>{editing ? <input type="number" step="0.01" defaultValue={lote.envio2 || 0} onBlur={e => updateLoteExtra(lote, 'envio2', e.target.value)} style={{ width: 70, fontSize: 11 }} /> : `$${Number(lote.envio2 || 0).toFixed(2)}`}</td></tr>
                                    <tr><td colSpan={4} style={{ padding: '3px 2px', border: '1px solid #ddd', whiteSpace: 'nowrap' }}>Varios</td><td colSpan={4} style={{ padding: '3px 2px', border: '1px solid #ddd', textAlign: 'right', whiteSpace: 'nowrap' }}>{editing ? <input type="number" step="0.01" defaultValue={lote.varios || 0} onBlur={e => updateLoteExtra(lote, 'varios', e.target.value)} style={{ width: 70, fontSize: 11 }} /> : `$${Number(lote.varios || 0).toFixed(2)}`}</td></tr>
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
            <div
              key={p.id}
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
          ))}
        </div>
      </div>
    </div>
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
