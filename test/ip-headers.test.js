// اختبار معالجة IP headers والترويسات المزورة
const { test } = require('node:test');
const assert = require('node:assert/strict');

// محاكاة middleware IP
function createIpMiddleware(trustProxyHops = 0) {
  return (req, res, next) => {
    const cfConnectingIp = req.get('CF-Connecting-IP');
    const trueClientIp = req.get('True-Client-IP');
    if (cfConnectingIp || trueClientIp) {
      req.realIp = cfConnectingIp || trueClientIp;
    } else {
      const xff = req.get('X-Forwarded-For');
      if (xff && trustProxyHops === 0) {
        req.realIp = req.socket.remoteAddress;
      } else {
        req.realIp = req.ip;
      }
    }
    next();
  };
}

// محاكاة req
function createReq(headers = {}, remoteAddress = '127.0.0.1', ip = '127.0.0.1') {
  return {
    get: (name) => headers[name],
    socket: { remoteAddress },
    ip,
  };
}

test('IP headers: CF-Connecting-IP overrides X-Forwarded-For', () => {
  const middleware = createIpMiddleware(1);
  const req = createReq({
    'CF-Connecting-IP': '1.2.3.4',
    'X-Forwarded-For': '5.6.7.8, 9.10.11.12',
  }, '10.0.0.1', '10.0.0.1');

  middleware(req, {}, () => {});
  assert.equal(req.realIp, '1.2.3.4');
});

test('IP headers: True-Client-IP overrides X-Forwarded-For', () => {
  const middleware = createIpMiddleware(1);
  const req = createReq({
    'True-Client-IP': '1.2.3.4',
    'X-Forwarded-For': '5.6.7.8, 9.10.11.12',
  }, '10.0.0.1', '10.0.0.1');

  middleware(req, {}, () => {});
  assert.equal(req.realIp, '1.2.3.4');
});

test('IP headers: X-Forwarded-For ignored when trust proxy = 0', () => {
  const middleware = createIpMiddleware(0);
  const req = createReq({
    'X-Forwarded-For': '5.6.7.8, 9.10.11.12',
  }, '10.0.0.1', '10.0.0.1');

  middleware(req, {}, () => {});
  assert.equal(req.realIp, '10.0.0.1');
});

test('IP headers: X-Forwarded-For accepted when trust proxy > 0', () => {
  const middleware = createIpMiddleware(1);
  const req = createReq({
    'X-Forwarded-For': '5.6.7.8, 9.10.11.12',
  }, '10.0.0.1', '9.10.11.12');

  middleware(req, {}, () => {});
  assert.equal(req.realIp, '9.10.11.12');
});

test('IP headers: no headers uses req.ip', () => {
  const middleware = createIpMiddleware(0);
  const req = createReq({}, '10.0.0.1', '10.0.0.1');

  middleware(req, {}, () => {});
  assert.equal(req.realIp, '10.0.0.1');
});
