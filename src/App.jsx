import { useState, useEffect } from 'react'
import { supabase } from './supabaseClient'

const WHATSAPP_NUMBER = '593992734743'

// Reseñas de ejemplo — reemplázalas por las reales cuando las tengas
const TESTIMONIALS = [
  { name: 'Clarita C.', text: 'Las plantas llegaron hermosas y bien empacadas. ¡Superó mis expectativas!', stars: 5 },
  { name: 'Marco V.', text: 'Excelente atención por WhatsApp y variedad increíble de iris.', stars: 5 },
  { name: 'Sofía R.', text: 'Mi jardín cambió por completo desde que compro en Diamantev.', stars: 5 },
]

export default function App() {
  const [view, setView] = useState('categories')
  const [plants, setPlants] = useState([])
  const [categories, setCategories] = useState([])
  const [selectedCategory, setSelectedCategory] = useState(null)
  const [stockFilter, setStockFilter] = useState('all') // 'all' | 'available'
  const [cart, setCart] = useState([])
  const [showCart, setShowCart] = useState(false)
  const [favorites, setFavorites] = useState([])
  const [showFavorites, setShowFavorites] = useState(false)
  const [loading, setLoading] = useState(true)
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [sending, setSending] = useState(false)
  const [toast, setToast] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  useEffect(() => { loadData() }, [])

  async function loadData() {
    setLoading(true)
    const { data: cats } = await supabase.from('categories').select('*').order('name')
    const { data: pls } = await supabase.from('plants').select('*').eq('active', true).order('name')
    setCategories(cats || [])
    setPlants(pls || [])
    setLoading(false)
  }

  function openCategory(cat) {
    setSelectedCategory(cat)
    setStockFilter('all')
    setSearchQuery('')
    setSearchOpen(false)
    setMenuOpen(false)
    setView('plants')
  }

  function openAllPlants() {
    setSelectedCategory(null)
    setStockFilter('all')
    setSearchQuery('')
    setSearchOpen(false)
    setMenuOpen(false)
    setView('plants')
  }

  function openAvailablePlants() {
    setSelectedCategory(null)
    setStockFilter('available')
    setSearchQuery('')
    setSearchOpen(false)
    setMenuOpen(false)
    setView('plants')
  }

  function backToCategories() {
    setView('categories')
    setSelectedCategory(null)
    setStockFilter('all')
    setSearchQuery('')
  }

  const isSearching = searchQuery.trim().length > 0

  const filteredPlants = isSearching
    ? plants.filter(p => p.name.toLowerCase().includes(searchQuery.trim().toLowerCase()))
    : plants
        .filter(p => !selectedCategory || p.category_id === selectedCategory.id)
        .filter(p => stockFilter === 'available' ? p.stock > 0 : stockFilter === 'sale' ? p.on_sale : true)

  const newPlants = plants.filter(p => p.is_new)
  const salePlants = plants.filter(p => p.on_sale)

  function addToCart(plant) {
    setCart(prev => {
      const existing = prev.find(i => i.id === plant.id)
      if (existing) {
        if (existing.quantity >= plant.stock) return prev
        return prev.map(i => i.id === plant.id ? { ...i, quantity: i.quantity + 1 } : i)
      }
      return [...prev, { ...plant, quantity: 1 }]
    })
    setToast(`✅ ${plant.name} añadida al carrito`)
    setTimeout(() => setToast(''), 1800)
  }

  function changeQty(id, delta) {
    setCart(prev => prev
      .map(i => i.id === id ? { ...i, quantity: i.quantity + delta } : i)
      .filter(i => i.quantity > 0)
    )
  }

  function toggleFavorite(plant) {
    setFavorites(prev => {
      const exists = prev.some(f => f.id === plant.id)
      if (exists) return prev.filter(f => f.id !== plant.id)
      return [...prev, plant]
    })
  }

  function isFavorite(id) {
    return favorites.some(f => f.id === id)
  }

  function sendFavorites() {
    if (favorites.length === 0) return
    const lines = favorites.map(f => `- ${f.name}`).join('%0A')
    const message = `Hola, me interesan estas plantas de Diamantev:%0A%0A${lines}`
    window.open(`https://wa.me/${WHATSAPP_NUMBER}?text=${message}`, '_blank')
  }

  const total = cart.reduce((sum, i) => sum + i.price * i.quantity, 0)

  async function sendOrder() {
    if (!customerName.trim() || !customerPhone.trim()) {
      alert('Por favor ingresa tu nombre y teléfono')
      return
    }
    if (cart.length === 0) return
    setSending(true)
    const { data: order, error } = await supabase
      .from('orders')
      .insert({ customer_name: customerName, customer_phone: customerPhone, total, status: 'pedido' })
      .select()
      .single()
    if (error) {
      alert('Hubo un error al registrar el pedido. Intenta de nuevo.')
      setSending(false)
      return
    }
    const items = cart.map(i => ({
      order_id: order.id, plant_id: i.id, quantity: i.quantity, unit_price: i.price,
    }))
    await supabase.from('order_items').insert(items)
    for (const item of cart) {
      await supabase
        .from('plants')
        .update({ stock: item.stock - item.quantity })
        .eq('id', item.id)
    }
    const lines = cart.map(i => `- ${i.name} x${i.quantity} ($${(i.price * i.quantity).toFixed(2)})`).join('%0A')
    const message = `Hola, quiero confirmar mi pedido en 
  Diamantev:%0A%0A${lines}%0A%0ATotal: $${total.toFixed(2)}%0ANombre: ${customerName}%0ATeléfono: ${customerPhone}`
    window.open(`https://wa.me/${WHATSAPP_NUMBER}?text=${message}`, '_blank')
    setCart([])
    setCustomerName('')
    setCustomerPhone('')
    setShowCart(false)
    setSending(false)
    loadData()
  }

  function renderPlantCard(plant) {
    return (
      <div key={plant.id} className="card">
       <div className="card-img">
          {plant.image_url ? <img src={plant.image_url} alt={plant.name} /> : <div className="no-img">Sin foto</div>}
          {plant.is_new && <span className="new-badge">Nueva</span>}
          {plant.on_sale && <span className="sale-badge">Descuento</span>}
        </div>
        <div className="card-body">
          <h3>{plant.name}</h3>
          <p className="price">${Number(plant.price).toFixed(2)}</p>
          <p className={plant.stock > 0 ? 'stock' : 'stock out'}>
            {plant.stock > 0 ? `${plant.stock} disponibles` : 'Agotado'}
          </p>
          <div className="card-actions">
           <button className="cart-icon-btn" disabled={plant.stock <= 0} onClick={() => addToCart(plant)} aria-label="Agregar al carrito">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="9" cy="21" r="1"/>
                <circle cx="20" cy="21" r="1"/>
                <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>
              </svg>
            </button>
            <button
              className={`heart-icon-btn ${isFavorite(plant.id) ? 'active' : ''}`}
              onClick={() => toggleFavorite(plant)}
              aria-label="Agregar a mi lista"
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill={isFavorite(plant.id) ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
                <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z"/>
              </svg>
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="app">

      {/* ---------- FRANJA SUPERIOR ---------- */}
     <div className="site-header">
        <button className="header-icon-btn" onClick={() => setMenuOpen(true)} aria-label="Menú">☰</button>
        <div className="header-icons">
          <button className="header-icon-btn" onClick={() => setShowFavorites(true)} aria-label="Mi lista">
            ❤️ {favorites.length > 0 && <span className="cart-badge">{favorites.length}</span>}
          </button>
          <button className="header-icon-btn" onClick={() => setSearchOpen(v => !v)} aria-label="Buscar">🔍</button>
          <button className="header-icon-btn" onClick={() => setShowCart(true)} aria-label="Carrito">
            🛒 {cart.length > 0 && <span className="cart-badge">{cart.reduce((s, i) => s + i.quantity, 0)}</span>}
          </button>
        </div>
      </div>

      <div className="brand-banner" />

      {searchOpen && (
        <div className="search-bar">
          <input
            autoFocus
            placeholder="Buscar planta por nombre..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
        </div>
      )}

      <div className="site-summary">
        <p>🌿 Vivero de plantas ornamentales en Ecuador - Quito </p>
        <p>🚚 Coordinamos entrega directo por WhatsApp</p>
        <p>💎 Cada planta es una joya viva</p>
      </div>

      {salePlants.length > 0 && (
        <div className="promo-banner sale-banner">
          <span>🏷️ ¡{salePlants.length === 1 ? 'Planta en descuento' : `${salePlants.length} plantas en descuento`}! Escríbenos para conocer los precios</span>
          <a href={`https://wa.me/${WHATSAPP_NUMBER}`} target="_blank" rel="noreferrer" className="promo-btn">Ver ofertas</a>
        </div>
      )}

      <div className="promo-banner">
        <span>🌸 Escríbenos por WhatsApp y recibe asesoría gratis para tu jardín</span>
        <a href={`https://wa.me/${WHATSAPP_NUMBER}`} target="_blank" rel="noreferrer" className="promo-btn">Escribir ahora</a>
      </div>

      {menuOpen && (
        <div className="cart-overlay" onClick={() => setMenuOpen(false)}>
          <div className="cart-panel" onClick={e => e.stopPropagation()}>
            <div className="cart-header">
              <h2>Menú</h2>
              <button onClick={() => setMenuOpen(false)}>✕</button>
            </div>
            <div className="menu-list">
              <button className="menu-item" onClick={openAllPlants}>🪴 Ver todas las plantas</button>
              <button className="menu-item" onClick={openAvailablePlants}>✅ Solo disponibles</button>
              {categories.map(cat => (
                <button key={cat.id} className="menu-item" onClick={() => openCategory(cat)}>
                  {cat.emoji || '🌿'} {cat.name}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
<a
      className="whatsapp-fab"
  href={`https://wa.me/${WHATSAPP_NUMBER}`}
  target="_blank"
  rel="noreferrer"
  aria-label="Escríbenos por WhatsApp"
>
  <svg viewBox="0 0 32 32" width="28" height="28" fill="#fff">
    <path d="M16.004 3C9.377 3 4 8.377 4 15.004c0 2.65.87 5.1 2.35 7.09L4.5 28l6.09-1.8a11.94 11.94 0 0 0 5.414 1.3h.005c6.627 0 12.004-5.377 12.004-12.004C28.013 8.377 22.636 3 16.004 3zm0 21.6a9.55 9.55 0 0 1-4.87-1.34l-.35-.207-3.61 1.07 1.08-3.52-.227-.36a9.56 9.56 0 0 1-1.47-5.12c0-5.293 4.31-9.6 9.6-9.6 5.293 0 9.6 4.31 9.6 9.6s-4.307 9.6-9.6 9.6zm5.29-7.19c-.29-.145-1.71-.845-1.976-.94-.266-.097-.46-.145-.653.145s-.75.94-.92 1.135c-.17.195-.34.218-.63.073-.29-.145-1.224-.451-2.332-1.437-.862-.769-1.444-1.72-1.614-2.01-.17-.29-.018-.447.127-.592.13-.13.29-.34.435-.51.145-.17.193-.29.29-.485.096-.194.048-.364-.024-.51-.073-.145-.653-1.575-.895-2.158-.236-.567-.477-.49-.653-.5-.169-.008-.363-.01-.557-.01-.194 0-.51.073-.777.363-.266.29-1.017.994-1.017 2.424 0 1.43 1.041 2.812 1.186 3.006.145.194 2.05 3.13 4.966 4.39.694.3 1.235.48 1.657.615.696.222 1.33.19 1.83.115.558-.083 1.71-.7 1.95-1.376.24-.677.24-1.257.169-1.376-.07-.12-.264-.194-.554-.34z"/>
  </svg>
</a>

      {isSearching ? (
        <>
          <h2 className="plants-title">Resultados para "{searchQuery}"</h2>
          {filteredPlants.length === 0 ? (
            <p className="status-msg">No encontramos plantas con ese nombre.</p>
          ) : (
            <div className="grid">{filteredPlants.map(renderPlantCard)}</div>
          )}
        </>
      ) : view === 'categories' ? (
        <>
          {loading ? (
            <p className="status-msg">Cargando...</p>
          ) : (
            <>
              <div className="section-title">
                <span className="section-script">Comprar por categoría</span>
              </div>
              <div className="shop-category-grid">
                <div className="shop-cat-card" onClick={openAllPlants}>
                  <div className="shop-cat-circle shop-cat-circle-all">🪴</div>
                  <span>Todas</span>
                </div>
                <div className="shop-cat-card" onClick={openAvailablePlants}>
                  <div className="shop-cat-circle shop-cat-circle-all">✅</div>
                  <span>Disponibles</span>
                </div>
                {categories.map(cat => (
                  <div key={cat.id} className="shop-cat-card" onClick={() => openCategory(cat)}>
                    <div className="shop-cat-circle">
                      {cat.image_url ? <img src={cat.image_url} alt={cat.name} /> : <span>{cat.emoji || '🌿'}</span>}
                    </div>
                    <span>{cat.name}</span>
                  </div>
                ))}
              </div>

              {newPlants.length > 0 && (
                <>
                  <div className="section-title">
                    <span className="section-script">Lo nuevo</span>
                  </div>
                  <div className="carousel-row">
                    {newPlants.map(plant => (
                      <div key={plant.id} className="carousel-card">
                        {plant.image_url ? <img src={plant.image_url} alt={plant.name} /> : <div className="no-img">Sin foto</div>}
                        <p className="carousel-name">{plant.name}</p>
                        <p className="price">${Number(plant.price).toFixed(2)}</p>
                      </div>
                    ))}
                  </div>
                </>
              )}

              <div className="section-title">
                <span className="section-script">Lo que dicen nuestros clientes</span>
              </div>
              <div className="carousel-row testimonial-row">
                {TESTIMONIALS.map((t, i) => (
                  <div key={i} className="testimonial-card">
                    <p className="testimonial-stars">{'⭐'.repeat(t.stars)}</p>
                    <p className="testimonial-text">"{t.text}"</p>
                    <p className="testimonial-name">— {t.name}</p>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      ) : (
        <>
        <button className="back-btn" onClick={backToCategories}>← Volver a categorías</button>
          <h2 className="plants-title">
            {selectedCategory
              ? `${selectedCategory.emoji || ''} ${selectedCategory.name}`
              : stockFilter === 'available' ? '✅ Plantas disponibles' : 'Todas las plantas'}
          </h2>
          <div className="stock-filter-row">
            <button className={stockFilter === 'all' ? 'active' : ''} onClick={() => setStockFilter('all')}>Todas</button>
            <button className={stockFilter === 'available' ? 'active' : ''} onClick={() => setStockFilter('available')}>✅ Disponibles</button>
            <button className={stockFilter === 'sale' ? 'active' : ''} onClick={() => setStockFilter('sale')}>🏷️ En oferta</button>
          </div>
          {filteredPlants.length === 0 ? (
            <p className="status-msg">Todavía no hay plantas en esta categoría.</p>
          ) : (
            <div className="grid">{filteredPlants.map(renderPlantCard)}</div>
          )}
        </>
      )}

      {showFavorites && (
        <div className="cart-overlay" onClick={() => setShowFavorites(false)}>
          <div className="cart-panel" onClick={e => e.stopPropagation()}>
            <div className="cart-header">
              <h2>Mi lista</h2>
              <button onClick={() => setShowFavorites(false)}>✕</button>
            </div>
            {favorites.length === 0 ? (
              <p className="status-msg">Todavía no has agregado plantas a tu lista</p>
            ) : (
              <>
                {favorites.map(item => (
                  <div key={item.id} className="cart-item">
                    <span>{item.name}</span>
                    <button onClick={() => toggleFavorite(item)}>✕</button>
                  </div>
                ))}
                <button className="checkout-btn" onClick={sendFavorites}>
                  💬 Enviar lista por WhatsApp
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {showCart && (
        <div className="cart-overlay" onClick={() => setShowCart(false)}>
          <div className="cart-panel" onClick={e => e.stopPropagation()}>
            <div className="cart-header">
              <h2>Tu carrito</h2>
              <button onClick={() => setShowCart(false)}>✕</button>
            </div>
            {cart.length === 0 ? (
              <p className="status-msg">Tu carrito está vacío</p>
            ) : (
              <>
                {cart.map(item => (
                  <div key={item.id} className="cart-item">
                    <span>{item.name}</span>
                    <div className="qty-controls">
                      <button onClick={() => changeQty(item.id, -1)}>-</button>
                      <span>{item.quantity}</span>
                      <button onClick={() => changeQty(item.id, 1)} disabled={item.quantity >= item.stock}>+</button>
                    </div>
                    <span>${(item.price * item.quantity).toFixed(2)}</span>
                  </div>
                ))}
                <p className="cart-total">Total: ${total.toFixed(2)}</p>
                <input placeholder="Tu nombre" value={customerName} onChange={e => setCustomerName(e.target.value)} />
                <input placeholder="Tu teléfono" value={customerPhone} onChange={e => setCustomerPhone(e.target.value)} />
                <button className="checkout-btn" onClick={sendOrder} disabled={sending}>
                  {sending ? 'Enviando...' : 'Confirmar pedido por WhatsApp'}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      <footer className="site-footer">
        <span className="footer-script">_______________________</span>
        <p className="footer-tagline">Vivero de plantas ornamentales </p>
        <p className="footer-whatsapp">
          WhatsApp: <a href={`https://wa.me/${WHATSAPP_NUMBER}`} target="_blank" rel="noreferrer">0992734743</a>
        </p>
        <p className="footer-copy">© 2026 Diamantev</p>
      </footer>
    </div>
  )
}
