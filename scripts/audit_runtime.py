"""Sanitize a staged runtime and emit a content-based dependency inventory."""
import argparse
import hashlib
import json
import pathlib
import shutil
import sys


def audit(root):
    root=pathlib.Path(root).resolve()
    if not (root/'python').is_dir() or not (root/'notices').is_dir():
        raise ValueError('Expected a prepared runtime directory')
    for cache in root.rglob('__pycache__'):
        shutil.rmtree(cache)
    for file in root.rglob('*.pyc'):
        file.unlink()
    # Entry-point wrappers embed the build-time interpreter path. The app calls
    # the relocatable interpreter directly and never uses these wrappers.
    scripts=root/'python'/('Scripts' if sys.platform=='win32' else 'bin')
    if scripts.exists():
        for file in scripts.iterdir():
            if file.name not in ('python','python3','python3.12') and (file.is_file() or file.is_symlink()):
                file.unlink()
    # Image-only OCR never uses OpenCV's separately loaded FFmpeg video plugin.
    # Omit that optional binary instead of redistributing an unused LGPL backend.
    omitted=[]
    for plugin in (root/'python/Lib/site-packages/cv2').glob('opencv_videoio_ffmpeg*.dll'):
        omitted.append({'path':plugin.relative_to(root).as_posix(),'sha256':hashlib.sha256(plugin.read_bytes()).hexdigest(),'reason':'Unused optional video-I/O plugin; image OCR does not use it.'})
        plugin.unlink()
    if omitted:
        (root/'notices/omitted-components.json').write_text(json.dumps(omitted,indent=2)+'\n',encoding='utf-8')
    files=[]
    forbidden=str(pathlib.Path.home()).encode()
    for file in sorted(root.rglob('*')):
        if not file.is_file() or file.is_symlink():
            continue
        relative=file.relative_to(root).as_posix()
        if relative=='notices/runtime-files.json':
            continue
        h=hashlib.sha256();tail=b''
        with file.open('rb') as f:
            while block:=f.read(1024*1024):
                if forbidden in tail+block:
                    raise RuntimeError('Build-machine path found in '+relative)
                h.update(block);tail=block[-len(forbidden):]
        files.append({'path':relative,'size':file.stat().st_size,'sha256':h.hexdigest()})
    (root/'notices/runtime-files.json').write_text(json.dumps(files,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({'files':len(files),'bytes':sum(x['size'] for x in files),'privateHomePaths':0}))

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('runtime');args=parser.parse_args();audit(args.runtime)
