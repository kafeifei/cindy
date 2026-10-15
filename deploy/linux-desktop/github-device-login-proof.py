"""No-network Linux integration proof, synthetic tokens in a private memory keyring."""
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time

import dbus
import yaml

spec = importlib.util.spec_from_file_location("github_login", "/usr/local/lib/cindy/github-device-login.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
os.umask(0o077)
root = Path(tempfile.mkdtemp(prefix="github-login-proof-", dir="/dev/shm"))
env = {**os.environ, "HOME": str(root), "XDG_RUNTIME_DIR": str(root),
       "DBUS_SESSION_BUS_ADDRESS": "unix:path=" + str(root / "bus"), "GH_CONFIG_DIR": str(root / "target")}
children = []
passed = []
try:
    fresh = root / "fresh-home"
    fresh.mkdir(mode=0o700)
    config = module.ensure_config_parent(fresh)
    assert config == fresh / ".config" and (config.stat().st_mode & 0o777) == 0o700
    marker = config / "unrelated-settings"
    marker.write_bytes(b"preserved")
    before = config.stat().st_ino
    assert module.ensure_config_parent(fresh).stat().st_ino == before and marker.read_bytes() == b"preserved"
    passed.append("fresh-home-private-config-created-and-existing-settings-preserved")
    outside = root / "outside-config"
    outside.mkdir(mode=0o700)
    unsafe = root / "symlink-home"
    unsafe.mkdir(mode=0o700)
    (unsafe / ".config").symlink_to(outside)
    try:
        module.ensure_config_parent(unsafe)
        raise AssertionError("config symlink accepted")
    except OSError: pass
    assert not list(outside.iterdir())
    home_link = root / "home-link"
    home_link.symlink_to(fresh)
    try:
        module.ensure_config_parent(home_link)
        raise AssertionError("home symlink accepted")
    except OSError: pass
    passed.append("home-and-config-symlinks-rejected-without-touching-target")
    unsafe_config = root / "shared-home"
    unsafe_config.mkdir(mode=0o700)
    (unsafe_config / ".config").mkdir(mode=0o700)
    (unsafe_config / ".config").chmod(0o777)
    try:
        module.ensure_config_parent(unsafe_config)
        raise AssertionError("writable shared config accepted")
    except ValueError: pass
    passed.append("shared-writable-config-rejected")
    try:
        module.ensure_config_parent(Path("/opt/cindy"))
        raise AssertionError("another owner's HOME accepted")
    except ValueError: pass
    passed.append("another-owner-home-rejected")
    bus = subprocess.Popen(["/usr/bin/dbus-daemon", "--session", "--nofork", "--address=" + env["DBUS_SESSION_BUS_ADDRESS"]], env=env,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    children.append(bus)
    for _ in range(50):
        if (root / "bus").is_socket(): break
        time.sleep(0.1)
    daemon = subprocess.Popen(["/usr/bin/gnome-keyring-daemon", "--foreground", "--unlock", "--components=secrets",
                               "--control-directory=" + str(root / "control")], env=env, stdin=subprocess.PIPE,
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    children.append(daemon)
    daemon.stdin.write(os.urandom(32).hex().encode() + b"\n"); daemon.stdin.close()
    keyring = None
    for _ in range(50):
        try:
            keyring = module.Keyring(env["DBUS_SESSION_BUS_ADDRESS"], dbus); break
        except Exception: time.sleep(0.1)
    assert keyring
    old, new = b"gho_SYNTHETIC_OLD_NOT_REAL", b"gho_SYNTHETIC_NEW_NOT_REAL"
    keyring.set("", old); keyring.set("fixture-user", old)
    target = root / "target"; target.mkdir(mode=0o700)
    original = b'github.com:\n    user: fixture-user\n    git_protocol: ssh\n    users:\n        fixture-user: {}\n        other-user: {}\n'
    (target / "hosts.yml").write_bytes(original)
    baseline = module.metadata(target)
    module.commit(target, baseline, keyring, "fixture-user", new, old, yaml)
    got = subprocess.run([module.GH, "auth", "token", "--hostname", "github.com"], env=env, capture_output=True, timeout=5)
    assert got.returncode == 0 and got.stdout.strip() == new
    assert keyring.get("fixture-user") == new
    metadata = module.metadata(target)
    assert b"other-user" in metadata["hosts.yml"] and b"ssh" in metadata["hosts.yml"]
    passed.append("real-keyring-commit-and-official-gh-read-no-network")
    try:
        module.commit(target, baseline, keyring, "fixture-user", old, new, yaml)
        raise AssertionError("CAS unexpectedly passed")
    except ValueError: pass
    assert keyring.get("") == new
    passed.append("metadata-cas-preserves-current-connection")
    baseline = module.metadata(target)
    setter = keyring.set
    def fail_after_write(user, token):
        setter(user, token)
        if user == "" and token == old: raise RuntimeError("synthetic commit failure")
    keyring.set = fail_after_write
    try:
        module.commit(target, baseline, keyring, "fixture-user", old, new, yaml)
        raise AssertionError("injected failure unexpectedly passed")
    except RuntimeError: pass
    keyring.set = setter
    assert keyring.get("") == new and keyring.get("fixture-user") == new and module.metadata(target) == baseline
    passed.append("write-failure-restores-both-keyring-entries-and-metadata")
    writer = module.atomic_write
    first = True
    def fail_after_rename(directory, name, value):
        global first
        writer(directory, name, value)
        if first:
            first = False
            raise OSError("synthetic directory fsync failure")
    module.atomic_write = fail_after_rename
    try:
        module.commit(target, baseline, keyring, "fixture-user", old, new, yaml)
        raise AssertionError("injected filesystem failure unexpectedly passed")
    except OSError: pass
    module.atomic_write = writer
    assert keyring.get("") == new and keyring.get("fixture-user") == new and module.metadata(target) == baseline
    passed.append("post-rename-failure-restores-metadata-and-keyring")
    (target / "hosts.yml").write_bytes(b'github.com:\n    oauth_token: synthetic\n')
    try:
        module.metadata(target); raise AssertionError("plaintext accepted")
    except ValueError: pass
    (target / "hosts.yml").unlink()
    (target / "hosts.yml").symlink_to(root / "outside")
    try:
        module.metadata(target); raise AssertionError("symlink accepted")
    except ValueError: pass
    passed.append("plaintext-and-symlink-rejected")
    fresh_target = config / "gh"
    assert module.metadata(fresh_target, missing=True) == {}
    fresh_token = b"gho_SYNTHETIC_FRESH_NOT_REAL"
    module.commit(fresh_target, {}, keyring, "fresh-user", fresh_token, new, yaml)
    fresh_env = {**env, "GH_CONFIG_DIR": str(fresh_target)}
    got = subprocess.run([module.GH, "auth", "token", "--hostname", "github.com"], env=fresh_env, capture_output=True, timeout=5)
    assert got.returncode == 0 and got.stdout.strip() == fresh_token
    assert keyring.get("fresh-user") == fresh_token and marker.read_bytes() == b"preserved"
    assert b"oauth_token" not in module.metadata(fresh_target)["hosts.yml"]
    passed.append("first-login-creates-gh-metadata-and-commits-only-to-keyring")
    print(json.dumps({"passed": passed, "network": False, "realCredentials": False}))
finally:
    for p in reversed(children):
        p.terminate()
        try: p.wait(timeout=3)
        except subprocess.TimeoutExpired: p.kill(); p.wait()
    shutil.rmtree(root)
