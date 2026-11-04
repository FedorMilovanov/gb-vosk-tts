"""Tiny synthetic archives: these never pretend to be actual Vosk model evidence."""
import hashlib
import tempfile
import unittest
import zipfile
from pathlib import Path

from verify_model_release import EvidenceFailure, digests, inventory, verify


class ReleaseAuditTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.base = Path(self.tmp.name)
        self.data = {'model.onnx': b'VITS unmodified', 'bert/model.onnx': b'BERT original',
                     'dictionary': b'foo', 'config.json': b'{}', 'bert/vocab.txt': b'vocab',
                     'LICENSE': b'Apache-2.0 notice'}

    def archive(self, name, content, prefix='model/'):
        path = self.base / name
        with zipfile.ZipFile(path, 'w') as zf:
            for key, value in content.items():
                zf.writestr(prefix + key, value)
        return path

    def scenario(self, quant_changes=None):
        quant = dict(self.data)
        quant['bert/model.onnx'] = b'BERT quantized'
        quant.update(quant_changes or {})
        official = self.archive('official.zip', self.data)
        github = self.archive('github.zip', self.data)
        hf = self.archive('hf.zip', self.data)
        quant_path = self.archive('quant.zip', quant)
        files = dict(official=official, github_release=github, hf_original=hf, hf_quant=quant_path)
        sig1, sig2 = digests(official), digests(quant_path)
        expected = dict(publisher_md5=sig1['md5'], original_sha256=sig1['sha256'],
                        quant_sha256=sig2['sha256'], original_size=sig1['bytes'],
                        quant_size=sig2['bytes'])
        return files, expected

    def test_only_bert_diff_passes_binary_gate_not_rights(self):
        files, expected = self.scenario()
        report = verify(files, expected)
        self.assertEqual(report['hash_evidence'], 'PASS')
        self.assertEqual(report['member_evidence'], 'PASS')
        self.assertEqual(report['changed_members'], ['bert/model.onnx'])
        self.assertEqual(report['model_rights'], 'HOLD')

    def test_vits_mutation_fails(self):
        files, expected = self.scenario({'model.onnx': b'VITS modified'})
        report = verify(files, expected)
        self.assertEqual(report['member_evidence'], 'FAIL')
        self.assertIn('model.onnx', report['changed_members'])

    def test_release_mismatch_fails_without_member_read(self):
        files, expected = self.scenario()
        files['github_release'].write_bytes(b'tampered')
        report = verify(files, expected)
        self.assertEqual(report['hash_evidence'], 'FAIL')
        self.assertEqual(report['member_evidence'], 'NOT_CHECKED')

    def test_no_notices_fails(self):
        self.data.pop('LICENSE')
        files, expected = self.scenario()
        report = verify(files, expected)
        self.assertEqual(report['member_evidence'], 'PASS')
        self.assertEqual(report['notice_evidence'], 'FAIL')
        self.assertEqual(report['notices'], {'original': [], 'quantized': []})

    def test_zip_traversal_fails(self):
        data = dict(self.data)
        data['../escape'] = b'oops'
        target = self.archive('unsafe.zip', data, prefix='')
        with self.assertRaises(EvidenceFailure):
            inventory(target)

    def test_duplicate_members_fail(self):
        target = self.archive('dupes.zip', self.data)
        with zipfile.ZipFile(target, 'a') as zf:
            import warnings
            with warnings.catch_warnings():
                warnings.simplefilter('ignore', UserWarning)
                zf.writestr('model/model.onnx', b'evil')
        with self.assertRaises(EvidenceFailure):
            inventory(target)


if __name__ == '__main__':
    unittest.main()
