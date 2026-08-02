import { describe, expect, it } from 'vitest'
import { canGrantRole, roleLabel } from './roles'

describe('funções da equipe', () => {
  it('exibe owner como Proprietária', () => {
    expect(roleLabel('owner')).toBe('Proprietária')
  })

  it('permite somente à administração da plataforma conceder Proprietária', () => {
    expect(canGrantRole({ actorRole: 'superadmin', isPlatformAdmin: true }, 'owner')).toBe(true)
    expect(canGrantRole({ actorRole: 'owner', isPlatformAdmin: false }, 'owner')).toBe(false)
    expect(canGrantRole({ actorRole: 'admin', isPlatformAdmin: false }, 'owner')).toBe(false)
  })

  it('mantém Administrador sob controle da Proprietária ou da plataforma', () => {
    expect(canGrantRole({ actorRole: 'owner', isPlatformAdmin: false }, 'admin')).toBe(true)
    expect(canGrantRole({ actorRole: 'admin', isPlatformAdmin: false }, 'admin')).toBe(false)
  })
})
