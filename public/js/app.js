(() => {
  const navToggle = document.querySelector('[data-nav-toggle]');
  const nav = document.querySelector('[data-nav]');
  navToggle?.addEventListener('click', () => {
    const open = nav.classList.toggle('open');
    navToggle.setAttribute('aria-expanded', String(open));
  });

  document.querySelectorAll('[data-alert-close]').forEach((button) => {
    button.addEventListener('click', () => button.closest('.alert')?.remove());
  });

  document.querySelectorAll('[data-captcha-refresh]').forEach((button) => {
    button.addEventListener('click', () => {
      const captchaBlock = button.closest('.captcha-block');
      const image = captchaBlock?.querySelector('.captcha-image img');
      const input = captchaBlock?.querySelector('.captcha-input');
      if (!image) return;

      const base = image.src.split('?')[0];
      image.src = `${base}?t=${Date.now()}`;
      if (input) {
        input.value = '';
        input.focus();
      }
    });
  });

  document.querySelectorAll('.captcha-input').forEach((input) => {
    input.addEventListener('input', () => {
      input.value = input.value.toUpperCase().replace(/[^A-Z2-9]/g, '').slice(0, 5);
    });
  });

  const avatarInput = document.querySelector('[data-avatar-input]');
  const avatarImage = document.querySelector('[data-avatar-image]');
  const avatarFallback = document.querySelector('[data-avatar-fallback]');
  const avatarData = document.querySelector('[data-avatar-data]');
  const avatarRemove = document.querySelector('[data-avatar-remove]');
  const avatarDelete = document.querySelector('[data-avatar-delete]');
  const avatarMessage = document.querySelector('[data-avatar-message]');
  const profileForm = document.querySelector('[data-profile-form]');

  const setAvatarMessage = (message, isError = false) => {
    if (!avatarMessage) return;
    avatarMessage.textContent = message;
    avatarMessage.classList.toggle('error', isError);
  };

  const setProfileBusy = (busy) => {
    profileForm?.querySelectorAll('button[type="submit"]').forEach((button) => {
      button.disabled = busy;
    });
  };

  const dataUrlSize = (dataUrl) => {
    const base64 = String(dataUrl).split(',')[1] || '';
    return Math.ceil((base64.length * 3) / 4);
  };

  const renderAvatar = (dataUrl) => {
    if (!avatarImage || !avatarFallback) return;
    if (dataUrl) {
      avatarImage.src = dataUrl;
      avatarImage.hidden = false;
      avatarFallback.hidden = true;
    } else {
      avatarImage.removeAttribute('src');
      avatarImage.hidden = true;
      avatarFallback.hidden = false;
    }
  };

  avatarInput?.addEventListener('change', () => {
    const file = avatarInput.files?.[0];
    if (!file) return;

    const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
    if (!allowedTypes.has(file.type)) {
      avatarInput.value = '';
      setAvatarMessage('Gunakan file JPG, PNG, atau WebP.', true);
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      avatarInput.value = '';
      setAvatarMessage('Ukuran file awal maksimal 8 MB.', true);
      return;
    }

    setProfileBusy(true);
    setAvatarMessage('Memproses foto...');
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      try {
        const cropSize = Math.min(image.naturalWidth, image.naturalHeight);
        const sourceX = Math.max(0, (image.naturalWidth - cropSize) / 2);
        const sourceY = Math.max(0, (image.naturalHeight - cropSize) / 2);
        const canvas = document.createElement('canvas');
        canvas.width = 320;
        canvas.height = 320;
        const context = canvas.getContext('2d', { alpha: false });
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, sourceX, sourceY, cropSize, cropSize, 0, 0, canvas.width, canvas.height);

        let compressed = canvas.toDataURL('image/webp', 0.82);
        if (dataUrlSize(compressed) > 400 * 1024) {
          canvas.width = 256;
          canvas.height = 256;
          const smallerContext = canvas.getContext('2d', { alpha: false });
          smallerContext.fillStyle = '#ffffff';
          smallerContext.fillRect(0, 0, canvas.width, canvas.height);
          smallerContext.drawImage(image, sourceX, sourceY, cropSize, cropSize, 0, 0, canvas.width, canvas.height);
          compressed = canvas.toDataURL('image/webp', 0.68);
        }

        if (dataUrlSize(compressed) > 400 * 1024) {
          throw new Error('Foto masih terlalu besar setelah dikompresi. Pilih gambar lain.');
        }

        avatarData.value = compressed;
        avatarRemove.value = '0';
        renderAvatar(compressed);
        setAvatarMessage('Foto siap disimpan.');
      } catch (error) {
        avatarInput.value = '';
        setAvatarMessage(error.message || 'Foto tidak dapat diproses.', true);
      } finally {
        URL.revokeObjectURL(objectUrl);
        setProfileBusy(false);
      }
    };

    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      avatarInput.value = '';
      setProfileBusy(false);
      setAvatarMessage('File gambar tidak dapat dibaca.', true);
    };

    image.src = objectUrl;
  });

  avatarDelete?.addEventListener('click', () => {
    if (avatarInput) avatarInput.value = '';
    if (avatarData) avatarData.value = '';
    if (avatarRemove) avatarRemove.value = '1';
    renderAvatar('');
    setAvatarMessage('Foto profil akan dihapus setelah perubahan disimpan.');
  });

  const countdown = document.querySelector('[data-countdown]');
  if (countdown) {
    const target = new Date(countdown.dataset.countdown).getTime();
    const render = () => {
      const diff = Math.max(0, target - Date.now());
      const hours = Math.floor(diff / 3_600_000);
      const minutes = Math.floor((diff % 3_600_000) / 60_000);
      const seconds = Math.floor((diff % 60_000) / 1000);
      countdown.querySelector('[data-hours]').textContent = String(hours).padStart(2, '0');
      countdown.querySelector('[data-minutes]').textContent = String(minutes).padStart(2, '0');
      countdown.querySelector('[data-seconds]').textContent = String(seconds).padStart(2, '0');
    };
    render();
    setInterval(render, 1000);
  }

  document.querySelectorAll('[data-copy]').forEach((button) => {
    button.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(button.dataset.copy);
        const original = button.textContent;
        button.textContent = 'Tersalin';
        setTimeout(() => { button.textContent = original; }, 1300);
      } catch (_) {
        window.prompt('Salin nilai berikut:', button.dataset.copy);
      }
    });
  });
})();
