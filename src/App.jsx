import { useEffect, useMemo, useState } from 'react'
import {
  BadgeDollarSign, BarChart3, Boxes, ChevronDown, CircleUserRound,
  CreditCard, LayoutDashboard, Menu, PackagePlus, ReceiptText, Search, Settings,
  ShoppingBag, ShoppingCart, Store, Users, WalletCards, X, Minus, Plus, CheckCircle2,
  AlertTriangle, ArrowUpRight, Sparkles, ShieldCheck, Building2, Truck, Phone, Mail,
} from 'lucide-react'
import { lowStock, money, purchaseTotal, saleTotal } from './lib/format'
import { supabase } from './lib/supabase'

const nav = [
  ['Visão geral', LayoutDashboard], ['PDV', ShoppingCart], ['Produtos', ShoppingBag],
  ['Estoque', Boxes], ['Compras', PackagePlus], ['Clientes', Users], ['Caixa', WalletCards],
  ['Financeiro', BadgeDollarSign], ['Relatórios', BarChart3], ['Equipe e acessos', CircleUserRound],
]

function App({ workspace }) {
  const [page, setPage] = useState('Visão geral')
  const [menuOpen, setMenuOpen] = useState(false)
  const [products, setProducts] = useState([])
  const [cart, setCart] = useState([])
  const [sales, setSales] = useState([])
  const [customers, setCustomers] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [purchases, setPurchases] = useState([])
  const [toast, setToast] = useState('')
  const [dataLoading, setDataLoading] = useState(true)

  const loadData = async () => {
    setDataLoading(true)
    const [productsResult, salesResult, customersResult, suppliersResult, purchasesResult] = await Promise.all([
      supabase.from('products').select('*').eq('store_id', workspace.store.id).eq('active', true).order('name'),
      supabase.from('sales').select('*').eq('store_id', workspace.store.id).order('sold_at', { ascending: false }).limit(50),
      supabase.from('customers').select('*').eq('store_id', workspace.store.id).eq('active', true).order('name'),
      supabase.from('suppliers').select('*').eq('store_id', workspace.store.id).eq('active', true).order('name'),
      supabase.from('purchases').select('*').eq('store_id', workspace.store.id).order('received_at', { ascending: false }).limit(50),
    ])
    if ([productsResult, salesResult, customersResult, suppliersResult, purchasesResult].some((result) => result.error)) notify('Não foi possível atualizar todos os dados da loja.')
    setProducts((productsResult.data || []).map(mapProduct))
    setSales((salesResult.data || []).map(mapSale))
    setCustomers(customersResult.data || [])
    setSuppliers(suppliersResult.data || [])
    setPurchases((purchasesResult.data || []).map(mapPurchase))
    setDataLoading(false)
  }

  useEffect(() => { loadData() }, [workspace.store.id])

  const changePage = (next) => { setPage(next); setMenuOpen(false) }
  const notify = (message) => { setToast(message); window.setTimeout(() => setToast(''), 2600) }

  const addToCart = (product) => {
    if (product.stock < 1) return notify('Produto sem estoque disponível.')
    setCart((items) => {
      const current = items.find((item) => item.id === product.id)
      if (current && current.qty >= product.stock) return items
      return current
        ? items.map((item) => item.id === product.id ? { ...item, qty: item.qty + 1 } : item)
        : [...items, { ...product, qty: 1 }]
    })
  }

  const setQty = (id, delta) => setCart((items) => items
    .map((item) => item.id === id ? { ...item, qty: Math.min(item.stock, item.qty + delta) } : item)
    .filter((item) => item.qty > 0))

  const finishSale = async (payment, customerId) => {
    if (!cart.length) return
    const total = saleTotal(cart)
    const { error } = await supabase.rpc('complete_sale_v2', {
      p_store_id: workspace.store.id,
      p_payment_method: payment,
      p_customer_id: customerId || null,
      p_items: cart.map((item) => ({ product_id: item.id, quantity: item.qty })),
    })
    if (error) return notify(error.message.includes('Estoque insuficiente') ? error.message : 'Não foi possível concluir a venda.')
    setCart([])
    await loadData()
    notify(`Venda de ${money(total)} concluída em ${payment}.`)
  }

  const createProduct = async (values) => {
    const { error } = await supabase.rpc('create_product', {
      p_store_id: workspace.store.id,
      p_sku: values.sku,
      p_name: values.name,
      p_category: values.category,
      p_cost_cents: Math.round(Number(values.cost) * 100),
      p_price_cents: Math.round(Number(values.price) * 100),
      p_stock_quantity: Number(values.stock),
      p_min_stock: Number(values.min),
      p_color: values.color,
    })
    if (error) {
      notify(error.message.includes('products_store_id_sku_key') ? 'Já existe um produto com este código.' : 'Não foi possível cadastrar o produto.')
      return false
    }
    await loadData(); notify('Produto cadastrado com estoque inicial registrado.'); return true
  }

  const adjustStock = async (productId, quantityDelta, reason) => {
    const { error } = await supabase.rpc('adjust_product_stock', {
      p_product_id: productId,
      p_quantity_delta: Number(quantityDelta),
      p_reason: reason,
    })
    if (error) { notify('Não foi possível registrar este ajuste de estoque.'); return false }
    await loadData(); notify('Movimentação de estoque registrada.'); return true
  }

  const createCustomer = async (values) => {
    const { data: userData } = await supabase.auth.getUser()
    const { error } = await supabase.from('customers').insert({
      store_id: workspace.store.id, name: values.name.trim(), phone: values.phone.trim(),
      email: values.email.trim(), notes: values.notes.trim(), created_by: userData.user?.id,
    })
    if (error) { notify('Não foi possível cadastrar o cliente.'); return false }
    await loadData(); notify('Cliente cadastrado.'); return true
  }

  const createSupplier = async (values) => {
    const { data: userData } = await supabase.auth.getUser()
    const { data, error } = await supabase.from('suppliers').insert({
      store_id: workspace.store.id, name: values.name.trim(), contact_name: values.contact.trim(),
      phone: values.phone.trim(), email: values.email.trim(), created_by: userData.user?.id,
    }).select().single()
    if (error) { notify('Não foi possível cadastrar o fornecedor.'); return null }
    await loadData(); notify('Fornecedor cadastrado.'); return data
  }

  const receivePurchase = async (values) => {
    const { error } = await supabase.rpc('receive_purchase', {
      p_store_id: workspace.store.id, p_supplier_id: values.supplierId,
      p_document_number: values.document, p_notes: values.notes,
      p_items: values.items.map((item) => ({ product_id: item.productId, quantity: Number(item.quantity), unit_cost_cents: Math.round(Number(item.cost) * 100) })),
    })
    if (error) { notify('Não foi possível registrar a compra. Confira os itens.'); return false }
    await loadData(); notify('Compra recebida e estoque atualizado.'); return true
  }

  const navigation = workspace.isPlatformAdmin ? [['Central Anyma', ShieldCheck], ...nav] : nav

  return (
    <div className="app-shell">
      <aside className={menuOpen ? 'sidebar open' : 'sidebar'}>
        <button className="mobile-close" onClick={() => setMenuOpen(false)} aria-label="Fechar menu"><X /></button>
        <div className="brand"><span className="brand-mark">A</span><div><strong>ANYMA</strong><small>gestão para lojas</small></div></div>
        <nav>{navigation.map(([label, Icon]) => <button key={label} className={page === label ? 'active' : ''} onClick={() => changePage(label)}><Icon size={19}/><span>{label}</span>{label === 'Estoque' && lowStock(products).length > 0 && <b>{lowStock(products).length}</b>}</button>)}</nav>
        <div className="sidebar-bottom"><div className="store-card"><Store size={18}/><div><strong>{workspace.store.name}</strong><span>{roleLabel(workspace.role)}</span></div></div>{workspace.isPlatformAdmin && <label className="store-switcher"><span>LOJA EM TESTE</span><select value={workspace.store.id} onChange={(event) => workspace.switchStore(event.target.value)}>{workspace.stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</select></label>}<button className="settings"><Settings size={18}/>Configurações</button></div>
      </aside>
      {menuOpen && <button className="scrim" onClick={() => setMenuOpen(false)} aria-label="Fechar menu" />}

      <main>
        <header className="topbar">
          <button className="mobile-menu" onClick={() => setMenuOpen(true)} aria-label="Abrir menu"><Menu /></button>
          <div><span className="eyebrow">{new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date()).toUpperCase()}</span><h1>{page}</h1></div>
          <div className="top-actions"><label className="search"><Search size={18}/><input placeholder="Buscar na Anyma..." /></label><button className="profile" onClick={() => supabase.auth.signOut()} title="Sair"><span>{initials(workspace.profile?.full_name)}</span><div><strong>{workspace.profile?.full_name}</strong><small>{roleLabel(workspace.role)} · sair</small></div></button></div>
        </header>

        <div className="content">
          {dataLoading && <div className="loading-line" />}
          {workspace.isPlatformAdmin && <div className="admin-access-banner"><ShieldCheck size={18}/><div><strong>Acesso global de testes ativo</strong><span>Você está visualizando {workspace.store.name}. Cada troca de loja fica registrada.</span></div></div>}
          {page === 'Central Anyma' && <PlatformCentral workspace={workspace} />}
          {page === 'Visão geral' && <Dashboard products={products} sales={sales} goTo={changePage} />}
          {page === 'PDV' && <POS products={products} customers={customers} cart={cart} add={addToCart} setQty={setQty} finish={finishSale} />}
          {page === 'Produtos' && <Products products={products} add={addToCart} goTo={changePage} createProduct={createProduct} />}
          {page === 'Estoque' && <Inventory products={products} adjustStock={adjustStock} />}
          {page === 'Clientes' && <Customers customers={customers} createCustomer={createCustomer} />}
          {page === 'Caixa' && <Cashier sales={sales} workspace={workspace} />}
          {page === 'Financeiro' && <Finance sales={sales} />}
          {page === 'Relatórios' && <Reports products={products} sales={sales} />}
          {page === 'Compras' && <Purchases products={products} suppliers={suppliers} purchases={purchases} createSupplier={createSupplier} receivePurchase={receivePurchase} />}
          {page === 'Equipe e acessos' && <Team workspace={workspace} />}
        </div>
      </main>
      {toast && <div className="toast"><CheckCircle2 size={19}/>{toast}</div>}
    </div>
  )
}

function Dashboard({ products, sales, goTo }) {
  const revenue = sales.reduce((sum, sale) => sum + sale.total, 0)
  const alerts = lowStock(products)
  const chartData = lastSevenDays(sales)
  const max = Math.max(1, ...chartData.map((item) => item.value))
  return <>
    <section className="welcome"><div><span className="live-dot">Caixa aberto</span><h2>O pulso da sua loja, agora.</h2><p>Vendas, estoque e decisões importantes reunidas numa leitura simples.</p></div><button className="primary" onClick={() => goTo('PDV')}><ShoppingCart size={18}/>Nova venda</button></section>
    <section className="metrics">
      <Metric label="Vendas hoje" value={money(revenue)} note="12,4% acima de ontem" positive />
      <Metric label="Ticket médio" value={money(sales.length ? revenue / sales.length : 0)} note={`${sales.length} vendas concluídas`} />
      <Metric label="Itens em estoque" value={products.reduce((s,p) => s + p.stock, 0)} note={`${alerts.length} pedem reposição`} warning={alerts.length > 0} />
      <Metric label="Margem estimada" value="52,8%" note="Dentro da meta da loja" positive />
    </section>
    <section className="dashboard-grid">
      <article className="panel revenue-panel"><div className="panel-head"><div><span className="section-label">DESEMPENHO</span><h3>Vendas nos últimos 7 dias</h3></div><button className="text-btn" onClick={() => goTo('Relatórios')}>Ver relatório <ArrowUpRight size={16}/></button></div><div className="chart"><div className="chart-scale"><span>{money(max)}</span><span>{money(max/2)}</span><span>R$ 0</span></div>{chartData.map(item => <div className="bar-wrap" key={item.key}><div className={item.today ? 'bar current' : 'bar'} style={{height: item.value ? `${Math.max(4,(item.value/max)*100)}%` : '2px'}} title={money(item.value)} /><span>{item.day}</span></div>)}</div></article>
      <article className="panel attention"><div className="panel-head"><div><span className="section-label">ATENÇÃO AGORA</span><h3>O que pede uma decisão</h3></div><span className="count">{alerts.length}</span></div>{alerts.map(item => <div className="alert-row" key={item.id}><span className="product-swatch" style={{background:item.color}}/><div><strong>{item.name}</strong><span>{item.stock} un. · mínimo {item.min}</span></div><button onClick={() => goTo('Estoque')}>Repor</button></div>)}<div className="insight"><Sparkles size={18}/><p><strong>Leitura Anyma</strong> A Camisa Essencial tem giro alto e pode acabar antes do próximo fim de semana.</p></div></article>
    </section>
    <section className="panel"><div className="panel-head"><div><span className="section-label">MOVIMENTO RECENTE</span><h3>Últimas vendas</h3></div><button className="text-btn" onClick={() => goTo('Caixa')}>Abrir caixa <ArrowUpRight size={16}/></button></div><SalesTable sales={sales.slice(0,4)} /></section>
  </>
}

function PlatformCentral({ workspace }) {
  return <>
    <section className="platform-hero"><div><span className="section-label">CAMACHO TECNOLOGIA</span><h2>Central de controle da Anyma</h2><p>Escolha uma loja para testar o ambiente exatamente como ele está salvo no banco.</p></div><ShieldCheck /></section>
    <section className="platform-stores">{workspace.stores.map((store) => <article key={store.id} className={store.id === workspace.store.id ? 'platform-store active' : 'platform-store'}><Building2/><div><strong>{store.name}</strong><span>{store.slug}</span></div><button className="secondary" disabled={store.id === workspace.store.id} onClick={() => workspace.switchStore(store.id)}>{store.id === workspace.store.id ? 'Loja atual' : 'Acessar loja'}</button></article>)}</section>
    <div className="security-note safe"><CheckCircle2 size={19}/><p>Os clientes permanecem isolados entre si. Somente sua conta de Superadministrador enxerga todas as lojas durante os testes.</p></div>
  </>
}

function Metric({ label, value, note, positive, warning }) { return <article className="metric"><span>{label}</span><strong>{value}</strong><small className={positive ? 'positive' : warning ? 'warning' : ''}>{positive && 'Alta · '}{warning && 'Atenção · '}{note}</small></article> }

function POS({ products, customers, cart, add, setQty, finish }) {
  const [query, setQuery] = useState('')
  const [payment, setPayment] = useState('Pix')
  const [customerId, setCustomerId] = useState('')
  const shown = products.filter(p => p.name.toLowerCase().includes(query.toLowerCase()) || p.sku.toLowerCase().includes(query.toLowerCase()))
  const total = saleTotal(cart)
  return <div className="pos-layout"><section><div className="page-intro"><div><span className="section-label">VENDA RÁPIDA</span><h2>Escolha os produtos</h2></div><label className="search large"><Search size={18}/><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Nome, código ou categoria" /></label></div><div className="product-grid">{shown.map(product => <button className="product-card" key={product.id} onClick={() => add(product)}><span className="product-photo" style={{'--tone':product.color}}><ShoppingBag /></span><span className="category">{product.category}</span><strong>{product.name}</strong><small>{product.sku} · {product.stock} un.</small><b>{money(product.price)}</b><i><Plus size={17}/></i></button>)}</div></section><aside className="cart"><div className="cart-head"><div><span className="section-label">VENDA ATUAL</span><h3>Carrinho</h3></div><span>{cart.reduce((s,i)=>s+i.qty,0)} itens</span></div>{!cart.length ? <div className="empty-cart"><ShoppingCart/><strong>Carrinho vazio</strong><p>Toque em um produto para iniciar a venda.</p></div> : <><div className="cart-items">{cart.map(item => <div className="cart-row" key={item.id}><span className="mini-swatch" style={{background:item.color}}/><div><strong>{item.name}</strong><small>{money(item.price)}</small></div><div className="qty"><button onClick={() => setQty(item.id,-1)}><Minus/></button><span>{item.qty}</span><button onClick={() => setQty(item.id,1)}><Plus/></button></div></div>)}</div><label className="cart-select">Cliente<select value={customerId} onChange={(event) => setCustomerId(event.target.value)}><option value="">Consumidor final</option>{customers.map((customer) => <option value={customer.id} key={customer.id}>{customer.name}</option>)}</select></label><div className="payment"><span>Forma de pagamento</span><div>{['Pix','Crédito','Débito','Dinheiro'].map(type => <button className={payment===type?'selected':''} key={type} onClick={() => setPayment(type)}>{type}</button>)}</div></div><div className="total"><span>Total</span><strong>{money(total)}</strong></div><button className="finish" onClick={async () => { await finish(payment, customerId); setCustomerId('') }}><CheckCircle2/>Finalizar venda</button></>}</aside></div>
}

function Products({ products, add, goTo, createProduct }) {
  const [open, setOpen] = useState(false)
  return <>
    {open && <ProductForm onCancel={() => setOpen(false)} onSave={async (values) => { if (await createProduct(values)) setOpen(false) }} />}
    <section className="panel"><div className="panel-head"><div><span className="section-label">CATÁLOGO REAL</span><h3>{products.length} produtos ativos</h3></div><div className="panel-actions"><button className="secondary" onClick={() => setOpen(true)}><PackagePlus size={17}/>Novo produto</button><button className="primary" onClick={() => goTo('PDV')}><ShoppingCart size={18}/>Abrir PDV</button></div></div>
      {!products.length ? <EmptyState title="Seu catálogo está vazio" text="Cadastre o primeiro produto para liberar vendas e controle de estoque." action="Cadastrar produto" onAction={() => setOpen(true)} /> : <div className="catalog">{products.map(product => <div className="catalog-row" key={product.id}><span className="product-swatch big" style={{background:product.color}}/><div><strong>{product.name}</strong><span>{product.sku} · {product.category}</span></div><span>{money(product.cost)} custo</span><b>{money(product.price)}</b><span className={product.stock <= product.min ? 'stock low' : 'stock'}>{product.stock} un.</span><button className="icon-btn" onClick={() => add(product)} title="Adicionar ao carrinho"><Plus/></button></div>)}</div>}
    </section>
  </>
}

function ProductForm({ onCancel, onSave }) {
  const [values, setValues] = useState({ sku: '', name: '', category: '', cost: '', price: '', stock: '0', min: '0', color: '#70745a' })
  const [saving, setSaving] = useState(false)
  const update = (field) => (event) => setValues((current) => ({ ...current, [field]: event.target.value }))
  return <div className="modal-backdrop"><form className="modal" onSubmit={async (event) => { event.preventDefault(); setSaving(true); await onSave(values); setSaving(false) }}>
    <div className="panel-head"><div><span className="section-label">CATÁLOGO</span><h3>Novo produto</h3></div><button type="button" className="icon-btn" onClick={onCancel}><X/></button></div>
    <div className="form-grid"><label>Código / SKU<input required maxLength="60" value={values.sku} onChange={update('sku')} /></label><label>Nome<input required maxLength="160" value={values.name} onChange={update('name')} /></label><label>Categoria<input required maxLength="80" value={values.category} onChange={update('category')} /></label><label>Cor de referência<input type="color" value={values.color} onChange={update('color')} /></label><label>Custo (R$)<input required min="0" step="0.01" type="number" value={values.cost} onChange={update('cost')} /></label><label>Preço de venda (R$)<input required min="0" step="0.01" type="number" value={values.price} onChange={update('price')} /></label><label>Estoque inicial<input required min="0" step="1" type="number" value={values.stock} onChange={update('stock')} /></label><label>Estoque mínimo<input required min="0" step="1" type="number" value={values.min} onChange={update('min')} /></label></div>
    <div className="modal-actions"><button type="button" className="secondary" onClick={onCancel}>Cancelar</button><button className="primary" disabled={saving}>{saving ? 'Salvando...' : 'Cadastrar produto'}</button></div>
  </form></div>
}

function Inventory({ products, adjustStock }) {
  const [editing, setEditing] = useState(null)
  return <><div className="page-intro"><div><span className="section-label">CONTROLE DE ESTOQUE</span><h2>Reposição sem surpresa</h2><p>Cada entrada ou correção gera uma movimentação auditável.</p></div></div>
    {!products.length ? <EmptyState title="Nenhum produto em estoque" text="Cadastre um produto para começar." /> : <section className="inventory-grid">{products.map(p => { const percent = Math.min(100, p.stock / (Math.max(1,p.min)*3) * 100); const low = p.stock <= p.min; return <article className="inventory-card" key={p.id}><div><span className="product-swatch big" style={{background:p.color}}/><span className={low?'status danger':'status'}>{low?'Repor':'Saudável'}</span></div><strong>{p.name}</strong><small>{p.sku} · mínimo {p.min}</small><div className="stock-number"><b>{p.stock}</b><span>unidades</span></div><div className="progress"><i className={low?'low':''} style={{width:`${percent}%`}}/></div><button className="secondary stock-action" onClick={() => setEditing(editing === p.id ? null : p.id)}>Registrar movimentação</button>{editing === p.id && <StockForm onSave={async (delta, reason) => { if (await adjustStock(p.id, delta, reason)) setEditing(null) }} />}</article> })}</section>}
  </>
}

function StockForm({ onSave }) {
  const [delta, setDelta] = useState('1')
  const [reason, setReason] = useState('Reposição de estoque')
  return <form className="stock-form" onSubmit={(event) => { event.preventDefault(); onSave(delta, reason) }}><label>Quantidade (+ entrada / − saída)<input required type="number" step="1" value={delta} onChange={(event) => setDelta(event.target.value)} /></label><label>Motivo<input required maxLength="240" value={reason} onChange={(event) => setReason(event.target.value)} /></label><button className="primary">Registrar</button></form>
}

function Customers({ customers, createCustomer }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const shown = customers.filter((customer) => [customer.name, customer.phone, customer.email].some((value) => value.toLowerCase().includes(query.toLowerCase())))
  return <>
    {open && <CustomerForm onCancel={() => setOpen(false)} onSave={async (values) => { if (await createCustomer(values)) setOpen(false) }} />}
    <div className="page-intro"><div><span className="section-label">RELACIONAMENTO</span><h2>Clientes da loja</h2><p>Cadastros reais, vinculados somente a esta loja.</p></div><div className="panel-actions"><label className="search large"><Search size={18}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar nome, telefone ou e-mail" /></label><button className="primary" onClick={() => setOpen(true)}><Users size={18}/>Novo cliente</button></div></div>
    <section className="panel">{!shown.length ? <EmptyState title={query ? 'Nenhum cliente encontrado' : 'Nenhum cliente cadastrado'} text={query ? 'Tente outro nome, telefone ou e-mail.' : 'Cadastre o primeiro cliente para identificá-lo no PDV e manter o histórico de compras.'} action={!query ? 'Cadastrar cliente' : undefined} onAction={() => setOpen(true)} /> : <div className="customer-list">{shown.map((customer) => <article className="customer-record" key={customer.id}><span>{initials(customer.name)}</span><div><strong>{customer.name}</strong><small>{customer.notes || 'Sem observações'}</small></div><div><Phone size={14}/><span>{customer.phone || 'Não informado'}</span></div><div><Mail size={14}/><span>{customer.email || 'Não informado'}</span></div></article>)}</div>}</section>
  </>
}

function CustomerForm({ onCancel, onSave }) {
  const [values, setValues] = useState({ name: '', phone: '', email: '', notes: '' })
  const [saving, setSaving] = useState(false)
  const update = (field) => (event) => setValues((current) => ({ ...current, [field]: event.target.value }))
  return <div className="modal-backdrop"><form className="modal" onSubmit={async (event) => { event.preventDefault(); setSaving(true); await onSave(values); setSaving(false) }}><div className="panel-head"><div><span className="section-label">CLIENTES</span><h3>Novo cliente</h3></div><button type="button" className="icon-btn" onClick={onCancel}><X/></button></div><div className="form-grid"><label>Nome completo<input required minLength="2" maxLength="160" value={values.name} onChange={update('name')} /></label><label>Telefone<input maxLength="30" value={values.phone} onChange={update('phone')} placeholder="(77) 9 9999-9999" /></label><label>E-mail<input type="email" maxLength="180" value={values.email} onChange={update('email')} /></label><label className="wide-field">Observações<input maxLength="500" value={values.notes} onChange={update('notes')} placeholder="Preferências, tamanho ou informação útil" /></label></div><div className="modal-actions"><button type="button" className="secondary" onClick={onCancel}>Cancelar</button><button className="primary" disabled={saving}>{saving ? 'Salvando...' : 'Cadastrar cliente'}</button></div></form></div>
}

function Purchases({ products, suppliers, purchases, createSupplier, receivePurchase }) {
  const [purchaseOpen, setPurchaseOpen] = useState(false)
  const [supplierOpen, setSupplierOpen] = useState(false)
  return <>
    {supplierOpen && <SupplierForm onCancel={() => setSupplierOpen(false)} onSave={async (values) => { if (await createSupplier(values)) setSupplierOpen(false) }} />}
    {purchaseOpen && <PurchaseForm products={products} suppliers={suppliers} onCancel={() => setPurchaseOpen(false)} onSave={async (values) => { if (await receivePurchase(values)) setPurchaseOpen(false) }} />}
    <div className="page-intro"><div><span className="section-label">ABASTECIMENTO</span><h2>Compras e fornecedores</h2><p>Receba mercadorias com custo, histórico e entrada automática no estoque.</p></div><div className="panel-actions"><button className="secondary" onClick={() => setSupplierOpen(true)}><Truck size={17}/>Novo fornecedor</button><button className="primary" disabled={!products.length || !suppliers.length} onClick={() => setPurchaseOpen(true)}><PackagePlus size={17}/>Registrar compra</button></div></div>
    {(!products.length || !suppliers.length) && <div className="security-note"><AlertTriangle size={19}/><p>Para registrar uma compra, cadastre pelo menos um produto e um fornecedor. O botão será liberado automaticamente.</p></div>}
    <section className="purchase-summary"><article><span>Compras registradas</span><strong>{purchases.length}</strong></article><article><span>Total recebido</span><strong>{money(purchases.reduce((sum, purchase) => sum + purchase.total, 0))}</strong></article><article><span>Fornecedores ativos</span><strong>{suppliers.length}</strong></article></section>
    <section className="panel"><div className="panel-head"><div><span className="section-label">HISTÓRICO</span><h3>Recebimentos recentes</h3></div></div>{!purchases.length ? <EmptyState title="Nenhuma compra registrada" text="A primeira compra recebida aparecerá aqui e atualizará o estoque dos produtos." /> : <div className="purchase-list">{purchases.map((purchase) => <article key={purchase.id}><span className="purchase-id">#{purchase.id.slice(0, 6).toUpperCase()}</span><div><strong>{purchase.supplier}</strong><small>{purchase.document || 'Sem número de documento'}</small></div><span>{purchase.date}</span><strong>{money(purchase.total)}</strong><em>Recebida</em></article>)}</div>}</section>
  </>
}

function SupplierForm({ onCancel, onSave }) {
  const [values, setValues] = useState({ name: '', contact: '', phone: '', email: '' })
  const [saving, setSaving] = useState(false)
  const update = (field) => (event) => setValues((current) => ({ ...current, [field]: event.target.value }))
  return <div className="modal-backdrop"><form className="modal" onSubmit={async (event) => { event.preventDefault(); setSaving(true); await onSave(values); setSaving(false) }}><div className="panel-head"><div><span className="section-label">FORNECEDORES</span><h3>Novo fornecedor</h3></div><button type="button" className="icon-btn" onClick={onCancel}><X/></button></div><div className="form-grid"><label>Empresa / fornecedor<input required minLength="2" maxLength="160" value={values.name} onChange={update('name')} /></label><label>Pessoa de contato<input maxLength="120" value={values.contact} onChange={update('contact')} /></label><label>Telefone<input maxLength="30" value={values.phone} onChange={update('phone')} /></label><label>E-mail<input type="email" maxLength="180" value={values.email} onChange={update('email')} /></label></div><div className="modal-actions"><button type="button" className="secondary" onClick={onCancel}>Cancelar</button><button className="primary" disabled={saving}>{saving ? 'Salvando...' : 'Cadastrar fornecedor'}</button></div></form></div>
}

function PurchaseForm({ products, suppliers, onCancel, onSave }) {
  const [supplierId, setSupplierId] = useState(suppliers[0]?.id || '')
  const [document, setDocument] = useState('')
  const [notes, setNotes] = useState('')
  const [items, setItems] = useState([{ productId: products[0]?.id || '', quantity: '1', cost: products[0]?.cost?.toFixed(2) || '0.00' }])
  const [saving, setSaving] = useState(false)
  const updateItem = (index, field, value) => setItems((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, [field]: value } : item))
  const total = purchaseTotal(items)
  return <div className="modal-backdrop"><form className="modal purchase-modal" onSubmit={async (event) => { event.preventDefault(); setSaving(true); await onSave({ supplierId, document, notes, items }); setSaving(false) }}><div className="panel-head"><div><span className="section-label">ENTRADA DE MERCADORIA</span><h3>Registrar compra recebida</h3></div><button type="button" className="icon-btn" onClick={onCancel}><X/></button></div><div className="form-grid"><label>Fornecedor<select required value={supplierId} onChange={(event) => setSupplierId(event.target.value)}>{suppliers.map((supplier) => <option value={supplier.id} key={supplier.id}>{supplier.name}</option>)}</select></label><label>Número da nota/pedido<input maxLength="80" value={document} onChange={(event) => setDocument(event.target.value)} /></label></div><div className="purchase-items"><div className="purchase-items-head"><strong>Itens recebidos</strong><button type="button" className="secondary" onClick={() => setItems((current) => [...current, { productId: products[0]?.id || '', quantity: '1', cost: products[0]?.cost?.toFixed(2) || '0.00' }])}><Plus size={15}/>Adicionar item</button></div>{items.map((item, index) => <div className="purchase-item" key={index}><label>Produto<select required value={item.productId} onChange={(event) => updateItem(index, 'productId', event.target.value)}>{products.map((product) => <option value={product.id} key={product.id}>{product.name} · {product.sku}</option>)}</select></label><label>Quantidade<input required min="1" step="1" type="number" value={item.quantity} onChange={(event) => updateItem(index, 'quantity', event.target.value)} /></label><label>Custo unitário<input required min="0" step="0.01" type="number" value={item.cost} onChange={(event) => updateItem(index, 'cost', event.target.value)} /></label><button type="button" className="icon-btn" disabled={items.length === 1} onClick={() => setItems((current) => current.filter((_, itemIndex) => itemIndex !== index))}><X/></button></div>)}</div><label className="modal-note">Observações<input maxLength="500" value={notes} onChange={(event) => setNotes(event.target.value)} /></label><div className="purchase-total"><span>Total da compra</span><strong>{money(total)}</strong></div><div className="modal-actions"><button type="button" className="secondary" onClick={onCancel}>Cancelar</button><button className="primary" disabled={saving}>{saving ? 'Registrando...' : 'Confirmar recebimento'}</button></div></form></div>
}

function Cashier({ sales, workspace }) { const total = sales.reduce((s,v)=>s+v.total,0); return <><div className="cash-hero"><div><span className="live-dot">Movimento registrado</span><h2>Vendas de {workspace.store.name}</h2><p>Operador atual: {workspace.profile?.full_name}</p></div><div><span>Total das vendas carregadas</span><strong>{money(total)}</strong><small>sem valor fictício de abertura</small></div></div><section className="panel"><div className="panel-head"><h3>Movimentações recentes</h3><span className="pill">{sales.length} vendas</span></div><SalesTable sales={sales}/></section></> }

function Finance({ sales }) { const revenue=sales.reduce((s,v)=>s+v.total,0); return <><section className="metrics"><Metric label="Entradas previstas" value={money(revenue+2840)} note="Este mês" positive/><Metric label="Saídas previstas" value={money(1930)} note="Compras e despesas"/><Metric label="Saldo projetado" value={money(revenue+910)} note="Até 31 de agosto" positive/><Metric label="Contas vencendo" value="3" note="R$ 860,00 nos próximos 7 dias" warning/></section><Placeholder icon={CreditCard} title="Agenda financeira" text="Contas a pagar, recebimentos e conciliação aparecem aqui em uma única linha do tempo." action="Novo lançamento" /></> }

function Reports({ products, sales }) { const top=[...products].sort((a,b)=>b.price*b.stock-a.price*a.stock).slice(0,4); return <div className="report-grid"><section className="panel"><div className="panel-head"><div><span className="section-label">RESULTADOS</span><h3>Resumo comercial</h3></div><button className="secondary"><ReceiptText size={17}/>Exportar</button></div><div className="report-summary"><div><span>Faturamento</span><strong>{money(sales.reduce((s,v)=>s+v.total,0))}</strong></div><div><span>Produtos vendidos</span><strong>{sales.length+6}</strong></div><div><span>Estoque a preço de venda</span><strong>{money(products.reduce((s,p)=>s+p.price*p.stock,0))}</strong></div></div></section><section className="panel"><span className="section-label">MAIOR POTENCIAL</span><h3>Produtos em destaque</h3>{top.map((p,i)=><div className="rank" key={p.id}><b>0{i+1}</b><span className="product-swatch" style={{background:p.color}}/><div><strong>{p.name}</strong><span>{p.stock} unidades disponíveis</span></div><em>{money(p.price*p.stock)}</em></div>)}</section></div> }

function Team({ workspace }) { return <section className="panel"><div className="panel-head"><div><span className="section-label">SEGURANÇA E OPERAÇÃO</span><h3>Equipe e níveis de acesso</h3></div><button className="secondary" disabled><Users size={18}/>Convites no próximo bloco</button></div><div className="team-list"><div><span>{initials(workspace.profile?.full_name)}</span><div><strong>{workspace.profile?.full_name}</strong><small>Acesso protegido por autenticação</small></div><b>{roleLabel(workspace.role)}</b><em>Ativo</em></div></div><div className="security-note safe"><CheckCircle2 size={19}/><p>Autenticação e isolamento entre lojas estão ativos no banco. Convites e gestão de outros usuários ainda não foram liberados.</p></div></section> }

function Placeholder({ icon:Icon, title, text, action }) { return <section className="panel placeholder"><span><Icon/></span><h2>{title}</h2><p>{text}</p><button className="primary">{action}</button></section> }

function SalesTable({ sales }) { return <div className="table"><div className="table-head"><span>Venda</span><span>Horário</span><span>Cliente</span><span>Pagamento</span><span>Total</span><span>Status</span></div>{sales.map(sale=><div className="table-row" key={sale.id}><b>{sale.id}</b><span>{sale.time}</span><span>{sale.customer}</span><span>{sale.payment}</span><strong>{money(sale.total)}</strong><em>{sale.status}</em></div>)}</div> }

function EmptyState({ title, text, action, onAction }) { return <div className="empty-state"><ShoppingBag/><strong>{title}</strong><p>{text}</p>{action && <button className="primary" onClick={onAction}>{action}</button>}</div> }

function mapProduct(row) {
  return { id: row.id, sku: row.sku, name: row.name, category: row.category, cost: row.cost_cents / 100, price: row.price_cents / 100, stock: row.stock_quantity, min: row.min_stock, color: row.color }
}

function mapSale(row) {
  const soldAt = new Date(row.sold_at)
  return { id: `#${row.id.slice(0, 6).toUpperCase()}`, time: soldAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }), customer: row.customer_name, payment: row.payment_method, total: row.total_cents / 100, status: 'Concluída', soldAt }
}

function mapPurchase(row) {
  return { id: row.id, supplier: row.supplier_name, document: row.document_number, total: row.total_cents / 100, date: new Date(row.received_at).toLocaleDateString('pt-BR') }
}

function lastSevenDays(sales) {
  const result = []
  const formatter = new Intl.DateTimeFormat('pt-BR', { weekday: 'short' })
  for (let offset = 6; offset >= 0; offset -= 1) {
    const date = new Date(); date.setHours(0, 0, 0, 0); date.setDate(date.getDate() - offset)
    const next = new Date(date); next.setDate(next.getDate() + 1)
    result.push({ key: date.toISOString(), day: offset === 0 ? 'Hoje' : formatter.format(date).replace('.', ''), today: offset === 0, value: sales.filter((sale) => sale.soldAt >= date && sale.soldAt < next).reduce((sum, sale) => sum + sale.total, 0) })
  }
  return result
}

function initials(name = '') { return name.split(' ').filter(Boolean).map((part) => part[0]).slice(0, 2).join('').toUpperCase() || 'U' }
function roleLabel(role) { return ({ superadmin: 'Superadministrador', owner: 'Proprietário', admin: 'Administrador', manager: 'Gerente', operator: 'Operador', viewer: 'Consulta' })[role] || 'Usuário' }

export default App
