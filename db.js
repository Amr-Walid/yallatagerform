/**
 * ==========================================================================
 * Yalla Tager - Data Access Layer (طبقة الوصول للبيانات)
 * ==========================================================================
 * تدعم هذه الطبقة وضعين للتشغيل:
 *
 *  1) mssql  : الوضع الأساسي (SQL Server) المستخدم في بيئة الإنتاج.
 *  2) file   : وضع احتياطي محلي يخزن البيانات في ملفات JSON، ويُستخدم
 *              تلقائياً عند تعذر الاتصال بـ SQL Server (بيئة التطوير/التجربة)
 *              حتى يظل الفورم ولوحة التحكم قابلين للتشغيل والاختبار.
 *
 * للتحكم في السلوك عبر ملف .env:
 *   DB_DRIVER=auto | mssql | file     (الافتراضي: auto)
 * ==========================================================================
 */

const path = require('path');
const fs = require('fs');
const sql = require('mssql');
const bcrypt = require('bcryptjs');

const MERCHANTS_FILE = path.join(__dirname, 'fallback_db.json');
const USERS_FILE = path.join(__dirname, 'fallback_users.json');

const DEFAULT_ADMIN_USERNAME = process.env.DEFAULT_ADMIN_USERNAME || 'admin';
const DEFAULT_ADMIN_PASSWORD = process.env.DEFAULT_ADMIN_PASSWORD || 'YallaTagerAdmin2026';

/* -------------------------------------------------------------------------- */
/* Shared helpers                                                             */
/* -------------------------------------------------------------------------- */

const MERCHANT_DEFAULTS = {
  full_name: null,
  phone_number: null,
  email: null,
  store_name: null,
  governorate: null,
  city: null,
  category: null,
  supervisor_code: null,
  agent_name: null,
  latitude: null,
  longitude: null,
  store_photo: null,
  id_photo: null,
  created_account: null,
  /** 'merchant' (self-completed) | 'field_sales' (registered by a field agent) */
  source: 'merchant'
};

function normalizeIds(ids) {
  return (Array.isArray(ids) ? ids : [ids])
    .map((id) => parseInt(id, 10))
    .filter((id) => Number.isInteger(id));
}

function toBoolFilter(value) {
  return value === true || value === 'true' || value === '1' || value === 1 ? 1 : 0;
}

/* -------------------------------------------------------------------------- */
/* Driver: SQL Server (mssql)                                                 */
/* -------------------------------------------------------------------------- */

class MssqlDriver {
  constructor(config) {
    this.name = 'mssql';
    this.config = config;
    this.pool = null;
  }

  async connect() {
    const { config } = this;
    console.log(
      `[DB] Connecting to SQL Server [${config.database}] at ${config.server}:${config.port} ...`
    );
    this.pool = new sql.ConnectionPool(config);

    try {
      await this.pool.connect();
    } catch (connectErr) {
      const msg = (connectErr.message || '').toLowerCase();
      const dbMissing =
        msg.includes('database') &&
        (msg.includes('does not exist') || msg.includes('cannot open database'));

      if (!dbMissing) throw connectErr;

      console.log(`[DB] Database [${config.database}] not found. Creating it via [master] ...`);
      const masterPool = new sql.ConnectionPool({ ...config, database: 'master' });
      await masterPool.connect();
      await masterPool.request().query(`CREATE DATABASE [${config.database}]`);
      await masterPool.close();
      await this.pool.connect();
    }

    console.log('[DB] Connected to SQL Server successfully.');
    await this.migrate();
    await this.seedDefaultAdmin();
  }

  async migrate() {
    await this.pool.request().query(`
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
          source NVARCHAR(20) DEFAULT 'merchant',
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
    // Additive migration for databases created before the two entry flows
    // existed, so upgrading an existing deployment needs no manual step.
    await this.pool.request().query(`
      IF NOT EXISTS (
        SELECT * FROM sys.columns
        WHERE object_id = OBJECT_ID('merchants') AND name = 'source'
      )
      BEGIN
        ALTER TABLE merchants ADD source NVARCHAR(20) DEFAULT 'merchant';
      END
    `);
    console.log('[DB] Table [merchants] verified.');

    await this.pool.request().query(`
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
    console.log('[DB] Table [users] verified.');
  }

  async seedDefaultAdmin() {
    const count = await this.countUsers();
    if (count > 0) return;
    await this.createUser({
      username: DEFAULT_ADMIN_USERNAME,
      password_hash: bcrypt.hashSync(DEFAULT_ADMIN_PASSWORD, 10)
    });
    console.log(`[DB] Default admin user "${DEFAULT_ADMIN_USERNAME}" seeded.`);
  }

  /* ----- users ----- */

  async countUsers() {
    const res = await this.pool.request().query('SELECT COUNT(*) AS count FROM users');
    return res.recordset[0].count;
  }

  async findUserByUsername(username) {
    const req = this.pool.request();
    req.input('username', sql.NVarChar(100), username);
    const res = await req.query('SELECT * FROM users WHERE username = @username');
    return res.recordset[0] || null;
  }

  async createUser({ username, password_hash }) {
    const req = this.pool.request();
    req.input('username', sql.NVarChar(100), username);
    req.input('password_hash', sql.NVarChar(sql.MAX), password_hash);
    await req.query(`
      INSERT INTO users (username, password_hash, created_at)
      VALUES (@username, @password_hash, GETDATE())
    `);
  }

  /* ----- merchants ----- */

  async insertMerchant(data) {
    const row = { ...MERCHANT_DEFAULTS, ...data };
    const req = this.pool.request();
    req.input('full_name', sql.NVarChar(255), row.full_name);
    req.input('phone_number', sql.NVarChar(50), row.phone_number);
    req.input('email', sql.NVarChar(255), row.email);
    req.input('store_name', sql.NVarChar(255), row.store_name);
    req.input('governorate', sql.NVarChar(100), row.governorate);
    req.input('city', sql.NVarChar(100), row.city);
    req.input('category', sql.NVarChar(100), row.category);
    req.input('supervisor_code', sql.NVarChar(50), row.supervisor_code);
    req.input('agent_name', sql.NVarChar(255), row.agent_name);
    req.input('latitude', sql.Decimal(9, 6), row.latitude);
    req.input('longitude', sql.Decimal(9, 6), row.longitude);
    req.input('store_photo', sql.NVarChar(sql.MAX), row.store_photo);
    req.input('id_photo', sql.NVarChar(sql.MAX), row.id_photo);
    req.input('created_account', sql.NVarChar(10), row.created_account);
    req.input('source', sql.NVarChar(20), row.source || 'merchant');

    const res = await req.query(`
      INSERT INTO merchants (
        full_name, phone_number, email, store_name, governorate, city, category,
        supervisor_code, agent_name, latitude, longitude, store_photo, id_photo,
        created_account, source, status, downloaded, uploaded, created_at
      ) VALUES (
        @full_name, @phone_number, @email, @store_name, @governorate, @city, @category,
        @supervisor_code, @agent_name, @latitude, @longitude, @store_photo, @id_photo,
        @created_account, @source, 'pending', 0, 0, GETDATE()
      );
      SELECT SCOPE_IDENTITY() AS id;
    `);
    return { id: res.recordset && res.recordset[0] ? Number(res.recordset[0].id) : null };
  }

  async listMerchants(filters = {}) {
    let query = 'SELECT * FROM merchants WHERE 1=1';
    const req = this.pool.request();

    if (filters.status) {
      query += ' AND status = @status';
      req.input('status', sql.NVarChar(50), filters.status);
    }
    if (filters.downloaded !== undefined) {
      query += ' AND downloaded = @downloaded';
      req.input('downloaded', sql.Bit, toBoolFilter(filters.downloaded));
    }
    if (filters.uploaded !== undefined) {
      query += ' AND uploaded = @uploaded';
      req.input('uploaded', sql.Bit, toBoolFilter(filters.uploaded));
    }

    query += ' ORDER BY created_at DESC';
    const res = await req.query(query);
    return res.recordset;
  }

  async getUndownloadedMerchants() {
    const res = await this.pool
      .request()
      .query('SELECT * FROM merchants WHERE downloaded = 0 ORDER BY created_at DESC');
    return res.recordset;
  }

  /**
   * Fetch specific merchants by id, regardless of their downloaded flag.
   * Used by the "re-download selected" export so already-exported rows stay
   * reachable instead of being locked away by the downloaded flag.
   */
  async getMerchantsByIds(ids) {
    const parsed = normalizeIds(ids);
    if (parsed.length === 0) return [];
    const res = await this.pool
      .request()
      .query(`SELECT * FROM merchants WHERE id IN (${parsed.join(',')}) ORDER BY created_at DESC`);
    return res.recordset;
  }

  async markDownloaded(ids) {
    const parsed = normalizeIds(ids);
    if (parsed.length === 0) return 0;
    await this.pool.request().query(`
      UPDATE merchants SET downloaded = 1, downloaded_at = GETDATE()
      WHERE id IN (${parsed.join(',')})
    `);
    return parsed.length;
  }

  /** Clear the downloaded flag so the rows count as "new" again. */
  async resetDownloaded(ids) {
    const parsed = normalizeIds(ids);
    if (parsed.length === 0) return 0;
    await this.pool.request().query(`
      UPDATE merchants SET downloaded = 0, downloaded_at = NULL
      WHERE id IN (${parsed.join(',')})
    `);
    return parsed.length;
  }

  async markUploaded(ids) {
    const parsed = normalizeIds(ids);
    if (parsed.length === 0) return 0;
    await this.pool.request().query(`
      UPDATE merchants SET uploaded = 1, uploaded_at = GETDATE()
      WHERE id IN (${parsed.join(',')})
    `);
    return parsed.length;
  }

  async getMerchantById(id) {
    const req = this.pool.request();
    req.input('id', sql.Int, parseInt(id, 10));
    const res = await req.query('SELECT * FROM merchants WHERE id = @id');
    return res.recordset[0] || null;
  }

  /** أحدث طلب مسجّل بنفس رقم الهاتف (للتحقق من التكرار) */
  async findMerchantByPhone(phone) {
    const req = this.pool.request();
    req.input('phone_number', sql.NVarChar(50), phone);
    const res = await req.query(`
      SELECT TOP 1 * FROM merchants
      WHERE phone_number = @phone_number
      ORDER BY created_at DESC
    `);
    return res.recordset[0] || null;
  }

  async setMerchantCode(id, merchantCode) {
    const req = this.pool.request();
    req.input('id', sql.Int, parseInt(id, 10));
    req.input('merchant_code', sql.NVarChar(100), merchantCode);
    await req.query(`
      UPDATE merchants
      SET status = 'coded', merchant_code = @merchant_code, coded_at = GETDATE()
      WHERE id = @id
    `);
  }
}

/* -------------------------------------------------------------------------- */
/* Driver: Local JSON files (fallback for development / demo)                  */
/* -------------------------------------------------------------------------- */

class FileDriver {
  constructor() {
    this.name = 'file';
    this.merchants = [];
    this.users = [];
  }

  async connect() {
    this.merchants = this._read(MERCHANTS_FILE);
    this.users = this._read(USERS_FILE);
    await this.seedDefaultAdmin();
    console.log(
      `[DB] Local file store ready (${this.merchants.length} merchants, ${this.users.length} users).`
    );
    console.log(`[DB] Data files: ${MERCHANTS_FILE} , ${USERS_FILE}`);
  }

  _read(file) {
    try {
      if (!fs.existsSync(file)) return [];
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      console.warn(`[DB] Could not read ${path.basename(file)}: ${err.message}. Starting empty.`);
      return [];
    }
  }

  _write(file, data) {
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
  }

  _saveMerchants() {
    this._write(MERCHANTS_FILE, this.merchants);
  }

  _saveUsers() {
    this._write(USERS_FILE, this.users);
  }

  _nextId(collection) {
    return collection.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1;
  }

  async seedDefaultAdmin() {
    if (this.users.length > 0) return;
    await this.createUser({
      username: DEFAULT_ADMIN_USERNAME,
      password_hash: bcrypt.hashSync(DEFAULT_ADMIN_PASSWORD, 10)
    });
    console.log(`[DB] Default admin user "${DEFAULT_ADMIN_USERNAME}" seeded (local file store).`);
  }

  /* ----- users ----- */

  async countUsers() {
    return this.users.length;
  }

  async findUserByUsername(username) {
    return this.users.find((u) => u.username === username) || null;
  }

  async createUser({ username, password_hash }) {
    const user = {
      id: this._nextId(this.users),
      username,
      password_hash,
      created_at: new Date().toISOString()
    };
    this.users.push(user);
    this._saveUsers();
    return user;
  }

  /* ----- merchants ----- */

  async insertMerchant(data) {
    const row = {
      id: this._nextId(this.merchants),
      ...MERCHANT_DEFAULTS,
      ...data,
      status: 'pending',
      merchant_code: null,
      downloaded: 0,
      downloaded_at: null,
      uploaded: 0,
      uploaded_at: null,
      created_at: new Date().toISOString(),
      coded_at: null
    };
    this.merchants.push(row);
    this._saveMerchants();
    return { id: row.id };
  }

  async listMerchants(filters = {}) {
    let rows = [...this.merchants];

    if (filters.status) {
      rows = rows.filter((r) => r.status === filters.status);
    }
    if (filters.downloaded !== undefined) {
      const want = toBoolFilter(filters.downloaded);
      rows = rows.filter((r) => (r.downloaded ? 1 : 0) === want);
    }
    if (filters.uploaded !== undefined) {
      const want = toBoolFilter(filters.uploaded);
      rows = rows.filter((r) => (r.uploaded ? 1 : 0) === want);
    }

    return rows.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }

  async getUndownloadedMerchants() {
    return this.listMerchants({ downloaded: '0' });
  }

  /** See MssqlDriver.getMerchantsByIds */
  async getMerchantsByIds(ids) {
    const parsed = normalizeIds(ids);
    if (parsed.length === 0) return [];
    return this.merchants
      .filter((r) => parsed.includes(Number(r.id)))
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }

  async markDownloaded(ids) {
    const parsed = normalizeIds(ids);
    let count = 0;
    this.merchants.forEach((row) => {
      if (parsed.includes(Number(row.id))) {
        row.downloaded = 1;
        row.downloaded_at = new Date().toISOString();
        count += 1;
      }
    });
    if (count) this._saveMerchants();
    return count;
  }

  /** See MssqlDriver.resetDownloaded */
  async resetDownloaded(ids) {
    const parsed = normalizeIds(ids);
    let count = 0;
    this.merchants.forEach((row) => {
      if (parsed.includes(Number(row.id))) {
        row.downloaded = 0;
        row.downloaded_at = null;
        count += 1;
      }
    });
    if (count) this._saveMerchants();
    return count;
  }

  async markUploaded(ids) {
    const parsed = normalizeIds(ids);
    let count = 0;
    this.merchants.forEach((row) => {
      if (parsed.includes(Number(row.id))) {
        row.uploaded = 1;
        row.uploaded_at = new Date().toISOString();
        count += 1;
      }
    });
    if (count) this._saveMerchants();
    return count;
  }

  async getMerchantById(id) {
    const numericId = parseInt(id, 10);
    return this.merchants.find((r) => Number(r.id) === numericId) || null;
  }

  /** أحدث طلب مسجّل بنفس رقم الهاتف (للتحقق من التكرار) */
  async findMerchantByPhone(phone) {
    const matches = this.merchants
      .filter((r) => r.phone_number === phone)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    return matches[0] || null;
  }

  async setMerchantCode(id, merchantCode) {
    const merchant = await this.getMerchantById(id);
    if (!merchant) return;
    merchant.status = 'coded';
    merchant.merchant_code = merchantCode;
    merchant.coded_at = new Date().toISOString();
    this._saveMerchants();
  }
}

/* -------------------------------------------------------------------------- */
/* Public API                                                                 */
/* -------------------------------------------------------------------------- */

let driver = null;

function buildMssqlConfig() {
  return {
    server: process.env.DB_SERVER || 'localhost',
    port: parseInt(process.env.DB_PORT, 10) || 1433,
    database: process.env.DB_DATABASE || 'YallaTagerForm',
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    connectionTimeout: parseInt(process.env.DB_CONNECTION_TIMEOUT, 10) || 15000,
    options: {
      encrypt: process.env.DB_ENCRYPT === 'true',
      trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE === 'true'
    }
  };
}

/**
 * تهيئة قاعدة البيانات حسب DB_DRIVER:
 *  - mssql : يفشل التشغيل إن لم يتم الاتصال (مناسب للإنتاج)
 *  - file  : يستخدم ملفات JSON مباشرة
 *  - auto  : يحاول SQL Server ثم يرجع للملفات المحلية (افتراضي)
 */
async function init() {
  const mode = (process.env.DB_DRIVER || 'auto').toLowerCase();

  if (mode === 'file') {
    driver = new FileDriver();
    await driver.connect();
    return driver;
  }

  try {
    driver = new MssqlDriver(buildMssqlConfig());
    await driver.connect();
    return driver;
  } catch (err) {
    console.error('[DB] SQL Server connection failed:', err.message);

    if (mode === 'mssql') {
      console.error('[DB] DB_DRIVER=mssql — the server cannot start without SQL Server.');
      throw err;
    }

    console.warn('[DB] Falling back to the local JSON file store (DB_DRIVER=auto).');
    console.warn('[DB] Set DB_DRIVER=mssql in .env to enforce SQL Server only.');
    driver = new FileDriver();
    await driver.connect();
    return driver;
  }
}

function getDriver() {
  if (!driver) throw new Error('Database is not initialized yet. Call db.init() first.');
  return driver;
}

module.exports = {
  init,
  getDriver,
  get mode() {
    return driver ? driver.name : null;
  },
  isReady: () => Boolean(driver),

  // users
  countUsers: (...args) => getDriver().countUsers(...args),
  findUserByUsername: (...args) => getDriver().findUserByUsername(...args),
  createUser: (...args) => getDriver().createUser(...args),

  // merchants
  insertMerchant: (...args) => getDriver().insertMerchant(...args),
  listMerchants: (...args) => getDriver().listMerchants(...args),
  getUndownloadedMerchants: (...args) => getDriver().getUndownloadedMerchants(...args),
  getMerchantsByIds: (...args) => getDriver().getMerchantsByIds(...args),
  markDownloaded: (...args) => getDriver().markDownloaded(...args),
  resetDownloaded: (...args) => getDriver().resetDownloaded(...args),
  markUploaded: (...args) => getDriver().markUploaded(...args),
  getMerchantById: (...args) => getDriver().getMerchantById(...args),
  findMerchantByPhone: (...args) => getDriver().findMerchantByPhone(...args),
  setMerchantCode: (...args) => getDriver().setMerchantCode(...args)
};
