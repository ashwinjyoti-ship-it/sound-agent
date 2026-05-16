// Sound Agent Frontend
// Talks to Render backend

const API_BASE = 'https://sound-agent-api.onrender.com';
const chatEl = document.getElementById('chat');
const micBtn = document.getElementById('mic-btn');
const textInp = document.getElementById('text-inp');
const sendBtn = document.getElementById('send-btn');

let recognition = null;
let isRecording = false;
let messages = [];

// ─── Init ───
function init() {
  addMsg('assistant', '👋 Hey. I can help you:\n• Add or update shows\n• Check crew availability\n• Generate equipment quotes\n• Query the schedule\n\nTry: "Add show 31 May JBT quartet" or "Who is free on 17 May?"\n\nType /clear to start a fresh conversation.');

  if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognition = new SR();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'en-IN';

    recognition.onresult = function(e) {
      const transcript = e.results[0][0].transcript;
      textInp.value = transcript;
      stopRecording();
      textInp.classList.add('recognized');
      textInp.focus();
      setTimeout(function() {
        textInp.classList.remove('recognized');
        sendMessage();
      }, 500);
    };

    recognition.onerror = function(e) {
      stopRecording();
      if (e.error !== 'no-speech') {
        addMsg('assistant', '⚠ Mic error: ' + e.error);
      }
    };
    recognition.onend = function() { stopRecording(); };
  } else {
    micBtn.style.display = 'none';
  }
}

// ─── Recording ───
micBtn.addEventListener('mousedown', startRecording);
micBtn.addEventListener('mouseup', stopRecording);
micBtn.addEventListener('touchstart', function(e) { e.preventDefault(); startRecording(); });
micBtn.addEventListener('touchend', function(e) { e.preventDefault(); stopRecording(); });

function startRecording() {
  if (!recognition || isRecording) return;
  isRecording = true;
  micBtn.classList.add('recording');
  try { recognition.start(); } catch(e) {}
}

function stopRecording() {
  if (!isRecording) return;
  isRecording = false;
  micBtn.classList.remove('recording');
  try { recognition.stop(); } catch(e) {}
}

// ─── Send ───
sendBtn.addEventListener('click', sendMessage);
textInp.addEventListener('keydown', function(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});

async function sendMessage() {
  const text = textInp.value.trim();
  if (!text) return;

  // Handle /clear command
  if (text.toLowerCase() === '/clear') {
    chatEl.innerHTML = '';
    messages = [];
    textInp.value = '';
    addMsg('assistant', '✓ Chat cleared. Starting fresh!');
    return;
  }

  addMsg('user', text);
  messages.push({ role: 'user', content: text });
  textInp.value = '';

  const loadingId = addLoading();
  sendBtn.disabled = true;

  try {
    const res = await fetch(API_BASE + '/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: messages }),
    });

    removeLoading(loadingId);

    if (!res.ok) {
      const err = await res.text();
      addMsg('assistant', '⚠ Error: ' + err);
      return;
    }

    const data = await res.json();
    const reply = data.reply || 'No reply';
    messages.push({ role: 'assistant', content: reply });

    const structured = tryParseStructured(reply);
    if (structured) {
      renderStructured(structured);
    } else {
      addMsg('assistant', reply);
    }
  } catch (err) {
    removeLoading(loadingId);
    addMsg('assistant', '⚠ Network error: ' + (err.message || err));
  } finally {
    sendBtn.disabled = false;
  }
}

// ─── Message UI ───
function addMsg(role, text) {
  const div = document.createElement('div');
  div.className = 'msg msg-' + role;
  // Clean markdown formatting and escape HTML
  const cleanText = stripMarkdown(text);
  div.innerHTML = '<div class="msg-avatar">' + (role === 'user' ? 'You' : 'SA') + '</div>' +
    '<div class="msg-body">' + escapeHtml(cleanText) + '</div>';
  chatEl.appendChild(div);
  scrollToBottom();
  return div;
}

function stripMarkdown(text) {
  if (!text) return '';
  // Remove markdown formatting - handle double before single to avoid conflicts
  return text
    .replace(/\*\*(.*?)\*\*/g, '$1')    // **bold** → bold (double first)
    .replace(/__(.*?)__/g, '$1')        // __bold__ → bold
    .replace(/\*([^\*]+)\*/g, '$1')     // *italic* → italic (avoid ** matches)
    .replace(/_([^_]+)_/g, '$1')        // _italic_ → italic (avoid __ matches)
    .replace(/~~(.*?)~~/g, '$1')        // ~~strike~~ → strike
    .replace(/`([^`]+)`/g, '$1')        // `code` → code
    .replace(/\[(.*?)\]\((.*?)\)/g, '$1') // [link](url) → link
    .trim();
}

function addLoading() {
  const id = 'load-' + Date.now();
  const div = document.createElement('div');
  div.id = id;
  div.className = 'msg msg-assistant';
  div.innerHTML = '<div class="msg-avatar">SA</div>' +
    '<div class="msg-body"><div class="loading"><div class="spinner"></div>Thinking…</div></div>';
  chatEl.appendChild(div);
  scrollToBottom();
  return id;
}

function removeLoading(id) {
  const el = document.getElementById(id);
  if (el) el.remove();
}

function scrollToBottom() {
  window.scrollTo(0, document.body.scrollHeight);
}

// ─── Structured Rendering ───
function tryParseStructured(text) {
  const jsonMatch = text.match(/```json\s*([\s\S]*?)```/);
  if (!jsonMatch) return null;
  try {
    return JSON.parse(jsonMatch[1]);
  } catch {
    return null;
  }
}

function renderStructured(data) {
  const div = document.createElement('div');
  div.className = 'msg msg-assistant';

  let html = '<div class="msg-avatar">SA</div><div class="msg-body">';

  if (data.type === 'crew_availability') {
    html += renderCrewPicker(data);
  } else if (data.type === 'quote') {
    html += renderQuote(data);
  } else if (data.type === 'shows') {
    html += renderShowList(data);
  } else if (data.type === 'success') {
    html += '✅ ' + escapeHtml(data.message || 'Done');
  } else {
    html += escapeHtml(JSON.stringify(data, null, 2));
  }

  html += '</div>';
  div.innerHTML = html;
  chatEl.appendChild(div);
  scrollToBottom();

  if (data.type === 'crew_availability') {
    attachCrewListeners(data);
  }
}

function renderCrewPicker(data) {
  const date = data.date || 'selected date';
  let h = '<div><strong>Crew for ' + escapeHtml(date) + '</strong></div>';

  if (data.conflicts && data.conflicts.length) {
    h += '<div class="card-in-msg" style="background:var(--warn-bg);border-color:var(--warn-border)">' +
      '<div style="font-size:12px;font-weight:700;color:var(--warn-text);margin-bottom:6px">⚠ Existing shows:</div>' +
      data.conflicts.map(function(c) {
        return '<div style="font-size:12px;margin-bottom:4px">' +
          '• ' + escapeHtml(c.event_date) + ': <strong>' + escapeHtml(c.program) + '</strong> @ ' + escapeHtml(c.venue) +
          (c.crew ? ' <span style="color:var(--muted)">(' + escapeHtml(c.crew) + ')</span>' : '') +
          '</div>';
      }).join('') + '</div>';
  }

  if (!data.available || !data.available.length) {
    h += '<div class="no-crew">😔 No crew available.</div>';
    return h;
  }

  h += '<div class="card-in-msg">';

  h += '<div class="role-hdr"><span class="role-label">FOH Engineer</span><span class="role-badge badge-foh">Single select</span></div>' +
    '<p class="role-hint">Pick one FOH engineer.</p>' +
    '<div class="pill-grid" id="foh-grid">' +
    data.available.map(function(name) {
      return '<div class="cpill foh-pill"><input type="radio" name="foh" id="foh-' + sid(name) + '" value="' + escapeHtml(name) + '">' +
        '<label for="foh-' + sid(name) + '">' + escapeHtml(name) + '</label></div>';
    }).join('') +
    '<div class="cpill foh-pill none-pill"><input type="radio" name="foh" id="foh-none" value="" checked>' +
    '<label for="foh-none">None / TBD</label></div>' +
    '</div>';

  h += '<div class="divider"></div>';

  h += '<div class="role-hdr"><span class="role-label">Stage Crew</span><span class="role-badge badge-stage">Multi select</span></div>' +
    '<p class="role-hint">Pick one or more stage crew.</p>' +
    '<div class="pill-grid" id="stage-grid">' +
    data.available.map(function(name) {
      return '<div class="cpill stage-pill"><input type="checkbox" name="stage" id="stage-' + sid(name) + '" value="' + escapeHtml(name) + '">' +
        '<label for="stage-' + sid(name) + '">' + escapeHtml(name) + '</label></div>';
    }).join('') +
    '</div>';

  if ((data.assigned && data.assigned.length) || (data.unavailable && data.unavailable.length)) {
    h += '<div class="divider"></div>';
    h += '<div class="excl-hdr">Excluded</div>';
    h += '<div class="excl-grid">';
    if (data.assigned) {
      h += data.assigned.map(function(n) {
        return '<span class="etag etag-a">🔒 ' + escapeHtml(n) + ' (assigned)</span>';
      }).join('');
    }
    if (data.unavailable) {
      h += data.unavailable.map(function(n) {
        return '<span class="etag etag-b">⛔ ' + escapeHtml(n) + ' (day-off)</span>';
      }).join('');
    }
    h += '</div>';
  }

  h += '</div>';

  h += '<div style="display:flex;gap:8px;margin-top:10px">' +
    '<button class="copy-btn" id="btn-assign">✓ Assign Crew</button>' +
    '<button class="copy-btn" style="background:var(--muted)" id="btn-skip">Skip for now</button>' +
    '</div>';

  return h;
}

function attachCrewListeners(data) {
  var date = data.date;

  document.querySelectorAll('input[name="foh"]').forEach(function(el) {
    el.addEventListener('change', function() {
      if (!el.value) return;
      var stageCb = document.getElementById('stage-' + sid(el.value));
      if (stageCb) stageCb.checked = false;
    });
  });

  document.querySelectorAll('input[name="stage"]').forEach(function(el) {
    el.addEventListener('change', function() {
      if (!el.checked) return;
      var fohRadio = document.querySelector('input[name="foh"]:checked');
      if (fohRadio && fohRadio.value === el.value) {
        var noneRadio = document.getElementById('foh-none');
        if (noneRadio) noneRadio.checked = true;
      }
    });
  });

  var assignBtn = document.getElementById('btn-assign');
  if (assignBtn) {
    assignBtn.addEventListener('click', function() {
      var fohEl = document.querySelector('input[name="foh"]:checked');
      var foh = fohEl ? fohEl.value : '';
      var stageEls = document.querySelectorAll('input[name="stage"]:checked');
      var stage = Array.from(stageEls).map(function(e) { return e.value; }).filter(Boolean);

      var msg = 'Assign crew for ' + date + ': FOH=' + (foh || 'TBD') + ', Stage=' + (stage.join(', ') || 'TBD');
      textInp.value = msg;
      sendMessage();
    });
  }

  var skipBtn = document.getElementById('btn-skip');
  if (skipBtn) {
    skipBtn.addEventListener('click', function() {
      addMsg('assistant', 'Crew assignment skipped. You can assign later by saying "Assign crew to [show]."');
    });
  }
}

function renderQuote(data) {
  var h = '<div class="card-in-msg">';

  if (!data.items || !data.items.length) {
    h += '<div>No items matched.</div>';
    return h + '</div>';
  }

  // Simple clean table
  h += '<table class="quote-table" style="margin-bottom:12px">';
  h += '<thead><tr><th>Item</th><th style="text-align:center">Qty</th><th style="text-align:right">Rate</th><th style="text-align:right">Amount</th></tr></thead><tbody>';

  for (var i = 0; i < data.items.length; i++) {
    var item = data.items[i];
    var match = item.matches ? item.matches[0] : null;
    var rate = item.rate || 0;
    var lineTotal = item.lineTotal || 0;
    var itemName = match ? match.name : item.requested;
    h += '<tr>' +
      '<td>' + escapeHtml(itemName) + '</td>' +
      '<td style="text-align:center">' + (item.requestedQty || 1) + '</td>' +
      '<td style="text-align:right">' + (rate ? '₹' + rate.toLocaleString('en-IN') : '—') + '</td>' +
      '<td style="text-align:right">' + (lineTotal ? '₹' + lineTotal.toLocaleString('en-IN') : '—') + '</td>' +
      '</tr>';
  }

  var subtotal = data.subtotal || 0;
  var gst = data.gst || 0;
  var total = data.total || 0;

  h += '<tr style="border-top:2px solid var(--primary-light);font-weight:600">' +
    '<td colspan="3" style="text-align:right;padding-right:8px">Subtotal</td>' +
    '<td style="text-align:right">₹' + subtotal.toLocaleString('en-IN') + '</td></tr>';
  h += '<tr style="font-weight:600">' +
    '<td colspan="3" style="text-align:right;padding-right:8px">GST (18%)</td>' +
    '<td style="text-align:right">₹' + gst.toLocaleString('en-IN') + '</td></tr>';
  h += '<tr style="font-weight:700;background:var(--primary);color:#fff">' +
    '<td colspan="3" style="text-align:right;padding-right:8px">TOTAL</td>' +
    '<td style="text-align:right">₹' + total.toLocaleString('en-IN') + '</td></tr>';

  h += '</tbody></table>';

  // Generate clean copy text for email
  var today = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });
  var lines = [
    'EQUIPMENT HIRE QUOTE',
    'Date: ' + today,
    '',
    'ITEM | QTY | RATE | AMOUNT',
    '─'.repeat(70)
  ];

  for (var j = 0; j < data.items.length; j++) {
    var it = data.items[j];
    var m = it.matches ? it.matches[0] : null;
    var name = m ? m.name : it.requested;
    var qty = (it.requestedQty || 1);
    var rate = (it.rate || 0);
    var amt = (it.lineTotal || 0);
    lines.push(name + ' | ' + qty + ' | ₹' + rate + ' | ₹' + amt);
  }

  lines.push('─'.repeat(70));
  lines.push('Subtotal: ₹' + subtotal);
  lines.push('GST (18%): ₹' + gst);
  lines.push('TOTAL: ₹' + total);
  lines.push('');
  lines.push('All amounts in INR. GST @ 18% included.');

  var copyText = lines.join('\n');
  h += '<button class="copy-btn" style="width:100%;padding:10px;font-size:14px;margin-top:8px" onclick="navigator.clipboard.writeText(' + JSON.stringify(copyText) + ');this.textContent=\'✓ Copied!\';this.style.opacity=\'0.6\';setTimeout(()=>{this.textContent=\'Copy to Clipboard\';this.style.opacity=\'1\'},1500)">Copy to Clipboard</button>';

  h += '</div>';
  return h;
}
}

function renderShowList(data) {
  var shows = data.shows || [];
  if (!shows.length) return '<div class="card-in-msg">No shows found.</div>';

  var h = '<div><strong>Found ' + shows.length + ' show(s)</strong></div>';
  h += '<div class="card-in-msg" style="overflow-x:auto">';
  h += '<table style="width:100%;border-collapse:collapse;font-size:13px">';
  h += '<thead><tr style="border-bottom:2px solid var(--primary);background:var(--bg)">';
  h += '<th style="text-align:left;padding:8px;font-weight:700">Date & Venue</th>';
  h += '<th style="text-align:left;padding:8px;font-weight:700">Program</th>';
  h += '<th style="text-align:left;padding:8px;font-weight:700">Call Time</th>';
  h += '<th style="text-align:left;padding:8px;font-weight:700">Assigned Crew</th>';
  h += '</tr></thead><tbody>';

  for (var k = 0; k < shows.length; k++) {
    var s = shows[k];
    var isAlt = k % 2 === 1 ? 'background:rgba(107,119,192,0.03)' : '';
    h += '<tr style="border-bottom:1px solid var(--border);' + isAlt + '">' +
      '<td style="text-align:left;padding:8px"><strong>' + escapeHtml(s.event_date) + '</strong><br><span style="color:var(--muted);font-size:11px">' + escapeHtml(s.venue || 'TBD') + '</span></td>' +
      '<td style="text-align:left;padding:8px">' + escapeHtml(s.program || '—') + '</td>' +
      '<td style="text-align:left;padding:8px">' + escapeHtml(s.call_time || '—') + '</td>' +
      '<td style="text-align:left;padding:8px">' + escapeHtml(s.crew || 'Not assigned') + '</td>' +
      '</tr>';
  }

  h += '</tbody></table>';
  h += '</div>';
  return h;
}

// ─── Helpers ───
function escapeHtml(s) {
  if (!s) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function sid(s) {
  return String(s).replace(/[^a-zA-Z0-9]/g, '_');
}

// ─── Boot ───
init();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', function() {
    navigator.serviceWorker.register('sw.js').catch(function() {});
  });
}
