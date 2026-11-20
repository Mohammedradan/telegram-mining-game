(function (root) {
  'use strict';

  const CONTROL_DEFAULTS = { size: 'md', opacity: 'md', sensitivity: 'md', haptics: true, touchPad: 'auto' };
  const CONTROL_SIZES = { sm: 0.86, md: 1, lg: 1.18 };
  const CONTROL_OPACITY = { sm: 0.55, md: 0.78, lg: 1 };
  const JOYSTICK_SENSITIVITY = { lg: 0.14, md: 0.2, sm: 0.28 };
  const TOUCH_ORDER = ['auto', 'show', 'hide'];
  const LAYOUT_KEY = 'platform-control-layout';
  const LAYOUT_LIMIT = 150;

  function create({ el, joystick, clearInput, pause, say, haptic, isRunning, isPaused }) {
    let controlSettings = { ...CONTROL_DEFAULTS };
    try {
      const saved = JSON.parse(root.localStorage.getItem('platform-controls') || 'null');
      if (saved && typeof saved === 'object') controlSettings = { ...CONTROL_DEFAULTS, ...saved };
    } catch (_) {}
    let joystickDeadZone = JOYSTICK_SENSITIVITY[controlSettings.sensitivity] || 0.2;
    let controlLayout = {};
    try {
      const savedLayout = JSON.parse(root.localStorage.getItem(LAYOUT_KEY) || 'null');
      if (savedLayout && typeof savedLayout === 'object') {
        for (const [key, value] of Object.entries(savedLayout)) {
          if (value && Number.isFinite(Number(value.x)) && Number.isFinite(Number(value.y))) {
            controlLayout[key] = { x: clampOff(value.x), y: clampOff(value.y) };
          }
        }
      }
    } catch (_) { controlLayout = {}; }
    let layoutEditing = false;

    function clampOff(value) {
      return Math.max(-LAYOUT_LIMIT, Math.min(LAYOUT_LIMIT, Math.round(Number(value) || 0)));
    }

    function touchPadVisible() {
      const mode = controlSettings.touchPad || 'auto';
      if (mode === 'show') return true;
      if (mode === 'hide') return false;
      try {
        if (root.matchMedia && root.matchMedia('(pointer: coarse)').matches) return true;
      } catch (_) {}
      return (root.navigator.maxTouchPoints || 0) > 0;
    }

    function applyControlSettings() {
      const box = root.document.querySelector('.mine-controls');
      if (box && box.style) {
        box.style.setProperty('--ctl-scale', String(CONTROL_SIZES[controlSettings.size] || 1));
        box.style.setProperty('--ctl-opacity', String(CONTROL_OPACITY[controlSettings.opacity] || 0.78));
      }
      joystickDeadZone = JOYSTICK_SENSITIVITY[controlSettings.sensitivity] || 0.2;
      root.document.querySelectorAll('[data-ctl-size]').forEach(button => button.classList.toggle('active', button.dataset.ctlSize === controlSettings.size));
      root.document.querySelectorAll('[data-ctl-opacity]').forEach(button => button.classList.toggle('active', button.dataset.ctlOpacity === controlSettings.opacity));
      root.document.querySelectorAll('[data-ctl-sensitivity]').forEach(button => button.classList.toggle('active', button.dataset.ctlSensitivity === controlSettings.sensitivity));
      const hapticButton = el('ctl-haptics');
      if (hapticButton) {
        hapticButton.setAttribute('aria-pressed', String(controlSettings.haptics !== false));
        hapticButton.classList.toggle('active', controlSettings.haptics !== false);
      }
      const padShown = touchPadVisible();
      if (box && box.classList) box.classList.toggle('touch-hidden', !padShown);
      const stickButton = el('ctl-stick');
      if (stickButton) {
        const mode = controlSettings.touchPad || 'auto';
        stickButton.setAttribute('aria-pressed', String(padShown));
        stickButton.classList.toggle('active', padShown);
        stickButton.textContent = mode === 'auto' ? 'تلقائي' : padShown ? 'ظاهرة دائمًا' : 'مخفية دائمًا';
      }
      const keyHint = el('platform-keyhint');
      if (keyHint) keyHint.hidden = padShown;
    }

    function saveControlSettings() {
      try { root.localStorage.setItem('platform-controls', JSON.stringify(controlSettings)); } catch (_) {}
      applyControlSettings();
    }

    function layoutKeyOf(node) {
      return joystick && node === joystick ? 'joy' : String(node && node.dataset ? node.dataset.platformInput ?? '' : '');
    }

    function applyControlLayout() {
      const targets = [joystick, ...root.document.querySelectorAll('[data-platform-input]')].filter(Boolean);
      for (const node of targets) {
        const offset = controlLayout[layoutKeyOf(node)];
        if (node.style) node.style.translate = offset ? `${offset.x}px ${offset.y}px` : '';
      }
    }

    function saveControlLayout() {
      try { root.localStorage.setItem(LAYOUT_KEY, JSON.stringify(controlLayout)); } catch (_) {}
    }

    function setLayoutEditing(on) {
      layoutEditing = Boolean(on);
      root.document.querySelector('.mine-controls')?.classList?.toggle('ctl-editing', layoutEditing);
      const button = el('ctl-edit');
      if (button) {
        button.classList.toggle('active', layoutEditing);
        button.setAttribute('aria-pressed', String(layoutEditing));
      }
      const hint = el('ctl-layout-hint');
      if (hint) hint.hidden = !layoutEditing;
      const modal = el('ctl-modal');
      if (modal?.classList) {
        const hasEditingClass = modal.classList.contains('ctl-modal--editing');
        if (layoutEditing && !hasEditingClass) modal.classList.add('ctl-modal--editing');
        else if (!layoutEditing && hasEditingClass) modal.classList.remove('ctl-modal--editing');
      }
      if (layoutEditing) {
        clearInput();
        pause();
        say('وضع التحريك: اسحب العصا والأزرار إلى موضعها المريح.');
      } else {
        say('توقف التحريك؛ المواضع محفوظة على هذا الجهاز.');
      }
    }

    function openCtlSettings() {
      const modal = el('ctl-modal');
      if (!modal) return false;
      if (isRunning() && !isPaused()) pause();
      modal.hidden = false;
      const details = el('ctl-settings');
      if (details) details.open = true;
      const close = el('ctl-modal-close');
      try { close?.focus?.({ preventScroll: true }); } catch (_) {}
      haptic('light');
      return true;
    }

    function closeCtlSettings() {
      const modal = el('ctl-modal');
      if (!modal || modal.hidden) return false;
      if (layoutEditing) setLayoutEditing(false);
      modal.hidden = true;
      const opener = el('open-ctl-settings');
      try { opener?.focus?.({ preventScroll: true }); } catch (_) {}
      return true;
    }

    function bindLayoutDrag(node) {
      if (!node) return;
      node.addEventListener('pointerdown', event => {
        if (!layoutEditing) return;
        event.preventDefault();
        event.stopPropagation();
        const key = layoutKeyOf(node);
        const base = controlLayout[key] || { x: 0, y: 0 };
        const originX = event.clientX, originY = event.clientY;
        let moved = false;
        node.setPointerCapture?.(event.pointerId);
        const onMove = moveEvent => {
          if (moveEvent.pointerId !== event.pointerId) return;
          if (!moved && Math.abs(moveEvent.clientX - originX) + Math.abs(moveEvent.clientY - originY) > 3) moved = true;
          controlLayout[key] = {
            x: clampOff(base.x + moveEvent.clientX - originX),
            y: clampOff(base.y + moveEvent.clientY - originY),
          };
          applyControlLayout();
        };
        const onUp = upEvent => {
          if (upEvent.pointerId !== event.pointerId) return;
          node.removeEventListener('pointermove', onMove);
          node.removeEventListener('pointerup', onUp);
          node.removeEventListener('pointercancel', onUp);
          if (moved) {
            saveControlLayout();
            say('حُفظ الموضع على هذا الجهاز.');
          }
        };
        node.addEventListener('pointermove', onMove);
        node.addEventListener('pointerup', onUp);
        node.addEventListener('pointercancel', onUp);
      });
    }

    root.document.querySelectorAll('[data-ctl-size]').forEach(button => button.addEventListener('click', () => {
      controlSettings.size = button.dataset.ctlSize;
      saveControlSettings();
    }));
    root.document.querySelectorAll('[data-ctl-opacity]').forEach(button => button.addEventListener('click', () => {
      controlSettings.opacity = button.dataset.ctlOpacity;
      saveControlSettings();
    }));
    root.document.querySelectorAll('[data-ctl-sensitivity]').forEach(button => button.addEventListener('click', () => {
      controlSettings.sensitivity = button.dataset.ctlSensitivity;
      saveControlSettings();
    }));
    el('ctl-haptics')?.addEventListener('click', () => {
      controlSettings.haptics = controlSettings.haptics === false;
      saveControlSettings();
    });
    el('ctl-stick')?.addEventListener('click', () => {
      const index = TOUCH_ORDER.indexOf(controlSettings.touchPad || 'auto');
      controlSettings.touchPad = TOUCH_ORDER[(index + 1) % TOUCH_ORDER.length];
      saveControlSettings();
    });
    try { root.matchMedia?.('(pointer: coarse)')?.addEventListener?.('change', applyControlSettings); } catch (_) {}
    applyControlSettings();

    el('ctl-edit')?.addEventListener('click', () => setLayoutEditing(!layoutEditing));
    el('open-ctl-settings')?.addEventListener('click', openCtlSettings);
    el('ctl-modal-close')?.addEventListener('click', closeCtlSettings);
    root.document.querySelector('.ctl-modal-backdrop')?.addEventListener('click', closeCtlSettings);
    root.document.addEventListener('keydown', event => { if (event.key === 'Escape') closeCtlSettings(); });
    el('ctl-reset')?.addEventListener('click', () => {
      controlLayout = {};
      try { root.localStorage.removeItem(LAYOUT_KEY); } catch (_) {}
      controlSettings = { ...CONTROL_DEFAULTS };
      saveControlSettings();
      applyControlLayout();
      say('أُعيد الوضع الافتراضي للتحكم.');
    });
    for (const node of [joystick, ...root.document.querySelectorAll('[data-platform-input]')]) bindLayoutDrag(node);
    applyControlLayout();

    return {
      joystickDeadZone: () => joystickDeadZone,
      hapticsEnabled: () => controlSettings.haptics !== false,
      layoutEditing: () => layoutEditing,
      setLayoutEditing,
      openCtlSettings,
      closeCtlSettings,
    };
  }

  root.PlatformControlSettings = { create };
})(typeof globalThis !== 'undefined' ? globalThis : this);
