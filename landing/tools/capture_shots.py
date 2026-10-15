"""截取 frontend-admin 的真实界面，作为落地页的产品截图。

用法: python3 landing/tools/capture_shots.py
前置: 演示后端 :3101（tenant_demo 库）、截图用前端 :5174、本机 Chrome。
说明: 先按 2x 像素密度截 PNG 到 assets/.raw/，再用 sips 压成 1600px 宽的 JPEG
      输出到 assets/shots/，兼顾文字清晰度与页面体积。
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

PAGES = [
    ("/dashboard", "dashboard"), ("/rooms", "rooms"), ("/contracts", "contracts"),
    ("/bills", "bills"), ("/prepay", "prepay"), ("/meters", "meters"),
    ("/maintenance", "maintenance"), ("/checkout", "checkout"), ("/cleaning", "cleaning"),
    ("/statistics", "statistics"), ("/notifications", "notifications"),
]


def optimize(name: str) -> None:
    src = os.path.join(RAW, name + ".png")
    dst = os.path.join(OUT, name + ".jpg")
    subprocess.run(
        ["sips", "-s", "format", "jpeg", "-s", "formatOptions", "86", "-Z", "1600", src, "--out", dst],
        check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    print("  ->", os.path.relpath(dst, os.path.join(HERE, "..", "..")), os.path.getsize(dst) // 1024, "KB")


def main() -> int:
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chrome", headless=True)
        ctx = browser.new_context(
            viewport={"width": 1440, "height": 900}, device_scale_factor=2, locale="zh-CN"
        )
        page = ctx.new_page()
        page.goto(BASE + "/login", wait_until="domcontentloaded")
        page.wait_for_selector('input[placeholder="请输入邮箱或手机号"]', timeout=60000)
        page.get_by_placeholder("请输入邮箱或手机号").fill("admin@example.com")
        page.get_by_placeholder("请输入密码").fill("Admin@123")
        page.get_by_role("button", name="登录").click()
        try:
            page.wait_for_url("**/dashboard", timeout=60000)
        except Exception:
            page.screenshot(path=os.path.join(RAW, "_debug_login.png"))
            print("登录失败，当前 URL =", page.url)
            return 1
        page.wait_for_load_state("networkidle")
        page.wait_for_timeout(2500)

        for path, name in PAGES:
            page.goto(BASE + path, wait_until="networkidle")
            page.wait_for_timeout(2200)
            page.screenshot(path=os.path.join(RAW, name + ".png"))
            print("captured", name)
            optimize(name)

        # 公开看房页无需登录
        pub = ctx.new_page()
        pub.goto(BASE + "/viewing", wait_until="networkidle")
        pub.wait_for_timeout(2500)
        pub.screenshot(path=os.path.join(RAW, "viewing.png"))
        print("captured viewing")
        optimize("viewing")
        browser.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
