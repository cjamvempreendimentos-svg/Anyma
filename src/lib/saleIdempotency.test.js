import { describe, expect, it, vi } from 'vitest'
import { saleAttemptFingerprint, saleRequestForFingerprint } from './saleIdempotency'

const sale = {
  storeId: 'store-1',
  cashSessionId: 'cash-1',
  customerId: null,
  payments: [{ method: 'Pix', amount_cents: 1000 }],
  items: [{ product_id: 'product-1', quantity: 1 }],
}

describe('idempotência da venda', () => {
  it('reutiliza a chave quando a tentativa é exatamente a mesma', () => {
    const createId = vi.fn(() => 'request-1')
    const fingerprint = saleAttemptFingerprint(sale)
    const first = saleRequestForFingerprint(null, fingerprint, createId)
    const repeated = saleRequestForFingerprint(first, fingerprint, createId)

    expect(repeated).toBe(first)
    expect(createId).toHaveBeenCalledTimes(1)
  })

  it('cria outra chave quando itens ou pagamentos mudam', () => {
    const createId = vi.fn()
      .mockReturnValueOnce('request-1')
      .mockReturnValueOnce('request-2')
    const first = saleRequestForFingerprint(null, saleAttemptFingerprint(sale), createId)
    const changed = saleRequestForFingerprint(first, saleAttemptFingerprint({
      ...sale,
      items: [{ product_id: 'product-1', quantity: 2 }],
    }), createId)

    expect(changed.requestId).toBe('request-2')
    expect(createId).toHaveBeenCalledTimes(2)
  })
})
