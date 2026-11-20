(function (root) {
  'use strict';

  function create({ rules, el, doc, win, getState, getHero, intentLabel, setStatus }) {
    let heartsCache = '';
    let sidePrev = null, sideSim = null, hudTick = 0;

    function sideDelta(side, amount) {
      if (!(amount > 0)) return;
      const panel = el(side === 'hero' ? 'cx-side-hero' : 'cx-side-rival');
      const box = el(side === 'hero' ? 'cx-delta-hero' : 'cx-delta-rival');
      if (panel) {
        panel.classList.add('hurt');
        root.clearTimeout(panel._hurtTimer);
        panel._hurtTimer = root.setTimeout(() => panel.classList.remove('hurt'), 220);
      }
      if (!box) return;
      box.textContent = `-${amount}`;
      box.hidden = false;
      box.style.animation = 'none';
      void box.offsetWidth;
      box.style.animation = '';
      root.clearTimeout(box._hideTimer);
      box._hideTimer = root.setTimeout(() => { box.hidden = true; }, 860);
    }

    function heartsPips(box, hearts, max) {
      for (let i = 0; i < max; i++) {
        const pip = doc.createElement('span');
        pip.className = 'as-pip';
        if (i < hearts) pip.classList.add('on');
        box.appendChild(pip);
      }
    }

    function render() {
      const { sim, zone } = getState();
      if (!sim) return;
      const p = sim.player, rival = sim.enemies[0];
      const heroNameEl = el('arena-preview-hero'), rivalNameEl = el('arena-preview-rival');
      if (heroNameEl) heroNameEl.textContent = (rules.CHARACTERS && rules.CHARACTERS[getHero()] && rules.CHARACTERS[getHero()].name) || 'المحارب';
      if (rivalNameEl && rival) rivalNameEl.textContent = rival.name || 'المبارز';
      const heroPct = Math.max(0, Math.min(100, (p.hearts / Math.max(1, p.maxHearts)) * 100));
      const rivalPct = rival ? Math.max(0, Math.min(100, (rival.hp / Math.max(1, rival.maxHp)) * 100)) : 0;
      const heroBar = el('arena-hp-hero'), rivalBar = el('arena-hp-rival');
      const skillBtn = doc.querySelector('#arena-pad [data-duel-input="32"]');
      if (skillBtn) {
        const ready = p.skillCooldown <= 0 && p.guard.broken <= 0 && p.guard.stamina >= rules.DUEL.skill.cost && !p.skill;
        skillBtn.classList.toggle('ready', ready);
        skillBtn.classList.toggle('cool', !ready);
        skillBtn.setAttribute('aria-disabled', ready ? 'false' : 'true');
        skillBtn.dataset.cd = String(Math.max(0, Math.ceil(p.skillCooldown / (rules.FPS || 60))));
      }
      if (heroBar) heroBar.style.width = `${heroPct}%`;
      if (rivalBar) rivalBar.style.width = `${rivalPct}%`;
      const ghostHero = el('arena-ghost-hero'), ghostRival = el('arena-ghost-rival');
      if (ghostHero) ghostHero.style.width = `${heroPct}%`;
      if (ghostRival) ghostRival.style.width = `${rivalPct}%`;
      const heartsBox = el('arena-hearts-hero');
      if (heartsBox) {
        const max = Math.max(1, p.maxHearts), key = `${p.hearts}/${max}`;
        if (key !== heartsCache) {
          heartsCache = key;
          heartsBox.textContent = '';
          heartsPips(heartsBox, p.hearts, max);
        }
      }
      const heroEn = el('arena-en-hero');
      if (heroEn) heroEn.style.width = `${Math.max(0, Math.min(100, 100 - (p.skillCooldown || 0) / Math.max(1, p.skillMaxCooldown || 1) * 100))}%`;
      const rivalEn = el('arena-en-rival');
      if (rivalEn && rival) {
        const walk = Math.max(1, rival.ai?.walk || 30);
        rivalEn.style.width = `${Math.max(0, Math.min(100, 100 - (rival.timer || 0) / walk * 100))}%`;
      }
      const timerEl = el('arena-timer');
      if (timerEl) timerEl.textContent = String(Math.max(0, Math.ceil((rules.MAX_TICKS - sim.tick) / rules.FPS)));
      const roundEl = el('arena-round');
      if (roundEl) roundEl.textContent = sim.status === 'playing' ? 'مبارزة' : (sim.status === 'won' ? 'انتصار' : 'خسارة');
      const heroPanel = el('cx-side-hero'), rivalPanel = el('cx-side-rival');
      const zoneNow = Number.isInteger(sim.zone) ? sim.zone : zone;
      const lvlRival = el('cx-lvl-rival');
      if (lvlRival) lvlRival.textContent = `مستوى ${zoneNow + 1}`;
      const hpNum = el('cx-hpnum-rival');
      if (hpNum && rival) hpNum.textContent = `${Math.max(0, Math.round(rival.hp))}/${Math.round(rival.maxHp || rival.hp)}`;
      const guardBar = el('cx-guard-hero');
      if (guardBar) guardBar.style.width = `${Math.max(0, Math.min(100, (p.guard?.stamina || 0) / Math.max(1, p.guard?.maxStamina || 1) * 100))}%`;
      const skillReady = p.skillCooldown <= 0 && (p.guard?.broken || 0) <= 0
        && (p.guard?.stamina || 0) >= (rules.DUEL?.skill?.cost || 0) && !p.skill;
      if (heroPanel) {
        heroPanel.classList.toggle('guard', Boolean(p.guard && p.guard.active));
        heroPanel.classList.toggle('dodge', (p.dodge?.ticks || 0) > 0);
        heroPanel.classList.toggle('skillready', skillReady);
        heroPanel.classList.toggle('low', p.hearts <= 1);
      }
      if (rivalPanel) rivalPanel.classList.toggle('low', Boolean(rival) && rival.hp / Math.max(1, rival.maxHp) <= 0.25);
      const danger = el('cx-danger');
      if (danger) danger.hidden = !(sim.status === 'playing' && p.hearts <= 1);
      const centerBox = timerEl ? timerEl.parentElement : null;
      if (centerBox) centerBox.classList.toggle('urgent', sim.status === 'playing' && (rules.MAX_TICKS - sim.tick) / rules.FPS <= 15);
      const heartsNow = p.hearts;
      const rivalNow = rival ? Math.max(0, Math.round(rival.hp)) : 0;
      if (sideSim !== sim) { sideSim = sim; sidePrev = null; }
      if (sidePrev && sim.status === 'playing') {
        if (heartsNow < sidePrev.hearts) sideDelta('hero', sidePrev.hearts - heartsNow);
        if (rivalNow < sidePrev.rival) sideDelta('rival', sidePrev.rival - rivalNow);
      }
      sidePrev = { hearts: heartsNow, rival: rivalNow };
      if (++hudTick % 30 === 1) {
        const pad = el('arena-pad');
        let shown = Boolean(pad) && !pad.hidden;
        if (shown && typeof win.getComputedStyle === 'function') {
          try { shown = win.getComputedStyle(pad).display !== 'none'; } catch (_) { shown = true; }
        }
        let padH = 0;
        if (shown && pad && typeof pad.getBoundingClientRect === 'function') {
          padH = Math.round(pad.getBoundingClientRect().height) || 0;
        }
        const rootStyle = doc.documentElement && doc.documentElement.style;
        if (rootStyle && typeof rootStyle.setProperty === 'function') {
          rootStyle.setProperty('--cx-pad-h', `${Math.max(0, padH)}px`);
        }
      }

      if (sim.status === 'playing') {
        const intent = rival && rival.state === 'windup' ? intentLabel[rival.attack] || 'هجوم' : '';
        const parts = [];
        if (p.combo >= 2) parts.push(`سلسلة ×${p.combo}`);
        if (p.guard) parts.push(`درع ${Math.round(100 * p.guard.stamina / Math.max(1, p.guard.maxStamina))}%`);
        if (intent) parts.push(intent);
        setStatus(parts.join(' · '));
      }
    }

    return {
      render,
      reset: () => { heartsCache = ''; },
    };
  }

  root.PlatformDuelHud = { create };
})(typeof globalThis !== 'undefined' ? globalThis : this);
