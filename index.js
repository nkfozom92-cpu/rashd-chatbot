require('dotenv').config();

const express = require('express');
const axios = require('axios');
const pino = require('pino');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const AUTH_DIR = process.env.AUTH_DIR || path.join(__dirname, 'auth_info');
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';

const GEMINI_URL =
  `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent`;

const SYSTEM_PROMPT = `
তুমি TALHA THE AI। তুমি একজন বন্ধুসুলভ, বুদ্ধিমান ও সাহায্যকারী AI Assistant।
- বাংলা, English, Hindi সহ ব্যবহারকারীর ভাষায় উত্তর দেবে।
- কোডিং, প্রযুক্তি, পড়াশোনা ও সাধারণ বিষয়ে সাহায্য করবে।
- ভুল তথ্য বানিয়ে বলবে না।
- উত্তর পরিষ্কার, ভদ্র ও সহজবোধ্য রাখবে।
- ছবি তৈরির অনুরোধে ব্যবহারকারীকে /image কমান্ড ব্যবহারের কথা বলবে।
`;

app.use(express.json({ limit: '512kb' }));
app.use(express.urlencoded({ extended: true }));

let logs = [];
let waSocket = null;
let waConnected = false;
let waStarting = false;
let pairingCode = null;
let waPhoneNumber = null;
let reconnectAttempts = 0;
let reconnectTimer = null;
let startInProgress = false;
let manuallyStopped = false;

function log(message) {
  const line = `[${new Date().toISOString()}] ${message}`;
  logs.push(line);
  if (logs.length > 250) logs.shift();
  console.log(line);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function requireAdmin(req, res, next) {
  if (!ADMIN_TOKEN) {
    return res.status(503).json({
      error: 'ADMIN_TOKEN সেট করা নেই। Render Environment-এ সেট করুন।'
    });
  }

  const token =
    req.headers['x-admin-token'] ||
    req.body?.adminToken ||
    '';

  if (token !== ADMIN_TOKEN) {
    return res.status(401).json({
      error: 'Invalid Admin Token'
    });
  }

  next();
}

function getImagePrompt(text) {
  const match = String(text || '')
    .trim()
    .match(/^\/(?:image|img|imagine)\s+([\s\S]+)/i);

  return match ? match[1].trim() : null;
}

async function askAI(message) {
  if (!GEMINI_API_KEY) {
    log('ERROR: GEMINI_API_KEY missing');

    return 'Gemini API Key পাওয়া যাচ্ছে না। Admin-কে Render Environment-এ GEMINI_API_KEY সেট করতে বলুন।';
  }

  try {
    const response = await axios.post(
      GEMINI_URL,
      {
        systemInstruction: {
          parts: [{ text: SYSTEM_PROMPT }]
        },

        contents: [{
          role: 'user',
          parts: [{ text: message }]
        }],

        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 2048
        }
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': GEMINI_API_KEY
        },
        timeout: 60000
      }
    );

    const answer = response.data?.candidates?.[0]
      ?.content?.parts
      ?.map(part => part.text || '')
      .join('')
      .trim();

    if (!answer) {
      log('Gemini returned an empty response');

      return 'দুঃখিত, AI এই মুহূর্তে উত্তর তৈরি করতে পারেনি। আবার চেষ্টা করুন।';
    }

    log('Gemini API SUCCESS');

    return answer;

  } catch (error) {
    const status = error.response?.status || 'NETWORK';

    const detail =
      error.response?.data?.error?.message ||
      error.message;

    log(`GEMINI ERROR ${status}: ${detail}`);

    return `দুঃখিত, Gemini API Error (${status})। কিছুক্ষণ পর আবার চেষ্টা করুন।`;
  }
}

async function generateImage(prompt) {
  const url =
    'https://image.pollinations.ai/prompt/' +
    encodeURIComponent(prompt) +
    '?width=1024&height=1024&nologo=true';

  const response = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 90000
  });

  return Buffer.from(response.data);
}

// HEALTH CHECK

app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    whatsapp: waConnected ? 'connected' : 'offline',
    starting: waStarting,
    uptime: Math.floor(process.uptime())
  });
});

// STATUS

app.get('/api/status', requireAdmin, (req, res) => {
  res.json({
    name: 'TALHA THE AI',
    whatsapp: waConnected ? 'connected' : 'offline',
    starting: waStarting,
    phone: waPhoneNumber,
    pairingCode,
    model: GEMINI_MODEL,
    reconnectAttempts
  });
});

// LOGS

app.get('/api/logs', requireAdmin, (req, res) => {
  res.json({ logs });
});

// WHATSAPP START

app.post('/api/wa/start', requireAdmin, async (req, res) => {
  const phone = String(req.body.phone || '')
    .replace(/\D/g, '');

  if (phone.length < 8 || phone.length > 15) {
    return res.status(400).json({
      error: 'সঠিক WhatsApp নম্বর দিন। Country code-সহ দিন, যেমন 8801XXXXXXXXX।'
    });
  }

  if (waConnected) {
    return res.json({
      ok: true,
      message: 'WhatsApp already connected'
    });
  }

  if (startInProgress || waStarting) {
    return res.json({
      ok: true,
      message: 'WhatsApp pairing/reconnection already running',
      pairingCode
    });
  }

  waPhoneNumber = phone;
  pairingCode = null;
  manuallyStopped = false;

  try {
    await startWhatsAppBot();

    res.json({
      ok: true,
      message: 'WhatsApp pairing started. Pairing code dashboard-এ আসবে।'
    });

  } catch (error) {
    log('WhatsApp start error: ' + error.message);

    res.status(500).json({
      error: 'WhatsApp start failed: ' + error.message
    });
  }
});

// WHATSAPP RESET

app.post('/api/wa/reset', requireAdmin, async (req, res) => {
  try {
    manuallyStopped = true;

    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }

    const oldSocket = waSocket;

    waSocket = null;
    waConnected = false;
    waStarting = false;
    startInProgress = false;
    pairingCode = null;
    waPhoneNumber = null;
    reconnectAttempts = 0;

    if (oldSocket) {
      try {
        oldSocket.end(new Error('Session reset by admin'));
      } catch (_) {}
    }

    fs.rmSync(AUTH_DIR, {
      recursive: true,
      force: true
    });

    log('WhatsApp session reset by admin');

    res.json({
      ok: true,
      message: 'Session reset successful. এখন নতুন করে pair করুন।'
    });

  } catch (error) {
    log('Reset error: ' + error.message);

    res.status(500).json({
      error: error.message
    });
  }
});

// DASHBOARD

app.get('/', (req, res) => {
  res.send(`<!doctype html>
<html lang="bn">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>TALHA THE AI</title>

<style>
*{box-sizing:border-box}

body{
margin:0;
padding:20px;
background:#050b16;
color:#eaf6ff;
font-family:Arial,sans-serif;
max-width:820px;
margin:auto
}

.card{
background:linear-gradient(145deg,#101d30,#080f22);
border:1px solid #164d72;
border-radius:18px;
padding:20px;
margin:0 0 18px;
box-shadow:0 0 18px #00bfff12
}

.brand{
display:flex;
align-items:center;
gap:16px
}

.logo{
width:64px;
height:64px;
border-radius:18px;
background:linear-gradient(135deg,#087bff,#00e5c4);
display:grid;
place-items:center;
font-weight:900;
font-size:20px;
color:white
}

h1{
margin:0;
color:#fff;
font-size:25px;
letter-spacing:2px
}

h2{
color:#00e5d4;
margin:0 0 14px
}

p{
line-height:1.6
}

.muted{
color:#a5bed2
}

.status{
font-size:19px;
font-weight:bold;
color:#00e5a0
}

input{
width:100%;
padding:14px;
margin:7px 0;
border-radius:10px;
border:1px solid #28729a;
background:#071321;
color:white;
font-size:16px
}

button{
width:100%;
padding:14px;
margin-top:9px;
background:linear-gradient(90deg,#075dff,#00c8ff);
border:0;
border-radius:10px;
color:white;
font-weight:bold;
font-size:15px
}

button.danger{
background:#a32445
}

.code{
padding:18px;
text-align:center;
background:#fff;
color:#001528;
border-radius:12px;
font-size:30px;
letter-spacing:6px;
font-weight:bold;
margin-top:12px
}

.logs{
height:300px;
overflow:auto;
background:#020710;
padding:12px;
border-radius:10px;
font-size:12px;
color:#9deaff;
overflow-wrap:anywhere
}

.log{
padding:7px;
border-bottom:1px solid #172b40
}

.hidden{
display:none
}

.pill{
display:inline-block;
padding:5px 10px;
border-radius:20px;
background:#062c38;
color:#00e5a0
}
</style>
</head>

<body>

<div class="card brand">
  <div class="logo">TTA</div>

  <div>
    <h1>TALHA THE AI</h1>
    <p class="muted">⚡ WHATSAPP AI ASSISTANT ⚡</p>
  </div>
</div>

<div class="card">
  <h2>📡 WhatsApp Status</h2>

  <div id="status" class="status">
    Checking...
  </div>

  <p class="muted">
    Model: ${escapeHtml(GEMINI_MODEL)}
  </p>

  <p class="muted" id="phoneStatus"></p>
</div>

<div class="card">
  <h2>🔐 Admin Login</h2>

  <input
    id="token"
    type="password"
    placeholder="Enter ADMIN_TOKEN"
    autocomplete="current-password"
  >

  <button onclick="login()">
    LOGIN
  </button>

  <p id="authMsg" class="muted"></p>
</div>

<div class="card">
  <h2>📱 WhatsApp Pairing</h2>

  <input
    id="phone"
    type="tel"
    placeholder="8801XXXXXXXXX"
    inputmode="numeric"
  >

  <button onclick="startWA()">
    START / PAIR WHATSAPP
  </button>

  <button class="danger" onclick="resetWA()">
    RESET SESSION
  </button>

  <p id="waMsg" class="muted">
    আগে Admin Login করুন।
  </p>

  <div id="pairBox" class="hidden">
    <h2>Pairing Code</h2>

    <div id="pairCode" class="code"></div>

    <p class="muted">
      WhatsApp → Linked Devices → Link a Device
      → Link with phone number instead
    </p>
  </div>
</div>

<div class="card">
  <h2>💡 Bot Commands</h2>

  <p>• যেকোনো প্রশ্ন → AI উত্তর দেবে</p>

  <p>
    • <b>/image sunset over a beach</b>
    → ছবি তৈরি করবে
  </p>

  <p>
    • <b>draw a cat</b>
    → সাধারণ AI উত্তর দেবে; ছবি চাইলে /image ব্যবহার করুন
  </p>
</div>

<div class="card">
  <h2>📜 LIVE TERMINAL LOGS</h2>

  <div class="logs" id="logs">
    Admin Login করলে logs দেখা যাবে।
  </div>
</div>

<script>
let adminToken = sessionStorage.getItem('talha_token') || '';

const $ = id => document.getElementById(id);

function headers(){
  return {
    'Content-Type':'application/json',
    'x-admin-token':adminToken
  };
}

async function login(){
  adminToken=$('token').value.trim();

  try{
    const r=await fetch('/api/status',{
      headers:{'x-admin-token':adminToken}
    });

    const d=await r.json();

    if(!r.ok) throw new Error(d.error || 'Login failed');

    sessionStorage.setItem('talha_token',adminToken);

    $('authMsg').textContent='✅ Admin Login Successful';

    $('waMsg').textContent='এখন WhatsApp নম্বর দিয়ে Start করুন।';

    refreshAll();

  }catch(e){
    adminToken='';

    sessionStorage.removeItem('talha_token');

    $('authMsg').textContent='❌ '+e.message;
  }
}

async function startWA(){
  if(!adminToken){
    $('waMsg').textContent='আগে Admin Login করুন।';
    return;
  }

  const phone=$('phone').value.trim();

  $('waMsg').textContent='Connecting...';

  try{
    const r=await fetch('/api/wa/start',{
      method:'POST',
      headers:headers(),
      body:JSON.stringify({phone})
    });

    const d=await r.json();

    if(!r.ok) throw new Error(d.error || 'Start failed');

    $('waMsg').textContent='✅ '+d.message;

    refreshAll();

  }catch(e){
    $('waMsg').textContent='❌ '+e.message;
  }
}

async function resetWA(){
  if(!adminToken){
    alert('আগে Admin Login করুন');
    return;
  }

  if(!confirm('WhatsApp session reset করবেন? এতে বর্তমান linked session মুছে যাবে।')){
    return;
  }

  try{
    const r=await fetch('/api/wa/reset',{
      method:'POST',
      headers:headers(),
      body:JSON.stringify({})
    });

    const d=await r.json();

    if(!r.ok)throw new Error(d.error || 'Reset failed');

    alert(d.message);

    $('pairBox').classList.add('hidden');

    refreshAll();

  }catch(e){
    alert(e.message);
  }
}

async function refreshStatus(){
  if(!adminToken){
    $('status').textContent='🔒 Admin login required';
    return;
  }

  try{
    const r=await fetch('/api/status',{
      headers:{'x-admin-token':adminToken}
    });

    const d=await r.json();

    if(!r.ok)throw new Error(d.error);

    $('status').textContent=
      d.whatsapp==='connected'
      ? '🟢 CONNECTED'
      : (d.starting
        ? '🟡 CONNECTING / RECONNECTING'
        : '🔴 OFFLINE');

    $('phoneStatus').textContent=
      d.phone?'📱 '+d.phone:'';

    if(d.pairingCode){
      $('pairBox').classList.remove('hidden');
      $('pairCode').textContent=d.pairingCode;

    }else if(d.whatsapp==='connected'){
      $('pairBox').classList.add('hidden');
    }

  }catch(e){
    $('status').textContent='❌ '+e.message;
  }
}

async function refreshLogs(){
  if(!adminToken)return;

  try{
    const r=await fetch('/api/logs',{
      headers:{'x-admin-token':adminToken}
    });

    const d=await r.json();

    if(!r.ok)return;

    $('logs').innerHTML=d.logs.slice(-60).reverse().map(x=>
      '<div class="log">'+
      String(x).replace(/[&<>"']/g,c=>({
        '&':'&amp;',
        '<':'&lt;',
        '>':'&gt;',
        '"':'&quot;',
        "'":'&#39;'
      }[c]))+
      '</div>'
    ).join('');

  }catch(e){}
}

function refreshAll(){
  refreshStatus();
  refreshLogs();
}

if(adminToken){
  $('token').value=adminToken;
  refreshAll();
}

setInterval(refreshAll,3000);
</script>

</body>
</html>`);
});

// WHATSAPP BOT

async function startWhatsAppBot() {
  if (startInProgress || waConnected) return;

  startInProgress = true;
  waStarting = true;
  manuallyStopped = false;

  try {
    const baileys = require('@whiskeysockets/baileys');

    const makeWASocket =
      baileys.default || baileys.makeWASocket;

    const {
      useMultiFileAuthState,
      fetchLatestBaileysVersion,
      DisconnectReason
    } = baileys;

    const { Boom } = require('@hapi/boom');

    fs.mkdirSync(AUTH_DIR, { recursive: true });

    const { state, saveCreds } =
      await useMultiFileAuthState(AUTH_DIR);

    let version;

    try {
      const latest = await fetchLatestBaileysVersion();

      version = latest.version;

      log('Baileys version: ' + version.join('.'));

    } catch (error) {
      log(
        'Could not fetch latest Baileys version: ' +
        error.message +
        '. Using library default.'
      );
    }

    const socket = makeWASocket({
      ...(version ? { version } : {}),

      auth: state,

      logger: pino({ level: 'silent' }),

      printQRInTerminal: false,

      browser: ['TALHA THE AI', 'Chrome', '1.0'],

      connectTimeoutMs: 60000,

      defaultQueryTimeoutMs: 60000,

      keepAliveIntervalMs: 25000,

      markOnlineOnConnect: false,

      syncFullHistory: false
    });

    waSocket = socket;

    // Register listeners immediately after socket creation.

    socket.ev.on('creds.update', saveCreds);

    socket.ev.on('connection.update', update => {
      const {
        connection,
        lastDisconnect
      } = update;

      if (connection === 'connecting') {
        waStarting = true;

        log('WhatsApp connection: connecting');
      }

      if (connection === 'open') {
        waConnected = true;
        waStarting = false;
        pairingCode = null;
        reconnectAttempts = 0;

        log('🎉 TALHA THE AI is ONLINE on WhatsApp!');
      }

      if (connection === 'close') {
        waConnected = false;

        if (waSocket === socket) {
          waSocket = null;
        }

        const code =
          new Boom(lastDisconnect?.error)
          .output?.statusCode;

        const reasonText =
          lastDisconnect?.error?.message || 'unknown';

        log(
          `WhatsApp disconnected (code ${code || 'unknown'}): ${reasonText}`
        );

        if (manuallyStopped) {
          waStarting = false;
          return;
        }

        if (code === DisconnectReason.loggedOut) {
          waStarting = false;
          pairingCode = null;

          log(
            'WhatsApp logged out. Admin must reset session and pair again.'
          );

          return;
        }

        // 515 may occur during pairing-code linking restart.
        // Keep saved credentials and reconnect.

        reconnectAttempts++;

        const wait =
          code === 515
          ? 3000
          : Math.min(3000 * reconnectAttempts, 30000);

        waStarting = true;

        log(
          `Reconnecting in ${Math.ceil(wait / 1000)}s (attempt ${reconnectAttempts})...`
        );

        if (reconnectTimer) {
          clearTimeout(reconnectTimer);
        }

        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;

          startWhatsAppBot().catch(err =>
            log('Reconnect start error: ' + err.message)
          );

        }, wait);
      }
    });

    // INCOMING MESSAGES

    socket.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return;

      for (const msg of messages || []) {
        if (!msg.message || msg.key.fromMe) continue;

        const jid = msg.key.remoteJid;

        if (
          !jid ||
          jid === 'status@broadcast' ||
          jid.endsWith('@newsletter')
        ) {
          continue;
        }

        const messageText =
          msg.message.conversation ||
          msg.message.extendedTextMessage?.text ||
          msg.message.imageMessage?.caption ||
          msg.message.videoMessage?.caption ||
          '';

        if (!messageText.trim()) continue;

        log(
          'Incoming WhatsApp message: ' +
          messageText.slice(0, 80)
        );

        let typingTimer;

        async function stopTyping() {
          if (typingTimer) {
            clearInterval(typingTimer);
          }

          try {
            await socket.sendPresenceUpdate('paused', jid);
          } catch (_) {}
        }

        try {
          try {
            await socket.readMessages([msg.key]);
          } catch (_) {}

          try {
            await socket.sendPresenceUpdate('composing', jid);

            typingTimer = setInterval(() => {
              socket.sendPresenceUpdate(
                'composing',
                jid
              ).catch(() => {});
            }, 8000);

          } catch (_) {}

          const imagePrompt = getImagePrompt(messageText);

          if (imagePrompt) {
            log('Image generation started');

            const imageBuffer =
              await generateImage(imagePrompt);

            await stopTyping();

            await socket.sendMessage(jid, {
              image: imageBuffer,
              caption: '🎨 Created by TALHA THE AI'
            });

            log('Image sent successfully');

          } else {
            const reply = await askAI(messageText);

            await stopTyping();

            await socket.sendMessage(jid, {
              text: reply
            });

            log('AI reply sent');
          }

        } catch (error) {
          await stopTyping();

          log(
            'Message handler error: ' +
            error.message
          );

          try {
            await socket.sendMessage(jid, {
              text: 'দুঃখিত, সার্ভারে সাময়িক সমস্যা হচ্ছে। একটু পরে আবার চেষ্টা করুন।'
            });
          } catch (_) {}
        }
      }
    });

    // PAIRING CODE

    if (!state.creds.registered && waPhoneNumber) {
      try {
        await new Promise(resolve =>
          setTimeout(resolve, 1500)
        );

        if (
          waSocket === socket &&
          !state.creds.registered &&
          !pairingCode
        ) {
          const code =
            await socket.requestPairingCode(waPhoneNumber);

          pairingCode =
            String(code).match(/.{1,4}/g)?.join('-') ||
            String(code);

          log(
            'Pairing code generated. Open WhatsApp Linked Devices and enter the code.'
          );
        }

      } catch (error) {
        log(
          'Pairing code request error: ' +
          error.message
        );
      }

    } else if (state.creds.registered) {
      log(
        'Saved WhatsApp credentials found; attempting session reconnect.'
      );
    }

  } finally {
    startInProgress = false;
  }
}

// SERVER START

const server = app.listen(PORT, '0.0.0.0', () => {
  log(
    '🚀 TALHA THE AI server running on port ' + PORT
  );

  log('Gemini Model: ' + GEMINI_MODEL);

  log('Auth directory: ' + AUTH_DIR);

  if (!ADMIN_TOKEN) {
    log('WARNING: ADMIN_TOKEN missing');
  }

  if (!GEMINI_API_KEY) {
    log('WARNING: GEMINI_API_KEY missing');
  }

  try {
    if (
      fs.existsSync(AUTH_DIR) &&
      fs.readdirSync(AUTH_DIR).length > 0
    ) {
      log('Existing WhatsApp session found; resuming...');

      startWhatsAppBot().catch(error =>
        log('Auto resume error: ' + error.message)
      );
    }

  } catch (error) {
    log('Auth directory error: ' + error.message);
  }
});

// GRACEFUL SHUTDOWN

function shutdown() {
  log('Server shutting down...');

  manuallyStopped = true;

  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
  }

  if (waSocket) {
    try {
      waSocket.end(
        new Error('Server shutting down')
      );
    } catch (_) {}
  }

  server.close(() => process.exit(0));

  setTimeout(() => process.exit(0), 10000).unref();
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
