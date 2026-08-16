// offlineQueue.js — cola de acciones pendientes para cuando no hay conexión
const DB_NAME = 'diamantev-offline'
const STORE = 'queue'

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function addToQueue(type, payload, file = null) {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    const store = tx.objectStore(STORE)
    const entry = { type, payload, file, createdAt: Date.now() }
    const req = store.add(entry)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function getQueue() {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).getAll()
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function removeFromQueue(id) {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    const req = tx.objectStore(STORE).delete(id)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  })
}

export async function queueLength() {
  const items = await getQueue()
  return items.length
}

// Procesa la cola en orden. `handlers` es un objeto { tipo: async (payload, file) => {} }
// Si una acción falla, se detiene y deja el resto para el próximo intento.
export async function processQueue(handlers, onProgress) {
  const items = await getQueue()
  items.sort((a, b) => a.createdAt - b.createdAt)
  for (const item of items) {
    try {
      const handler = handlers[item.type]
      if (handler) await handler(item.payload, item.file)
      await removeFromQueue(item.id)
      if (onProgress) onProgress()
    } catch (err) {
      console.error('Error sincronizando acción pendiente:', err)
      break
    }
  }
}

export function isOnline() {
  return navigator.onLine
}
