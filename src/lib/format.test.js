import { describe, expect, it } from 'vitest'
import { cashDifferenceLabel, cashExpected, cashRemoved, lowStock, paymentTotal, paymentsMatchTotal, purchaseTotal, saleTotal } from './format'

describe('regras comerciais', () => {
  it('calcula o total do carrinho', () => {
    expect(saleTotal([{ price: 10, qty: 2 }, { price: 5.5, qty: 1 }])).toBe(25.5)
  })

  it('identifica itens abaixo do estoque mínimo', () => {
    expect(lowStock([{ stock: 2, min: 3, active: true }, { stock: 0, min: 4, active: false }, { stock: 8, min: 4, active: true }])).toHaveLength(1)
  })

  it('calcula o total de uma compra recebida', () => {
    expect(purchaseTotal([{ cost: '12.50', quantity: '3' }, { cost: '8', quantity: '2' }])).toBe(53.5)
  })

  it('calcula o saldo físico esperado do caixa', () => {
    expect(cashExpected(100, [
      { type: 'sale', amount: 80 }, { type: 'supply', amount: 20 }, { type: 'withdrawal', amount: 35 },
    ])).toBe(165)
  })

  it('valida pagamento dividido pelo total exato da venda', () => {
    const payments = [{ method: 'Dinheiro', amount: '30.00' }, { method: 'Pix', amount: '70.00' }]
    expect(paymentTotal(payments)).toBe(100)
    expect(paymentsMatchTotal(payments, 100)).toBe(true)
    expect(paymentsMatchTotal(payments, 99.99)).toBe(false)
  })

  it('separa fundo seguinte, retirada e divergência do fechamento', () => {
    expect(cashRemoved(90, 20)).toBe(70)
    expect(cashDifferenceLabel(-10)).toBe('Falta')
    expect(cashDifferenceLabel(10)).toBe('Sobra')
    expect(cashDifferenceLabel(0)).toBe('Sem diferença')
  })
})
