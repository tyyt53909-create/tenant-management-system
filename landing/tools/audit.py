"""对比度审计 + 移动端留白复查。"""
import json
import os
from playwright.sync_api import sync_playwright

BASE = os.environ.get("LANDING_BASE", "http://127.0.0.1:5180/index.html")

AUDIT = """() => {
  const lum = (c) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
  };
  const parse = (s) => {
    const m = s.match(/rgba?\\(([^)]+)\\)/); if (!m) return null;
    const p = m[1].split(/[,\\s\\/]+/).filter(Boolean).map(Number);
    return { c: [p[0], p[1], p[2]], a: p.length > 3 ? p[3] : 1 };
  };
  const bgOf = (el) => {
    // 选中态的底色画在兄弟节点上（.switch__thumb / .gallery__ink 这类绝对定位滑块），
    // 祖先回溯看不到，会误判成白底白字。先取同容器内带背景的绝对定位兄弟节点。
    if (el.classList.contains('is-on') && el.parentElement) {
      const ink = [...el.parentElement.children].find((c) =>
        c !== el && getComputedStyle(c).position === 'absolute');
      if (ink) { const b = parse(getComputedStyle(ink).backgroundColor); if (b && b.a > 0.92) return b.c; }
    }
    let n = el;
    while (n && n !== document.documentElement) {
      const b = parse(getComputedStyle(n).backgroundColor);
      if (b && b.a > 0.92) return b.c;
      n = n.parentElement;
    }
    return [255, 255, 255];
  };
  const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); const hi = Math.max(l1, l2), lo = Math.min(l1, l2); return (hi + 0.05) / (lo + 0.05); };
  const out = [];
  // 说明：.mp-* 是手机 mockup 内部的示意内容（role=img + aria-label 描述），
  // 属于图片性质，与真实截图一样不参与对比度审计。
  const sel = 'p, li, h1, h2, h3, dt, dd, figcaption, summary, code, .kicker, .brand__text strong, .brand__text small, .nav__links a, .float, .btn, .switch__opt, .gallery__tabs button, .chips li, .role__badge, .role li, .cap span, .cap p, .flow__no, .flow h3, .flow p, .stack__col b, .stack__col span, .status__note dd, .foot__legal, .foot__links a, .stats dd, .steps b, .steps span, .cta__trust li, .shot figcaption';
  document.querySelectorAll(sel).forEach((el) => {
    if (el.offsetParent === null) return;
    const t = (el.textContent || '').trim();
    if (!t) return;
    const cs = getComputedStyle(el);
    const fg = parse(cs.color); if (!fg || fg.a < 0.5) return;
    const size = parseFloat(cs.fontSize);
    const weight = parseInt(cs.fontWeight, 10) || 400;
    const large = size >= 24 || (size >= 18.66 && weight >= 700);
    const r = ratio(fg.c, bgOf(el));
    const need = large ? 3 : 4.5;
    if (r < need) out.push({ t: t.slice(0, 34), size: Math.round(size), weight, r: Math.round(r * 100) / 100, need, cls: el.className.toString().slice(0, 40) });
  });
  return out;
}"""

with sync_playwright() as p:
    b = p.chromium.launch(channel="chrome", headless=True)
    ctx = b.new_context(viewport={"width": 1440, "height": 940}, locale="zh-CN")
    pg = ctx.new_page()
    pg.goto(BASE, wait_until="networkidle")
    pg.evaluate("document.documentElement.style.scrollBehavior='auto'")
    pg.wait_for_timeout(600)
    for persona in ("landlord", "tenant"):
        pg.click('[data-persona-btn="%s"]' % persona)
        pg.wait_for_timeout(600)
        fails = pg.evaluate(AUDIT)
        print("CONTRAST %s: %d 处不达标" % (persona, len(fails)))
        for f in fails[:12]:
            print("   ", json.dumps(f, ensure_ascii=False))
    # 移动端
    m = b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, locale="zh-CN", is_mobile=True)
    mp = m.new_page(); mp.goto(BASE, wait_until="networkidle")
    mp.evaluate("document.documentElement.style.scrollBehavior='auto'"); mp.wait_for_timeout(800)
    gaps = mp.evaluate("""() => {
      const c = document.querySelector('.hero__copy'), s = document.querySelector('.stage');
      const r = (el) => { const b = el.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom), w: Math.round(b.width), h: Math.round(b.height) }; };
      return { copyBottom: Math.round(c.getBoundingClientRect().bottom), stageTop: Math.round(s.getBoundingClientRect().top),
               stageH: Math.round(s.getBoundingClientRect().height),
               // 手机屏高会随宽度变窄而暴涨；窄屏应改为静态排版，绝不能是 absolute 压住上方文案
               phones: [...document.querySelectorAll('.stage__phone')].map(e => ({ pos: getComputedStyle(e).position, box: r(e) })) };
    }""")
    print("MOBILE gap:", json.dumps(gaps, ensure_ascii=False))
    b.close()
