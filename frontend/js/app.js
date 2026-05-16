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
let voiceTimeout = null;
var copyStore = {};

// ─── Init ───
function init() {
  addMsg('assistant', 'Hey — SA here. What do you need?\n\nI can pull up the schedule, check who\'s free, add shows, or build an equipment quote. Just ask normally — no special commands needed.\n\n(Type /clear to wipe the slate.)');

  if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognition = new SR();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'en-IN';

    recognition.onresult = function(e) {
      clearTimeout(voiceTimeout);
      const transcript = e.results[0][0].transcript;
      textInp.value = transcript;
      stopRecording();
      textInp.classList.add('recognized');
      textInp.focus();
      setTimeout(function() {
        textInp.classList.remove('recognized');
        sendMessage();
      }, 400);
    };

    recognition.onerror = function(e) {
      clearTimeout(voiceTimeout);
      stopRecording();
      var msg = {
        'not-allowed':  'Mic access denied — check browser permissions.',
        'no-speech':    null, // silent, user just didn't speak
        'network':      'Voice recognition needs a network connection.',
        'aborted':      null, // user cancelled, silent
        'audio-capture':'No mic found. Plug one in?',
        'service-not-allowed': 'Voice not allowed in this browser context (try non-PWA mode).',
      }[e.error] || ('Mic hiccup: ' + e.error);
      if (msg) addMsg('assistant', msg);
    };

    recognition.onend = function() {
      clearTimeout(voiceTimeout);
      stopRecording();
    };
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
  try {
    recognition.start();
    voiceTimeout = setTimeout(function() {
      stopRecording();
    }, 10000); // auto-stop after 10 s
  } catch(e) {
    stopRecording();
  }
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
    addMsg('assistant', 'Cleared. Clean slate.');
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
      addMsg('assistant', 'Something went wrong on the server — ' + (err || 'unknown error') + '. Try again in a sec.');
      return;
    }

    const data = await res.json();
    const reply = data.reply || 'Got nothing back. The server might be half-asleep.';
    messages.push({ role: 'assistant', content: reply });

    const structured = tryParseStructured(reply);
    if (structured) {
      renderStructured(structured);
    } else {
      addMsg('assistant', reply);
    }
  } catch (err) {
    removeLoading(loadingId);
    addMsg('assistant', 'Can\'t reach the server right now — check your connection. (' + (err.message || err) + ')');
  } finally {
    sendBtn.disabled = false;
  }
}

// ─── Mascot ───
function mascotSVG(cls) {
  return '<svg class="' + cls + '" viewBox="0 0 48 54" xmlns="http://www.w3.org/2000/svg" style="width:42px;height:48px;overflow:visible;display:block">' +
    '<path d="M11,17 Q24,6 37,17" stroke="#323639" stroke-width="2.5" fill="none" stroke-linecap="round"/>' +
    '<rect x="6" y="14" width="7" height="8" rx="2.5" fill="#82857E"/>' +
    '<rect x="35" y="14" width="7" height="8" rx="2.5" fill="#82857E"/>' +
    '<rect x="1" y="22" width="7" height="5" rx="2.5" fill="#D47A31"/>' +
    '<rect x="40" y="22" width="7" height="5" rx="2.5" fill="#D47A31"/>' +
    '<rect x="8" y="18" width="32" height="24" rx="3" fill="#D47A31"/>' +
    '<rect x="10" y="20" width="28" height="20" rx="2" fill="#1E2022"/>' +
    '<circle cx="24" cy="29" r="8" fill="#323639"/>' +
    '<circle cx="24" cy="29" r="5.5" fill="#1E2022"/>' +
    '<circle cx="24" cy="29" r="2" fill="#82857E"/>' +
    '<rect x="17" y="36" width="14" height="4" rx="1" fill="#D47A31" opacity="0.9"/>' +
    '<text x="24" y="39.3" font-family="sans-serif" font-size="3.2" font-weight="700" text-anchor="middle" fill="white" letter-spacing="0.3">CREW</text>' +
    '<rect x="14" y="42" width="6" height="7" rx="2" fill="#D47A31"/>' +
    '<rect x="28" y="42" width="6" height="7" rx="2" fill="#D47A31"/>' +
    '<rect x="11" y="48" width="10" height="4" rx="2" fill="#1E2022"/>' +
    '<rect x="27" y="48" width="10" height="4" rx="2" fill="#1E2022"/>' +
    '</svg>';
}

// ─── Message UI ───
function addMsg(role, text) {
  const div = document.createElement('div');
  div.className = 'msg msg-' + role;
  // Clean markdown formatting and escape HTML
  const cleanText = stripMarkdown(text);
  var avatarHtml = role === 'user'
    ? '<div class="msg-avatar-user">You</div>'
    : '<div class="msg-avatar-sa">' + mascotSVG('mascot-idle') + '</div>';
  div.innerHTML = avatarHtml + '<div class="msg-body">' + escapeHtml(cleanText) + '</div>';
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
  div.innerHTML = '<div class="msg-avatar-sa">' + mascotSVG('mascot-think') + '</div>' +
    '<div class="msg-body"><div class="loading"><div class="spinner"></div>On it…</div></div>';
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

  let html = '<div class="msg-avatar-sa">' + mascotSVG('mascot-idle') + '</div><div class="msg-body">';

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
  if (!data.items || !data.items.length) {
    return '<div class="card-in-msg"><div>No items matched.</div></div>';
  }

  var h = '<div class="card-in-msg">';
  var subtotal = data.subtotal || 0;
  var gst = data.gst || 0;
  var total = data.total || 0;

  // Items stacked layout
  for (var i = 0; i < data.items.length; i++) {
    var item = data.items[i];
    var match = item.matches ? item.matches[0] : null;
    var rate = item.rate || 0;
    var lineTotal = item.lineTotal || 0;
    var itemName = match ? match.name : item.requested;
    var qty = item.requestedQty || 1;
    var borderTop = i > 0 ? 'border-top:1px solid var(--border);' : '';
    h += '<div style="' + borderTop + 'padding:10px 0;display:flex;justify-content:space-between;align-items:baseline;gap:8px">';
    h += '<span style="font-size:13px;font-weight:600;flex:1">' + escapeHtml(itemName) + '</span>';
    h += '<span style="font-size:13px;font-weight:700;white-space:nowrap">₹' + lineTotal.toLocaleString('en-IN') + '</span>';
    h += '</div>';
    h += '<div style="font-size:12px;color:var(--muted);margin-top:-6px;padding-bottom:4px">';
    h += qty + ' × ₹' + rate.toLocaleString('en-IN');
    h += '</div>';
  }
  h += '<div style="margin-bottom:16px"></div>';

  // Totals
  h += '<div style="border-top:2px solid var(--primary);padding-top:12px;margin-bottom:16px">';
  h += '<div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:8px">';
  h += '<span>Subtotal:</span><span style="font-weight:600">₹' + subtotal.toLocaleString('en-IN') + '</span>';
  h += '</div>';
  h += '<div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:12px">';
  h += '<span>GST @ 18%:</span><span style="font-weight:600">₹' + gst.toLocaleString('en-IN') + '</span>';
  h += '</div>';
  h += '<div style="display:flex;justify-content:space-between;font-size:14px;font-weight:700;color:var(--primary)">';
  h += '<span>Total (INR):</span><span>₹' + total.toLocaleString('en-IN') + '</span>';
  h += '</div>';
  h += '</div>';

  // Build HTML for rich-text clipboard (renders as table in email)
  var htmlRows = '';
  for (var j = 0; j < data.items.length; j++) {
    var it = data.items[j];
    var m = it.matches ? it.matches[0] : null;
    var name = m ? m.name : it.requested;
    var rowBg = j % 2 === 0 ? '#ffffff' : '#f5f5f5';
    htmlRows += '<tr style="background:' + rowBg + '">' +
      '<td style="padding:6px 10px;border:1px solid #ddd">' + escapeHtml(name) + '</td>' +
      '<td style="padding:6px 10px;border:1px solid #ddd;text-align:center">' + (it.requestedQty || 1) + '</td>' +
      '<td style="padding:6px 10px;border:1px solid #ddd;text-align:right">₹' + (it.rate || 0).toLocaleString('en-IN') + '</td>' +
      '<td style="padding:6px 10px;border:1px solid #ddd;text-align:right">₹' + (it.lineTotal || 0).toLocaleString('en-IN') + '</td>' +
      '</tr>';
  }
  var htmlClip = '<table style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:13px">' +
    '<thead><tr style="background:#D47A31;color:#fff">' +
    '<th style="padding:8px 12px;border:1px solid #D47A31;text-align:left">Item</th>' +
    '<th style="padding:8px 12px;border:1px solid #D47A31;text-align:center">Qty</th>' +
    '<th style="padding:8px 12px;border:1px solid #D47A31;text-align:right">Rate</th>' +
    '<th style="padding:8px 12px;border:1px solid #D47A31;text-align:right">Amount</th>' +
    '</tr></thead><tbody>' + htmlRows + '</tbody>' +
    '<tfoot>' +
    '<tr><td colspan="3" style="padding:6px 10px;border:1px solid #ddd;text-align:right">Subtotal</td><td style="padding:6px 10px;border:1px solid #ddd;text-align:right">₹' + subtotal.toLocaleString('en-IN') + '</td></tr>' +
    '<tr><td colspan="3" style="padding:6px 10px;border:1px solid #ddd;text-align:right">GST @ 18%</td><td style="padding:6px 10px;border:1px solid #ddd;text-align:right">₹' + gst.toLocaleString('en-IN') + '</td></tr>' +
    '<tr style="font-weight:bold"><td colspan="3" style="padding:6px 10px;border:1px solid #ddd;text-align:right">Total (INR)</td><td style="padding:6px 10px;border:1px solid #ddd;text-align:right">₹' + total.toLocaleString('en-IN') + '</td></tr>' +
    '</tfoot></table>';

  // Plain-text fallback (column-aligned)
  var col1 = 32, col2 = 5, col3 = 8;
  var plainLines = [
    padEnd('Item', col1) + padEnd('Qty', col2) + padEnd('Rate', col3) + 'Amount',
    repeat('-', col1 + col2 + col3 + 8)
  ];
  for (var k = 0; k < data.items.length; k++) {
    var pit = data.items[k];
    var pm = pit.matches ? pit.matches[0] : null;
    var pname = pm ? pm.name : pit.requested;
    plainLines.push(
      padEnd(pname, col1) +
      padEnd(String(pit.requestedQty || 1), col2) +
      padEnd('₹' + (pit.rate || 0), col3) +
      '₹' + (pit.lineTotal || 0)
    );
  }
  plainLines.push(repeat('-', col1 + col2 + col3 + 8));
  plainLines.push(padEnd('Subtotal', col1 + col2) + padEnd('', col3) + '₹' + subtotal);
  plainLines.push(padEnd('GST @ 18%', col1 + col2) + padEnd('', col3) + '₹' + gst);
  plainLines.push(padEnd('Total (INR)', col1 + col2) + padEnd('', col3) + '₹' + total);
  var plainText = plainLines.join('\n');

  var copyId = 'q-' + Date.now();
  copyStore[copyId] = { html: htmlClip, text: plainText };
  var copyBtn = '<button class="copy-btn" style="width:100%;padding:14px;font-size:15px;font-weight:700;margin-top:4px;background:var(--primary);color:#fff;border:none;border-radius:10px;cursor:pointer;letter-spacing:0.3px" ' +
    'onclick="copyQuoteRichText(this,\'' + copyId + '\')">&#128203; Copy Quote</button>';

  h += copyBtn;
  h += '</div>';
  return h;
}

function padEnd(str, len) {
  str = String(str);
  while (str.length < len) str += ' ';
  return str;
}

function repeat(ch, n) {
  var s = '';
  for (var i = 0; i < n; i++) s += ch;
  return s;
}

function copyQuoteRichText(btn, copyId) {
  var stored = copyStore[copyId] || {};
  var htmlClip = stored.html || '';
  var plainText = stored.text || '';
  var finish = function(ok) {
    btn.textContent = ok ? '✓ Copied!' : '✓ Copied (plain text)';
    btn.style.background = 'var(--accent)';
    setTimeout(function() {
      btn.innerHTML = '&#128203; Copy Quote';
      btn.style.background = 'var(--primary)';
    }, 2500);
  };

  if (navigator.clipboard && window.ClipboardItem) {
    try {
      var htmlBlob = new Blob([htmlClip], { type: 'text/html' });
      var textBlob = new Blob([plainText], { type: 'text/plain' });
      navigator.clipboard.write([new ClipboardItem({ 'text/html': htmlBlob, 'text/plain': textBlob })])
        .then(function() { finish(true); })
        .catch(function() {
          navigator.clipboard.writeText(plainText).then(function() { finish(false); });
        });
    } catch(e) {
      navigator.clipboard.writeText(plainText).then(function() { finish(false); });
    }
  } else if (navigator.clipboard) {
    navigator.clipboard.writeText(plainText).then(function() { finish(false); });
  } else {
    finish(false);
  }
}

function renderShowList(data) {
  var shows = data.shows || [];
  if (!shows.length) return '<div class="card-in-msg">No shows found.</div>';

  var label = shows.length === 1 ? '1 show' : shows.length + ' shows';
  var h = '<div style="font-size:13px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.4px;margin-bottom:8px">' + label + '</div>';

  for (var k = 0; k < shows.length; k++) {
    var s = shows[k];
    var dateStr = s.event_date ? s.event_date.replace(/^(\d{4})-(\d{2})-(\d{2})$/, function(_, y, m, d) {
      var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      return d + ' ' + months[parseInt(m, 10) - 1] + ' ' + y;
    }) : '—';
    var borderTop = k > 0 ? 'border-top:1px solid var(--border);margin-top:10px;padding-top:10px' : '';
    h += '<div style="' + borderTop + '">';
    h += '<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:3px">';
    h += '<span style="font-weight:700;font-size:14px">' + escapeHtml(s.program || '—') + '</span>';
    h += '<span style="font-size:11px;font-weight:600;color:var(--primary);white-space:nowrap;margin-left:8px">' + escapeHtml(dateStr) + '</span>';
    h += '</div>';
    h += '<div style="font-size:12px;color:var(--muted);margin-bottom:4px">' + escapeHtml(s.venue || 'Venue TBD') + '</div>';
    var metaRow = [];
    if (s.call_time) metaRow.push('Call: <strong>' + escapeHtml(s.call_time) + '</strong>');
    if (s.crew && s.crew !== 'no crew yet') metaRow.push('Crew: <strong>' + escapeHtml(s.crew) + '</strong>');
    else metaRow.push('<span style="color:var(--muted)">No crew assigned</span>');
    h += '<div style="font-size:13px">' + metaRow.join(' &nbsp;·&nbsp; ') + '</div>';
    h += '</div>';
  }

  return '<div class="card-in-msg">' + h + '</div>';
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
