"""Render SVG hasil trace dengan Chromium, bandingkan dengan gambar asli. pakai: python3 tests/render_compare.py asli.png hasil.svg out.png [bg-hex]"""
import sys, asyncio, numpy as np
from PIL import Image
from playwright.async_api import async_playwright
orig, svgp, outp = sys.argv[1], sys.argv[2], sys.argv[3]
bg = sys.argv[4] if len(sys.argv) > 4 else None
im = Image.open(orig).convert('RGBA'); W, H = im.size
svg = open(svgp).read()
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', args=['--no-sandbox'])
        pg = await b.new_page(viewport={'width': W, 'height': H})
        css = 'html,body{margin:0;background:' + (bg or 'transparent') + '}svg{display:block}'
        await pg.set_content('<style>' + css + '</style>' + svg)
        await pg.screenshot(path='/tmp/_r.png', omit_background=(bg is None))
        await b.close()
asyncio.run(main())
r = Image.open('/tmp/_r.png').convert('RGBA')
a = np.asarray(im).astype(float); c = np.asarray(r).astype(float)
va = a[..., 3] > 127; vc = c[..., 3] > 127
both = va & vc
err = np.abs(a[..., :3] - c[..., :3]).mean(axis=2)
print(f'mean abs RGB err (opaque px): {err[both].mean():.2f}   p95: {np.percentile(err[both],95):.1f}')
print(f'alpha mismatch: orig-opaque but trace-empty = {(va & ~vc).sum()} px ({(va & ~vc).sum()/max(1,va.sum())*100:.3f}%), trace-opaque but orig-empty = {(~va & vc).sum()} px')
# kontak sisi-ke-sisi: piksel semi-transparan di dalam objek (garis celah)
semi = ((c[..., 3] > 8) & (c[..., 3] < 247) & va)
print(f'semi-transparent px inside original object (seam hint): {semi.sum()}')
chk = np.zeros((H, W, 3)); yy, xx = np.mgrid[0:H, 0:W]; chk[...] = 70 + 25 * (((xx // 16) + (yy // 16)) % 2)[..., None]
def over(x):
    al = x[..., 3:4] / 255; return (x[..., :3] * al + chk * (1 - al)).astype(np.uint8)
sheet = np.concatenate([over(a), over(c)], axis=1)
Image.fromarray(sheet).save(outp)
