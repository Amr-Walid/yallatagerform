/**
 * ==========================================================================
 * Yalla Tager - Public Form Controller
 * ==========================================================================
 * تدفّق الشاشات:
 *
 *   Screen 1 (#screenGateway)  اختيار نوع العميل
 *        ├── "عميل يلا تاجر"        → Screen 2 (استعلام بالتليفون)
 *        └── "مبيعات على الأرض"     → Screen 3 (الفورم كامل، source=field_sales)
 *
 *   Screen 2 (#screenLookup)   إدخال التليفون واستدعاء /api/lookup
 *        ├── already_coded       → عرض الكود: "متكوّد وتمام، مفيش مشكلة"
 *        ├── awaiting_coding     → عرض بقية البيانات + "واقفة عند فريق التكويد"
 *        ├── privacy_restricted  → "عذراً تعذر عرض البيانات" (حماية الخصوصية)
 *        └── not_found           → "الرقم غير مسجّل في يلا تاجر" (لا يُفتح أي فورم)
 *
 * ملاحظة أمنية: قرار الخصوصية (نافذة الـ 7 أيام) يُتخذ في السيرفر، والواجهة
 * تعرض فقط ما وصلها. لا يوجد أي منطق هنا يمكن تجاوزه من المتصفح.
 * ==========================================================================
 */

document.addEventListener('DOMContentLoaded', () => {
  /* ----------------------------------------------------------------------
   * DOM references
   * -------------------------------------------------------------------- */

  // Screens
  const screenGateway = document.getElementById('screenGateway');
  const screenLookup = document.getElementById('screenLookup');
  const screenForm = document.getElementById('screenForm');

  // Gateway
  const choiceMerchantBtn = document.getElementById('choiceMerchantBtn');
  const choiceFieldSalesBtn = document.getElementById('choiceFieldSalesBtn');

  // Lookup
  const lookupForm = document.getElementById('lookupForm');
  const lookupPhoneInput = document.getElementById('lookup_phone');
  const lookupBtn = document.getElementById('lookupBtn');
  const lookupResult = document.getElementById('lookupResult');
  const lookupBackBtn = document.getElementById('lookupBackBtn');

  // Registration form
  const form = document.getElementById('merchantForm');
  const sourceInput = document.getElementById('sourceInput');
  const formBackBtn = document.getElementById('formBackBtn');
  const flowBadge = document.getElementById('flowBadge');

  const getLocationBtn = document.getElementById('getLocationBtn');
  const locationStatusText = document.getElementById('locationStatusText');
  const latitudeInput = document.getElementById('latitude');
  const longitudeInput = document.getElementById('longitude');

  const storePhotoInput = document.getElementById('store_photo');
  const idPhotoInput = document.getElementById('id_photo');
  const storePhotoPreview = document.getElementById('storePhotoPreview');
  const idPhotoPreview = document.getElementById('idPhotoPreview');

  const progressContainer = document.getElementById('progressContainer');
  const progressBar = document.getElementById('progressBar');
  const submitBtn = document.getElementById('submitBtn');

  // Language buttons
  const langEnBtn = document.getElementById('langEnBtn');
  const langArBtn = document.getElementById('langArBtn');

  let currentLang = 'ar';

  /** آخر شاشة أتينا منها، حتى يعمل زر الرجوع في الفورم بشكل صحيح */
  let previousScreenId = 'screenGateway';

  /** آخر استجابة استعلام - للاحتفاظ بها عند تبديل اللغة */
  let lastLookupPayload = null;

  /* ----------------------------------------------------------------------
   * 1. Translations dictionary
   * -------------------------------------------------------------------- */
  const translations = {
    ar: {
      page_title: "يلا تاجر - طلب تسجيل وتكويد تاجر جديد",
      banner_title: "برجاء إدخال البيانات للتحويل من سعر المستهلك إلى سعر الجملة",
      banner_desc: "انضم إلى شبكة يلا تاجر وابدأ رحلتك التجارية بكل سهولة وأمان",

      // --- Gateway screen ---
      gateway_title: "مرحباً بك في يلا تاجر",
      gateway_desc: "اختر نوع الدخول للمتابعة",
      choice_merchant_title: "عميل يلا تاجر",
      choice_merchant_desc: "لديك حساب على يلا تاجر؟ ادخل رقم هاتفك للاستعلام عن حالة التكويد",
      choice_field_title: "مبيعات على الأرض",
      choice_field_desc: "مندوب مبيعات؟ ادخل بيانات التاجر الجديد كاملة مرة واحدة",

      // --- Lookup screen ---
      lookup_title: "الاستعلام عن حالة التكويد",
      lookup_desc: "ادخل رقم الهاتف المسجّل لدينا لعرض حالة حسابك",
      lookup_phone_label: "رقم الهاتف",
      lookup_btn: "استعلام",
      lookup_loading: "جاري الاستعلام...",
      back_btn: "رجوع",

      // --- Lookup results ---
      res_coded_title: "تمام! حسابك متكوّد بالفعل",
      res_coded_desc: "مفيش أي مشكلة، بياناتك مكتملة والتكويد تم بنجاح. ده كود التاجر الخاص بك:",
      res_code_label: "كود التاجر",
      res_awaiting_title: "بياناتك عند فريق التكويد",
      res_awaiting_desc: "بياناتك مسجّلة عندنا والدنيا واقفة عند فريق التكويد دلوقتي. هيتم إصدار الكود وإبلاغك في أقرب وقت.",
      res_awaiting_local: "طلبك مسجّل في نظام التكويد وجاري العمل عليه.",
      res_notfound_title: "الرقم غير مسجّل في يلا تاجر",
      res_notfound_desc: "يرجى مراجعة خطوات تسجيل الحساب مع العميل والتأكد من إتمامها بالكامل، ثم إعادة الاستعلام عن حالة التكويد.",
      res_notfound_hint: "تأكد أيضاً من صحة رقم الهاتف المُدخل، ولو استمرت المشكلة تواصل مع فريق الدعم.",
      res_privacy_title: "عذراً، تعذر عرض البيانات",
      res_privacy_desc: "لا يمكننا عرض بيانات هذا الحساب لحماية خصوصية التجار المسجّلين. برجاء التواصل مع فريق الدعم للاستعلام.",
      res_error_title: "حدث خطأ",

      // --- Merchant detail labels ---
      det_shop: "اسم المتجر",
      det_name: "اسم التاجر",
      det_phone: "رقم الهاتف",
      det_email: "البريد الإلكتروني",
      det_created: "تاريخ التسجيل",
      det_empty: "غير مُدخل",

      // --- Flow badges / prefill note ---
      flow_merchant: "تسجيل عميل يلا تاجر",
      flow_field_sales: "تسجيل عن طريق مندوب مبيعات",
      prefill_note: "تم تعبئة بعض البيانات تلقائياً من حسابك. برجاء مراجعتها واستكمال الباقي.",

      // --- Registration form ---
      personal_info_title: "البيانات الشخصية",
      full_name_label: "الاسم الكامل",
      full_name_placeholder: "مثال: أحمد محمد السيد",
      phone_number_label: "رقم الهاتف",
      phone_number_placeholder: "01xxxxxxxxx",
      email_label: "البريد الإلكتروني",
      email_placeholder: "email@example.com",
      store_info_title: "بيانات المتجر",
      store_name_label: "اسم المتجر",
      store_name_placeholder: "مثال: محل الأمل للبقالة",
      governorate_label: "المحافظة",
      governorate_select_default: "اختر المحافظة",
      gov_cairo: "القاهرة",
      gov_giza: "الجيزة",
      gov_alex: "الإسكندرية",
      gov_qalyubia: "القليوبية",
      gov_dakahlia: "الدقهلية",
      gov_gharbia: "الغربية",
      gov_sharqia: "الشرقية",
      gov_monufia: "المنوفية",
      gov_beheira: "البحيرة",
      gov_kafr: "كفر الشيخ",
      gov_damietta: "دمياط",
      gov_portsaid: "بورسعيد",
      gov_ismailia: "الإسماعيلية",
      gov_suez: "السويس",
      gov_fayoum: "الفيوم",
      gov_beni_suef: "بني سويف",
      gov_minya: "المنيا",
      gov_asyut: "أسيوط",
      gov_sohag: "سوهاج",
      gov_qena: "قنا",
      gov_luxor: "الأقصر",
      gov_aswan: "أسوان",
      gov_red_sea: "البحر الأحمر",
      gov_new_valley: "الوادي الجديد",
      gov_matrouh: "مطروح",
      gov_north_sinai: "شمال سيناء",
      gov_south_sinai: "جنوب سيناء",
      city_label: "المدينة",
      city_placeholder: "مثال: مدينة نصر",
      category_label: "التخصص / الفئة",
      category_select_default: "مثال: الأدوات الكهربائية",
      cat_electric: "ادوات كهربائيه",
      cat_mobiles: "موبيلات",
      cat_appliances: "اجهزه كهربائيه",
      cat_cameras: "كاميرات",
      supervisor_code_label: "كود المشرف (اختياري)",
      supervisor_code_placeholder: "اكتب كود المشرف هنا",
      location_title: "الموقع الجغرافي",
      location_not_set: "لم يتم تحديد الموقع بعد",
      get_location_btn: "تحديد موقعي الحالي",
      photos_section_title: "صور التسجيل وتأكيد الحساب",
      store_photo_label: "صورة واجهة المتجر",
      id_photo_label: "صورة بطاقة الهوية الوطنية",
      upload_btn_text: "اضغط لرفع صورة",
      upload_hint: "JPG, PNG, WEBP — حجم أقصى 5MB",
      note_title: "ملحوظة:",
      note_desc: "برجاء إنشاء حساب على الموقع للتاجر قبل طلب التكويد، بالإضافة إلى التأكد من تفعيل الحساب من خلال الإيميل الذي تم إنشاء الحساب به.",
      note_checkbox_label: "تم قراءة الملحوظة وتأكيد إنشاء وتفعيل الحساب",
      created_account_question: "هل قمت بإنشاء حساب على موقع للتاجر؟",
      yes_label: "نعم",
      no_label: "لا",
      submit_btn: "إرسال طلب التسجيل",
      footer_copy: "© 2026 يلا تاجر — جميع الحقوق محفوظة",
      footer_encryption: "🔒 بياناتك محمية ومشفرة بالكامل",

      // --- Alerts ---
      alert_photos_required: "يرجى رفع جميع الصور المطلوبة أولاً.",
      alert_file_too_large: "حجم الملف كبير جداً! الحد الأقصى هو 5 ميجابايت.",
      alert_submit_success: "🎉 تم إرسال البيانات وتفاصيل التسجيل بنجاح!",
      alert_server_error: "حدث خطأ في الخادم.",
      alert_network_error: "❌ حدث خطأ في الاتصال بالخادم. يرجى التحقق من الشبكة.",
      alert_unknown_error: "خطأ غير معروف.",
      alert_phone_required: "برجاء إدخال رقم الهاتف.",
      alert_phone_invalid: "رقم الهاتف غير صحيح. برجاء إدخال رقم مصري مكوّن من 11 رقماً يبدأ بـ 01.",
      submitting_text: "جاري رفع البيانات..."
    },

    en: {
      page_title: "Yalla Tager - New Merchant Registration",
      banner_title: "Please enter data to convert from retail price to wholesale price",
      banner_desc: "Join Yalla Tager network and start your commercial journey with ease and safety",

      // --- Gateway screen ---
      gateway_title: "Welcome to Yalla Tager",
      gateway_desc: "Choose how you would like to continue",
      choice_merchant_title: "Yalla Tager Customer",
      choice_merchant_desc: "Already have a Yalla Tager account? Enter your phone number to check your coding status",
      choice_field_title: "Field Sales Agent",
      choice_field_desc: "A sales representative? Enter the new merchant's full data in one go",

      // --- Lookup screen ---
      lookup_title: "Check Coding Status",
      lookup_desc: "Enter your registered phone number to view your account status",
      lookup_phone_label: "Phone Number",
      lookup_btn: "Check",
      lookup_loading: "Checking...",
      back_btn: "Back",

      // --- Lookup results ---
      res_coded_title: "All good! Your account is already coded",
      res_coded_desc: "No issues at all — your data is complete and coding was successful. This is your merchant code:",
      res_code_label: "Merchant Code",
      res_awaiting_title: "Your data is with the coding team",
      res_awaiting_desc: "Your data is registered with us and is currently pending with the coding team. The code will be issued and you will be notified shortly.",
      res_awaiting_local: "Your request is registered in the coding system and is being processed.",
      res_notfound_title: "This number is not registered with Yalla Tager",
      res_notfound_desc: "Please review the account registration steps with the customer and make sure they were fully completed, then check the coding status again.",
      res_notfound_hint: "Also double-check the phone number entered; if the problem persists, contact the support team.",
      res_privacy_title: "Sorry, data cannot be displayed",
      res_privacy_desc: "We cannot display this account's data in order to protect registered merchants' privacy. Please contact the support team for enquiries.",
      res_error_title: "An error occurred",

      // --- Merchant detail labels ---
      det_shop: "Store Name",
      det_name: "Merchant Name",
      det_phone: "Phone Number",
      det_email: "Email Address",
      det_created: "Registration Date",
      det_empty: "Not provided",

      // --- Flow badges / prefill note ---
      flow_merchant: "Yalla Tager customer registration",
      flow_field_sales: "Registration via sales representative",
      prefill_note: "Some fields were filled automatically from your account. Please review them and complete the rest.",

      // --- Registration form ---
      personal_info_title: "Personal Information",
      full_name_label: "Full Name",
      full_name_placeholder: "e.g., Ahmed Mohamed El-Sayed",
      phone_number_label: "Phone Number",
      phone_number_placeholder: "01xxxxxxxxx",
      email_label: "Email Address",
      email_placeholder: "email@example.com",
      store_info_title: "Store Information",
      store_name_label: "Store Name",
      store_name_placeholder: "e.g., Al-Amal Grocery Store",
      governorate_label: "Governorate",
      governorate_select_default: "Select Governorate",
      gov_cairo: "Cairo",
      gov_giza: "Giza",
      gov_alex: "Alexandria",
      gov_qalyubia: "Qalyubia",
      gov_dakahlia: "Dakahlia",
      gov_gharbia: "Gharbia",
      gov_sharqia: "Sharqia",
      gov_monufia: "Monufia",
      gov_beheira: "Beheira",
      gov_kafr: "Kafr El-Sheikh",
      gov_damietta: "Damietta",
      gov_portsaid: "Port Said",
      gov_ismailia: "Ismailia",
      gov_suez: "Suez",
      gov_fayoum: "Fayoum",
      gov_beni_suef: "Beni Suef",
      gov_minya: "Minya",
      gov_asyut: "Asyut",
      gov_sohag: "Sohag",
      gov_qena: "Qena",
      gov_luxor: "Luxor",
      gov_aswan: "Aswan",
      gov_red_sea: "Red Sea",
      gov_new_valley: "New Valley",
      gov_matrouh: "Matrouh",
      gov_north_sinai: "North Sinai",
      gov_south_sinai: "South Sinai",
      city_label: "City",
      city_placeholder: "e.g., Nasr City",
      category_label: "Specialization / Category",
      category_select_default: "e.g., Electrical Appliances",
      cat_electric: "Electrical tools",
      cat_mobiles: "Mobiles",
      cat_appliances: "Home appliances",
      cat_cameras: "Cameras",
      supervisor_code_label: "Supervisor Code (Optional)",
      supervisor_code_placeholder: "Enter supervisor code",
      location_title: "Geographic Location",
      location_not_set: "Location not determined yet",
      get_location_btn: "Determine Current Location",
      photos_section_title: "Registration Photos & Account Confirmation",
      store_photo_label: "Store Front Photo",
      id_photo_label: "National ID Photo",
      upload_btn_text: "Click to upload image",
      upload_hint: "JPG, PNG, WEBP — Max size 5MB",
      note_title: "Note:",
      note_desc: "Please create an account for the merchant on the site before requesting coding, and make sure to activate the account via the email it was created with.",
      note_checkbox_label: "Note read and account creation/activation confirmed",
      created_account_question: "Did you create an account on the merchant site?",
      yes_label: "Yes",
      no_label: "No",
      submit_btn: "Send Registration Request",
      footer_copy: "© 2026 Yalla Tager — All rights reserved",
      footer_encryption: "🔒 Your data is fully protected and encrypted",

      // --- Alerts ---
      alert_photos_required: "Please upload all required photos first.",
      alert_file_too_large: "File is too large! Maximum allowed is 5MB.",
      alert_submit_success: "🎉 Registration request submitted successfully!",
      alert_server_error: "Server error occurred.",
      alert_network_error: "❌ Network connection error. Please check your internet.",
      alert_unknown_error: "Unknown error.",
      alert_phone_required: "Please enter the phone number.",
      alert_phone_invalid: "Invalid phone number. Please enter a valid 11-digit Egyptian number starting with 01.",
      submitting_text: "Uploading data..."
    }
  };

  /** مساعد الترجمة */
  function t(key) {
    return (translations[currentLang] && translations[currentLang][key]) || key;
  }

  /** تهريب النص قبل إدخاله في innerHTML (منع XSS من بيانات السيرفيس) */
  function escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /* ----------------------------------------------------------------------
   * 2. Screen navigation
   * -------------------------------------------------------------------- */
  function showScreen(screenId, options = {}) {
    const target = document.getElementById(screenId);
    if (!target) return;

    // Remember where we came from (for the form's back button)
    if (!options.silent) {
      const active = document.querySelector('.screen.active');
      if (active && active.id !== screenId) previousScreenId = active.id;
    }

    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    target.classList.add('active');

    // Bring the new screen into view smoothly
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /**
   * تفريغ الفورم بالكامل - يُنادى عند فتح الفورم حتى لا تتسرّب قيم
   * من محاولة سابقة (مثلاً رقم استعلام قديم) إلى تسجيل جديد.
   */
  function clearFormFields() {
    form.reset();
    storePhotoPreview.style.display = 'none';
    storePhotoPreview.innerHTML = '';
    idPhotoPreview.style.display = 'none';
    idPhotoPreview.innerHTML = '';
    latitudeInput.value = '';
    longitudeInput.value = '';
    updateLocationText();
    const note = document.getElementById('prefillNote');
    if (note) note.remove();
  }

  /**
   * فتح شاشة الفورم مع تحديد مصدر التسجيل.
   * @param {'merchant'|'field_sales'} source
   * @param {object|null} prefill بيانات مبدئية اختيارية
   */
  function openForm(source, prefill = null) {
    clearFormFields();
    // يُضبط بعد reset لأن reset يرجّع الحقل المخفي لقيمته الافتراضية
    sourceInput.value = source === 'field_sales' ? 'field_sales' : 'merchant';
    updateFlowBadge();
    toggleAgentField();
    applyPrefill(prefill);
    showScreen('screenForm');
  }

  /**
   * "كود المشرف" اختياري في كل المسارات (لا يوجد حقل إلزامي للمندوب).
   * نُبقي الدالة كنقطة تحكم واحدة لو احتجنا لاحقاً تغيير سلوك الحقل حسب المسار.
   */
  function toggleAgentField() {
    const input = document.getElementById('supervisor_code');
    if (!input) return;
    input.required = false;
  }

  function updateFlowBadge() {
    if (!flowBadge) return;
    const isField = sourceInput.value === 'field_sales';
    const icon = isField ? 'bi-person-badge' : 'bi-shop';
    const label = isField ? t('flow_field_sales') : t('flow_merchant');
    flowBadge.innerHTML = `<i class="bi ${icon}"></i> ${escapeHtml(label)}`;
  }

  /** تعبئة الفورم بالبيانات المتاحة (مسار استكمال بيانات عميل يلا تاجر) */
  function applyPrefill(prefill) {
    // Remove any previous prefill note
    const oldNote = document.getElementById('prefillNote');
    if (oldNote) oldNote.remove();

    if (!prefill) return;

    const map = {
      full_name: prefill.merchantName,
      phone_number: prefill.merchantPhone || prefill.phone,
      email: prefill.merchantEmail,
      store_name: prefill.shopName
    };

    let filledAny = false;
    Object.keys(map).forEach(id => {
      const el = document.getElementById(id);
      if (el && map[id]) {
        el.value = map[id];
        filledAny = true;
      }
    });

    if (filledAny) {
      const note = document.createElement('div');
      note.className = 'prefill-note';
      note.id = 'prefillNote';
      note.setAttribute('data-i18n', 'prefill_note');
      note.innerHTML = `<i class="bi bi-info-circle-fill"></i> ${escapeHtml(t('prefill_note'))}`;
      const toolbar = document.querySelector('.form-toolbar');
      if (toolbar && toolbar.parentNode) {
        toolbar.parentNode.insertBefore(note, toolbar.nextSibling);
      }
    }
  }

  /* ----------------------------------------------------------------------
   * 3. Language switching
   * -------------------------------------------------------------------- */
  function setLanguage(lang) {
    currentLang = lang;
    document.documentElement.lang = lang;

    if (lang === 'en') {
      document.documentElement.dir = 'ltr';
      document.body.style.textAlign = 'left';
      langEnBtn.classList.add('active');
      langArBtn.classList.remove('active');
    } else {
      document.documentElement.dir = 'rtl';
      document.body.style.textAlign = 'right';
      langEnBtn.classList.remove('active');
      langArBtn.classList.add('active');
    }

    // Translate standard data-i18n elements
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      if (translations[lang][key]) {
        if (el.children.length === 0) {
          el.textContent = translations[lang][key];
        } else {
          for (let node of el.childNodes) {
            if (node.nodeType === Node.TEXT_NODE) {
              node.textContent = translations[lang][key];
              break;
            }
          }
        }
      }
    });

    // Translate input placeholders
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      const key = el.getAttribute('data-i18n-placeholder');
      if (translations[lang][key]) el.placeholder = translations[lang][key];
    });

    updateLocationText();
    updateFlowBadge();

    // Re-render the last lookup result so its dynamic text follows the language
    if (lastLookupPayload) renderLookupResult(lastLookupPayload);
  }

  function updateLocationText() {
    const lat = latitudeInput.value;
    const lng = longitudeInput.value;
    if (lat && lng) {
      const coords = `(${parseFloat(lat).toFixed(4)}, ${parseFloat(lng).toFixed(4)})`;
      locationStatusText.innerHTML = currentLang === 'en'
        ? `<i class="bi bi-check-circle-fill text-success"></i> Location captured successfully ${coords}`
        : `<i class="bi bi-check-circle-fill text-success"></i> تم تحديد الموقع بنجاح ${coords}`;
    } else {
      locationStatusText.innerHTML = currentLang === 'en'
        ? '<i class="bi bi-geo-alt-fill"></i> Location not determined yet'
        : '<i class="bi bi-geo-alt-fill"></i> لم يتم تحديد الموقع بعد';
    }
  }

  langEnBtn.addEventListener('click', () => setLanguage('en'));
  langArBtn.addEventListener('click', () => setLanguage('ar'));

  /* ----------------------------------------------------------------------
   * 4. Gateway choices
   * -------------------------------------------------------------------- */
  choiceMerchantBtn.addEventListener('click', () => {
    lookupResult.innerHTML = '';
    lastLookupPayload = null;
    showScreen('screenLookup');
    setTimeout(() => lookupPhoneInput.focus(), 250);
  });

  choiceFieldSalesBtn.addEventListener('click', () => {
    // مندوب المبيعات معندوش رقم مسبق => يدخل على الفورم مباشرة
    openForm('field_sales', null);
  });

  lookupBackBtn.addEventListener('click', () => {
    lookupResult.innerHTML = '';
    lastLookupPayload = null;
    showScreen('screenGateway');
  });

  formBackBtn.addEventListener('click', () => {
    showScreen(previousScreenId === 'screenForm' ? 'screenGateway' : previousScreenId, { silent: true });
  });

  /* ----------------------------------------------------------------------
   * 5. Lookup flow
   * -------------------------------------------------------------------- */

  /** تطبيع الرقم في المتصفح (نفس منطق السيرفر) لتحسين تجربة المستخدم */
  function normalizePhoneClient(rawPhone) {
    if (!rawPhone) return '';
    let digits = String(rawPhone).replace(/\D/g, '');
    if (digits.startsWith('00')) digits = digits.slice(2);
    if (digits.startsWith('20') && digits.length > 11) digits = digits.slice(2);
    if (digits.length === 10 && digits.startsWith('1')) digits = '0' + digits;
    return digits;
  }

  function isValidEgyptianMobile(phone) {
    return /^01[0-25]\d{8}$/.test(phone);
  }

  function setLookupLoading(isLoading) {
    lookupBtn.disabled = isLoading;
    lookupBtn.innerHTML = isLoading
      ? `<span class="btn-spinner"></span> &nbsp;${escapeHtml(t('lookup_loading'))}`
      : `<i class="bi bi-search"></i> &nbsp;<span data-i18n="lookup_btn">${escapeHtml(t('lookup_btn'))}</span>`;
  }

  /** بناء صفوف تفاصيل التاجر */
  function buildDetailRows(merchant) {
    if (!merchant) return '';

    const rows = [
      { label: t('det_shop'), value: merchant.shopName, ltr: false },
      { label: t('det_name'), value: merchant.merchantName, ltr: false },
      { label: t('det_phone'), value: merchant.merchantPhone, ltr: true },
      { label: t('det_email'), value: merchant.merchantEmail, ltr: true },
      { label: t('det_created'), value: formatDate(merchant.creationDate), ltr: true }
    ];

    return `<div class="merchant-details">${rows.map(r => `
        <div class="detail-row">
          <span class="detail-label">${escapeHtml(r.label)}</span>
          <span class="detail-value${r.ltr ? ' is-ltr' : ''}">${
            r.value ? escapeHtml(r.value) : `<em>${escapeHtml(t('det_empty'))}</em>`
          }</span>
        </div>`).join('')}</div>`;
  }

  function formatDate(value) {
    if (!value) return '';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    const locale = currentLang === 'en' ? 'en-GB' : 'ar-EG';
    try {
      return d.toLocaleDateString(locale, { year: 'numeric', month: 'long', day: 'numeric' });
    } catch (err) {
      return d.toISOString().slice(0, 10);
    }
  }

  /**
   * عرض نتيجة الاستعلام بحسب الحالة القادمة من السيرفر.
   * الحالات: already_coded | awaiting_coding | privacy_restricted | not_found | error
   */
  function renderLookupResult(payload) {
    lastLookupPayload = payload;

    // --- حالة الخطأ ---
    if (payload.status === 'error') {
      lookupResult.innerHTML = `
        <div class="result-box is-danger">
          <div class="result-title"><i class="bi bi-x-octagon-fill"></i> ${escapeHtml(t('res_error_title'))}</div>
          <div class="result-desc">${escapeHtml(payload.message || t('alert_server_error'))}</div>
        </div>`;
      return;
    }

    // --- 1) متكوّد بالفعل: عرض الكود ---
    if (payload.status === 'already_coded') {
      lookupResult.innerHTML = `
        <div class="result-box is-success">
          <div class="result-title"><i class="bi bi-patch-check-fill"></i> ${escapeHtml(t('res_coded_title'))}</div>
          <div class="result-desc">${escapeHtml(t('res_coded_desc'))}</div>
          <div class="merchant-code-display">
            <span class="code-label">${escapeHtml(t('res_code_label'))}</span>
            <span class="code-value">${escapeHtml(payload.merchantCode)}</span>
          </div>
          ${buildDetailRows(payload.merchant)}
        </div>`;
      return;
    }

    // --- 2) بدون كود: عرض بقية البيانات + الدنيا واقفة عند فريق التكويد ---
    if (payload.status === 'awaiting_coding') {
      const localLine = payload.localRequestExists
        ? `<div class="result-desc"><i class="bi bi-check2-circle"></i> ${escapeHtml(t('res_awaiting_local'))}</div>`
        : '';
      lookupResult.innerHTML = `
        <div class="result-box is-warning">
          <div class="result-title"><i class="bi bi-hourglass-split"></i> ${escapeHtml(t('res_awaiting_title'))}</div>
          <div class="result-desc">${escapeHtml(t('res_awaiting_desc'))}</div>
          ${localLine}
          ${buildDetailRows(payload.merchant)}
        </div>`;
      return;
    }

    // --- 3) قديم أكثر من النافذة المسموحة: لا نعرض أي بيانات ---
    if (payload.status === 'privacy_restricted') {
      lookupResult.innerHTML = `
        <div class="result-box is-danger">
          <div class="result-title"><i class="bi bi-shield-lock-fill"></i> ${escapeHtml(t('res_privacy_title'))}</div>
          <div class="result-desc">${escapeHtml(t('res_privacy_desc'))}</div>
        </div>`;
      return;
    }

    // --- 4) غير موجود: الرقم غير مسجّل في يلا تاجر ---
    // ملاحظة: لا نفتح فورم إدخال بيانات هنا. الاستعلام مخصص للتجار
    // المسجّلين بالفعل، ومن ليس له حساب يُوجَّه لإنشاء حساب أولاً.
    if (payload.status === 'not_found') {
      lookupResult.innerHTML = `
        <div class="result-box is-warning">
          <div class="result-title"><i class="bi bi-person-x-fill"></i> ${escapeHtml(t('res_notfound_title'))}</div>
          <div class="result-desc">${escapeHtml(t('res_notfound_desc'))}</div>
          <div class="result-hint">${escapeHtml(t('res_notfound_hint'))}</div>
        </div>`;
      return;
    }

    // Fallback for an unexpected status
    lookupResult.innerHTML = `
      <div class="result-box is-info">
        <div class="result-desc">${escapeHtml(t('alert_server_error'))}</div>
      </div>`;
  }

  lookupForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const raw = lookupPhoneInput.value.trim();
    if (!raw) {
      renderLookupResult({ status: 'error', message: t('alert_phone_required') });
      return;
    }

    const phone = normalizePhoneClient(raw);
    if (!isValidEgyptianMobile(phone)) {
      renderLookupResult({ status: 'error', message: t('alert_phone_invalid') });
      return;
    }

    setLookupLoading(true);
    lookupResult.innerHTML = '';
    lastLookupPayload = null;

    try {
      const res = await fetch(`api/lookup?phone=${encodeURIComponent(phone)}`, {
        headers: { Accept: 'application/json' }
      });

      let data = {};
      try {
        data = await res.json();
      } catch (err) {
        data = {};
      }

      if (!res.ok) {
        renderLookupResult({
          status: 'error',
          message: data.error || t('alert_server_error')
        });
        return;
      }

      renderLookupResult(data);
    } catch (err) {
      console.error('Lookup failed:', err);
      renderLookupResult({ status: 'error', message: t('alert_network_error') });
    } finally {
      setLookupLoading(false);
    }
  });

  /* ----------------------------------------------------------------------
   * 6. Geolocation capture
   * -------------------------------------------------------------------- */
  getLocationBtn.addEventListener('click', () => {
    if (!navigator.geolocation) {
      locationStatusText.innerHTML = currentLang === 'en'
        ? '<i class="bi bi-exclamation-octagon-fill text-danger"></i> Sorry, geolocation is not supported by your browser.'
        : '<i class="bi bi-exclamation-octagon-fill text-danger"></i> عذراً، ميزة تحديد الموقع غير مدعومة في متصفحك.';
      return;
    }

    locationStatusText.innerHTML = currentLang === 'en'
      ? '<i class="bi bi-hourglass-split"></i> Capturing your current location...'
      : '<i class="bi bi-hourglass-split"></i> جاري تحديد موقعك الجغرافي...';
    getLocationBtn.disabled = true;

    navigator.geolocation.getCurrentPosition(
      (position) => {
        latitudeInput.value = position.coords.latitude;
        longitudeInput.value = position.coords.longitude;
        updateLocationText();
        getLocationBtn.disabled = false;
      },
      (error) => {
        console.error('Geolocation error:', error);
        let errorMsg = currentLang === 'en'
          ? '<i class="bi bi-exclamation-octagon-fill text-danger"></i> Failed to capture location. Enable GPS and location access.'
          : '<i class="bi bi-exclamation-octagon-fill text-danger"></i> فشل تحديد الموقع. تأكد من تفعيل الـ GPS وصلاحية الموقع.';
        if (error.code === error.PERMISSION_DENIED) {
          errorMsg = currentLang === 'en'
            ? '<i class="bi bi-exclamation-octagon-fill text-danger"></i> Location access denied. Please enable it in browser settings.'
            : '<i class="bi bi-exclamation-octagon-fill text-danger"></i> تم رفض صلاحية الوصول للموقع. يرجى تفعيلها من إعدادات المتصفح.';
        }
        locationStatusText.innerHTML = errorMsg;
        getLocationBtn.disabled = false;
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  });

  /* ----------------------------------------------------------------------
   * 7. Image previews
   * -------------------------------------------------------------------- */
  function handleFileSelect(input, previewContainer) {
    input.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        if (file.size > 5 * 1024 * 1024) {
          alert(t('alert_file_too_large'));
          input.value = '';
          previewContainer.style.display = 'none';
          return;
        }

        const reader = new FileReader();
        reader.onload = (event) => {
          previewContainer.innerHTML = `<img src="${event.target.result}" alt="Preview">`;
          previewContainer.style.display = 'block';
        };
        reader.readAsDataURL(file);
      } else {
        previewContainer.style.display = 'none';
        previewContainer.innerHTML = '';
      }
    });
  }

  handleFileSelect(storePhotoInput, storePhotoPreview);
  handleFileSelect(idPhotoInput, idPhotoPreview);

  /* ----------------------------------------------------------------------
   * 8. Form submission (no CAPTCHA - rate limited server-side)
   * -------------------------------------------------------------------- */
  function resetSubmitBtn() {
    submitBtn.disabled = false;
    submitBtn.innerHTML = `<i class="bi bi-send-fill"></i> &nbsp;<span data-i18n="submit_btn">${escapeHtml(t('submit_btn'))}</span>`;
    progressContainer.style.display = 'none';
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();

    if (!storePhotoInput.files[0] || !idPhotoInput.files[0]) {
      alert(t('alert_photos_required'));
      return;
    }

    // FormData يحمل بالفعل الحقل المخفي source
    const formData = new FormData(form);

    submitBtn.disabled = true;
    submitBtn.innerHTML = `<i class="bi bi-hourglass-split"></i> ${escapeHtml(t('submitting_text'))}`;
    progressContainer.style.display = 'block';
    progressBar.style.width = '0%';

    const xhr = new XMLHttpRequest();
    xhr.open('POST', 'api/merchants', true);

    xhr.upload.addEventListener('progress', (ev) => {
      if (ev.lengthComputable) {
        progressBar.style.width = ((ev.loaded / ev.total) * 100) + '%';
      }
    });

    xhr.onload = () => {
      resetSubmitBtn();

      let response = {};
      try {
        response = JSON.parse(xhr.responseText);
      } catch (err) {
        response = { error: t('alert_server_error') };
      }

      if (xhr.status === 201) {
        alert(t('alert_submit_success'));

        clearFormFields();
        sourceInput.value = 'merchant';
        toggleAgentField();

        // العودة لشاشة البداية بعد نجاح الإرسال
        lookupResult.innerHTML = '';
        lastLookupPayload = null;
        if (lookupPhoneInput) lookupPhoneInput.value = '';
        showScreen('screenGateway', { silent: true });
        previousScreenId = 'screenGateway';
      } else {
        alert('❌ ' + (response.error || t('alert_unknown_error')));
      }
    };

    xhr.onerror = () => {
      resetSubmitBtn();
      alert(t('alert_network_error'));
    };

    xhr.send(formData);
  });

  /* ----------------------------------------------------------------------
   * 9. Initial render
   * -------------------------------------------------------------------- */
  updateFlowBadge();
  updateLocationText();
  toggleAgentField();
});
