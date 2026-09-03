import React, { useEffect, useState } from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import Admin from './Admin.jsx'
import { supabase } from './supabaseClient'
import './App.css'

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
    <Root />
  </React.StrictMode>,
)
