#!/usr/bin/env python3
"""Repackage a validated image locally without retaining overwritten layers.

No containers are started, no user directories mounted, and nothing is pushed.
The source must already be present locally under an immutable registry digest.
"""

import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import subprocess
import tarfile


# Docker creates these files for each container; they are not image payloads.
INJECTED = {"etc/hostname", "etc/hosts", "etc/resolv.conf", ".dockerenv"}
SUPPORTED_CONFIG = {
    "User", "Env", "Entrypoint", "Cmd", "Labels", "ArgsEscaped", "WorkingDir",
    "StopSignal",
}


def docker(*args):
    return subprocess.check_output(["docker", *args], text=True).strip()


def inspect(image):
    return json.loads(docker("image", "inspect", image))[0]


def save(path, value):
    with path.open("x") as handle:
        json.dump(value, handle, indent=2, sort_keys=True)
        handle.write("\n")


def literal(value):
    # Fail closed rather than silently expanding Dockerfile variables/newlines.
    if not isinstance(value, str) or any(c in value for c in "$\r\n\x00"):
        raise ValueError("Unsupported Dockerfile metadata value")
    return json.dumps(value, ensure_ascii=True)


def metadata(config):
    unsupported = set(config) - SUPPORTED_CONFIG
    if unsupported:
        raise ValueError(f"Review unsupported image config: {sorted(unsupported)}")
    lines = []
    for env in config.get("Env", []):
        key, value = env.split("=", 1)
        if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", key):
            raise ValueError("Unsupported environment key")
        lines.append(f"ENV {key}={literal(value)}")
    for key, value in sorted(config.get("Labels", {}).items()):
        lines.append(f"LABEL {literal(key)}={literal(value)}")
    for key, instruction in [("User", "USER"), ("StopSignal", "STOPSIGNAL")]:
        if config.get(key):
            if not re.fullmatch(r"[A-Za-z0-9_:.-]+", config[key]):
                raise ValueError(f"Unsupported {key}")
            lines.append(f"{instruction} {config[key]}")
    if config.get("WorkingDir") not in (None, "", "/"):
        raise ValueError("Only the runtime's root working directory is supported")
    for key in ("Entrypoint", "Cmd"):
        values = config.get(key)
        if not isinstance(values, list) or not values:
            raise ValueError(f"Missing exec-form {key}")
        for value in values:
            literal(value)
        lines.append(f"{key.upper()} {json.dumps(values)}")
    return "\n".join(lines)


def recipe(source, config):
    if not re.fullmatch(r"[A-Za-z0-9._:/-]+@sha256:[a-f0-9]{64}", source):
        raise ValueError("An immutable registry digest is required")
    return f"""# Requires BuildKit Dockerfile frontend >= 1.19 (COPY --exclude).
# The validated stage is an input only: its old layers never enter the output.
FROM {source} AS validated
FROM scratch AS runtime-base
COPY --from=validated --exclude=opt/cindy / /
FROM runtime-base AS runtime
COPY --from=validated /opt/cindy /opt/cindy
{metadata(config)}
"""


def normalized_config(config):
    result = dict(config)
    # An omitted working directory and explicit / have the same Docker meaning.
    result["WorkingDir"] = result.get("WorkingDir") or "/"
    return result


def is_app(path):
    return path == "opt/cindy" or path.startswith("opt/cindy/")


def filesystem(image):
    """Hash an unstarted disposable container; preserve links, modes and xattrs."""
    container = docker("create", "--network", "none", "--entrypoint", "/bin/true", image)
    rows, hardlinks = {}, {}
    try:
        proc = subprocess.Popen(["docker", "export", container], stdout=subprocess.PIPE)
        try:
            with tarfile.open(fileobj=proc.stdout, mode="r|*") as archive:
                for member in archive:
                    path = str(PurePosixPath(member.name))
                    if path.startswith("/") or ".." in PurePosixPath(path).parts:
                        raise ValueError("Unsafe export path")
                    if path in INJECTED:
                        continue
                    if path in rows:
                        raise ValueError(f"Duplicate export path: {path}")
                    row = {
                        "type": member.type.decode("ascii"), "mode": member.mode,
                        "uid": member.uid, "gid": member.gid,
                        "xattrs": {k: v for k, v in member.pax_headers.items()
                                   if "xattr" in k or "acl" in k},
                    }
                    if member.isfile():
                        sha = hashlib.sha256()
                        with archive.extractfile(member) as handle:
                            while chunk := handle.read(1024 * 1024):
                                sha.update(chunk)
                        row.update(size=member.size, sha256=sha.hexdigest())
                    elif member.islnk():
                        hardlinks[path] = str(PurePosixPath(member.linkname))
                    elif member.issym():
                        row["target"] = member.linkname
                    elif member.isdev():
                        row.update(major=member.devmajor, minor=member.devminor)
                    rows[path] = row
            if proc.wait() != 0:
                raise RuntimeError("Docker export failed")
        finally:
            proc.stdout.close()
            if proc.poll() is None:
                proc.terminate()
                proc.wait()
        # Tar may choose a different first name for the same hardlink group.
        # Compare group membership and contents, not arbitrary archive ordering.
        groups = {}
        for path, target in hardlinks.items():
            seen = {path}
            while target in hardlinks:
                if target in seen:
                    raise ValueError("Cyclic hardlink")
                seen.add(target)
                target = hardlinks[target]
            data = rows[target]
            if data["type"] != "0":
                raise ValueError("Hardlink target must be a regular file")
            rows[path].update(type="0", size=data["size"], sha256=data["sha256"])
            groups.setdefault(target, {target}).add(path)
        for group in groups.values():
            for path in group:
                rows[path]["hardlinks"] = sorted(group)
        return rows
    finally:
        subprocess.run(["docker", "rm", container], check=True, stdout=subprocess.DEVNULL)


def differences(expected, actual):
    return [path for path in sorted(expected.keys() | actual.keys())
            if expected.get(path) != actual.get(path)]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True)
    parser.add_argument("--tag", required=True)
    parser.add_argument("--base-tag", required=True)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    os.umask(0o077)
    source = inspect(args.source)
    if source["Os"] != "linux" or source["Architecture"] not in ("amd64", "arm64"):
        raise ValueError("Unsupported runtime platform")
    if args.tag == args.base_tag:
        raise ValueError("Use separate application and dependency-base tags")
    for tag in (args.tag, args.base_tag):
        if tag.startswith("-") or subprocess.run(
            ["docker", "image", "inspect", tag], stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        ).returncode == 0:
            raise ValueError("Use new, unoccupied output tags")
    dockerfile = recipe(args.source, source["Config"])
    args.output.mkdir(mode=0o700, parents=True, exist_ok=False)
    context = args.output / "context"
    context.mkdir(mode=0o700)
    (context / "Dockerfile").write_text(dockerfile)
    (context / ".dockerignore").write_text("*\n!Dockerfile\n")
    save(args.output / "source-image.json", source)
    for target, tag in [("runtime-base", args.base_tag), ("runtime", args.tag)]:
        with (args.output / f"build-{target}.log").open("x") as log:
            subprocess.run([
                "docker", "build", "--platform", "linux/" + source["Architecture"],
                "--network", "none", "--target", target, "--tag", tag,
                "--progress", "plain", str(context),
            ], stdout=log, stderr=subprocess.STDOUT, check=True)
    candidate, base = inspect(args.tag), inspect(args.base_tag)
    save(args.output / "candidate-image.json", candidate)
    save(args.output / "base-image.json", base)
    source_fs, candidate_fs, base_fs = (filesystem(i["Id"]) for i in (source, candidate, base))
    for name, value in [("source", source_fs), ("candidate", candidate_fs), ("base", base_fs)]:
        save(args.output / f"{name}-filesystem.json", value)
    diff = differences(source_fs, candidate_fs)
    base_diff = differences({p: v for p, v in source_fs.items() if not is_app(p)}, base_fs)
    config_equal = normalized_config(source["Config"]) == normalized_config(candidate["Config"])
    result = {
        "sourceId": source["Id"], "imageId": candidate["Id"], "baseId": base["Id"],
        "sourceBytes": source["Size"], "imageBytes": candidate["Size"],
        "sourceLayers": len(source["RootFS"]["Layers"]),
        "imageLayers": len(candidate["RootFS"]["Layers"]),
        "baseLayers": len(base["RootFS"]["Layers"]),
        "filesystemEntries": len(source_fs), "changedPaths": diff,
        "baseChangedPaths": base_diff, "configEqual": config_equal,
        "platformEqual": all(source[k] == candidate[k] == base[k] for k in ("Os", "Architecture")),
        "published": False, "runtimeExecuted": False,
    }
    result["passed"] = (
        not diff and not base_diff and config_equal and result["platformEqual"]
        and result["imageLayers"] == 2 and result["baseLayers"] == 1
        and not any(is_app(p) for p in base_fs)
        and candidate["RootFS"]["Layers"][0] == base["RootFS"]["Layers"][0]
        and source["Size"] >= candidate["Size"]
    )
    save(args.output / "verification.json", result)
    print(json.dumps(result, indent=2))
    if not result["passed"]:
        raise SystemExit("Image equivalence failed; do not publish this output")


if __name__ == "__main__":
    main()
