import copy
import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent))
from release_guard import *

class ReleaseGuardTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.layer = self.root / 'layer'
        self.expected = {
            'opt/cindy/Cindy': {'mode': 0o755, 'sha256': hashlib.sha256(b'program').hexdigest()},
            'opt/cindy/resources/app.asar': {'mode': 0o644, 'sha256': hashlib.sha256(b'data').hexdigest()},
        }
        previous = os.umask(0o077)
        try:
            for name, body in [('opt/cindy/Cindy', b'program'), ('opt/cindy/resources/app.asar', b'data')]:
                p = self.layer / name
                p.parent.mkdir(parents=True, exist_ok=True)
                p.write_bytes(body)
        finally:
            os.umask(previous)
        self.base = {'RootFS': {'Layers': ['base']}}
        self.image = {'Id': 'image-test', 'Os': 'linux', 'Architecture': 'amd64', 'Size': 100,
                      'RootFS': {'Layers': ['base', 'application']},
                      'Config': {'User': 'cindy', 'Entrypoint': ENTRYPOINT, 'Cmd': CMD,
                                 'Labels': {'io.cindy.source-commit': 'commit', 'io.cindy.entrypoint-sha256': 'wrapper'}}}

    def tearDown(self):
        self.temp.cleanup()

    def prepare(self):
        normalize_layer(self.layer, self.expected)
        return audit_layer(self.layer, self.expected)

    def test_reject_original_umask_failure(self):
        with self.assertRaisesRegex(ReleaseRejected, 'DIRECTORY_PERMISSION'):
            audit_layer(self.layer, self.expected)

    def test_normalize_under_restrictive_umask_preserves_bytes(self):
        old = os.umask(0o077)
        try:
            result = self.prepare()
        finally:
            os.umask(old)
        self.assertEqual(result['files'], 2)
        self.assertEqual((self.layer/'opt/cindy/Cindy').stat().st_mode&0o777, 0o755)
        self.assertEqual((self.layer/'opt/cindy/resources/app.asar').stat().st_mode&0o777, 0o644)

    def test_late_directory_permission_regression(self):
        self.prepare()
        (self.layer/'opt').chmod(0o700)
        with self.assertRaisesRegex(ReleaseRejected, 'DIRECTORY_PERMISSION'):
            audit_layer(self.layer, self.expected)

    def test_missing_executable_bit(self):
        self.prepare()
        (self.layer/'opt/cindy/Cindy').chmod(0o644)
        with self.assertRaisesRegex(ReleaseRejected, 'FILE_PERMISSION'):
            audit_layer(self.layer, self.expected)

    def test_content_change_rejected(self):
        self.prepare()
        (self.layer/'opt/cindy/resources/app.asar').write_bytes(b'changed')
        with self.assertRaisesRegex(ReleaseRejected, 'LAYER_CONTENT_CHANGED'):
            audit_layer(self.layer, self.expected)

    def test_unexpected_files_missing_files_and_symlinks(self):
        self.prepare()
        p=self.layer/'opt/unreviewed'
        p.write_text('extra')
        with self.assertRaises(ReleaseRejected):audit_layer(self.layer,self.expected)
        p.unlink();p.symlink_to('/tmp')
        with self.assertRaisesRegex(ReleaseRejected,'SYMLINK'):audit_layer(self.layer,self.expected)
        p.unlink();(self.layer/'opt/cindy/Cindy').unlink()
        with self.assertRaisesRegex(ReleaseRejected,'FILE_SET'):audit_layer(self.layer,self.expected)

    def test_image_arch_user_command_and_layers(self):
        audit_image(self.image,self.base,'commit','wrapper')
        for key,value in [('Architecture','arm64'),('Os','darwin'),('RootFS',{'Layers':['base','old-app','new-app']})]:
            bad=copy.deepcopy(self.image);bad[key]=value
            with self.assertRaises(ReleaseRejected):audit_image(bad,self.base,'commit','wrapper')
        for key,value in [('User','root'),('Entrypoint',['/bin/sh']),('Cmd',['sleep','infinity'])]:
            bad=copy.deepcopy(self.image);bad['Config'][key]=value
            with self.assertRaises(ReleaseRejected):audit_image(bad,self.base,'commit','wrapper')

    def test_unverified_or_different_image_cannot_release(self):
        layer=self.prepare()
        proof={'imageId':self.image['Id'],'layerSha256':layer['layerSha256'],'uid':10001,'passed':True,
               **{k:True for k in ['isolatedData','networkIsolated','rootFilesystemReadOnly','sandboxVerified','rendererReady','shutdownVerified','keyringVerified']}}
        require_startup_proof(self.image,layer,proof)
        for key,value in [('imageId','old-image'),('layerSha256','old-layer'),('uid',0),('passed',False),('rendererReady',False),('shutdownVerified',False)]:
            with self.subTest(field=key),self.assertRaises(ReleaseRejected):
                require_startup_proof(self.image,layer,{**proof,key:value})

    def test_different_formal_publication_is_not_overwritten(self):
        require_promotion_base('old','old','candidate')
        require_promotion_base('candidate','old','candidate')
        with self.assertRaisesRegex(ReleaseRejected,'FORMAL_TAG_CHANGED'):
            require_promotion_base('another-publication','old','candidate')

if __name__ == '__main__':
    unittest.main(verbosity=2)
