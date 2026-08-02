import { useMemo, useState } from 'react'
import {
  BadgeDollarSign, BarChart3, Boxes, ChevronDown, CircleUserRound, ClipboardList,
  CreditCard, LayoutDashboard, Menu, PackagePlus, ReceiptText, Search, Settings,
  ShoppingBag, ShoppingCart, Store, Users, WalletCards, X, Minus, Plus, CheckCircle2,
  AlertTriangle, ArrowUpRight, Sparkles,
} from 'lucide-react'
import { cashflow, customers, initialProducts, recentSales } from './data/demo'
import { lowStock, money, saleTotal } from './lib/format'

const nav = [
  ['Visão geral', LayoutDashboard], ['PDV', ShoppingCart], ['Produtos', ShoppingBag],
  ['Estoque', Boxes], ['Compras', PackagePlus], ['Clientes', Users], ['Caixa', WalletCards],
  ['Financeiro', BadgeDollarSign], ['Relatórios', BarChart3], ['Equipe e acessos', CircleUserRound],
]

function App() {
  const [page, setPage] = useState('Visão geral')
  const [menuOpen, setMenuOpen] = useState(false)
  const [products, setProducts] = useState(initialProducts)
  const [cart, setCart] = useState([])
  const [sales, setSales] = useState(recentSales)
  const [toast, setToast] = useState('')

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

  const finishSale = (payment) => {
    if (!cart.length) return
    const total = saleTotal(cart)
    setProducts((all) => all.map((product) => {
      const sold = cart.find((item) => item.id === product.id)
      return sold ? { ...product, stock: product.stock - sold.qty } : product
    }))
    setSales((all) => [{ id: `#${1049 + all.length}`, time: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }), customer: 'Consumidor final', payment, total, status: 'Concluída' }, ...all])
    setCart([])
    notify(`Venda de ${money(total)} concluída em ${payment}.`)
  }

  return (
    <div className="app-shell">
      <aside className={menuOpen ? 'sidebar open' : 'sidebar'}>
        <button className="mobile-close" onClick={() => setMenuOpen(false)} aria-label="Fechar menu"><X /></button>
        <div className="brand"><span className="brand-mark">A</span><div><strong>ANYMA</strong><small>gestão para lojas</small></div></div>
        <nav>{nav.map(([label, Icon]) => <button key={label} className={page === label ? 'active' : ''} onClick={() => changePage(label)}><Icon size={19}/><span>{label}</span>{label === 'Estoque' && lowStock(products).length > 0 && <b>{lowStock(products).length}</b>}</button>)}</nav>
        <div className="sidebar-bottom"><div className="store-card"><Store size={18}/><div><strong>Loja Centro</strong><span>Unidade principal</span></div><ChevronDown size={16}/></div><button className="settings"><Settings size={18}/>Configurações</button></div>
      </aside>
      {menuOpen && <button className="scrim" onClick={() => setMenuOpen(false)} aria-label="Fechar menu" />}

      <main>
        <header className="topbar">
          <button className="mobile-menu" onClick={() => setMenuOpen(true)} aria-label="Abrir menu"><Menu /></button>
          <div><span className="eyebrow">SÁBADO, 1 DE AGOSTO</span><h1>{page}</h1></div>
          <div className="top-actions"><label className="search"><Search size={18}/><input placeholder="Buscar na Anyma..." /></label><button className="profile"><span>AC</span><div><strong>Antonio Camacho</strong><small>Administrador</small></div><ChevronDown size={16}/></button></div>
        </header>

        <div className="content">
          {page === 'Visão geral' && <Dashboard products={products} sales={sales} goTo={changePage} />}
          {page === 'PDV' && <POS products={products} cart={cart} add={addToCart} setQty={setQty} finish={finishSale} />}
          {page === 'Produtos' && <Products products={products} add={addToCart} goTo={changePage} />}
          {page === 'Estoque' && <Inventory products={products} />}
          {page === 'Clientes' && <Customers />}
          {page === 'Caixa' && <Cashier sales={sales} />}
          {page === 'Financeiro' && <Finance sales={sales} />}
          {page === 'Relatórios' && <Reports products={products} sales={sales} />}
          {page === 'Compras' && <Placeholder icon={ClipboardList} title="Compras e fornecedores" text="Organize pedidos de compra, recebimentos e custos sem perder o histórico." action="Registrar pedido" />}
          {page === 'Equipe e acessos' && <Team />}
        </div>
      </main>
      {toast && <div className="toast"><CheckCircle2 size={19}/>{toast}</div>}
    </div>
  )
}

function Dashboard({ products, sales, goTo }) {
  const revenue = sales.reduce((sum, sale) => sum + sale.total, 0)
  const alerts = lowStock(products)
  const max = Math.max(...cashflow.map((item) => item.value))
  return <>
    <section className="welcome"><div><span className="live-dot">Caixa aberto</span><h2>O pulso da sua loja, agora.</h2><p>Vendas, estoque e decisões importantes reunidas numa leitura simples.</p></div><button className="primary" onClick={() => goTo('PDV')}><ShoppingCart size={18}/>Nova venda</button></section>
    <section className="metrics">
      <Metric label="Vendas hoje" value={money(revenue)} note="12,4% acima de ontem" positive />
      <Metric label="Ticket médio" value={money(revenue / sales.length)} note={`${sales.length} vendas concluídas`} />
      <Metric label="Itens em estoque" value={products.reduce((s,p) => s + p.stock, 0)} note={`${alerts.length} pedem reposição`} warning={alerts.length > 0} />
      <Metric label="Margem estimada" value="52,8%" note="Dentro da meta da loja" positive />
    </section>
    <section className="dashboard-grid">
      <article className="panel revenue-panel"><div className="panel-head"><div><span className="section-label">DESEMPENHO</span><h3>Vendas nos últimos 7 dias</h3></div><button className="text-btn" onClick={() => goTo('Relatórios')}>Ver relatório <ArrowUpRight size={16}/></button></div><div className="chart"><div className="chart-scale"><span>R$ 2 mil</span><span>R$ 1 mil</span><span>R$ 0</span></div>{cashflow.map(item => <div className="bar-wrap" key={item.day}><div className={item.day === 'Hoje' ? 'bar current' : 'bar'} style={{height: `${(item.value/max)*100}%`}} title={money(item.value)} /><span>{item.day}</span></div>)}</div></article>
      <article className="panel attention"><div className="panel-head"><div><span className="section-label">ATENÇÃO AGORA</span><h3>O que pede uma decisão</h3></div><span className="count">{alerts.length}</span></div>{alerts.map(item => <div className="alert-row" key={item.id}><span className="product-swatch" style={{background:item.color}}/><div><strong>{item.name}</strong><span>{item.stock} un. · mínimo {item.min}</span></div><button onClick={() => goTo('Estoque')}>Repor</button></div>)}<div className="insight"><Sparkles size={18}/><p><strong>Leitura Anyma</strong> A Camisa Essencial tem giro alto e pode acabar antes do próximo fim de semana.</p></div></article>
    </section>
    <section className="panel"><div className="panel-head"><div><span className="section-label">MOVIMENTO RECENTE</span><h3>Últimas vendas</h3></div><button className="text-btn" onClick={() => goTo('Caixa')}>Abrir caixa <ArrowUpRight size={16}/></button></div><SalesTable sales={sales.slice(0,4)} /></section>
  </>
}

function Metric({ label, value, note, positive, warning }) { return <article className="metric"><span>{label}</span><strong>{value}</strong><small className={positive ? 'positive' : warning ? 'warning' : ''}>{positive && '↗ '}{warning && '● '}{note}</small></article> }

function POS({ products, cart, add, setQty, finish }) {
  const [query, setQuery] = useState('')
  const [payment, setPayment] = useState('Pix')
  const shown = products.filter(p => p.name.toLowerCase().includes(query.toLowerCase()) || p.sku.toLowerCase().includes(query.toLowerCase()))
  const total = saleTotal(cart)
  return <div className="pos-layout"><section><div className="page-intro"><div><span className="section-label">VENDA RÁPIDA</span><h2>Escolha os produtos</h2></div><label className="search large"><Search size={18}/><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Nome, código ou categoria" /></label></div><div className="product-grid">{shown.map(product => <button className="product-card" key={product.id} onClick={() => add(product)}><span className="product-photo" style={{'--tone':product.color}}><ShoppingBag /></span><span className="category">{product.category}</span><strong>{product.name}</strong><small>{product.sku} · {product.stock} un.</small><b>{money(product.price)}</b><i><Plus size={17}/></i></button>)}</div></section><aside className="cart"><div className="cart-head"><div><span className="section-label">VENDA ATUAL</span><h3>Carrinho</h3></div><span>{cart.reduce((s,i)=>s+i.qty,0)} itens</span></div>{!cart.length ? <div className="empty-cart"><ShoppingCart/><strong>Carrinho vazio</strong><p>Toque em um produto para iniciar a venda.</p></div> : <><div className="cart-items">{cart.map(item => <div className="cart-row" key={item.id}><span className="mini-swatch" style={{background:item.color}}/><div><strong>{item.name}</strong><small>{money(item.price)}</small></div><div className="qty"><button onClick={() => setQty(item.id,-1)}><Minus/></button><span>{item.qty}</span><button onClick={() => setQty(item.id,1)}><Plus/></button></div></div>)}</div><div className="payment"><span>Forma de pagamento</span><div>{['Pix','Crédito','Débito','Dinheiro'].map(type => <button className={payment===type?'selected':''} key={type} onClick={() => setPayment(type)}>{type}</button>)}</div></div><div className="total"><span>Total</span><strong>{money(total)}</strong></div><button className="finish" onClick={() => finish(payment)}><CheckCircle2/>Finalizar venda</button></>}</aside></div>
}

function Products({ products, add, goTo }) { return <section className="panel"><div className="panel-head"><div><span className="section-label">CATÁLOGO</span><h3>{products.length} produtos ativos</h3></div><button className="primary" onClick={() => goTo('PDV')}><ShoppingCart size={18}/>Abrir PDV</button></div><div className="catalog">{products.map(product => <div className="catalog-row" key={product.id}><span className="product-swatch big" style={{background:product.color}}/><div><strong>{product.name}</strong><span>{product.sku} · {product.category}</span></div><span>{money(product.cost)} custo</span><b>{money(product.price)}</b><span className={product.stock <= product.min ? 'stock low' : 'stock'}>{product.stock} un.</span><button className="icon-btn" onClick={() => add(product)} title="Adicionar ao carrinho"><Plus/></button></div>)}</div></section> }

function Inventory({ products }) { return <><div className="page-intro"><div><span className="section-label">CONTROLE DE ESTOQUE</span><h2>Reposição sem surpresa</h2><p>Priorize os produtos que já atingiram o limite definido.</p></div><button className="primary"><PackagePlus size={18}/>Registrar entrada</button></div><section className="inventory-grid">{products.map(p => { const percent = Math.min(100, p.stock / (p.min*3) * 100); const low = p.stock <= p.min; return <article className="inventory-card" key={p.id}><div><span className="product-swatch big" style={{background:p.color}}/><span className={low?'status danger':'status'}>{low?'Repor':'Saudável'}</span></div><strong>{p.name}</strong><small>{p.sku} · mínimo {p.min}</small><div className="stock-number"><b>{p.stock}</b><span>unidades</span></div><div className="progress"><i className={low?'low':''} style={{width:`${percent}%`}}/></div></article> })}</section></> }

function Customers() { return <section className="panel"><div className="panel-head"><div><span className="section-label">RELACIONAMENTO</span><h3>Clientes da loja</h3></div><button className="primary"><Users size={18}/>Novo cliente</button></div><div className="customer-grid">{customers.map(c => <article className="customer" key={c.id}><span>{c.name.split(' ').map(n=>n[0]).slice(0,2).join('')}</span><div><strong>{c.name}</strong><small>{c.phone}</small></div><div><b>{c.purchases}</b><small>compras</small></div><div><b>{money(c.spent)}</b><small>total comprado</small></div><em>Última: {c.last}</em></article>)}</div></section> }

function Cashier({ sales }) { const total = sales.reduce((s,v)=>s+v.total,0); return <><div className="cash-hero"><div><span className="live-dot">Aberto desde 08:02</span><h2>Caixa da Loja Centro</h2><p>Operador: Antonio Camacho</p></div><div><span>Saldo esperado</span><strong>{money(total + 200)}</strong><small>inclui R$ 200,00 de abertura</small></div><button>Fechar caixa</button></div><section className="panel"><div className="panel-head"><h3>Movimentações do turno</h3><span className="pill">{sales.length} vendas</span></div><SalesTable sales={sales}/></section></> }

function Finance({ sales }) { const revenue=sales.reduce((s,v)=>s+v.total,0); return <><section className="metrics"><Metric label="Entradas previstas" value={money(revenue+2840)} note="Este mês" positive/><Metric label="Saídas previstas" value={money(1930)} note="Compras e despesas"/><Metric label="Saldo projetado" value={money(revenue+910)} note="Até 31 de agosto" positive/><Metric label="Contas vencendo" value="3" note="R$ 860,00 nos próximos 7 dias" warning/></section><Placeholder icon={CreditCard} title="Agenda financeira" text="Contas a pagar, recebimentos e conciliação aparecem aqui em uma única linha do tempo." action="Novo lançamento" /></> }

function Reports({ products, sales }) { const top=[...products].sort((a,b)=>b.price*b.stock-a.price*a.stock).slice(0,4); return <div className="report-grid"><section className="panel"><div className="panel-head"><div><span className="section-label">RESULTADOS</span><h3>Resumo comercial</h3></div><button className="secondary"><ReceiptText size={17}/>Exportar</button></div><div className="report-summary"><div><span>Faturamento</span><strong>{money(sales.reduce((s,v)=>s+v.total,0))}</strong></div><div><span>Produtos vendidos</span><strong>{sales.length+6}</strong></div><div><span>Estoque a preço de venda</span><strong>{money(products.reduce((s,p)=>s+p.price*p.stock,0))}</strong></div></div></section><section className="panel"><span className="section-label">MAIOR POTENCIAL</span><h3>Produtos em destaque</h3>{top.map((p,i)=><div className="rank" key={p.id}><b>0{i+1}</b><span className="product-swatch" style={{background:p.color}}/><div><strong>{p.name}</strong><span>{p.stock} unidades disponíveis</span></div><em>{money(p.price*p.stock)}</em></div>)}</section></div> }

function Team() { const people=[['Antonio Camacho','Administrador','Acesso total'],['Marina Costa','Gerente','Vendas, estoque e relatórios'],['Ana Souza','Operadora','PDV e clientes']]; return <section className="panel"><div className="panel-head"><div><span className="section-label">SEGURANÇA E OPERAÇÃO</span><h3>Equipe e níveis de acesso</h3></div><button className="primary"><Users size={18}/>Convidar pessoa</button></div><div className="team-list">{people.map(([name,role,access])=><div key={name}><span>{name.split(' ').map(n=>n[0]).slice(0,2).join('')}</span><div><strong>{name}</strong><small>{access}</small></div><b>{role}</b><em>Ativo</em></div>)}</div><div className="security-note"><AlertTriangle size={19}/><p>Perfis visuais já definidos. Autenticação real, isolamento entre lojas e permissões no banco serão implementados antes de uso com dados reais.</p></div></section> }

function Placeholder({ icon:Icon, title, text, action }) { return <section className="panel placeholder"><span><Icon/></span><h2>{title}</h2><p>{text}</p><button className="primary">{action}</button></section> }

function SalesTable({ sales }) { return <div className="table"><div className="table-head"><span>Venda</span><span>Horário</span><span>Cliente</span><span>Pagamento</span><span>Total</span><span>Status</span></div>{sales.map(sale=><div className="table-row" key={sale.id}><b>{sale.id}</b><span>{sale.time}</span><span>{sale.customer}</span><span>{sale.payment}</span><strong>{money(sale.total)}</strong><em>{sale.status}</em></div>)}</div> }

export default App
