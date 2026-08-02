import { describe, expect, it } from 'vitest'
import { hasCapability, pageAllowed } from './permissions'

describe('permissões por função', () => {
  it('permite ao proprietário administrar equipe e financeiro', () => {
    expect(hasCapability('owner', 'team')).toBe(true)
    expect(pageAllowed('owner', 'Financeiro')).toBe(true)
  })

  it('limita vendedor ao fluxo de atendimento e próprio caixa', () => {
    expect(pageAllowed('operator', 'PDV')).toBe(true)
    expect(pageAllowed('operator', 'Caixa')).toBe(true)
    expect(pageAllowed('operator', 'Financeiro')).toBe(false)
    expect(pageAllowed('operator', 'Equipe e acessos')).toBe(false)
  })

  it('mantém consulta sem telas de alteração', () => {
    expect(pageAllowed('viewer', 'Relatórios')).toBe(true)
    expect(pageAllowed('viewer', 'PDV')).toBe(false)
    expect(hasCapability('viewer', 'management')).toBe(false)
  })
})

