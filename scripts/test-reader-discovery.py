"""Only synthetic storage directories; no registry, real accounts or key capture."""
import pathlib,sys,tempfile,unittest
sys.path.insert(0,str(pathlib.Path(__file__).parent))
from reader_setup import discover_accounts

class DiscoveryTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='wechatgirl-discovery-');self.addCleanup(self.temp.cleanup)
        self.root=pathlib.Path(self.temp.name)
    def account(self,base,name='fictional-account',ready=True):
        account=base/name
        for part in ('message/message_0.db','contact/contact.db'):
            target=account/'db_storage'/part;target.parent.mkdir(parents=True,exist_ok=True)
            if ready:target.write_bytes(b'synthetic placeholder; never opened as database')
        return account
    def test_storage_parent_common_root_account_and_db_storage(self):
        account=self.account(self.root/'xwechat_files')
        for selected in (self.root,self.root/'xwechat_files',account,account/'db_storage'):
            with self.subTest(selected=selected.name):
                rows=discover_accounts(str(selected));self.assertEqual(len(rows),1)
                self.assertEqual(rows[0]['dbPath'],str(account.resolve()));self.assertTrue(rows[0]['ready'])
    def test_named_legacy_root_multiple_accounts_and_no_arbitrary_recursion(self):
        first=self.account(self.root/'WeChat Files','fictional-a')
        second=self.account(self.root/'WeChat Files','fictional-b',ready=False)
        self.account(self.root/'unrelated'/'deeply-nested','must-not-discover')
        rows=discover_accounts(str(self.root));self.assertEqual({r['dbPath'] for r in rows},{str(first.resolve()),str(second.resolve())})
        self.assertEqual([r['myWxid'] for r in rows],['fictional-a','fictional-b']);self.assertFalse(rows[1]['ready'])
    def test_missing_folder_is_not_created_or_replaced(self):
        missing=self.root/'missing';self.assertEqual(discover_accounts(str(missing)),[]);self.assertFalse(missing.exists())

if __name__=='__main__':unittest.main()
