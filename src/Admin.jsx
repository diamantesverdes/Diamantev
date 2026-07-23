import { useState, useEffect } from 'react'
import { supabase } from './supabaseClient'

const ADMIN_KEY = import.meta.env.VITE_ADMIN_KEY

export default function Admin() {
  const [authed, setAuthed] = useState(false)
  const [pass, setPass] = useState('')
  const [tab, setTab] = useState('plants')
  const [galleryFilter, setGalleryFilter] = useState('all')
 const [orders, setOrders] = useState([])
  const [approvingIds, setApprovingIds] = useState([])
  const [orderSearch, setOrderSearch] = useState('')
  const [orderStatusFilter, setOrderStatusFilter] = useState('all')
  const [plants, setPlants] = useState([])
  const [categories, setCategories] = useState([])
  const [loading, setLoading] = useState(true)

  const [form, setForm] = useState({
    name: '', category_id: '', description: '', price: '', stock: '', color: '', file: null,
  })
  const [saving, setSaving] = useState(false)

  useEffect(() => { if (authed) loadData() }, [authed])

  async function loadData() {
    setLoading(true)
    const { data: cats } = await supabase.from('categories').select('*').order('name')
    const { data: pls } = await supabase.from('plants').select('*').order('name')
    const { data: ords } = await supabase.from('orders').select('*, order_items(*)').order('id', { ascending: false })
    setCategories(cats || [])
    setPlants(pls || [])
    setOrders(ords || [])
    setLoading(false)
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

  

  async function uploadImage(file) {
    const ext = file.name.split('.').pop()
    const fileName = `${Date.now()}.${ext}`
    const { error } = await supabase.storage.from('plant-photos').upload(fileName, file)
    if (error) { alert('Error al subir la imagen'); return null }
    const { data } = supabase.storage.from('plant-photos').getPublicUrl(fileName)
    return data.publicUrl
  }

  async function addPlant(e) {
    e.preventDefault()
    if (!form.name || !form.category_id || !form.price) {
      alert('Nombre, categoría y precio son obligatorios')
      return
    }
    setSaving(true)
    let image_url = null
    if (form.file) image_url = await uploadImage(form.file)

    const { error } = await supabase.from('plants').insert({
      name: form.name,
      category_id: form.category_id,
      description: form.description,
      price: Number(form.price),
      stock: Number(form.stock) || 0,
      color: form.color,
      image_url,
    })
    if (error) alert('Error al guardar la planta')
    setForm({ name: '', category_id: '', description: '', price: '', stock: '', color: '', file: null })
    setSaving(false)
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
  }const [newCatName, setNewCatName] = useState('')
  const [newCatEmoji, setNewCatEmoji] = useState('🌿')

  async function addCategory(e) {
    e.preventDefault()
    if (!newCatName.trim()) return
    await supabase.from('categories').insert({ name: newCatName, emoji: newCatEmoji })
    setNewCatName('')
    setNewCatEmoji('🌿')
    loadData()
  }
  const [showPass, setShowPass] = useState(false)
  const [failed, setFailed] = useState(false)

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

  return (
    <div className="admin">
      
<div className="admin-header">
        <h1>Panel de administrador — Diamantev</h1>
        <a href="/" className="back-to-store">🌿 Ver tienda</a>
      </div>
      <div className="admin-tabs">
        <button className={tab === 'plants' ? 'active' : ''} onClick={() => setTab('plants')}>Plantas</button>
        <button className={tab === 'categories' ? 'active' : ''} onClick={() => setTab('categories')}>Categorías</button>
        <button className={tab === 'gallery' ? 'active' : ''} onClick={() => setTab('gallery')}>Catálogo</button>
        <button className={tab === 'orders' ? 'active' : ''} onClick={() => setTab('orders')}>Ventas</button>
      </div>

      {tab === 'plants' && (
        <>
          <form className="admin-form" onSubmit={addPlant}>
            <h3>Agregar planta nueva</h3>
            <input placeholder="Nombre" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
            <select value={form.category_id} onChange={e => setForm({ ...form, category_id: e.target.value })}>
              <option value="">Selecciona categoría</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <textarea placeholder="Descripción" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
            <input placeholder="Precio" type="number" step="0.01" value={form.price} onChange={e => setForm({ ...form, price: e.target.value })} />
            <input placeholder="Cantidad en stock" type="number" value={form.stock} onChange={e => setForm({ ...form, stock: e.target.value })} />
            <input placeholder="Color" value={form.color} onChange={e => setForm({ ...form, color: e.target.value })} />
            <input type="file" accept="image/*" onChange={e => setForm({ ...form, file: e.target.files[0] })} />
            <button type="submit" disabled={saving}>{saving ? 'Guardando...' : 'Agregar planta'}</button>
          </form>

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

      {tab === 'categories' && (
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
    {tab === 'gallery' && (
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
    {tab === 'orders' && (
        <>
          <input
            className="order-search"
            placeholder="Buscar por nombre de cliente..."
            value={orderSearch}
            onChange={e => setOrderSearch(e.target.value)}
          />
          <select className="gallery-select" value={orderStatusFilter} onChange={e => setOrderStatusFilter(e.target.value)}>
            <option value="all">Todos los estados</option>
            <option value="pedido">Pedido</option>
            <option value="pagado">Pagado</option>
            <option value="entregado">Entregado</option>
          </select>
          <div className="admin-list">
            {orders
              .filter(o => orderStatusFilter === 'all' || o.status === orderStatusFilter)
              .filter(o => o.customer_name.toLowerCase().includes(orderSearch.toLowerCase()))
              .length === 0 && (
              <p className="status-msg">No se encontraron ventas.</p>
            )}
            {orders
              .filter(o => orderStatusFilter === 'all' || o.status === orderStatusFilter)
              .filter(o => o.customer_name.toLowerCase().includes(orderSearch.toLowerCase()))
              .map(o => (
                <div key={o.id} className="admin-item">
                  <div className="admin-item-info">
                    <strong>{o.customer_name}</strong>
                    <span>{o.customer_phone}</span>
                    <span className={`order-badge order-${o.status}`}>{o.status}</span>
                    <span>Pedido: {new Date(o.created_at).toLocaleDateString()}</span>
                    {o.fecha_pago && <span>Pagado: {new Date(o.fecha_pago).toLocaleDateString()}</span>}
                    {o.fecha_entrega && <span>Entregado: {new Date(o.fecha_entrega).toLocaleDateString()}</span>}
                    {(o.order_items || []).map(it => {
                      const plant = plants.find(p => p.id === it.plant_id)
                      return <span key={it.id}>{plant ? plant.name : 'Planta'} x{it.quantity}</span>
                    })}
                    <span>Total: ${Number(o.total).toFixed(2)}</span>
                    <div className="admin-item-actions">
                      {o.status === 'pedido' && (
                        <button onClick={() => markAsPaid(o)} disabled={approvingIds.includes(o.id)}>
                          {approvingIds.includes(o.id) ? 'Procesando...' : 'Marcar como pagado'}
                        </button>
                      )}
                      {o.status === 'pagado' && (
                        <button onClick={() => markAsDelivered(o)} disabled={approvingIds.includes(o.id)}>
                          {approvingIds.includes(o.id) ? 'Procesando...' : 'Marcar como entregado'}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
          </div>
        </>
      )}
    </div>

    
  )
}
