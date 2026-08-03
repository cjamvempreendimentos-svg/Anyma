export const saleAttemptFingerprint = ({ storeId, cashSessionId, payments, customerId, items }) => JSON.stringify({
  storeId,
  cashSessionId,
  customerId: customerId || null,
  payments,
  items,
})

export const saleRequestForFingerprint = (current, fingerprint, createId = () => globalThis.crypto.randomUUID()) => (
  current?.fingerprint === fingerprint
    ? current
    : { fingerprint, requestId: createId() }
)
