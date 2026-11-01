"""Read the official client's account network directory without changing selection."""
import os
import re
import signal
import subprocess
import time
import uuid

MAX_NETWORKS = 512


def country_hint(name):
    # A search aid from account labels, never a geolocation or routing promise.
    labels={'US':r'美国|美國|\b(?:us|usa|united states)\b','KR':r'韩国|韓國|首尔|首爾|\b(?:kr|korea|seoul)\b',
            'JP':r'日本|东京|東京|\b(?:jp|japan|tokyo)\b','SG':r'新加坡|\b(?:sg|singapore)\b',
            'HK':r'香港|\b(?:hk|hong kong)\b','TW':r'台湾|台灣|\b(?:tw|taiwan)\b',
            'DE':r'德国|德國|\b(?:de|germany)\b','GB':r'英国|英國|\b(?:uk|gb|united kingdom)\b'}
    matches=[code for code,pattern in labels.items() if re.search(pattern,name,re.I)]
    return matches[0] if len(matches)==1 else None


def parse_networks(text):
    if len(text.encode('utf-8')) > 1048576 or '\x1b' in text:
        raise ValueError('出口目录格式无效')
    prefix, separator, body = text.partition('Virtual Networks:')
    if not separator or not re.fullmatch(r'\s*Currently selected:\s*(?:[0-9a-fA-F-]{36}|None|none)?\s*', prefix):
        raise ValueError('未能识别出口目录格式')
    blocks = re.split(r'^\s*ID:\s*', body, flags=re.M)
    if blocks[0].strip() or len(blocks) - 1 > MAX_NETWORKS:
        raise ValueError('出口目录格式无效或数量过多')
    items, seen = [], set()
    for block in blocks[1:]:
        lines = block.strip().splitlines()
        try:
            ident = str(uuid.UUID(lines[0].strip()))
        except (ValueError, IndexError):
            raise ValueError('出口目录含无效网络 ID') from None
        fields = {}
        for line in lines[1:]:
            if not line.strip():
                continue
            match = re.fullmatch(r'\s*(Name|Comment|Default):\s*(.*?)\s*', line)
            if not match or match[1] in fields:
                raise ValueError('出口目录格式已变化，请核对客户端版本')
            fields[match[1]] = match[2]
        name = fields.get('Name', '')
        if not name or len(name) > 256 or any(ord(c) < 32 for c in name) or fields.get('Default') not in ('true', 'false') or ident in seen:
            raise ValueError('出口目录内容无效或重复')
        seen.add(ident)
        items.append(dict(id=ident, name=name, is_default=fields['Default'] == 'true',country_hint=country_hint(name),country_source='account-name-only'))
    return items


def read_networks():
    # Separate read-only process: no registration, UCI, connect, or selected-vnet writes.
    from mplane import NS, ROOT
    args = ['ip', 'netns', 'exec', NS, 'chroot', str(ROOT), '/usr/bin/warp-cli', '--accept-tos', 'vnet', '--no-paginate']
    child = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                             start_new_session=True, env={**os.environ, 'LC_ALL': 'C', 'LANG': 'C'})
    try:
        text, _ = child.communicate(timeout=8)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(child.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        child.communicate()
        raise RuntimeError('读取出口目录超时，请稍后刷新') from None
    if child.returncode:
        raise RuntimeError('未能读取出口目录，请检查登录环境')
    return dict(available=True, networks=parse_networks(text), time=int(time.time()))
