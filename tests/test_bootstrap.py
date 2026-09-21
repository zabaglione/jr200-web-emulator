# SPDX-License-Identifier: BSD-3-Clause
"""Offline unit checks only. These do NOT assert a real GitHub write succeeded."""
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('bootstrap',ROOT/'scripts/bootstrap_github.py')
b=importlib.util.module_from_spec(spec); spec.loader.exec_module(b)
class Tests(unittest.TestCase):
    def test_names(self):
        self.assertEqual(b.validate_name('zabaglione/jr200-web-emulator'),('zabaglione','jr200-web-emulator'))
        for name in ['--public','owner','../name','a/b/c','a/ name']:
            with self.assertRaises(b.BootstrapError): b.validate_name(name)
    def test_visibility_guard(self):
        b.validate_private({'full_name':'a/b','private':True,'visibility':'private'},'a/b')
        for meta in [{'full_name':'a/b','private':False},{'full_name':'a/b','private':True,'visibility':'public'},{'full_name':'a/c','private':True},{'full_name':'a/b','private':True,'fork':True}]:
            with self.assertRaises(b.BootstrapError):b.validate_private(meta,'a/b')
    def test_dependency_rendering(self):
        self.assertEqual(b.render_body('Needs {{P00}}',{'P00':42}),'Needs #42')
        with self.assertRaises(b.BootstrapError):b.render_body('Needs {{P02}}',{})
    def test_real_plan_is_ordered(self):
        rows=b.load_plan();self.assertEqual(len(rows),14)
        self.assertEqual([r['id'] for r in rows],[f'P{i:02}' for i in range(14)])
    def test_distribution_source_allowlist(self):
        self.assertIn('LICENSES/VJR200.txt',b.source_inventory())
    def test_path_traversal_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);(root/'source-manifest.json').write_text(json.dumps({'files':['../private.bin']}))
            with self.assertRaises(b.BootstrapError):b.source_inventory(root)
if __name__=='__main__':unittest.main()
