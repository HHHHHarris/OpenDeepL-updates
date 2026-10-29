"""Prepare the pinned OFL font for document regression tests, not user setup."""
import pathlib
from prepare_runtime import SOURCES, fetch
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

root=pathlib.Path(__file__).resolve().parents[1]
directory=root/'dist/test-fonts';directory.mkdir(parents=True,exist_ok=True)
source=fetch(SOURCES['font'],directory,'NotoSansSC-VF.ttf')
font=TTFont(source,recalcTimestamp=False)
instantiateVariableFont(font,{'wght':400},inplace=True)
font.save(directory/'NotoSansSC-Regular.ttf')
print('Prepared pinned OFL test font')
