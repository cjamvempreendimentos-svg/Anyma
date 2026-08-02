export const initialProducts = [
  { id: 1, sku: 'ANY-001', name: 'Vestido Linho Areia', category: 'Vestidos', price: 189.9, cost: 86, stock: 8, min: 4, color: '#b69172' },
  { id: 2, sku: 'ANY-002', name: 'Camisa Essencial Branca', category: 'Camisas', price: 119.9, cost: 49, stock: 3, min: 5, color: '#d7d5ce' },
  { id: 3, sku: 'ANY-003', name: 'Calça Alfaiataria Oliva', category: 'Calças', price: 169.9, cost: 74, stock: 11, min: 4, color: '#70745a' },
  { id: 4, sku: 'ANY-004', name: 'Bolsa Traço Caramelo', category: 'Acessórios', price: 149.9, cost: 63, stock: 2, min: 3, color: '#9b6848' },
  { id: 5, sku: 'ANY-005', name: 'Blusa Canelada Cacau', category: 'Blusas', price: 89.9, cost: 34, stock: 14, min: 5, color: '#5d4034' },
  { id: 6, sku: 'ANY-006', name: 'Saia Midi Grafite', category: 'Saias', price: 139.9, cost: 58, stock: 6, min: 3, color: '#464745' },
]

export const customers = [
  { id: 1, name: 'Marina Alves', phone: '(77) 9 8821-4300', purchases: 8, spent: 1284.3, last: 'Hoje' },
  { id: 2, name: 'Lívia Rocha', phone: '(77) 9 9112-0567', purchases: 5, spent: 743.5, last: 'Ontem' },
  { id: 3, name: 'Carla Nunes', phone: '(77) 9 8407-1202', purchases: 3, spent: 489.7, last: '28 jul' },
  { id: 4, name: 'Renata Lima', phone: '(77) 9 9633-7710', purchases: 2, spent: 319.8, last: '25 jul' },
]

export const recentSales = [
  { id: '#1048', time: '16:42', customer: 'Marina Alves', payment: 'Pix', total: 309.8, status: 'Concluída' },
  { id: '#1047', time: '15:18', customer: 'Consumidor final', payment: 'Crédito', total: 169.9, status: 'Concluída' },
  { id: '#1046', time: '14:05', customer: 'Lívia Rocha', payment: 'Dinheiro', total: 239.8, status: 'Concluída' },
  { id: '#1045', time: '11:32', customer: 'Carla Nunes', payment: 'Débito', total: 149.9, status: 'Concluída' },
]

export const cashflow = [
  { day: 'Seg', value: 920 }, { day: 'Ter', value: 1180 }, { day: 'Qua', value: 760 },
  { day: 'Qui', value: 1340 }, { day: 'Sex', value: 1730 }, { day: 'Sáb', value: 2160 }, { day: 'Hoje', value: 1284 },
]
