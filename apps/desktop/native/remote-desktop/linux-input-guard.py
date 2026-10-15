import ctypes
import json
import os
import re
import select
import signal
import stat
import sys
import time


def identity(socket):
    info = os.stat(socket)
    if not stat.S_ISSOCK(info.st_mode):
        raise ValueError("display unavailable")
    return info.st_dev, info.st_ino, info.st_ctime_ns


class Display:
    def __init__(self):
        self.library = ctypes.CDLL("libX11.so.6")
        self.test = ctypes.CDLL("libXtst.so.6")
        pointer = ctypes.c_void_p
        integer = ctypes.c_int
        unsigned = ctypes.c_ulong
        self.library.XOpenDisplay.argtypes = [ctypes.c_char_p]
        self.library.XOpenDisplay.restype = pointer
        self.library.XDefaultRootWindow.argtypes = [pointer]
        self.library.XDefaultRootWindow.restype = unsigned
        self.library.XDefaultScreen.argtypes = [pointer]
        self.library.XDisplayWidth.argtypes = [pointer, integer]
        self.library.XDisplayHeight.argtypes = [pointer, integer]
        self.library.XStringToKeysym.argtypes = [ctypes.c_char_p]
        self.library.XStringToKeysym.restype = unsigned
        self.library.XKeysymToKeycode.argtypes = [pointer, unsigned]
        self.library.XKeysymToKeycode.restype = ctypes.c_ubyte
        self.library.XInternAtom.argtypes = [pointer, ctypes.c_char_p, integer]
        self.library.XInternAtom.restype = unsigned
        self.library.XGetWindowProperty.argtypes = [
            pointer, unsigned, unsigned, ctypes.c_long, ctypes.c_long, integer, unsigned,
            ctypes.POINTER(unsigned), ctypes.POINTER(integer), ctypes.POINTER(unsigned),
            ctypes.POINTER(unsigned), ctypes.POINTER(pointer),
        ]
        self.library.XFree.argtypes = [pointer]
        self.library.XSync.argtypes = [pointer, integer]
        self.library.XCloseDisplay.argtypes = [pointer]
        self.test.XTestQueryExtension.argtypes = [pointer, *([ctypes.POINTER(integer)] * 4)]
        self.test.XTestFakeKeyEvent.argtypes = [pointer, ctypes.c_uint, integer, unsigned]
        self.test.XTestFakeButtonEvent.argtypes = [pointer, ctypes.c_uint, integer, unsigned]
        self.test.XTestFakeMotionEvent.argtypes = [pointer, integer, integer, integer, unsigned]
        self.connection = self.library.XOpenDisplay(None)
        if not self.connection:
            raise ValueError("display unavailable")
        version = [integer() for _ in range(4)]
        if not self.test.XTestQueryExtension(self.connection, *[ctypes.byref(item) for item in version]):
            raise ValueError("input unavailable")
        self.root = self.library.XDefaultRootWindow(self.connection)
        self.screen = self.library.XDefaultScreen(self.connection)
        self.width = self.library.XDisplayWidth(self.connection, self.screen)
        self.height = self.library.XDisplayHeight(self.connection, self.screen)
        self.keys = set()
        self.buttons = set()

    def property(self, window, name):
        atom = self.library.XInternAtom(self.connection, name.encode(), True)
        actual_type, count, remaining = ctypes.c_ulong(), ctypes.c_ulong(), ctypes.c_ulong()
        actual_format, data = ctypes.c_int(), ctypes.c_void_p()
        status = self.library.XGetWindowProperty(
            self.connection, window, atom, 0, 1, False, 0, ctypes.byref(actual_type),
            ctypes.byref(actual_format), ctypes.byref(count), ctypes.byref(remaining), ctypes.byref(data),
        )
        try:
            if status != 0 or actual_format.value != 32 or count.value != 1 or not data.value:
                raise ValueError("window unavailable")
            return ctypes.cast(data, ctypes.POINTER(ctypes.c_ulong))[0]
        finally:
            if data.value:
                self.library.XFree(data)

    def key(self, name, down):
        if not isinstance(name, str) or not re.fullmatch(r"[A-Za-z0-9_]{1,32}", name):
            raise ValueError("invalid key")
        keycode = self.library.XKeysymToKeycode(self.connection, self.library.XStringToKeysym(name.encode()))
        if not keycode:
            raise ValueError("unsupported key")
        if down:
            self.keys.add(keycode)
        self.test.XTestFakeKeyEvent(self.connection, keycode, down, 0)
        if not down:
            self.keys.discard(keycode)

    def button(self, button, down):
        if button not in range(1, 8):
            raise ValueError("invalid button")
        if down:
            self.buttons.add(button)
        self.test.XTestFakeButtonEvent(self.connection, button, down, 0)
        if not down:
            self.buttons.discard(button)

    def command(self, args):
        if not isinstance(args, list) or len(args) > 2048 or not all(isinstance(arg, str) and len(arg) <= 32 for arg in args):
            raise ValueError("invalid command")
        offset = 0
        output = []
        while offset < len(args):
            command = args[offset]
            offset += 1
            if command == "getdisplaygeometry":
                output.append(str(self.width) + " " + str(self.height))
            elif command == "getactivewindow":
                output.append(str(self.property(self.root, "_NET_ACTIVE_WINDOW")))
            elif command == "getwindowpid":
                output.append(str(self.property(int(args[offset]), "_NET_WM_PID")))
                offset += 1
            elif command == "mousemove":
                horizontal, vertical = int(args[offset]), int(args[offset + 1])
                if not 0 <= horizontal < self.width or not 0 <= vertical < self.height:
                    raise ValueError("invalid point")
                self.test.XTestFakeMotionEvent(self.connection, self.screen, horizontal, vertical, 0)
                offset += 2
            elif command in ("keydown", "keyup"):
                self.key(args[offset], command == "keydown")
                offset += 1
            elif command in ("mousedown", "mouseup"):
                self.button(int(args[offset]), command == "mousedown")
                offset += 1
            elif command == "click":
                if args[offset] != "--repeat" or args[offset + 2:offset + 4] != ["--delay", "0"]:
                    raise ValueError("invalid scroll")
                repeat, button = int(args[offset + 1]), int(args[offset + 4])
                if not 1 <= repeat <= 16 or button not in (4, 5, 6, 7):
                    raise ValueError("invalid scroll")
                for _ in range(repeat):
                    self.button(button, True)
                    self.button(button, False)
                offset += 5
            else:
                raise ValueError("unsupported command")
        self.library.XSync(self.connection, False)
        return "\n".join(output)

    def close(self):
        for keycode in self.keys:
            self.test.XTestFakeKeyEvent(self.connection, keycode, False, 0)
        for button in list(self.buttons):
            self.button(button, False)
        self.library.XSync(self.connection, False)
        self.library.XCloseDisplay(self.connection)


def guard():
    match = re.fullmatch(r":([0-9]{1,5})(?:\.[0-9]{1,2})?", os.environ.get("DISPLAY", ""))
    if not match or os.environ.get("WAYLAND_DISPLAY"):
        return
    socket = "/tmp/.X11-unix/X" + str(int(match.group(1)))
    original = identity(socket)
    display = Display()
    buffered = b""
    deadline = time.monotonic() + 5
    try:
        if identity(socket) != original:
            raise ValueError("display changed")
        print("ready", flush=True)
        if "--check" in sys.argv:
            return
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0 or not select.select([sys.stdin], [], [], remaining)[0]:
                break
            chunk = os.read(sys.stdin.fileno(), 4096)
            if not chunk:
                break
            buffered += chunk
            if len(buffered) > 32768:
                break
            while b"\n" in buffered:
                line, buffered = buffered.split(b"\n", 1)
                value = json.loads(line)
                if not isinstance(value, dict):
                    raise ValueError("invalid request")
                if "args" in value:
                    identifier = value["id"]
                    if type(identifier) is not int or not 0 < identifier <= 9007199254740991:
                        raise ValueError("invalid request")
                    output = display.command(value["args"])
                    print(json.dumps({"id": identifier, "stdout": output}), flush=True)
                else:
                    if not isinstance(value.get("keys"), list) or not isinstance(value.get("buttons"), list):
                        raise ValueError("invalid heartbeat")
                    if len(value["keys"]) > 128 or len(value["buttons"]) > 3:
                        raise ValueError("invalid heartbeat")
                deadline = time.monotonic() + 5
    finally:
        display.close()


def stop(_signal, _frame):
    raise SystemExit(0)


if __name__ == "__main__":
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    try:
        guard()
    except Exception:
        sys.exit(1)
