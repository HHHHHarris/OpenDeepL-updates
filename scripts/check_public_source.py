#!/usr/bin/env python3
"""Check tracked publication boundaries; never prints matched secret contents."""
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
blocked = {'evidence', 'analysis', 'dist', 'tools', 'node_modules', '.impeccable', '__pycache__'}
patterns = [
    re.compile(rb'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----'),
    re.compile(rb'gh[pousr]_[A-Za-z0-9]{30,}'),
    re.compile(rb'github_pat_[A-Za-z0-9_]{30,}'),
    re.compile(rb'(?:AKIA|ASIA)[A-Z0-9]{16}'),
]
names = subprocess.check_output(['git', 'ls-files', '-z'], cwd=ROOT).decode().split('\0')
errors = []
for name in filter(None, names):
    path = ROOT / name
    if blocked.intersection(Path(name).parts) or path.is_symlink():
        errors.append(f'Forbidden publication path: {name}')
        continue
    if path.suffix in {'.gguf', '.onnx', '.key', '.p12', '.pfx', '.odup', '.pyc'}:
        errors.append(f'Private/runtime artifact type: {name}')
    if path.suffix == '.pem' and name != 'electron/update-public-key.pem':
        errors.append(f'Unexpected key file: {name}')
    content = path.read_bytes()
    if any(pattern.search(content) for pattern in patterns):
        errors.append(f'Potential credential in: {name}')
    if path.suffix == '.md':
        text = content.decode('utf-8')
        for link in re.findall(r'\]\(([^)]+)\)', text):
            if re.match(r'(?:[a-z]+:|#|/)', link):
                continue
            target = link.split('#')[0]
            if target and not (path.parent / target).exists():
                errors.append(f'Broken local link in {name}: {link}')
if errors:
    print('\n'.join(errors))
    sys.exit(1)
print(f'Publication boundaries and Markdown links checked for {len(list(filter(None, names)))} tracked files.')
