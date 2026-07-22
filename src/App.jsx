import { useState, useEffect } from 'react'
import { supabase } from './supabaseClient'

const WHATSAPP_NUMBER = '593992734743'

export default function App() {
  const [plants, setPlants] = useState([])
  const [categories, setCategories] = useState([])
  const [selectedCategory, setSelectedCategory] = useState('todas')
  const [cart, setCart] = useState([])
  const [showCart, setShowCart] = useState(false)
  const [loading, setLoading] = useState(true)
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [sending, setSending] = useState(false)

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    setLoading(true)
    const { data: cats } = await supabase.from('categories').select('*').order('name')
    const { data: pls } = await supabase.from('plants').select('*').eq('active', true).order('name')
    setCategories(cats || [])
    setPlants(pls || [])
    setLoading(false)
  }

  const filteredPlants = selectedCategory === 'todas'
    ? plants
    : plants.filter(p => p.category_id === selectedCategory)

  function addToCart(plant) {
    setCart(prev => {
      const existing = prev.find(i => i.id === plant.id)
      if (existing) {
        if (existing.quantity >= plant.stock) return prev
        return prev.map(i => i.id === plant.id ? { ...i, quantity: i.quantity + 1 } : i)
      }
      return [...prev, { ...plant, quantity: 1 }]
    })
  }

  function changeQty(id, delta) {
    setCart(prev => prev
      .map(i => i.id === id ? { ...i, quantity: i.quantity + delta } : i)
      .filter(i => i.quantity > 0)
    )
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
      .insert({ customer_name: customerName, customer_phone: customerPhone, total })
      .select()
      .single()

    if (error) {
      alert('Hubo un error al registrar el pedido. Intenta de nuevo.')
      setSending(false)
      return
    }

    const items = cart.map(i => ({
      order_id: order.id,
      plant_id: i.id,
      quantity: i.quantity,
      unit_price: i.price,
    }))
    await supabase.from('order_items').insert(items)

    const lines = cart.map(i => `- ${i.name} x${i.quantity} ($${(i.price * i.quantity).toFixed(2)})`).join('%0A')
    const message = `Hola, quiero confirmar mi pedido en Jardín Diamantev:%0A%0A${lines}%0A%0ATotal: $${total.toFixed(2)}%0ANombre: ${customerName}%0ATeléfono: ${customerPhone}`
    window.open(`https://wa.me/${WHATSAPP_NUMBER}?text=${message}`, '_blank')

    setCart([])
    setCustomerName('')
    setCustomerPhone('')
    setShowCart(false)
    setSending(false)
    loadData()
  }

  return (
    <div className="app">
      <header className="header">
        <h1>Jardín Diamantev</h1>
        <button className="cart-btn" onClick={() => setShowCart(true)}>
          🛒 {cart.length > 0 && <span className="cart-badge">{cart.reduce((s, i) => s + i.quantity, 0)}</span>}
        </button>
      </header>

      <div className="categories">
        <button
          className={selectedCategory === 'todas' ? 'cat-btn active' : 'cat-btn'}
          onClick={() => setSelectedCategory('todas')}
        >
          Todas
        </button>
        {categories.map(c => (
          <button
            key={c.id}
            className={selectedCategory === c.id ? 'cat-btn active' : 'cat-btn'}
            onClick={() => setSelectedCategory(c.id)}
          >
            {c.name}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="status-msg">Cargando plantas...</p>
      ) : filteredPlants.length === 0 ? (
        <p className="status-msg">Todavía no hay plantas en esta categoría.</p>
      ) : (
        <div className="grid">
          {filteredPlants.map(plant => (
            <div key={plant.id} className="card">
              <div className="card-img">
                {plant.image_url
                  ? <img src={plant.image_url} alt={plant.name} />
                  : <div className="no-img">Sin foto</div>}
              </div>
              <div className="card-body">
                <h3>{plant.name}</h3>
                <p className="price">${Number(plant.price).toFixed(2)}</p>
                <p className={plant.stock > 0 ? 'stock' : 'stock out'}>
                  {plant.stock > 0 ? `${plant.stock} disponibles` : 'Agotado'}
                </p>
                <button
                  className="add-btn"
                  disabled={plant.stock <= 0}
                  onClick={() => addToCart(plant)}
                >
                  Agregar al carrito
                </button>
              </div>
            </div>
          ))}
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
                <input
                  placeholder="Tu nombre"
                  value={customerName}
                  onChange={e => setCustomerName(e.target.value)}
                />
                <input
                  placeholder="Tu teléfono"
                  value={customerPhone}
                  onChange={e => setCustomerPhone(e.target.value)}
                />
                <button className="checkout-btn" onClick={sendOrder} disabled={sending}>
                  {sending ? 'Enviando...' : 'Confirmar pedido por WhatsApp'}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
