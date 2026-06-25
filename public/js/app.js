(() => {
  const initializeResponsiveMenu = () => {
    const responsiveMenuToggle = document.querySelector('[data-responsive-menu-toggle]');
    const responsiveMenu = document.querySelector('[data-responsive-menu]');
    const responsiveMenuOverlay = document.querySelector('.responsive-menu-overlay');
    const responsiveMenuCloseButtons = document.querySelectorAll('[data-responsive-menu-close]');
    let menuReturnFocus = null;

    if (!responsiveMenuToggle || !responsiveMenu || !responsiveMenuOverlay) return;

    const isOpen = () => responsiveMenu.classList.contains('open');

    const setResponsiveMenu = (open) => {
      responsiveMenu.classList.toggle('open', open);
      responsiveMenuOverlay.hidden = !open;
      responsiveMenuOverlay.classList.toggle('open', open);
      responsiveMenu.setAttribute('aria-hidden', String(!open));
      responsiveMenuToggle.setAttribute('aria-expanded', String(open));
      responsiveMenuToggle.setAttribute('aria-label', open ? 'Tutup menu' : 'Buka menu');
      document.body.classList.toggle('responsive-menu-open', open);

      if (open) {
        menuReturnFocus = document.activeElement;
        window.requestAnimationFrame(() => {
          responsiveMenu.querySelector('.responsive-menu-close')?.focus();
        });
        return;
      }

      if (menuReturnFocus instanceof HTMLElement && document.contains(menuReturnFocus)) {
        menuReturnFocus.focus();
      }
      menuReturnFocus = null;
    };

    responsiveMenuToggle.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      setResponsiveMenu(!isOpen());
    });

    responsiveMenuCloseButtons.forEach((button) => {
      button.addEventListener('click', (event) => {
        event.preventDefault();
        setResponsiveMenu(false);
      });
    });

    responsiveMenu.querySelectorAll('a').forEach((link) => {
      link.addEventListener('click', () => setResponsiveMenu(false));
    });

    document.addEventListener('keydown', (event) => {
      if (!isOpen()) return;

      if (event.key === 'Escape') {
        event.preventDefault();
        setResponsiveMenu(false);
        return;
      }

      if (event.key !== 'Tab') return;

      const focusableElements = Array.from(
        responsiveMenu.querySelectorAll('a, button, input:not([type="hidden"])')
      ).filter((element) => !element.disabled && element.getAttribute('aria-hidden') !== 'true');
      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];

      if (!firstElement || !lastElement) return;

      if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
      } else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    });

    window.addEventListener('resize', () => {
      if (window.innerWidth > 1024 && isOpen()) setResponsiveMenu(false);
    });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeResponsiveMenu, { once: true });
  } else {
    initializeResponsiveMenu();
  }


  document.querySelectorAll('[data-auto-submit]').forEach((field) => {
    field.addEventListener('change', () => field.form?.requestSubmit());
  });

  document.querySelectorAll('form[data-confirm]').forEach((form) => {
    form.addEventListener('submit', (event) => {
      if (!window.confirm(form.dataset.confirm || 'Lanjutkan tindakan ini?')) event.preventDefault();
    });
  });

  document.querySelectorAll('form[data-disable-on-submit]').forEach((form) => {
    form.addEventListener('submit', (event) => {
      if (event.defaultPrevented) return;
      form.querySelectorAll('button[type="submit"]').forEach((button) => {
        button.disabled = true;
      });
    });
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


  const topupAmount = document.querySelector('[data-topup-amount]');
  const topupPresetButtons = document.querySelectorAll('[data-topup-preset]');
  topupPresetButtons.forEach((button) => {
    button.addEventListener('click', () => {
      if (!topupAmount) return;
      topupAmount.value = button.dataset.topupPreset || '';
      topupPresetButtons.forEach((item) => item.classList.toggle('active', item === button));
      topupAmount.focus();
    });
  });
  topupAmount?.addEventListener('input', () => {
    topupPresetButtons.forEach((button) => {
      button.classList.toggle('active', Number(button.dataset.topupPreset) === Number(topupAmount.value));
    });
  });

  const walletHistory = document.querySelector('[data-wallet-history]');
  const walletFilterButtons = document.querySelectorAll('[data-wallet-filter]');
  const walletFilterEmpty = document.querySelector('[data-wallet-filter-empty]');
  walletFilterButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const filter = button.dataset.walletFilter || 'all';
      let visibleCount = 0;
      walletFilterButtons.forEach((item) => item.classList.toggle('active', item === button));
      walletHistory?.querySelectorAll('[data-wallet-kind]').forEach((item) => {
        const visible = filter === 'all' || item.dataset.walletKind === filter;
        item.hidden = !visible;
        if (visible) visibleCount += 1;
      });
      if (walletFilterEmpty) walletFilterEmpty.hidden = visibleCount > 0;
    });
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
