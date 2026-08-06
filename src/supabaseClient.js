import { createClient } from '@supabase/supabase-js'

// Proyecto 1: datos (tablas) + login del admin
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
)

// Proyecto 2: solo almacenamiento de fotos y videos
export const supabaseStorage = createClient(
  import.meta.env.VITE_SUPABASE_STORAGE_URL,
  import.meta.env.VITE_SUPABASE_STORAGE_ANON_KEY
)
