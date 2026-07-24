
import { useState, useEffect } from 'react'
import { supabase } from './supabaseClient'

const ADMIN_KEY = import.meta.env.VITE_ADMIN_KEY

export default function Admin() {
  const [authed, setAuthed] = useState(false)
  const [pass, setPass] = useState('')
  const [failed, setFailed] = useState(false)

  const [mainTab, setMainTab] = useState('inventario')
  const [invSubTab, setInvSubTab] = useState('stock')
  const [catSubTab, setCatSubTab] = useState('categories')

  const [galleryFilter, setGalleryFilter] = useState('all')

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
    setCategories(cats || [])
    setPlants(pls || [])
    setOrders(ords || [])
    setCompras(comps || [])
    setDecrementos(decs || [])
    setLoading(false)
  }

  async function uploadImage(file) {
    const ext = file.name.split('.').pop()
    const fileName = `${Date.now()}.${ext}`
    const { error } = await supabase.storage.from('plant-photos').upload(fileName, file)
    if (error) { alert('Error al subir la imagen'); return null }
    const { data } = supabase.storage.from('plant-photos').getPublicUrl(fileName)
    return data.publicUrl
  }

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
      await supabase.from('compras').insert({
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
    } else {
      const plant = plants.find(p => p.id === compraForm.plant_id)
      await supabase.from('compras').insert({
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
    await supabase.from('plants').delete().eq('id', id)
    loadData()
  }

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

  return (
    <div className="admin">
      <div className="admin-header">
        <h1>Panel de administrador — Diamantev</h1>
        <a href="/" className="back-to-store">🌿 Ver tienda</a>
      </div>

      <hr className="admin-divider" />

      <div className="admin-tabs">
        <button className={mainTab === 'inventario' ? 'active' : ''} onClick={() => setMainTab('inventario')}>Inventario</button>
        <button className={mainTab === 'catalogo' ? 'active' : ''} onClick={() => setMainTab('catalogo')}>Catálogo</button>
      </div>

      {mainTab === 'inventario' && (
        <>
          <hr className="admin-divider" />
          <div className="admin-subtabs">
            <button className={invSubTab === 'stock' ? 'active' : ''} onClick={() => setInvSubTab('stock')}>Stock actual</button>
            <button className={invSubTab === 'ingresos' ? 'active' : ''} onClick={() => setInvSubTab('ingresos')}>Ingresos</button>
            <button className={invSubTab === 'movimientos' ? 'active' : ''} onClick={() => setInvSubTab('movimientos')}>Ventas y decrementos</button>
          </div>

          {invSubTab === 'stock' && (
            <>
              <h3>Plantas existentes ({plants.length})</h3>
              {loading ? <p>Cargando...</p> : (
                <div className="admin-list">
                  {plants.map(p => (
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
                          <button onClick={() => toggleActive(p.id, p.active)}>{p.active ? 'Desactivar' : 'Activar'}</button>
                          <button onClick={() => deletePlant(p.id)} className="danger">Borrar</button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {invSubTab === 'ingresos' && (
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

          {invSubTab === 'movimientos' && (
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
        </>
      )}

      {mainTab === 'catalogo' && (
       <hr className="admin-divider" />. 
      <div className="admin-subtabs">
            <button className={invSubTab === 'stock' ? 'active' : ''}
    <hr className="admin-divider" />
              <div className="admin-subtabs">
            <button className={invSubTab === 'stock' ? 'active' : ''}
              <><div className="admin-subtabs">
            <button className={invSubTab === 'stock' ? 'active' : ''}
         <hr className="admin-divider" />.
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
              <div className="gallery-grid">
                {plants
                  .filter(p => galleryFilter === 'all' || p.category_id === galleryFilter)
                  .map(p => (
                    <div key={p.id} className="gallery-item">
                      {p.image_url ? <img src={p.image_url} alt={p.name} /> : <div className="no-img-sm">Sin foto</div>}
                      <span>{p.name}</span>
                    </div>
                  ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
