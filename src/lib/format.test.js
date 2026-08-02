import { describe, expect, it } from 'vitest'
import { lowStock, saleTotal } from './format'

describe('regras comerciais', () => {
  it('calcula o total do carrinho', () => {
    expect(saleTotal([{ price: 10, qty: 2 }, { price: 5.5, qty: 1 }])).toBe(25.5)
  })

  it('identifica itens abaixo do estoque mínimo', () => {
    expect(lowStock([{ stock: 2, min: 3 }, { stock: 8, min: 4 }])).toHaveLength(1)
  })
})
