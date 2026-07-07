document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('merchantForm');
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

  // 1. Translations dictionary
  const translations = {
    ar: {
      page_title: "يلا تاجر - طلب تسجيل وتكويد تاجر جديد",
      banner_title: "برجاء إدخال البيانات للتحويل من سعر المستهلك إلى سعر الجملة",
      banner_desc: "انضم إلى شبكة يلا تاجر وابدأ رحلتك التجارية بكل سهولة وأمان",
      personal_info_title: "البيانات الشخصية",
      full_name_label: "الاسم الكامل",
      full_name_placeholder: "مثال: أحمد محمد السيد",
      phone_number_label: "رقم الهاتف",
      phone_number_placeholder: "01xxxxxxxxx",
      email_label: "البريد الإلكتروني",
      email_placeholder: "email@example.com",
      agent_name_label: "اسم المندوب",
      agent_name_placeholder: "مثال: محمد علي",
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
      captcha_title: "رمز التحقق (الكابتشا)"
    },
    en: {
      page_title: "Yalla Tager - New Merchant Registration",
      banner_title: "Please enter data to convert from retail price to wholesale price",
      banner_desc: "Join Yalla Tager network and start your commercial journey with ease and safety",
      personal_info_title: "Personal Information",
      full_name_label: "Full Name",
      full_name_placeholder: "e.g., Ahmed Mohamed El-Sayed",
      phone_number_label: "Phone Number",
      phone_number_placeholder: "01xxxxxxxxx",
      email_label: "Email Address",
      email_placeholder: "email@example.com",
      agent_name_label: "Agent Name",
      agent_name_placeholder: "e.g., Mohamed Ali",
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
      captcha_title: "Verification Code (CAPTCHA)"
    }
  };

  // 2. Switch Language logic
  function setLanguage(lang) {
    currentLang = lang;
    document.documentElement.lang = lang;
    
    // Set text direction and alignment
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
        // If element contains raw text plus HTML (like span labels), translate text only
        if (el.children.length === 0) {
          el.textContent = translations[lang][key];
        } else {
          // Translate first child node that is a text node
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
      if (translations[lang][key]) {
        el.placeholder = translations[lang][key];
      }
    });

    // Update location status label based on actual coordinates
    updateLocationText();
  }

  function updateLocationText() {
    const lat = latitudeInput.value;
    const lng = longitudeInput.value;
    if (lat && lng) {
      if (currentLang === 'en') {
        locationStatusText.innerHTML = `<i class="bi bi-check-circle-fill text-success"></i> Location captured successfully (${parseFloat(lat).toFixed(4)}, ${parseFloat(lng).toFixed(4)})`;
      } else {
        locationStatusText.innerHTML = `<i class="bi bi-check-circle-fill text-success"></i> تم تحديد الموقع بنجاح (${parseFloat(lat).toFixed(4)}, ${parseFloat(lng).toFixed(4)})`;
      }
    } else {
      if (currentLang === 'en') {
        locationStatusText.innerHTML = '<i class="bi bi-geo-alt-fill"></i> Location not determined yet';
      } else {
        locationStatusText.innerHTML = '<i class="bi bi-geo-alt-fill"></i> لم يتم تحديد الموقع بعد';
      }
    }
  }

  // 3. Language button listeners
  langEnBtn.addEventListener('click', () => setLanguage('en'));
  langArBtn.addEventListener('click', () => setLanguage('ar'));

  // 4. Geolocation API Capture
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
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        latitudeInput.value = lat;
        longitudeInput.value = lng;
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

  // 5. Setup Image Previews
  function handleFileSelect(input, previewContainer) {
    input.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        if (file.size > 5 * 1024 * 1024) {
          const sizeMsg = currentLang === 'en' 
            ? 'File is too large! Maximum allowed is 5MB.' 
            : 'حجم الملف كبير جداً! الحد الأقصى هو 5 ميجابايت.';
          alert(sizeMsg);
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

  // 6. Form Submission with Upload Progress & Google reCAPTCHA
  form.addEventListener('submit', (e) => {
    e.preventDefault();

    if (!storePhotoInput.files[0] || !idPhotoInput.files[0]) {
      const selectMsg = currentLang === 'en' 
        ? 'Please upload all required photos first.' 
        : 'يرجى رفع جميع الصور المطلوبة أولاً.';
      alert(selectMsg);
      return;
    }

    // Retrieve Google reCAPTCHA response token
    const captchaResponse = typeof grecaptcha !== 'undefined' ? grecaptcha.getResponse() : '';
    if (!captchaResponse) {
      const captchaAlert = currentLang === 'en' 
        ? 'Please complete the "I\'m not a robot" verification first.' 
        : 'برجاء تأكيد رمز التحقق (أنا لست برنامج روبوت) أولاً.';
      alert(captchaAlert);
      return;
    }

    const formData = new FormData(form);
    formData.append('g-recaptcha-response', captchaResponse);
    
    submitBtn.disabled = true;
    submitBtn.innerHTML = currentLang === 'en' ? '<i class="bi bi-hourglass-split"></i> Uploading data...' : '<i class="bi bi-hourglass-split"></i> جاري رفع البيانات...';
    progressContainer.style.display = 'block';
    progressBar.style.width = '0%';

    const xhr = new XMLHttpRequest();
    xhr.open('POST', 'api/merchants', true);

    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) {
        const percentComplete = (e.loaded / e.total) * 100;
        progressBar.style.width = percentComplete + '%';
      }
    });

    xhr.onload = () => {
      submitBtn.disabled = false;
      submitBtn.innerHTML = currentLang === 'en' ? '<i class="bi bi-send-fill"></i> Send Registration Request' : '<i class="bi bi-send-fill"></i> إرسال طلب التسجيل';
      progressContainer.style.display = 'none';

      let response = {};
      try {
        response = JSON.parse(xhr.responseText);
      } catch (err) {
        response = { error: currentLang === 'en' ? 'Server error occurred.' : 'حدث خطأ في الخادم.' };
      }

      if (xhr.status === 201) {
        const successMsg = currentLang === 'en' 
          ? '🎉 Registration request submitted successfully!' 
          : '🎉 تم إرسال البيانات وتفاصيل التسجيل بنجاح!';
        alert(successMsg);
        form.reset();
        storePhotoPreview.style.display = 'none';
        storePhotoPreview.innerHTML = '';
        idPhotoPreview.style.display = 'none';
        idPhotoPreview.innerHTML = '';
        latitudeInput.value = '';
        longitudeInput.value = '';
        updateLocationText();
        if (typeof grecaptcha !== 'undefined') grecaptcha.reset(); // Reset recaptcha
      } else {
        alert('❌ Error: ' + (response.error || 'Unknown error.'));
        if (typeof grecaptcha !== 'undefined') grecaptcha.reset(); // Reset recaptcha
      }
    };

    xhr.onerror = () => {
      submitBtn.disabled = false;
      submitBtn.innerHTML = currentLang === 'en' ? '<i class="bi bi-send-fill"></i> Send Registration Request' : '<i class="bi bi-send-fill"></i> إرسال طلب التسجيل';
      progressContainer.style.display = 'none';
      const netMsg = currentLang === 'en' 
        ? '❌ Network connection error.' 
        : '❌ حدث خطأ في الاتصال بالخادم. يرجى التحقق من الشبكة.';
      alert(netMsg);
      if (typeof grecaptcha !== 'undefined') grecaptcha.reset(); // Reset recaptcha
    };

    xhr.send(formData);
  });
});

window.onloadCallback = async function() {
  try {
    const res = await fetch('api/config');
    if (!res.ok) throw new Error('Failed to load recaptcha config');
    const config = await res.json();
    grecaptcha.render('recaptchaWidget', {
      'sitekey': config.recaptchaSiteKey
    });
  } catch (err) {
    console.error('reCAPTCHA render error:', err);
  }
};
