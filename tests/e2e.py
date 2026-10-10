"""Uji end-to-end di Chromium (mobile + desktop). pakai: python3 tests/e2e.py http://localhost:3111 outdir"""
import sys, asyncio, json, re
from playwright.async_api import async_playwright
base, out = sys.argv[1], sys.argv[2]
IMG = 'tests/img/chibi.jpg'
async def main():
    errs = []
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', args=['--no-sandbox'])
        ctx = await b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, accept_downloads=True, has_touch=True, is_mobile=True)
        pg = await ctx.new_page()
        pg.on('console', lambda m: errs.append(('console', m.text)) if m.type == 'error' else None)
        pg.on('pageerror', lambda e: errs.append(('pageerror', str(e))))
        await pg.goto(base); await pg.wait_for_timeout(600)
        await pg.screenshot(path=f'{out}/1_empty_mobile.png')
        print('server chip:', await pg.inner_text('#srv'))
        # upload -> harus ada preview
        await pg.set_input_files('#f', IMG); await pg.wait_for_selector('#editor:not([hidden])', timeout=8000)
        await pg.wait_for_timeout(500)
        print('fname:', await pg.inner_text('#fname'), '| meta:', await pg.inner_text('#fmeta'))
        print('thumb img:', await pg.evaluate("document.querySelectorAll('#thumb img').length"), '| drop hidden:', await pg.evaluate("document.getElementById('drop').hidden"))
        print('status:', await pg.inner_text('#status'))
        await pg.screenshot(path=f'{out}/2_loaded_mobile.png', full_page=True)
        # pipet: ketuk latar indigo (pojok kiri bawah area latar) lalu trace
        box = await pg.locator('#cv').bounding_box()
        await pg.mouse.click(box['x'] + box['width'] * 0.06, box['y'] + box['height'] * 0.35)
        await pg.wait_for_timeout(400)
        print('seeds:', await pg.evaluate("document.querySelectorAll('#seeds .seed').length"), '| bgOn:', await pg.evaluate("document.getElementById('bgOn').checked"))
        await pg.screenshot(path=f'{out}/3_bg_removed_mobile.png', full_page=True)
        await pg.click('#go'); await pg.wait_for_selector('#panel-result:not([hidden])', timeout=60000)
        await pg.wait_for_timeout(500)
        print('stats:', (await pg.inner_text('#stats')).replace('\n', ' | '))
        print('status:', await pg.inner_text('#status'))
        await pg.screenshot(path=f'{out}/4_result_mobile.png', full_page=True)
        async with pg.expect_download() as d: await pg.click('#dxml')
        dl = await d.value; await dl.save_as(f'{out}/result.xml'); print('xml saved', dl.suggested_filename)
        async with pg.expect_download() as d2: await pg.click('#dsvg')
        dl2 = await d2.value; await dl2.save_as(f'{out}/result.svg')
        # desktop
        pg2 = await b.new_page(viewport={'width': 1280, 'height': 900})
        pg2.on('pageerror', lambda e: errs.append(('pageerror', str(e))))
        await pg2.goto(base); await pg2.set_input_files('#f', IMG); await pg2.wait_for_selector('#editor:not([hidden])')
        await pg2.wait_for_timeout(600); await pg2.screenshot(path=f'{out}/5_loaded_desktop.png')
        # fallback lokal: blok API
        pg3 = await b.new_page(viewport={'width': 1280, 'height': 900})
        await pg3.route('**/api/trace*', lambda r: r.abort())
        pg3.on('pageerror', lambda e: errs.append(('pageerror', str(e))))
        await pg3.goto(base); await pg3.wait_for_timeout(500); print('chip (blocked):', await pg3.inner_text('#srv'))
        await pg3.set_input_files('#f', IMG); await pg3.wait_for_selector('#editor:not([hidden])')
        await pg3.click('#autoSeed'); await pg3.click('#go'); await pg3.wait_for_selector('#panel-result:not([hidden])', timeout=60000)
        print('fallback stats:', (await pg3.inner_text('#stats')).replace('\n', ' | '))
        await pg3.screenshot(path=f'{out}/6_result_desktop_local.png')
        await b.close()
    print('errors:', errs)
asyncio.run(main())
