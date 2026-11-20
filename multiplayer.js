'use strict';

const crypto = require('node:crypto');
const { raceRulesFromEnv, raceCap: raceCapRule, raceDeadline, forfeitAllowed, decideWinner } = require('./race-rules');
const { clientIpDetailsFromRequest } = require('./ws-client-ip');
// Multiplayer is optional; the rest of the app remains available without ws.
let WebSocketServer = null;
try { ({ WebSocketServer } = require('ws')); } catch (_) { console.warn('⚠️  مكتبة ws غير مثبّتة — السباقات المباشرة معطّلة (شغّل: npm install)'); }

function createMultiplayer({ store, authenticate, currentWeekKey, trustProxyHops }) {
  const RACE_RULES = raceRulesFromEnv();
  const raceRooms = new Map();
  let raceQueue = [];
  const sendWs = (ws, obj) => { try { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj)); } catch (_) {} };
  // سقف نتيجة لاعب لحظة الإبلاغ: لا يتجاوز ما يسمح به زمن السباق ولا يقفز فوق آخر تقدّم أبلغه هو
  const raceCap = (room, playerId, rawScore, now) => raceCapRule(RACE_RULES, { startAt: room.startAt || now, last: room.track.get(playerId) || null }, rawScore, now);
  function beginRaceRound(room, players) {
    room.state = 'racing';
    room.seed = Math.floor(Math.random() * 2 ** 31);
    room.startAt = Date.now() + 2500;
    room.startedAt = Date.now();
    room.results = new Map();
    room.track = new Map();
    clearTimeout(room.timer);
    // الخادم ينهي السباق بنفسه إن لم يصل إنهاء طرف قبل المهلة: آخر تقدّم مُبلَّغ هو نتيجته
    room.timer = setTimeout(() => {
      settleRace(room, 'timeout').then((outcome) => announceRace(room, outcome)).catch((e) => console.error('تعذّر ختم سباق منتهي الوقت:', e.message));
    }, raceDeadline(RACE_RULES, room.startAt) - Date.now());
    room.timer.unref?.();
    for (const p of players) {
      p.player.ready = false;
      const opp = players.find((q) => q !== p);
      sendWs(p, { type: 'start', seed: room.seed, startAt: room.startAt, duration: RACE_RULES.durationSec, opponent: { id: opp.player.id, name: opp.player.name } });
    }
  }
  // إعلان نتيجة مختومة لطرفي غرفة ما زالت قائمة (قد تُحذف الغرفة أثناء التخزين بانقطاع/انتقال)
  function announceRace(room, outcome) {
    if (!outcome || raceRooms.get(room.id) !== room || room.players.size !== 2) return;
    room.state = 'finished';
    for (const p of room.players) sendWs(p, { type: 'result', reason: outcome.reason, winnerId: outcome.winnerId, results: outcome.results });
  }
  // ختم السباق: اكتمال النتيجتين، أو انتهاء المهلة (آخر تقدّم لمن لم يُنهِ)، أو انسحاب (الباقي يفوز مهما كانت النقاط)
  async function settleRace(room, reason, { forfeitBy = null, players = null } = {}) {
    if (room.state !== 'racing') return null;
    clearTimeout(room.timer); room.timer = null;
    const now = Date.now();
    const list = players || [...room.players];
    for (const p of list) {
      if (room.results.has(p.player.id)) continue;
      const last = room.track.get(p.player.id);
      room.results.set(p.player.id, { id: p.player.id, name: p.player.name, score: last ? last.score : 0, timedOut: reason === 'timeout', flagged: false });
    }
    const results = [...room.results.values()].map((r) => ({ ...r, forfeited: r.id === forfeitBy })).sort((a, b) => b.score - a.score);
    if (results.length < 2) { room.state = 'finished'; return null; }
    const winnerId = decideWinner(results, forfeitBy);
    room.state = 'settling';
    room.outcome = { reason, winnerId, results };
    // 🏆 تسجيل البطولة الأسبوعية قبل إعلان النتيجة — السطران في معاملة واحدة (فشل التخزين لا يعطّل السباق)
    try {
      await store.recordRaceResults(currentWeekKey(), results.map((r) => ({ ...r, won: winnerId === r.id })));
    } catch (e) { console.error('تعذّر تسجيل نتيجة سباق:', e.message); }
    return room.outcome;
  }
  const raceCode = () => {
    const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
    return raceRooms.has(code) ? raceCode() : code;
  };

  // حدود اتصالات السباق: سقف للاتصالات غير الموثّقة لكل عنوان، ومهلة مصادقة قصيرة،
  // ونافذة معدّل للرسائل. السقف يخصّ ما قبل المصادقة فقط: شبكات الهاتف تُخفي آلاف
  // المستخدمين خلف عنوان واحد، فسقف صارم على الاتصالات الموثّقة يقطع لاعبين أبرياء.
  // المصادقة تأتي في أول رسالة لا في رابط الاتصال: initData توقيع صالح 24 ساعة، ووضعه
  // في URL يعرّضه لسجلات الوكيل/الخادم وأي أداة تسجيل. الرابط الآن بلا أي سر.
  const WS_MAX_PENDING_PER_IP = Number(process.env.WS_MAX_PENDING_PER_IP || 24);
  const WS_AUTH_TIMEOUT_MS = Number(process.env.WS_AUTH_TIMEOUT_MS || 8000);
  const WS_MSG_WINDOW_MS = 2000;
  const WS_MSG_MAX_PER_WINDOW = 80;
  const wsPendingByIp = new Map();
  let wsRejectLogAt = 0;

  function releasePendingSocket(ip) {
    const left = (wsPendingByIp.get(ip) || 1) - 1;
    if (left > 0) wsPendingByIp.set(ip, left); else wsPendingByIp.delete(ip);
  }

  function wsClientIp(req) {
    // العنوان يُقرأ من يمين السلسلة بعدد القفزات الموثوقة — لا من أول عنصر (انظر ws-client-ip.js).
    return clientIpDetailsFromRequest(req, trustProxyHops);
  }

  // معرّف مؤقت للدلو يتيح مقارنة الاتصالات في السجل **بلا كتابة عنوان أي لاعب**:
  // HMAC بمفتاح عشوائي لكل عملية ⇒ لا يمكن عكس المعرّف إلى عنوان، ويتغيّر مع كل تشغيل.
  const WS_REJECT_ID_KEY = crypto.randomBytes(16);
  const wsRejectionId = (ip) => crypto.createHmac('sha256', WS_REJECT_ID_KEY).update(String(ip)).digest('hex').slice(0, 8);

  function setupMultiplayer(httpServer) {
    if (!WebSocketServer) return; // السباقات معطّلة فقط — بقية اللعبة تعمل
    const wss = new WebSocketServer({ server: httpServer, path: '/ws', maxPayload: 4096 });

    wss.on('connection', (ws, req) => {
      const clientInfo = wsClientIp(req);
      const ip = clientInfo.ip;
      const pending = wsPendingByIp.get(ip) || 0;
      if (pending >= WS_MAX_PENDING_PER_IP) {
        // سجل تشخيصي عند الرفض فقط، **بلا أي عنوان IP**: يكفي لمعرفة إن كان عدد القفزات
        // مضبوطًا (دلو مشترك لعنوان وسيط) أو مفتوحًا، عبر عدد عناصر الترويسة ومصدر القيمة.
        // معرّف مؤقت (HMAC) يتيح مقارنة الاتصالات المرفوضة دون كشف عناوين اللاعبين.
        // سطر واحد كل 10 ثوانٍ كحد أقصى: الرفض نفسه قد يتكرر آلاف المرات أثناء هجوم.
        try {
          if (Date.now() - wsRejectLogAt > 10000) {
            wsRejectLogAt = Date.now();
            const source = clientInfo.source === 'forwarded'
              ? 'ترويسة الوكيل'
              : `عنوان المقبس (${clientInfo.reason})`;
            console.warn(`⚠️ رفض اتصال WebSocket — السقف ${WS_MAX_PENDING_PER_IP}، عناصر X-Forwarded-For: ${clientInfo.chainLength}، القفزات الموثوقة: ${clientInfo.hops}، المصدر: ${source}، معرّف مؤقت: ${wsRejectionId(ip)}`);
          }
        } catch (_) {}
        try { ws.close(4003, 'too many connections'); } catch (_) {}
        return;
      }
      wsPendingByIp.set(ip, pending + 1);
      let pendingReleased = false;
      const releasePending = () => {
        if (pendingReleased) return;
        pendingReleased = true;
        releasePendingSocket(ip);
      };
      ws.once('close', releasePending);

      const authTimer = setTimeout(() => {
        if (!ws.player && ws.readyState === ws.OPEN) { try { ws.close(4001, 'auth required'); } catch (_) {} }
      }, WS_AUTH_TIMEOUT_MS);
      if (typeof authTimer.unref === 'function') authTimer.unref();

      // أول رسالة فقط: { type: 'auth', initData } أو { type: 'auth', guest } في وضع التطوير.
      const onHandshake = (raw) => {
        let msg = null;
        try { msg = JSON.parse(raw.toString()); } catch (_) { msg = null; }
        if (!msg || typeof msg !== 'object' || msg.type !== 'auth') { try { ws.close(4001, 'auth required'); } catch (_) {} return; }
        const auth = authenticate(typeof msg.initData === 'string' ? msg.initData : '', typeof msg.guest === 'string' ? msg.guest : '');
        if (!auth.player) { clearTimeout(authTimer); try { ws.close(4001, 'auth required'); } catch (_) {} return; }
        clearTimeout(authTimer);
        releasePending();
        ws.off('message', onHandshake);
        startRaceSession(ws, auth.player);
      };
      ws.on('message', onHandshake);
    });

    async function startRaceSession(ws, player) {
      try { const dbUser = await store.getUser(player.id); if (dbUser?.name && dbUser.name !== 'ضيف') player.name = dbUser.name; } catch (_) {}

      if (ws.readyState !== ws.OPEN) return;
      ws.player = { ...player, roomId: null, ready: false, lastProgress: 0 };
      ws.msgWindow = { start: Date.now(), count: 0 };
      sendWs(ws, { type: 'welcome', id: player.id, name: player.name });

      const leaveRoom = (notify = true) => {
        raceQueue = raceQueue.filter((q) => q !== ws);
        const room = ws.player.roomId && raceRooms.get(ws.player.roomId);
        ws.player.roomId = null;
        ws.player.ready = false;
        if (!room) return;
        // أغلق الغرفة بالكامل عند مغادرة أحد اللاعبين؛ لا تترك خصماً عالقاً في غرفة سباق منتهية.
        raceRooms.delete(room.id);
        clearTimeout(room.timer); room.timer = null;
        const racingState = ['racing', 'settling'].includes(room.state);
        // انسحاب بعد بداية السباق فعلياً = خسارة للمنسحب وفوز مسجّل للباقي (يُعلَن فوراً ويُحفظ خلفياً)
        const forfeit = room.state === 'racing' && room.players.size === 2 && forfeitAllowed(RACE_RULES, room.startAt || Infinity, Date.now());
        const others = [...room.players].filter((o) => o !== ws);
        let outcome = null;
        if (forfeit) {
          const snapshot = [...room.players];
          const settled = settleRace(room, 'forfeit', { forfeitBy: ws.player.id, players: snapshot });
          settled.catch(() => {});
          outcome = room.outcome;
        }
        for (const other of others) {
          other.player.roomId = null;
          other.player.ready = false;
          if (notify) sendWs(other, {
            type: racingState ? 'opponent_left' : 'room_closed',
            message: racingState ? (outcome ? 'انسحب الخصم — سُجّل الفوز لك' : 'غادر الخصم — يمكنك بدء سباق جديد') : 'أُغلقت الغرفة — أنشئ غرفة جديدة',
            ...(outcome ? { forfeit: true, winnerId: outcome.winnerId, results: outcome.results } : {}),
          });
        }
        room.players.clear();
      };
      ws.leaveRaceRoom = leaveRoom;

      const pairInto = (room, other) => {
        room.players.add(ws); room.players.add(other);
        ws.player.roomId = room.id; other.player.roomId = room.id;
        sendWs(ws, { type: 'matched', code: room.code, opponent: { id: other.player.id, name: other.player.name } });
        sendWs(other, { type: 'matched', code: room.code, opponent: { id: ws.player.id, name: ws.player.name } });
      };

      ws.on('message', async (raw) => {
        if (raw.length > 4096) return;
        // نافذة معدّل بسيطة لكل اتصال: رسائل السباق قليلة أصلاً، وما يتجاوزها سلوك آلي.
        const nowMs = Date.now();
        if (nowMs - ws.msgWindow.start > WS_MSG_WINDOW_MS) ws.msgWindow = { start: nowMs, count: 0 };
        ws.msgWindow.count += 1;
        if (ws.msgWindow.count > WS_MSG_MAX_PER_WINDOW) { try { ws.close(4008, 'too many messages'); } catch (_) {} return; }
        let msg;
        try { msg = JSON.parse(raw.toString()); } catch { return; }
        if (!msg || typeof msg !== 'object' || Array.isArray(msg) || typeof msg.type !== 'string') return;

        try {
          if (msg.type === 'quick') {
            leaveRoom(true);
            raceQueue = raceQueue.filter((q) => q.readyState === q.OPEN && q !== ws);
            const otherIndex = raceQueue.findIndex((q) => q.player.id !== ws.player.id);
            const other = otherIndex >= 0 ? raceQueue.splice(otherIndex, 1)[0] : null;
            if (other) {
              const room = { id: raceCode(), code: 'سريع', players: new Set(), state: 'lobby', results: new Map(), rematchRequests: new Set() };
              raceRooms.set(room.id, room);
              pairInto(room, other);
            }
            else { raceQueue.push(ws); sendWs(ws, { type: 'waiting', message: 'بانتظار خصم…' }); }
          }

          if (msg.type === 'create') {
            leaveRoom(true);
            const code = raceCode();
            const room = { id: code, code, players: new Set([ws]), state: 'lobby', results: new Map(), rematchRequests: new Set() };
            raceRooms.set(code, room);
            ws.player.roomId = code;
            sendWs(ws, { type: 'room_created', code, message: `شارك الرمز ${code} مع صديقك` });
          }

          if (msg.type === 'join') {
            const room = raceRooms.get(String(msg.code || '').toUpperCase().trim());
            if (!room || room.state !== 'lobby' || room.players.size >= 2) { sendWs(ws, { type: 'error', message: 'الغرفة غير موجودة أو ممتلئة' }); return; }
            const [host] = [...room.players];
            if (host === ws) return;
            if (host.player.id === ws.player.id) {
              sendWs(ws, { type: 'error', message: 'لا يمكنك التسابق مع حسابك نفسه' });
              return;
            }
            // Validate the destination first, then detach from any previous room.
            leaveRoom(true);
            pairInto(room, host);
          }

          if (msg.type === 'ready') {
            const room = ws.player.roomId && raceRooms.get(ws.player.roomId);
            if (!room || room.state !== 'lobby' || room.players.size !== 2 || !room.players.has(ws)) return;
            ws.player.ready = true;
            const players = [...room.players];
            if (players.every((p) => p.player.ready)) beginRaceRound(room, players);
          }

          if (msg.type === 'progress') {
            if (![msg.score, msg.lives, msg.xRatio].every(Number.isFinite)) return;
            const now = Date.now();
            if (now - ws.player.lastProgress < 100) return;
            ws.player.lastProgress = now;
            const room = ws.player.roomId && raceRooms.get(ws.player.roomId);
            if (!room || room.state !== 'racing' || !room.players.has(ws)) return;
            // التقدّم يُقصّ بنفس سقوف النتيجة ويُحفظ كآخر نقاط معروفة (نتيجة اللاعب إن انتهى الوقت أو انسحب)
            const tracked = now >= (room.startAt || 0) && !room.results.has(ws.player.id) ? raceCap(room, ws.player.id, msg.score, now) : null;
            if (tracked) room.track.set(ws.player.id, { score: tracked.score, at: now });
            const payload = {
              type: 'opponent_progress',
              score: tracked ? tracked.score : Math.max(0, Math.min(RACE_RULES.scoreBase, Number(msg.score) || 0)),
              lives: Math.max(0, Math.min(5, Number(msg.lives) || 0)),
              xRatio: Math.max(0, Math.min(1, Number(msg.xRatio) || 0.5)),
              finished: Boolean(msg.finished),
            };
            for (const other of room.players) if (other !== ws) sendWs(other, payload);
          }

          if (msg.type === 'finish') {
            if (!Number.isFinite(msg.score) || msg.score < 0) return;
            const room = ws.player.roomId && raceRooms.get(ws.player.roomId);
            if (!room || room.state !== 'racing' || !room.players.has(ws)) return;
            // لا نقبل إنهاء قبل وقت البداية، ولا نسمح بتغيير نتيجة اللاعب بعد ختمها.
            const nowFinish = Date.now();
            if (nowFinish < (room.startAt || 0) || room.results.has(ws.player.id)) return;
            // سقفان: زمن السباق (45/ث + 100 حتى مدته) وآخر تقدّم مُبلَّغ (+ قفزة واحدة)
            const { score, flagged } = raceCap(room, ws.player.id, msg.score, nowFinish);
            room.results.set(ws.player.id, { id: ws.player.id, name: ws.player.name, score, flagged, timedOut: false });
            room.track.set(ws.player.id, { score, at: nowFinish });
            for (const other of room.players) if (other !== ws) sendWs(other, { type: 'opponent_finished', score });
            if (room.results.size >= 2) {
              // Keep rematch/ready blocked until asynchronous persistence completes.
              const outcome = await settleRace(room, 'finished');
              announceRace(room, outcome); // A disconnect/switch can delete this room while storage is in flight.
            }
          }

          if (msg.type === 'rematch') {
            const room = ws.player.roomId && raceRooms.get(ws.player.roomId);
            if (!room || room.state !== 'finished' || room.players.size !== 2) return;
            room.rematchRequests = room.rematchRequests || new Set();
            room.rematchRequests.add(ws.player.id);
            const players = [...room.players];
            for (const other of players) if (other !== ws) sendWs(other, { type: 'rematch_requested' });
            if (room.rematchRequests.size >= 2) {
              room.rematchRequests.clear();
              beginRaceRound(room, players);
            }
          }

          if (msg.type === 'leave') leaveRoom(true);
        } catch (error) {
          // Avoid unhandled rejections and never log player messages or auth data.
          console.error('خطأ معالجة رسالة سباق:', error.code || 'internal');
          sendWs(ws, { type: 'error', message: 'تعذّر تنفيذ طلب السباق — حاول مجددًا' });
        }
      });

      ws.on('close', leaveRoom);
      ws.on('error', () => leaveRoom());
    }

    const heartbeat = setInterval(() => {
      for (const ws of wss.clients) {
        if (ws.isAlive === false) { ws.terminate(); continue; }
        ws.isAlive = false;
        try { ws.ping(); } catch (_) {}
      }
    }, 30000);
    wss.on('connection', (ws) => { ws.isAlive = true; ws.on('pong', () => { ws.isAlive = true; }); });
    wss.on('close', () => clearInterval(heartbeat));
    console.log('⚔️  خادم سباقات WebSocket جاهز على /ws');
  }

  // ---------------------------------------------------------------------------
  // بوت تيليجرام
  return setupMultiplayer;
}

module.exports = { createMultiplayer };
