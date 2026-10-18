/* 栖居 · 产品介绍页交互
   原则：无脚本时房东视角内容完整可读（显隐由 styles.css 的 html[data-persona] 规则驱动），
   脚本只负责「切换」与渐进增强。所有动效在 prefers-reduced-motion 下降级。 */
(() => {
  'use strict';

  const root = document.documentElement;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');

  const COPY = {
    landlord: {
      title: '栖居 · 收租、水电、报修、退租，收进同一本台账',
      description:
        '栖居是面向房东、二房东与公寓运营者的租客管理系统：房源房态、电子合同、账单收款、滞纳金核销、预付账户、水电计费、报修派单与退租结算，全链路留痕可对账。',
    },
    tenant: {
      title: '栖居 · 房租、水电、报修、退租，一部手机看得清楚',
      description:
        '栖居租客端微信小程序：合同、账单明细、缴付单据、报修进度、预付余额与电子收据都在手机里，每一步都看得见。',
    },
  };

  /* ---------- 视角切换 ---------- */
  const switchEl = document.querySelector('.switch');
  const thumb = switchEl && switchEl.querySelector('.switch__thumb');
  const personaBtns = [...document.querySelectorAll('[data-persona-btn]')];
  const live = document.getElementById('persona-status');

  const readPersona = () => {
    try {
      return localStorage.getItem('qiju-persona') === 'tenant' ? 'tenant' : 'landlord';
    } catch {
      return 'landlord';
    }
  };

  function moveThumb(btn) {
    if (!thumb || !btn) return;
    thumb.style.transform = `translateX(${btn.offsetLeft - 3}px)`;
    thumb.style.width = `${btn.offsetWidth}px`;
  }

  function animateShown() {
    if (reduce.matches) return;
    document.querySelectorAll('[data-p], [data-cards], [data-card]').forEach((el) => {
      if (el.offsetParent === null) return;
      el.animate(
        [
          { opacity: 0, transform: 'translateY(10px)' },
          { opacity: 1, transform: 'none' },
        ],
        { duration: 300, easing: 'cubic-bezier(.22,1,.36,1)' },
      );
    });
  }

  function applyPersona(next, opts = {}) {
    const persona = next === 'tenant' ? 'tenant' : 'landlord';
    root.dataset.persona = persona;

    personaBtns.forEach((b) => {
      const on = b.dataset.personaBtn === persona;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', String(on));
      if (on) moveThumb(b);
    });

    const copy = COPY[persona];
    document.title = copy.title;
    const meta = document.querySelector('meta[name="description"]');
    if (meta) meta.setAttribute('content', copy.description);

    try {
      localStorage.setItem('qiju-persona', persona);
    } catch {
      /* 隐私模式下忽略 */
    }

    if (live && !opts.silent) {
      live.textContent = persona === 'tenant' ? '已切换到租客视角' : '已切换到房东视角';
    }
    animateShown();
    refreshReveal();
  }

  personaBtns.forEach((btn) => {
    btn.addEventListener('click', () => applyPersona(btn.dataset.personaBtn));
  });

  if (switchEl) {
    switchEl.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      applyPersona(root.dataset.persona === 'tenant' ? 'landlord' : 'tenant');
    });
  }

  /* ---------- 界面画廊 ---------- */
  const tabs = [...document.querySelectorAll('.gallery__tabs [role="tab"]')];
  const ink = document.querySelector('.gallery__ink');

  function moveInk(tab) {
    if (!ink || !tab) return;
    const host = ink.parentElement.getBoundingClientRect();
    const r = tab.getBoundingClientRect();
    // 标签在窄屏会折成两行，指示块必须跟着当前标签走，不能撑满整个容器
    ink.style.left = `${r.left - host.left}px`;
    ink.style.top = `${r.top - host.top}px`;
    ink.style.width = `${r.width}px`;
    ink.style.height = `${r.height}px`;
  }

  function selectTab(tab, focus = false) {
    tabs.forEach((t) => {
      const on = t === tab;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      t.classList.toggle('is-on', on);
      const panel = document.getElementById(t.getAttribute('aria-controls'));
      if (panel) {
        panel.hidden = !on;
        if (on && !reduce.matches) {
          panel.animate(
            [
              { opacity: 0, transform: 'translateY(8px)' },
              { opacity: 1, transform: 'none' },
            ],
            { duration: 260, easing: 'ease-out' },
          );
        }
      }
    });
    moveInk(tab);
    if (focus) tab.focus();
  }

  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => selectTab(tab));
    tab.addEventListener('keydown', (e) => {
      const map = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 };
      if (!(e.key in map)) return;
      e.preventDefault();
      const next = tabs[(map[e.key] + tabs.length) % tabs.length];
      selectTab(next, true);
    });
  });

  /* ---------- 数字滚动 ---------- */
  function countUp(el) {
    if (el.dataset.counted) return;
    el.dataset.counted = '1';
    const target = Number(el.textContent.replace(/[^\d.]/g, ''));
    if (!Number.isFinite(target) || target < 2 || reduce.matches) return;
    const dur = 1200;
    const start = performance.now();
    const step = (now) => {
      const p = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - p, 4);
      el.textContent = String(Math.round(target * eased));
      if (p < 1) requestAnimationFrame(step);
      else el.textContent = String(target);
    };
    requestAnimationFrame(step);
  }

  /* ---------- 滚动揭示 ---------- */
  const REVEAL = [
    '.head', '.role', '.cap', '.flow', '.steps li', '.split__media > *',
    '.shot', '.stack__col', '.chips li', '.faq__item', '.cta__trust li',
  ].join(',');

  let observer = null;
  if ('IntersectionObserver' in window) {
    observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add('is-in');
          observer.unobserve(entry.target);
          if (entry.target.matches('.stats')) {
            [...entry.target.querySelectorAll('dt')].forEach((dt, i) =>
              setTimeout(() => countUp(dt), i * 90),
            );
          }
        });
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.08 },
    );
  }

  function refreshReveal() {
    if (!observer) return;
    if (reduce.matches) {
      document.querySelectorAll('.will-reveal').forEach((el) => el.classList.add('is-in'));
      return;
    }
    document.querySelectorAll(REVEAL).forEach((el, i) => {
      if (el.classList.contains('will-reveal') || el.classList.contains('is-in')) return;
      if (el.offsetParent === null) return;
      el.classList.add('will-reveal');
      el.style.animationDelay = `${Math.min(i, 6) * 55}ms`;
      observer.observe(el);
    });
    const stats = document.querySelector('.stats');
    if (stats && !stats.classList.contains('is-in')) {
      observer.observe(stats);
    }
  }

  /* ---------- 指针光 ---------- */
  const hero = document.querySelector('.hero');
  const heroBg = document.querySelector('.hero__bg');
  if (hero && window.matchMedia('(hover: hover) and (pointer: fine)').matches && !reduce.matches) {
    let raf = 0;
    hero.addEventListener('pointermove', (e) => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const r = hero.getBoundingClientRect();
        hero.style.setProperty('--cx', `${e.clientX - r.left}px`);
        hero.style.setProperty('--cy', `${e.clientY - r.top}px`);
        if (heroBg) heroBg.classList.add('is-live');
      });
    });
  }

  /* ---------- 启动 ---------- */
  const start = () => {
    applyPersona(readPersona(), { silent: true });
    const firstRender = () => {
      moveThumb(document.querySelector('[data-persona-btn].is-on'));
      const onTab = tabs.find((t) => t.getAttribute('aria-selected') === 'true');
      if (onTab) moveInk(onTab);
    };
    firstRender();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(firstRender);
    refreshReveal();
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();

  window.addEventListener('resize', () => {
    moveThumb(document.querySelector('[data-persona-btn].is-on'));
    const onTab = tabs.find((t) => t.getAttribute('aria-selected') === 'true');
    if (onTab) moveInk(onTab);
  });

  window.addEventListener('pageshow', (e) => {
    if (e.persisted) applyPersona(readPersona(), { silent: true });
  });
})();
