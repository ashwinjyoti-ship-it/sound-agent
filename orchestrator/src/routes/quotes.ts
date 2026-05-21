import { Hono } from 'hono';
import type { Env } from '../index';

const GST_RATE = 0.18;

const EQUIPMENT_DB = [
  { name: 'D&B M4 MONITORS (FLOOR)',                    category: 'Monitors',    ratePerItem: 2500 },
  { name: 'SENNHEISER G4 IN-EAR MONITORS',              category: 'Monitors',    ratePerItem: 1500 },
  { name: 'SHURE SM58',                                  category: 'Microphones', ratePerItem: 300  },
  { name: 'SHURE SM57',                                  category: 'Microphones', ratePerItem: 300  },
  { name: 'SHURE WIRELESS ULXD SM58/HEADSET/LAPEL',     category: 'Wireless',    ratePerItem: 1500 },
  { name: 'SHURE SM81',                                  category: 'Microphones', ratePerItem: 550  },
  { name: 'SHURE BETA 98',                               category: 'Microphones', ratePerItem: 500  },
  { name: 'NEUMANN KM184',                               category: 'Microphones', ratePerItem: 750  },
  { name: 'SENNHEISER GUN MICS',                         category: 'Microphones', ratePerItem: 600  },
  { name: 'FLOOR MICS',                                  category: 'Microphones', ratePerItem: 500  },
  { name: 'AKG C411',                                    category: 'Microphones', ratePerItem: 500  },
  { name: 'BSS DI BOX',                                  category: 'DI Boxes',    ratePerItem: 250  },
  { name: '2 TRACK RECORDING',                           category: 'Recording',   ratePerItem: 3000 },
  { name: 'MULTITRACK RECORDING',                        category: 'Recording',   ratePerItem: 12000 },
  { name: 'GOOSENECK PODIUM MICS (SHURE)',               category: 'Microphones', ratePerItem: 1000 },
  { name: 'ALTAIR WIRELESS INTERCOMMS/BELTPACK',         category: 'Intercomms',  ratePerItem: 2500 },
  { name: 'SENNHEISER E604 (DRUM KIT MICS)',             category: 'Microphones', ratePerItem: 550  },
  { name: 'SHURE BETA 91',                               category: 'Microphones', ratePerItem: 550  },
  { name: 'SHURE BETA 52 A',                             category: 'Microphones', ratePerItem: 550  },
];

const app = new Hono<{ Bindings: Env }>();

app.get('/equipment', (c) => {
  return c.json({ success: true, data: EQUIPMENT_DB, meta: { count: EQUIPMENT_DB.length } });
});

app.post('/generate', async (c) => {
  const body = await c.req.json();
  const { client_name, event_name, items, notes = '' } = body;
  if (!Array.isArray(items) || !items.length) {
    return c.json({ success: false, error: 'items[] required' }, 400);
  }

  const quoteItems: any[] = [];
  let subtotal = 0;
  const errors: string[] = [];

  for (const it of items) {
    const equip = EQUIPMENT_DB.find(e => e.name.toLowerCase() === (it.name || '').toLowerCase());
    if (!equip) { errors.push(`Equipment not found: ${it.name}`); continue; }
    const qty = Math.max(1, parseInt(it.quantity) || 1);
    const lineTotal = equip.ratePerItem * qty;
    subtotal += lineTotal;
    quoteItems.push({ name: equip.name, category: equip.category, rate: equip.ratePerItem, quantity: qty, lineTotal });
  }

  const gst = Math.round(subtotal * GST_RATE);
  const total = subtotal + gst;
  const today = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });
  const quoteNum = `QT-${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, '0')}${String(new Date().getDate()).padStart(2, '0')}-${Math.floor(Math.random() * 900 + 100)}`;

  const LINE = '─'.repeat(62);
  let text = `NATIONAL CENTRE FOR THE PERFORMING ARTS\nSound Equipment Hire — Quote\n${LINE}\n`;
  text += `Quote No : ${quoteNum}\nDate     : ${today}\nClient   : ${client_name || '—'}\nEvent    : ${event_name || '—'}\n${LINE}\n\n`;
  text += `${'ITEM'.padEnd(38)} ${'QTY'.padStart(4)} ${'RATE'.padStart(8)} ${'AMOUNT'.padStart(10)}\n${LINE}\n`;
  for (const item of quoteItems) {
    const name = item.name.length > 37 ? item.name.slice(0, 34) + '...' : item.name;
    text += `${name.padEnd(38)} ${String(item.quantity).padStart(4)} ${String(item.rate).padStart(8)} ${String(item.lineTotal).padStart(10)}\n`;
  }
  text += `${LINE}\n${'Subtotal'.padEnd(54)} ${String(subtotal).padStart(8)}\n`;
  text += `${'GST @ 18%'.padEnd(54)} ${String(gst).padStart(8)}\n${LINE}\n`;
  text += `${'TOTAL (INR)'.padEnd(54)} ${String(total).padStart(8)}\n${LINE}\n`;
  if (notes.trim()) text += `\nNotes: ${notes}\n`;

  return c.json({
    success: true,
    data: {
      quote_number: quoteNum, date: today, client_name, event_name,
      items: quoteItems, subtotal, gst, total,
      formatted_total: new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(total),
      plain_text: text,
      errors: errors.length ? errors : undefined,
    },
  });
});

export { app as quoteRoutes };
