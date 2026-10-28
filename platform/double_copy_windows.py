#!/usr/bin/env python3
"""Passive Ctrl+C twice detector; emits JSON lines, never reads clipboard data."""

import ctypes
from ctypes import wintypes
import json
import sys
import threading
import time

from double_copy_state import DoubleCopyState


def emit(**fields):
    print(json.dumps(fields, separators=(',', ':')), flush=True)


def main():
    if sys.platform != 'win32':
        emit(type='status', ready=False, error='windows-required')
        return 4

    user32 = ctypes.WinDLL('user32', use_last_error=True)
    kernel32 = ctypes.WinDLL('kernel32', use_last_error=True)
    LRESULT = ctypes.c_ssize_t
    WPARAM = ctypes.c_size_t
    LPARAM = ctypes.c_ssize_t
    HHOOK = wintypes.HANDLE
    HOOKPROC = ctypes.WINFUNCTYPE(LRESULT, ctypes.c_int, WPARAM, LPARAM)

    class KBDLLHOOKSTRUCT(ctypes.Structure):
        _fields_ = [('vkCode', wintypes.DWORD), ('scanCode', wintypes.DWORD),
                    ('flags', wintypes.DWORD), ('time', wintypes.DWORD),
                    ('dwExtraInfo', ctypes.c_size_t)]

    user32.SetWindowsHookExW.argtypes = (ctypes.c_int, HOOKPROC, wintypes.HINSTANCE, wintypes.DWORD)
    user32.SetWindowsHookExW.restype = HHOOK
    user32.CallNextHookEx.argtypes = (HHOOK, ctypes.c_int, WPARAM, LPARAM)
    user32.CallNextHookEx.restype = LRESULT
    user32.UnhookWindowsHookEx.argtypes = (HHOOK,)
    user32.UnhookWindowsHookEx.restype = wintypes.BOOL
    user32.GetClipboardSequenceNumber.argtypes = ()
    user32.GetClipboardSequenceNumber.restype = wintypes.DWORD
    user32.GetAsyncKeyState.argtypes = (ctypes.c_int,)
    user32.GetAsyncKeyState.restype = wintypes.SHORT
    user32.GetForegroundWindow.argtypes = ()
    user32.GetForegroundWindow.restype = wintypes.HWND
    user32.GetWindowThreadProcessId.argtypes = (wintypes.HWND, ctypes.POINTER(wintypes.DWORD))
    user32.GetWindowThreadProcessId.restype = wintypes.DWORD
    user32.GetMessageW.argtypes = (ctypes.POINTER(wintypes.MSG), wintypes.HWND,
                                    wintypes.UINT, wintypes.UINT)
    user32.GetMessageW.restype = ctypes.c_int
    user32.PeekMessageW.argtypes = (ctypes.POINTER(wintypes.MSG), wintypes.HWND,
                                    wintypes.UINT, wintypes.UINT, wintypes.UINT)
    user32.PeekMessageW.restype = wintypes.BOOL
    user32.SetTimer.argtypes = (wintypes.HWND, ctypes.c_size_t, wintypes.UINT, ctypes.c_void_p)
    user32.SetTimer.restype = ctypes.c_size_t
    user32.KillTimer.argtypes = (wintypes.HWND, ctypes.c_size_t)
    user32.KillTimer.restype = wintypes.BOOL
    user32.PostThreadMessageW.argtypes = (wintypes.DWORD, wintypes.UINT, WPARAM, LPARAM)
    user32.PostThreadMessageW.restype = wintypes.BOOL
    kernel32.GetCurrentThreadId.argtypes = ()
    kernel32.GetCurrentThreadId.restype = wintypes.DWORD
    kernel32.GetModuleHandleW.argtypes = (wintypes.LPCWSTR,)
    kernel32.GetModuleHandleW.restype = wintypes.HMODULE

    WH_KEYBOARD_LL = 13
    WM_KEYDOWN, WM_KEYUP, WM_SYSKEYDOWN, WM_SYSKEYUP = 0x100, 0x101, 0x104, 0x105
    WM_TIMER, WM_QUIT = 0x113, 0x12
    VK_C, VK_CONTROL, VK_SHIFT, VK_MENU = 0x43, 0x11, 0x10, 0x12
    VK_LCONTROL, VK_RCONTROL = 0xA2, 0xA3
    VK_LWIN, VK_RWIN = 0x5B, 0x5C
    detector = DoubleCopyState()
    hook = HHOOK()
    trigger_queue = []
    c_physically_down = False

    def down(vk):
        return bool(user32.GetAsyncKeyState(vk) & 0x8000)

    def valid_modifiers():
        return (down(VK_CONTROL) and not any(down(v) for v in
                (VK_SHIFT, VK_MENU, VK_LWIN, VK_RWIN)))

    def foreground():
        hwnd = user32.GetForegroundWindow()
        if not hwnd:
            return None
        pid = wintypes.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
        return (int(hwnd), int(pid.value)) if pid.value else None

    if sys.argv[1:] == ['--snapshot']:
        emit(type='snapshot', sequence=user32.GetClipboardSequenceNumber(), foreground=foreground())
        return 0
    if len(sys.argv) != 1:
        emit(type='status', ready=False, error='unsupported-arguments')
        return 4

    @HOOKPROC
    def callback(code, wparam, lparam):
        nonlocal c_physically_down
        # Always forward, including errors, injected events, and unhandled keys.
        try:
            if code >= 0:
                event = ctypes.cast(lparam, ctypes.POINTER(KBDLLHOOKSTRUCT)).contents
                key_down = wparam in (WM_KEYDOWN, WM_SYSKEYDOWN)
                key_up = wparam in (WM_KEYUP, WM_SYSKEYUP)
                if event.vkCode == VK_C:
                    if key_down:
                        if not c_physically_down:
                            c_physically_down = True
                            context = foreground()
                            detector.key_down(time.monotonic(), user32.GetClipboardSequenceNumber(),
                                              valid_modifiers() and context is not None,
                                              context=context)
                    elif key_up:
                        c_physically_down = False
                        context = foreground()
                        if detector.key_up(context=context):
                            trigger_queue.append((detector.trigger_sequence, context))
                elif key_down and event.vkCode not in (VK_CONTROL, VK_LCONTROL, VK_RCONTROL):
                    detector.interrupt()
                    trigger_queue.clear()
        except Exception:
            detector.interrupt()
            trigger_queue.clear()
        return user32.CallNextHookEx(hook, code, wparam, lparam)

    # GetMessage requires an existing thread queue before the stdin watcher starts.
    msg = wintypes.MSG()
    user32.PeekMessageW(ctypes.byref(msg), None, 0, 0, 0)
    thread_id = kernel32.GetCurrentThreadId()
    hook = user32.SetWindowsHookExW(WH_KEYBOARD_LL, callback,
                                   kernel32.GetModuleHandleW(None), 0)
    if not hook:
        emit(type='status', ready=False, error='keyboard-hook-unavailable',
             winerror=ctypes.get_last_error())
        return 2
    timer = user32.SetTimer(None, 0, 20, None)
    if not timer:
        user32.UnhookWindowsHookEx(hook)
        emit(type='status', ready=False, error='timer-unavailable',
             winerror=ctypes.get_last_error())
        return 2

    def watch_stdin():
        try:
            while sys.stdin.buffer.read(1024):
                pass
        finally:
            user32.PostThreadMessageW(thread_id, WM_QUIT, 0, 0)

    threading.Thread(target=watch_stdin, daemon=True).start()
    emit(type='status', ready=True, platform='windows', shortcut='Ctrl+C,C')
    try:
        while True:
            result = user32.GetMessageW(ctypes.byref(msg), None, 0, 0)
            if result <= 0:
                return 0 if result == 0 else 5
            if msg.message == WM_TIMER:
                sequence = user32.GetClipboardSequenceNumber()
                context = foreground()
                if detector.observe(time.monotonic(), sequence, context=context):
                    trigger_queue.append((detector.trigger_sequence, context))
                while trigger_queue:
                    triggered_sequence, triggered_context = trigger_queue.pop(0)
                    if triggered_context is not None and foreground() == triggered_context:
                        emit(type='trigger', source='double-copy', sequence=triggered_sequence,
                             foreground=triggered_context, clipboardIsFresh=True)
            else:
                user32.TranslateMessage(ctypes.byref(msg))
                user32.DispatchMessageW(ctypes.byref(msg))
    finally:
        user32.KillTimer(None, timer)
        user32.UnhookWindowsHookEx(hook)


if __name__ == '__main__':
    raise SystemExit(main())
