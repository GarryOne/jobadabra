"""python -m src.stores call: the desktop's one way into the active store."""
import base64
import io
import json
import os
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from src.stores import __main__ as cli
from src.stores import memory, sqlite


class StoreCliTests(unittest.TestCase):
    def run_cli(self, *argv, stores=None):
        out = io.StringIO()
        with mock.patch.object(cli, 'open_stores', return_value=stores or memory.open_store()), \
                mock.patch.dict(os.environ, {'JOBADABRA_STORE': 'memory'}):
            code = cli.main(list(argv), out=out)
        return code, json.loads(out.getvalue())

    def test_a_method_runs_on_the_active_store_and_answers_json(self):
        stores = memory.open_store()
        code, answer = self.run_cli('call', 'applications', 'set_stage',
                                    json.dumps({'job': {'url': 'https://x.example/1'}, 'stage': 'Saved'}), stores=stores)
        self.assertEqual((code, answer['result'][1]), (0, 'created'))
        code, answer = self.run_cli('call', 'applications', 'stages', stores=stores)
        self.assertEqual(answer['result'], {'https://x.example/1': 'Saved'})

    def test_moves_bytes_private_and_unknown_methods_are_refused(self):
        for entity, method in (('applications', 'put'), ('applications', 'attach'),
                               ('applications', '_get'), ('applications', 'rows'), ('nosuch', 'list')):
            code, answer = self.run_cli('call', entity, method)
            self.assertEqual(code, 2, f'{entity}.{method}')
            self.assertIn('not callable', answer['error'])

    def test_a_jobs_files_come_as_base64_on_every_store(self):
        folder = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, folder, True)
        for stores in (memory.open_store(), sqlite.open_store({'JOBADABRA_DATA_DIR': str(folder)})):
            app = stores.applications.create({'url': 'https://x.example/files', 'title': 'SRE', 'company': 'Acme'}, 'Saved')
            stores.applications.attach(app['id'], 'reply.png', b'\x89PNG-bytes', 'image/png')
            code, answer = self.run_cli('call', 'applications', 'files', json.dumps({'app_id': app['id']}), stores=stores)
            self.assertEqual(code, 0, type(stores.applications).__module__)
            [shot] = answer['result']
            self.assertEqual((shot['name'], shot['content_type'], shot['size'], shot['too_large']), ('reply.png', 'image/png', 10, False))
            self.assertEqual(base64.b64decode(shot['data']), b'\x89PNG-bytes')

    def test_a_file_the_app_made_is_attached_from_its_folder_only(self):
        """The desktop keeps a tailored CV on the job (lib/store/files.js attachToJob): the bytes come from a file in the app's folder."""
        app_dir = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, app_dir, True)
        data = app_dir / 'data'
        (app_dir / 'cv' / 'tailored').mkdir(parents=True)
        pdf = app_dir / 'cv' / 'tailored' / 'abc.pdf'
        pdf.write_bytes(b'%PDF-tailored')
        stores = sqlite.open_store({'JOBADABRA_DATA_DIR': str(data)})
        app = stores.applications.create({'url': 'https://x.example/cv', 'title': 'SRE', 'company': 'Acme'}, 'Saved')
        kwargs = {'app_id': app['id'], 'name': 'CV · Acme · SRE.pdf', 'content_type': 'application/pdf', 'path': str(pdf)}
        with mock.patch.dict(os.environ, {'JOBADABRA_DATA_DIR': str(data)}):
            code, _ = self.run_cli('call', 'applications', 'attach', json.dumps(kwargs), stores=stores)
            self.assertEqual(code, 0)
            self.assertEqual(stores.applications.files(app['id']), [('CV · Acme · SRE.pdf', b'%PDF-tailored', 'application/pdf')])
            outside = Path(tempfile.mkdtemp()) / 'secret.txt'
            outside.write_text('not the app\'s')
            self.addCleanup(shutil.rmtree, outside.parent, True)
            for path in (str(outside), str(app_dir / 'cv' / '..' / '..' / outside.name), str(app_dir / 'cv')):   # outside, climbing out, a folder
                code, answer = self.run_cli('call', 'applications', 'attach', json.dumps({**kwargs, 'path': path}), stores=stores)
                self.assertEqual(code, 2, path)
            link = app_dir / 'cv' / 'tailored' / 'escape.pdf'   # a symlink inside the folder to a file outside it: refused after resolution
            link.symlink_to(outside)
            fifo = app_dir / 'cv' / 'tailored' / 'pipe'
            if hasattr(os, 'mkfifo'):                            # Unix only
                os.mkfifo(fifo)                                  # not a regular file
            for path in (link, fifo) if fifo.exists() else (link,):
                code, answer = self.run_cli('call', 'applications', 'attach', json.dumps({**kwargs, 'path': str(path)}), stores=stores)
                self.assertEqual(code, 2, path)
            with mock.patch.object(cli, 'FILE_CAP', 4):          # too big
                code, answer = self.run_cli('call', 'applications', 'attach', json.dumps(kwargs), stores=stores)
            self.assertEqual(code, 2)
            self.assertIn('too large', answer['error'])
            code, answer = self.run_cli('call', 'applications', 'attach', json.dumps({**kwargs, 'data': 'AAAA'}), stores=stores)
            self.assertIn('not callable', answer['error'], 'raw bytes stay refused')
        with mock.patch.dict(os.environ, {}, clear=True):
            code, _ = self.run_cli('call', 'applications', 'attach', json.dumps(kwargs), stores=stores)
        self.assertEqual(code, 2, 'without the app folder nothing is read')

    def test_a_file_over_the_cap_is_listed_without_its_bytes(self):
        stores = memory.open_store()
        app = stores.applications.create({'url': 'https://x.example/big'}, 'Saved')
        stores.applications.attach(app['id'], 'small.png', b'ok', 'image/png')
        stores.applications.attach(app['id'], 'call.m4a', b'x' * 40, '')
        with mock.patch.object(cli, 'FILE_CAP', 10):
            code, answer = self.run_cli('call', 'applications', 'files', json.dumps({'app_id': app['id']}), stores=stores)
        small, big = answer['result']
        self.assertEqual((small['too_large'], base64.b64decode(small['data'])), (False, b'ok'))
        self.assertEqual((big['too_large'], big['data'], big['size'], big['content_type']), (True, None, 40, 'application/octet-stream'))
        with mock.patch.object(cli, 'TOTAL_CAP', 1):   # the job's total: past it, the rest come without bytes too
            _, answer = self.run_cli('call', 'applications', 'files', json.dumps({'app_id': app['id']}), stores=stores)
        self.assertEqual([f['too_large'] for f in answer['result']], [True, True])

    def test_an_error_in_the_method_is_said_not_swallowed(self):
        code, answer = self.run_cli('call', 'applications', 'update', json.dumps({'app_id': 'missing', 'fields': {}}))
        self.assertEqual(code, 1)
        self.assertIn('KeyError', answer['error'])


if __name__ == '__main__':
    unittest.main()
