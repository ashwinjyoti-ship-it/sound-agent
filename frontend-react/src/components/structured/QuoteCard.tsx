import { useRef } from 'react'
import { Button } from '@/components/ui/button'
import { escapeHtml, fmtDate } from '@/lib/formatters'
import type { QuoteItem } from '@/types'

interface Props {
  items: QuoteItem[]
  subtotal: number
  gst: number
  total: number
  date?: string
}

export function QuoteCard({ items, subtotal, gst, total, date }: Props) {
  const copyRef = useRef<{ html: string; text: string } | null>(null)

  function buildCopyContent() {
    const dateStr = date ? fmtDate(date) : new Date().toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: '2-digit' })
    let html = `<table style="border-collapse:collapse;font-family:sans-serif;font-size:13px;width:100%">
<thead><tr style="background:#E8944A;color:white">
<th style="padding:6px 10px;text-align:left">Item</th>
<th style="padding:6px 10px;text-align:center">Qty</th>
<th style="padding:6px 10px;text-align:right">Rate</th>
<th style="padding:6px 10px;text-align:right">Total</th>
</tr></thead><tbody>`
    let text = `NCPA Sound Department — Equipment Quote (${dateStr})\n${'─'.repeat(52)}\n`
    text += `${'Item'.padEnd(24)}${'Qty'.padStart(5)}${'Rate'.padStart(10)}${'Total'.padStart(10)}\n${'─'.repeat(52)}\n`
    items.forEach((item, i) => {
      const bg = i % 2 === 0 ? '#fff' : '#faf5ef'
      html += `<tr style="background:${bg}">
<td style="padding:5px 10px">${escapeHtml(item.name)}</td>
<td style="padding:5px 10px;text-align:center">${item.qty}</td>
<td style="padding:5px 10px;text-align:right">₹${item.rate.toLocaleString('en-IN')}</td>
<td style="padding:5px 10px;text-align:right">₹${item.total.toLocaleString('en-IN')}</td>
</tr>`
      text += `${item.name.substring(0, 23).padEnd(24)}${String(item.qty).padStart(5)}${('₹' + item.rate.toLocaleString('en-IN')).padStart(10)}${('₹' + item.total.toLocaleString('en-IN')).padStart(10)}\n`
    })
    html += `<tr style="border-top:2px solid #e0d4c8"><td colspan="3" style="padding:5px 10px;text-align:right">Subtotal</td><td style="padding:5px 10px;text-align:right">₹${subtotal.toLocaleString('en-IN')}</td></tr>`
    html += `<tr><td colspan="3" style="padding:5px 10px;text-align:right">GST (18%)</td><td style="padding:5px 10px;text-align:right">₹${gst.toLocaleString('en-IN')}</td></tr>`
    html += `<tr style="background:#E8944A;color:white;font-weight:bold"><td colspan="3" style="padding:5px 10px;text-align:right">Total</td><td style="padding:5px 10px;text-align:right">₹${total.toLocaleString('en-IN')}</td></tr>`
    html += '</tbody></table>'
    text += `${'─'.repeat(52)}\n${'Subtotal'.padEnd(39)}${('₹' + subtotal.toLocaleString('en-IN')).padStart(10)}\n`
    text += `${'GST (18%)'.padEnd(39)}${('₹' + gst.toLocaleString('en-IN')).padStart(10)}\n`
    text += `${'─'.repeat(52)}\n${'TOTAL'.padEnd(39)}${('₹' + total.toLocaleString('en-IN')).padStart(10)}\n`
    copyRef.current = { html, text }
  }

  async function handleCopy() {
    if (!copyRef.current) buildCopyContent()
    const { html, text } = copyRef.current!
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([text], { type: 'text/plain' }),
        }),
      ])
    } catch {
      try { await navigator.clipboard.writeText(text) } catch { /* ignore */ }
    }
  }

  return (
    <div className="bg-white/80 backdrop-blur-sm rounded-xl shadow border border-black/10 overflow-hidden max-w-sm w-full">
      <div className="bg-[#E8944A] px-4 py-2 text-white font-semibold text-sm tracking-wide">
        Equipment Quote
      </div>
      <table className="w-full text-xs text-[#1a1a1a]">
        <thead>
          <tr className="bg-[#F5EDE0] text-[#82857E] uppercase text-[10px] tracking-wider">
            <th className="px-3 py-2 text-left">Item</th>
            <th className="px-2 py-2 text-center">Qty</th>
            <th className="px-3 py-2 text-right">Rate</th>
            <th className="px-3 py-2 text-right">Total</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, i) => (
            <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-[#faf5ef]'}>
              <td className="px-3 py-2">{item.name}</td>
              <td className="px-2 py-2 text-center">{item.qty}</td>
              <td className="px-3 py-2 text-right">₹{item.rate.toLocaleString('en-IN')}</td>
              <td className="px-3 py-2 text-right">₹{item.total.toLocaleString('en-IN')}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-black/10">
            <td colSpan={3} className="px-3 py-1.5 text-right text-[#82857E]">Subtotal</td>
            <td className="px-3 py-1.5 text-right">₹{subtotal.toLocaleString('en-IN')}</td>
          </tr>
          <tr>
            <td colSpan={3} className="px-3 py-1.5 text-right text-[#82857E]">GST (18%)</td>
            <td className="px-3 py-1.5 text-right">₹{gst.toLocaleString('en-IN')}</td>
          </tr>
          <tr className="bg-[#E8944A] text-white font-semibold">
            <td colSpan={3} className="px-3 py-2 text-right">Total</td>
            <td className="px-3 py-2 text-right">₹{total.toLocaleString('en-IN')}</td>
          </tr>
        </tfoot>
      </table>
      <div className="px-3 py-2 bg-[#F5EDE0]">
        <Button size="sm" variant="secondary" className="w-full text-xs" onClick={handleCopy}>
          Copy Quote
        </Button>
      </div>
    </div>
  )
}
