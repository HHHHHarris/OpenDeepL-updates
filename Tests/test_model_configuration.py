import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from core import model_lifecycle as lifecycle


class ModelConfigurationTests(unittest.TestCase):
    def test_adding_fast_or_moving_reference_changes_router_configuration(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            quality, fast, template = (root / name for name in ('quality.gguf', 'fast.gguf', 'chat.jinja'))
            quality.write_bytes(b'quality')
            template.write_text('template')
            with patch.multiple(lifecycle, QUALITY=quality, FAST=fast, TEMPLATE=template):
                initial = lifecycle.preset_identity()
                self.assertEqual(initial, lifecycle.preset_identity())
                fast.write_bytes(b'fast')
                self.assertNotEqual(initial, lifecycle.preset_identity())
                both = lifecycle.preset_identity()
                moved = root / 'other.gguf'
                moved.write_bytes(b'quality')
                with patch.object(lifecycle, 'QUALITY', moved):
                    self.assertNotEqual(both, lifecycle.preset_identity())
