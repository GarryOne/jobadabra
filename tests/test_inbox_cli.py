"""python -m src.ai.inbox (inbox.main): the message goes to the active store (open_stores), with no Notion client of its own;
Notion chosen without a token says "Connect Notion first"."""
import io
import os
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock

from src.ai import inbox
from src.stores import memory


class InboxCommandTests(unittest.TestCase):
    def test_the_command_logs_on_the_active_store_without_a_notion_client(self):
        stores = memory.open_store()
        with tempfile.TemporaryDirectory() as folder:
            note = Path(folder, 'message.txt')
            note.write_text('Hi Ada, thanks for applying to Acme. We would like to talk on Monday.', encoding='utf-8')
            with mock.patch.object(inbox, 'open_stores', return_value=stores) as opened, \
                    mock.patch.object(inbox.notion.Tracker, 'from_env', side_effect=AssertionError('no Notion client here')), \
                    mock.patch.object(inbox, 'log', return_value='✅ Updated: Acme') as logged, redirect_stdout(io.StringIO()) as out:
                self.assertEqual(inbox.main(['--text-file', str(note)]), 0)
        opened.assert_called_once_with()
        self.assertIs(logged.call_args.args[0], stores)
        self.assertIn('Updated: Acme', out.getvalue())

    def test_notion_chosen_without_a_token_says_connect_notion_first(self):
        env = {k: v for k, v in os.environ.items() if k != 'NOTION_TOKEN'}
        with mock.patch.dict(os.environ, {**env, 'JOBADABRA_STORE': 'notion'}, clear=True), \
                self.assertRaisesRegex(SystemExit, 'Connect Notion first'):
            inbox.main(['--text-file', os.devnull])


if __name__ == '__main__':
    unittest.main()
