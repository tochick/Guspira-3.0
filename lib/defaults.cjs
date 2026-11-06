// Datos iniciales. Los precios son orientativos y se editan desde el panel de administración.
const colors = [
  { id: 'dorado', name: 'Dorado', hex: '#e9b949', surcharge: 0 },
  { id: 'plata', name: 'Plata / blanco', hex: '#e8eef2', surcharge: 0 },
  { id: 'rosa', name: 'Rosa', hex: '#f28bb7', surcharge: 8 },
  { id: 'azul', name: 'Azul', hex: '#5aa9ff', surcharge: 8 },
  { id: 'rojo', name: 'Rojo', hex: '#ff4d4d', surcharge: 8 },
  { id: 'verde', name: 'Verde', hex: '#4fd18b', surcharge: 8 },
  { id: 'morado', name: 'Morado', hex: '#a77bff', surcharge: 8 },
  { id: 'multicolor', name: 'Multicolor', hex: 'linear', surcharge: 14 }
];

const sparkDurations = [
  { id: '30', label: '30 segundos', multiplier: 1 },
  { id: '60', label: '60 segundos', multiplier: 1.6 },
  { id: '90', label: '90 segundos', multiplier: 2.1 }
];

const items = [
  {
    id: 'vertical', kind: 'vertical', name: 'Fuente vertical de chispa fría',
    description: 'Chorro vertical de 2 a 5 m de altura. Ideal para la entrada de los novios, el primer baile o el corte de la tarta. Apta para interiores.',
    unitPrice: 45, unitLabel: 'fuente', minQty: 1, maxQty: 24, active: true,
    colorIds: ['dorado', 'plata', 'rosa', 'azul', 'rojo', 'verde', 'morado', 'multicolor'], durations: sparkDurations
  },
  {
    id: 'abanico', kind: 'abanico', name: 'Abanico de chispas',
    description: 'Tres chorros sincronizados que se abren en abanico. Gran impacto visual en escenarios, photocalls y pasillos.',
    unitPrice: 75, unitLabel: 'abanico', minQty: 1, maxQty: 12, active: true,
    colorIds: ['dorado', 'plata', 'rosa', 'azul', 'multicolor'], durations: sparkDurations
  },
  {
    id: 'cascada', kind: 'cascada', name: 'Cascada de chispas',
    description: 'Cortina de chispas que cae desde una estructura elevada. Precio por módulo de 1 metro lineal.',
    unitPrice: 95, unitLabel: 'metro', minQty: 2, maxQty: 30, active: true,
    colorIds: ['dorado', 'plata', 'rosa', 'azul'], durations: sparkDurations
  },
  {
    id: 'bengalas', kind: 'bengalas', name: 'Bengalas para invitados',
    description: 'Pack de 25 bengalas sin humo para el pasillo de salida o la foto de grupo.',
    unitPrice: 22, unitLabel: 'pack', minQty: 1, maxQty: 40, active: true,
    colorIds: ['dorado', 'plata'], durations: [{ id: 'std', label: 'Estándar (45 s)', multiplier: 1 }]
  },
  {
    id: 'humo', kind: 'humo', name: 'Humo de color (revelación)',
    description: 'Bote de humo de color denso para revelaciones de género en babyshowers o sesiones de fotos.',
    unitPrice: 18, unitLabel: 'bote', minQty: 1, maxQty: 30, active: true,
    colorIds: ['rosa', 'azul', 'verde', 'morado', 'rojo', 'plata'], durations: [{ id: 'std', label: '60 segundos', multiplier: 1 }]
  },
  {
    id: 'confeti', kind: 'confeti', name: 'Cañón de confeti',
    description: 'Disparo de confeti o serpentinas de hasta 8 m. Perfecto para el final de la fiesta o una revelación.',
    unitPrice: 35, unitLabel: 'cañón', minQty: 1, maxQty: 20, active: true,
    colorIds: ['dorado', 'plata', 'rosa', 'azul', 'multicolor'], durations: [{ id: 'std', label: 'Disparo único', multiplier: 1 }]
  }
];

const fees = {
  setup: 150, // Montaje, técnico pirotécnico acreditado y seguro
  freeKm: 30,
  perKm: 0.6,
  vatRate: 0.21,
  discounts: [{ min: 600, pct: 5 }, { min: 1200, pct: 10 }]
};

// Paquetes recomendados: combinaciones listas para añadir al presupuesto con un clic.
const packs = [
  {
    id: 'entrada', name: 'Entrada triunfal', tag: 'Boda',
    description: 'Pasillo de fuentes doradas y dos abanicos al fondo para recibir a los novios.',
    lines: [
      { itemId: 'vertical', qty: 4, colorId: 'dorado', durationId: '30', moment: 'Entrada' },
      { itemId: 'abanico', qty: 2, colorId: 'dorado', durationId: '30', moment: 'Entrada' }
    ]
  },
  {
    id: 'primer-baile', name: 'Primer baile de película', tag: 'Boda',
    description: 'Cascada de chispas tras la pareja y fuentes plateadas alrededor de la pista.',
    lines: [
      { itemId: 'cascada', qty: 4, colorId: 'dorado', durationId: '60', moment: 'Primer baile' },
      { itemId: 'vertical', qty: 6, colorId: 'plata', durationId: '60', moment: 'Primer baile' }
    ]
  },
  {
    id: 'revelacion', name: 'Revelación', tag: 'Babyshower',
    description: 'Humo de color, confeti y fuentes a juego. Elige rosa o azul al añadirlo.',
    lines: [
      { itemId: 'humo', qty: 4, colorId: 'rosa', durationId: 'std', moment: 'Revelación' },
      { itemId: 'confeti', qty: 2, colorId: 'rosa', durationId: 'std', moment: 'Revelación' },
      { itemId: 'vertical', qty: 2, colorId: 'rosa', durationId: '30', moment: 'Revelación' }
    ]
  },
  {
    id: 'fin-de-fiesta', name: 'Fin de fiesta', tag: 'Todas las celebraciones',
    description: 'Bengalas para la foto de grupo y cañones de confeti para cerrar por todo lo alto.',
    lines: [
      { itemId: 'bengalas', qty: 4, colorId: 'dorado', durationId: 'std', moment: 'Salida' },
      { itemId: 'confeti', qty: 2, colorId: 'dorado', durationId: 'std', moment: 'Fin de fiesta' }
    ]
  }
];

const company = {
  name: 'Guspira Events',
  legalName: '',
  taxId: '',
  phone: '',
  whatsapp: '',
  email: '',
  instagram: '',
  address: '',
  conditions: 'Presupuesto válido durante 30 días desde su emisión. La fecha queda reservada al aceptar el presupuesto y abonar la señal acordada. El uso de pirotecnia está sujeto a la autorización del espacio y a que las condiciones meteorológicas permitan hacerlo con seguridad; si no fuera posible, acordaremos contigo una alternativa.'
};

module.exports = {
  pyroCatalog: () => JSON.parse(JSON.stringify({ colors, items, fees, packs })),
  company: () => ({ ...company }),
  eventTypes: ['Boda', 'Babyshower', 'Revelación de género', 'Comunión', 'Bautizo', 'Cumpleaños', 'Aniversario', 'Evento de empresa', 'Fiesta privada', 'Otro'],
  moments: ['Entrada', 'Primer baile', 'Corte de la tarta', 'Revelación', 'Brindis', 'Salida', 'Fin de fiesta', 'Otro']
};
