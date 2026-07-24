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

  const [newCat
