#!/usr/bin/env python3
"""Offline evidence audit for the four Vosk 0.9 model archives.

No downloads, extraction, or model execution. Explicit local inputs only.
This establishes byte integrity and which ZIP members changed; not legal clearance.
Usage:
  python tools/verify_model_release.py --official upstream.zip \
    --github-release release.zip --hf-original hf-original.zip \
    --hf-quant hf-quant.zip > model-verification.json
"""
import argparse
import hashlib
import json
import stat
import sys
import zipfile
from pathlib import Path

PUBLISHER_MD5 = '2f8b6dbf64e912f9ee7eda50ba2d3c80'
ORIGINAL_SHA256 = '0aa332451ce46bfdbd620e74765fc16a4087988067c299969121ed0f8ed5bdf2'
QUANT_SHA256 = '34e742ce9bb3c1ae86679d5974d2496b9fae50f0629f51bb4f5edfadc5ff3d71'
ORIGINAL_SIZE = 782787154
QUANT_SIZE = 280394098
MODEL_FILES = {'model.onnx', 'bert/model.onnx', 'dictionary', 'config.json', 'bert/vocab.txt'}
NOTICE_NAMES = {'license', 'license.txt', 'license.md', 'notice', 'notice.txt',
                'copying', 'copying.txt', 'attribution', 'attribution.txt',
                'copyright', 'copyright.txt', 'third_party_notices.md'}


class EvidenceFailure(Exception):
    pass


def digests(path):
    sha = hashlib.sha256()
    md5 = hashlib.md5()  # Only to compare the publisher's historical MD5, not for security.
    size = 0
    with Path(path).open('rb') as stream:
        for block in iter(lambda: stream.read(8 * 1024 * 1024), b''):
            sha.update(block)
            md5.update(block)
            size += len(block)
    return {'bytes': size, 'sha256': sha.hexdigest(), 'md5': md5.hexdigest()}


def inventory(path):
    """Hash uncompressed members with bounded memory; reject unsafe ZIP names."""
    records = {}
    with zipfile.ZipFile(path, 'r', allowZip64=True) as zf:
        entries = [m for m in zf.infolist() if not m.is_dir()]
        if len(entries) > 10000:
            raise EvidenceFailure('ZIP member-count limit exceeded')
        paths = [m.filename for m in entries]
        for name, member in zip(paths, entries):
            parts = name.split('/')
            if (not name or name.startswith('/') or '\\' in name or
                    any(p in ('', '.', '..') for p in parts) or ':' in parts[0]):
                raise EvidenceFailure('Unsafe ZIP member path: ' + repr(name))
            mode = member.external_attr >> 16
            if stat.S_IFMT(mode) == stat.S_IFLNK:
                raise EvidenceFailure('ZIP symlink forbidden: ' + repr(name))
        # Optional archive wrapper directory, but never strip a real model subtree.
        first = {name.split('/')[0] for name in paths}
        unwrap = len(first) == 1 and all('/' in name for name in paths)
        total = 0
        for member in entries:
            name = member.filename.split('/', 1)[1] if unwrap else member.filename
            if not name or name in records:
                raise EvidenceFailure('Missing/duplicate normalized ZIP member: ' + repr(name))
            if member.file_size > 4 * 1024**3:
                raise EvidenceFailure('Oversize ZIP member: ' + repr(name))
            total += member.file_size
            if total > 8 * 1024**3:
                raise EvidenceFailure('ZIP decompression budget exceeded')
            sha = hashlib.sha256()
            n = 0
            with zf.open(member, 'r') as stream:
                for block in iter(lambda: stream.read(8 * 1024 * 1024), b''):
                    n += len(block)
                    sha.update(block)
            if n != member.file_size:
                raise EvidenceFailure('ZIP uncompressed length mismatch: ' + repr(name))
            records[name] = {'bytes': n, 'sha256': sha.hexdigest()}
    absent = MODEL_FILES - records.keys()
    if absent:
        raise EvidenceFailure('Required model members missing: ' + ', '.join(sorted(absent)))
    return records


def verify(files, expected=None):
    expected = expected or {
        'publisher_md5': PUBLISHER_MD5, 'original_sha256': ORIGINAL_SHA256,
        'quant_sha256': QUANT_SHA256, 'original_size': ORIGINAL_SIZE,
        'quant_size': QUANT_SIZE,
    }
    observed = {name: digests(file) for name, file in files.items()}
    reasons = []
    for name in ('official', 'github_release', 'hf_original'):
        if observed[name]['bytes'] != expected['original_size']:
            reasons.append(name + ': unexpected archive size')
        if name != 'official' and observed[name]['sha256'] != expected['original_sha256']:
            reasons.append(name + ': does not match published original SHA-256')
    if observed['official']['md5'] != expected['publisher_md5']:
        reasons.append('official: MD5 differs from Alpha Cephei registry')
    if observed['official']['sha256'] != expected['original_sha256']:
        reasons.append('official: SHA-256 differs from GitHub/HF original')
    if observed['hf_quant']['bytes'] != expected['quant_size']:
        reasons.append('hf_quant: unexpected archive size')
    if observed['hf_quant']['sha256'] != expected['quant_sha256']:
        reasons.append('hf_quant: SHA-256 differs from HF LFS / browser pin')
    result = {'archive_hashes': observed, 'hash_evidence': 'PASS' if not reasons else 'FAIL',
              'member_evidence': 'NOT_CHECKED', 'notice_evidence': 'NOT_CHECKED', 'changed_members': [],
              'removed_members': [], 'added_members': [], 'notices': {},
              'provenance_evidence': 'NOT_COMPLETE', 'model_rights': 'HOLD',
              'failures': reasons}
    if reasons:
        return result
    src = inventory(files['official'])
    dst = inventory(files['hf_quant'])
    changed = sorted(k for k in src.keys() & dst.keys() if src[k] != dst[k])
    removed = sorted(src.keys() - dst.keys())
    added = sorted(dst.keys() - src.keys())
    notices = lambda inv: sorted(k for k in inv if k.rsplit('/', 1)[-1].lower() in NOTICE_NAMES)
    result.update(changed_members=changed, removed_members=removed, added_members=added,
                  notices={'original': notices(src), 'quantized': notices(dst)},
                  member_count={'original': len(src), 'quantized': len(dst)},
                  changed_member_hashes={k: {'original': src[k], 'quantized': dst[k]} for k in changed})
    if changed != ['bert/model.onnx'] or removed or added:
        result['failures'].append('Not a BERT-only transformation: inspect changed/added/removed members')
    result['member_evidence'] = 'PASS' if not result['failures'] else 'FAIL'
    if not result['failures']:
        result['provenance_evidence'] = 'BINARY_CHAIN_AND_BERT_ONLY_CONFIRMED'
    if not result['notices']['original']:
        result['failures'].append('No standard license/NOTICE file found inside official ZIP; external rights evidence required')
    if not result['notices']['quantized']:
        result['failures'].append('No standard license/NOTICE file found inside quantized ZIP; verify distribution notices')
    result['notice_evidence'] = 'PASS' if result['notices']['original'] and result['notices']['quantized'] else 'FAIL'
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for key in ('official', 'github_release', 'hf_original', 'hf_quant'):
        parser.add_argument('--' + key.replace('_', '-'), type=Path, required=True)
    args = parser.parse_args()
    files = {key: getattr(args, key) for key in ('official', 'github_release', 'hf_original', 'hf_quant')}
    try:
        report = verify(files)
    except (EvidenceFailure, OSError, zipfile.BadZipFile, RuntimeError, ValueError) as error:
        report = {'hash_evidence': 'FAIL', 'member_evidence': 'FAIL', 'notice_evidence': 'NOT_CHECKED',
                  'model_rights': 'HOLD', 'failures': [str(error)]}
    print(json.dumps(report, indent=2, sort_keys=True, ensure_ascii=False))
    return 0 if not report['failures'] else 1


if __name__ == '__main__':
    sys.exit(main())
