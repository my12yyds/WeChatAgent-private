"""Offline tests only: no WindowsDriver and no real UI or posts."""
import datetime
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('publisher', Path(__file__).resolve().parents[1] / 'optional-extensions/persona-moments/bridge/publisher.py')
publisher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(publisher)

class Driver:
    def __init__(self, fail=False): self.prepared = self.published = 0; self.fail = fail
    def prepare(self, text): self.prepared += 1
    def validate_ready(self, text): pass
    def publish(self):
        self.published += 1
        if self.fail: raise RuntimeError('simulated lost receipt')

class Receipts(unittest.TestCase):
    def request(self, folder):
        return dict(pid=1, text='离线测试文案', mode='publish', maxPosts=3, date=datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=8))).date().isoformat(), receiptDir=str(folder))
    def test_unknown_blocks_even_below_daily_limit(self):
        with tempfile.TemporaryDirectory() as directory:
            folder=Path(directory); req=self.request(folder); driver=Driver(True)
            self.assertEqual(publisher.operate(req, driver, lambda: True, folder)['status'], 'unknown')
            self.assertEqual(driver.published, 1)
            next_driver=Driver(); self.assertEqual(publisher.operate(req, next_driver, lambda: True, folder)['status'], 'blocked_existing_receipt')
            self.assertEqual(next_driver.prepared, 0)
    def test_same_text_never_reposts_and_preview_never_commits(self):
        with tempfile.TemporaryDirectory() as directory:
            folder=Path(directory); req=self.request(folder); driver=Driver()
            publisher.operate(req, driver, lambda: True, folder)
            self.assertEqual(publisher.operate(req, driver, lambda: True, folder)['status'], 'blocked_existing_receipt'); self.assertEqual(driver.published, 1)
            req['mode']='preview'; self.assertEqual(publisher.operate(req, driver, lambda: False, folder)['status'], 'preview_ready'); self.assertEqual(driver.published, 1)

if __name__ == '__main__': unittest.main()
