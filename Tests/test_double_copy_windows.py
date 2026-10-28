import ast
import importlib.util
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
STATE = ROOT / 'platform' / 'double_copy_state.py'
WINDOWS = ROOT / 'platform' / 'double_copy_windows.py'
spec = importlib.util.spec_from_file_location('double_copy_state', STATE)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
DoubleCopyState = module.DoubleCopyState


class DoubleCopyTests(unittest.TestCase):
    def test_real_double_copy_only_once(self):
        s = DoubleCopyState()
        s.key_down(0, 10)
        self.assertFalse(s.observe(.06, 11))
        s.key_up()
        s.key_down(.2, 11)
        self.assertFalse(s.observe(.25, 11))
        self.assertFalse(s.observe(.29, 12))
        self.assertFalse(s.observe(.30, 12))
        self.assertTrue(s.key_up())
        self.assertEqual(s.trigger_sequence, 12)
        s.key_down(.4, 12)
        self.assertFalse(s.observe(.45, 13))

    def test_single_slow_and_empty_copy(self):
        s = DoubleCopyState()
        s.key_down(0, 1)
        self.assertFalse(s.observe(.4, 2))
        s.key_up()
        s.key_down(.8, 2)
        self.assertFalse(s.observe(.85, 3))
        s.key_up()
        s.key_down(1.0, 3)
        self.assertFalse(s.observe(1.1, 3))
        self.assertFalse(s.observe(1.36, 4))

    def test_repeat_interruption_and_modifier_mismatch(self):
        s = DoubleCopyState()
        s.key_down(0, 1)
        s.key_down(.05, 1, repeat=True)
        self.assertFalse(s.observe(.08, 2))
        s.key_up()
        s.interrupt()
        s.key_down(.2, 2)
        self.assertFalse(s.observe(.25, 3))
        s.key_up()
        s.key_down(.3, 3, modifiers_valid=False)
        s.key_up()
        s.key_down(.4, 3)
        self.assertFalse(s.observe(.45, 4))

    def test_unconfirmed_first_never_pairs_with_late_change(self):
        s = DoubleCopyState()
        s.key_down(0, 1)
        s.key_up()
        s.key_down(.1, 1)
        self.assertFalse(s.observe(.15, 2))
        s.key_up()
        s.key_down(.2, 2)
        self.assertFalse(s.observe(.25, 3))

    def test_slow_confirmed_pair_is_not_a_double(self):
        s = DoubleCopyState()
        s.key_down(0, 1)
        self.assertFalse(s.observe(.05, 2))
        s.key_up()
        s.key_down(.61, 2)
        self.assertFalse(s.observe(.66, 3))

    def test_cooldown_requires_gap_and_key_release(self):
        s = DoubleCopyState()
        s.key_down(0, 1)
        self.assertFalse(s.observe(.05, 2))
        s.key_up()
        s.key_down(.2, 2)
        self.assertFalse(s.observe(.25, 3))
        # Held C auto-repeat cannot count as a new first press.
        s.key_down(.9, 3, repeat=True)
        self.assertFalse(s.observe(.95, 4))
        self.assertTrue(s.key_up())
        s.key_down(1.0, 4)
        self.assertFalse(s.observe(1.05, 5))

    def test_latch_first_change_at_second_keydown_without_poll(self):
        s = DoubleCopyState()
        s.key_down(0, 10)
        s.key_up()
        s.key_down(.08, 11)
        self.assertFalse(s.observe(.11, 12))
        self.assertTrue(s.key_up())
        self.assertEqual(s.trigger_sequence, 12)

    def test_second_copy_writes_after_keyup(self):
        s = DoubleCopyState()
        s.key_down(0, 10)
        s.observe(.05, 11)
        s.key_up()
        s.key_down(.2, 11)
        self.assertFalse(s.key_up())
        self.assertTrue(s.observe(.28, 12))
        self.assertFalse(s.observe(.29, 12))

    def test_slow_second_becomes_first_for_next_fast_copy(self):
        s = DoubleCopyState()
        s.key_down(0, 10)
        s.observe(.05, 11)
        s.key_up()
        s.key_down(.7, 11)
        s.observe(.75, 12)
        s.key_up()
        s.key_down(.9, 12)
        self.assertFalse(s.observe(.95, 13))
        self.assertTrue(s.key_up())

    def test_foreground_change_restarts_pair_and_blocks_late_trigger(self):
        s = DoubleCopyState()
        s.key_down(0, 10, context=('window-a', 1))
        s.observe(.05, 11, context=('window-a', 1))
        s.key_up(context=('window-a', 1))
        s.key_down(.2, 11, context=('window-b', 2))
        self.assertFalse(s.observe(.25, 12, context=('window-b', 2)))
        s.key_up(context=('window-b', 2))
        s.key_down(.35, 12, context=('window-b', 2))
        self.assertFalse(s.observe(.40, 13, context=('window-b', 2)))
        self.assertFalse(s.key_up(context=('window-c', 3)))

    def test_windows_source_syntax(self):
        ast.parse(WINDOWS.read_text())


if __name__ == '__main__':
    unittest.main()
