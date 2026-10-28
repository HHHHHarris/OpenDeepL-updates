"""Generate a two-page, native-text PDF for real local document acceptance."""
from pathlib import Path
import pymupdf as fitz

ROOT = Path(__file__).parent
SOURCE = ROOT / 'representative-two-page.pdf'
IMAGE = ROOT.parent / 'green-square.png'

doc = fitz.open()
for page_no in (1, 2):
    page = doc.new_page(width=595, height=842)
    page.draw_rect(fitz.Rect(40, 40, 555, 800), color=(.12, .3, .55), width=1)
    page.draw_line(fitz.Point(40, 120), fitz.Point(555, 120), color=(.12, .3, .55), width=2)
    page.insert_text((54, 79), f'Product brief - page {page_no}', fontsize=17, fontname='helv', color=(.08, .2, .42))
    page.insert_text((54, 153), 'Order details', fontsize=13, fontname='hebo', color=(.2, .2, .2))
    page.draw_rect(fitz.Rect(50, 170, 535, 298), color=(.4, .4, .4), width=.6)
    for y in (202, 234, 266):
        page.draw_line(fitz.Point(50, y), fitz.Point(535, y), color=(.65, .65, .65), width=.4)
    for text, y in [('List price: $19.99', 192), ('Sale price: $9.99', 224),
                    ('Capacity: 750 mL', 256), ('Do not ship before Friday.', 288)]:
        page.insert_text((64, y), text, fontsize=12, fontname='helv')
    page.insert_image(fitz.Rect(60, 335, 140, 415), filename=str(IMAGE))
    page.insert_text((155, 380), 'Product image and vector frame', fontsize=12)
    page.draw_rect(fitz.Rect(60, 455, 190, 490), color=(.1, .35, .6), fill=(.88, .93, .98))
    page.insert_text((62, 540), 'Reference link below', fontsize=12)
    page.insert_link({'kind': fitz.LINK_URI, 'from': fitz.Rect(60, 455, 190, 490),
                      'uri': 'https://example.com/product'})
doc.save(SOURCE, garbage=3, deflate=True)
doc.close()
print(SOURCE)
