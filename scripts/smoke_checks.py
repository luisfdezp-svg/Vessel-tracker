#!/usr/bin/env python3
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]

checks = [
    (ROOT / 'vessel-tracker.html', [r'assets/css/vessel-tracker\.css', r'assets/js/vessel-tracker\.js']),
    (ROOT / 'Groupage Optimizer.html', [r'assets/css/groupage-optimizer\.css', r'assets/js/groupage-optimizer\.js']),
    (ROOT / 'assets/js/vessel-tracker.js', [r'function\s+conn\s*\(', r'function\s+disc\s*\(', r'function\s+exportDb\s*\(', r'function\s+exportCSV\s*\(', r'navigator\.serviceWorker\.register\([\'\"]\./sw\.js[\'\"]\)', r'beforeinstallprompt']),
    (ROOT / 'assets/js/groupage-optimizer.js', [r'function\s+loadDemo\s*\(', r'window\.jspdf']),
    (ROOT / 'sw.js', [r'const\s+CACHE\s*=', r"self\.addEventListener\('fetch'", r'isCdnAsset']),
]

failed = False
for file_path, snippets in checks:
    if not file_path.exists():
        print(f'[FAIL] Missing file: {file_path}')
        failed = True
        continue
    text = file_path.read_text(encoding='utf-8', errors='ignore')
    for pattern in snippets:
        if re.search(pattern, text) is None:
            print(f'[FAIL] {file_path.name}: missing pattern -> {pattern}')
            failed = True

if failed:
    sys.exit(1)

print('[OK] Smoke checks passed')
