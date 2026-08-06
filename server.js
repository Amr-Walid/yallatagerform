require('dotenv').config();
const express = require('express');
const multer = require('multer');
const nodemailer = require('nodemailer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Auto-create uploads directory
const UPLOADS_DIR = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Multer storage configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOADS_DIR);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // Max 5MB
  fileFilter: (req, file, cb) => {
    const filetypes = /jpeg|jpg|png|webp/;
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = filetypes.test(file.mimetype);
    if (mimetype && extname) {
      return cb(null, true);
    }
    cb(new Error('Only images (JPG, PNG, WEBP) are allowed!'));
  }
});

const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const db = require('./db');
const merchantLookup = require('./services/merchantLookup');
const security = require('./services/securityMonitor');
const { createRateLimiter } = require('./middleware/rateLimit');

// Public merchant lookup is rate limited to prevent phone-number enumeration.
// Every block is reported to the security monitor so the admin sees who is
// hammering the endpoint, not just a line in the server log.
const lookupRateLimiter = createRateLimiter({
  windowMs: parseInt(process.env.LOOKUP_RATE_WINDOW_MS, 10) || 60000,
  max: parseInt(process.env.LOOKUP_RATE_MAX, 10) || 15,
  message: 'عدد كبير من محاولات الاستعلام. برجاء الانتظار قليلاً ثم إعادة المحاولة.',
  onBlocked: (info) => security.recordRateLimited(info)
});

// Registration submissions are rate limited as well (abuse protection now
// that the CAPTCHA has been removed from the form).
const submitRateLimiter = createRateLimiter({
  windowMs: parseInt(process.env.SUBMIT_RATE_WINDOW_MS, 10) || 600000,
  max: parseInt(process.env.SUBMIT_RATE_MAX, 10) || 10,
  message: 'عدد كبير من محاولات الإرسال. برجاء الانتظار قليلاً ثم إعادة المحاولة.',
  onBlocked: (info) => security.recordRateLimited(info)
});

// Trust the reverse proxy so req.ip is the real client address rather than the
// proxy's — otherwise every visitor collapses into one IP and the monitor
// cannot tell attackers apart.
app.set('trust proxy', process.env.TRUST_PROXY === 'false' ? false : 1);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser('yalla-tager-cookie-secret'));

// Security inspection runs BEFORE any route: it counts traffic and rejects
// requests carrying SQL-injection / XSS / path-traversal payloads with 400,
// so a malicious payload never reaches the database or the filesystem.
app.use(security.inspectRequest);

// Custom middleware to protect static dashboard files before express.static is loaded.
// Note: extension-less aliases (/dashboard, /login) are normalized here too, otherwise
// they fall through to the catch-all and silently serve the public form page.
app.use((req, res, next) => {
  const normalizedPath = req.path.toLowerCase().replace(/\/+$/, '') || '/';
  if (normalizedPath === '/dashboard' || normalizedPath === '/dashboard.html' || normalizedPath === '/dashboard.js') {
    const token = req.cookies.token;
    if (!token) {
      return res.redirect('/login.html');
    }
    try {
      jwt.verify(token, process.env.JWT_SECRET || 'yalla-tager-super-secret-jwt-key-2026');
      if (normalizedPath === '/dashboard') {
        return res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
      }
      next();
    } catch (err) {
      res.clearCookie('token');
      return res.redirect('/login.html');
    }
  } else if (normalizedPath === '/login') {
    // Clean alias for the admin login page.
    return res.sendFile(path.join(__dirname, 'public', 'login.html'));
  } else {
    next();
  }
});

app.use(express.static('public'));
app.use('/uploads', express.static(UPLOADS_DIR));

// Authentication Middleware for API routes
const requireAuth = (req, res, next) => {
  const token = req.cookies.token;
  if (!token) {
    // Recorded so repeated probing of admin endpoints surfaces on the
    // security tab as "endpoint discovery" rather than staying invisible.
    security.recordUnauthorized({
      ip: req.ip,
      route: `${req.method} ${req.path}`,
      ua: req.get('user-agent'),
      reason: 'طلب بدون تسجيل دخول'
    });
    return res.status(401).json({ error: 'غير مصرح بالدخول. يرجى تسجيل الدخول أولاً.' });
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'yalla-tager-super-secret-jwt-key-2026');
    req.user = decoded;
    next();
  } catch (err) {
    res.clearCookie('token');
    security.recordUnauthorized({
      ip: req.ip,
      route: `${req.method} ${req.path}`,
      ua: req.get('user-agent'),
      reason: 'تذكرة غير صالحة أو منتهية'
    });
    return res.status(401).json({ error: 'انتهت صلاحية الجلسة. يرجى تسجيل الدخول مجدداً.' });
  }
};

// Database initialization is handled by the data-access layer in ./db.js
// It uses SQL Server when reachable and falls back to a local JSON store
// (DB_DRIVER=auto by default). Set DB_DRIVER=mssql to enforce SQL Server only.
async function initDb() {
  try {
    await db.init();
    console.log(`[DB] Active storage driver: ${db.mode}`);
  } catch (err) {
    console.error('FATAL: Database initialization failed:', err.message);
    console.log('----------------------------------------------------------------------');
    console.log('Server cannot start without a database connection.');
    console.log('Tip: set DB_DRIVER=auto (or file) in .env to run with the local store.');
    console.log('----------------------------------------------------------------------');
    process.exit(1);
  }
}

// Mail Transporter for SMTP
const mailTransporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT) || 587,
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

// API Routes

// 00. Authentication API Routes
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'يرجى إدخال اسم المستخدم وكلمة المرور.' });
  }

  try {
    if (!db.isReady()) return res.status(500).json({ error: 'Database connection is not active.' });
    const user = await db.findUserByUsername(username.trim());

    if (!user) {
      console.warn(`[AUTH] Failed login attempt (user not found): ${username}`);
      security.recordLoginAttempt({
        ip: req.ip, username, success: false,
        reason: 'مستخدم غير موجود', ua: req.get('user-agent')
      });
      return res.status(401).json({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة.' });
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      console.warn(`[AUTH] Failed login attempt (incorrect password): ${username}`);
      security.recordLoginAttempt({
        ip: req.ip, username, success: false,
        reason: 'كلمة مرور خاطئة', ua: req.get('user-agent')
      });
      return res.status(401).json({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة.' });
    }

    const token = jwt.sign({ id: user.id, username: user.username }, process.env.JWT_SECRET || 'yalla-tager-super-secret-jwt-key-2026', { expiresIn: '8h' });
    
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 8 * 60 * 60 * 1000 // 8 hours
    });

    console.log(`[AUTH] User logged in successfully: ${user.username}`);
    security.recordLoginAttempt({
      ip: req.ip, username: user.username, success: true, ua: req.get('user-agent')
    });
    res.json({ success: true, message: 'تم تسجيل الدخول بنجاح.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'حدث خطأ في الخادم أثناء تسجيل الدخول.' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ success: true, message: 'تم تسجيل الخروج بنجاح.' });
});

app.get('/api/auth/session', (req, res) => {
  const token = req.cookies.token;
  if (!token) return res.json({ authenticated: false });
  try {
    jwt.verify(token, process.env.JWT_SECRET || 'yalla-tager-super-secret-jwt-key-2026');
    res.json({ authenticated: true });
  } catch (err) {
    res.json({ authenticated: false });
  }
});

app.post('/api/auth/register', requireAuth, async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'اسم المستخدم وكلمة المرور مطلوبان.' });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: 'يجب أن تكون كلمة المرور مكونة من 6 أحرف على الأقل.' });
  }

  try {
    if (!db.isReady()) return res.status(500).json({ error: 'Database connection is not active.' });

    const passwordHash = await bcrypt.hash(password, 10);

    // Verify uniqueness
    const existing = await db.findUserByUsername(username.trim());
    if (existing) {
      return res.status(400).json({ error: 'اسم المستخدم مسجل بالفعل.' });
    }

    await db.createUser({ username: username.trim(), password_hash: passwordHash });

    res.status(201).json({ success: true, message: 'تم إنشاء حساب المسؤول بنجاح.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'حدث خطأ في الخادم أثناء إنشاء الحساب.' });
  }
});

// 0. Public client-side configuration
app.get('/api/config', (req, res) => {
  res.json({
    // Number of days a merchant record stays viewable in the lookup flow
    lookupRecentDays: merchantLookup.RECENT_WINDOW_DAYS
  });
});

// 0.b Merchant lookup for the "Yalla Tager customer" entry flow.
//
// The privacy decision is made ENTIRELY on the server: when a record is
// older than the allowed window we return only the status, never the
// merchant fields, so restricted data never reaches the browser at all.
//
// Rate limited because this is a public endpoint that answers questions
// about merchant phone numbers (enumeration protection).
app.get('/api/lookup', lookupRateLimiter, async (req, res) => {
  const { phone } = req.query;

  if (!phone || !String(phone).trim()) {
    return res.status(400).json({ error: 'برجاء إدخال رقم الهاتف.' });
  }

  try {
    const result = await merchantLookup.lookupMerchant(phone);

    // Enrich the "awaiting coding" case with our own local record, if the
    // merchant already submitted through this system.
    if (result.status === merchantLookup.LookupStatus.AWAITING_CODING && db.isReady()) {
      try {
        const local = await db.findMerchantByPhone(result.phone);
        result.localRequestExists = Boolean(local);
        if (local) result.localStatus = local.status;
      } catch (err) {
        console.error('[LOOKUP] Local record check failed:', err.message);
      }
    }

    // Audit trail: who asked about which number and what the answer was.
    // The phone is masked inside the monitor so the security log itself never
    // becomes a leaked list of customer numbers.
    security.recordLookup({
      ip: req.ip,
      phone: result.phone || phone,
      status: result.status,
      ua: req.get('user-agent')
    });

    return res.json(result);
  } catch (err) {
    if (err.code === 'INVALID_PHONE') {
      security.recordLookup({
        ip: req.ip, phone, status: 'invalid_phone',
        ua: req.get('user-agent'), valid: false
      });
      return res.status(400).json({
        error: 'رقم الهاتف غير صحيح. برجاء إدخال رقم مصري صحيح مكوّن من 11 رقماً يبدأ بـ 01.'
      });
    }

    console.error('[LOOKUP] Failed:', err.code || '', err.message);

    if (err.code === 'CONFIG_MISSING' || err.code === 'UPSTREAM_UNAUTHORIZED') {
      // Server-side misconfiguration - do not leak details to the client
      return res.status(503).json({
        error: 'خدمة الاستعلام غير متاحة حالياً. برجاء التواصل مع فريق الدعم.'
      });
    }

    return res.status(503).json({
      error: 'تعذر الوصول لخدمة الاستعلام حالياً. برجاء المحاولة بعد قليل.'
    });
  }
});

// 1. Submit registration form (merchant self-completion or field sales agent)
app.post('/api/merchants', submitRateLimiter, upload.fields([
  { name: 'store_photo', maxCount: 1 },
  { name: 'id_photo', maxCount: 1 }
]), async (req, res) => {
  const deleteFiles = () => {
    if (req.files) {
      if (req.files['store_photo'] && req.files['store_photo'][0]) {
        fs.unlink(req.files['store_photo'][0].path, () => {});
      }
      if (req.files['id_photo'] && req.files['id_photo'][0]) {
        fs.unlink(req.files['id_photo'][0].path, () => {});
      }
    }
  };

  try {
    const {
      full_name,
      phone_number,
      email,
      store_name,
      governorate,
      city,
      category,
      supervisor_code,
      latitude,
      longitude,
      created_account
    } = req.body;

    // Registration source: which entry flow the request came from.
    //  - 'merchant'    : Yalla Tager customer who completed their own data
    //  - 'field_sales' : field sales agent registering a merchant on the ground
    const source = req.body.source === 'field_sales' ? 'field_sales' : 'merchant';

    // Use relative paths 'uploads/...' instead of absolute '/uploads/...' for Nginx subdirectory routing safety
    const storePhotoPath = req.files['store_photo'] ? 'uploads/' + req.files['store_photo'][0].filename : null;
    const idPhotoPath = req.files['id_photo'] ? 'uploads/' + req.files['id_photo'][0].filename : null;

    if (!full_name || !phone_number || !store_name || !governorate || !city || !category || !created_account) {
      deleteFiles();
      return res.status(400).json({ error: 'برجاء ملء جميع الحقول المطلوبة.' });
    }

    // Normalize and validate the phone number so the stored value always
    // matches the format the lookup service expects (01xxxxxxxxx).
    const normalizedPhone = merchantLookup.normalizePhone(phone_number);
    if (!merchantLookup.isValidEgyptianMobile(normalizedPhone)) {
      deleteFiles();
      return res.status(400).json({
        error: 'رقم الهاتف غير صحيح. برجاء إدخال رقم مصري صحيح مكوّن من 11 رقماً يبدأ بـ 01.'
      });
    }

    if (!db.isReady()) {
      deleteFiles();
      return res.status(500).json({ error: 'Database connection is not active.' });
    }

    // Prevent duplicate pending requests for the same phone number, which
    // would otherwise create repeated work for the coding team.
    const existingLocal = await db.findMerchantByPhone(normalizedPhone);
    if (existingLocal && existingLocal.status !== 'coded') {
      deleteFiles();
      return res.status(409).json({
        error: 'يوجد طلب تسجيل مسجّل بالفعل بهذا الرقم وجاري العمل عليه من فريق التكويد.'
      });
    }

    await db.insertMerchant({
      full_name,
      phone_number: normalizedPhone,
      email: email || null,
      store_name,
      governorate,
      city,
      category,
      supervisor_code: supervisor_code || null,
      latitude: latitude ? parseFloat(latitude) : null,
      longitude: longitude ? parseFloat(longitude) : null,
      store_photo: storePhotoPath,
      id_photo: idPhotoPath,
      created_account,
      source
    });

    security.recordSubmit({
      ip: req.ip, phone: normalizedPhone, source, ua: req.get('user-agent')
    });

    res.status(201).json({ success: true, message: 'Merchant registered successfully!' });
  } catch (err) {
    console.error('Error inserting merchant:', err);
    deleteFiles();
    res.status(500).json({ error: 'Server error: ' + err.message });
  }
});

// 2. Fetch Merchants for Dashboard
app.get('/api/merchants', requireAuth, async (req, res) => {
  try {
    const { status, downloaded, uploaded } = req.query;

    if (!db.isReady()) {
      return res.status(500).json({ error: 'Database connection is not active.' });
    }

    const records = await db.listMerchants({ status, downloaded, uploaded });
    res.json(records);
  } catch (err) {
    console.error('Error fetching merchants:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Build the CSV payload for a set of merchant rows.
 * Kept separate from the routes so the "new only" and "selected" exports
 * always produce an identical column layout.
 */
function buildMerchantsCsv(records) {
  const BOM = '\uFEFF';
  const headers = [
    'ID', 'الاسم الكامل', 'رقم الهاتف', 'البريد الإلكتروني', 'اسم المتجر',
    'المحافظة', 'المدينة', 'التخصص/الفئة', 'كود المشرف',
    'خط العرض', 'خط الطول', 'تاريخ الرفع', 'هل أنشأ حساب', 'مصدر التسجيل'
  ];

  let csvContent = BOM + headers.join(',') + '\n';

  records.forEach(row => {
    const csvRow = [
      row.id,
      `"${(row.full_name || '').replace(/"/g, '""')}"`,
      `"${(row.phone_number || '')}"`,
      `"${(row.email || '')}"`,
      `"${(row.store_name || '').replace(/"/g, '""')}"`,
      `"${(row.governorate || '').replace(/"/g, '""')}"`,
      `"${(row.city || '').replace(/"/g, '""')}"`,
      `"${(row.category || '').replace(/"/g, '""')}"`,
      `"${(row.supervisor_code || '')}"`,
      row.latitude || '',
      row.longitude || '',
      // Quoted: the localized date string contains a comma which would
      // otherwise shift all following CSV columns.
      `"${row.created_at ? new Date(row.created_at).toLocaleString('en-US') : ''}"`,
      `"${row.created_account || ''}"`,
      `"${row.source === 'field_sales' ? 'مبيعات على الأرض' : 'عميل يلا تاجر'}"`
    ];
    csvContent += csvRow.join(',') + '\n';
  });

  return csvContent;
}

function sendCsv(res, csvContent, prefix) {
  const filename = `${prefix}-${Date.now()}.csv`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.status(200).send(csvContent);
}

// 3. Export CSV of NEW records only (and mark them as downloaded)
app.get('/api/merchants/export/csv', requireAuth, async (req, res) => {
  try {
    if (!db.isReady()) {
      return res.status(500).json({ error: 'Database connection is not active.' });
    }
    const records = await db.getUndownloadedMerchants();

    if (records.length === 0) {
      return res.status(404).send('No new merchants to download.');
    }

    const csvContent = buildMerchantsCsv(records);
    await db.markDownloaded(records.map(r => r.id));
    sendCsv(res, csvContent, 'yalla-tager-merchants');
  } catch (err) {
    console.error('CSV Export failed:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * 3b. Re-export ANY records by id, whether or not they were downloaded before.
 *
 * This is the "download again / download selected" path. It deliberately does
 * NOT change the downloaded flag: re-downloading a file is not new work, so the
 * original downloaded_at timestamp must stay intact for the audit trail.
 */
app.post('/api/merchants/export/csv', requireAuth, async (req, res) => {
  try {
    if (!db.isReady()) {
      return res.status(500).json({ error: 'Database connection is not active.' });
    }

    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'Please provide an array of IDs.' });
    }

    const records = await db.getMerchantsByIds(ids);
    if (records.length === 0) {
      return res.status(404).json({ error: 'No matching merchants found.' });
    }

    sendCsv(res, buildMerchantsCsv(records), 'yalla-tager-selected');
  } catch (err) {
    console.error('CSV re-export failed:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * 3c. Reset the downloaded flag so records show up in the "new only" export
 * again. Useful when a download was lost or flagged by mistake.
 */
app.post('/api/merchants/reset-downloaded', requireAuth, async (req, res) => {
  try {
    if (!db.isReady()) {
      return res.status(500).json({ error: 'Database connection is not active.' });
    }

    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'Please provide an array of IDs.' });
    }

    const count = await db.resetDownloaded(ids);
    res.json({ success: true, count });
  } catch (err) {
    console.error('Reset downloaded failed:', err);
    res.status(500).json({ error: err.message });
  }
});

// 4. Mark selected as Uploaded
app.post('/api/merchants/mark-uploaded', requireAuth, async (req, res) => {
  try {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'Please provide an array of IDs.' });
    }

    if (!db.isReady()) {
      return res.status(500).json({ error: 'Database connection is not active.' });
    }

    const parsedIds = ids.map(id => parseInt(id)).filter(id => !isNaN(id));
    if (parsedIds.length === 0) {
      return res.status(400).json({ error: 'لم يتم تقديم أي معرفات صالحة.' });
    }

    await db.markUploaded(parsedIds);

    res.json({ success: true, message: 'Merchants marked as uploaded successfully.' });
  } catch (err) {
    console.error('Failed to mark uploaded:', err);
    res.status(500).json({ error: err.message });
  }
});

// 5. Coded (Update Merchant Code and send activation email)
app.post('/api/merchants/:id/code', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { merchant_code } = req.body;

    if (!merchant_code) {
      return res.status(400).json({ error: 'Merchant code is required.' });
    }

    if (!db.isReady()) {
      return res.status(500).json({ error: 'Database connection is not active.' });
    }

    const merchant = await db.getMerchantById(id);

    if (!merchant) {
      return res.status(404).json({ error: 'Merchant not found.' });
    }

    await db.setMerchantCode(id, merchant_code);

    let emailSent = false;
    let emailError = null;

    if (merchant.email) {
      try {
        const mailOptions = {
          from: process.env.SMTP_FROM || '"Yalla Tager" <no-reply@yallatager.com>',
          to: merchant.email,
          subject: 'تفعيل حسابك في يلا تاجر - كود التاجر الخاص بك',
          html: `
            <div style="direction: rtl; font-family: 'Cairo', 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px; max-width: 600px; margin: 0 auto; background-color: #ffffff;">
              <div style="text-align: center; margin-bottom: 20px;">
                <h1 style="color: #1a3b8b; margin: 0;">يلا تاجر - Yalla Tager</h1>
              </div>
              <hr style="border: 0; border-top: 1px solid #eeeeee;" />
              <h2 style="color: #2c3e50;">مرحباً ${merchant.full_name}،</h2>
              <p style="font-size: 16px; line-height: 1.6; color: #555555;">
                يسعدنا إبلاغك بأنه قد تم تفعيل وتكويد حساب متجرك <strong>(${merchant.store_name})</strong> بنجاح في نظام يلا تاجر.
              </p>
              <div style="background-color: #f7f9fc; border-right: 4px solid #1a3b8b; padding: 15px; margin: 20px 0; text-align: center; border-radius: 4px;">
                <p style="margin: 0 0 5px 0; font-size: 14px; color: #666666;">كود التاجر الخاص بك للتفعيل وطلب الأوردرات:</p>
                <strong style="font-size: 24px; color: #1a3b8b; letter-spacing: 2px;">${merchant_code}</strong>
              </div>
              <p style="font-size: 14px; color: #7f8c8d; line-height: 1.6;">
                يمكنك الآن تسجيل الدخول إلى التطبيق والبدء في طلب الأوردرات بسعر الجملة مباشرة.
              </p>
              <p style="font-size: 14px; color: #7f8c8d; margin-top: 30px;">
                مع تحيات فريق عمل يلا تاجر.
              </p>
            </div>
          `
        };

        await mailTransporter.sendMail(mailOptions);
        emailSent = true;
      } catch (err) {
        console.error('SMTP Mail error:', err.message);
        emailError = err.message + ' (Check SMTP credentials in .env)';
      }
    }

    res.json({
      success: true,
      message: 'Merchant marked as coded successfully.',
      emailSent,
      emailError
    });
  } catch (err) {
    console.error('Coded status update failed:', err);
    res.status(500).json({ error: err.message });
  }
});

/* -------------------------------------------------------------------------- */
/* 6. Security monitoring (مراقبة الأمان والاستعلامات)                        */
/* -------------------------------------------------------------------------- */

/**
 * Everything the security tab needs in one response: the overall verdict
 * ("all safe" vs. a ranked threat list), who is running lookups and how many,
 * plus live server-health signals that predict a crash (memory, event-loop
 * lag, request spikes, database availability).
 */
app.get('/api/security/overview', requireAuth, (req, res) => {
  try {
    res.json(security.getOverview({ dbReady: db.isReady(), dbMode: db.mode }));
  } catch (err) {
    console.error('[SECURITY] Overview failed:', err);
    res.status(500).json({ error: err.message });
  }
});

/** Mark the current alerts as reviewed by this admin. */
app.post('/api/security/acknowledge', requireAuth, (req, res) => {
  try {
    // نمرّر نفس سياق قاعدة البيانات المُستخدم في الـ overview حتى تُراجَع
    // تهديدات التخزين أيضاً بنفس مفاتيحها
    const result = security.acknowledge(req.user && req.user.username, {
      dbReady: db.isReady(),
      dbMode: db.mode
    });
    console.log(`[SECURITY] Alerts acknowledged by ${result.acknowledgedBy}`);
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('[SECURITY] Acknowledge failed:', err);
    res.status(500).json({ error: err.message });
  }
});

// Handle 404
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start Express and DB Initialization
app.listen(PORT, async () => {
  console.log(`Server is running on http://localhost:${PORT}`);
  // Restore the persisted security log so a restart does not erase the
  // history of who was probing the system.
  security.restore();
  await initDb();
});
