import { useEffect, useMemo, useState } from 'react'
import {
  BadgeDollarSign, BarChart3, Boxes, ChevronDown, CircleUserRound, ClipboardList,
  CreditCard, LayoutDashboard, Menu, PackagePlus, ReceiptText, Search, Settings,
  ShoppingBag, ShoppingCart, Store, Users, WalletCards, X, Minus, Plus, CheckCircle2,
  AlertTriangle, ArrowUpRight, Sparkles,
} from 'lucide-react'
import { lowStock, money, saleTotal } from './lib/format'
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
  const [toast, setToast] = useState('')
  const [dataLoading, setDataLoading] = useState(true)

  const loadData = async () => {
    setDataLoading(true)
    const [{ data: productRows, error: productsError }, { data: saleRows, error: salesError }] = await Promise.all([
      supabase.from('products').select('*').eq('store_id', workspace.store.id).eq('active', true).order('name'),
      supabase.from('sales').select('*').eq('store_id', workspace.store.id).order('sold_at', { ascending: false }).limit(50),
    ])
    if (productsError || salesError) notify('Não foi possível atualizar todos os dados da loja.')
    setProducts((productRows || []).map(mapProduct))
    setSales((saleRows || []).map(mapSale))
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

  const finishSale = async (payment) => {
    if (!cart.length) return
    const total = saleTotal(cart)
    const { error } = await supabase.rpc('complete_sale', {
      p_store_id: workspace.store.id,
      p_payment_method: payment,
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

  return (
    <div className="app-shell">
      <aside className={menuOpen ? 'sidebar open' : 'sidebar'}>
        <button className="mobile-close" onClick={() => setMenuOpen(false)} aria-label="Fechar menu"><X /></button>
        <div className="brand"><span className="brand-mark">A</span><div><strong>ANYMA</strong><small>gestão para lojas</small></div></div>
        <nav>{nav.map(([label, Icon]) => <button key={label} className={page === label ? 'active' : ''} onClick={() => changePage(label)}><Icon size={19}/><span>{label}</span>{label === 'Estoque' && lowStock(products).length > 0 && <b>{lowStock(products).length}</b>}</button>)}</nav>
        <div className="sidebar-bottom"><div className="store-card"><Store size={18}/><div><strong>{workspace.store.name}</strong><span>{roleLabel(workspace.role)}</span></div></div><button className="settings"><Settings size={18}/>Configurações</button></div>
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
          {page === 'Visão geral' && <Dashboard products={products} sales={sales} goTo={changePage} />}
          {page === 'PDV' && <POS products={products} cart={cart} add={addToCart} setQty={setQty} finish={finishSale} />}
          {page === 'Produtos' && <Products products={products} add={addToCart} goTo={changePage} createProduct={createProduct} />}
          {page === 'Estoque' && <Inventory products={products} adjustStock={adjustStock} />}
          {page === 'Clientes' && <Customers />}
          {page === 'Caixa' && <Cashier sales={sales} workspace={workspace} />}
          {page === 'Financeiro' && <Finance sales={sales} />}
          {page === 'Relatórios' && <Reports products={products} sales={sales} />}
          {page === 'Compras' && <Placeholder icon={ClipboardList} title="Compras e fornecedores" text="Organize pedidos de compra, recebimentos e custos sem perder o histórico." action="Registrar pedido" />}
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

function Metric({ label, value, note, positive, warning }) { return <article className="metric"><span>{label}</span><strong>{value}</strong><small className={positive ? 'positive' : warning ? 'warning' : ''}>{positive && 'Alta · '}{warning && 'Atenção · '}{note}</small></article> }

function POS({ products, cart, add, setQty, finish }) {
  const [query, setQuery] = useState('')
  const [payment, setPayment] = useState('Pix')
  const shown = products.filter(p => p.name.toLowerCase().includes(query.toLowerCase()) || p.sku.toLowerCase().includes(query.toLowerCase()))
  const total = saleTotal(cart)
  return <div className="pos-layout"><section><div className="page-intro"><div><span className="section-label">VENDA RÁPIDA</span><h2>Escolha os produtos</h2></div><label className="search large"><Search size={18}/><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Nome, código ou categoria" /></label></div><div className="product-grid">{shown.map(product => <button className="product-card" key={product.id} onClick={() => add(product)}><span className="product-photo" style={{'--tone':product.color}}><ShoppingBag /></span><span className="category">{product.category}</span><strong>{product.name}</strong><small>{product.sku} · {product.stock} un.</small><b>{money(product.price)}</b><i><Plus size={17}/></i></button>)}</div></section><aside className="cart"><div className="cart-head"><div><span className="section-label">VENDA ATUAL</span><h3>Carrinho</h3></div><span>{cart.reduce((s,i)=>s+i.qty,0)} itens</span></div>{!cart.length ? <div className="empty-cart"><ShoppingCart/><strong>Carrinho vazio</strong><p>Toque em um produto para iniciar a venda.</p></div> : <><div className="cart-items">{cart.map(item => <div className="cart-row" key={item.id}><span className="mini-swatch" style={{background:item.color}}/><div><strong>{item.name}</strong><small>{money(item.price)}</small></div><div className="qty"><button onClick={() => setQty(item.id,-1)}><Minus/></button><span>{item.qty}</span><button onClick={() => setQty(item.id,1)}><Plus/></button></div></div>)}</div><div className="payment"><span>Forma de pagamento</span><div>{['Pix','Crédito','Débito','Dinheiro'].map(type => <button className={payment===type?'selected':''} key={type} onClick={() => setPayment(type)}>{type}</button>)}</div></div><div className="total"><span>Total</span><strong>{money(total)}</strong></div><button className="finish" onClick={() => finish(payment)}><CheckCircle2/>Finalizar venda</button></>}</aside></div>
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

function Customers() { return <Placeholder icon={Users} title="Clientes" text="O cadastro de clientes entra no próximo bloco. Nenhum dado fictício é exibido neste ambiente." action="Em desenvolvimento" /> }

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
function roleLabel(role) { return ({ owner: 'Proprietário', admin: 'Administrador', manager: 'Gerente', operator: 'Operador', viewer: 'Consulta' })[role] || 'Usuário' }

export default App
