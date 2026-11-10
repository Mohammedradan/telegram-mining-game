// اختبارات وحدة لاستخراج عنوان العميل من سلسلة X-Forwarded-For — أهم ما فيها مقاومة التزوير.
const { test } = require('node:test');
const assert = require('node:assert');
const { clientIpFrom, clientIpDetails, normalizeAddress, MAX_HOPS } = require('../ws-client-ip');

const ip = (headerValue, trustProxyHops, remoteAddress = '10.0.0.9') =>
  clientIpFrom({ headerValue, remoteAddress, trustProxyHops });

test('hops=0: الترويسة لا تُصدَّق إطلاقًا، وعنوان المقبس هو العنوان', () => {
  assert.equal(ip('6.6.6.6', 0), '10.0.0.9');
  assert.equal(ip('6.6.6.6, 7.7.7.7', 0), '10.0.0.9');
  // حتى لو حاول العميل تقديم عنوانه بنفسه
  assert.equal(ip('203.0.113.7', 0), '10.0.0.9');
});

test('hops=1: آخر عنصر في السلسلة (ما أضافه الوكيل) لا أولها', () => {
  // العميل أرسل "6.6.6.6" والوكيل ألحق عنوان الاتصال الحقيقي
  assert.equal(ip('6.6.6.6, 203.0.113.7', 1), '203.0.113.7');
  // ترويسة من عنصر واحد يضعها الوكيل بنفسه
  assert.equal(ip('203.0.113.7', 1), '203.0.113.7');
});

test('hops=2: العنصر قبل الأخير (خلف وكيلين موثوقين)', () => {
  assert.equal(ip('6.6.6.6, 203.0.113.7, 172.16.0.4', 2), '203.0.113.7');
  assert.equal(ip('203.0.113.7, 172.16.0.4', 2), '203.0.113.7');
});

test('تزوير الأول لا يغيّر العنوان المستخرج: بادئات مختلفة بنفس النهاية تعطي نفس العنوان', () => {
  const first = ip('1.1.1.1, 198.51.100.5', 1);
  const second = ip('2.2.2.2, 198.51.100.5', 1);
  const third = ip('"3.3.3.3", 198.51.100.5', 1);
  assert.equal(first, '198.51.100.5');
  assert.equal(second, first, 'تغيير البادئة المزوَّرة لا يمنح دلوًا جديدًا');
  assert.equal(third, first);
});

test('سلسلة أقصر من القفزات الموثوقة = ترويسة غير متسقة ⇒ عنوان المقبس', () => {
  assert.equal(ip('203.0.113.7', 2), '10.0.0.9');
  assert.equal(ip('', 2), '10.0.0.9');
  assert.equal(ip(undefined, 3), '10.0.0.9');
});

test('قيمة غير صالحة في الموضع المختار ⇒ عنوان المقبس (لا اختيار "أقرب صالح" من اليمين)', () => {
  assert.equal(ip('6.6.6.6, ليس-عنوانًا', 1), '10.0.0.9');
  assert.equal(ip('6.6.6.6, 300.300.300.300', 1), '10.0.0.9');
  // القيمة الصالحة موجودة لكنها في موضع يتحكم به العميل: لا تُستخدم
  assert.equal(ip('6.6.6.6, غير-صالحة, 172.16.0.4', 2), '10.0.0.9');
});

test('تطبيع المنافذ والأقواس وعناوين IPv6', () => {
  assert.equal(normalizeAddress('203.0.113.7:443'), '203.0.113.7');
  assert.equal(normalizeAddress('[2001:db8::1]'), '2001:db8::1');
  assert.equal(normalizeAddress('[2001:db8::1]:8443'), '2001:db8::1');
  assert.equal(normalizeAddress('::ffff:10.0.0.9'), '::ffff:10.0.0.9');
  assert.equal(normalizeAddress('  203.0.113.7  '), '203.0.113.7');
  assert.equal(normalizeAddress(''), '');
  assert.equal(normalizeAddress('غير-عنوان'), '');
  assert.equal(ip('[2001:db8::1]:8443, 203.0.113.7', 1), '203.0.113.7');
  assert.equal(ip('6.6.6.6, [2001:db8::2]', 1), '2001:db8::2');
});

test('ترويسة مصفوفة (كما قد يمرّرها الوسيط) تُعامل كسلسلة واحدة', () => {
  assert.equal(ip(['6.6.6.6', '203.0.113.7'], 1), '203.0.113.7');
  assert.equal(ip(['6.6.6.6, 203.0.113.7'], 1), '203.0.113.7');
});

test('حدود عدد القفزات: سالب = صفر، وأكبر من السقف يُقصّ إليه', () => {
  assert.equal(ip('6.6.6.6, 203.0.113.7', -1), '10.0.0.9');
  const entries = Array.from({ length: MAX_HOPS + 2 }, (_, i) => `10.1.0.${i + 1}`);
  assert.equal(ip(entries.join(', '), 50), entries[entries.length - MAX_HOPS], 'عدد القفزات يُقصّ إلى السقف');
});

test('غياب عنوان المقبس والترويسة يعطي unknown بدل قيمة فارغة', () => {
  assert.equal(clientIpFrom({}), 'unknown');
  assert.equal(clientIpFrom({ headerValue: '', trustProxyHops: 0 }), 'unknown');
  assert.equal(clientIpFrom({ headerValue: '6.6.6.6', trustProxyHops: 2 }), 'unknown', 'سلسلة أقصر من القفزات');
});

// الوصف التشخيصي: يكفي لتشخيص ضبط الوكيل، ويُستخدم في السجل بدل كتابة العنوان.
test('الوصف التشخيصي يبيّن مصدر القيمة وسبب اختيار المقبس بلا كشف العنوان', () => {
  const details = (headerValue, trustProxyHops, remoteAddress = '10.0.0.9') =>
    clientIpDetails({ headerValue, remoteAddress, trustProxyHops });

  const forwarded = details('6.6.6.6, 203.0.113.7', 1);
  assert.deepEqual(forwarded, { hops: 1, chainLength: 2, ip: '203.0.113.7', source: 'forwarded', socketFallback: false, reason: 'forwarded' });

  const disabled = details('6.6.6.6, 203.0.113.7', 0);
  assert.equal(disabled.source, 'socket');
  assert.equal(disabled.reason, 'hops-disabled');
  assert.equal(disabled.socketFallback, false, 'تعطيل الترويسة ليس بديلاً اضطرارياً');
  assert.equal(disabled.chainLength, 2);

  const short = details('203.0.113.7', 2);
  assert.equal(short.ip, '10.0.0.9');
  assert.equal(short.reason, 'chain-shorter-than-hops');
  assert.equal(short.socketFallback, true, 'الرجوع إلى المقبس هنا بديل اضطرارى');

  const invalid = details('6.6.6.6, ليس-عنوانًا', 1);
  assert.equal(invalid.reason, 'entry-not-an-ip');
  assert.equal(invalid.ip, '10.0.0.9');

  // الوصف لا يُخرج أي معلومة إضافية قابلة للتسريب
  assert.deepEqual(Object.keys(forwarded).sort(), ['chainLength', 'hops', 'ip', 'reason', 'socketFallback', 'source']);
});
