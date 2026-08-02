export const money = (value) => new Intl.NumberFormat('pt-BR', {
  style: 'currency', currency: 'BRL',
}).format(value)

export const saleTotal = (items) => items.reduce((total, item) => total + item.price * item.qty, 0)

export const purchaseTotal = (items) => items.reduce((total, item) => total + Number(item.cost || 0) * Number(item.quantity || 0), 0)

export const lowStock = (products) => products.filter((product) => product.stock <= product.min)
