/**
 * ==========================================================================
 * Yalla Tager - Merchant Lookup Service (خدمة الاستعلام عن التاجر)
 * ==========================================================================
 * تتعامل هذه الطبقة مع السيرفيس الخارجي:
 *   GET {LOOKUP_API_URL}?phone=01xxxxxxxxx
 *   Header: X-API-Key: <LOOKUP_API_KEY>
 *
 * شكل الاستجابة المتوقع:
 * {
 *   "success": true,
 *   "data": [ { shopName, merchantName, merchantPhone,
 *               merchantEmail, merchantCode, creationDate } ],
 *   "message": null
 * }
 *
 * ملاحظات مهمة مبنية على اختبار السيرفيس الفعلي:
 *  - الرقم غير الموجود يرجع success=true مع data=null (وليس خطأ).
 *  - السيرفيس يطابق الأرقام بالصيغة المحلية فقط (01xxxxxxxxx)؛ صيغة
 *    +20 أو 20 ترجع data=null، لذلك نطبّع الرقم قبل الإرسال.
 *  - المفتاح الناقص أو الخاطئ يرجع 401.
 *
 * ⚠️ الخصوصية: هذه الطبقة لا تُرجع بيانات التاجر للواجهة إلا بعد تطبيق
 *    قاعدة النافذة الزمنية (7 أيام). القرار يُتخذ في السيرفر ولا يُترك
 *    للمتصفح أبداً، حتى لا تُسرّب البيانات في استجابة الشبكة.
 * ==========================================================================
 */

const DEFAULT_URL = 'https://endpoints.svei.tech/api/YTGOnline/CheckMerchantForCoding';

/** عدد الأيام المسموح بعرض بيانات التاجر خلالها */
const RECENT_WINDOW_DAYS = parseInt(process.env.LOOKUP_RECENT_DAYS, 10) || 7;

/** مهلة الاتصال بالسيرفيس الخارجي (ملي ثانية) */
const LOOKUP_TIMEOUT_MS = parseInt(process.env.LOOKUP_TIMEOUT_MS, 10) || 15000;

/**
 * حالات نتيجة الاستعلام - تُستخدم كعقد ثابت بين السيرفر والواجهة.
 */
const LookupStatus = {
  /** الرقم غير موجود في النظام إطلاقاً => يكمل الفورم من الصفر */
  NOT_FOUND: 'not_found',
  /** موجود ومكوَّد بالفعل (لديه merchantCode) */
  ALREADY_CODED: 'already_coded',
  /** موجود لكن بدون كود => بانتظار فريق التكويد */
  AWAITING_CODING: 'awaiting_coding',
  /** موجود لكن تاريخ إنشائه أقدم من النافذة المسموحة => نحمي بياناته */
  PRIVACY_RESTRICTED: 'privacy_restricted'
};

/**
 * تطبيع رقم الهاتف المصري إلى الصيغة المحلية 01xxxxxxxxx.
 * السيرفيس الخارجي لا يطابق إلا هذه الصيغة (تم التحقق عملياً).
 */
function normalizePhone(rawPhone) {
  if (!rawPhone) return '';

  // إزالة كل ما ليس رقماً (مسافات، شرطات، أقواس، +)
  let digits = String(rawPhone).replace(/\D/g, '');

  // 00201xxxxxxxxx => 01xxxxxxxxx
  if (digits.startsWith('00')) digits = digits.slice(2);
  // 201xxxxxxxxx => 01xxxxxxxxx
  if (digits.startsWith('20') && digits.length > 11) digits = digits.slice(2);
  // 1xxxxxxxxx => 01xxxxxxxxx (رقم بدون الصفر البادئ)
  if (digits.length === 10 && digits.startsWith('1')) digits = '0' + digits;

  return digits;
}

/** التحقق من صحة صيغة رقم الهاتف المصري */
function isValidEgyptianMobile(normalizedPhone) {
  return /^01[0-25]\d{8}$/.test(normalizedPhone);
}

/**
 * حساب عدد الأيام المنقضية بين تاريخ الإنشاء والآن.
 * يرجع null إذا كان التاريخ غير صالح.
 */
function daysSince(dateValue) {
  if (!dateValue) return null;
  const created = new Date(dateValue);
  if (Number.isNaN(created.getTime())) return null;
  const diffMs = Date.now() - created.getTime();
  return diffMs / (1000 * 60 * 60 * 24);
}

/**
 * هل التاريخ داخل النافذة المسموحة؟
 * الشرط: من النهاردة وراجع 7 أيام (أي 0 <= العمر <= 7 أيام).
 * التواريخ المستقبلية تُعامل كغير صالحة تحفظاً (لا نعرض البيانات).
 */
function isWithinRecentWindow(dateValue) {
  const age = daysSince(dateValue);
  if (age === null) return false;
  if (age < 0) return false; // تاريخ مستقبلي => غير موثوق
  return age <= RECENT_WINDOW_DAYS;
}

/**
 * استدعاء السيرفيس الخارجي وإرجاع أول سجل مطابق (أو null).
 * يرمي خطأ في حالة فشل الاتصال أو رفض المفتاح.
 */
async function fetchMerchantRecord(normalizedPhone) {
  const baseUrl = process.env.LOOKUP_API_URL || DEFAULT_URL;
  const apiKey = process.env.LOOKUP_API_KEY;

  if (!apiKey) {
    const err = new Error('LOOKUP_API_KEY is not configured on the server.');
    err.code = 'CONFIG_MISSING';
    throw err;
  }

  const url = `${baseUrl}?phone=${encodeURIComponent(normalizedPhone)}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);

  let response;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: { 'X-API-Key': apiKey, Accept: 'application/json' },
      signal: controller.signal
    });
  } catch (err) {
    const wrapped = new Error(
      err.name === 'AbortError'
        ? 'Merchant lookup service timed out.'
        : `Merchant lookup service unreachable: ${err.message}`
    );
    wrapped.code = 'UPSTREAM_UNAVAILABLE';
    throw wrapped;
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 401) {
    const err = new Error('Merchant lookup service rejected the API key.');
    err.code = 'UPSTREAM_UNAUTHORIZED';
    throw err;
  }

  if (!response.ok) {
    const err = new Error(`Merchant lookup service returned HTTP ${response.status}.`);
    err.code = 'UPSTREAM_ERROR';
    throw err;
  }

  let payload;
  try {
    payload = await response.json();
  } catch (err) {
    const wrapped = new Error('Merchant lookup service returned a malformed response.');
    wrapped.code = 'UPSTREAM_ERROR';
    throw wrapped;
  }

  if (payload && payload.success === false) {
    const err = new Error(payload.message || 'Merchant lookup service reported a failure.');
    err.code = 'UPSTREAM_ERROR';
    throw err;
  }

  const data = payload ? payload.data : null;
  if (!Array.isArray(data) || data.length === 0) return null;

  return data[0];
}

/**
 * الاستعلام الكامل مع تطبيق قواعد العمل والخصوصية.
 *
 * @param {string} rawPhone رقم الهاتف كما أدخله المستخدم
 * @returns {Promise<{status: string, phone: string, merchant?: object, merchantCode?: string}>}
 */
async function lookupMerchant(rawPhone) {
  const phone = normalizePhone(rawPhone);

  if (!isValidEgyptianMobile(phone)) {
    const err = new Error('Invalid Egyptian mobile number format.');
    err.code = 'INVALID_PHONE';
    throw err;
  }

  const record = await fetchMerchantRecord(phone);

  // 1) غير موجود => يستكمل الفورم من الصفر
  if (!record) {
    return { status: LookupStatus.NOT_FOUND, phone };
  }

  // 2) موجود لكن قديم => نحمي بياناته ولا نعرضها إطلاقاً.
  //    نتحقق من هذا قبل أي شيء آخر حتى لا تخرج البيانات في أي مسار.
  if (!isWithinRecentWindow(record.creationDate)) {
    return {
      status: LookupStatus.PRIVACY_RESTRICTED,
      phone,
      windowDays: RECENT_WINDOW_DAYS
    };
  }

  // البيانات المسموح بعرضها فقط (نُصفّي الحقول صراحةً بدل تمرير السجل كما هو)
  const merchant = {
    shopName: record.shopName || null,
    merchantName: record.merchantName || null,
    merchantPhone: record.merchantPhone || null,
    merchantEmail: record.merchantEmail || null,
    creationDate: record.creationDate || null
  };

  const merchantCode = record.merchantCode ? String(record.merchantCode).trim() : '';

  // 3) لديه كود => متكوّد وتمام
  if (merchantCode) {
    return {
      status: LookupStatus.ALREADY_CODED,
      phone,
      merchant,
      merchantCode
    };
  }

  // 4) بدون كود => بياناته موجودة وبانتظار فريق التكويد
  return { status: LookupStatus.AWAITING_CODING, phone, merchant };
}

module.exports = {
  lookupMerchant,
  normalizePhone,
  isValidEgyptianMobile,
  isWithinRecentWindow,
  daysSince,
  LookupStatus,
  RECENT_WINDOW_DAYS
};
