document.addEventListener('DOMContentLoaded', () => {
  const loginForm = document.getElementById('loginForm');
  const loginBtn = document.getElementById('loginBtn');
  const errorAlert = document.getElementById('errorAlert');
  const errorText = document.getElementById('errorText');

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value;

    if (!username || !password) {
      showError('يرجى كتابة اسم المستخدم وكلمة المرور.');
      return;
    }

    // Reset UI state
    hideError();
    loginBtn.disabled = true;
    const originalBtnHtml = loginBtn.innerHTML;
    loginBtn.innerHTML = '<i class="bi bi-hourglass-split spin"></i> جاري التحقق...';

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ username, password })
      });

      const data = await response.json();

      if (response.ok && data.success) {
        // Redirect to dashboard upon successful login
        window.location.replace('/dashboard.html');
      } else {
        showError(data.error || 'فشل تسجيل الدخول. يرجى التحقق من المدخلات.');
      }
    } catch (err) {
      console.error('Login error:', err);
      showError('حدث خطأ في الاتصال بالخادم. يرجى التحقق من الشبكة.');
    } finally {
      loginBtn.disabled = false;
      loginBtn.innerHTML = originalBtnHtml;
    }
  });

  function showError(msg) {
    errorText.textContent = msg;
    errorAlert.style.display = 'flex';
    // Trigger CSS shake animation by resetting class
    errorAlert.style.animation = 'none';
    errorAlert.offsetHeight; /* trigger reflow */
    errorAlert.style.animation = null; 
  }

  function hideError() {
    errorAlert.style.display = 'none';
  }
});
