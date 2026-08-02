import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, LoaderCircle, LockKeyhole, Store } from 'lucide-react'
import { isSupabaseConfigured, supabase } from '../lib/supabase'

const initialForm = { fullName: '', storeName: '', email: '', password: '' }

export default function AuthGate({ children }) {
  const [workspace, setWorkspace] = useState(null)
  const [loading, setLoading] = useState(true)

  const switchStore = useCallback(async (storeId) => {
    setWorkspace((current) => {
      const store = current?.stores?.find((item) => item.id === storeId)
      return store ? { ...current, store } : current
    })
    await supabase.rpc('log_platform_access', { p_store_id: storeId, p_reason: 'Teste administrativo' })
  }, [])

  useEffect(() => {
    if (!supabase) {
      setLoading(false)
      return undefined
    }

    let active = true
    const loadWorkspace = async () => {
      const { data: claimsData } = await supabase.auth.getClaims()
      const userId = claimsData?.claims?.sub
      if (!userId) {
        if (active) { setWorkspace(null); setLoading(false) }
        return
      }

      const [{ data: profile }, { data: administrator }] = await Promise.all([
        supabase.from('profiles').select('user_id, full_name').eq('user_id', userId).single(),
        supabase.from('platform_admins').select('user_id').eq('user_id', userId).eq('active', true).maybeSingle(),
      ])

      const isPlatformAdmin = Boolean(administrator)
      const { data: memberships, error } = isPlatformAdmin
        ? await supabase.from('stores').select('id, name, slug, logo_url').eq('active', true).order('name')
        : await supabase.from('store_members').select('role, stores(id, name, slug, logo_url)').eq('user_id', userId).eq('active', true).limit(1)

      const stores = isPlatformAdmin ? (memberships || []) : (memberships || []).map((item) => item.stores)
      const store = stores[0]

      if (active) {
        setWorkspace(error || !store
          ? null
          : { userId, profile, role: isPlatformAdmin ? 'superadmin' : memberships[0].role, isPlatformAdmin, stores, store })
        setLoading(false)
      }
    }

    loadWorkspace()
    const { data: listener } = supabase.auth.onAuthStateChange(() => {
      setLoading(true)
      window.setTimeout(loadWorkspace, 0)
    })
    return () => { active = false; listener.subscription.unsubscribe() }
  }, [])

  if (!isSupabaseConfigured) return <ConfigurationNotice />
  if (loading) return <FullScreenStatus text="Preparando sua loja..." />
  if (!workspace) return <AuthScreen />
  return children({ ...workspace, switchStore })
}

function AuthScreen() {
  const inviteToken = new URLSearchParams(window.location.search).get('invite') || ''
  const [mode, setMode] = useState(inviteToken ? 'invite' : 'login')
  const [form, setForm] = useState(initialForm)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const update = (field) => (event) => setForm((current) => ({ ...current, [field]: event.target.value }))
  const submit = async (event) => {
    event.preventDefault()
    setLoading(true); setError(''); setMessage('')
    const result = mode === 'login'
      ? await supabase.auth.signInWithPassword({ email: form.email.trim(), password: form.password })
      : await supabase.auth.signUp({
          email: form.email.trim(),
          password: form.password,
          options: { data: mode === 'invite'
            ? { full_name: form.fullName.trim(), invite_token: inviteToken }
            : { full_name: form.fullName.trim(), store_name: form.storeName.trim() } },
        })
    setLoading(false)
    if (result.error) return setError(translateAuthError(result.error.message))
    if (mode !== 'login' && !result.data.session) {
      setMessage(mode === 'invite' ? 'Acesso criado. Confirme seu e-mail para entrar na equipe.' : 'Conta criada. Abra o e-mail de confirmação para entrar na Anyma.')
    }
  }

  return <div className="auth-page">
    <section className="auth-story">
      <div className="brand auth-brand"><span className="brand-mark">A</span><div><strong>ANYMA</strong><small>gestão para lojas</small></div></div>
      <div><span className="section-label">CAMACHO TECNOLOGIA</span><h1>O pulso da sua loja,<br/>com segurança.</h1><p>Vendas, produtos e estoque separados por empresa, com acesso controlado para cada pessoa.</p></div>
      <small>Ambiente protegido por autenticação e políticas de acesso no banco.</small>
    </section>
    <main className="auth-main">
      <form className="auth-card" onSubmit={submit}>
        <span className="auth-icon"><LockKeyhole /></span>
        <h2>{mode === 'login' ? 'Entrar na Anyma' : mode === 'invite' ? 'Entrar para a equipe' : 'Criar minha primeira loja'}</h2>
        <p>{mode === 'login' ? 'Use seu e-mail e senha para acessar.' : mode === 'invite' ? 'Use exatamente o e-mail que recebeu o convite.' : 'Você será o proprietário desta loja.'}</p>
        {mode !== 'login' && <>
          <label>Seu nome<input required value={form.fullName} onChange={update('fullName')} autoComplete="name" /></label>
          {mode === 'signup' && <label>Nome da loja<input required value={form.storeName} onChange={update('storeName')} /></label>}
        </>}
        <label>E-mail<input required type="email" value={form.email} onChange={update('email')} autoComplete="email" /></label>
        <label>Senha<input required minLength="8" type="password" value={form.password} onChange={update('password')} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} /></label>
        {error && <div className="form-error">{error}</div>}
        {message && <div className="form-success"><CheckCircle2 />{message}</div>}
        <button className="primary auth-submit" disabled={loading}>{loading && <LoaderCircle className="spin"/>}{mode === 'login' ? 'Entrar' : mode === 'invite' ? 'Aceitar convite' : 'Criar loja'}</button>
        {!inviteToken && <button type="button" className="auth-switch" onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setError(''); setMessage('') }}>
          {mode === 'login' ? 'Primeiro acesso? Criar conta' : 'Já tenho conta? Entrar'}
        </button>}
        {inviteToken && <button type="button" className="auth-switch" onClick={() => { window.history.replaceState({}, '', window.location.pathname); setMode('login'); setError(''); setMessage('') }}>Já tenho acesso? Entrar</button>}
      </form>
    </main>
  </div>
}

function ConfigurationNotice() {
  return <FullScreenStatus icon={Store} text="A conexão segura da Anyma ainda não foi configurada neste ambiente." />
}

function FullScreenStatus({ icon: Icon = LoaderCircle, text }) {
  return <div className="full-status"><Icon className={Icon === LoaderCircle ? 'spin' : ''}/><strong>{text}</strong></div>
}

function translateAuthError(message) {
  if (message.includes('Invalid login')) return 'E-mail ou senha incorretos.'
  if (message.includes('already registered')) return 'Este e-mail já está cadastrado.'
  if (message.includes('Password')) return 'A senha precisa ter pelo menos 8 caracteres.'
  return 'Não foi possível concluir. Verifique os dados e tente novamente.'
}
