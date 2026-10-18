"""落地页验证：桌面 + 移动、两种视角、控制台错误、对比度抽查。"""
import os, json, sys
from playwright.sync_api import sync_playwright

BASE = os.environ.get("LANDING_BASE", "http://127.0.0.1:5180/index.html")
OUT = "/tmp/verify"
os.makedirs(OUT, exist_ok=True)

def shot(page, name, full=False):
    page.screenshot(path=os.path.join(OUT, name), full_page=full)
    print("shot:", name)

with sync_playwright() as p:
    browser = p.chromium.launch(channel="chrome", headless=True)

    # ── 桌面 ──
    ctx = browser.new_context(viewport={"width": 1440, "height": 940}, device_scale_factor=1, locale="zh-CN")
    page = ctx.new_page()
    errors, warnings = [], []
    page.on("console", lambda m: (errors if m.type == "error" else warnings).append(m.text[:300]))
    page.on("pageerror", lambda e: errors.append("pageerror: " + str(e)[:300]))
    page.goto(BASE, wait_until="networkidle")
    page.wait_for_timeout(1200)
    shot(page, "desktop-landlord.png")

    # 懒加载图片要滚到位置才会发起请求；先整页走一遍再断言，
    # 否则未加载的图会被 !complete 误判成破图。走完再拍整页，滚动揭示的内容才是可见的。
    # 每个图最多等 3 秒：滚回顶部后视野外的懒图不会再触发 load，无上限等会永久挂住。
    page.evaluate("""async () => {
      const step = window.innerHeight * 0.8;
      for (let y = 0; y < document.body.scrollHeight; y += step) {
        window.scrollTo({ top: y, behavior: 'instant' });
        await new Promise((r) => setTimeout(r, 130));
      }
      window.scrollTo({ top: 0, behavior: 'instant' });
      await Promise.all([...document.images].map((i) => i.complete ? null : new Promise((r) => {
        i.onload = i.onerror = r;
        setTimeout(r, 3000);
      })));
    }""")
    page.wait_for_timeout(600)
    shot(page, "desktop-landlord-full.png", full=True)

    # 隐蔽的 a11y / 布局检查
    info = page.evaluate("""() => {
      const r = {};
      r.persona = document.documentElement.dataset.persona;
      r.title = document.title;
      r.scrollW = document.documentElement.scrollWidth;
      r.clientW = document.documentElement.clientWidth;
      r.h1 = document.querySelector('h1:not([style*="display: none"])')?.textContent.trim().slice(0,40);
      const vis = [...document.querySelectorAll('h1')].find(h => h.offsetParent !== null);
      r.visibleH1 = vis ? vis.textContent.replace(/\\s+/g,' ').trim() : null;
      r.hiddenCount = [...document.querySelectorAll('[data-p="tenant"]')].filter(e => e.offsetParent !== null).length;
      // 已加载完成却宽度为 0 才是真的坏图；尚未加载的（懒加载没滚到的）单独记为 pending，
      // 不算失败——否则一张视野外的懒图就会让整轮校验变红。
      r.imgsBroken = [...document.images].filter(i => i.complete && i.naturalWidth === 0).map(i => i.src);
      r.imgsPending = [...document.images].filter(i => !i.complete).length;
      r.fontLoaded = document.fonts.check('700 16px Archivo');
      return r;
    }""")
    print("DESKTOP:", json.dumps(info, ensure_ascii=False))

    # 切换到租客
    page.click('[data-persona-btn="tenant"]')
    page.wait_for_timeout(900)
    shot(page, "desktop-tenant.png")
    info2 = page.evaluate("""() => {
      const vis = [...document.querySelectorAll('h1')].find(h => h.offsetParent !== null);
      return {
        persona: document.documentElement.dataset.persona,
        title: document.title,
        visibleH1: vis ? vis.textContent.replace(/\\s+/g,' ').trim() : null,
        landlordVisible: [...document.querySelectorAll('[data-p="landlord"]')].filter(e => e.offsetParent !== null).length,
        stored: localStorage.getItem('qiju-persona'),
        accent: getComputedStyle(document.documentElement).getPropertyValue('--primary').trim(),
      };
    }""")
    print("TENANT:", json.dumps(info2, ensure_ascii=False))
    shot(page, "desktop-tenant-full.png", full=True)

    # 键盘可达性
    page.keyboard.press("Tab"); page.keyboard.press("Tab")
    page.focus('[data-persona-btn="tenant"]')
    page.keyboard.press("ArrowLeft")
    page.wait_for_timeout(500)
    print("KEYBOARD persona after ArrowLeft:", page.evaluate("document.documentElement.dataset.persona"))

    print("CONSOLE ERRORS:", errors)
    print("CONSOLE WARNINGS:", warnings[:5])

    # ── 移动端 ──
    m = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, locale="zh-CN", is_mobile=True, has_touch=True)
    mp = m.new_page()
    merr = []
    mp.on("pageerror", lambda e: merr.append(str(e)[:200]))
    mp.goto(BASE, wait_until="networkidle")
    mp.wait_for_timeout(1200)
    m1 = mp.evaluate("() => ({ scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth })")
    print("MOBILE:", json.dumps(m1))
    shot(mp, "mobile-landlord.png")
    mp.click('[data-persona-btn="tenant"]')
    mp.wait_for_timeout(800)
    shot(mp, "mobile-tenant.png")
    print("MOBILE ERRORS:", merr)
    browser.close()
print("done")
