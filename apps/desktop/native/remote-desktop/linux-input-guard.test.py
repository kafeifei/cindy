"""Native ordering with a simulated synchronous WM grab; no display or user input."""
import ctypes
import importlib.util
import pathlib
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location(
    "input_guard", pathlib.Path(__file__).with_name("linux-input-guard.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class InputGuardTests(unittest.TestCase):
    def fixture(self, states, mapping=(1, 2, 3, 4, 5, 6, 7)):
        display = module.Display.__new__(module.Display)
        display.connection, display.root, display.screen = 1, 2, 0
        display.width, display.height = 1280, 800
        display.keys, display.buttons = set(), set()
        calls = []
        remaining = iter(states)
        last = 0

        def query(_connection, _window, _root, _child, *_args):
            nonlocal last
            last = next(remaining, last)
            ctypes.cast(_args[-1], ctypes.POINTER(ctypes.c_uint))[0] = last
            calls.append(('state', last))
            return 1

        def get_mapping(_connection, output, _length):
            for index, value in enumerate(mapping):
                output[index] = value
            return len(mapping)

        display.library = SimpleNamespace(
            XQueryPointer=Mock(side_effect=query), XGetPointerMapping=Mock(side_effect=get_mapping),
            XKeysymToKeycode=lambda *_: 38, XStringToKeysym=lambda *_: 1,
            XSync=Mock(), XCloseDisplay=Mock(),
        )
        display.test = SimpleNamespace(
            XTestFakeKeyEvent=Mock(side_effect=lambda _c, key, down, _t: calls.append(('key', key, down))),
            XTestFakeButtonEvent=Mock(side_effect=lambda _c, button, down, _t: calls.append(('button', button, down))),
            XTestFakeMotionEvent=Mock(),
        )
        return display, calls

    def test_waits_for_replayed_release_before_delivering_keyboard(self):
        display, calls = self.fixture([256, 256, 256, 0])
        with patch.object(module.time, 'sleep') as sleep:
            display.command(['mousedown', '1', 'mouseup', '1', 'keydown', 'a', 'keyup', 'a'])
        self.assertLess(calls.index(('state', 0)), calls.index(('key', 38, True)))
        self.assertEqual(sleep.call_count, 2)
        self.assertEqual(display.test.XTestFakeButtonEvent.call_count, 2)  # never replay
        self.assertFalse(display.buttons)
        self.assertFalse(display.keys)

    def test_no_delay_when_logical_state_already_matches(self):
        display, _ = self.fixture([256, 0])
        with patch.object(module.time, 'sleep') as sleep:
            display.command(['mousedown', '1', 'mouseup', '1'])
        sleep.assert_not_called()

    def test_follows_swapped_pointer_mapping(self):
        display, calls = self.fixture([1024, 1024, 0], mapping=(3, 2, 1, 4, 5, 6, 7))
        with patch.object(module.time, 'sleep'):
            display.command(['mousedown', '1', 'mouseup', '1', 'keydown', 'a'])
        self.assertLess(calls.index(('state', 0)), calls.index(('key', 38, True)))

    def test_shared_deadline_stops_batch_without_replaying_and_cleanup_releases(self):
        display, calls = self.fixture([256, 256])
        with patch.object(module.time, 'monotonic', side_effect=[10, 11.1]):
            with self.assertRaisesRegex(ValueError, 'pointer processing timeout'):
                display.command(['mousedown', '1', 'mouseup', '1', 'keydown', 'a'])
        self.assertFalse(any(call[0] == 'key' for call in calls))
        self.assertEqual(display.buttons, {1})  # uncertain release is retained for cleanup
        display.library.XQueryPointer.reset_mock()
        display.close()
        display.library.XQueryPointer.assert_not_called()  # cleanup must not block on the grab
        display.library.XCloseDisplay.assert_called_once()
        self.assertFalse(display.buttons)

    def test_window_screen_change_stops_before_following_key(self):
        display, calls = self.fixture([])
        display.library.XQueryPointer.return_value = 0
        display.library.XQueryPointer.side_effect = None
        with self.assertRaisesRegex(ValueError, 'pointer unavailable'):
            display.command(['mousedown', '1', 'keydown', 'a'])
        self.assertFalse(any(call[0] == 'key' for call in calls))
        self.assertEqual(display.buttons, {1})

    def test_drag_and_horizontal_wheel_do_not_wait_for_unrepresentable_masks(self):
        display, _ = self.fixture([256])
        display.command(['mousedown', '1', 'mousemove', '30', '40'])
        self.assertEqual(display.buttons, {1})
        display.library.XQueryPointer.reset_mock()
        display.command(['click', '--repeat', '2', '--delay', '0', '6'])
        display.library.XQueryPointer.assert_not_called()
        self.assertEqual(display.buttons, {1})
        display.close()


if __name__ == '__main__':
    unittest.main()
