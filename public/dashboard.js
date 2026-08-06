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
  const filterSource = document.getElementById('filterSource');
  const searchBar = document.getElementById('searchBar');

  /**
   * مصدر التسجيل - يميّز التاجر اللي كمّل بياناته بنفسه
   * عن التاجر اللي سجّله مندوب المبيعات على الأرض.
   */
  const SOURCE_LABELS = {
    merchant: { label: 'عميل يلا تاجر', icon: 'bi-shop', color: 'var(--primary-color)', bg: 'var(--primary-light)' },
    field_sales: { label: 'مبيعات على الأرض', icon: 'bi-person-badge', color: '#975a16', bg: '#fffaf0' }
  };

  function sourceBadgeHtml(source) {
    const key = source === 'field_sales' ? 'field_sales' : 'merchant';
    const meta = SOURCE_LABELS[key];
    return `<span style="display:inline-flex; align-items:center; gap:5px; padding:4px 10px;
      border-radius:20px; font-size:10px; font-weight:800; white-space:nowrap;
      color:${meta.color}; background:${meta.bg}; border:1px solid ${meta.color}33;">
      <i class="bi ${meta.icon}"></i> ${escapeHtml(meta.label)}</span>`;
  }

  // Action buttons
  const exportCsvBtn = document.getElementById('exportCsvBtn');
  const exportSelectedBtn = document.getElementById('exportSelectedBtn');
  const resetDownloadedBtn = document.getElementById('resetDownloadedBtn');
  const markUploadedBtn = document.getElementById('markUploadedBtn');
  const selectionCount = document.getElementById('selectionCount');

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
          <td colspan="9" style="text-align: center; color: red; padding: 20px; font-weight: bold;">
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
    const sourceVal = filterSource ? filterSource.value : '';
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
      if (sourceVal) {
        // السجلات القديمة قبل إضافة الحقل تُعامل كـ merchant
        const recordSource = m.source === 'field_sales' ? 'field_sales' : 'merchant';
        if (recordSource !== sourceVal) match = false;
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
          <td colspan="9" style="text-align: center; padding: 30px; color: var(--text-muted);">
            📭 لا توجد بيانات مطابقة للبحث أو الفلاتر المحددة.
          </td>
        </tr>
      `;
      updateSelectionUi();
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

      // "تم التحميل" is only a bookkeeping flag for the "new records" export.
      // Show the date inline so it is obvious why a row reads نعم, and make it
      // clear the row can still be re-downloaded via "تحميل المحدد".
      const csvBadge = m.downloaded
        ? `<span class="badge badge-coded" title="تم التحميل في: ${m.downloaded_at ? new Date(m.downloaded_at).toLocaleString('ar-EG') : 'غير معروف'} — يمكن تحميله مرة أخرى بتحديده والضغط على (تحميل المحدد)">نعم</span>
           <div style="font-size:10px; color:var(--text-muted); margin-top:4px;">${m.downloaded_at ? new Date(m.downloaded_at).toLocaleDateString('ar-EG') : ''}</div>`
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
        <td style="text-align:center; vertical-align: middle;">${sourceBadgeHtml(m.source)}</td>
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

    // Re-rendering clears the ticks, so the counter/buttons must follow.
    updateSelectionUi();
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

  /* ---------------- Row selection helpers ---------------- */

  /** Ids of the rows currently ticked in the table. */
  function getSelectedIds() {
    return Array.from(document.querySelectorAll('.row-checkbox:checked'))
      .map(cb => cb.getAttribute('data-id'));
  }

  /** Keep the counter and the selection-dependent buttons in sync. */
  function updateSelectionUi() {
    const n = getSelectedIds().length;
    if (selectionCount) {
      selectionCount.textContent = n === 0
        ? 'لم يتم تحديد أي سجل'
        : `تم تحديد ${n} سجل`;
      selectionCount.classList.toggle('has-selection', n > 0);
    }
    [exportSelectedBtn, resetDownloadedBtn, markUploadedBtn].forEach(btn => {
      if (btn) btn.disabled = n === 0;
    });

    // Reflect partial selection on the header checkbox.
    const all = document.querySelectorAll('.row-checkbox');
    if (selectAllCheckbox && all.length) {
      selectAllCheckbox.checked = n === all.length;
      selectAllCheckbox.indeterminate = n > 0 && n < all.length;
    }
  }

  /** Download a blob response as a file, reading the server filename. */
  function downloadBlob(blob, response, fallbackPrefix) {
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;

    let filename = `${fallbackPrefix}-${Date.now()}.csv`;
    const cd = response.headers.get('Content-Disposition');
    if (cd) {
      const match = cd.match(/filename="(.+)"/);
      if (match) filename = match[1];
    }
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  }

  // 4. Select All Checkboxes
  selectAllCheckbox.addEventListener('change', () => {
    const isChecked = selectAllCheckbox.checked;
    document.querySelectorAll('.row-checkbox').forEach(cb => {
      cb.checked = isChecked;
    });
    updateSelectionUi();
  });

  // Any individual row tick updates the counter (delegated, so it keeps
  // working after the table is re-rendered).
  tableBody.addEventListener('change', (e) => {
    if (e.target.classList.contains('row-checkbox')) updateSelectionUi();
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
      downloadBlob(blob, response, 'yalla-tager-merchants');

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

  // 5b. Re-download SELECTED rows (any state) — does not change the flags
  exportSelectedBtn.addEventListener('click', async () => {
    const selectedIds = getSelectedIds();
    if (selectedIds.length === 0) {
      alert('يرجى تحديد سجل واحد على الأقل من الخانة على يمين اسم التاجر.');
      return;
    }

    exportSelectedBtn.disabled = true;
    const originalText = exportSelectedBtn.innerHTML;
    exportSelectedBtn.innerHTML = '<i class="bi bi-hourglass-split"></i> <span>جاري التحضير...</span>';

    try {
      const response = await fetch('api/merchants/export/csv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: selectedIds })
      });

      if (!response.ok) {
        let msg = 'حدث خطأ أثناء تحميل الملف.';
        try {
          const j = await response.json();
          if (j && j.error) msg = j.error;
        } catch (_) { /* body was not JSON */ }
        throw new Error(msg);
      }

      const blob = await response.blob();
      downloadBlob(blob, response, 'yalla-tager-selected');
      alert(`🎉 تم تحميل ملف يحتوي على ${selectedIds.length} سجل بنجاح!`);
    } catch (err) {
      console.error(err);
      alert('❌ فشل تحميل البيانات: ' + err.message);
    } finally {
      exportSelectedBtn.innerHTML = originalText;
      updateSelectionUi();
    }
  });

  // 5c. Reset the downloaded flag on the selected rows
  resetDownloadedBtn.addEventListener('click', async () => {
    const selectedIds = getSelectedIds();
    if (selectedIds.length === 0) {
      alert('يرجى تحديد سجل واحد على الأقل من الخانة على يمين اسم التاجر.');
      return;
    }

    if (!confirm(`سيتم إرجاع عدد (${selectedIds.length}) سجل إلى حالة "لم يتم التحميل" ليظهروا في تحميل البيانات الجديدة. متابعة؟`)) {
      return;
    }

    resetDownloadedBtn.disabled = true;
    const originalText = resetDownloadedBtn.innerHTML;
    resetDownloadedBtn.innerHTML = '<i class="bi bi-hourglass-split"></i> <span>جاري الحفظ...</span>';

    try {
      const res = await fetch('api/merchants/reset-downloaded', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: selectedIds })
      });
      const result = await res.json();

      if (res.ok) {
        alert(`✅ تم إرجاع ${result.count} سجل إلى حالة "لم يتم التحميل".`);
        selectAllCheckbox.checked = false;
        loadData();
      } else {
        alert('❌ حدث خطأ: ' + (result.error || 'فشل التحديث.'));
      }
    } catch (err) {
      console.error(err);
      alert('❌ فشل الاتصال بالخادم.');
    } finally {
      resetDownloadedBtn.innerHTML = originalText;
      updateSelectionUi();
    }
  });

  // 6. Bulk Mark as Uploaded
  markUploadedBtn.addEventListener('click', async () => {
    const selectedIds = getSelectedIds();

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
  if (filterSource) filterSource.addEventListener('change', renderTable);
  searchBar.addEventListener('input', renderTable);

  /* ======================================================================
     8b. Security & Lookup Monitoring panel
     ----------------------------------------------------------------------
     Reads /api/security/overview and renders the verdict. Collapsed it is a
     single strip whose colour + headline answer "is everything safe?"; the
     details (threats, server health, who ran lookups, raw log) only render
     while it is open so a closed panel costs nothing to keep refreshed.
     ====================================================================== */

  const securityPanel = document.getElementById('securityPanel');
  const securityToggle = document.getElementById('securityToggle');
  const securityBody = document.getElementById('securityBody');
  const securityIcon = document.getElementById('securityIcon');
  const securityHeadline = document.getElementById('securityHeadline');
  const securityPill = document.getElementById('securityPill');
  const securityAlertDot = document.getElementById('securityAlertDot');
  const securityMetrics = document.getElementById('securityMetrics');
  const securityThreats = document.getElementById('securityThreats');
  const securityHealth = document.getElementById('securityHealth');
  const securityActorsBody = document.getElementById('securityActorsBody');
  const securityLog = document.getElementById('securityLog');
  const securityAckBtn = document.getElementById('securityAckBtn');

  /** Icon + short pill label per verdict level. */
  const SEC_LEVELS = {
    safe:     { icon: 'bi-shield-check',        pill: 'آمن' },
    low:      { icon: 'bi-shield-exclamation',  pill: 'متابعة' },
    medium:   { icon: 'bi-exclamation-triangle', pill: 'مشبوه' },
    high:     { icon: 'bi-exclamation-octagon', pill: 'خطر مرتفع' },
    critical: { icon: 'bi-shield-fill-x',       pill: 'خطر حرج' },
    offline:  { icon: 'bi-shield-slash',        pill: 'غير متاح' }
  };

  /** Arabic label per threat level, used on the small tag inside each card. */
  const SEC_LEVEL_LABELS = {
    low: 'منخفض', medium: 'متوسط', high: 'مرتفع', critical: 'حرج'
  };

  /** Event type → Arabic label + colour class for the raw log. */
  const SEC_EVENT_META = {
    lookup:           { label: 'استعلام',        cls: 't-info' },
    lookup_invalid:   { label: 'رقم غير صحيح',   cls: 't-warn' },
    rate_limited:     { label: 'تم الحجب',       cls: 't-warn' },
    login_success:    { label: 'دخول ناجح',      cls: 't-ok' },
    login_failed:     { label: 'دخول فاشل',      cls: 't-danger' },
    submit:           { label: 'تسجيل تاجر',     cls: 't-ok' },
    suspicious_input: { label: 'محاولة حقن',     cls: 't-danger' },
    unauthorized:     { label: 'وصول مرفوض',     cls: 't-warn' }
  };

  let securityOpen = false;
  let securitySnapshot = null;

  /** Short Arabic relative time, e.g. "قبل 3 دقائق". */
  function secAgo(iso) {
    const then = new Date(iso).getTime();
    if (!Number.isFinite(then)) return '—';
    const secs = Math.max(0, Math.round((Date.now() - then) / 1000));
    if (secs < 60) return `قبل ${secs} ثانية`;
    const mins = Math.round(secs / 60);
    if (mins < 60) return `قبل ${mins} دقيقة`;
    const hours = Math.round(mins / 60);
    if (hours < 24) return `قبل ${hours} ساعة`;
    return `قبل ${Math.round(hours / 24)} يوم`;
  }

  function secTime(iso) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  /** Colour a table number by how alarming it is. */
  function secNumCell(value, warnAt, hotAt) {
    if (!value) return '<span class="sec-zero">0</span>';
    if (hotAt && value >= hotAt) return `<span class="sec-hot">${value}</span>`;
    if (warnAt && value >= warnAt) return `<span class="sec-warm">${value}</span>`;
    return String(value);
  }

  function renderSecurityMetrics(data) {
    const t = data.totals || {};
    const w = data.window || {};
    const cells = [
      { label: 'إجمالي الاستعلامات', value: t.lookups || 0 },
      { label: `استعلامات آخر ${w.minutes || 15}د`, value: w.events || 0 },
      { label: 'مصادر (IP) مختلفة', value: w.uniqueIps || 0 },
      { label: 'أرقام غير صحيحة', value: t.invalid || 0, warn: (t.invalid || 0) > 0 },
      { label: 'طلبات محجوبة', value: t.blocked || 0, warn: (t.blocked || 0) > 0 },
      { label: 'دخول فاشل', value: t.loginFailed || 0, warn: (t.loginFailed || 0) > 0 },
      { label: 'محاولات حقن', value: t.suspicious || 0, alert: (t.suspicious || 0) > 0 },
      { label: 'وصول مرفوض', value: t.unauthorized || 0, warn: (t.unauthorized || 0) >= 5 },
      { label: 'تسجيلات تجار', value: t.submits || 0 }
    ];
    securityMetrics.innerHTML = cells.map(c => `
      <div class="sec-metric ${c.alert ? 'is-alert' : c.warn ? 'is-warn' : ''}">
        <span class="sec-metric-label">${escapeHtml(c.label)}</span>
        <span class="sec-metric-value">${escapeHtml(String(c.value))}</span>
      </div>`).join('');
  }

  function renderSecurityThreats(data) {
    const threats = data.threats || [];
    if (threats.length === 0) {
      securityThreats.innerHTML = `
        <div class="sec-empty">
          <i class="bi bi-shield-fill-check"></i>
          <span>كل حاجة آمنة — لا يوجد نشاط مشبوه، ولا ضغط غير طبيعي على السيرفر أو قاعدة البيانات
          خلال آخر ${escapeHtml(String((data.window || {}).minutes || 15))} دقيقة.</span>
        </div>`;
      return;
    }
    securityThreats.innerHTML = threats.map(threat => `
      <div class="sec-threat${threat.acknowledged ? ' is-ack' : ''}" data-level="${escapeHtml(threat.level)}">
        <div class="sec-threat-head">
          <span class="sec-threat-title">${escapeHtml(threat.title)}</span>
          <span class="sec-level-tag" data-level="${escapeHtml(threat.level)}">${escapeHtml(SEC_LEVEL_LABELS[threat.level] || threat.level)}</span>
          ${threat.acknowledged
            ? '<span class="sec-ack-tag"><i class="bi bi-check2"></i> تمت المراجعة</span>'
            : '<span class="sec-new-tag">جديد</span>'}
          ${threat.ip ? `<span class="sec-log-ip">${escapeHtml(threat.ip)}</span>` : ''}
        </div>
        <div class="sec-threat-detail">${escapeHtml(threat.detail)}</div>
        ${threat.impact ? `<div class="sec-threat-meta"><strong>الأثر المحتمل:</strong> ${escapeHtml(threat.impact)}</div>` : ''}
        ${threat.action ? `<div class="sec-threat-meta"><strong>الإجراء المقترح:</strong> ${escapeHtml(threat.action)}</div>` : ''}
      </div>`).join('');
  }

  function renderSecurityHealth(data) {
    const s = data.server || {};
    const th = data.thresholds || {};
    const uptimeMins = Math.round((s.uptimeSeconds || 0) / 60);
    const items = [
      {
        label: 'الذاكرة المستهلكة', value: `${s.rssMb || 0} MB`,
        state: s.rssMb >= (th.memoryHighMb || 700) ? 'alert' : s.rssMb >= (th.memoryWarnMb || 400) ? 'warn' : ''
      },
      {
        label: 'تأخير الاستجابة', value: `${s.eventLoopLagMs || 0} ms`,
        state: s.eventLoopLagMs >= (th.lagHighMs || 600) ? 'alert' : s.eventLoopLagMs >= (th.lagWarnMs || 200) ? 'warn' : ''
      },
      {
        label: 'أعلى معدل طلبات', value: `${s.peakRpm || 0}/دقيقة`,
        state: s.peakRpm >= (th.spikeRpmHigh || 400) ? 'alert' : s.peakRpm >= (th.spikeRpmWarn || 150) ? 'warn' : ''
      },
      {
        label: 'قاعدة البيانات',
        value: !s.dbReady ? 'غير متصلة' : s.dbMode === 'file' ? 'وضع احتياطي (ملف)' : 'SQL Server ✓',
        state: !s.dbReady ? 'alert' : s.dbMode === 'file' ? 'warn' : ''
      },
      { label: 'مدة التشغيل', value: uptimeMins < 60 ? `${uptimeMins} دقيقة` : `${Math.round(uptimeMins / 60)} ساعة` },
      { label: 'مصادر متتبَّعة', value: String(s.trackedIps || 0) }
    ];
    securityHealth.innerHTML = items.map(i => `
      <div class="sec-health-item ${i.state ? `is-${i.state}` : ''}">
        <span>${escapeHtml(i.label)}</span><span>${escapeHtml(i.value)}</span>
      </div>`).join('');
  }

  function renderSecurityActors(data) {
    const actors = data.topActors || [];
    if (actors.length === 0) {
      securityActorsBody.innerHTML = `
        <tr><td colspan="7" style="text-align:center; padding:18px; color:var(--text-muted);">
          لا توجد استعلامات مسجّلة بعد.
        </td></tr>`;
      return;
    }
    const th = data.thresholds || {};
    securityActorsBody.innerHTML = actors.map(a => `
      <tr>
        <td class="sec-ip" title="${escapeHtml(a.userAgent)}">${escapeHtml(a.ip)}</td>
        <td>${secNumCell(a.lookups, th.lookupVolumeWarn, th.lookupVolumeHigh)}</td>
        <td>${secNumCell(a.distinctPhones, th.distinctPhonesWarn, th.distinctPhonesHigh)}</td>
        <td>${secNumCell(a.blocked, th.blockedWarn, th.blockedHigh)}</td>
        <td>${secNumCell(a.loginFailed, th.loginFailWarn, th.loginFailHigh)}</td>
        <td>${secNumCell(a.suspicious, 1, 1)}</td>
        <td style="color:var(--text-muted);">${escapeHtml(secAgo(a.lastSeen))}</td>
      </tr>`).join('');
  }

  function renderSecurityLog(data) {
    const events = data.recentEvents || [];
    if (events.length === 0) {
      securityLog.innerHTML = `
        <div class="sec-log-row"><span class="sec-log-text" style="color:var(--text-muted);">
          لا توجد أحداث مسجّلة بعد.
        </span></div>`;
      return;
    }
    securityLog.innerHTML = events.map(event => {
      const meta = SEC_EVENT_META[event.type] || { label: event.type, cls: '' };
      const bits = [];
      if (event.phone) bits.push(`الرقم ${event.phone}`);
      if (event.status && event.type === 'lookup') bits.push(`النتيجة: ${event.status}`);
      if (event.route) bits.push(event.route);
      if (event.detail) bits.push(event.detail);
      if (event.sample) bits.push(`العينة: ${event.sample}`);
      return `
        <div class="sec-log-row">
          <span class="sec-log-time">${escapeHtml(secTime(event.at))}</span>
          <span class="sec-log-tag ${escapeHtml(meta.cls)}">${escapeHtml(meta.label)}</span>
          <span class="sec-log-text">
            <span class="sec-log-ip">${escapeHtml(event.ip || '—')}</span>
            ${bits.length ? ` · ${escapeHtml(bits.join(' · '))}` : ''}
          </span>
        </div>`;
    }).join('');
  }

  /** Paint the collapsed strip; details only when the panel is open. */
  function renderSecurity(data) {
    securitySnapshot = data;
    const level = data.level || 'safe';
    const meta = SEC_LEVELS[level] || SEC_LEVELS.safe;

    securityPanel.setAttribute('data-level', level);
    securityIcon.className = `bi ${meta.icon} sec-icon`;
    securityPill.textContent = meta.pill;
    securityHeadline.textContent = data.headline || '';

    // Pulsing dot only for unreviewed medium-or-worse findings.
    const unack = (data.counts || {}).unacknowledged || 0;
    securityAlertDot.hidden = unack === 0;
    securityAlertDot.title = unack ? `${unack} تنبيه غير مقروء` : '';
    if (securityAckBtn) securityAckBtn.disabled = unack === 0;

    if (!securityOpen) return;
    renderSecurityMetrics(data);
    renderSecurityThreats(data);
    renderSecurityHealth(data);
    renderSecurityActors(data);
    renderSecurityLog(data);
  }

  /** Show the strip as unavailable rather than silently stale on failure. */
  function renderSecurityOffline(message) {
    securityPanel.setAttribute('data-level', 'offline');
    securityIcon.className = `bi ${SEC_LEVELS.offline.icon} sec-icon`;
    securityPill.textContent = SEC_LEVELS.offline.pill;
    securityHeadline.textContent = message || 'تعذّر قراءة حالة الأمان.';
    securityAlertDot.hidden = true;
  }

  async function loadSecurity() {
    if (!securityPanel) return;
    try {
      const response = await fetch('/api/security/overview');
      if (response.status === 401) {
        window.location.replace('/login.html');
        return;
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      renderSecurity(await response.json());
    } catch (err) {
      console.error('Security overview failed:', err);
      renderSecurityOffline('تعذّر الوصول لبيانات الأمان — تأكد من عمل السيرفر.');
    }
  }

  if (securityToggle) {
    securityToggle.addEventListener('click', () => {
      securityOpen = !securityOpen;
      securityToggle.setAttribute('aria-expanded', String(securityOpen));
      securityBody.hidden = !securityOpen;
      // Render immediately from the cached snapshot so opening feels instant,
      // then refresh in the background for up-to-date numbers.
      if (securityOpen) {
        if (securitySnapshot) renderSecurity(securitySnapshot);
        loadSecurity();
      }
    });
  }

  if (securityAckBtn) {
    securityAckBtn.addEventListener('click', async () => {
      securityAckBtn.disabled = true;
      try {
        const response = await fetch('/api/security/acknowledge', { method: 'POST' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        await loadSecurity();
      } catch (err) {
        console.error('Acknowledge failed:', err);
        alert('تعذّر تعليم التنبيهات كمقروءة.');
        securityAckBtn.disabled = false;
      }
    });
  }

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
        // Security is refreshed on the same tick so the strip never shows a
        // stale "all safe" while an attack is in progress.
        await Promise.all([loadData(), loadSecurity()]);
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
        loadSecurity();
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
