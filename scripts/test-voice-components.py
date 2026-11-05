"""Synthetic ZIPs only; imported files are never executed."""
import hashlib,json,pathlib,runpy,tempfile,unittest,zipfile
loader=runpy.run_path(str(pathlib.Path(__file__).with_name('import-voice-components.py')))
install=loader['install'];ImportFailure=loader['ImportFailure']
class ImportTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='wechatgirl-voice-import-');self.addCleanup(self.temp.cleanup)
        self.root=pathlib.Path(self.temp.name);self.home=self.root/'data';self.home.mkdir();self.archive=self.root/'components.zip'
    def make(self,extras=(),corrupt=False):
        with zipfile.ZipFile(self.archive,'w') as z:
            z.writestr('data/voice-python/python.exe',b'fixture executable; never run')
            z.writestr('data/voice-wsl/rootfs.tar.gz',b'fixture image; never run')
            z.writestr('VOICE-OPTIONAL-README.txt','fixture')
            for name in extras:z.writestr(name,b'fixture')
        if corrupt:self.archive.write_bytes(self.archive.read_bytes().replace(b'fixture executable',b'broken! executable',1))
        data=self.archive.read_bytes()
        return {'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest(),'roots':{'voice-python':['python.exe'],'voice-wsl':['rootfs.tar.gz']},'maxFiles':20,'maxExpandedBytes':1024*1024}
    def test_extract_and_keep_existing_directories_unchanged(self):
        spec=self.make();events=[];result=install(self.archive,self.home,spec,events.append)
        self.assertEqual(set(result['installed']),{'voice-python','voice-wsl'})
        marker=self.home/'voice-python'/'owner.txt';marker.write_text('preserve')
        again=install(self.archive,self.home,spec);self.assertEqual(again['installed'],[]);self.assertEqual(marker.read_text(),'preserve')
        self.assertTrue(any(e['phase']=='extracting' for e in events));self.assertFalse((self.home/'.voice-components-import.lock').exists())
    def test_partial_existing_root_is_preserved_while_missing_root_is_added(self):
        (self.home/'voice-python').mkdir();sentinel=self.home/'voice-python'/'custom.txt';sentinel.write_text('preserve')
        spec=self.make();result=install(self.archive,self.home,spec)
        self.assertEqual(result['installed'],['voice-wsl']);self.assertEqual(sentinel.read_text(),'preserve');self.assertFalse((self.home/'voice-python/python.exe').exists())
    def test_bad_hash_leaves_no_runtime_or_lock(self):
        spec=self.make();spec['sha256']='0'*64
        with self.assertRaisesRegex(ImportFailure,'HASH'):install(self.archive,self.home,spec)
        self.assertEqual(list(self.home.iterdir()),[])
    def test_paths_case_collisions_and_file_directory_conflicts_are_rejected(self):
        for name in ('../outside','data/voice-python/../../outside','data/voice-python/CON.txt','data/voice-python/private:stream','data/voice-python/PYTHON.exe','data/voice-python/python.exe/child'):
            with self.subTest(name=name):
                spec=self.make([name])
                with self.assertRaisesRegex(ImportFailure,'PATH'):install(self.archive,self.home,spec)
                self.assertEqual(list(self.home.iterdir()),[])
        self.assertFalse((self.root/'outside').exists())
    def test_crc_failure_removes_only_its_staging_and_keeps_other_files(self):
        spec=self.make(corrupt=True);sentinel=self.home/'owner.txt';sentinel.write_text('preserve')
        with self.assertRaises(zipfile.BadZipFile):install(self.archive,self.home,spec)
        self.assertEqual(list(self.home.iterdir()),[sentinel]);self.assertEqual(sentinel.read_text(),'preserve')
    def test_foreign_lock_is_never_deleted(self):
        spec=self.make();lock=self.home/'.voice-components-import.lock';lock.write_text('another instance')
        with self.assertRaisesRegex(ImportFailure,'BUSY'):install(self.archive,self.home,spec)
        self.assertEqual(lock.read_text(),'another instance')
if __name__=='__main__':unittest.main()
