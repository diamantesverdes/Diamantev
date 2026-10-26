import React, { useEffect, useState } from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import Admin from './Admin.jsx'
import { supabase } from './supabaseClient'
import './App.css'

// Borra el service worker y el caché guardado de la app y la carga desde cero.
// Sirve cuando la app instalada en el celular se queda con una versión vieja y la pantalla sale en blanco.
async function resetApp() {
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations()
      await Promise.all(regs.map(r => r.unregister()))
    }
    if (window.caches) {
      const keys = await window.caches.keys()
      await Promise.all(keys.map(k => window.caches.delete(k)))
    }
  } catch (e) { /* si no se puede, igual se recarga */ }
  window.location.reload()
}

function RecoveryScreen({ detail, onRetry }) {
  return (
    <div style={{ padding: 20, fontFamily: 'sans-serif', maxWidth: 520, margin: '0 auto' }}>
      <h2 style={{ color: '#b03434' }}>⚠️ La app no pudo abrirse</h2>
      <p style={{ fontSize: 14 }}>Prueba primero con “Actualizar la app”. Si sigue igual, envía una captura de este mensaje.</p>
      {detail ? (
        <pre style={{ background: '#f3ecdd', padding: 12, borderRadius: 8, fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word', border: '1px solid #d8cdb0' }}>{detail}</pre>
      ) : null}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
        <button type="button" onClick={resetApp} style={{ background: '#4a5d3a', color: '#fff', border: 'none', padding: '10px 16px', borderRadius: 6, fontWeight: 600 }}>🔄 Actualizar la app</button>
        {onRetry ? <button type="button" onClick={onRetry} style={{ padding: '10px 16px', borderRadius: 6 }}>Reintentar</button> : null}
      </div>
    </div>
  )
}

// Si algo falla al dibujar la tienda o el panel, en vez de dejar la pantalla en blanco se muestra el error
class RootErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }
  static getDerivedStateFromError(error) {
    return { error }
  }
  componentDidCatch(error, info) {
    console.error('Error al dibujar la app:', error, info)
  }
  render() {
    if (this.state.error) {
      const e = this.state.error
      return <RecoveryScreen detail={String((e && (e.stack || e.message)) || e)} onRetry={() => this.setState({ error: null })} />
    }
    return this.props.children
  }
}

function Root() {
  // Punto de partida: igual que antes, según la URL (sin cambios de comportamiento en desktop).
  const [showAdmin, setShowAdmin] = useState(() => window.location.pathname.startsWith('/admin'))

  useEffect(() => {
    // Si el propio admin pidió explícitamente ver la tienda (botón "Ver tienda"),
    // respetamos esa intención y NO lo regresamos al panel, aunque tenga sesión activa.
    const wantsStore = localStorage.getItem('diamantev_view_store') === '1'
    if (wantsStore) {
      localStorage.removeItem('diamantev_view_store')
      return
    }
    // Si ya hay una sesión de administrador guardada en este dispositivo (por ejemplo,
    // el ícono de acceso directo del celular, que siempre abre en "/" según el manifest),
    // mostramos el Admin igual, sin importar por qué URL entró.
    // Nota: en esta app solo el admin inicia sesión con Supabase — los clientes nunca
    // tienen sesión — así que esta detección es segura.
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setShowAdmin(true)
    })
  }, [])

  return showAdmin ? <Admin /> : <App />
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <RootErrorBoundary>
      <Root />
    </RootErrorBoundary>
  </React.StrictMode>,
)

// Vigilante: si pasados 8 segundos no hay nada en pantalla, se ofrece actualizar la app
setTimeout(() => {
  const root = document.getElementById('root')
  if (root && root.children.length === 0) {
    root.innerHTML = '<div style="padding:20px;font-family:sans-serif;max-width:520px;margin:0 auto"><h2 style="color:#b03434">⚠️ La app no pudo abrirse</h2><p style="font-size:14px">Toca el botón para actualizarla.</p><button id="reset-app-btn" style="background:#4a5d3a;color:#fff;border:none;padding:10px 16px;border-radius:6px;font-weight:600">🔄 Actualizar la app</button></div>'
    const btn = document.getElementById('reset-app-btn')
    if (btn) btn.onclick = resetApp
  }
}, 8000)
