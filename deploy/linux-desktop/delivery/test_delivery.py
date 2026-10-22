import copy
import importlib.util
import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from versioning import load, cloud_version, image_tag, version_key, require_successor, require_same_release, validate
from publish import publish_tags, publish, registry_manifest, check_build
from plan import plan

HERE = Path(__file__).resolve().parent
ACTUAL = load(HERE / 'version.json')
VERSION = {'schemaVersion': 1, 'upstreamVersion': '0.1.108', 'upstreamCommit': 'a'*40,
           'cloudRevision': 1, 'region': 'cn', 'platform': 'linux/amd64'}

class VersionTest(unittest.TestCase):
    def test_full_upstream_version_and_numeric_cloud_order(self):
        self.assertEqual(cloud_version(VERSION), '0.1.108-cloud.1')
        self.assertEqual(image_tag(VERSION), '0.1.108-cloud.1-cn-amd64')
        self.assertGreater(version_key({**VERSION, 'cloudRevision': 10}), version_key({**VERSION, 'cloudRevision': 9}))
        self.assertGreater(version_key({**VERSION, 'upstreamVersion': '0.1.109'}), version_key({**VERSION, 'cloudRevision': 100}))

    def test_rejects_misleading_or_unsafe_versions(self):
        for key, value in [('upstreamVersion', '0.1'), ('upstreamVersion', '0.01.108'), ('upstreamVersion', '0.1.108-cloud.1'),
                           ('cloudRevision', True), ('cloudRevision', '2'), ('cloudRevision', 0),
                           ('region', 'global'), ('platform', 'linux/arm64'), ('upstreamCommit', 'main')]:
            with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                validate({**VERSION, key: value})
        with self.assertRaises(ValueError): validate({**VERSION, 'credentials': 'invalid-fixture'})

    def test_revision_transitions(self):
        self.assertFalse(require_successor(VERSION, VERSION))
        self.assertTrue(require_successor(VERSION, {**VERSION, 'cloudRevision': 2}))
        self.assertTrue(require_successor(VERSION, {**VERSION, 'upstreamVersion': '0.1.109'}))
        for replacement in [{'cloudRevision': 3}, {'upstreamVersion': '0.1.107'}, {'upstreamCommit': 'b'*40},
                            {'upstreamVersion': '0.1.109', 'cloudRevision': 2}]:
            with self.subTest(replacement=replacement), self.assertRaises(ValueError):
                require_successor(VERSION, {**VERSION, **replacement})

    def test_same_release_cannot_point_to_new_digest(self):
        existing = {'version': VERSION, 'image': {'digest': 'sha256:' + 'a'*64}}
        require_same_release(existing, VERSION, 'sha256:' + 'a'*64)
        with self.assertRaises(ValueError): require_same_release(existing, VERSION, 'sha256:' + 'b'*64)

    def test_plan_binds_real_frozen_upstream_without_formal_promotion(self):
        result = plan()
        self.assertEqual(result['version'], ACTUAL)
        self.assertFalse(result['releaseApproved'])
        self.assertEqual(result['channel'], 'candidate')

    def test_missing_previous_object_is_not_treated_as_first_release(self):
        with patch('plan.git', side_effect=[ACTUAL['upstreamCommit'], subprocess.CalledProcessError(1, ['git'])]):
            with self.assertRaises(subprocess.CalledProcessError): plan('a'*40)

class PublishTest(unittest.TestCase):
    def test_existing_identical_image_is_not_pushed_twice(self):
        executed = []
        record = {'config': {'digest': 'sha256:'+'a'*64}}
        publish('registry.example.com/cindy:tag', record['config']['digest'],
                inspect=lambda _: record, execute=lambda *a: executed.append(a))
        self.assertEqual(executed, [])

    def test_conflict_and_read_failure_have_no_external_writes(self):
        executed = []
        with self.assertRaisesRegex(ValueError, 'CONFLICT'):
            publish('registry.example.com/cindy:tag', 'sha256:'+'b'*64,
                    inspect=lambda _: {'config': {'digest': 'sha256:'+'a'*64}}, execute=lambda *a: executed.append(a))
        for text in ['unauthorized', 'network timeout', 'name not found']:
            with patch('publish.subprocess.run', return_value=subprocess.CompletedProcess([], 1, '', text)):
                with self.assertRaisesRegex(ValueError, 'INSPECTION_FAILED'): registry_manifest('example:tag')
        self.assertEqual(executed, [])
        with patch('publish.subprocess.run', return_value=subprocess.CompletedProcess([], 1, '', 'ERROR: example:tag: not found')):
            self.assertIsNone(registry_manifest('example:tag'))

    def test_publish_uses_tested_config_and_rejects_changed_bytes(self):
        calls = []
        replies = iter([None, {'config': {'digest': 'sha256:'+'a'*64}}])
        publish('registry.example.com/cindy:tag', 'sha256:'+'a'*64,
                inspect=lambda _: next(replies), execute=lambda *a: calls.append(a))
        self.assertEqual(calls[0], ('docker', 'tag', 'sha256:'+'a'*64, 'registry.example.com/cindy:tag'))
        self.assertEqual(calls[1][0:2], ('docker', 'push'))
        replies = iter([None, {'config': {'digest': 'sha256:'+'b'*64}}])
        with self.assertRaisesRegex(ValueError, 'PUBLISHED_CONFIG_MISMATCH'):
            publish('registry.example.com/cindy:tag', 'sha256:'+'a'*64,
                    inspect=lambda _: next(replies), execute=lambda *a: None)

    def test_two_tags_preflight_conflicts_and_recover_partial_publish(self):
        # Integration-boundary regression: a conflicting second alias must not
        # publish the first; a retry after one successful push fills only the gap.
        refs = ['registry.example.com/cindy:version', 'registry.example.com/cindy:sha']
        image_id = 'sha256:' + 'a'*64
        state = {refs[1]: {'config': {'digest': 'sha256:' + 'b'*64}}}
        writes = []
        def execute(*args):
            writes.append(args)
            if args[1] == 'push': state[args[2]] = {'config': {'digest': image_id}}
        with self.assertRaisesRegex(ValueError, 'CONFLICT'):
            publish_tags(refs, image_id, inspect=state.get, execute=execute)
        self.assertEqual(writes, [])
        state = {refs[0]: {'config': {'digest': image_id}}}
        publish_tags(refs, image_id, inspect=state.get, execute=execute)
        self.assertEqual([w[2] for w in writes if w[1] == 'push'], [refs[1]])
        self.assertEqual(state[refs[0]], state[refs[1]])

    def test_prepublication_gate_rejects_wrong_source_and_incomplete_smoke(self):
        with tempfile.TemporaryDirectory() as temporary:
            records = Path(temporary)
            p = {'version': VERSION, 'imageTag': image_tag(VERSION), 'channel': 'candidate', 'releaseApproved': False, 'recipeCommit': 'a'*40}
            image_id = 'sha256:'+'c'*64
            info = {'Id': image_id, 'Os': 'linux', 'Architecture': 'amd64', 'RootFS': {'Layers': ['a','b']}, 'Config': {'Labels': {
                'io.cindy.source-commit': 'a'*40, 'io.cindy.upstream-version': VERSION['upstreamVersion'],
                'io.cindy.cloud-revision': str(VERSION['cloudRevision']), 'io.cindy.region': 'cn', 'io.cindy.target-architecture': 'amd64'}}}
            result = {'imageId': image_id, 'recipeCommit': 'a'*40}
            proof = {'imageId': image_id, 'passed': True, 'nativeArchitecture': 'x86_64', 'applicationVersion': '0.1.108-cloud.1', **{k:True for k in ['networkIsolated','readOnlyRoot','sandboxedRenderers','legacyHome','desktopReady','shutdown']}}
            for n in ['runtime-layer-audit.json','agent-source-proof.json','overlay-application.json']:
                (records/n).write_text('{}')
            (records/'build-inputs.json').write_text(json.dumps({'recipeCommit':'a'*40,'version':VERSION}))
            self.assertEqual(len(check_build(p,info,result,proof,records)),4)
            for key,value in [('imageId','sha256:'+'b'*64),('networkIsolated',False),('nativeArchitecture','arm64'),('shutdown',False),('applicationVersion','0.1.108')]:
                with self.subTest(key=key), self.assertRaises(ValueError): check_build(p,info,result,{**proof,key:value},records)
            broken = copy.deepcopy(info);broken['Config']['Labels']['io.cindy.cloud-revision']='99'
            with self.assertRaisesRegex(ValueError, 'LABEL'): check_build(p,broken,result,proof,records)

if __name__ == '__main__': unittest.main()
