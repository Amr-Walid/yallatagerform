require('dotenv').config();
const express = require('express');
const multer = require('multer');
const sql = require('mssql');
const nodemailer = require('nodemailer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const CAPTCHA_SECRET = process.env.CAPTCHA_SECRET || 'yalla-tager-captcha-secret-key-12345';
function generateCaptchaHash(answer) {
  return crypto.createHmac('sha256', CAPTCHA_SECRET).update(answer.toString().trim()).digest('hex');
}

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

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser('yalla-tager-cookie-secret'));

// Custom middleware to protect static dashboard files before express.static is loaded
app.use((req, res, next) => {
  const normalizedPath = req.path.toLowerCase();
  if (normalizedPath === '/dashboard.html' || normalizedPath === '/dashboard.js') {
    const token = req.cookies.token;
    if (!token) {
      return res.redirect('/login.html');
    }
    try {
      jwt.verify(token, process.env.JWT_SECRET || 'yalla-tager-super-secret-jwt-key-2026');
      next();
    } catch (err) {
      res.clearCookie('token');
      return res.redirect('/login.html');
    }
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
    return res.status(401).json({ error: 'غير مصرح بالدخول. يرجى تسجيل الدخول أولاً.' });
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'yalla-tager-super-secret-jwt-key-2026');
    req.user = decoded;
    next();
  } catch (err) {
    res.clearCookie('token');
    return res.status(401).json({ error: 'انتهت صلاحية الجلسة. يرجى تسجيل الدخول مجدداً.' });
  }
};

// SQL Server Config (MSSQL Connection Pool Options)
const dbConfig = {
  server: process.env.DB_SERVER || 'localhost',
  port: parseInt(process.env.DB_PORT) || 1433,
  database: process.env.DB_DATABASE || 'YallaTagerForm',
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  connectionTimeout: parseInt(process.env.DB_CONNECTION_TIMEOUT) || 15000,
  options: {
    encrypt: process.env.DB_ENCRYPT === 'true',
    trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE === 'true'
  }
};

let dbPool;

// Function to initialize database and connect
async function initDb() {
  try {
    // Connect directly to the database
    console.log(`Connecting directly to SQL Server database [${dbConfig.database}] at ${dbConfig.server}:${dbConfig.port}...`);
    dbPool = new sql.ConnectionPool(dbConfig);
    
    try {
      await dbPool.connect();
      console.log('Connected to SQL Server database successfully.');
    } catch (connectErr) {
      const errorMsg = connectErr.message.toLowerCase();
      if (errorMsg.includes('database') && (errorMsg.includes('does not exist') || errorMsg.includes('cannot open database'))) {
        console.log(`Database [${dbConfig.database}] does not exist. Attempting to create it via master...`);
        const masterConfig = { ...dbConfig, database: 'master' };
        const tempPool = new sql.ConnectionPool(masterConfig);
        await tempPool.connect();
        await tempPool.request().query(`CREATE DATABASE [${dbConfig.database}]`);
        await tempPool.close();
        console.log(`Database [${dbConfig.database}] created successfully.`);
        
        // Retry connection
        await dbPool.connect();
        console.log('Connected to SQL Server database successfully after database creation.');
      } else {
        throw connectErr;
      }
    }

    // 3. Create table if not exists
    await dbPool.request().query(`
      IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='merchants' AND xtype='U')
      BEGIN
        CREATE TABLE merchants (
          id INT IDENTITY(1,1) PRIMARY KEY,
          full_name NVARCHAR(255) NOT NULL,
          phone_number NVARCHAR(50) NOT NULL,
          email NVARCHAR(255),
          store_name NVARCHAR(255) NOT NULL,
          governorate NVARCHAR(100) NOT NULL,
          city NVARCHAR(100) NOT NULL,
          category NVARCHAR(100) NOT NULL,
          supervisor_code NVARCHAR(50),
          agent_name NVARCHAR(255),
          latitude DECIMAL(9,6),
          longitude DECIMAL(9,6),
          store_photo NVARCHAR(MAX),
          id_photo NVARCHAR(MAX),
          created_account NVARCHAR(10) NOT NULL,
          status NVARCHAR(50) DEFAULT 'pending',
          merchant_code NVARCHAR(100),
          downloaded BIT DEFAULT 0,
          downloaded_at DATETIME,
          uploaded BIT DEFAULT 0,
          uploaded_at DATETIME,
          created_at DATETIME DEFAULT GETDATE(),
          coded_at DATETIME
        );
      END
    `);
    console.log('Table [merchants] verified/created in SQL Server.');

    // 4. Create users table if not exists
    await dbPool.request().query(`
      IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='users' AND xtype='U')
      BEGIN
        CREATE TABLE users (
          id INT IDENTITY(1,1) PRIMARY KEY,
          username NVARCHAR(100) UNIQUE NOT NULL,
          password_hash NVARCHAR(MAX) NOT NULL,
          created_at DATETIME DEFAULT GETDATE()
        );
      END
    `);
    console.log('Table [users] verified/created in SQL Server.');

    // Seed default admin if users table is empty
    const userCheck = await dbPool.request().query('SELECT COUNT(*) AS count FROM users');
    if (userCheck.recordset[0].count === 0) {
      const defaultHash = bcrypt.hashSync('YallaTagerAdmin2026', 10);
      const seedReq = dbPool.request();
      seedReq.input('username', sql.NVarChar(100), 'admin');
      seedReq.input('password_hash', sql.NVarChar(sql.MAX), defaultHash);
      await seedReq.query(`
        INSERT INTO users (username, password_hash, created_at)
        VALUES (@username, @password_hash, GETDATE())
      `);
      console.log('🎉 Default admin user seeded successfully in SQL Server.');
    }

  } catch (err) {
    console.error('❌ FATAL: SQL Server Connection Failed:', err.message);
    console.log('----------------------------------------------------------------------');
    console.log('Server cannot start without database connection.');
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
    if (!dbPool) return res.status(500).json({ error: 'Database connection is not active.' });
    const request = dbPool.request();
    request.input('username', sql.NVarChar(100), username.trim());
    const result = await request.query('SELECT * FROM users WHERE username = @username');
    const user = result.recordset[0];

    if (!user) {
      console.warn(`[AUTH] Failed login attempt (user not found): ${username}`);
      return res.status(401).json({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة.' });
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      console.warn(`[AUTH] Failed login attempt (incorrect password): ${username}`);
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
    const passwordHash = await bcrypt.hash(password, 10);



    if (!dbPool) return res.status(500).json({ error: 'Database connection is not active.' });

    // Verify uniqueness
    const checkReq = dbPool.request();
    checkReq.input('username', sql.NVarChar(100), username.trim());
    const checkRes = await checkReq.query('SELECT COUNT(*) AS count FROM users WHERE username = @username');
    if (checkRes.recordset[0].count > 0) {
      return res.status(400).json({ error: 'اسم المستخدم مسجل بالفعل.' });
    }

    const insertReq = dbPool.request();
    insertReq.input('username', sql.NVarChar(100), username.trim());
    insertReq.input('password_hash', sql.NVarChar(sql.MAX), passwordHash);
    await insertReq.query(`
      INSERT INTO users (username, password_hash, created_at)
      VALUES (@username, @password_hash, GETDATE())
    `);

    res.status(201).json({ success: true, message: 'تم إنشاء حساب المسؤول بنجاح.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'حدث خطأ في الخادم أثناء إنشاء الحساب.' });
  }
});

// 0. Fetch Client-Side Configurations (like reCAPTCHA sitekey)
app.get('/api/config', (req, res) => {
  res.json({
    recaptchaSiteKey: process.env.RECAPTCHA_SITE_KEY || '6LeIxAcTAAAAAJcZVRqyHh71UMIEGNQ_MXjiZKhI'
  });
});

// 1. Submit Form (Street Agent) with Google reCAPTCHA v2 Verification
app.post('/api/merchants', upload.fields([
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
      agent_name,
      latitude,
      longitude,
      created_account
    } = req.body;

    const captchaToken = req.body['g-recaptcha-response'];

    // Use relative paths 'uploads/...' instead of absolute '/uploads/...' for Nginx subdirectory routing safety
    const storePhotoPath = req.files['store_photo'] ? 'uploads/' + req.files['store_photo'][0].filename : null;
    const idPhotoPath = req.files['id_photo'] ? 'uploads/' + req.files['id_photo'][0].filename : null;

    // Verify Google reCAPTCHA v2 Token
    const tokenStr = Array.isArray(captchaToken) 
      ? captchaToken[0] 
      : (typeof captchaToken === 'string' ? captchaToken : '');

    if (!tokenStr || !tokenStr.trim()) {
      deleteFiles();
      return res.status(400).json({ error: 'برجاء تأكيد رمز التحقق (أنا لست برنامج روبوت) أولاً.' });
    }

    const RECAPTCHA_SECRET = process.env.RECAPTCHA_SECRET || '6LeIxAcTAAAAAGG-vFI1qkvx2h0nFEP5cGFqpGA9'; // Official Google test key
    
    console.log('--- reCAPTCHA Verification Debug ---');
    console.log('captchaToken type:', typeof captchaToken);
    console.log('captchaToken value:', captchaToken);
    console.log('tokenStr value:', tokenStr);
    console.log('RECAPTCHA_SECRET (first 5 chars):', RECAPTCHA_SECRET ? RECAPTCHA_SECRET.substring(0, 5) : 'undefined');
    console.log('RECAPTCHA_SECRET length:', RECAPTCHA_SECRET ? RECAPTCHA_SECRET.length : 0);

    try {
      const verifyRes = await fetch('https://www.google.com/recaptcha/api/siteverify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `secret=${encodeURIComponent(RECAPTCHA_SECRET.trim())}&response=${encodeURIComponent(tokenStr.trim())}`
      });
      const verifyJson = await verifyRes.json();
      console.log('reCAPTCHA Verification Response:', verifyJson);
      
      if (!verifyJson.success) {
        deleteFiles();
        return res.status(400).json({ error: 'فشل التحقق من الكابتشا. برجاء المحاولة مرة أخرى.' });
      }
    } catch (err) {
      console.error('reCAPTCHA verification error:', err);
      deleteFiles();
      return res.status(500).json({ error: 'حدث خطأ أثناء التحقق من الكابتشا.' });
    }

    if (!full_name || !phone_number || !store_name || !governorate || !city || !category || !created_account) {
      deleteFiles();
      return res.status(400).json({ error: 'Please fill all required fields.' });
    }



    if (!dbPool) {
      deleteFiles();
      return res.status(500).json({ error: 'Database connection is not active.' });
    }

    const request = dbPool.request();
    request.input('full_name', sql.NVarChar(255), full_name);
    request.input('phone_number', sql.NVarChar(50), phone_number);
    request.input('email', sql.NVarChar(255), email || null);
    request.input('store_name', sql.NVarChar(255), store_name);
    request.input('governorate', sql.NVarChar(100), governorate);
    request.input('city', sql.NVarChar(100), city);
    request.input('category', sql.NVarChar(100), category);
    request.input('supervisor_code', sql.NVarChar(50), supervisor_code || null);
    request.input('agent_name', sql.NVarChar(255), agent_name || null);
    request.input('latitude', sql.Decimal(9, 6), latitude ? parseFloat(latitude) : null);
    request.input('longitude', sql.Decimal(9, 6), longitude ? parseFloat(longitude) : null);
    request.input('store_photo', sql.NVarChar(sql.MAX), storePhotoPath);
    request.input('id_photo', sql.NVarChar(sql.MAX), idPhotoPath);
    request.input('created_account', sql.NVarChar(10), created_account);

    await request.query(`
      INSERT INTO merchants (
        full_name, phone_number, email, store_name, governorate, city, category, 
        supervisor_code, agent_name, latitude, longitude, store_photo, id_photo, 
        created_account, status, downloaded, uploaded, created_at
      ) VALUES (
        @full_name, @phone_number, @email, @store_name, @governorate, @city, @category, 
        @supervisor_code, @agent_name, @latitude, @longitude, @store_photo, @id_photo, 
        @created_account, 'pending', 0, 0, GETDATE()
      )
    `);

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



    if (!dbPool) {
      return res.status(500).json({ error: 'Database connection is not active.' });
    }

    let query = 'SELECT * FROM merchants WHERE 1=1';
    const request = dbPool.request();

    if (status) {
      query += ' AND status = @status';
      request.input('status', sql.NVarChar(50), status);
    }
    if (downloaded !== undefined) {
      query += ' AND downloaded = @downloaded';
      request.input('downloaded', sql.Bit, downloaded === 'true' || downloaded === '1' ? 1 : 0);
    }
    if (uploaded !== undefined) {
      query += ' AND uploaded = @uploaded';
      request.input('uploaded', sql.Bit, uploaded === 'true' || uploaded === '1' ? 1 : 0);
    }

    query += ' ORDER BY created_at DESC';
    const result = await request.query(query);
    res.json(result.recordset);
  } catch (err) {
    console.error('Error fetching merchants:', err);
    res.status(500).json({ error: err.message });
  }
});

// 3. Export CSV (and mark as downloaded)
app.get('/api/merchants/export/csv', requireAuth, async (req, res) => {
  try {
    let records = [];

    if (!dbPool) {
      return res.status(500).json({ error: 'Database connection is not active.' });
    }
    const result = await dbPool.request().query(`
      SELECT * FROM merchants WHERE downloaded = 0 ORDER BY created_at DESC
    `);
    records = result.recordset;

    if (records.length === 0) {
      return res.status(404).send('No new merchants to download.');
    }

    const BOM = '\uFEFF';
    let csvContent = BOM;
    const headers = [
      'ID', 'الاسم الكامل', 'رقم الهاتف', 'البريد الإلكتروني', 'اسم المتجر', 
      'المحافظة', 'المدينة', 'التخصص/الفئة', 'كود المشرف', 'اسم المندوب', 
      'خط العرض', 'خط الطول', 'تاريخ الرفع', 'هل أنشأ حساب'
    ];
    csvContent += headers.join(',') + '\n';

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
        `"${(row.agent_name || '').replace(/"/g, '""')}"`,
        row.latitude || '',
        row.longitude || '',
        row.created_at ? new Date(row.created_at).toLocaleString('en-US') : '',
        row.created_account || ''
      ];
      csvContent += csvRow.join(',') + '\n';
    });

    const ids = records.map(r => r.id).join(',');
    await dbPool.request().query(`
      UPDATE merchants 
      SET downloaded = 1, downloaded_at = GETDATE()
      WHERE id IN (${ids})
    `);

    const filename = `yalla-tager-merchants-${Date.now()}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.status(200).send(csvContent);
  } catch (err) {
    console.error('CSV Export failed:', err);
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



    if (!dbPool) {
      return res.status(500).json({ error: 'Database connection is not active.' });
    }

    const parsedIds = ids.map(id => parseInt(id)).filter(id => !isNaN(id));
    if (parsedIds.length === 0) {
      return res.status(400).json({ error: 'لم يتم تقديم أي معرفات صالحة.' });
    }
    const idsStr = parsedIds.join(',');
    await dbPool.request().query(`
      UPDATE merchants 
      SET uploaded = 1, uploaded_at = GETDATE() 
      WHERE id IN (${idsStr})
    `);

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

    let merchant;

    if (!dbPool) {
      return res.status(500).json({ error: 'Database connection is not active.' });
    }

    const getReq = dbPool.request();
    getReq.input('id', sql.Int, id);
    const mRes = await getReq.query('SELECT * FROM merchants WHERE id = @id');
    merchant = mRes.recordset[0];

    if (merchant) {
      const updateReq = dbPool.request();
      updateReq.input('id', sql.Int, id);
      updateReq.input('merchant_code', sql.NVarChar(100), merchant_code);
      await updateReq.query(`
        UPDATE merchants 
        SET status = 'coded', merchant_code = @merchant_code, coded_at = GETDATE() 
        WHERE id = @id
      `);
    }

    if (!merchant) {
      return res.status(404).json({ error: 'Merchant not found.' });
    }

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

// Handle 404
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start Express and DB Initialization
app.listen(PORT, async () => {
  console.log(`Server is running on http://localhost:${PORT}`);
  await initDb();
});
