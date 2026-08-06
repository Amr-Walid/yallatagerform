/**
 * ==========================================================================
 * Rate Limiter (محدد معدل الطلبات)
 * ==========================================================================
 * محدد بسيط في الذاكرة (in-memory) بنافذة زمنية متجددة.
 *
 * لماذا نحتاجه؟
 * مسار الاستعلام عن التاجر (`/api/lookup`) مسار عام بدون تسجيل دخول،
 * ويقبل رقم هاتف ويرجع معلومات عن وجود التاجر. بدون تحديد للمعدل يمكن
 * لأي شخص أن يجرب ملايين الأرقام بالتسلسل (Enumeration Attack) لبناء
 * قائمة بأرقام تجار يلا تاجر — وهذا في حد ذاته تسريب لبيانات العملاء
 * حتى لو لم تظهر تفاصيلهم.
 *
 * ملاحظة للنشر: هذا المحدد يعمل داخل ذاكرة العملية الواحدة. إذا تم
 * تشغيل التطبيق بعدة نسخ (cluster / عدة خوادم) فيُنصح باستخدام مخزن
 * مشترك مثل Redis أو التحديد على مستوى الـ Nginx / API Gateway.
 * ==========================================================================
 */

/**
 * إنشاء middleware لتحديد معدل الطلبات.
 *
 * @param {object} options
 * @param {number} options.windowMs مدة النافذة الزمنية بالملي ثانية
 * @param {number} options.max أقصى عدد طلبات مسموح خلال النافذة
 * @param {string} options.message الرسالة المعروضة عند تجاوز الحد
 * @param {(info:object)=>void} [options.onBlocked] يُنادى عند حجب طلب، ليتمكن
 *        مراقب الأمان من تسجيل الواقعة وعرضها على لوحة الأدمن.
 */
function createRateLimiter({ windowMs = 60000, max = 20, message, onBlocked } = {}) {
  /** @type {Map<string, {count: number, resetAt: number}>} */
  const hits = new Map();

  // تنظيف دوري للمفاتيح المنتهية حتى لا تتضخم الذاكرة
  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) {
      if (entry.resetAt <= now) hits.delete(key);
    }
  }, windowMs);
  // لا نمنع العملية من الإنهاء بسبب هذا المؤقت
  if (cleanup.unref) cleanup.unref();

  return function rateLimit(req, res, next) {
    // req.ip يعتمد على إعداد trust proxy عند العمل خلف Nginx
    const key = req.ip || req.connection.remoteAddress || 'unknown';
    const now = Date.now();

    let entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(key, entry);
    }

    entry.count += 1;

    const remaining = Math.max(0, max - entry.count);
    res.setHeader('X-RateLimit-Limit', max);
    res.setHeader('X-RateLimit-Remaining', remaining);
    res.setHeader('X-RateLimit-Reset', Math.ceil(entry.resetAt / 1000));

    if (entry.count > max) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      res.setHeader('Retry-After', retryAfter);
      console.warn(`[RATE-LIMIT] Blocked ${key} on ${req.method} ${req.path} (${entry.count}/${max})`);
      // نُبلّغ مراقب الأمان حتى يظهر الحجب في تبويب الأمان بلوحة الأدمن.
      if (typeof onBlocked === 'function') {
        try {
          onBlocked({
            ip: key,
            route: `${req.method} ${req.path}`,
            ua: req.get ? req.get('user-agent') : null,
            count: entry.count,
            limit: max
          });
        } catch (err) {
          console.error('[RATE-LIMIT] onBlocked handler failed:', err.message);
        }
      }
      return res.status(429).json({
        error:
          message ||
          `عدد كبير من المحاولات. برجاء الانتظار ${retryAfter} ثانية ثم إعادة المحاولة.`
      });
    }

    next();
  };
}

module.exports = { createRateLimiter };
