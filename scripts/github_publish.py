#!/usr/bin/env python3
"""Publish the local Kaxia project to GitHub.

Token is supplied through GITHUB_TOKEN by github-publish.ps1; never hard-code it here.
"""
import argparse
import base64
import hashlib
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_REPO = 'XiaoHongzhe/kaxia'
EXCLUDE_DIRS = {'.git', 'node_modules', 'www', '__pycache__', '.gradle', 'build', '.kotlin', '.idea', 'capacitor-cordova-android-plugins', 'public'}
EXCLUDE_NAMES = {'keystore.properties', 'kaxia-release.jks', 'local.properties', 'capacitor.config.json', 'capacitor.plugins.json', 'config.xml'}
EXCLUDE_PREFIXES = ('android/app/src/main/assets/public/', 'dist/Screenshot_')
ROOT_FILES = ['.gitignore', '.nojekyll', 'README.md', 'CHANGELOG.md', 'capacitor.config.json', 'index.html', 'manifest.webmanifest', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'server.py', 'start.bat', '启动卡匣.bat', 'sw.js']


def api(method, url, payload=None, timeout=600):
    token = os.environ.get('GITHUB_TOKEN')
    if not token:
        raise SystemExit('GITHUB_TOKEN is empty; run through scripts/github-publish.ps1')
    data = None if payload is None else json.dumps(payload).encode('utf-8')
    headers = {'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.github+json', 'User-Agent': 'kaxia-publish'}
    if data is not None:
        headers['Content-Type'] = 'application/json'
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            body = error.read().decode('utf-8', 'replace')
            if error.code in (429, 500, 502, 503, 504) and attempt < 3:
                time.sleep(3 * (attempt + 1))
                continue
            raise RuntimeError('HTTP %s %s %s: %s' % (error.code, method, url, body[:800]))
        except Exception:
            if attempt < 3:
                time.sleep(3 * (attempt + 1))
                continue
            raise


def file_list():
    files = []
    for name in ROOT_FILES:
        path = ROOT / name
        if path.is_file():
            files.append(path)
    for dirname in ['assets', 'resources', 'screenshots', 'scripts', 'android', 'dist']:
        base = ROOT / dirname
        if not base.is_dir():
            continue
        for dirpath, dirnames, filenames in os.walk(base):
            dirnames[:] = [x for x in dirnames if x not in EXCLUDE_DIRS]
            for filename in filenames:
                path = Path(dirpath) / filename
                rel = path.relative_to(ROOT).as_posix()
                parts = rel.split('/')
                if any(part in EXCLUDE_DIRS for part in parts[:-1]):
                    continue
                if filename in EXCLUDE_NAMES:
                    continue
                if any(rel.startswith(prefix) for prefix in EXCLUDE_PREFIXES):
                    continue
                if filename.startswith('Screenshot_'):
                    continue
                if filename.endswith('.apk'):
                    continue
                files.append(path)
    return sorted(set(files))


def git_blob_sha(data):
    return hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()


def main():
    parser = argparse.ArgumentParser(description='Upload the Kaxia source and optional APK release to GitHub.')
    parser.add_argument('--repo', default=DEFAULT_REPO)
    parser.add_argument('--branch', default='main')
    parser.add_argument('--message', default='Update project')
    parser.add_argument('--apk', default='')
    parser.add_argument('--tag', default='')
    parser.add_argument('--release-name', default='')
    parser.add_argument('--notes-file', default='')
    parser.add_argument('--asset-name', default='')
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()

    files = file_list()
    total = sum(path.stat().st_size for path in files)
    print('Source files: %d, %.1f MB' % (len(files), total / 1024 / 1024))
    if args.dry_run:
        for path in files:
            print('  ' + path.relative_to(ROOT).as_posix())
        print('Dry run only; nothing uploaded.')
        return

    owner, repo = args.repo.split('/', 1)
    base = 'https://api.github.com/repos/%s/%s' % (owner, repo)
    branch = args.branch

    # Read current branch and tree so unchanged files are reused.
    parent = None
    existing = {}
    try:
        ref = api('GET', base + '/git/ref/heads/' + branch)
        parent = ref['object']['sha']
        commit = api('GET', base + '/git/commits/' + parent)
        tree = api('GET', base + '/git/trees/' + commit['tree']['sha'] + '?recursive=1')
        for item in tree.get('tree', []):
            if item.get('type') == 'blob':
                existing[item['path']] = item['sha']
        print('Branch %s: %s' % (branch, parent))
    except RuntimeError as error:
        if 'HTTP 404' not in str(error):
            raise
        print('Creating new branch %s' % branch)

    entries = []
    changed = 0
    for index, path in enumerate(files, 1):
        rel = path.relative_to(ROOT).as_posix()
        data = path.read_bytes()
        sha = git_blob_sha(data)
        if existing.get(rel) == sha:
            entries.append({'path': rel, 'mode': '100644', 'type': 'blob', 'sha': sha})
            continue
        blob = api('POST', base + '/git/blobs', {'content': base64.b64encode(data).decode('ascii'), 'encoding': 'base64'})
        entries.append({'path': rel, 'mode': '100644', 'type': 'blob', 'sha': blob['sha']})
        changed += 1
        print('  uploaded %d/%d %s (%d bytes)' % (index, len(files), rel, len(data)))

    if changed == 0 and parent:
        print('No source changes.')
        commit_sha = parent
    else:
        tree_result = api('POST', base + '/git/trees', {'tree': entries})
        now = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
        payload = {
            'message': args.message,
            'tree': tree_result['sha'],
            'author': {'name': 'XiaoHongzhe', 'email': '1463773604@qq.com', 'date': now},
            'committer': {'name': 'XiaoHongzhe', 'email': '1463773604@qq.com', 'date': now},
        }
        if parent:
            payload['parents'] = [parent]
        commit_result = api('POST', base + '/git/commits', payload)
        commit_sha = commit_result['sha']
        if parent:
            api('PATCH', base + '/git/refs/heads/' + branch, {'sha': commit_sha, 'force': False})
        else:
            api('POST', base + '/git/refs', {'ref': 'refs/heads/' + branch, 'sha': commit_sha})
        print('Commit: %s' % commit_sha)

    if args.apk:
        apk = Path(args.apk)
        if not apk.is_absolute():
            apk = ROOT / apk
        if not apk.is_file():
            raise SystemExit('APK not found: %s' % apk)
        package = json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))
        version = str(package.get('version', '0.0.0'))
        tag = args.tag or ('v' + version)
        name = args.release_name or ('卡匣 ' + version)
        notes = ''
        if args.notes_file:
            notes = (ROOT / args.notes_file).read_text(encoding='utf-8')
        else:
            notes = '卡匣 ' + version + '\n\nAPK: ' + apk.name
        release = None
        try:
            release = api('POST', base + '/releases', {'tag_name': tag, 'target_commitish': branch, 'name': name, 'body': notes, 'draft': False, 'prerelease': False})
            print('Release created: ' + tag)
        except RuntimeError as error:
            if 'HTTP 422' not in str(error):
                raise
            release = api('GET', base + '/releases/tags/' + urllib.parse.quote(tag))
            print('Release already exists: ' + tag)
        asset_name = args.asset_name or ('kaxia-' + version + '.apk')
        assets = api('GET', base + '/releases/' + str(release['id']) + '/assets')
        if any(item.get('name') == asset_name for item in assets):
            print('Asset already exists: ' + asset_name)
        else:
            token = os.environ['GITHUB_TOKEN']
            url = 'https://uploads.github.com/repos/%s/%s/releases/%s/assets?name=%s' % (owner, repo, release['id'], urllib.parse.quote(asset_name))
            data = apk.read_bytes()
            headers = {'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.github+json', 'User-Agent': 'kaxia-publish', 'Content-Type': 'application/vnd.android.package-archive', 'Content-Length': str(len(data))}
            req = urllib.request.Request(url, data=data, method='POST', headers=headers)
            with urllib.request.urlopen(req, timeout=600) as response:
                asset = json.load(response)
            print('APK uploaded: ' + asset.get('browser_download_url', asset_name))
        print('Release: https://github.com/%s/%s/releases/tag/%s' % (owner, repo, tag))

    print('Done: https://github.com/%s/%s/commit/%s' % (owner, repo, commit_sha))


if __name__ == '__main__':
    main()
