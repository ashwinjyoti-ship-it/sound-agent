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
  addMsg('assistant', '👋 Hey. I can help you:\n• Add or update shows\n• Check crew availability\n• Generate equipment quotes\n• Query the schedule\n\nTry: "Add show 31 May JBT quartet" or "Who is free on 17 May?"');

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
      sendMessage();
    };

    recognition.onerror = function() { stopRecording(); };
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
  div.innerHTML = '<div class="msg-avatar">' + (role === 'user' ? 'You' : 'SA') + '</div>' +
    '<div class="msg-body">' + escapeHtml(text) + '</div>';
  chatEl.appendChild(div);
  scrollToBottom();
  return div;
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
  var h = '<div><strong>Equipment Quote</strong></div>';

  if (!data.items || !data.items.length) {
    h += '<div class="card-in-msg">No items matched.</div>';
    return h;
  }

  h += '<div class="card-in-msg">';
  h += '<table class="quote-table">';
  h += '<thead><tr><th>Item</th><th>Qty</th><th>Rate (₹)</th><th>Amount (₹)</th></tr></thead><tbody>';

  for (var i = 0; i < data.items.length; i++) {
    var item = data.items[i];
    var match = item.matches ? item.matches[0] : null;
    var rate = item.rate || 0;
    var lineTotal = item.lineTotal || 0;
    h += '<tr>' +
      '<td>' + escapeHtml(match ? match.name : item.requested) + '</td>' +
      '<td>' + (item.requestedQty || 1) + '</td>' +
      '<td>' + (rate ? '₹' + rate.toLocaleString('en-IN') : '—') + '</td>' +
      '<td>' + (lineTotal ? '₹' + lineTotal.toLocaleString('en-IN') : '—') + '</td>' +
      '</tr>';
  }

  // Totals row
  var subtotal = data.subtotal || 0;
  var gst = data.gst || 0;
  var total = data.total || 0;

  h += '<tr style="border-top:2px solid var(--primary-light);font-weight:600">' +
    '<td colspan="3" style="text-align:right;padding-right:12px">Subtotal</td>' +
    '<td>₹' + subtotal.toLocaleString('en-IN') + '</td></tr>';
  h += '<tr style="font-weight:600">' +
    '<td colspan="3" style="text-align:right;padding-right:12px">GST @ 18%</td>' +
    '<td>₹' + gst.toLocaleString('en-IN') + '</td></tr>';
  h += '<tr style="font-weight:700;background:var(--primary-light);color:var(--primary-dark)">' +
    '<td colspan="3" style="text-align:right;padding-right:12px">TOTAL</td>' +
    '<td>₹' + total.toLocaleString('en-IN') + '</td></tr>';

  h += '</tbody></table></div>';

  // Copyable text (matches quote-builder format)
  var today = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });
  var textLines = ['NATIONAL CENTRE FOR THE PERFORMING ARTS', 'Sound Equipment Hire — Quote', ''];
  textLines.push('Date: ' + today);
  textLines.push('');
  textLines.push('ITEM'.padEnd(38) + 'QTY'.padStart(4) + 'RATE'.padStart(10) + 'AMOUNT'.padStart(12));
  textLines.push('─'.repeat(62));

  for (var j = 0; j < data.items.length; j++) {
    var it = data.items[j];
    var m = it.matches ? it.matches[0] : null;
    var name = m ? m.name : it.requested;
    if (name.length > 37) name = name.slice(0, 34) + '...';
    var qty = String(it.requestedQty || 1).padStart(4);
    var rateStr = it.rate ? String(it.rate).padStart(10) : ''.padStart(10);
    var amtStr = it.lineTotal ? String(it.lineTotal).padStart(12) : ''.padStart(12);
    textLines.push(name.padEnd(38) + qty + rateStr + amtStr);
  }

  textLines.push('─'.repeat(62));
  textLines.push('Subtotal'.padEnd(54) + String(subtotal).padStart(8));
  textLines.push('GST @ 18%'.padEnd(54) + String(gst).padStart(8));
  textLines.push('─'.repeat(62));
  textLines.push('TOTAL (INR)'.padEnd(54) + String(total).padStart(8));
  textLines.push('─'.repeat(62));
  textLines.push('');
  textLines.push('All amounts in Indian Rupees (INR). GST @ 18% included.');

  var fullText = textLines.join('\n');
  h += '<button class="copy-btn" onclick="navigator.clipboard.writeText(' + JSON.stringify(fullText) + ');this.textContent=\'Copied!\';setTimeout(()=>this.textContent=\'Copy Quote\',1500)">Copy Quote</button>';

  return h;
}

function renderShowList(data) {
  var shows = data.shows || [];
  if (!shows.length) return '<div class="card-in-msg">No shows found.</div>';

  var h = '<div><strong>Found ' + shows.length + ' show(s)</strong></div>';
  h += '<div class="card-in-msg">';
  for (var k = 0; k < shows.length; k++) {
    var s = shows[k];
    h += '<div class="show-item">' +
      '<div class="show-date">' + escapeHtml(s.event_date) + ' • ' + escapeHtml(s.venue || '') + '</div>' +
      '<div class="show-name">' + escapeHtml(s.program) + '</div>' +
      '<div class="show-meta">' +
      (s.call_time ? 'Call: ' + escapeHtml(s.call_time) + ' • ' : '') +
      (s.crew ? 'Crew: ' + escapeHtml(s.crew) : 'No crew assigned') +
      '</div></div>';
  }
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
