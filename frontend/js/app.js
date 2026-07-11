// Sound Agent Frontend
// Talks to Render backend

const API_BASE = 'https://sound-agent-api.onrender.com';
const chatEl = document.getElementById('chat');
const pageEl = document.querySelector('.page');
const micBtn = document.getElementById('mic-btn');
const textInp = document.getElementById('text-inp');
const sendBtn = document.getElementById('send-btn');

let mediaRecorder = null;
let audioChunks = [];
let recordingStream = null;
let isRecording = false;
let messages = [];
let voiceTimeout = null;
var copyStore = {};
var activeTask = null; // { type: 'CT'|'SR'|'Assign'|'Add', prefix: 'CT: ' }

function setCEText(el, text) {
  el.textContent = text;
  if (text) {
    try {
      var r = document.createRange(); var s = window.getSelection();
      r.selectNodeContents(el); r.collapse(false);
      s.removeAllRanges(); s.addRange(r);
    } catch(e) {}
  }
}

const STORAGE_KEY = 'eddy_msgs';
const MAX_MSGS = 40;

function saveMessages() {
  var trimmed = messages.slice(-MAX_MSGS);
  messages = trimmed;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed)); } catch(e) {}
}

function clearMessages() {
  messages = [];
  try { localStorage.removeItem(STORAGE_KEY); } catch(e) {}
}

// ─── Init ───
function init() {
  syncViewportHeight();

  var saved = null;
  try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch(e) {}

  if (saved && saved.length) {
    messages = saved;
    for (var i = 0; i < saved.length; i++) {
      var m = saved[i];
      if (m.role === 'user') {
        addMsg('user', m.content);
      } else if (m.role === 'assistant') {
        var structured = tryParseStructured(m.content);
        if (structured) { renderStructured(structured); } else { addMsg('assistant', m.content); }
      }
    }
  } else {
    addMsg('assistant', 'Hey — Eddy here. What do you need?\n\nI can pull up the schedule, check who\'s free, add shows, or build an equipment quote. Just ask normally — no special commands needed.\n\n(Type /clear to wipe the slate.)');
  }

  if (!navigator.mediaDevices || !window.MediaRecorder) {
    micBtn.style.display = 'none';
  }
}

function syncViewportHeight() {
  var vv = window.visualViewport;
  var inputBarEl = document.querySelector('.input-bar');
  if (vv) {
    document.documentElement.style.setProperty('--app-height', vv.height + 'px');
    var keyboardH = window.innerHeight - vv.height - vv.offsetTop;
    var kbOpen = keyboardH > 100;
    if (inputBarEl) {
      // iOS 15+ repositions position:fixed;bottom:0 above the keyboard natively.
      // Setting explicit bottom here double-offsets and creates a gap. Clear it.
      inputBarEl.style.bottom = '';
      // Strip the safe-area padding when keyboard is open (home indicator is hidden).
      inputBarEl.style.paddingBottom = kbOpen ? '6px' : '';
    }
  } else {
    document.documentElement.style.setProperty('--app-height', window.innerHeight + 'px');
  }
}

window.addEventListener('resize', syncViewportHeight);
window.addEventListener('orientationchange', syncViewportHeight);
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', syncViewportHeight);
  window.visualViewport.addEventListener('scroll', syncViewportHeight);
}

// ─── Recording ───
micBtn.addEventListener('mousedown', startRecording);
micBtn.addEventListener('mouseup', stopRecording);
micBtn.addEventListener('touchstart', function(e) { e.preventDefault(); startRecording(); });
micBtn.addEventListener('touchend', function(e) { e.preventDefault(); stopRecording(); });

function startRecording() {
  if (isRecording) return;
  navigator.mediaDevices.getUserMedia({ audio: true }).then(function(stream) {
    recordingStream = stream;
    audioChunks = [];

    var mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg']
      .find(function(t) { return MediaRecorder.isTypeSupported(t); }) || '';

    mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType: mimeType } : {});
    mediaRecorder.ondataavailable = function(e) {
      if (e.data && e.data.size > 0) audioChunks.push(e.data);
    };
    mediaRecorder.start();
    isRecording = true;
    micBtn.classList.add('recording');
    voiceTimeout = setTimeout(stopRecording, 10000);
  }).catch(function() {
    addMsg('assistant', 'Mic access denied — check browser permissions.');
  });
}

function stopRecording() {
  if (!isRecording) return;
  clearTimeout(voiceTimeout);
  isRecording = false;
  micBtn.classList.remove('recording');
  micBtn.classList.add('transcribing');

  if (!mediaRecorder) {
    micBtn.classList.remove('transcribing');
    return;
  }

  mediaRecorder.onstop = function() {
    var mimeType = mediaRecorder.mimeType || 'audio/webm';
    var blob = new Blob(audioChunks, { type: mimeType });

    if (recordingStream) {
      recordingStream.getTracks().forEach(function(t) { t.stop(); });
      recordingStream = null;
    }

    if (blob.size < 1000) {
      // Too short — user just tapped mic without speaking
      micBtn.classList.remove('transcribing');
      return;
    }

    var formData = new FormData();
    formData.append('audio', blob, 'recording.webm');

    fetch(API_BASE + '/api/transcribe', { method: 'POST', body: formData })
      .then(function(res) { return res.ok ? res.json() : Promise.reject(res.status); })
      .then(function(data) {
        if (data.text && data.text.trim()) {
          setCEText(textInp, data.text.trim());
          textInp.classList.add('recognized');
          textInp.focus();
          setTimeout(function() { textInp.classList.remove('recognized'); }, 400);
        }
      })
      .catch(function() {
        addMsg('assistant', 'Transcription failed — try typing instead.');
      })
      .finally(function() {
        micBtn.classList.remove('transcribing');
      });
  };

  try { mediaRecorder.stop(); } catch(e) { micBtn.classList.remove('transcribing'); }
}

// ─── Slash commands ───
const SLASH_COMMANDS = [
  { cmd: '/clear',          desc: 'Wipe the chat' },
  { cmd: '/add-show',       desc: 'Add a show',                prefix: 'Add: ',         taskType: 'Add' },
  { cmd: '/crew',           desc: 'Check crew availability',   prefix: 'Crew: ',        taskType: 'Crew' },
  { cmd: '/crew-assign',    desc: 'Assign crew to a show',     prefix: 'Assign: ',      taskType: 'Assign' },
  { cmd: '/update-CT',      desc: 'Update call time',          prefix: 'CT: ',          taskType: 'CT' },
  { cmd: '/update-sound',   desc: 'Update sound requirements', prefix: 'SR: ',          taskType: 'SR' },
  { cmd: '/update-venue',   desc: 'Change show venue',         prefix: 'Venue: ',       taskType: 'Venue' },
  { cmd: '/quote',          desc: 'Build an equipment quote',  prefix: 'Quote — Items: ', taskType: 'Quote' },
  { cmd: '/day-off',        desc: 'Manage crew day-offs',      prefix: 'Day-off — Crew: ', taskType: 'DayOff' },
  { cmd: '/delete-show',    desc: 'Delete a show',             prefix: 'Delete: ',      taskType: 'Delete' },
];

const slashMenu = document.getElementById('slash-menu');

function updateSlashMenu() {
  var val = textInp.innerText || '';
  if (!val.startsWith('/')) { slashMenu.style.display = 'none'; return; }
  var query = val.toLowerCase();
  var matches = SLASH_COMMANDS.filter(function(c) { return c.cmd.startsWith(query); });
  if (!matches.length) { slashMenu.style.display = 'none'; return; }
  slashMenu.innerHTML = matches.map(function(c) {
    return '<div class="slash-item" data-cmd="' + c.cmd + '">' +
      '<span class="slash-cmd">' + c.cmd + '</span>' +
      '<span class="slash-desc">' + c.desc + '</span></div>';
  }).join('');
  slashMenu.style.display = 'block';
}

slashMenu.addEventListener('mousedown', function(e) {
  var item = e.target.closest('.slash-item');
  if (!item) return;
  e.preventDefault();
  var matched = SLASH_COMMANDS.find(function(c) { return c.cmd === item.dataset.cmd; });
  slashMenu.style.display = 'none';
  if (matched && matched.prefix) {
    activeTask = { type: matched.taskType, prefix: matched.prefix };
    setCEText(textInp, matched.prefix);
    textInp.focus();
  } else {
    setCEText(textInp, item.dataset.cmd);
    sendMessage();
  }
});

// ─── Send ───
sendBtn.addEventListener('click', sendMessage);
textInp.addEventListener('input', updateSlashMenu);
textInp.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') { slashMenu.style.display = 'none'; return; }
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});

async function sendMessage() {
  slashMenu.style.display = 'none';
  const text = (textInp.innerText || '').trim();
  if (!text) return;

  // Handle slash commands
  var matched = SLASH_COMMANDS.find(function(c) { return c.cmd === text.toLowerCase(); });
  if (matched) {
    if (matched.prefix) {
      activeTask = { type: matched.taskType, prefix: matched.prefix };
      setCEText(textInp, matched.prefix);
      textInp.focus();
    } else if (matched.cmd === '/clear') {
      chatEl.innerHTML = '';
      clearMessages();
      textInp.textContent = '';
      activeTask = null;
      addMsg('assistant', 'Cleared. Clean slate.');
    }
    return;
  }

  addMsg('user', text);
  messages.push({ role: 'user', content: text });
  saveMessages();
  textInp.textContent = '';

  // Keep delete flow active across follow-ups (e.g. "yes" after a past-show warning).
  if (!activeTask && /\b(delete|remove|cancel|delet)\b/i.test(text) && /\bshow\b/i.test(text)) {
    activeTask = { type: 'Delete', prefix: '' };
  }

  const loadingId = addLoading();
  sendBtn.disabled = true;

  try {
    const res = await fetch(API_BASE + '/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: messages, activeTask: activeTask }),
    });

    removeLoading(loadingId);

    if (!res.ok) {
      let friendlyMsg = 'Something went wrong on the server. Try again in a sec.';
      try {
        const errData = await res.json();
        if (errData.reply) friendlyMsg = errData.reply;
      } catch (_) {}
      addMsg('assistant', friendlyMsg);
      return;
    }

    const data = await res.json();
    const reply = data.reply || 'Got nothing back. The server might be half-asleep.';
    const taskDone = data.taskDone || false;
    messages.push({ role: 'assistant', content: reply });
    saveMessages();

    if (taskDone || !activeTask) {
      activeTask = null;
    } else if (activeTask) {
      // Restore prefix hint so user sees context for their next reply
      setCEText(textInp, activeTask.prefix);
    }

    const structured = tryParseStructured(reply);
    const quip = stripJsonBlocks(reply);
    if (structured) {
      if (quip) addMsg('assistant', quip);
      renderStructured(structured, text);
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
  const mascotSrc = '/images/mascot.png';
  const mascotStyle = 'width:84px;height:auto;display:block;filter:none';
  return '<img class="' + cls + '" src="' + mascotSrc + '" alt="Sound Agent" style="' + mascotStyle + '">';
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
  div.innerHTML = avatarHtml + '<div class="msg-body"><div class="msg-body-inner">' + escapeHtml(cleanText) + '</div></div>';
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
    '<div class="msg-body"><div class="msg-body-inner"><div class="loading"><div class="spinner"></div>On it…</div></div></div>';
  chatEl.appendChild(div);
  scrollToBottom();
  return id;
}

function removeLoading(id) {
  const el = document.getElementById(id);
  if (el) el.remove();
}

function scrollToBottom() {
  requestAnimationFrame(function() {
    pageEl.scrollTop = pageEl.scrollHeight;
  });
}

// ─── Structured Rendering ───
function tryParseStructured(text) {
  // Use the LAST ```json block — the backend appends the authoritative one at the end.
  const matches = [...text.matchAll(/```json\s*([\s\S]*?)```/g)];
  if (!matches.length) return null;
  try {
    return JSON.parse(matches[matches.length - 1][1]);
  } catch {
    return null;
  }
}

function stripJsonBlocks(text) {
  if (!text) return '';
  return text.replace(/```json[\s\S]*?```/g, '').trim();
}

function renderStructured(data, userText) {
  const div = document.createElement('div');
  div.className = 'msg msg-assistant';

  let html = '<div class="msg-avatar-sa">' + mascotSVG('mascot-idle') + '</div><div class="msg-body"><div class="msg-body-inner">';

  if (data.type === 'crew_availability') {
    html += renderCrewPicker(data);
  } else if (data.type === 'quote') {
    html += renderQuote(data);
  } else if (data.type === 'shows') {
    var deleteIntent = /\b(delete|remove|cancel|delet)\b/i.test(userText || '');
    html += renderShowList(data, deleteIntent);
  } else if (data.type === 'success') {
    html += '✅ ' + escapeHtml(data.message || 'Done');
  } else {
    html += escapeHtml(JSON.stringify(data, null, 2));
  }

  html += '</div></div>';
  div.innerHTML = html;
  chatEl.appendChild(div);
  scrollToBottom();

  if (data.type === 'crew_availability') {
    attachCrewListeners(data, div);
  }
  if (data.type === 'shows' && deleteIntent) {
    attachShowDeleteListeners(div);
  }
}

function renderCrewPicker(data) {
  const date = data.date || 'selected date';
  const pid = 'cp-' + Date.now();
  const conflicts = data.conflicts || [];
  const singleShowId = conflicts.length === 1 ? conflicts[0].id : null;

  let h = '<div class="crew-picker-root" data-pid="' + pid + '"' +
    (singleShowId != null ? ' data-show-id="' + singleShowId + '"' : '') + '>';

  if (conflicts.length === 1) {
    // Single show — just a header label
    h += '<div style="margin-bottom:8px"><strong>' +
      escapeHtml(conflicts[0].program) + '</strong> @ ' + escapeHtml(conflicts[0].venue) +
      ' — ' + escapeHtml(fmtDate(date)) + '</div>';
    if (conflicts[0].crew && conflicts[0].crew !== 'no crew yet') {
      h += '<div style="font-size:12px;color:var(--muted);margin-bottom:8px">Current crew: ' +
        escapeHtml(conflicts[0].crew) + '</div>';
    }
  } else if (conflicts.length > 1) {
    // Multiple shows — radio selector
    h += '<div style="margin-bottom:10px">' +
      '<div style="font-size:12px;font-weight:700;margin-bottom:6px">Assigning to which show?</div>' +
      conflicts.map(function(c, i) {
        return '<div style="margin-bottom:4px">' +
          '<label style="display:flex;align-items:center;gap:6px;font-size:13px">' +
          '<input type="radio" name="show-pick-' + pid + '" value="' + escapeHtml(String(c.id)) + '"' + (i === 0 ? ' checked' : '') + '>' +
          '<strong>' + escapeHtml(c.program) + '</strong> @ ' + escapeHtml(c.venue) +
          (c.crew && c.crew !== 'no crew yet' ? ' <span style="color:var(--muted);font-size:12px">(' + escapeHtml(c.crew) + ')</span>' : '') +
          '</label></div>';
      }).join('') +
      '</div>';
  } else {
    h += '<div><strong>Crew for ' + escapeHtml(fmtDate(date)) + '</strong></div>';
  }

  if (!data.available || !data.available.length) {
    h += '<div class="no-crew">😔 No crew available.</div></div>';
    return h;
  }

  h += '<div class="card-in-msg">';

  h += '<div class="role-hdr"><span class="role-label">FOH Engineer</span><span class="role-badge badge-foh">Single select</span></div>' +
    '<p class="role-hint">Pick one FOH engineer.</p>' +
    '<div class="pill-grid">' +
    data.available.map(function(name) {
      var inputId = 'foh-' + pid + '-' + name.replace(/[^a-zA-Z0-9]/g, '_');
      return '<div class="cpill foh-pill"><input type="radio" id="' + inputId + '" name="foh-' + pid + '" value="' + escapeHtml(name) + '">' +
        '<label for="' + inputId + '">' + escapeHtml(name) + '</label></div>';
    }).join('') +
    '<div class="cpill foh-pill none-pill"><input type="radio" id="foh-' + pid + '-none" name="foh-' + pid + '" value="" checked>' +
    '<label for="foh-' + pid + '-none">None / TBD</label></div>' +
    '</div>';

  h += '<div class="divider"></div>';

  h += '<div class="role-hdr"><span class="role-label">Stage Crew</span><span class="role-badge badge-stage">Multi select</span></div>' +
    '<p class="role-hint">Pick one or more stage crew.</p>' +
    '<div class="pill-grid">' +
    data.available.map(function(name) {
      var inputId = 'stage-' + pid + '-' + name.replace(/[^a-zA-Z0-9]/g, '_');
      return '<div class="cpill stage-pill"><input type="checkbox" id="' + inputId + '" name="stage-' + pid + '" value="' + escapeHtml(name) + '">' +
        '<label for="' + inputId + '">' + escapeHtml(name) + '</label></div>';
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
    '<button class="copy-btn btn-assign">✓ Assign Crew</button>' +
    '<button class="copy-btn btn-skip" style="background:var(--muted)">Skip for now</button>' +
    '</div>';

  h += '</div>';
  return h;
}

function attachCrewListeners(data, container) {
  var date = data.date;
  var root = container.querySelector('.crew-picker-root');
  if (!root) return;

  var pid = root.dataset.pid;
  var fohName = pid ? 'foh-' + pid : 'foh';
  var stageName = pid ? 'stage-' + pid : 'stage';

  function syncStageVisibility(selectedFohValue) {
    root.querySelectorAll('input[name="' + stageName + '"]').forEach(function(el) {
      var pill = el.closest('.cpill');
      if (!pill) return;
      if (el.value === selectedFohValue) {
        el.checked = false;
        pill.style.display = 'none';
      } else {
        pill.style.display = '';
      }
    });
  }

  root.querySelectorAll('input[name="' + fohName + '"]').forEach(function(el) {
    el.addEventListener('change', function() {
      syncStageVisibility(el.value);
    });
  });

  root.querySelectorAll('input[name="' + stageName + '"]').forEach(function(el) {
    el.addEventListener('change', function() {
      if (!el.checked) return;
      var fohRadio = root.querySelector('input[name="' + fohName + '"]:checked');
      if (fohRadio && fohRadio.value === el.value) {
        var noneRadio = root.querySelector('input[name="' + fohName + '"][value=""]');
        if (noneRadio) noneRadio.checked = true;
        syncStageVisibility('');
      }
    });
  });

  var assignBtn = root.querySelector('.btn-assign');
  if (assignBtn) {
    assignBtn.addEventListener('click', function() {
      var fohEl = root.querySelector('input[name="' + fohName + '"]:checked');
      var foh = fohEl ? fohEl.value : '';
      var stageEls = root.querySelectorAll('input[name="' + stageName + '"]:checked');
      var stage = Array.from(stageEls).map(function(e) { return e.value; }).filter(Boolean);

      // Prefer show ID from radio selector (multi-show), then from root data attr (single show)
      var showPickEl = root.querySelector('input[name="show-pick-' + pid + '"]:checked');
      var showId = showPickEl ? showPickEl.value : (root.dataset.showId || '');
      var msg = showId
        ? 'Assign crew for show #' + showId + ' on ' + date + ': FOH=' + (foh || 'TBD') + ', Stage=' + (stage.join(', ') || 'TBD')
        : 'Assign crew for ' + date + ': FOH=' + (foh || 'TBD') + ', Stage=' + (stage.join(', ') || 'TBD');
      setCEText(textInp, msg);
      sendMessage();
    });
  }

  var skipBtn = root.querySelector('.btn-skip');
  if (skipBtn) {
    skipBtn.addEventListener('click', function() {
      addMsg('assistant', 'Crew assignment skipped. You can assign later by saying "Assign crew to [show]."');
    });
  }
}

function attachShowDeleteListeners(container) {
  container.querySelectorAll('.del-show-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var showId = btn.dataset.showId;
      setCEText(textInp, 'Confirm delete show #' + showId);
      sendMessage();
    });
  });
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
    var itemName = (match ? match.name : item.requested) || item.name || '';
    var qty = item.requestedQty || item.quantity || 1;
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
    var name = (m ? m.name : it.requested) || it.name || '';
    var rowBg = j % 2 === 0 ? '#ffffff' : '#f5f5f5';
    htmlRows += '<tr style="background:' + rowBg + '">' +
      '<td style="padding:6px 10px;border:1px solid #ddd">' + escapeHtml(name) + '</td>' +
      '<td style="padding:6px 10px;border:1px solid #ddd;text-align:center">' + (it.requestedQty || it.quantity || 1) + '</td>' +
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
    var pname = (pm ? pm.name : pit.requested) || pit.name || '';
    plainLines.push(
      padEnd(pname, col1) +
      padEnd(String(pit.requestedQty || pit.quantity || 1), col2) +
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

function renderShowList(data, showDelete) {
  var shows = data.shows || [];
  if (!shows.length) return '<div class="card-in-msg">No shows found.</div>';

  var label = shows.length === 1 ? '1 show' : shows.length + ' shows';
  var h = '<div style="font-size:13px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.4px;margin-bottom:8px">' + label + '</div>';

  for (var k = 0; k < shows.length; k++) {
    var s = shows[k];
    var dateStr = fmtDate(s.event_date);
    var borderTop = k > 0 ? 'border-top:1px solid var(--border);margin-top:10px;padding-top:10px' : '';
    h += '<div style="' + borderTop + '">';
    h += '<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:3px">';
    h += '<span style="font-weight:700;font-size:14px">' + escapeHtml(s.program || '—') + '</span>';
    h += '<span style="font-size:11px;font-weight:600;color:var(--primary);white-space:nowrap;margin-left:8px">' + escapeHtml(dateStr) + '</span>';
    h += '</div>';
    h += '<div style="font-size:12px;color:var(--muted);margin-bottom:4px">' + escapeHtml(s.venue || 'Venue TBD') + '</div>';
    var metaRow = [];
    if (s.call_time) metaRow.push('Call: <strong>' + escapeHtml(fmtTime24(s.call_time)) + '</strong>');
    var hasCrew = s.foh_crew || s.stage_crew || (s.crew && s.crew !== 'no crew yet');
    if (hasCrew) {
      if (s.foh_crew || s.stage_crew) {
        if (s.foh_crew) metaRow.push('FOH: <strong>' + escapeHtml(s.foh_crew) + '</strong>');
        if (s.stage_crew) metaRow.push('Stage: <strong>' + escapeHtml(s.stage_crew) + '</strong>');
      } else {
        metaRow.push('Crew: <strong>' + escapeHtml(s.crew) + '</strong>');
      }
    } else {
      metaRow.push('<span style="color:var(--muted)">No crew assigned</span>');
    }
    h += '<div style="font-size:13px">' + metaRow.join(' &nbsp;·&nbsp; ') + '</div>';
    if (s.sound_requirements) {
      h += '<div style="font-size:12px;color:var(--muted);margin-top:4px">Sound: ' + escapeHtml(s.sound_requirements) + '</div>';
    }
    if (s.id && showDelete) {
      h += '<button class="del-show-btn" data-show-id="' + s.id + '" style="margin-top:10px;padding:6px 14px;font-size:12px;font-weight:600;color:#fff;background:#c0392b;border:none;border-radius:8px;cursor:pointer;letter-spacing:0.2px">&#128465; Delete Show</button>';
    }
    h += '</div>';
  }

  return '<div class="card-in-msg">' + h + '</div>';
}

// ─── Helpers ───
function fmtDate(dateStr) {
  if (!dateStr) return '—';
  var m = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return dateStr;
  return m[3] + '/' + m[2] + '/' + m[1].slice(2);
}

function fmtTime24(t) {
  if (!t) return t;
  if (/^\d{1,2}:\d{2}$/.test(t.trim())) {
    var parts = t.trim().split(':');
    return parts[0].padStart(2, '0') + ':' + parts[1];
  }
  var m = t.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i);
  if (!m) return t;
  var h = parseInt(m[1]), min = m[2] ? parseInt(m[2]) : 0;
  if (m[3].toLowerCase() === 'pm' && h !== 12) h += 12;
  if (m[3].toLowerCase() === 'am' && h === 12) h = 0;
  return String(h).padStart(2, '0') + ':' + String(min).padStart(2, '0');
}

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
