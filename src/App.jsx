import { useState, useEffect } from 'react'
import { supabase, supabaseStorage } from './supabaseClient'

export default function App() {
  // ---------- Lista compartida pública (sin login) ----------
  const sharedListId = new URLSearchParams(window.location.search).get('list')
  const [sharedList, setSharedList] = useState(null)
  const [sharedItems, setSharedItems] = useState([])
  const [sharedLoading, setSharedLoading] = useState(true)
  const [sharedNewItemText, setSharedNewItemText] = useState('')

  useEffect(() => {
    if (!sharedListId) return
    loadSharedList()
  }, [sharedListId])

  useEffect(() => {
    setPendingSync(getOfflineQueue().length)
    const goOnline = () => { setIsOffline(false); flushOfflineQueue() }
    const goOffline = () => setIsOffline(true)
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [])

  async function loadSharedList() {
    setSharedLoading(true)
    const { data: list } = await supabase.from('shopping_lists').select('*').eq('id', sharedListId).single()
    const { data: items } = await supabase.from('shopping_list_items').select('*').eq('list_id', sharedListId).order('created_at')
    setSharedList(list || null)
    setSharedItems(items || [])
    setSharedLoading(false)
  }

  async function sharedAddItem(e) {
    e.preventDefault()
    if (!sharedNewItemText.trim()) return
    await supabase.from('shopping_list_items').insert({ list_id: sharedListId, content: sharedNewItemText })
    setSharedNewItemText('')
    loadSharedList()
  }

  async function sharedToggleItem(item) {
    await supabase.from('shopping_list_items').update({ done: !item.done }).eq('id', item.id)
    loadSharedList()
  }

  // ---------- Autenticación ----------
  const [authed, setAuthed] = useState(false)
  const [checkingSession, setCheckingSession] = useState(true)
  const [isOffline, setIsOffline] = useState(!navigator.onLine)
  const [pendingSync, setPendingSync] = useState(0)
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

  // ---------- Calendario / Diario ----------
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState('calendario')
  const [mainMenuOpen, setMainMenuOpen] = useState(false)
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem('days-dark-mode') === '1')
  const [calendarSubmenuOpen, setCalendarSubmenuOpen] = useState(false)
  const [dayTags, setDayTags] = useState([])
  const [visibleTagIds, setVisibleTagIds] = useState([])
  const [expandedFilterGroup, setExpandedFilterGroup] = useState(null)
  const [quickAddToast, setQuickAddToast] = useState('')
  const [dayEntries, setDayEntries] = useState([])
  const [quickNotes, setQuickNotes] = useState([])
  const [shoppingLists, setShoppingLists] = useState([])
  const [waterGlasses, setWaterGlasses] = useState(0)
  const [openListId, setOpenListId] = useState(null)
  const [listItemsByList, setListItemsByList] = useState({})
  const [newListTitle, setNewListTitle] = useState('')
  const [newListColor, setNewListColor] = useState('#FDE68A')
  const [newListItemText, setNewListItemText] = useState('')
  const [creatingList, setCreatingList] = useState(false)
  const [newTaskText, setNewTaskText] = useState('')
  const [newTaskTagId, setNewTaskTagId] = useState('')
  const [newTaskDate, setNewTaskDate] = useState('')
  const [noteFolderFilter, setNoteFolderFilter] = useState('all')
  const [movingNoteId, setMovingNoteId] = useState(null)
  const [colorPickerForTag, setColorPickerForTag] = useState(null)
  const [newFolderInput, setNewFolderInput] = useState('')
  const [quickNoteModalOpen, setQuickNoteModalOpen] = useState(false)
  const [editingQuickNoteId, setEditingQuickNoteId] = useState(null)
  const [quickNoteTitle, setQuickNoteTitle] = useState('')
  const [quickNoteColor, setQuickNoteColor] = useState('#FDE68A')
  const [quickNoteBlocks, setQuickNoteBlocks] = useState([])
  const [quickNoteCurrentText, setQuickNoteCurrentText] = useState('')
  const [savingQuickNote, setSavingQuickNote] = useState(false)
  const [calendarMonth, setCalendarMonth] = useState(() => { const d = new Date(); d.setDate(1); return d })
  const [selectedDay, setSelectedDay] = useState(null)
  const [dayModalOpen, setDayModalOpen] = useState(false)
  const [newTagForm, setNewTagForm] = useState({ name: '', color: '#FDE68A', parent_id: '', kind: 'principal' })
  const [taskFormOpen, setTaskFormOpen] = useState(false)
  const [editingSeriesId, setEditingSeriesId] = useState(null)
  const [taskSearch, setTaskSearch] = useState('')
  const [taskSearchSubmitted, setTaskSearchSubmitted] = useState('')
  const [freeNoteModalOpen, setFreeNoteModalOpen] = useState(false)
  const [editingTaskId, setEditingTaskId] = useState(null)
  const [tagMenuOpen, setTagMenuOpen] = useState(false)
  const [freeNoteBlocks, setFreeNoteBlocks] = useState([])
  const [freeNoteCurrentText, setFreeNoteCurrentText] = useState('')
  const [savingFreeNote, setSavingFreeNote] = useState(false)
  const [taskForm, setTaskForm] = useState({ tag_id: '', date: '', note: '', repeat: 'weekly', customDays: '' })
  const [sharingNotes, setSharingNotes] = useState(false)

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

  useEffect(() => { if (authed) { loadData(); if (navigator.onLine) flushOfflineQueue() } }, [authed])

  function getOfflineQueue() {
    try { return JSON.parse(localStorage.getItem('days_offline_queue') || '[]') } catch { return [] }
  }
  function setOfflineQueueStorage(q) {
    localStorage.setItem('days_offline_queue', JSON.stringify(q))
    setPendingSync(q.length)
  }
  function queueOfflineOp(op) {
    const q = getOfflineQueue()
    q.push(op)
    setOfflineQueueStorage(q)
  }
  async function flushOfflineQueue() {
    let q = getOfflineQueue()
    if (q.length === 0) return
    while (q.length > 0) {
      const op = q[0]
      try {
        let query = supabase.from(op.table)
        if (op.action === 'insert') {
          await query.insert(op.payload)
        } else if (op.action === 'update') {
          let u = query.update(op.payload)
          for (const [k, v] of Object.entries(op.match || {})) u = u.eq(k, v)
          if (op.matchGte) for (const [k, v] of Object.entries(op.matchGte)) u = u.gte(k, v)
          await u
        } else if (op.action === 'delete') {
          let d = query.delete()
          for (const [k, v] of Object.entries(op.match || {})) d = d.eq(k, v)
          if (op.matchGte) for (const [k, v] of Object.entries(op.matchGte)) d = d.gte(k, v)
          await d
        }
        q = q.slice(1)
        setOfflineQueueStorage(q)
      } catch (err) {
        return
      }
    }
    loadData()
  }

  async function loadData() {
    setLoading(true)
    const { data: tags } = await supabase.from('day_tags').select('*').order('created_at')
    const { data: entries } = await supabase.from('day_entries').select('*').order('date')
    const { data: notes } = await supabase.from('quick_notes').select('*').order('created_at', { ascending: false })
    const { data: lists } = await supabase.from('shopping_lists').select('*').order('created_at', { ascending: false })
    const { data: water } = await supabase.from('water_tracker').select('*').eq('date', formatDateStr(new Date())).maybeSingle()
    setDayTags(tags || [])
    setDayEntries(entries || [])
    setQuickNotes(notes || [])
    setShoppingLists(lists || [])
    setWaterGlasses(water?.glasses || 0)
    setLoading(false)
  }

  async function setWaterCount(n) {
    setWaterGlasses(n)
    await supabase.from('water_tracker').upsert({ date: formatDateStr(new Date()), glasses: n }, { onConflict: 'date' })
  }

  async function loadListItems(listId) {
    if (!navigator.onLine) return
    const { data } = await supabase.from('shopping_list_items').select('*').eq('list_id', listId).order('created_at')
    setListItemsByList(prev => ({ ...prev, [listId]: data || [] }))
  }

  async function createShoppingList(e) {
    e.preventDefault()
    if (!newListTitle.trim()) return
    if (!navigator.onLine) {
      const localId = crypto.randomUUID()
      const payload = { id: localId, title: newListTitle, color: newListColor }
      setShoppingLists(prev => [{ ...payload, created_at: new Date().toISOString() }, ...prev])
      queueOfflineOp({ table: 'shopping_lists', action: 'insert', payload })
      setNewListTitle('')
      setOpenListId(localId)
      setListItemsByList(prev => ({ ...prev, [localId]: [] }))
      return
    }
    setCreatingList(true)
    const { data, error } = await supabase.from('shopping_lists').insert({ title: newListTitle, color: newListColor }).select().single()
    setCreatingList(false)
    if (error) { alert('Error al crear la lista: ' + error.message); return }
    setNewListTitle('')
    await loadData()
    setOpenListId(data.id)
    setListItemsByList(prev => ({ ...prev, [data.id]: [] }))
  }

  async function deleteShoppingList(list) {
    if (!confirm(`¿Borrar la lista "${list.title}" y todos sus artículos?`)) return
    setShoppingLists(prev => prev.filter(l => l.id !== list.id))
    if (openListId === list.id) setOpenListId(null)
    if (!navigator.onLine) {
      queueOfflineOp({ table: 'shopping_lists', action: 'delete', match: { id: list.id } })
      return
    }
    await supabase.from('shopping_lists').delete().eq('id', list.id)
    loadData()
  }

  async function addListItem(listId) {
    if (!newListItemText.trim()) return
    if (!navigator.onLine) {
      const localId = crypto.randomUUID()
      const payload = { id: localId, list_id: listId, content: newListItemText, done: false }
      setListItemsByList(prev => ({ ...prev, [listId]: [...(prev[listId] || []), payload] }))
      queueOfflineOp({ table: 'shopping_list_items', action: 'insert', payload })
      setNewListItemText('')
      return
    }
    const { error } = await supabase.from('shopping_list_items').insert({ list_id: listId, content: newListItemText })
    if (error) { alert('Error al agregar: ' + error.message); return }
    setNewListItemText('')
    loadListItems(listId)
  }

  async function toggleListItem(item) {
    const newDone = !item.done
    setListItemsByList(prev => ({ ...prev, [item.list_id]: (prev[item.list_id] || []).map(i => i.id === item.id ? { ...i, done: newDone } : i) }))
    if (!navigator.onLine) {
      queueOfflineOp({ table: 'shopping_list_items', action: 'update', payload: { done: newDone }, match: { id: item.id } })
      return
    }
    await supabase.from('shopping_list_items').update({ done: newDone }).eq('id', item.id)
    loadListItems(item.list_id)
  }

  async function deleteListItem(item) {
    setListItemsByList(prev => ({ ...prev, [item.list_id]: (prev[item.list_id] || []).filter(i => i.id !== item.id) }))
    if (!navigator.onLine) {
      queueOfflineOp({ table: 'shopping_list_items', action: 'delete', match: { id: item.id } })
      return
    }
    await supabase.from('shopping_list_items').delete().eq('id', item.id)
    loadListItems(item.list_id)
  }

  function shareShoppingList(list) {
    const url = `${window.location.origin}${window.location.pathname}?list=${list.id}`
    const message = encodeURIComponent(`🛒 Te comparto la lista "${list.title}" en Days, puedes ver y agregar cosas aquí: ${url}`)
    window.open(`https://wa.me/?text=${message}`, '_blank')
  }

  async function uploadFile(file, bucket = 'day-notes') {
    const ext = file.name.split('.').pop()
    const fileName = `${Date.now()}.${ext}`
    const { error } = await supabaseStorage.storage.from(bucket).upload(fileName, file)
    if (error) { alert('Error al subir el archivo'); return null }
    const { data } = supabaseStorage.storage.from(bucket).getPublicUrl(fileName)
    return data.publicUrl
  }

  // ---------- Login / recuperación ----------
  async function handleLogin(e) {
    e.preventDefault()
    setLoggingIn(true)
    setFailed(false)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setFailed(true)
    setLoggingIn(false)
  }

  async function handleLogout() {
    await supabase.auth.signOut()
  }

  function toggleDarkMode() {
    setDarkMode(prev => {
      localStorage.setItem('days-dark-mode', prev ? '0' : '1')
      return !prev
    })
  }

  function exportBackup() {
    const backup = {
      exportado_el: new Date().toISOString(),
      etiquetas: dayTags,
      entradas: dayEntries,
      notas_rapidas: quickNotes,
    }
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `days-respaldo-${formatDateStr(new Date())}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  async function handleForgotPassword(e) {
    e.preventDefault()
    if (!resetEmail.trim()) return
    setSendingReset(true)
    const { error } = await supabase.auth.resetPasswordForEmail(resetEmail, {
      redirectTo: window.location.origin + window.location.pathname,
    })
    setSendingReset(false)
    if (error) { alert('Error al enviar el correo: ' + error.message); return }
    setResetSent(true)
  }

  async function handleUpdatePassword(e) {
    e.preventDefault()
    if (!newPassword.trim()) return
    setUpdatingPassword(true)
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    setUpdatingPassword(false)
    if (error) { alert('Error al actualizar la contraseña: ' + error.message); return }
    setNewPassword('')
    setRecoveryMode(false)
    alert('Contraseña actualizada. Ya puedes usarla la próxima vez que entres.')
  }

  // ---------- Etiquetas ----------
  async function deleteQuickNote(id) {
    if (!confirm('¿Borrar esta nota?')) return
    setQuickNotes(prev => prev.filter(n => n.id !== id))
    if (!navigator.onLine) {
      queueOfflineOp({ table: 'quick_notes', action: 'delete', match: { id } })
      return
    }
    await supabase.from('quick_notes').delete().eq('id', id)
    loadData()
  }

  async function moveQuickNoteToFolder(id, folder) {
    setQuickNotes(prev => prev.map(n => n.id === id ? { ...n, folder: folder || null } : n))
    setMovingNoteId(null)
    setNewFolderInput('')
    if (!navigator.onLine) {
      queueOfflineOp({ table: 'quick_notes', action: 'update', payload: { folder: folder || null }, match: { id } })
      return
    }
    await supabase.from('quick_notes').update({ folder: folder || null }).eq('id', id)
    loadData()
  }

  // ---------- Editor de página completa para notas rápidas ----------
  function openNewQuickNote() {
    setEditingQuickNoteId(null)
    setQuickNoteTitle('')
    setQuickNoteColor('#FDE68A')
    setQuickNoteBlocks([])
    setQuickNoteCurrentText('')
    setQuickNoteModalOpen(true)
  }

  function openEditQuickNoteFull(note) {
    setEditingQuickNoteId(note.id)
    setQuickNoteTitle(note.title || '')
    setQuickNoteColor(note.color || '#FDE68A')
    const hasBlocks = note.content_blocks && note.content_blocks.length > 0
    setQuickNoteBlocks(hasBlocks ? note.content_blocks : (note.photo_url ? [{ type: 'photo', url: note.photo_url }] : []))
    setQuickNoteCurrentText(hasBlocks ? '' : (note.content || ''))
    setQuickNoteModalOpen(true)
  }

  function insertPhotoBlockToQuickNote(file) {
    if (!file) return
    setQuickNoteBlocks(prev => {
      const next = [...prev]
      if (quickNoteCurrentText.trim()) next.push({ type: 'text', content: quickNoteCurrentText })
      next.push({ type: 'photo', file })
      return next
    })
    setQuickNoteCurrentText('')
  }

  function insertVideoBlockToQuickNote(file) {
    if (!file) return
    setQuickNoteBlocks(prev => {
      const next = [...prev]
      if (quickNoteCurrentText.trim()) next.push({ type: 'text', content: quickNoteCurrentText })
      next.push({ type: 'video', file })
      return next
    })
    setQuickNoteCurrentText('')
  }

  function removeLastQuickNoteBlock() {
    setQuickNoteBlocks(prev => prev.slice(0, -1))
  }

  async function saveQuickNoteFull() {
    const blocks = [...quickNoteBlocks]
    if (quickNoteCurrentText.trim()) blocks.push({ type: 'text', content: quickNoteCurrentText })
    if (blocks.length === 0 && !quickNoteTitle.trim()) return
    setSavingQuickNote(true)

    const finalBlocks = []
    for (const b of blocks) {
      if (b.type === 'text') finalBlocks.push(b)
      else if (b.url) finalBlocks.push(b)
      else {
        const url = await uploadFile(b.file)
        if (url) finalBlocks.push({ type: b.type, url })
      }
    }
    const textContent = finalBlocks.filter(b => b.type === 'text').map(b => b.content).join('\n')
    const firstPhoto = finalBlocks.find(b => b.type === 'photo')
    const payload = {
      title: quickNoteTitle,
      content: textContent,
      content_blocks: finalBlocks,
      color: quickNoteColor,
      photo_url: firstPhoto ? firstPhoto.url : null,
    }
    const { error } = editingQuickNoteId
      ? await supabase.from('quick_notes').update(payload).eq('id', editingQuickNoteId)
      : await supabase.from('quick_notes').insert(payload)
    if (error) { alert('Error al guardar la nota: ' + error.message); setSavingQuickNote(false); return }
    setQuickNoteModalOpen(false)
    setEditingQuickNoteId(null)
    setQuickNoteTitle('')
    setQuickNoteColor('#FDE68A')
    setQuickNoteBlocks([])
    setQuickNoteCurrentText('')
    setSavingQuickNote(false)
    loadData()
  }

  async function shareQuickNote(note) {
    setSharingNotes(true)
    try {
      const header = note.title ? `📝 ${note.title}` : '📝 Nota de Days'
      const blocks = (note.content_blocks && note.content_blocks.length > 0)
        ? note.content_blocks
        : (note.content ? [{ type: 'text', content: note.content }] : [])
      const textBlocks = blocks.filter(b => b.type === 'text').map(b => b.content).join('\n')
      const shareText = textBlocks ? `${header}:\n${textBlocks}` : header
      let fileUrls = blocks.filter(b => (b.type === 'photo' || b.type === 'video') && b.url).map(b => b.url)
      if (fileUrls.length === 0 && note.photo_url) fileUrls = [note.photo_url]
      const files = (await Promise.all(fileUrls.map(urlToFile))).filter(Boolean)

      if (navigator.share && files.length > 0 && navigator.canShare && navigator.canShare({ files })) {
        await navigator.share({ title: 'Nota de Days', text: shareText, files })
      } else if (navigator.share) {
        await navigator.share({ title: 'Nota de Days', text: shareText })
      } else {
        window.open(`https://wa.me/?text=${encodeURIComponent(shareText)}`, '_blank')
      }
    } catch (err) {
      if (err.name !== 'AbortError') alert('No se pudo compartir. Intenta de nuevo.')
    }
    setSharingNotes(false)
  }

  function downloadQuickNote(note) {
    const blocks = (note.content_blocks && note.content_blocks.length > 0)
      ? note.content_blocks
      : (note.content ? [{ type: 'text', content: note.content }] : [])
    const text = blocks.filter(b => b.type === 'text').map(b => b.content).join('\n\n')
    const full = (note.title ? note.title + '\n\n' : '') + text
    const blob = new Blob([full], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${(note.title || 'nota').replace(/[^a-z0-9-_ ]/gi, '')}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  async function addTag(e) {
    e.preventDefault()
    if (!newTagForm.name.trim()) return
    if (newTagForm.kind === 'secundaria' && !newTagForm.parent_id) {
      alert('Elige a qué etiqueta principal pertenece')
      return
    }
    const payload = {
      name: newTagForm.name,
      color: newTagForm.color,
      parent_id: newTagForm.kind === 'secundaria' ? newTagForm.parent_id : null,
    }
    if (!navigator.onLine) {
      const localId = 'local_' + Date.now()
      setDayTags(prev => [...prev, { id: localId, ...payload }])
      queueOfflineOp({ table: 'day_tags', action: 'insert', payload })
      setNewTagForm({ name: '', color: '#FDE68A', parent_id: '', kind: 'principal' })
      return
    }
    const { error } = await supabase.from('day_tags').insert(payload)
    if (error) { alert('Error al agregar etiqueta: ' + error.message); return }
    setNewTagForm({ name: '', color: '#FDE68A', parent_id: '', kind: 'principal' })
    loadData()
  }

  async function updateTagName(id, name) {
    if (!name.trim()) return
    setDayTags(prev => prev.map(t => t.id === id ? { ...t, name } : t))
    if (!navigator.onLine) {
      queueOfflineOp({ table: 'day_tags', action: 'update', payload: { name }, match: { id } })
      return
    }
    await supabase.from('day_tags').update({ name }).eq('id', id)
    loadData()
  }

  async function updateTagColor(id, color) {
    setDayTags(prev => prev.map(t => t.id === id ? { ...t, color } : t))
    if (!navigator.onLine) {
      queueOfflineOp({ table: 'day_tags', action: 'update', payload: { color }, match: { id } })
      return
    }
    await supabase.from('day_tags').update({ color }).eq('id', id)
    loadData()
  }

  async function deleteTag(id) {
    if (!confirm('¿Borrar esta etiqueta? También se borrarán todas sus entradas.')) return
    setDayTags(prev => prev.filter(t => t.id !== id))
    if (!navigator.onLine) {
      queueOfflineOp({ table: 'day_tags', action: 'delete', match: { id } })
      return
    }
    await supabase.from('day_tags').delete().eq('id', id)
    loadData()
  }

  async function quickAddTask(tagId, dateOverride) {
    const targetDate = dateOverride || selectedDay
    if (!targetDate) return
    const payload = { tag_id: tagId, date: targetDate, note: '', repeat: 'none' }
    if (!navigator.onLine) {
      const localId = 'local_' + Date.now()
      setDayEntries(prev => [...prev, { id: localId, done: false, ...payload }])
      queueOfflineOp({ table: 'day_entries', action: 'insert', payload })
      return
    }
    const { error } = await supabase.from('day_entries').insert(payload)
    if (error) { alert('Error al agregar: ' + error.message); return }
    loadData()
  }

  async function addQuickTask(e) {
    e.preventDefault()
    if (!newTaskText.trim()) return
    const payload = {
      tag_id: newTaskTagId || null,
      date: newTaskDate || todayStr,
      note: newTaskText,
      repeat: 'none',
      done: false,
    }
    if (!navigator.onLine) {
      const localId = 'local_' + Date.now()
      setDayEntries(prev => [...prev, { id: localId, ...payload }])
      queueOfflineOp({ table: 'day_entries', action: 'insert', payload })
      setNewTaskText('')
      return
    }
    const { error } = await supabase.from('day_entries').insert(payload)
    if (error) { alert('Error al guardar la tarea: ' + error.message); return }
    setNewTaskText('')
    loadData()
  }

  async function toggleEntryDone(entry) {
    const newDone = !entry.done
    setDayEntries(prev => prev.map(e => e.id === entry.id ? { ...e, done: newDone } : e))
    if (!navigator.onLine) {
      queueOfflineOp({ table: 'day_entries', action: 'update', payload: { done: newDone }, match: { id: entry.id } })
      return
    }
    await supabase.from('day_entries').update({ done: newDone }).eq('id', entry.id)
    loadData()
  }

  // ---------- Nota libre ----------
  function insertPhotoBlockToNote(file) {
    if (!file) return
    setFreeNoteBlocks(prev => {
      const next = [...prev]
      if (freeNoteCurrentText.trim()) next.push({ type: 'text', content: freeNoteCurrentText })
      next.push({ type: 'photo', file })
      return next
    })
    setFreeNoteCurrentText('')
  }

  function insertVideoBlockToNote(file) {
    if (!file) return
    setFreeNoteBlocks(prev => {
      const next = [...prev]
      if (freeNoteCurrentText.trim()) next.push({ type: 'text', content: freeNoteCurrentText })
      next.push({ type: 'video', file })
      return next
    })
    setFreeNoteCurrentText('')
  }

  function removeLastNoteBlock() {
    setFreeNoteBlocks(prev => prev.slice(0, -1))
  }

  function openEditNote(t) {
    setEditingTaskId(t.id)
    setFreeNoteBlocks(t.content_blocks || [])
    setFreeNoteCurrentText('')
  }

  function openDayJournal(dateStr) {
    setSelectedDay(dateStr)
    setDayModalOpen(true)
    const items = dayEntries.filter(t => t.date === dateStr)
    const existingNote = items.find(t => t.content_blocks && t.content_blocks.length > 0)
    if (existingNote) {
      setEditingTaskId(existingNote.id)
      setFreeNoteBlocks(existingNote.content_blocks)
    } else {
      setEditingTaskId(null)
      setFreeNoteBlocks([])
    }
    setFreeNoteCurrentText('')
  }

  function navigateDay(delta) {
    if (!selectedDay) return
    const d = new Date(selectedDay + 'T00:00:00')
    d.setDate(d.getDate() + delta)
    openDayJournal(formatDateStr(d))
  }

  function closeDayJournal() {
    const hasUnsaved = freeNoteCurrentText.trim().length > 0
    if (hasUnsaved && !confirm('¿Cerrar sin guardar? Perderás lo que escribiste.')) return
    setDayModalOpen(false)
    setEditingTaskId(null)
    setFreeNoteBlocks([])
    setFreeNoteCurrentText('')
  }

  function formatDayHeader(dateStr) {
    const s = new Date(dateStr + 'T00:00:00').toLocaleDateString('es-EC', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    return s.charAt(0).toUpperCase() + s.slice(1)
  }

  async function quickAddFreeNote() {
    if (!selectedDay) return
    const blocks = [...freeNoteBlocks]
    if (freeNoteCurrentText.trim()) blocks.push({ type: 'text', content: freeNoteCurrentText })
    if (blocks.length === 0) return
    setSavingFreeNote(true)

    if (!navigator.onLine) {
      const hasMedia = blocks.some(b => b.type !== 'text' && !b.url)
      if (hasMedia) alert('Sin conexión: las fotos o videos no se pueden guardar ahora. Se guardará solo el texto; agrega la foto de nuevo cuando tengas internet.')
      const textBlocks = blocks.filter(b => b.type === 'text' || b.url)
      const localId = 'local_' + Date.now()
      if (editingTaskId) {
        setDayEntries(prev => prev.map(e => e.id === editingTaskId ? { ...e, content_blocks: textBlocks } : e))
        queueOfflineOp({ table: 'day_entries', action: 'update', payload: { content_blocks: textBlocks }, match: { id: editingTaskId } })
      } else {
        const payload = { tag_id: null, date: selectedDay, note: '', repeat: 'none', content_blocks: textBlocks }
        setDayEntries(prev => [...prev, { id: localId, done: false, ...payload }])
        queueOfflineOp({ table: 'day_entries', action: 'insert', payload })
      }
      setFreeNoteBlocks([])
      setFreeNoteCurrentText('')
      setEditingTaskId(null)
      setSavingFreeNote(false)
      return
    }

    const finalBlocks = []
    for (const b of blocks) {
      if (b.type === 'text') {
        finalBlocks.push(b)
      } else if (b.url) {
        finalBlocks.push(b)
      } else {
        const url = await uploadFile(b.file)
        if (url) finalBlocks.push({ type: b.type, url })
      }
    }
    const { error } = editingTaskId
      ? await supabase.from('day_entries').update({ content_blocks: finalBlocks }).eq('id', editingTaskId)
      : await supabase.from('day_entries').insert({
          tag_id: null,
          date: selectedDay,
          note: '',
          repeat: 'none',
          content_blocks: finalBlocks,
        })
    if (error) { alert('Error al guardar la nota: ' + error.message); setSavingFreeNote(false); return }
    setFreeNoteBlocks([])
    setFreeNoteCurrentText('')
    setEditingTaskId(null)
    setSavingFreeNote(false)
    loadData()
  }

  async function deleteTask(id) {
    setDayEntries(prev => prev.filter(e => e.id !== id))
    if (!navigator.onLine) {
      queueOfflineOp({ table: 'day_entries', action: 'delete', match: { id } })
      return
    }
    await supabase.from('day_entries').delete().eq('id', id)
    loadData()
  }

  async function deleteSeries(seriesId) {
    if (!confirm('¿Eliminar esta tarea repetitiva y todas sus fechas futuras? El historial pasado no se borra.')) return
    setDayEntries(prev => prev.filter(e => !(e.series_id === seriesId && e.date >= todayStr)))
    if (!navigator.onLine) {
      queueOfflineOp({ table: 'day_entries', action: 'delete', match: { series_id: seriesId }, matchGte: { date: todayStr } })
      return
    }
    await supabase.from('day_entries').delete().eq('series_id', seriesId).gte('date', todayStr)
    loadData()
  }

  async function rescheduleTask(entry) {
    const newDate = prompt('Nueva fecha (AAAA-MM-DD):', entry.date)
    if (!newDate || newDate === entry.date) return
    setDayEntries(prev => prev.map(e => e.id === entry.id ? { ...e, date: newDate } : e))
    if (!navigator.onLine) {
      queueOfflineOp({ table: 'day_entries', action: 'update', payload: { date: newDate }, match: { id: entry.id } })
      return
    }
    await supabase.from('day_entries').update({ date: newDate }).eq('id', entry.id)
    loadData()
  }

  function buildRepeatDates(startDateStr, repeat, customDays) {
    const dates = [startDateStr]
    if (repeat === 'none') return dates
    const [y, m, d] = startDateStr.split('-').map(Number)
    const count = repeat === 'monthly' ? 12 : repeat === 'custom' ? 20 : 16
    for (let i = 1; i < count; i++) {
      const next = new Date(y, m - 1, d)
      if (repeat === 'weekly') next.setDate(next.getDate() + 7 * i)
      else if (repeat === 'biweekly') next.setDate(next.getDate() + 14 * i)
      else if (repeat === 'monthly') next.setMonth(next.getMonth() + i)
      else if (repeat === 'custom') next.setDate(next.getDate() + (Number(customDays) || 1) * i)
      dates.push(formatDateStr(next))
    }
    return dates
  }

  async function addTaskFull(e) {
    e.preventDefault()
    const effectiveDate = taskForm.date || todayStr
    if (!taskForm.tag_id || !effectiveDate) {
      alert('Selecciona una etiqueta y una fecha')
      return
    }
    if (taskForm.repeat === 'custom' && !taskForm.customDays) {
      alert('Escribe cada cuántos días se repite')
      return
    }
    const dates = buildRepeatDates(effectiveDate, taskForm.repeat, taskForm.customDays)
    const seriesId = editingSeriesId || crypto.randomUUID()
    const rows = dates.map(date => ({ tag_id: taskForm.tag_id, date, note: taskForm.note, repeat: taskForm.repeat, series_id: seriesId }))

    if (!navigator.onLine) {
      if (editingSeriesId) {
        setDayEntries(prev => prev.filter(en => !(en.series_id === editingSeriesId && en.date >= todayStr)))
        queueOfflineOp({ table: 'day_entries', action: 'delete', match: { series_id: editingSeriesId }, matchGte: { date: todayStr } })
      }
      setDayEntries(prev => [...prev, ...rows.map((r, i) => ({ id: 'local_' + Date.now() + '_' + i, done: false, ...r }))])
      queueOfflineOp({ table: 'day_entries', action: 'insert', payload: rows })
      setTaskForm({ tag_id: '', date: '', note: '', repeat: 'weekly', customDays: '' })
      setEditingSeriesId(null)
      setTaskFormOpen(false)
      return
    }

    if (editingSeriesId) {
      // Borra solo las ocurrencias futuras/hoy de esta serie; conserva el historial pasado
      await supabase.from('day_entries').delete().eq('series_id', editingSeriesId).gte('date', todayStr)
    }

    const { error } = await supabase.from('day_entries').insert(rows)
    if (error) { alert('Error al guardar: ' + error.message); return }
    setTaskForm({ tag_id: '', date: '', note: '', repeat: 'weekly', customDays: '' })
    setEditingSeriesId(null)
    setTaskFormOpen(false)
    loadData()
  }

  function editTaskSeries(entry) {
    setEditingSeriesId(entry.series_id)
    setTaskForm({
      tag_id: entry.tag_id || '',
      date: entry.date >= todayStr ? entry.date : todayStr,
      note: entry.note || '',
      repeat: entry.repeat && entry.repeat !== 'none' ? entry.repeat : 'weekly',
      customDays: '',
    })
    setTimeout(() => {
      document.getElementById('recurring-task-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 50)
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

  async function shareEntry(t) {
    setSharingNotes(true)
    try {
      const header = `📓 Days (${new Date(t.date + 'T00:00:00').toLocaleDateString()})`
      const textBlocks = (t.content_blocks || []).filter(b => b.type === 'text').map(b => b.content).join('\n')
      const shareText = textBlocks ? `${header}:\n${textBlocks}` : header
      const fileUrls = (t.content_blocks || []).filter(b => (b.type === 'photo' || b.type === 'video') && b.url).map(b => b.url)
      const files = (await Promise.all(fileUrls.map(urlToFile))).filter(Boolean)

      if (navigator.share && files.length > 0 && navigator.canShare && navigator.canShare({ files })) {
        await navigator.share({ title: 'Nota de Days', text: shareText, files })
      } else if (navigator.share) {
        await navigator.share({ title: 'Nota de Days', text: shareText })
      } else {
        window.open(`https://wa.me/?text=${encodeURIComponent(shareText)}`, '_blank')
      }
    } catch (err) {
      if (err.name !== 'AbortError') alert('No se pudo compartir. Intenta de nuevo.')
    }
    setSharingNotes(false)
  }

  function highlightMatch(text, term) {
    if (!term) return text
    const parts = text.split(new RegExp(`(${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'ig'))
    return parts.map((part, i) =>
      part.toLowerCase() === term.toLowerCase()
        ? <mark key={i} className="search-highlight">{part}</mark>
        : part
    )
  }

  function textColorFor(hex) {
    if (!hex) return '#fff'
    const h = hex.replace('#', '')
    const r = parseInt(h.substring(0, 2), 16)
    const g = parseInt(h.substring(2, 4), 16)
    const b = parseInt(h.substring(4, 6), 16)
    const brightness = (r * 299 + g * 587 + b * 114) / 1000
    return brightness > 165 ? '#3a3a2e' : '#fff'
  }

  function formatDateStr(d) {
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
  }

  function changeMonth(delta) {
    setCalendarMonth(prev => {
      const d = new Date(prev)
      d.setMonth(d.getMonth() + delta)
      return d
    })
    setSelectedDay(null)
  }

  // ---------- Pantallas de autenticación ----------
  if (sharedListId) {
    return (
      <div className="admin" style={{ maxWidth: 480 }}>
        <div className="admin-header">
          <h1>🛒 {sharedList?.title || 'Lista'}</h1>
        </div>
        <hr className="admin-divider" />
        {sharedLoading ? (
          <p className="status-msg">Cargando...</p>
        ) : !sharedList ? (
          <p className="status-msg">No se encontró esta lista.</p>
        ) : (
          <>
            <form className="admin-form" onSubmit={sharedAddItem} style={{ flexDirection: 'row', gap: 8 }}>
              <input
                placeholder="Agregar algo a la lista..."
                value={sharedNewItemText}
                onChange={e => setSharedNewItemText(e.target.value)}
                style={{ flex: 1 }}
              />
              <button type="submit">➕</button>
            </form>
            <div className="day-task-list">
              {sharedItems.length === 0 ? (
                <p className="status-msg">La lista está vacía. Agrega el primer artículo arriba.</p>
              ) : (
                sharedItems.map(item => (
                  <div key={item.id} className={`day-task-item ${item.done ? 'done' : ''}`}>
                    <div className="day-task-row">
                      <input type="checkbox" checked={!!item.done} onChange={() => sharedToggleItem(item)} />
                      <span className="task-tag-name">{item.content}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
            <p style={{ fontSize: '0.75rem', color: 'var(--muted)', marginTop: 16, textAlign: 'center' }}>
              Esta lista se comparte por Days — cualquiera con este link puede ver y agregar artículos.
            </p>
          </>
        )}
      </div>
    )
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
        <h2>Days</h2>
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

  // ---------- Datos derivados del calendario ----------
  const calYear = calendarMonth.getFullYear()
  const calMonth = calendarMonth.getMonth()
  const calFirstDay = new Date(calYear, calMonth, 1)
  const calStartOffset = calFirstDay.getDay()
  const calDaysInMonth = new Date(calYear, calMonth + 1, 0).getDate()
  const calMonthLabel = calendarMonth.toLocaleDateString('es-EC', { month: 'long', year: 'numeric' })
  const todayStr = formatDateStr(new Date())

  const calCells = []
  for (let i = 0; i < calStartOffset; i++) calCells.push(null)
  for (let d = 1; d <= calDaysInMonth; d++) calCells.push(new Date(calYear, calMonth, d))

  const entriesByDay = {}
  dayEntries.forEach(t => {
    if (!entriesByDay[t.date]) entriesByDay[t.date] = []
    entriesByDay[t.date].push(t)
  })

  const entriesByDayFiltered = {}
  function groupIdOf(tagId) {
    const tag = dayTags.find(t => t.id === tagId)
    if (!tag) return tagId
    return tag.parent_id || tag.id
  }
  dayEntries
    .filter(t => visibleTagIds.length === 0 || visibleTagIds.includes(groupIdOf(t.tag_id)))
    .forEach(t => {
      if (!entriesByDayFiltered[t.date]) entriesByDayFiltered[t.date] = []
      entriesByDayFiltered[t.date].push(t)
    })

  function toggleVisibleTag(id) {
    setVisibleTagIds(prev => prev.includes(id) ? prev.filter(t => t !== id) : [...prev, id])
  }

  return (
    <div className={`admin ${darkMode ? 'dark-mode' : ''}`}>
      <div className="admin-header admin-header-banner">
        <button className="hamburger-btn" onClick={() => setMainMenuOpen(true)} aria-label="Menú">☰</button>
        <img src="/logo-days.png" alt="Days" className="app-logo-banner-img" />
      </div>
      {isOffline && (
        <p className="offline-banner">📡 Sin conexión — puedes seguir escribiendo, se guardará en tu celular y se subirá solo cuando vuelva la señal</p>
      )}
      {!isOffline && pendingSync > 0 && (
        <p className="offline-banner offline-banner-syncing">🔄 Subiendo {pendingSync} cambio{pendingSync > 1 ? 's' : ''} pendiente{pendingSync > 1 ? 's' : ''}...</p>
      )}
      <hr className="admin-divider" />
      <div className="water-tracker-row">
        <div className="water-drops-group">
          {Array.from({ length: 8 }).map((_, i) => (
            <button
              key={i}
              type="button"
              className={`water-drop ${i < waterGlasses ? 'filled' : ''}`}
              onClick={() => setWaterCount(i < waterGlasses && i === waterGlasses - 1 ? i : i + 1)}
              title={`${i + 1} vaso${i > 0 ? 's' : ''}`}
            />
          ))}
        </div>
        <button type="button" className="quick-note-shortcut-btn" onClick={() => setView('notas')} title="Notas rápidas">
          📓
        </button>
      </div>

      {mainMenuOpen && (
        <div className="tag-menu-overlay main-menu-overlay" onClick={() => setMainMenuOpen(false)}>
          <div className="tag-menu-panel main-menu-panel" onClick={e => e.stopPropagation()}>
            <div className="tag-menu-header">
              <h4>Menú</h4>
              <button type="button" className="modal-close-btn" onClick={() => setMainMenuOpen(false)}>✕</button>
            </div>
            <div className="tag-menu-list">
              <div className="menu-item-with-submenu">
                <button type="button" className="tag-menu-item" style={{ flex: 1 }} onClick={() => { setView('calendario'); setMainMenuOpen(false) }}>📅 Calendario</button>
                {dayTags.length > 0 && (
                  <button type="button" className="menu-submenu-toggle" onClick={() => setCalendarSubmenuOpen(o => !o)}>
                    {calendarSubmenuOpen ? '▴' : '▾'}
                  </button>
                )}
              </div>
              {calendarSubmenuOpen && (
                <div className="menu-submenu-filter">
                  <p className="filter-section-label">Filtro</p>
                  <div className="tag-filter-row">
                    <button
                      type="button"
                      className={visibleTagIds.length === 0 ? 'active' : ''}
                      onClick={() => { setVisibleTagIds([]); setView('calendario'); setMainMenuOpen(false) }}
                    >
                      Todas
                    </button>
                    {dayTags.filter(tag => !tag.parent_id).map(tag => (
                      <button
                        key={tag.id}
                        type="button"
                        className={visibleTagIds.includes(tag.id) ? 'active' : ''}
                        style={visibleTagIds.includes(tag.id) ? { background: tag.color, borderColor: tag.color, color: textColorFor(tag.color) } : {}}
                        onClick={() => { toggleVisibleTag(tag.id); setView('calendario'); setMainMenuOpen(false) }}
                      >
                        <span className="tag-filter-dot" style={{ background: tag.color }} />
                        {tag.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <button type="button" className="tag-menu-item" onClick={() => { setView('buscar'); setMainMenuOpen(false) }}>🔍 Buscar</button>
              <button type="button" className="tag-menu-item" onClick={() => { setView('etiquetas'); setMainMenuOpen(false) }}>🏷️ Etiquetas</button>
              <button type="button" className="tag-menu-item" onClick={() => { setView('notas'); setMainMenuOpen(false) }}>🗒️ Nota rápida</button>
              <button type="button" className="tag-menu-item" onClick={() => { setView('listas'); setMainMenuOpen(false) }}>🛒 Listas</button>
              <button type="button" className="tag-menu-item" onClick={() => { setView('tareas'); setMainMenuOpen(false) }}>📋 Tareas repetitivas</button>
              <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '6px 0' }} />
              <button type="button" className="tag-menu-item" onClick={toggleDarkMode}>{darkMode ? '☀️ Modo claro' : '🌙 Modo oscuro'}</button>
              <button type="button" className="tag-menu-item" onClick={() => { exportBackup(); setMainMenuOpen(false) }}>💾 Respaldo</button>
              <button type="button" className="tag-menu-item" onClick={handleLogout} style={{ color: '#b03434' }}>🚪 Cerrar sesión</button>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <p className="status-msg">Cargando...</p>
      ) : (
        <>
          <hr className="quick-nav-divider" />

          <div className="calendar-header">
            <button type="button" onClick={() => changeMonth(-1)}>←</button>
            <label className="journal-date-label">
              <h3>{calMonthLabel}</h3>
              <p className="calendar-today-label">
                Hoy es {(() => { const s = new Date().toLocaleDateString('es-EC', { weekday: 'long', day: 'numeric' }); return s.charAt(0).toUpperCase() + s.slice(1) })()}
              </p>
              <input
                type="date"
                value={formatDateStr(calendarMonth)}
                onChange={e => { if (e.target.value) setCalendarMonth(new Date(e.target.value + 'T00:00:00')) }}
                className="journal-date-input"
              />
            </label>
            <button type="button" onClick={() => changeMonth(1)}>→</button>
          </div>

          <div className="calendar-grid">
            {['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'].map(d => (
              <div key={d} className="calendar-weekday">{d}</div>
            ))}
            {calCells.map((cell, i) => {
              if (!cell) return <div key={`empty-${i}`} className="calendar-day outside" />
              const dateStr = formatDateStr(cell)
              const dayItems = entriesByDay[dateStr] || []
              const dayItemsShown = entriesByDayFiltered[dateStr] || []
              const taggedItemsShown = dayItemsShown.filter(t => t.tag_id)
              const hasFreeNote = dayItems.some(t => t.content_blocks && t.content_blocks.length > 0 && !t.tag_id)
              return (
                <div
                  key={dateStr}
                  className={`calendar-day ${dateStr === todayStr ? 'today' : ''} ${selectedDay === dateStr ? 'selected' : ''} ${hasFreeNote ? 'has-note' : ''}`}
                  onClick={() => openDayJournal(dateStr)}
                >
                  <span className="calendar-day-num">{cell.getDate()}</span>
                  {(() => {
                    const firstPhoto = dayItems.flatMap(t => t.content_blocks || []).find(b => b.type === 'photo')
                    return firstPhoto && <img src={firstPhoto.url} alt="" className="calendar-day-thumb" />
                  })()}
                  <div className="calendar-day-tasks">
                    {taggedItemsShown.slice(0, 3).map(t => {
                      const tag = dayTags.find(g => g.id === t.tag_id)
                      return (
                        <span
                          key={t.id}
                          className="calendar-task-label"
                          style={{ background: tag?.color || '#a1665e', color: textColorFor(tag?.color || '#a1665e') }}
                          title={tag?.name || t.note}
                        >
                          {tag?.name || t.note}
                        </span>
                      )
                    })}
                    {taggedItemsShown.length > 3 && (
                      <span className="calendar-task-more">+{taggedItemsShown.length - 3}</span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          <hr className="quick-nav-divider" />
          <div className="days-footer-divider">
            <img src="/floral-divider.png" alt="" />
          </div>

      {view !== 'calendario' && (
        <div className="admin-sheet-overlay" onClick={() => setView('calendario')}>
          <div className="admin-sheet" onClick={e => e.stopPropagation()}>
            <div className="admin-sheet-header">
              <h2>
                {view === 'etiquetas' && '🏷️ Etiquetas'}
                {view === 'tareas' && '📋 Tareas repetitivas'}
                {view === 'notas' && '🗒️ Notas rápidas'}
                {view === 'buscar' && '🔍 Buscar'}
                {view === 'listas' && '🛒 Listas'}
              </h2>
              <button type="button" className="modal-close-btn" onClick={() => setView('calendario')}>✕</button>
            </div>
            <div className="admin-sheet-body">

        {view === 'buscar' && (
          <>
          <div className="task-search-row">
            <input
              className="order-search"
              placeholder="Buscar entrada por palabra o etiqueta..."
              value={taskSearch}
              onChange={e => setTaskSearch(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && (e.target.blur(), setTaskSearchSubmitted(taskSearch))}
            />
            <button
              type="button"
              className="task-search-btn"
              onClick={() => { document.activeElement && document.activeElement.blur(); setTaskSearchSubmitted(taskSearch) }}
            >
              🔍 Buscar
            </button>
          </div>

          {taskSearchSubmitted.trim() && (() => {
            const term = taskSearchSubmitted.trim().toLowerCase()
            const matches = dayEntries
              .filter(t => {
                const tag = dayTags.find(g => g.id === t.tag_id)
                const blocksText = (t.content_blocks || [])
                  .filter(b => b.type === 'text')
                  .map(b => b.content)
                  .join(' ')
                  .toLowerCase()
                return (t.note || '').toLowerCase().includes(term)
                  || (tag?.name || '').toLowerCase().includes(term)
                  || blocksText.includes(term)
              })
              .sort((a, b) => a.date.localeCompare(b.date))
            return (
              <div className="day-panel">
                <h4>Resultados de búsqueda ({matches.length})</h4>
                {matches.length === 0 && <p className="status-msg">No se encontraron entradas.</p>}
                <div className="day-task-list">
                  {matches.map(t => {
                    const tag = dayTags.find(g => g.id === t.tag_id)
                    const hasBlocks = t.content_blocks && t.content_blocks.length > 0
                    const previewText = hasBlocks
                      ? (t.content_blocks || []).filter(b => b.type === 'text').map(b => b.content).join(' ')
                      : ''
                    const hasPhoto = hasBlocks && (t.content_blocks || []).some(b => b.type === 'photo')
                    const hasVideo = hasBlocks && (t.content_blocks || []).some(b => b.type === 'video')
                    return (
                      <div
                        key={t.id}
                        className="day-task-item"
                        onClick={() => {
                          setTaskSearch('')
                          setTaskSearchSubmitted('')
                          setSelectedDay(t.date)
                          setDayModalOpen(true)
                          if (hasBlocks) {
                            setEditingTaskId(t.id)
                            setFreeNoteBlocks(t.content_blocks)
                            setFreeNoteCurrentText('')
                            setFreeNoteModalOpen(true)
                          }
                        }}
                      >
                        <div className="day-task-row">
                          <span className="task-tag-dot" style={{ background: tag?.color || '#a1665e' }} />
                          <span className="task-tag-name">{new Date(t.date + 'T00:00:00').toLocaleDateString('es-EC', { day: 'numeric', month: 'short', year: 'numeric' })} — {tag?.name || (t.tag_id ? 'Etiqueta borrada' : '📝 Nota libre')}</span>
                        </div>
                        {t.note && <span className="task-note">— {highlightMatch(t.note, term)}</span>}
                        {previewText && (
                          <p className="task-note" style={{ margin: '2px 0 0 20px', whiteSpace: 'pre-wrap' }}>
                            {highlightMatch(previewText, term)}
                            {(hasPhoto || hasVideo) && <span> {hasPhoto ? '📷' : ''}{hasVideo ? '🎥' : ''}</span>}
                          </p>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })()}

          {taskSearchSubmitted.trim() && (() => {
            const term = taskSearchSubmitted.trim().toLowerCase()
            const noteMatches = quickNotes.filter(n => n.content.toLowerCase().includes(term))
            if (noteMatches.length === 0) return null
            return (
              <div className="day-panel">
                <h4>🗒️ Notas rápidas ({noteMatches.length})</h4>
                <div className="quick-notes-grid">
                  {noteMatches.map(note => (
                    <div key={note.id} className="quick-note-card" style={{ background: note.color }} onClick={() => setView('notas')}>
                      <p>{note.content}</p>
                      {note.folder && <span className="quick-note-folder-tag">📁 {note.folder}</span>}
                    </div>
                  ))}
                </div>
              </div>
            )
          })()}
          </>
        )}

        {view === 'tareas' && (
          <>
          <form id="recurring-task-form" className="admin-form recurring-task-form" onSubmit={addTaskFull} style={editingSeriesId ? { border: '2px solid var(--pink)' } : {}}>
            <p className="filter-section-label" style={{ margin: '0 0 4px' }}>
              {editingSeriesId ? 'Editando tarea repetitiva' : 'Nueva tarea repetitiva'}
            </p>
            <select value={taskForm.tag_id} onChange={e => setTaskForm({ ...taskForm, tag_id: e.target.value })}>
              <option value="">Selecciona una etiqueta</option>
              {dayTags.map(tag => (
                <option key={tag.id} value={tag.id}>{tag.parent_id ? '— ' : ''}{tag.name}</option>
              ))}
            </select>
            <div className="quick-note-color-row">
              <input
                type="date"
                value={taskForm.date || todayStr}
                onChange={e => setTaskForm({ ...taskForm, date: e.target.value })}
                style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid var(--sage)', fontFamily: 'inherit' }}
              />
              <select value={taskForm.repeat} onChange={e => setTaskForm({ ...taskForm, repeat: e.target.value })}>
                <option value="weekly">Cada semana</option>
                <option value="biweekly">Cada 2 semanas</option>
                <option value="monthly">Cada mes</option>
                <option value="custom">Cada N días...</option>
              </select>
              {taskForm.repeat === 'custom' && (
                <input
                  type="number"
                  placeholder="días"
                  value={taskForm.customDays || ''}
                  onChange={e => setTaskForm({ ...taskForm, customDays: e.target.value })}
                  style={{ width: 60, padding: '6px 8px', borderRadius: 6, border: '1px solid var(--sage)', fontFamily: 'inherit' }}
                />
              )}
              <button type="submit" className="quick-note-add-btn">{editingSeriesId ? 'Guardar cambios' : 'Guardar'}</button>
              {editingSeriesId && (
                <button
                  type="button"
                  className="quick-note-add-btn"
                  style={{ background: 'transparent', color: 'var(--dark)', border: '1px solid var(--sage)' }}
                  onClick={() => { setEditingSeriesId(null); setTaskForm({ tag_id: '', date: '', note: '', repeat: 'weekly', customDays: '' }) }}
                >
                  Cancelar
                </button>
              )}
            </div>
          </form>

          {(() => {
            const repeatLabel = { weekly: 'Cada semana', biweekly: 'Cada 2 semanas', monthly: 'Cada mes', custom: 'Frecuencia personalizada' }
            const listEntries = dayEntries
              .filter(t => !(t.content_blocks && t.content_blocks.length > 0))
              .filter(t => visibleTagIds.length === 0 || visibleTagIds.includes(groupIdOf(t.tag_id)))
              .filter(t => t.date >= todayStr)
              .sort((a, b) => a.date.localeCompare(b.date))

            // Una sola tarjeta resumen por serie (la próxima ocurrencia); las tareas sin serie se listan individualmente
            const seenSeries = new Set()
            const summaryEntries = []
            for (const t of listEntries) {
              if (t.series_id) {
                if (seenSeries.has(t.series_id)) continue
                seenSeries.add(t.series_id)
              }
              summaryEntries.push(t)
              if (summaryEntries.length >= 30) break
            }

            return summaryEntries.length === 0 ? (
              <p className="status-msg">No hay tareas próximas{visibleTagIds.length > 0 ? ' para este filtro' : ''}.</p>
            ) : (
              <div className="recurring-tasks-list">
                {summaryEntries.map(t => {
                  const tag = dayTags.find(g => g.id === t.tag_id)
                  const bg = tag?.color || '#E8E4D8'
                  const seriesDates = t.series_id
                    ? dayEntries.filter(e => e.series_id === t.series_id).map(e => e.date).sort()
                    : [t.date]
                  const rangeStart = seriesDates[0]
                  const rangeEnd = seriesDates[seriesDates.length - 1]
                  const fmt = d => new Date(d + 'T00:00:00').toLocaleDateString('es-EC', { day: 'numeric', month: 'short', year: 'numeric' })
                  return (
                    <div key={t.id} className="task-card-v2" style={{ background: bg, color: textColorFor(bg) }}>
                      <p className="task-card-v2-tag">{tag ? tag.name : 'Sin etiqueta'}</p>
                      <p className="task-card-v2-freq">{t.repeat && t.repeat !== 'none' ? (repeatLabel[t.repeat] || 'Repetitiva') : 'Una sola vez'}</p>
                      {t.series_id && rangeStart !== rangeEnd && (
                        <p className="task-card-v2-range">Del {fmt(rangeStart)} al {fmt(rangeEnd)}</p>
                      )}
                      <p className="task-card-v2-next">Próxima: {fmt(t.date)}</p>
                      {t.note && <p className="task-card-v2-note">{t.note}</p>}
                      <label className="task-card-v2-check">
                        <input type="checkbox" checked={!!t.done} onChange={() => toggleEntryDone(t)} />
                        Marcar próxima como hecha
                      </label>
                      <div className="task-card-v2-actions">
                        {t.series_id && (
                          <button type="button" onClick={() => editTaskSeries(t)}>✏️ Editar</button>
                        )}
                        <button type="button" onClick={() => rescheduleTask(t)}>📅 Cambiar fecha</button>
                        <button type="button" onClick={() => openDayJournal(t.date)}>👁️ Ver día</button>
                        {t.series_id ? (
                          <button type="button" className="task-card-v2-delete" onClick={() => deleteSeries(t.series_id)}>🗑️ Eliminar serie</button>
                        ) : (
                          <button type="button" className="task-card-v2-delete" onClick={() => deleteTask(t.id)}>🗑️ Eliminar</button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )
          })()}
          </>
        )}

        {view === 'notas' && (
          <>
          <button type="button" className="full-form-btn" onClick={openNewQuickNote}>➕ Nueva nota</button>

          {(() => {
            const folders = [...new Set(quickNotes.filter(n => n.folder).map(n => n.folder))]
            const filtered = quickNotes.filter(n => {
              if (noteFolderFilter === 'all') return true
              if (noteFolderFilter === 'none') return !n.folder
              return n.folder === noteFolderFilter
            })
            return (
              <>
                {folders.length > 0 && (
                  <div className="tag-filter-row">
                    <button type="button" className={noteFolderFilter === 'all' ? 'active' : ''} onClick={() => setNoteFolderFilter('all')}>Todas</button>
                    <button type="button" className={noteFolderFilter === 'none' ? 'active' : ''} onClick={() => setNoteFolderFilter('none')}>Sin carpeta</button>
                    {folders.map(f => (
                      <button key={f} type="button" className={noteFolderFilter === f ? 'active' : ''} onClick={() => setNoteFolderFilter(f)}>📁 {f}</button>
                    ))}
                  </div>
                )}
                {filtered.length === 0 ? (
                  <p className="status-msg">No hay notas todavía.</p>
                ) : (
                  <div className="quick-notes-grid">
                    {filtered.map(note => (
                      <div key={note.id} className="quick-note-card" style={{ background: note.color }}>
                        {note.photo_url && <img src={note.photo_url} alt="" className="quick-note-photo" />}
                        {note.title && <strong onClick={() => openEditQuickNoteFull(note)} style={{ cursor: 'pointer', display: 'block' }}>{note.title}</strong>}
                        <p onClick={() => openEditQuickNoteFull(note)} style={{ cursor: 'pointer' }}>{note.content}</p>
                        <div className="quick-note-actions">
                          <button type="button" onClick={() => openEditQuickNoteFull(note)} title="Editar">✏️</button>
                          <button type="button" onClick={() => shareQuickNote(note)} disabled={sharingNotes} title="Compartir">📲</button>
                          <button type="button" onClick={() => downloadQuickNote(note)} title="Descargar">⬇️</button>
                          <button type="button" onClick={() => setMovingNoteId(movingNoteId === note.id ? null : note.id)} title="Mover a carpeta">📁</button>
                          <button type="button" onClick={() => deleteQuickNote(note.id)} title="Borrar">✕</button>
                        </div>
                        {note.folder && <span className="quick-note-folder-tag">📁 {note.folder}</span>}
                        {movingNoteId === note.id && (
                          <div className="quick-note-move-panel">
                            <button type="button" onClick={() => moveQuickNoteToFolder(note.id, null)}>Sin carpeta</button>
                            {folders.map(f => (
                              <button key={f} type="button" onClick={() => moveQuickNoteToFolder(note.id, f)}>📁 {f}</button>
                            ))}
                            <input
                              placeholder="Nueva carpeta..."
                              value={newFolderInput}
                              onChange={e => setNewFolderInput(e.target.value)}
                              onKeyDown={e => e.key === 'Enter' && newFolderInput.trim() && moveQuickNoteToFolder(note.id, newFolderInput.trim())}
                            />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </>
            )
          })()}
          </>
        )}

        {view === 'listas' && (
          <>
          <form className="admin-form" onSubmit={createShoppingList}>
            <input
              placeholder="Título de la lista (ej: Lista de compras)"
              value={newListTitle}
              onChange={e => setNewListTitle(e.target.value)}
            />
            <div className="quick-note-color-row">
              {['#FDE68A', '#FBCFE8', '#BFDBFE', '#BBF7D0', '#FCA5A5', '#DDD6FE'].map(color => (
                <button
                  key={color}
                  type="button"
                  className={`quick-note-swatch ${newListColor === color ? 'active' : ''}`}
                  style={{ background: color }}
                  onClick={() => setNewListColor(color)}
                />
              ))}
              <button type="submit" className="quick-note-add-btn" disabled={creatingList}>{creatingList ? '...' : '➕ Nueva'}</button>
            </div>
          </form>

          {shoppingLists.length === 0 ? (
            <p className="status-msg">No tienes listas todavía.</p>
          ) : (
            <div className="day-task-list">
              {shoppingLists.map(list => {
                const isOpen = openListId === list.id
                const items = listItemsByList[list.id] || []
                const pending = items.filter(i => !i.done).length
                const bg = list.color || '#FDE68A'
                return (
                  <div key={list.id} className="day-panel" style={{ marginBottom: 10, background: bg }}>
                    <div className="day-task-row">
                      <span
                        className="task-tag-name"
                        style={{ flex: 1, cursor: 'pointer', color: textColorFor(bg) }}
                        onClick={() => { const next = isOpen ? null : list.id; setOpenListId(next); if (next) loadListItems(next) }}
                      >
                        🛒 {list.title} {items.length > 0 ? `(${pending}/${items.length})` : ''}
                      </span>
                      <button type="button" className="task-edit-btn" onClick={() => shareShoppingList(list)} title="Compartir por WhatsApp">📲</button>
                      <button type="button" className="task-delete-btn" onClick={() => deleteShoppingList(list)}>✕</button>
                    </div>

                    {isOpen && (
                      <div style={{ marginTop: 10 }}>
                        <form
                          onSubmit={e => { e.preventDefault(); addListItem(list.id) }}
                          style={{ display: 'flex', gap: 6, marginBottom: 10 }}
                        >
                          <input
                            placeholder="Agregar artículo..."
                            value={newListItemText}
                            onChange={e => setNewListItemText(e.target.value)}
                            style={{ flex: 1, padding: 8, border: '1px solid var(--sage)', borderRadius: 6, fontFamily: 'inherit' }}
                            autoFocus
                          />
                          <button type="submit">➕</button>
                        </form>
                        {items.length === 0 ? (
                          <p className="status-msg">Todavía no hay artículos.</p>
                        ) : (
                          items.map(item => (
                            <div key={item.id} className={`day-task-item ${item.done ? 'done' : ''}`}>
                              <div className="day-task-row">
                                <input type="checkbox" checked={!!item.done} onChange={() => toggleListItem(item)} />
                                <span className="task-tag-name" style={{ flex: 1 }}>{item.content}</span>
                                <button type="button" className="task-delete-btn" onClick={() => deleteListItem(item)}>✕</button>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
          </>
        )}

        {view === 'etiquetas' && (
          <>
          <div className="garden-tags-section">
            <p style={{ fontSize: '0.85rem', color: 'var(--dark)', opacity: 0.75, margin: '0 0 8px' }}>Para registrar rápido en el calendario, toca una etiqueta ahí y usa el panel de "Registrar hoy".</p>
            <div className="garden-tags-list garden-tags-grouped">
              {dayTags.filter(tag => !tag.parent_id).map(group => (
                <div key={group.id} className="tag-group-block">
                  <div className="garden-tag-chip">
                    <button
                      type="button"
                      className="tag-quick-add-btn"
                      onClick={() => { quickAddTask(group.id, todayStr); setQuickAddToast(`✅ "${group.name}" agregado a hoy`); setTimeout(() => setQuickAddToast(''), 2000) }}
                      title={`Agregar "${group.name}" a hoy`}
                    >➕</button>
                    <div className="tag-color-edit-wrap">
                      <button
                        type="button"
                        className="tag-color-input"
                        style={{ background: group.color, border: 'none' }}
                        onClick={() => setColorPickerForTag(colorPickerForTag === group.id ? null : group.id)}
                      />
                      {colorPickerForTag === group.id && (
                        <div className="tag-color-popover">
                          {['#FDE68A', '#FBCFE8', '#BFDBFE', '#BBF7D0', '#FCA5A5', '#DDD6FE', '#FDBA74', '#A7F3D0', '#C7D2FE', '#F9A8D4'].map(color => (
                            <button
                              key={color}
                              type="button"
                              className="tag-color-swatch"
                              style={{ background: color }}
                              onClick={() => { updateTagColor(group.id, color); setColorPickerForTag(null) }}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                    <input
                      className="tag-name-input"
                      defaultValue={group.name}
                      onBlur={e => updateTagName(group.id, e.target.value)}
                      style={{ fontWeight: 'bold' }}
                    />
                    <button type="button" className="tag-delete-btn" onClick={() => deleteTag(group.id)}>✕</button>
                  </div>
                  <div className="tag-subgroup-list">
                    {dayTags.filter(tag => tag.parent_id === group.id).map(tag => (
                      <div key={tag.id} className="garden-tag-chip tag-sub-chip">
                        <button
                          type="button"
                          className="tag-quick-add-btn"
                          onClick={() => { quickAddTask(tag.id, todayStr); setQuickAddToast(`✅ "${tag.name}" agregado a hoy`); setTimeout(() => setQuickAddToast(''), 2000) }}
                          title={`Agregar "${tag.name}" a hoy`}
                        >➕</button>
                        <div className="tag-color-edit-wrap">
                          <button
                            type="button"
                            className="tag-color-input"
                            style={{ background: tag.color, border: 'none' }}
                            onClick={() => setColorPickerForTag(colorPickerForTag === tag.id ? null : tag.id)}
                          />
                          {colorPickerForTag === tag.id && (
                            <div className="tag-color-popover">
                              {['#FDE68A', '#FBCFE8', '#BFDBFE', '#BBF7D0', '#FCA5A5', '#DDD6FE', '#FDBA74', '#A7F3D0', '#C7D2FE', '#F9A8D4'].map(color => (
                                <button
                                  key={color}
                                  type="button"
                                  className="tag-color-swatch"
                                  style={{ background: color }}
                                  onClick={() => { updateTagColor(tag.id, color); setColorPickerForTag(null) }}
                                />
                              ))}
                            </div>
                          )}
                        </div>
                        <input
                          className="tag-name-input"
                          defaultValue={tag.name}
                          onBlur={e => updateTagName(tag.id, e.target.value)}
                        />
                        <button type="button" className="tag-delete-btn" onClick={() => deleteTag(tag.id)}>✕</button>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <form className="admin-form garden-tag-form new-tag-form" onSubmit={addTag}>
              <div className="tag-kind-row">
                <button
                  type="button"
                  className={!newTagForm.parent_id && newTagForm.kind !== 'secundaria' ? 'active' : ''}
                  onClick={() => setNewTagForm({ ...newTagForm, kind: 'principal', parent_id: '' })}
                >
                  ⭐ Principal
                </button>
                <button
                  type="button"
                  className={newTagForm.kind === 'secundaria' ? 'active' : ''}
                  onClick={() => setNewTagForm({ ...newTagForm, kind: 'secundaria' })}
                  disabled={dayTags.filter(t => !t.parent_id).length === 0}
                >
                  🔗 Secundaria
                </button>
              </div>

              {newTagForm.kind === 'secundaria' && (
                <select
                  value={newTagForm.parent_id}
                  onChange={e => setNewTagForm({ ...newTagForm, parent_id: e.target.value })}
                >
                  <option value="">Elige el grupo principal...</option>
                  {dayTags.filter(tag => !tag.parent_id).map(tag => (
                    <option key={tag.id} value={tag.id}>Dentro de "{tag.name}"</option>
                  ))}
                </select>
              )}

              <input
                placeholder="Nombre de la etiqueta (ej: Riego, Gratitud)"
                value={newTagForm.name}
                onChange={e => setNewTagForm({ ...newTagForm, name: e.target.value })}
              />

              <div className="tag-color-palette">
                {['#FDE68A', '#FBCFE8', '#BFDBFE', '#BBF7D0', '#FCA5A5', '#DDD6FE', '#FDBA74', '#A7F3D0', '#C7D2FE', '#F9A8D4'].map(color => (
                  <button
                    key={color}
                    type="button"
                    className={`tag-color-swatch ${newTagForm.color === color ? 'active' : ''}`}
                    style={{ background: color }}
                    onClick={() => setNewTagForm({ ...newTagForm, color })}
                  />
                ))}
              </div>

              <button type="submit">Agregar etiqueta</button>
            </form>
          </div>
          </>
        )}

            </div>
          </div>
        </div>
      )}
        </>
      )}

          {selectedDay && dayModalOpen && (
            <div className="admin-sheet-overlay" onClick={closeDayJournal}>
              <div className="day-panel day-panel-modal journal-panel" onClick={e => e.stopPropagation()}>
                <div className="journal-header">
                  <button type="button" className="journal-nav-btn" onClick={() => navigateDay(-1)}>←</button>
                  <label className="journal-date-label">
                    <h4>{formatDayHeader(selectedDay)}</h4>
                    <input
                      type="date"
                      value={selectedDay}
                      onChange={e => e.target.value && openDayJournal(e.target.value)}
                      className="journal-date-input"
                    />
                  </label>
                  <button type="button" className="journal-nav-btn" onClick={() => navigateDay(1)}>→</button>
                  <button type="button" className="modal-close-btn" onClick={closeDayJournal}>✕</button>
                </div>

                <div className="free-note-sheet">
                  {freeNoteBlocks.map((b, i) => (
                    <div key={i} className="note-sheet-block">
                      {b.type === 'text' && (
                        <textarea
                          className="note-sheet-block-edit"
                          value={b.content}
                          onChange={e => setFreeNoteBlocks(prev => prev.map((blk, idx) => idx === i ? { ...blk, content: e.target.value } : blk))}
                          rows={Math.max(2, Math.ceil(b.content.length / 40))}
                        />
                      )}
                      {b.type === 'photo' && <img src={b.url || URL.createObjectURL(b.file)} alt="" className="note-sheet-photo" />}
                      {b.type === 'video' && (
                        <video src={b.url || URL.createObjectURL(b.file)} controls className="note-video" />
                      )}
                      <button
                        type="button"
                        className="note-block-delete"
                        onClick={() => setFreeNoteBlocks(prev => prev.filter((_, idx) => idx !== i))}
                        title="Quitar este bloque"
                      >✕</button>
                    </div>
                  ))}
                  <textarea
                    className="note-sheet-textarea journal-textarea"
                    placeholder="Texto..."
                    rows={freeNoteBlocks.length > 0 ? 3 : 8}
                    value={freeNoteCurrentText}
                    onChange={e => setFreeNoteCurrentText(e.target.value)}
                    autoFocus
                  />
                  <div className="note-sheet-toolbar">
                    <label className="icon-btn" title="Agregar foto">
                      📷
                      <input
                        type="file"
                        accept="image/*"
                        style={{ display: 'none' }}
                        onChange={e => { insertPhotoBlockToNote(e.target.files[0]); e.target.value = '' }}
                      />
                    </label>
                    <label className="icon-btn" title="Agregar video">
                      🎥
                      <input
                        type="file"
                        accept="video/*"
                        style={{ display: 'none' }}
                        onChange={e => { insertVideoBlockToNote(e.target.files[0]); e.target.value = '' }}
                      />
                    </label>
                    <button type="button" className="icon-btn" title="Agregar etiqueta" onClick={() => setTagMenuOpen(true)}>🏷️</button>
                    {freeNoteBlocks.length > 0 && (
                      <button type="button" className="icon-btn-text" onClick={removeLastNoteBlock}>Deshacer</button>
                    )}
                    <button type="button" className="save-note-btn-inline" onClick={quickAddFreeNote} disabled={savingFreeNote}>
                      {savingFreeNote ? 'Guardando...' : 'Guardar'}
                    </button>
                  </div>
                </div>

                {tagMenuOpen && (
                  <div className="tag-menu-overlay" onClick={() => setTagMenuOpen(false)}>
                    <div className="tag-menu-panel" onClick={e => e.stopPropagation()}>
                      <div className="tag-menu-header">
                        <h4>Elegir etiqueta</h4>
                        <button type="button" className="modal-close-btn" onClick={() => setTagMenuOpen(false)}>✕</button>
                      </div>
                      <div className="tag-menu-list">
                        {dayTags.length === 0 && <p className="status-msg">Crea una etiqueta primero.</p>}
                        {dayTags.map(tag => (
                          <button
                            key={tag.id}
                            type="button"
                            className="tag-menu-item"
                            onClick={() => { quickAddTask(tag.id); setTagMenuOpen(false) }}
                          >
                            <span className="tag-menu-dot" style={{ background: tag.color }} />
                            {tag.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {(() => {
                  const others = dayEntries.filter(t => t.date === selectedDay && t.id !== editingTaskId)
                  if (others.length === 0) return null
                  return (
                    <>
                      <p className="filter-section-label" style={{ marginTop: 14 }}>Otras entradas de este día</p>
                      <div className="day-task-list">
                        {others.map(t => {
                          const tag = dayTags.find(g => g.id === t.tag_id)
                          const hasBlocks = t.content_blocks && t.content_blocks.length > 0
                          return (
                            <div key={t.id} className={`day-task-item ${hasBlocks ? 'has-media' : ''} ${t.done ? 'done' : ''}`}>
                              <div className="day-task-row">
                                {!hasBlocks && (
                                  <input
                                    type="checkbox"
                                    checked={!!t.done}
                                    onChange={() => toggleEntryDone(t)}
                                    title="Confirmar que se llevó a cabo"
                                  />
                                )}
                                <span className="task-tag-dot" style={{ background: tag?.color || (t.tag_id ? '#a1665e' : '#B5A88F') }} />
                                {!hasBlocks && <span className="task-tag-name">{tag?.name || (t.tag_id ? 'Etiqueta borrada' : '📝 Nota libre')}</span>}
                                {!hasBlocks && t.note && <span className="task-note">— {t.note}</span>}
                                {hasBlocks && <span className="task-tag-name">📝 Nota libre</span>}
                                {hasBlocks && <button type="button" className="task-edit-btn" onClick={() => openEditNote(t)}>✏️</button>}
                                {hasBlocks && <button type="button" className="task-edit-btn" onClick={() => shareEntry(t)} disabled={sharingNotes} title="Compartir">📲</button>}
                                {!hasBlocks && <button type="button" className="task-edit-btn" onClick={() => rescheduleTask(t)} title="Cambiar fecha">📅</button>}
                                <button type="button" className="task-delete-btn" onClick={() => deleteTask(t.id)}>✕</button>
                              </div>
                              {hasBlocks && (
                                <div className="note-blocks-view">
                                  {t.content_blocks.map((b, i) => (
                                    <div key={i}>
                                      {b.type === 'text' && <p className="task-note">{b.content}</p>}
                                      {b.type === 'photo' && <img src={b.url} alt="" className="note-block-photo" />}
                                      {b.type === 'video' && <video src={b.url} controls className="note-video" />}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    </>
                  )
                })()}
              </div>
            </div>
          )}

          {quickNoteModalOpen && (
            <div className="admin-sheet-overlay" onClick={() => setQuickNoteModalOpen(false)}>
              <div className="day-panel day-panel-modal journal-panel" onClick={e => e.stopPropagation()}>
                <div className="journal-header">
                  <input
                    className="journal-date-input"
                    style={{ position: 'static', flex: 1, fontWeight: 'bold', fontSize: '1.05rem' }}
                    placeholder="Título de la nota"
                    value={quickNoteTitle}
                    onChange={e => setQuickNoteTitle(e.target.value)}
                  />
                  <input
                    type="color"
                    value={quickNoteColor}
                    onChange={e => setQuickNoteColor(e.target.value)}
                    title="Elegir color"
                    style={{ width: 34, height: 34, border: 'none', background: 'none', padding: 0 }}
                  />
                  <button type="button" className="modal-close-btn" onClick={() => setQuickNoteModalOpen(false)}>✕</button>
                </div>

                <div className="free-note-sheet" style={{ background: quickNoteColor + '33' }}>
                  {quickNoteBlocks.map((b, i) => (
                    <div key={i} className="note-sheet-block">
                      {b.type === 'text' && <p>{b.content}</p>}
                      {b.type === 'photo' && <img src={b.url || URL.createObjectURL(b.file)} alt="" className="note-sheet-photo" />}
                      {b.type === 'video' && <video src={b.url || URL.createObjectURL(b.file)} controls className="note-video" />}
                      <button
                        type="button"
                        className="note-block-delete"
                        onClick={() => setQuickNoteBlocks(prev => prev.filter((_, idx) => idx !== i))}
                        title="Quitar este bloque"
                      >✕</button>
                    </div>
                  ))}
                  <textarea
                    className="note-sheet-textarea journal-textarea"
                    placeholder="Escribe aquí..."
                    rows={quickNoteBlocks.length > 0 ? 3 : 8}
                    value={quickNoteCurrentText}
                    onChange={e => setQuickNoteCurrentText(e.target.value)}
                    autoFocus
                  />
                  <div className="note-sheet-toolbar">
                    <label className="icon-btn" title="Agregar foto">
                      📷
                      <input
                        type="file"
                        accept="image/*"
                        style={{ display: 'none' }}
                        onChange={e => { insertPhotoBlockToQuickNote(e.target.files[0]); e.target.value = '' }}
                      />
                    </label>
                    <label className="icon-btn" title="Agregar video">
                      🎥
                      <input
                        type="file"
                        accept="video/*"
                        style={{ display: 'none' }}
                        onChange={e => { insertVideoBlockToQuickNote(e.target.files[0]); e.target.value = '' }}
                      />
                    </label>
                    {quickNoteBlocks.length > 0 && (
                      <button type="button" className="icon-btn-text" onClick={removeLastQuickNoteBlock}>Deshacer</button>
                    )}
                    <button type="button" className="save-note-btn-inline" onClick={saveQuickNoteFull} disabled={savingQuickNote}>
                      {savingQuickNote ? 'Guardando...' : 'Guardar'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

    </div>
  )
}
