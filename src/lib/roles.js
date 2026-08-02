export const roleLabel = (role) => ({
  superadmin: 'Superadministrador',
  owner: 'Proprietária',
  admin: 'Administrador',
  manager: 'Gerente',
  operator: 'Vendedor / Caixa',
  viewer: 'Consulta',
})[role] || 'Usuário'

export const canGrantRole = ({ actorRole, isPlatformAdmin }, targetRole) => {
  if (targetRole === 'owner') return Boolean(isPlatformAdmin)
  if (targetRole === 'admin') return Boolean(isPlatformAdmin) || actorRole === 'owner'
  return ['superadmin', 'owner', 'admin'].includes(actorRole)
}
