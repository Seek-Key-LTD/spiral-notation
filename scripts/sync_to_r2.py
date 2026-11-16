#!/usr/bin/env python3
"""
sync_to_r2.py - Synchronize Spiral Notation assets to Cloudflare R2 bucket `astro-drupal`.
Makes all assets available globally on Cloudflare Edge (https://astro-drupal.git4ta.fun/spiral-notation/).
"""

import os
import sys
import mimetypes
import urllib.request
import urllib.parse
import subprocess

ACCOUNT_ID = "e167cb36a5b95cb3cc8daf77a3f7d0b3"
BUCKET_NAME = "astro-drupal"
R2_PREFIX = "spiral-notation"

def get_token():
    token = os.environ.get("CLOUDFLARE_API_TOKEN")
    if not token:
        try:
            out = subprocess.check_output(["vault", "kv", "get", "-field=CLOUDFLARE_API_TOKEN", "secret/dev/cloudflare"])
            token = out.decode("utf-8").strip()
        except Exception as e:
            sys.exit(f"❌ Error getting CLOUDFLARE_API_TOKEN: {e}")
    return token

def get_content_type(file_path):
    ext = os.path.splitext(file_path)[1].lower()
    mapping = {
        '.html': 'text/html; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.js': 'text/javascript; charset=utf-8',
        '.mjs': 'text/javascript; charset=utf-8',
        '.json': 'application/json; charset=utf-8',
        '.mid': 'audio/midi',
        '.midi': 'audio/midi',
        '.txt': 'text/plain; charset=utf-8',
        '.svg': 'image/svg+xml',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
    }
    return mapping.get(ext, mimetypes.guess_type(file_path)[0] or 'application/octet-stream')

def upload_file(token, local_path, r2_key):
    content_type = get_content_type(local_path)
    with open(local_path, "rb") as f:
        data = f.read()

    encoded_key = urllib.parse.quote(r2_key, safe="/")
    url = f"https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/r2/buckets/{BUCKET_NAME}/objects/{encoded_key}"
    req = urllib.request.Request(
        url,
        data=data,
        method="PUT",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": content_type
        }
    )
    with urllib.request.urlopen(req) as resp:
        if resp.status in (200, 201):
            print(f"  ✓ Uploaded [{len(data):>8} bytes] -> {r2_key} ({content_type})")
        else:
            print(f"  ❌ Failed {r2_key}: HTTP {resp.status}")

def main():
    token = get_token()
    repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    print(f"🚀 Syncing Spiral Notation ({repo_root}) to Cloudflare R2 ({BUCKET_NAME}/{R2_PREFIX})...")

    upload_list = []

    # 1. Root index.html
    index_html = os.path.join(repo_root, "index.html")
    if os.path.exists(index_html):
        upload_list.append((index_html, f"{R2_PREFIX}/index.html"))

    # 2. Directories to sync: css, src, samples
    target_dirs = ["css", "src", "samples"]
    for d in target_dirs:
        dir_path = os.path.join(repo_root, d)
        if not os.path.exists(dir_path):
            continue
        for root, _, files in os.walk(dir_path):
            for file in files:
                if file.startswith(".") or file.endswith(".pyc") or file.endswith(".tmp"):
                    continue
                fpath = os.path.join(root, file)
                rel = os.path.relpath(fpath, repo_root)
                upload_list.append((fpath, f"{R2_PREFIX}/{rel}"))

    print(f"📦 Total files to sync: {len(upload_list)}")
    for local_path, r2_key in upload_list:
        upload_file(token, local_path, r2_key)

    print(f"\n🎉 Spiral Notation synced successfully to https://astro-drupal.git4ta.fun/{R2_PREFIX}/index.html")

if __name__ == "__main__":
    main()
