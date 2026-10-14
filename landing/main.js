/* 租客管理系统 · 产品介绍页交互
   1) 视角切换（房东 / 租客）2) 滚动揭示 3) 开关指示块定位
   全部为渐进增强：脚本不执行时页面依然完整可读。 */
(() => {
  'use strict';

  const root = document.documentElement;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');

  /* ── 视角切换 ─────────────────────────────────────────────── */
  const COPY = {
    landlord: {
      title: '租客管理系统 — 公寓与长租的一体化管理后台',
      desc: '从签约到退租，把房源、租客、合同、账单、水电、报修、保洁收进一套系统。管理者用网页后台，租客与保洁用微信小程序。',
      label: '已切换到房东 / 运营视角',
    },
    tenant: {
      title: '租客管理系统 — 租客小程序：账单、余额、报修随时查',
      desc: '租客用微信小程序查看账单、账户余额、报修进度与合同，并可免登录浏览空置房源。',
      label: '已切换到租客视角',
    },
  };

  const sw = document.querySelector('.switch');
  const btns = sw ? Array.from(sw.querySelectorAll('[data-persona-btn]')) : [];
  const thumb = sw ? sw.querySelector('.switch__thumb') : null;
  const status = document.getElementById('persona-status');
  const metaDesc = document.querySelector('meta[name="description"]');

  const stored = (() => { try { return localStorage.getItem('tms-persona'); } catch { return null; } })();
  let persona = stored === 'tenant' || stored === 'landlord' ? stored : 'landlord';

  function placeThumb() {
    if (!sw || !thumb) return;
    const btn = sw.querySelector('[data-persona-btn="' + persona + '"]');
    if (!btn) return;
    thumb.style.width = btn.offsetWidth + 'px';
    thumb.style.transform = 'translateX(' + (btn.offsetLeft - 3) + 'px)';
  }

  /* 只让「刚刚出现」的元素做一次淡入，避免整块页面重新入场 */
  function animateShown() {
    if (reduce.matches) return;
    const targets = document.querySelectorAll(
      '[data-p="' + persona + '"], [data-cards="' + persona + '"], [data-card="' + persona + '"]'
    );
    targets.forEach((el) => {
      if (el.offsetParent === null) return;
      el.animate(
        [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }],
        { duration: 300, easing: 'cubic-bezier(.22,1,.36,1)' }
      );
    });
  }

  function applyPersona(next, opts) {
    const o = Object.assign({ persist: true, speak: true }, opts || {});
    persona = next;
    root.dataset.persona = next;
    if (sw) sw.dataset.active = next;
    btns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.personaBtn === next)));
    document.title = COPY[next].title;
    if (metaDesc) metaDesc.setAttribute('content', COPY[next].desc);
    if (o.persist) { try { localStorage.setItem('tms-persona', next); } catch (e) { /* 隐私模式忽略 */ } }
    if (o.speak && status) status.textContent = COPY[next].label;
    placeThumb();
    animateShown();
    refreshReveal();
  }

  btns.forEach((b) => b.addEventListener('click', () => applyPersona(b.dataset.personaBtn)));

  if (sw) {
    sw.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      const i = btns.findIndex((b) => b.dataset.personaBtn === persona);
      const next = e.key === 'ArrowRight' ? (i + 1) % btns.length : (i - 1 + btns.length) % btns.length;
      btns[next].focus();
      applyPersona(btns[next].dataset.personaBtn);
    });
  }

  /* ── 产品界面：标签切换（未启用脚本时 9 张图平铺，内容不丢） ── */
  const gallery = document.querySelector('[data-gallery]');
  if (gallery) {
    const tablist = gallery.querySelector('[role="tablist"]');
    const tabs = Array.from(gallery.querySelectorAll('[data-gallery-btn]'));
    const panels = Array.from(gallery.querySelectorAll('[data-gallery-panel]'));

    const ink = gallery.querySelector('.gallery__ink');

    if (tabs.length && panels.length && tablist) {
      const placeInk = function () {
        if (!ink) return;
        const active = tabs.find(function (t) { return t.getAttribute('aria-selected') === 'true'; });
        if (!active) return;
        ink.style.width = active.offsetWidth + 'px';
        ink.style.transform = 'translateX(' + active.offsetLeft + 'px)';
      };

      const select = function (key, focus) {
        tabs.forEach(function (t) {
          const on = t.dataset.galleryBtn === key;
          t.setAttribute('aria-selected', String(on));
          t.tabIndex = on ? 0 : -1; // 漫游 tabindex：整组只占一个 Tab 位
        });
        panels.forEach(function (panel) {
          const on = panel.dataset.galleryPanel === key;
          panel.hidden = !on;
          if (on && !reduce.matches) {
            panel.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 260, easing: 'cubic-bezier(.22,1,.36,1)' });
          }
        });
        placeInk();
        if (focus) {
          const t = tabs.find(function (x) { return x.dataset.galleryBtn === key; });
          if (t) t.focus();
        }
      };

      select(tabs[0].dataset.galleryBtn);
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(placeInk);
      window.addEventListener('resize', placeInk, { passive: true });
      tabs.forEach(function (t) { t.addEventListener('click', function () { select(t.dataset.galleryBtn); }); });

      tablist.addEventListener('keydown', function (e) {
        let next = null;
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
          const i = tabs.findIndex(function (t) { return t.getAttribute('aria-selected') === 'true'; });
          next = (i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
        } else if (e.key === 'Home') { next = 0; }
        else if (e.key === 'End') { next = tabs.length - 1; }
        if (next === null) return;
        e.preventDefault();
        select(tabs[next].dataset.galleryBtn, true);
      });
    }
  }

  /* ── 数字滚动 · 视差 · 光标光 ─────────────────────────────── */
  const counters = Array.from(document.querySelectorAll('.stats dt'));

  function countUp(el) {
    if (el.dataset.counted) return;
    const target = parseInt((el.textContent || '').replace(/[^0-9]/g, ''), 10);
    if (!isFinite(target)) return;
    el.dataset.counted = '1';
    if (reduce.matches || target < 2) return;
    const dur = 1200;
    const t0 = performance.now();
    const tick = function (now) {
      const p = Math.min(1, (now - t0) / dur);
      el.textContent = String(Math.round(target * (1 - Math.pow(1 - p, 4))));
      if (p < 1) requestAnimationFrame(tick); else el.textContent = String(target);
    };
    requestAnimationFrame(tick);
  }
  if (counters.length && !reduce.matches) {
    window.setTimeout(function () {
      counters.forEach(function (el, i) { window.setTimeout(function () { countUp(el); }, i * 90); });
    }, 620);
  }

  const stage = document.querySelector('.stage');
  const heroEl = document.querySelector('.hero');
  const cursor = document.getElementById('heroCursor');
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

  if (!reduce.matches) {
    let queued = false;
    const onScroll = function () {
      if (queued) return;
      queued = true;
      requestAnimationFrame(function () {
        if (stage) {
          const top = stage.getBoundingClientRect().top;
          // 只在这一屏内做小幅位移，滚过去就不再计算
          if (top < window.innerHeight && top > -stage.offsetHeight) {
            const p = (window.innerHeight - top) / (window.innerHeight + stage.offsetHeight);
            stage.style.setProperty('--py', ((p - 0.5) * -46).toFixed(1) + 'px');
          }
        }
        queued = false;
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  if (cursor && heroEl && finePointer && !reduce.matches) {
    heroEl.addEventListener('pointermove', function (e) {
      const r = heroEl.getBoundingClientRect();
      cursor.style.setProperty('--cx', (e.clientX - r.left) + 'px');
      cursor.style.setProperty('--cy', (e.clientY - r.top) + 'px');
      cursor.style.opacity = '1';
    }, { passive: true });
    heroEl.addEventListener('pointerleave', function () { cursor.style.opacity = '0'; });
  }

  /* ── 滚动揭示（默认内容可见，仅做增强） ───────────────────── */
  // 画廊面板由标签切换控制显隐，不参与滚动揭示（否则切过去时可能仍是隐藏态）
  const REVEAL = '.head, .role, .card, .flow, .split__copy, .shot:not([role="tabpanel"]), .stacked-shots .shot, .phone-wrap, .stack__col, .status__col, .faq, .gallery__tabs, .cta';
  let io = null;

  function refreshReveal() {
    if (!io) return;
    document.querySelectorAll(REVEAL).forEach((el) => {
      if (el.classList.contains('is-in') || el.classList.contains('will-reveal')) return;
      el.classList.add('will-reveal');
      io.observe(el);
    });
    // 切换视角后，新出现的元素可能已经落在视口内
    document.querySelectorAll('.will-reveal:not(.is-in)').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.top < window.innerHeight * 0.92 && r.bottom > 0) io.observe(el);
    });
  }

  if ('IntersectionObserver' in window && !reduce.matches) {
    io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const el = entry.target;
          io.unobserve(el);
          // 同一组内依次出现，而不是整齐划一地一起淡入
          const group = el.parentElement ? Array.from(el.parentElement.children).indexOf(el) : 0;
          el.style.animationDelay = Math.min(group, 6) * 55 + 'ms';
          el.classList.add('is-in');
        });
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.08 }
    );
    refreshReveal();
  }

  /* ── 其他 ─────────────────────────────────────────────────── */
  let raf = 0;
  window.addEventListener('resize', () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(placeThumb); }, { passive: true });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(placeThumb);
  window.addEventListener('pageshow', (e) => { if (e.persisted) applyPersona(persona, { persist: false, speak: false }); });

  applyPersona(persona, { persist: false, speak: false });
})();
