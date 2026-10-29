"""Create and verify a portable archive; a read or CRC error fails the build."""
import pathlib
import sys
import zipfile

source, destination = map(pathlib.Path, sys.argv[1:3])
if not (source / 'OpenDeepL.exe').is_file():
    raise SystemExit('Missing staged application')
temporary = destination.with_suffix('.partial.zip')
try:
    with zipfile.ZipFile(temporary, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for file in sorted(source.rglob('*')):
            if file.is_symlink():
                raise RuntimeError('Unexpected symlink in Windows bundle')
            if file.is_file():
                archive.write(file, file.relative_to(source).as_posix())
    with zipfile.ZipFile(temporary) as archive:
        bad = archive.testzip()
        if bad:
            raise RuntimeError('Archive verification failed: ' + bad)
    temporary.replace(destination)
except BaseException:
    temporary.unlink(missing_ok=True)
    raise
print(destination.name, destination.stat().st_size)
