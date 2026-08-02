const pages = {
  superadmin: ['Visão geral', 'PDV', 'Produtos', 'Estoque', 'Compras', 'Clientes', 'Caixa', 'Financeiro', 'Relatórios', 'Equipe e acessos'],
  owner: ['Visão geral', 'PDV', 'Produtos', 'Estoque', 'Compras', 'Clientes', 'Caixa', 'Financeiro', 'Relatórios', 'Equipe e acessos'],
  admin: ['Visão geral', 'PDV', 'Produtos', 'Estoque', 'Compras', 'Clientes', 'Caixa', 'Financeiro', 'Relatórios', 'Equipe e acessos'],
  manager: ['Visão geral', 'PDV', 'Produtos', 'Estoque', 'Compras', 'Clientes', 'Caixa', 'Financeiro', 'Relatórios'],
  operator: ['Visão geral', 'PDV', 'Produtos', 'Clientes', 'Caixa'],
  viewer: ['Visão geral', 'Produtos', 'Estoque', 'Relatórios'],
}

const capabilities = {
  superadmin: ['management', 'team'],
  owner: ['management', 'team'],
  admin: ['management', 'team'],
  manager: ['management'],
  operator: [],
  viewer: [],
}

export const hasCapability = (role, capability) => (capabilities[role] || []).includes(capability)
export const pageAllowed = (role, page) => (pages[role] || []).includes(page)

