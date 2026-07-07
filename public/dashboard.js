document.addEventListener('DOMContentLoaded', () => {
  // Helper to escape HTML characters (Prevents Stored XSS)
  function escapeHtml(unsafe) {
    if (unsafe === null || unsafe === undefined) return '';
    return unsafe
      .toString()
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  let allMerchants = [];

  const tableBody = document.getElementById('tableBody');
  const selectAllCheckbox = document.getElementById('selectAllCheckbox');
  
  // Stats elements
  const statTotal = document.getElementById('statTotal');
  const statPending = document.getElementById('statPending');
  const statCoded = document.getElementById('statCoded');
  const statNotDownloaded = document.getElementById('statNotDownloaded');

  // Filter elements
  const filterStatus = document.getElementById('filterStatus');
  const filterDownloaded = document.getElementById('filterDownloaded');
  const filterUploaded = document.getElementById('filterUploaded');
  const searchBar = document.getElementById('searchBar');

  // Action buttons
  const exportCsvBtn = document.getElementById('exportCsvBtn');
  const markUploadedBtn = document.getElementById('markUploadedBtn');

  // Image Modal elements
  const imageModal = document.getElementById('imageModal');
  const modalImg = document.getElementById('modalImg');
  const modalClose = document.getElementById('modalClose');

  // Coding Modal elements
  const codingModal = document.getElementById('codingModal');
  const closeCodingModal = document.getElementById('closeCodingModal');
  const cancelCodingBtn = document.getElementById('cancelCodingBtn');
  const saveCodingBtn = document.getElementById('saveCodingBtn');
  const codingMerchantId = document.getElementById('codingMerchantId');
  const codingMerchantCode = document.getElementById('codingMerchantCode');
  const codingModalTitle = document.getElementById('codingModalTitle');

  // Load all merchants
  async function loadData() {
    try {
      const response = await fetch('api/merchants');
      if (response.status === 401) {
        window.location.replace('/login.html');
        return;
      }
      if (!response.ok) {
        throw new Error('Failed to fetch data');
      }
      allMerchants = await response.json();
      
      calculateStats();
      renderTable();
    } catch (err) {
      console.error(err);
      tableBody.innerHTML = `
        <tr>
          <td colspan="8" style="text-align: center; color: red; padding: 20px; font-weight: bold;">
            ❌ فشل تحميل البيانات: ${err.message}
          </td>
        </tr>
      `;
    }
  }

  // Calculate and display statistics
  function calculateStats() {
    const total = allMerchants.length;
    const pending = allMerchants.filter(m => m.status === 'pending').length;
    const coded = allMerchants.filter(m => m.status === 'coded').length;
    const notDownloaded = allMerchants.filter(m => !m.downloaded).length;

    statTotal.textContent = total;
    statPending.textContent = pending;
    statCoded.textContent = coded;
    statNotDownloaded.textContent = notDownloaded;
  }

  // Render Table rows based on filters and search
  function renderTable() {
    const statusVal = filterStatus.value;
    const downloadedVal = filterDownloaded.value;
    const uploadedVal = filterUploaded.value;
    const searchVal = searchBar.value.trim().toLowerCase();

    // Filter merchants client-side (Filters + Instant Search)
    let filtered = allMerchants.filter(m => {
      let match = true;
      
      // Apply select filters
      if (statusVal && m.status !== statusVal) match = false;
      if (downloadedVal !== '') {
        const isDownloaded = m.downloaded ? '1' : '0';
        if (isDownloaded !== downloadedVal) match = false;
      }
      if (uploadedVal !== '') {
        const isUploaded = m.uploaded ? '1' : '0';
        if (isUploaded !== uploadedVal) match = false;
      }

      // Apply search bar filter
      if (searchVal) {
        const name = (m.full_name || '').toLowerCase();
        const phone = (m.phone_number || '').toLowerCase();
        const email = (m.email || '').toLowerCase();
        const store = (m.store_name || '').toLowerCase();
        
        if (!name.includes(searchVal) && 
            !phone.includes(searchVal) && 
            !email.includes(searchVal) && 
            !store.includes(searchVal)) {
          match = false;
        }
      }

      return match;
    });

    if (filtered.length === 0) {
      tableBody.innerHTML = `
        <tr>
          <td colspan="8" style="text-align: center; padding: 30px; color: var(--text-muted);">
            📭 لا توجد بيانات مطابقة للبحث أو الفلاتر المحددة.
          </td>
        </tr>
      `;
      return;
    }

    tableBody.innerHTML = '';
    filtered.forEach(m => {
      const row = document.createElement('tr');

      // Date parsing
      const dateStr = m.created_at ? new Date(m.created_at).toLocaleString('ar-EG', { hour12: true }) : '-';

      // Map Location link
      let mapLink = '<i class="bi bi-geo-alt"></i> لا يتوفر موقع';
      if (m.latitude && m.longitude) {
        mapLink = `<a href="https://www.google.com/maps/search/?api=1&query=${m.latitude},${m.longitude}" target="_blank" class="location-status" style="font-size:12px; font-weight:700;"><i class="bi bi-geo-alt-fill"></i> فتح الخريطة</a>`;
      }

      // Checkboxes, inputs and statuses HTML
      const statusBadge = m.status === 'coded' 
        ? `<span class="badge badge-coded">تم التكويد</span>` 
        : `<span class="badge badge-pending">قيد الانتظار</span>`;

      const csvBadge = m.downloaded 
        ? `<span class="badge badge-coded" title="تم التحميل في: ${m.downloaded_at ? new Date(m.downloaded_at).toLocaleString() : ''}">نعم</span>` 
        : `<span class="badge badge-pending">لا</span>`;

      const uploadedBadge = m.uploaded 
        ? `<span class="badge badge-coded" title="تم الرفع في: ${m.uploaded_at ? new Date(m.uploaded_at).toLocaleString() : ''}">نعم</span>` 
        : `<span class="badge badge-pending">لا</span>`;

      let codingActionHtml = '';
      if (m.status === 'coded') {
        codingActionHtml = `
          <div style="font-weight:700; color:var(--success-color);">
            <span class="badge badge-coded" style="font-size:12px; padding: 6px 10px;">كود: ${escapeHtml(m.merchant_code)}</span>
            <div style="font-size:10px; color:var(--text-muted); font-weight:normal; margin-top:4px;">
              تاريخ: ${m.coded_at ? new Date(m.coded_at).toLocaleDateString('ar-EG') : ''}
            </div>
          </div>
        `;
      } else {
        codingActionHtml = `
          <button class="btn btn-primary btn-sm open-coding-modal-btn" data-id="${m.id}" data-name="${escapeHtml(m.full_name)}">
            <i class="bi bi-check2-circle"></i> تكويد وتفعيل
          </button>
        `;
      }

      row.innerHTML = `
        <td><input type="checkbox" class="row-checkbox" data-id="${m.id}"></td>
        <td>
          <div style="font-weight:800; color:var(--primary-color); font-size:14px;">${escapeHtml(m.full_name)}</div>
          <div style="font-weight:600; font-size:12px; color:var(--text-color); margin-top:4px;">${escapeHtml(m.store_name)}</div>
          <div style="font-size:11px; color:var(--text-muted); margin-top:2px;">${escapeHtml(m.category)}</div>
        </td>
        <td>
          <div style="font-weight:600; font-size:13px;"><i class="bi bi-telephone"></i> ${escapeHtml(m.phone_number)}</div>
          <div style="color:var(--text-muted); font-size:11px; max-width: 160px; word-break: break-all; margin-top:4px;" title="${escapeHtml(m.email || 'لا يوجد إيميل')}">
            <i class="bi bi-envelope"></i> ${escapeHtml(m.email || 'لا يوجد إيميل')}
          </div>
        </td>
        <td>
          <div style="font-weight:600; font-size:12px;">${escapeHtml(m.governorate)} - ${escapeHtml(m.city)}</div>
          <div style="margin: 4px 0;">${mapLink}</div>
          ${m.supervisor_code ? `
          <div style="font-size:11px; color:var(--text-muted);">
            كود المشرف: ${escapeHtml(m.supervisor_code)}
          </div>` : ''}
        </td>
        <td>
          <div style="display: flex; gap: 8px; align-items: center; justify-content: center;">
            <div style="text-align: center;">
              <div style="font-size: 9px; color: var(--text-muted); margin-bottom: 2px;">الواجهة</div>
              ${m.store_photo ? `<img src="${m.store_photo}" class="thumbnail" alt="واجهة" style="width:42px; height:42px; object-fit:cover; border-radius:4px; border: 1px solid var(--border-color); cursor:pointer;">` : '<i class="bi bi-x-circle text-danger" title="لا توجد صورة" style="font-size: 18px;"></i>'}
            </div>
            <div style="text-align: center;">
              <div style="font-size: 9px; color: var(--text-muted); margin-bottom: 2px;">البطاقة</div>
              ${m.id_photo ? `<img src="${m.id_photo}" class="thumbnail" alt="بطاقة" style="width:42px; height:42px; object-fit:cover; border-radius:4px; border: 1px solid var(--border-color); cursor:pointer;">` : '<i class="bi bi-x-circle text-danger" title="لا توجد صورة" style="font-size: 18px;"></i>'}
            </div>
          </div>
        </td>
        <td>
          <div style="font-size:11px; font-weight:600; color:var(--text-color);">${dateStr}</div>
          <div style="font-size:11px; margin-top:6px; color: var(--text-muted);">
            حساب موقع: <span style="font-weight: 800; color: ${m.created_account === 'نعم' ? 'var(--success-color)' : 'var(--danger-color)'}">${escapeHtml(m.created_account)}</span>
          </div>
        </td>
        <td style="text-align:center; vertical-align: middle;">
          <div style="display: flex; flex-direction: column; gap: 6px; align-items: center; justify-content: center;">
            <div style="display: flex; align-items: center; gap: 4px; font-size:11px;">
              <span style="color:var(--text-muted);">CSV:</span> ${csvBadge}
            </div>
            <div style="display: flex; align-items: center; gap: 4px; font-size:11px;">
              <span style="color:var(--text-muted);">رفع:</span> ${uploadedBadge}
            </div>
          </div>
        </td>
        <td style="text-align:center; vertical-align: middle;">${codingActionHtml}</td>
      `;

      tableBody.appendChild(row);
    });

    // Re-bind image click event
    document.querySelectorAll('.thumbnail').forEach(img => {
      img.addEventListener('click', () => {
        imageModal.style.display = 'block';
        modalImg.src = img.src;
      });
    });

    // Re-bind open coding modal buttons click event
    document.querySelectorAll('.open-coding-modal-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
        const name = btn.getAttribute('data-name');
        
        codingMerchantId.value = id;
        codingMerchantCode.value = '';
        codingModalTitle.innerHTML = `<i class="bi bi-check2-circle"></i> تكويد وتفعيل حساب التاجر: <br><span style="color:var(--accent-color);">${name}</span>`;
        
        codingModal.style.display = 'flex';
        codingMerchantCode.focus();
      });
    });
  }

  // Close Coding Modal
  function hideCodingModal() {
    codingModal.style.display = 'none';
  }

  closeCodingModal.addEventListener('click', hideCodingModal);
  cancelCodingBtn.addEventListener('click', hideCodingModal);
  codingModal.addEventListener('click', (e) => {
    if (e.target === codingModal) {
      hideCodingModal();
    }
  });

  // Save Coding from Modal
  saveCodingBtn.addEventListener('click', async () => {
    const id = codingMerchantId.value;
    const codeValue = codingMerchantCode.value.trim();

    if (!codeValue) {
      alert('برجاء إدخال كود التاجر الجديد.');
      return;
    }

    saveCodingBtn.disabled = true;
    const originalText = saveCodingBtn.innerHTML;
    saveCodingBtn.innerHTML = '<i class="bi bi-hourglass-split"></i> جاري الحفظ والتنشيط...';

    try {
      const res = await fetch(`api/merchants/${id}/code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ merchant_code: codeValue })
      });

      const result = await res.json();
      if (res.ok) {
        let msg = '🎉 تم حفظ كود التاجر وتكويده بنجاح!';
        if (result.emailSent) {
          msg += '\n📧 تم إرسال إيميل التفعيل التلقائي للعميل بكوده الجديد.';
        } else if (result.emailError) {
          msg += `\n⚠️ تم التكويد ولكن فشل إرسال الإيميل: ${result.emailError}`;
        }
        alert(msg);
        hideCodingModal();
        loadData();
      } else {
        alert('❌ فشل حفظ الكود: ' + (result.error || 'خطأ غير معروف.'));
      }
    } catch (err) {
      console.error(err);
      alert('❌ فشل الاتصال بالخادم.');
    } finally {
      saveCodingBtn.disabled = false;
      saveCodingBtn.innerHTML = originalText;
    }
  });

  // 4. Select All Checkboxes
  selectAllCheckbox.addEventListener('change', () => {
    const isChecked = selectAllCheckbox.checked;
    document.querySelectorAll('.row-checkbox').forEach(cb => {
      cb.checked = isChecked;
    });
  });

  // 5. Export CSV via AJAX and Download (No Redirect/New Tab)
  exportCsvBtn.addEventListener('click', async () => {
    exportCsvBtn.disabled = true;
    const originalText = exportCsvBtn.innerHTML;
    exportCsvBtn.innerHTML = '<i class="bi bi-hourglass-split"></i> جاري التحضير...';

    try {
      const response = await fetch('api/merchants/export/csv');
      if (response.status === 404) {
        alert('⚠️ لا توجد بيانات تجار جديدة لتحميلها حالياً.');
        return;
      }
      if (!response.ok) {
        throw new Error('حدث خطأ أثناء تحميل الملف.');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      
      const contentDisposition = response.headers.get('Content-Disposition');
      let filename = `yalla-tager-merchants-${Date.now()}.csv`;
      if (contentDisposition) {
        const filenameMatch = contentDisposition.match(/filename="(.+)"/);
        if (filenameMatch) filename = filenameMatch[1];
      }
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);

      alert('🎉 تم تحميل وتصدير ملف الـ CSV بنجاح!');
      loadData(); // Refresh table to show downloaded badges
    } catch (err) {
      console.error(err);
      alert('❌ فشل تحميل البيانات: ' + err.message);
    } finally {
      exportCsvBtn.disabled = false;
      exportCsvBtn.innerHTML = originalText;
    }
  });

  // 6. Bulk Mark as Uploaded
  markUploadedBtn.addEventListener('click', async () => {
    const selectedIds = [];
    document.querySelectorAll('.row-checkbox:checked').forEach(cb => {
      selectedIds.push(cb.getAttribute('data-id'));
    });

    if (selectedIds.length === 0) {
      alert('يرجى تحديد تاجر واحد على الأقل أولاً (قم بالتعليم في الخانة على يمين اسم التاجر).');
      return;
    }

    if (!confirm(`هل أنت متأكد من تعليم عدد (${selectedIds.length}) تجار كـ "تم الرفع والتفعيل"؟`)) {
      return;
    }

    markUploadedBtn.disabled = true;
    markUploadedBtn.textContent = '⏳ جاري الحفظ...';

    try {
      const res = await fetch('api/merchants/mark-uploaded', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: selectedIds })
      });

      const result = await res.json();
      if (res.ok) {
        alert('✅ تم تحديد التجار كـ "تم الرفع والتفعيل" بنجاح!');
        selectAllCheckbox.checked = false;
        loadData();
      } else {
        alert('❌ حدث خطأ: ' + (result.error || 'فشل التحديث.'));
      }
    } catch (err) {
      console.error(err);
      alert('❌ فشل الاتصال بالخادم.');
    } finally {
      markUploadedBtn.disabled = false;
      markUploadedBtn.textContent = '✅ تعليم كـ تم الرفع';
    }
  });

  // 7. Image Modal Close Event
  modalClose.addEventListener('click', () => {
    imageModal.style.display = 'none';
  });

  imageModal.addEventListener('click', (e) => {
    if (e.target === imageModal) {
      imageModal.style.display = 'none';
    }
  });

  // 8. Filters and Search Change Trigger Table Render
  filterStatus.addEventListener('change', renderTable);
  filterDownloaded.addEventListener('change', renderTable);
  filterUploaded.addEventListener('change', renderTable);
  searchBar.addEventListener('input', renderTable);

  // 9. Auto-Refresh Countdown Timer (60 seconds)
  const refreshCountdown = document.getElementById('refreshCountdown');
  const refreshIcon = document.getElementById('refreshIcon');
  let countdownVal = 60;

  setInterval(async () => {
    countdownVal--;
    if (countdownVal <= 0) {
      countdownVal = 60;
      if (refreshIcon) refreshIcon.classList.add('spin');
      try {
        await loadData();
      } catch (err) {
        console.error('Auto-refresh error:', err);
      } finally {
        setTimeout(() => {
          if (refreshIcon) refreshIcon.classList.remove('spin');
        }, 1000);
      }
    }
    if (refreshCountdown) {
      refreshCountdown.textContent = countdownVal;
    }
  }, 1000);

  // Check session status before doing anything
  async function checkSession() {
    try {
      const response = await fetch('/api/auth/session');
      const data = await response.json();
      if (!data.authenticated) {
        window.location.replace('/login.html');
      } else {
        // Initial Load only if authenticated
        loadData();
      }
    } catch (err) {
      console.error('Session check failed:', err);
      window.location.replace('/login.html');
    }
  }

  // Logout button event
  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      if (confirm('هل أنت متأكد من تسجيل الخروج؟')) {
        try {
          const response = await fetch('/api/auth/logout', { method: 'POST' });
          if (response.ok) {
            window.location.replace('/login.html');
          } else {
            alert('حدث خطأ أثناء تسجيل الخروج.');
          }
        } catch (err) {
          console.error('Logout error:', err);
          alert('فشل الاتصال بالخادم لتسجيل الخروج.');
        }
      }
    });
  }

  // Admin User Management Modal Bindings
  const userModal = document.getElementById('userModal');
  const manageUsersBtn = document.getElementById('manageUsersBtn');
  const closeUserModal = document.getElementById('closeUserModal');
  const cancelUserBtn = document.getElementById('cancelUserBtn');
  const addUserForm = document.getElementById('addUserForm');

  if (manageUsersBtn) {
    manageUsersBtn.addEventListener('click', () => {
      userModal.style.display = 'flex';
      document.getElementById('newUsername').value = '';
      document.getElementById('newPassword').value = '';
      document.getElementById('newUsername').focus();
    });
  }

  const hideUserModal = () => { userModal.style.display = 'none'; };
  if (closeUserModal) closeUserModal.addEventListener('click', hideUserModal);
  if (cancelUserBtn) cancelUserBtn.addEventListener('click', hideUserModal);
  if (userModal) {
    userModal.addEventListener('click', (e) => {
      if (e.target === userModal) {
        hideUserModal();
      }
    });
  }

  if (addUserForm) {
    addUserForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const username = document.getElementById('newUsername').value.trim();
      const password = document.getElementById('newPassword').value;

      if (!username || !password) {
        alert('يرجى ملء جميع الحقول المطلوبة.');
        return;
      }

      const saveUserBtn = document.getElementById('saveUserBtn');
      saveUserBtn.disabled = true;
      const originalText = saveUserBtn.innerHTML;
      saveUserBtn.innerHTML = '<i class="bi bi-hourglass-split"></i> جاري الإنشاء...';

      try {
        const response = await fetch('/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password })
        });

        const result = await response.json();
        if (response.ok) {
          alert('🎉 تم إنشاء حساب المسؤول الجديد بنجاح!');
          hideUserModal();
        } else {
          alert('❌ فشل إنشاء الحساب: ' + (result.error || 'خطأ غير معروف.'));
        }
      } catch (err) {
        console.error(err);
        alert('❌ فشل الاتصال بالخادم.');
      } finally {
        saveUserBtn.disabled = false;
        saveUserBtn.innerHTML = originalText;
      }
    });
  }

  // Initial Load (verifies session first)
  checkSession();
});
