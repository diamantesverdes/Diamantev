import { createClient } from '@supabase/supabase-js'
import { supabase } from './supabaseClient'

// Buscador de notas: también consulta el diario de Days (solo lectura, solo fragmentos que coinciden).
// La clave del enlace NO está en el código: se lee de la tabla "enlace_con_days" de Diamantev,
// que solo abre con la sesión del administrador. Days solo devuelve fragmentos cortos de lo que coincide.
const D_URL = String(import.meta.env.VITE_DAYS_URL || '').trim().replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '')
const D_KEY = String(import.meta.env.VITE_DAYS_ANON_KEY || '').trim()
let days = null
try {
  if (/^https?:\/\//.test(D_URL) && D_KEY) {
    days = createClient(D_URL, D_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })
  }
} catch (e) {
  console.warn('Enlace con Days apagado:', e)
}

export const daysDisponible = !!days

let claveCache = null

export async function buscarEnDays(texto) {
  if (!days) throw new Error('El enlace con Days no está configurado')
  if (!claveCache) {
    const { data, error } = await supabase.from('enlace_con_days').select('valor').eq('nombre', 'days_clave').maybeSingle()
    if (error) throw error
    if (!data || !data.valor) throw new Error('No se encontró la clave del enlace con Days')
    claveCache = data.valor
  }
  const { data, error } = await days.rpc('buscar_para_diamantev', { p_clave: claveCache, p_texto: texto })
  if (error) { claveCache = null; throw error }
  return Array.isArray(data) ? data : []
}

export function fechaDays(s) {
  const [y, m, d] = String(s || '').split('-').map(Number)
  if (!y || !m || !d) return String(s || '')
  return new Date(y, m - 1, d).toLocaleDateString('es-EC', { day: 'numeric', month: 'short', year: 'numeric' })
}
