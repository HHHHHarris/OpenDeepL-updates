#!/usr/bin/env python3
"""Build a pinned self-contained runtime. Run on the target OS, never in a consumer app."""
import argparse
import hashlib
import json
import os
import pathlib
import shutil
import ssl
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.request
import urllib.error
import zipfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
SOURCES = json.loads((ROOT/'scripts/runtime-sources.json').read_text())

def digest(file):
    h=hashlib.sha256()
    with open(file,'rb') as f:
        for chunk in iter(lambda:f.read(1024*1024),b''): h.update(chunk)
    return h.hexdigest()

def fetch(entry,cache,name):
    dest=cache/name
    if dest.exists() and digest(dest)==entry['sha256']: return dest
    dest.unlink(missing_ok=True)
    temp=dest.with_suffix(dest.suffix+'.tmp')
    req=urllib.request.Request(entry['url'],headers={'User-Agent':'OpenDeepL-runtime-builder/1'})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req,timeout=60,context=ssl.create_default_context(cafile='/etc/ssl/cert.pem' if pathlib.Path('/etc/ssl/cert.pem').is_file() else None)) as response, open(temp,'wb') as out:
                shutil.copyfileobj(response,out)
            break
        except (OSError, urllib.error.URLError):
            temp.unlink(missing_ok=True)
            if attempt == 3:
                raise RuntimeError('Source download failed: '+name) from None
            time.sleep(2 ** attempt)
    if digest(temp)!=entry['sha256']:
        temp.unlink(missing_ok=True); raise RuntimeError('Source checksum mismatch: '+name)
    temp.replace(dest); return dest

def collect_component_notices(runtime,target,cache):
    runtime=pathlib.Path(runtime);cache=pathlib.Path(cache);cache.mkdir(parents=True,exist_ok=True)
    notices=runtime/'notices';notices.mkdir(exist_ok=True)
    for entry in SOURCES.get('componentNotices',[]):
        if target in entry['targets']:
            source=fetch(entry,cache,'notice-'+entry['filename'])
            shutil.copy2(source,notices/entry['filename'])
    shutil.copy2(ROOT/'scripts/runtime-sources.json',notices/'runtime-sources.json')


def safe_name(name):
    p=pathlib.PurePosixPath(name)
    if not name or p.is_absolute() or any(x in ('','.', '..') for x in p.parts) or '\\' in name or ':' in name:
        raise RuntimeError('Unsafe archive path')
    return p

def unpack(archive,dest,kind):
    dest.mkdir(parents=True,exist_ok=True)
    if kind=='tar.gz':
        with tarfile.open(archive,'r:gz') as t:
            members=t.getmembers()
            for m in members:
                rel=safe_name(m.name)
                if not (m.isfile() or m.isdir() or m.issym()): raise RuntimeError('Unsafe tar member')
                if m.issym():
                    target=(dest/rel.parent/m.linkname).resolve()
                    if not target.is_relative_to(dest.resolve()): raise RuntimeError('Escaping archive symlink')
            t.extractall(dest,filter='data')
    else:
        with zipfile.ZipFile(archive) as z:
            for info in z.infolist():
                safe_name(info.filename)
                if (info.external_attr >> 16) & 0o170000 == 0o120000: raise RuntimeError('Archive symlink')
            z.extractall(dest)

def run(*args,env=None): subprocess.run(args,check=True,env=env)

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--target',required=True,choices=('macos-arm64','windows-x64'))
    ap.add_argument('--output',help='Absolute output runtime directory; defaults to dist/runtime/TARGET')
    ap.add_argument('--cache',help='Source archive cache')
    args=ap.parse_args()
    target=args.target
    if (target=='macos-arm64') != (sys.platform=='darwin'):
        raise SystemExit('Build on matching target OS')
    if target=='macos-arm64' and os.uname().machine!='arm64': raise SystemExit('Build on arm64 Mac')
    if target=='windows-x64' and (os.name!='nt' or os.environ.get('PROCESSOR_ARCHITECTURE','').lower()!='amd64'): raise SystemExit('Build on x64 Windows')
    output=pathlib.Path(args.output).resolve() if args.output else ROOT/'dist/runtime'/target
    if output.exists(): raise SystemExit('Output exists; choose a new directory')
    cache=pathlib.Path(args.cache).resolve() if args.cache else ROOT/'dist/runtime-sources'
    cache.mkdir(parents=True,exist_ok=True)
    source=SOURCES[target]
    p=fetch(source['python'],cache,'python-'+target+'.tar.gz')
    l=fetch(source['llama'],cache,'llama-'+target+('.zip' if target.startswith('windows') else '.tar.gz'))
    font=SOURCES['font']; f=fetch(font,cache,'NotoSansSC-VF.ttf')
    lic=fetch({'url':font['licenseUrl'],'sha256':font['licenseSha256']},cache,'OFL.txt')
    output.parent.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(dir=output.parent) as td:
        stage=pathlib.Path(td)/'runtime'; stage.mkdir()
        unpack(p,stage,source['python']['archive'])
        unpack(l,stage/'llama-src',source['llama']['archive'])
        llama_src=stage/'llama-src'
        if target=='macos-arm64':
            src=next(llama_src.iterdir()); assert src.is_dir()
            # Keep all .dylib neighbors to satisfy @rpath dependencies.
            (stage/'llama').mkdir(exist_ok=True)
            for child in src.iterdir():
                if child.name=='llama-server' or child.suffix=='.dylib' or child.name=='LICENSE': shutil.move(str(child),str(stage/'llama'/child.name))
        else:
            (stage/'llama').mkdir()
            for child in llama_src.iterdir():
                if child.name=='llama-server.exe' or child.suffix.lower()=='.dll' or child.name.startswith('LICENSE'):
                    shutil.move(str(child),str(stage/'llama'/child.name))
        shutil.rmtree(llama_src)
        py=stage/'python'/('python.exe' if target.startswith('windows') else 'bin/python3')
        if not py.is_file(): raise RuntimeError('Missing standalone Python')
        if not (stage/'llama'/('llama-server.exe' if target.startswith('windows') else 'llama-server')).is_file(): raise RuntimeError('Missing llama-server')
        env=os.environ.copy();env['PIP_DISABLE_PIP_VERSION_CHECK']='1';env['PIP_NO_INPUT']='1';env['PYTHONNOUSERSITE']='1';env['PYTHONDONTWRITEBYTECODE']='1'
        if target=='macos-arm64' and pathlib.Path('/etc/ssl/cert.pem').is_file():env['PIP_CERT']='/etc/ssl/cert.pem'
        run(str(py),'-m','pip','install','--no-input','--no-compile','--index-url','https://pypi.org/simple','-r',str(ROOT/'scripts/runtime-requirements.txt'),env=env)
        imports='import lxml,pypdf,reportlab,pypdfium2' + (',rapidocr_onnxruntime' if target=='windows-x64' else '')
        run(str(py),'-c',imports,env=env)
        # Build-only fontTools instantiates the official variable font at wght=400.
        fonttools=pathlib.Path(td)/'fonttools'
        run(sys.executable,'-m','pip','install','--no-input','--index-url','https://pypi.org/simple','--target',str(fonttools),'fonttools==4.60.1',env=env)
        env['PYTHONPATH']=str(fonttools)
        fonts=stage/'fonts';fonts.mkdir()
        run(sys.executable,'-c',"from fontTools.ttLib import TTFont; from fontTools.varLib.instancer import instantiateVariableFont; import sys; f=TTFont(sys.argv[1]); instantiateVariableFont(f,{'wght':400},inplace=True); f.save(sys.argv[2])",str(f),str(fonts/'NotoSansSC-Regular.ttf'),env=env)
        notices=stage/'notices';notices.mkdir()
        shutil.copy2(lic,notices/'NotoSansSC-OFL.txt')
        python_notices=notices/'python-build-standalone';python_notices.mkdir()
        for notice in SOURCES['pythonNotices']:
            downloaded=fetch(notice,cache,'python-notice-'+notice['filename'])
            shutil.copy2(downloaded,python_notices/notice['filename'])
        shutil.copy2(ROOT/'scripts/runtime-requirements.txt',notices/'runtime-requirements.txt')
        shutil.copy2(ROOT/'scripts/runtime-sources.json',notices/'runtime-sources.json')
        # Source release archives include their own LICENSE files; record installed dependency metadata.
        freeze=subprocess.check_output([str(py),'-m','pip','freeze'],text=True,env=env)
        (notices/'python-packages.txt').write_text(freeze)
        (notices/'source-checksums.json').write_text(json.dumps({k:v['sha256'] for k,v in source.items()},indent=2))
        collect_component_notices(stage,target,cache)
        from audit_runtime import audit
        audit(stage)
        stage.replace(output)
    print(output)
if __name__=='__main__': main()
