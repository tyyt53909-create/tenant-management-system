"""截取 frontend-admin 的真实界面，作为落地页的产品截图。

用法: python3 landing/tools/capture_shots.py
前置: 演示后端 :3101（tenant_demo 库）、截图用前端 :5174、本机 Chrome。
说明: 先按 2x 像素密度截 PNG 到 assets/.raw/，再用 sips 压成 1600px 宽的 JPEG
      输出到 assets/shots/，兼顾文字清晰度与页面体积。

只收已套用栖居设计语言的页面。统计报表、楼栋管理与审计日志仍是旧的 el-card
样式（原生 Element 配色），拍出来与其余页面不像同一个产品，故不入镜。
"""
import os
import subprocess
import sys
from playwright.sync_api import sync_playwright

BASE = os.environ.get("ADMIN_BASE", "http://127.0.0.1:5174")
HERE = os.path.abspath(os.path.dirname(__file__))
RAW = os.path.abspath(os.path.join(HERE, "..", "assets", ".raw"))
OUT = os.path.abspath(os.path.join(HERE, "..", "assets", "shots"))
os.makedirs(RAW, exist_ok=True)
os.makedirs(OUT, exist_ok=True)

LOGIN_BUTTON = "进入运营中心"

PAGES = [
    ("/dashboard", "dashboard"), ("/rooms", "rooms"), ("/tenants", "tenants"),
    ("/contracts", "contracts"), ("/bills", "bills"), ("/maintenance", "maintenance"),
    ("/cleaning", "cleaning"), ("/notifications", "notifications"),
]

# 页面加载完成后才消失的遮罩；没等到就说明截到的是骨架屏。
BUSY_SELECTORS = [".el-loading-mask", ".el-skeleton"]


def optimize(name: str) -> None:
    src = os.path.join(RAW, name + ".png")
    dst = os.path.join(OUT, name + ".jpg")
    subprocess.run(
        ["sips", "-s", "format", "jpeg", "-s", "formatOptions", "86", "-Z", "1600", src, "--out", dst],
        check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    print("  ->", os.path.relpath(dst, os.path.join(HERE, "..", "..")), os.path.getsize(dst) // 1024, "KB")


def settle(page) -> None:
    """等到页面不再显示骨架屏/加载遮罩。超时会明说，不静默截到半成品。"""
    for selector in BUSY_SELECTORS:
        try:
            page.wait_for_selector(selector, state="hidden", timeout=20000)
        except Exception:
            print(f"  ! 等待 {selector} 消失超时，可能截到加载中画面")
    page.wait_for_timeout(1400)


def main() -> int:
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chrome", headless=True)
        ctx = browser.new_context(
            # 1680 宽：1440 时列表页的右侧固定操作列会压住状态列，截出来像坏掉一样。
            viewport={"width": 1680, "height": 1050}, device_scale_factor=2, locale="zh-CN"
        )
        page = ctx.new_page()
        page.goto(BASE + "/login", wait_until="domcontentloaded")
        page.wait_for_selector('input[placeholder="请输入邮箱或手机号"]', timeout=60000)
        page.get_by_placeholder("请输入邮箱或手机号").fill("admin@example.com")
        page.get_by_placeholder("请输入密码").fill("Admin@123")
        page.get_by_role("button", name=LOGIN_BUTTON).click()
        try:
            page.wait_for_url("**/dashboard", timeout=60000)
        except Exception:
            page.screenshot(path=os.path.join(RAW, "_debug_login.png"))
            print("登录失败，当前 URL =", page.url)
            return 1
        settle(page)

        for path, name in PAGES:
            page.goto(BASE + path, wait_until="domcontentloaded")
            settle(page)
            page.screenshot(path=os.path.join(RAW, name + ".png"))
            print("captured", name)
            optimize(name)

        # 公开看房页无需登录；它没有侧栏，内容结束后会留一大片空白，故用较矮的取景。
        pub = ctx.new_page()
        pub.set_viewport_size({"width": 1680, "height": 880})
        pub.goto(BASE + "/viewing", wait_until="domcontentloaded")
        settle(pub)
        pub.screenshot(path=os.path.join(RAW, "viewing.png"))
        print("captured viewing")
        optimize("viewing")
        browser.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
