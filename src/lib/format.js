export const money = (value) => new Intl.NumberFormat('pt-BR', {
  style: 'currency', currency: 'BRL',
}).format(value)

export const saleTotal = (items) => items.reduce((total, item) => total + item.price * item.qty, 0)

export const purchaseTotal = (items) => items.reduce((total, item) => total + Number(item.cost || 0) * Number(item.quantity || 0), 0)

export const paymentTotal = (payments = []) => payments.reduce((total, payment) => total + Number(payment.amount || 0), 0)

export const paymentsMatchTotal = (payments, total) => {
  if (!payments.length || payments.some((payment) => Number(payment.amount) <= 0)) return false
  return Math.round(paymentTotal(payments) * 100) === Math.round(Number(total) * 100)
}

export const cashExpected = (opening, movements = []) => movements.reduce((total, movement) => {
  if (movement.type === 'sale' || movement.type === 'supply') return total + movement.amount
  if (movement.type === 'withdrawal') return total - movement.amount
  return total
}, opening)

export const lowStock = (products) => products.filter((product) => product.stock <= product.min)
