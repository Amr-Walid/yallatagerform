/**
 * ==========================================================================
 * Yalla Tager - Security Monitor (مراقب الأمان والاستعلامات)
 * ==========================================================================
 * الغرض:
 *   يراقب كل من يستخدم مسار الاستعلام العام (`/api/lookup`) وبقية المسارات
 *   الحساسة، ويسجّل من عمل كم استعلام ومن أي IP وبأي نتيجة، ثم يحلّل هذا
 *   السجل تلقائياً ليكتشف النشاط الخطر ويعرضه على لوحة الأدمن.
 *
 * لماذا؟
 *   مسار الاستعلام عام بدون تسجيل دخول، وأي شخص يمكنه تجريب أرقام هواتف
 *   بالتسلسل لبناء قائمة بتجار يلا تاجر (Enumeration)، أو إغراق السيرفر
 *   بالطلبات حتى يتوقف (DoS)، أو محاولة حقن SQL للوصول لقاعدة البيانات.
 *   محدد المعدل (rateLimit) يوقف الطلب الواحد، لكنه لا يخبر أحداً بما يحدث.
 *   هذه الطبقة هي "الكاميرا": تجمع، تحلّل، وتنبّه.
 *
 * ما يكتشفه:
 *   1. enumeration      : أرقام كثيرة مختلفة من نفس الـ IP  → تجميع بيانات
 *   2. lookup_volume    : عدد استعلامات مرتفع من IP واحد
 *   3. rate_limited     : ضرب حد المعدل بشكل متكرر (إصرار على الاختراق)
 *   4. brute_force      : محاولات دخول فاشلة على لوحة الأدمن
 *   5. injection        : أنماط SQL Injection / XSS / Path Traversal
 *   6. invalid_probing  : أرقام غير صحيحة بكثرة (فحص عشوائي)
 *   7. traffic_spike    : ارتفاع مفاجئ في إجمالي الطلبات (احتمال DoS)
 *   8. memory_pressure  : استهلاك ذاكرة مرتفع → خطر توقف السيرفر
 *   9. event_loop_lag   : تباطؤ حلقة الأحداث → السيرفر يكاد يتوقف
 *  10. database_down    : قاعدة البيانات غير جاهزة → خطر على الداتا
 *
 * الخصوصية:
 *   أرقام الهواتف تُخزَّن **مقنّعة** (0106****726) فلا يتحول سجل الأمان
 *   نفسه إلى تسريب لقائمة أرقام العملاء.
 *
 * ملاحظة للنشر (Multi-instance):
 *   العدّادات في ذاكرة العملية. عند التشغيل بعدة نسخ، كل نسخة ترى مرورها
 *   فقط؛ للحصول على صورة موحّدة استخدم مخزناً مشتركاً (Redis) أو اجمع
 *   السجلات على مستوى الـ Nginx / API Gateway.
 * ==========================================================================
 */

const fs = require('fs');
const path = require('path');

const LOG_FILE = path.join(__dirname, '..', 'security_log.json');

/* -------------------------------------------------------------------------- */
/* Configuration                                                              */
/* -------------------------------------------------------------------------- */

const num = (value, fallback) => {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const CONFIG = {
  /** حجم النافذة التي تُقاس عليها التهديدات (افتراضي 15 دقيقة) */
  windowMs: num(process.env.SEC_WINDOW_MS, 15 * 60 * 1000),
  /** أقصى عدد أحداث محفوظة في الذاكرة */
  maxEvents: num(process.env.SEC_MAX_EVENTS, 1500),
  /** أقصى عدد IPs متتبَّعة (حماية الذاكرة من هجوم موزّع) */
  maxActors: num(process.env.SEC_MAX_ACTORS, 3000),

  // حدود التهديد
  distinctPhonesWarn: num(process.env.SEC_DISTINCT_PHONES_WARN, 15),
  distinctPhonesHigh: num(process.env.SEC_DISTINCT_PHONES_HIGH, 30),
  lookupVolumeWarn: num(process.env.SEC_LOOKUP_VOLUME_WARN, 40),
  lookupVolumeHigh: num(process.env.SEC_LOOKUP_VOLUME_HIGH, 90),
  blockedWarn: num(process.env.SEC_BLOCKED_WARN, 3),
  blockedHigh: num(process.env.SEC_BLOCKED_HIGH, 15),
  loginFailWarn: num(process.env.SEC_LOGIN_FAIL_WARN, 4),
  loginFailHigh: num(process.env.SEC_LOGIN_FAIL_HIGH, 10),
  invalidPhoneWarn: num(process.env.SEC_INVALID_PHONE_WARN, 12),
  spikeRpmWarn: num(process.env.SEC_SPIKE_RPM_WARN, 150),
  spikeRpmHigh: num(process.env.SEC_SPIKE_RPM_HIGH, 400),
  memoryWarnMb: num(process.env.SEC_MEMORY_WARN_MB, 400),
  memoryHighMb: num(process.env.SEC_MEMORY_HIGH_MB, 700),
  lagWarnMs: num(process.env.SEC_LAG_WARN_MS, 200),
  lagHighMs: num(process.env.SEC_LAG_HIGH_MS, 600)
};

/** ترتيب درجات الخطورة لحساب الحالة العامة */
const LEVEL_RANK = { safe: 0, low: 1, medium: 2, high: 3, critical: 4 };

/* -------------------------------------------------------------------------- */
/* Attack-pattern signatures                                                  */
/* -------------------------------------------------------------------------- */

/**
 * أنماط تدل على محاولة استغلال. مقصود أن تكون محدّدة (لا تصطاد نصاً عربياً
 * أو أسماء متاجر عادية) حتى لا تمتلئ اللوحة بتنبيهات كاذبة.
 */
const ATTACK_PATTERNS = [
  { key: 'sql_union', label: 'محاولة حقن SQL (UNION SELECT)', re: /\bunion\b[\s\S]{0,20}\bselect\b/i },
  { key: 'sql_tautology', label: 'محاولة حقن SQL (شرط دائماً صحيح)', re: /('|%27)\s*(or|and)\s*('?\d+'?|'[^']*')\s*=\s*('?\d+'?|'[^']*')/i },
  { key: 'sql_drop', label: 'محاولة حذف/تعديل جدول (DROP/TRUNCATE)', re: /\b(drop|truncate)\s+(table|database)\b/i },
  { key: 'sql_stacked', label: 'محاولة تنفيذ أوامر SQL متتالية', re: /;\s*(select|insert|update|delete|drop|exec)\b/i },
  { key: 'sql_sleep', label: 'محاولة تعطيل قاعدة البيانات (WAITFOR/SLEEP)', re: /\b(waitfor\s+delay|sleep\s*\(|benchmark\s*\()/i },
  { key: 'sql_comment', label: 'تعليق SQL مشبوه', re: /(--|#|\/\*)\s*(or|and|union|select)\b/i },
  { key: 'xss_script', label: 'محاولة XSS (وسم script)', re: /<\s*script\b|<\s*\/\s*script\s*>/i },
  { key: 'xss_handler', label: 'محاولة XSS (معالج حدث)', re: /\bon(error|load|click|mouseover)\s*=/i },
  { key: 'xss_proto', label: 'محاولة XSS (javascript:)', re: /javascript\s*:/i },
  { key: 'traversal', label: 'محاولة الوصول لملفات النظام (Path Traversal)', re: /(\.\.[\/\\]){2,}|\/etc\/passwd|\bwin\.ini\b/i },
  { key: 'cmd_inject', label: 'محاولة تنفيذ أوامر على السيرفر', re: /[;|`]\s*(cat|ls|whoami|curl|wget|nc|bash|sh)\s/i },
  { key: 'nosql', label: 'محاولة حقن NoSQL', re: /\$(where|ne|gt|regex)\b/i }
];

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * تقنيع رقم الهاتف قبل تخزينه في سجل الأمان.
 * 01063968726 → 0106****726
 */
function maskPhone(phone) {
  const digits = String(phone == null ? '' : phone).replace(/\D/g, '');
  if (!digits) return '—';
  if (digits.length <= 5) return digits[0] + '*'.repeat(digits.length - 1);
  return `${digits.slice(0, 4)}${'*'.repeat(Math.max(1, digits.length - 7))}${digits.slice(-3)}`;
}

/**
 * تقنيع عيّنة الهجوم قبل تخزينها.
 *
 * عيّنة الـ payload قد تحتوي رقم عميل حقيقي (مثال:
 * `01063968726' OR '1'='1`) لأن المهاجم غالباً يبني الحقن حول رقم صحيح.
 * لذلك نُقنّع أي سلسلة أرقام طويلة (7 خانات أو أكثر) داخل العيّنة نفسها،
 * مع الحفاظ على شكل الهجوم مقروءاً حتى يفهم الأدمن نوع المحاولة.
 */
function maskSample(sample) {
  const value = String(sample == null ? '' : sample);
  const redacted = value.replace(/\d{7,}/g, (run) => maskPhone(run));
  return redacted.length > 160 ? `${redacted.slice(0, 160)}…` : redacted;
}

/** اختصار الـ User-Agent لسطر واحد قابل للعرض. */
function shortUa(ua) {
  const value = String(ua || '').trim();
  if (!value) return 'غير معروف';
  return value.length > 120 ? `${value.slice(0, 120)}…` : value;
}

/** تقنيع الـ IP جزئياً في العرض العام (نحفظه كاملاً للأدمن). */
function normalizeIp(ip) {
  const value = String(ip || 'unknown');
  // ::ffff:127.0.0.1 → 127.0.0.1
  return value.replace(/^::ffff:/, '');
}

/** فحص نص واحد ضد كل بصمات الهجوم، ويرجّع أول تطابق. */
function matchAttackPattern(value) {
  if (typeof value !== 'string' || value.length < 3) return null;
  for (const pattern of ATTACK_PATTERNS) {
    if (pattern.re.test(value)) return pattern;
  }
  return null;
}

/**
 * فحص كائن (query / body / params) بشكل متداخل بحد أقصى للعمق حتى لا
 * يستهلك الفحص نفسه موارد السيرفر على جسم طلب ضخم.
 */
function scanPayload(payload, depth = 0) {
  if (depth > 3 || payload == null) return null;
  if (typeof payload === 'string') {
    const hit = matchAttackPattern(payload);
    return hit ? { pattern: hit, sample: payload.slice(0, 160) } : null;
  }
  if (typeof payload !== 'object') return null;
  for (const key of Object.keys(payload)) {
    // المفتاح نفسه قد يحمل الحمولة (مثل ?$where=...)
    const keyHit = matchAttackPattern(key);
    if (keyHit) return { pattern: keyHit, sample: key.slice(0, 160) };
    const hit = scanPayload(payload[key], depth + 1);
    if (hit) return hit;
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* State                                                                      */
/* -------------------------------------------------------------------------- */

let nextEventId = 1;

/** @type {Array<object>} أحدث الأحداث (الأقدم أولاً) */
const events = [];

/**
 * إحصائيات لكل IP.
 * @type {Map<string, {ip:string, firstSeen:number, lastSeen:number,
 *   lookups:number, invalid:number, blocked:number, loginFailed:number,
 *   loginOk:number, submits:number, suspicious:number, unauthorized:number,
 *   phones:Map<string, number>, statuses:Object, uas:Set<string>}>}
 */
const actors = new Map();

/** عدد الطلبات لكل دقيقة (للكشف عن الارتفاع المفاجئ) */
const minuteBuckets = new Map();

/** آخر وقت ضغط فيه الأدمن على "قرأتُ التنبيهات" */
let acknowledgedAt = null;
let acknowledgedBy = null;

/**
 * التنبيهات المُراجَعة: مفتاح التهديد → توقيت أحدث دليل كان موجوداً لحظة
 * المراجعة.
 *
 * لا نكتفي بتوقيت واحد عام للمراجعة، لأن ذلك يعني أن أي هجوم يبدأ بعد ضغط
 * الأدمن على الزر سيظل صامتاً حتى تنتهي النافذة الزمنية — وهي ثغرة يستطيع
 * المهاجم استغلالها بالانتظار. بهذه الخريطة يُعتبر التهديد مقروءاً فقط إذا
 * لم يظهر له دليل جديد بعد لحظة المراجعة.
 */
const acknowledgedThreats = new Map();

/** قياس تباطؤ حلقة الأحداث */
let eventLoopLagMs = 0;
const startedAt = Date.now();

/* -------------------------------------------------------------------------- */
/* Event-loop lag sampler                                                     */
/* -------------------------------------------------------------------------- */

const LAG_INTERVAL = 2000;
const lagTimer = setInterval(() => {
  const expected = Date.now() + LAG_INTERVAL;
  const t = setTimeout(() => {
    // الفرق بين الوقت المتوقع والفعلي = مقدار انشغال حلقة الأحداث
    eventLoopLagMs = Math.max(0, Date.now() - expected);
  }, LAG_INTERVAL);
  if (t.unref) t.unref();
}, LAG_INTERVAL * 2);
if (lagTimer.unref) lagTimer.unref();

/* -------------------------------------------------------------------------- */
/* Recording                                                                  */
/* -------------------------------------------------------------------------- */

function getActor(ip) {
  const key = normalizeIp(ip);
  let actor = actors.get(key);
  if (!actor) {
    // حماية الذاكرة: لو تجاوزنا الحد نحذف أقدم فاعل غير نشط
    if (actors.size >= CONFIG.maxActors) {
      let oldestKey = null;
      let oldestSeen = Infinity;
      for (const [k, v] of actors) {
        if (v.lastSeen < oldestSeen) {
          oldestSeen = v.lastSeen;
          oldestKey = k;
        }
      }
      if (oldestKey) actors.delete(oldestKey);
    }
    actor = {
      ip: key,
      firstSeen: Date.now(),
      lastSeen: Date.now(),
      lookups: 0,
      invalid: 0,
      blocked: 0,
      loginFailed: 0,
      loginOk: 0,
      submits: 0,
      suspicious: 0,
      unauthorized: 0,
      phones: new Map(),
      statuses: {},
      uas: new Set()
    };
    actors.set(key, actor);
  }
  return actor;
}

/** إضافة حدث للسجل مع الحفاظ على حجم ثابت في الذاكرة. */
function pushEvent(event) {
  events.push({ id: nextEventId++, at: Date.now(), ...event });
  if (events.length > CONFIG.maxEvents) {
    events.splice(0, events.length - CONFIG.maxEvents);
  }
  schedulePersist();
}

/** عدّاد الطلبات في الدقيقة الحالية. */
function countMinute() {
  const minute = Math.floor(Date.now() / 60000);
  minuteBuckets.set(minute, (minuteBuckets.get(minute) || 0) + 1);
  // نحتفظ بآخر 90 دقيقة فقط
  if (minuteBuckets.size > 90) {
    const cutoff = minute - 90;
    for (const key of minuteBuckets.keys()) {
      if (key < cutoff) minuteBuckets.delete(key);
    }
  }
}

/** تسجيل استعلام عن حالة تكويد. */
function recordLookup({ ip, phone, status, ua, valid = true }) {
  const actor = getActor(ip);
  actor.lastSeen = Date.now();
  if (ua) actor.uas.add(shortUa(ua));

  if (valid) {
    actor.lookups += 1;
    const masked = maskPhone(phone);
    actor.phones.set(masked, (actor.phones.get(masked) || 0) + 1);
    actor.statuses[status] = (actor.statuses[status] || 0) + 1;
  } else {
    actor.invalid += 1;
  }

  pushEvent({
    type: valid ? 'lookup' : 'lookup_invalid',
    ip: actor.ip,
    phone: maskPhone(phone),
    status: valid ? status : 'invalid_phone',
    ua: shortUa(ua)
  });
}

/** تسجيل طلب أوقفه محدد المعدل. */
function recordRateLimited({ ip, route, ua, count, limit }) {
  const actor = getActor(ip);
  actor.lastSeen = Date.now();
  actor.blocked += 1;
  if (ua) actor.uas.add(shortUa(ua));
  pushEvent({
    type: 'rate_limited',
    ip: actor.ip,
    route,
    detail: `تجاوز الحد (${count}/${limit})`,
    ua: shortUa(ua)
  });
}

/** تسجيل محاولة دخول لوحة الأدمن. */
function recordLoginAttempt({ ip, username, success, reason, ua }) {
  const actor = getActor(ip);
  actor.lastSeen = Date.now();
  if (ua) actor.uas.add(shortUa(ua));
  if (success) actor.loginOk += 1;
  else actor.loginFailed += 1;

  pushEvent({
    type: success ? 'login_success' : 'login_failed',
    ip: actor.ip,
    detail: success
      ? `دخول ناجح: ${username}`
      : `فشل الدخول: ${username || '—'}${reason ? ` (${reason})` : ''}`,
    ua: shortUa(ua)
  });
}

/** تسجيل إرسال فورم تسجيل تاجر. */
function recordSubmit({ ip, phone, source, ua }) {
  const actor = getActor(ip);
  actor.lastSeen = Date.now();
  actor.submits += 1;
  pushEvent({
    type: 'submit',
    ip: actor.ip,
    phone: maskPhone(phone),
    detail: source === 'field_sales' ? 'مبيعات على الأرض' : 'عميل يلا تاجر',
    ua: shortUa(ua)
  });
}

/** تسجيل محاولة استغلال (حقن / XSS / اختراق مسار). */
function recordSuspicious({ ip, route, pattern, sample, ua }) {
  const actor = getActor(ip);
  actor.lastSeen = Date.now();
  actor.suspicious += 1;
  if (ua) actor.uas.add(shortUa(ua));
  pushEvent({
    type: 'suspicious_input',
    ip: actor.ip,
    route,
    patternKey: pattern.key,
    detail: pattern.label,
    sample: maskSample(sample),
    ua: shortUa(ua)
  });
  console.warn(`[SECURITY] ${pattern.key} from ${normalizeIp(ip)} on ${route}: ${maskSample(sample).slice(0, 80)}`);
}

/** تسجيل محاولة وصول لمسار محمي بدون تصريح. */
function recordUnauthorized({ ip, route, ua, reason }) {
  const actor = getActor(ip);
  actor.lastSeen = Date.now();
  actor.unauthorized += 1;
  pushEvent({
    type: 'unauthorized',
    ip: actor.ip,
    route,
    detail: reason || 'محاولة وصول بدون تسجيل دخول',
    ua: shortUa(ua)
  });
}

/* -------------------------------------------------------------------------- */
/* Middleware                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Middleware يُركَّب مبكراً: يعدّ إجمالي المرور، ويفحص كل طلب ضد بصمات
 * الهجوم. عند وجود بصمة يسجّل الحدث ويرفض الطلب بـ 400 حتى لا تصل
 * الحمولة الخبيثة لأي طبقة أعمق (قاعدة البيانات أو الملفات).
 */
function inspectRequest(req, res, next) {
  countMinute();

  // نتجاهل الملفات الثابتة لتقليل الضجيج وتكلفة الفحص
  const route = req.path;
  if (/\.(css|js|png|jpe?g|webp|svg|ico|woff2?|map)$/i.test(route)) return next();

  const hit =
    scanPayload(req.query) ||
    scanPayload(req.params) ||
    // multipart (الصور) يُعالجه multer لاحقاً، هنا نفحص الحقول النصية فقط
    (req.is && req.is('multipart/form-data') ? null : scanPayload(req.body));

  if (hit) {
    recordSuspicious({
      ip: req.ip,
      route,
      pattern: hit.pattern,
      sample: hit.sample,
      ua: req.get('user-agent')
    });
    return res.status(400).json({ error: 'طلب غير صالح. تم تسجيل المحاولة.' });
  }

  next();
}

/* -------------------------------------------------------------------------- */
/* Threat analysis                                                            */
/* -------------------------------------------------------------------------- */

/** يجمع أحداث النافذة الزمنية الحالية لكل IP. */
function windowStats() {
  const since = Date.now() - CONFIG.windowMs;
  /** @type {Map<string, any>} */
  const perIp = new Map();
  let total = 0;

  for (const event of events) {
    if (event.at < since) continue;
    total += 1;
    let bucket = perIp.get(event.ip);
    if (!bucket) {
      bucket = {
        ip: event.ip,
        lookups: 0,
        invalid: 0,
        blocked: 0,
        loginFailed: 0,
        suspicious: 0,
        unauthorized: 0,
        submits: 0,
        phones: new Set(),
        lastSeen: event.at,
        uas: new Set()
      };
      perIp.set(event.ip, bucket);
    }
    bucket.lastSeen = Math.max(bucket.lastSeen, event.at);
    if (event.ua) bucket.uas.add(event.ua);

    switch (event.type) {
      case 'lookup':
        bucket.lookups += 1;
        if (event.phone) bucket.phones.add(event.phone);
        break;
      case 'lookup_invalid':
        bucket.invalid += 1;
        break;
      case 'rate_limited':
        bucket.blocked += 1;
        break;
      case 'login_failed':
        bucket.loginFailed += 1;
        break;
      case 'suspicious_input':
        bucket.suspicious += 1;
        break;
      case 'unauthorized':
        bucket.unauthorized += 1;
        break;
      case 'submit':
        bucket.submits += 1;
        break;
      default:
        break;
    }
  }

  return { perIp, total, since };
}

/** أعلى معدل طلبات في الدقيقة خلال آخر 10 دقائق. */
function peakRpm() {
  const currentMinute = Math.floor(Date.now() / 60000);
  let peak = 0;
  for (const [minute, count] of minuteBuckets) {
    if (minute >= currentMinute - 10 && count > peak) peak = count;
  }
  return peak;
}

/**
 * التحليل الأساسي: يحوّل الأرقام الخام إلى قائمة تهديدات مفهومة بالعربية
 * مع درجة خطورة وتوصية إجراء.
 */
function analyzeThreats({ dbReady = true, dbMode = null } = {}) {
  const { perIp } = windowStats();
  const threats = [];
  const minutes = Math.round(CONFIG.windowMs / 60000);

  for (const bucket of perIp.values()) {
    // نُسجّل موضع البداية حتى نُلحق بكل تهديدات هذا المصدر توقيت أحدث دليل
    // عليه (bucket.lastSeen). هذا التوقيت هو ما يحدد لاحقاً هل التهديد
    // "مقروء" أم ظهر بعد آخر مراجعة من الأدمن.
    const threatStartIdx = threats.length;
    const distinct = bucket.phones.size;

    // 1) تجميع بيانات: أرقام كثيرة مختلفة من نفس المصدر
    if (distinct >= CONFIG.distinctPhonesWarn) {
      const critical = distinct >= CONFIG.distinctPhonesHigh;
      threats.push({
        key: `enumeration:${bucket.ip}`,
        kind: 'enumeration',
        level: critical ? 'high' : 'medium',
        ip: bucket.ip,
        title: 'محاولة تجميع أرقام التجار (Enumeration)',
        detail: `الـ IP ${bucket.ip} استعلم عن ${distinct} رقم مختلف خلال ${minutes} دقيقة.`,
        impact: 'تسريب قائمة أرقام عملاء يلا تاجر.',
        action: critical
          ? 'يُنصح بحجب هذا الـ IP على مستوى الـ Nginx / الفايروول فوراً.'
          : 'راقب هذا الـ IP؛ لو استمر المعدل فاحجبه.',
        metric: distinct
      });
    }

    // 2) حجم استعلامات مرتفع (حتى لو نفس الأرقام)
    if (bucket.lookups >= CONFIG.lookupVolumeWarn) {
      const critical = bucket.lookups >= CONFIG.lookupVolumeHigh;
      threats.push({
        key: `lookup_volume:${bucket.ip}`,
        kind: 'lookup_volume',
        level: critical ? 'high' : 'low',
        ip: bucket.ip,
        title: 'عدد استعلامات مرتفع من مصدر واحد',
        detail: `${bucket.lookups} استعلام من ${bucket.ip} خلال ${minutes} دقيقة.`,
        impact: 'ضغط على السيرفر وعلى الخدمة الخارجية للتكويد.',
        action: critical ? 'قلّل حد المعدل أو احجب المصدر مؤقتاً.' : 'تحت المراقبة.',
        metric: bucket.lookups
      });
    }

    // 3) إصرار على تجاوز حد المعدل
    if (bucket.blocked >= CONFIG.blockedWarn) {
      const critical = bucket.blocked >= CONFIG.blockedHigh;
      threats.push({
        key: `rate_limited:${bucket.ip}`,
        kind: 'rate_limited',
        level: critical ? 'high' : 'medium',
        ip: bucket.ip,
        title: 'إصرار على تجاوز حد الطلبات',
        detail: `تم إيقاف ${bucket.blocked} طلب من ${bucket.ip} بواسطة محدد المعدل.`,
        impact: 'مؤشر على أداة آلية (Bot) تحاول الاستمرار رغم الحجب.',
        action: critical ? 'احجب الـ IP على مستوى الشبكة.' : 'راقب المصدر.',
        metric: bucket.blocked
      });
    }

    // 4) تخمين كلمة مرور الأدمن
    if (bucket.loginFailed >= CONFIG.loginFailWarn) {
      const critical = bucket.loginFailed >= CONFIG.loginFailHigh;
      threats.push({
        key: `brute_force:${bucket.ip}`,
        kind: 'brute_force',
        level: critical ? 'critical' : 'high',
        ip: bucket.ip,
        title: 'محاولات تخمين كلمة مرور لوحة الأدمن',
        detail: `${bucket.loginFailed} محاولة دخول فاشلة من ${bucket.ip} خلال ${minutes} دقيقة.`,
        impact: 'اختراق لوحة التحكم يعني الوصول لكل بيانات التجار.',
        action: critical
          ? 'احجب الـ IP فوراً وغيّر كلمة مرور المسؤولين.'
          : 'تأكد من قوة كلمات المرور وراقب المصدر.',
        metric: bucket.loginFailed
      });
    }

    // 5) محاولة استغلال مباشرة — أخطر ما يمكن رصده
    if (bucket.suspicious > 0) {
      threats.push({
        key: `injection:${bucket.ip}`,
        kind: 'injection',
        level: 'critical',
        ip: bucket.ip,
        title: 'محاولة حقن / استغلال مرصودة',
        detail: `${bucket.suspicious} محاولة من ${bucket.ip} تحتوي أنماط حقن (SQL/XSS/مسارات).`,
        impact: 'استهداف مباشر لقاعدة البيانات أو ملفات السيرفر.',
        action: 'الطلبات مرفوضة تلقائياً بـ 400، لكن يجب حجب المصدر ومراجعة السجل بالأسفل.',
        metric: bucket.suspicious
      });
    }

    // 6) فحص عشوائي بأرقام غير صحيحة
    if (bucket.invalid >= CONFIG.invalidPhoneWarn) {
      threats.push({
        key: `invalid_probing:${bucket.ip}`,
        kind: 'invalid_probing',
        level: 'low',
        ip: bucket.ip,
        title: 'إدخال أرقام غير صحيحة بشكل متكرر',
        detail: `${bucket.invalid} رقم غير صحيح من ${bucket.ip}.`,
        impact: 'قد يكون فحصاً آلياً عشوائياً أو مستخدماً يواجه مشكلة.',
        action: 'مستوى منخفض — للمتابعة فقط.',
        metric: bucket.invalid
      });
    }

    // 7) محاولات وصول لمسارات محمية
    if (bucket.unauthorized >= 5) {
      threats.push({
        key: `unauthorized:${bucket.ip}`,
        kind: 'unauthorized',
        level: 'medium',
        ip: bucket.ip,
        title: 'محاولات وصول لمسارات محمية بدون تصريح',
        detail: `${bucket.unauthorized} محاولة من ${bucket.ip} على مسارات تتطلب تسجيل دخول.`,
        impact: 'استكشاف للمسارات الإدارية (Endpoint discovery).',
        action: 'المسارات محمية بالفعل؛ راقب المصدر.',
        metric: bucket.unauthorized
      });
    }

    // كل تهديد أضفناه لهذا المصدر يحمل توقيت آخر نشاط له
    for (let i = threatStartIdx; i < threats.length; i += 1) {
      threats[i].lastEvidenceAt = bucket.lastSeen;
    }
  }

  /* ---- تهديدات على مستوى السيرفر (خطر التوقف) ---- */

  const rpm = peakRpm();
  if (rpm >= CONFIG.spikeRpmWarn) {
    const critical = rpm >= CONFIG.spikeRpmHigh;
    threats.push({
      key: 'traffic_spike',
      kind: 'traffic_spike',
      level: critical ? 'high' : 'medium',
      title: 'ارتفاع مفاجئ في عدد الطلبات',
      detail: `أعلى معدل مسجَّل ${rpm} طلب/دقيقة خلال آخر 10 دقائق.`,
      impact: 'احتمال هجوم إغراق (DoS) قد يوقف السيرفر عن الاستجابة.',
      action: critical
        ? 'فعّل حماية على مستوى الشبكة (Cloudflare / Nginx limit_req) فوراً.'
        : 'راقب المعدل؛ إن استمر الارتفاع فعّل حماية الشبكة.',
      metric: rpm
    });
  }

  const rssMb = Math.round(process.memoryUsage().rss / 1048576);
  if (rssMb >= CONFIG.memoryWarnMb) {
    const critical = rssMb >= CONFIG.memoryHighMb;
    threats.push({
      key: 'memory_pressure',
      kind: 'memory_pressure',
      level: critical ? 'high' : 'medium',
      title: 'استهلاك ذاكرة مرتفع',
      detail: `العملية تستهلك ${rssMb} ميجابايت.`,
      impact: 'خطر توقف السيرفر (Out of memory) وفقدان الطلبات الجارية.',
      action: critical
        ? 'أعد تشغيل الخدمة وافحص وجود تسريب ذاكرة أو رفع ملفات ضخمة.'
        : 'راقب الاستهلاك.',
      metric: rssMb
    });
  }

  if (eventLoopLagMs >= CONFIG.lagWarnMs) {
    const critical = eventLoopLagMs >= CONFIG.lagHighMs;
    threats.push({
      key: 'event_loop_lag',
      kind: 'event_loop_lag',
      level: critical ? 'high' : 'medium',
      title: 'تباطؤ في استجابة السيرفر',
      detail: `تأخير حلقة الأحداث ${Math.round(eventLoopLagMs)} مللي ثانية.`,
      impact: 'السيرفر مشغول لدرجة قد تجعله يتوقف عن الرد على العملاء.',
      action: 'افحص العمليات الثقيلة أو الضغط الحالي على المسارات.',
      metric: Math.round(eventLoopLagMs)
    });
  }

  if (!dbReady) {
    threats.push({
      key: 'database_down',
      kind: 'database_down',
      level: 'critical',
      title: 'قاعدة البيانات غير متصلة',
      detail: 'طبقة الوصول للبيانات غير جاهزة حالياً.',
      impact: 'لا يمكن حفظ تسجيلات جديدة — خطر فقدان بيانات تجار.',
      action: 'راجع اتصال SQL Server ومتغيرات البيئة فوراً.',
      metric: 0
    });
  } else if (dbMode === 'file') {
    threats.push({
      key: 'database_fallback',
      kind: 'database_fallback',
      level: 'low',
      title: 'التخزين يعمل بالوضع الاحتياطي (ملف JSON)',
      detail: 'تعذّر الاتصال بـ SQL Server، والنظام يخزّن محلياً في ملف.',
      impact: 'البيانات غير محمية بنسخ SQL الاحتياطية.',
      action: 'أعد الاتصال بـ SQL Server قبل الاعتماد على النظام في الإنتاج.',
      metric: 0
    });
  }

  // الأخطر أولاً، ثم الأكبر رقماً
  threats.sort((a, b) => (LEVEL_RANK[b.level] - LEVEL_RANK[a.level]) || (b.metric - a.metric));
  return threats;
}

/* -------------------------------------------------------------------------- */
/* Overview (dashboard payload)                                               */
/* -------------------------------------------------------------------------- */

const LEVEL_HEADLINES = {
  safe: 'كل حاجة آمنة ✅ — لا يوجد نشاط مشبوه',
  low: 'نشاط بسيط يستحق المتابعة',
  medium: 'نشاط مشبوه — يُنصح بالمراجعة',
  high: 'خطر مرتفع — تدخّل مطلوب',
  critical: 'خطر حرج — تدخّل فوري مطلوب'
};

/**
 * كل ما تحتاجه لوحة الأدمن في استجابة واحدة.
 * @param {{dbReady?:boolean, dbMode?:string|null}} context
 */
function getOverview(context = {}) {
  const threats = analyzeThreats(context);
  const { perIp, total } = windowStats();

  const level = threats.reduce(
    (worst, threat) => (LEVEL_RANK[threat.level] > LEVEL_RANK[worst] ? threat.level : worst),
    'safe'
  );

  // أكثر المصادر نشاطاً (كل التاريخ المحفوظ، لا النافذة فقط)
  const topActors = Array.from(actors.values())
    .map((actor) => ({
      ip: actor.ip,
      lookups: actor.lookups,
      distinctPhones: actor.phones.size,
      invalid: actor.invalid,
      blocked: actor.blocked,
      loginFailed: actor.loginFailed,
      suspicious: actor.suspicious,
      submits: actor.submits,
      firstSeen: new Date(actor.firstSeen).toISOString(),
      lastSeen: new Date(actor.lastSeen).toISOString(),
      userAgent: Array.from(actor.uas)[0] || 'غير معروف',
      statuses: actor.statuses
    }))
    .sort((a, b) => (b.lookups + b.blocked * 3 + b.suspicious * 10) - (a.lookups + a.blocked * 3 + a.suspicious * 10))
    .slice(0, 12);

  // إجماليات كل التاريخ المحفوظ
  const totals = {
    lookups: 0, invalid: 0, blocked: 0, loginFailed: 0,
    suspicious: 0, submits: 0, unauthorized: 0
  };
  const statusTotals = {};
  for (const actor of actors.values()) {
    totals.lookups += actor.lookups;
    totals.invalid += actor.invalid;
    totals.blocked += actor.blocked;
    totals.loginFailed += actor.loginFailed;
    totals.suspicious += actor.suspicious;
    totals.submits += actor.submits;
    totals.unauthorized += actor.unauthorized;
    for (const [status, count] of Object.entries(actor.statuses)) {
      statusTotals[status] = (statusTotals[status] || 0) + count;
    }
  }

  const mem = process.memoryUsage();

  for (const threat of threats) threat.acknowledged = isAcknowledged(threat);
  const unacknowledged = threats.filter(
    (t) => LEVEL_RANK[t.level] >= LEVEL_RANK.medium && !t.acknowledged
  ).length;

  return {
    level,
    headline: LEVEL_HEADLINES[level],
    threats,
    counts: {
      threats: threats.length,
      critical: threats.filter((t) => t.level === 'critical').length,
      high: threats.filter((t) => t.level === 'high').length,
      medium: threats.filter((t) => t.level === 'medium').length,
      low: threats.filter((t) => t.level === 'low').length,
      unacknowledged
    },
    window: {
      minutes: Math.round(CONFIG.windowMs / 60000),
      events: total,
      uniqueIps: perIp.size
    },
    totals,
    statusTotals,
    topActors,
    recentEvents: events
      .slice(-60)
      .reverse()
      .map((event) => ({ ...event, at: new Date(event.at).toISOString() })),
    server: {
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
      rssMb: Math.round(mem.rss / 1048576),
      heapUsedMb: Math.round(mem.heapUsed / 1048576),
      eventLoopLagMs: Math.round(eventLoopLagMs),
      peakRpm: peakRpm(),
      trackedIps: actors.size,
      storedEvents: events.length,
      dbReady: context.dbReady !== false,
      dbMode: context.dbMode || null
    },
    acknowledgedAt: acknowledgedAt ? new Date(acknowledgedAt).toISOString() : null,
    acknowledgedBy,
    thresholds: CONFIG
  };
}

/**
 * هل هذا التهديد مُراجَع؟ يكون مراجَعاً فقط إذا سجّله الأدمن ولم يظهر له
 * أي دليل جديد بعد لحظة المراجعة.
 */
function isAcknowledged(threat) {
  const seenAt = acknowledgedThreats.get(threat.key);
  if (seenAt == null) return false;
  return (threat.lastEvidenceAt || 0) <= seenAt;
}

/**
 * تعليم التنبيهات الحالية كمقروءة.
 *
 * نخزّن لكل تهديد توقيت أحدث دليل عليه لحظة المراجعة، فإن استمر النشاط
 * وظهر دليل جديد يعود التنبيه للظهور تلقائياً بدل أن يبقى مكتوماً.
 */
function acknowledge(username, context = {}) {
  const now = Date.now();
  acknowledgedAt = now;
  acknowledgedBy = username || 'admin';

  const threats = analyzeThreats(context);
  for (const threat of threats) {
    acknowledgedThreats.set(threat.key, threat.lastEvidenceAt || now);
  }

  // تنظيف المفاتيح القديمة حتى لا تتضخم الخريطة مع الوقت
  const cutoff = now - CONFIG.windowMs * 4;
  for (const [key, seenAt] of acknowledgedThreats) {
    if (seenAt < cutoff) acknowledgedThreats.delete(key);
  }

  schedulePersist();
  return {
    acknowledgedAt: new Date(now).toISOString(),
    acknowledgedBy,
    acknowledgedCount: threats.length
  };
}

/* -------------------------------------------------------------------------- */
/* Persistence (survive restarts)                                             */
/* -------------------------------------------------------------------------- */

let persistTimer = null;

/**
 * الكتابة على القرص مؤجَّلة ومجمّعة (debounced) حتى لا نكتب ملفاً مع كل
 * طلب استعلام ونحوّل سجل الأمان نفسه إلى عبء على السيرفر.
 */
function schedulePersist() {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    try {
      const snapshot = {
        savedAt: new Date().toISOString(),
        acknowledgedAt,
        acknowledgedBy,
        // خريطة التنبيهات المُراجَعة حتى لا تعود كلها "جديدة" بعد الريستارت
        acknowledgedThreats: Array.from(acknowledgedThreats.entries()),
        // نحفظ آخر 400 حدث فقط لتبقى القراءة عند الإقلاع سريعة
        events: events.slice(-400)
      };
      fs.writeFileSync(LOG_FILE, JSON.stringify(snapshot, null, 2), 'utf8');
    } catch (err) {
      console.error('[SECURITY] Failed to persist log:', err.message);
    }
  }, 5000);
  if (persistTimer.unref) persistTimer.unref();
}

/** استرجاع السجل المحفوظ عند بدء التشغيل وإعادة بناء عدّادات الـ IPs. */
function restore() {
  try {
    if (!fs.existsSync(LOG_FILE)) return;
    const raw = JSON.parse(fs.readFileSync(LOG_FILE, 'utf8'));
    acknowledgedAt = raw.acknowledgedAt ? new Date(raw.acknowledgedAt).getTime() : null;
    acknowledgedBy = raw.acknowledgedBy || null;

    acknowledgedThreats.clear();
    if (Array.isArray(raw.acknowledgedThreats)) {
      for (const entry of raw.acknowledgedThreats) {
        if (Array.isArray(entry) && entry.length === 2 && Number.isFinite(entry[1])) {
          acknowledgedThreats.set(String(entry[0]), entry[1]);
        }
      }
    }

    (raw.events || []).forEach((event) => {
      const at = new Date(event.at).getTime();
      if (!Number.isFinite(at)) return;
      events.push({ ...event, at, id: nextEventId++ });

      // إعادة بناء الإحصائيات حتى لا تُفقد الصورة التاريخية بعد الريستارت
      const actor = getActor(event.ip);
      actor.firstSeen = Math.min(actor.firstSeen, at);
      actor.lastSeen = Math.max(actor.lastSeen, at);
      if (event.ua) actor.uas.add(event.ua);
      switch (event.type) {
        case 'lookup':
          actor.lookups += 1;
          if (event.phone) actor.phones.set(event.phone, (actor.phones.get(event.phone) || 0) + 1);
          if (event.status) actor.statuses[event.status] = (actor.statuses[event.status] || 0) + 1;
          break;
        case 'lookup_invalid': actor.invalid += 1; break;
        case 'rate_limited': actor.blocked += 1; break;
        case 'login_failed': actor.loginFailed += 1; break;
        case 'login_success': actor.loginOk += 1; break;
        case 'submit': actor.submits += 1; break;
        case 'suspicious_input': actor.suspicious += 1; break;
        case 'unauthorized': actor.unauthorized += 1; break;
        default: break;
      }
    });
    console.log(`[SECURITY] Restored ${events.length} events from security_log.json`);
  } catch (err) {
    console.error('[SECURITY] Failed to restore log:', err.message);
  }
}

/** تصفير كامل — للاختبارات فقط. */
function _reset() {
  events.length = 0;
  actors.clear();
  minuteBuckets.clear();
  acknowledgedAt = null;
  acknowledgedBy = null;
  acknowledgedThreats.clear();
  eventLoopLagMs = 0;
  nextEventId = 1;
}

module.exports = {
  CONFIG,
  ATTACK_PATTERNS,
  inspectRequest,
  recordLookup,
  recordRateLimited,
  recordLoginAttempt,
  recordSubmit,
  recordSuspicious,
  recordUnauthorized,
  getOverview,
  analyzeThreats,
  acknowledge,
  restore,
  maskPhone,
  maskSample,
  _reset
};
