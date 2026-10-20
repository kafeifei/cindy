# Cloud runtime emoji font

The historical Debian 12 runtime base included CJK and DejaVu fonts but no color emoji font.
Some emoji therefore render as missing-glyph boxes; a fallback family match alone
does not prove glyph coverage. Bundle Noto Color Emoji in the cloud image.

Use Debian bookworm's `fonts-noto-color-emoji` version `2.042-0+deb12u1`, obtained
through the signed Debian package index. The package SHA-256 is
`a5ab0f69c7938423862320d9aca5dd187b3fd879d6a9a57dd52e17c3fa8d2751`.
Extract it outside the repository, then run:

```sh
python3 stage-emoji-font.py /path/to/extracted-package /path/to/image-layer
```

The helper verifies the exact font and license, stages both with explicit modes,
and prints entries to merge into the image's existing content/permission audit.
Include the verified font/license inputs in the complete source-built dependency
base or final Dockerfile stage. Do not append font patches to old runtime images
or treat an exported historical filesystem as a reproducible dependency base.
This adds about 10.5 MiB uncompressed. Do not install into instance data volumes.

Debian's existing `60-generic.conf` already maps `emoji` to Noto Color Emoji;
no client CSS, language settings, or extra global font override is needed.
On a fresh read-only-root runtime as UID 10001, verify `fc-match emoji`, codepoint
coverage, and actual Electron rendering with representative emoji: basic faces,
rocket, robot, skin tone, ZWJ profession/family, flags, variation selectors and CJK
text. Confirm the license is readable and image directory modes remain 0755.
Fontconfig matching alone is not the rendering acceptance gate.

Only promote a new digest after Linux startup and rendering checks. Keep the
previous qualified digest for rollback and apply the user's current instance scope.

Packaging regression checks (no external downloads required):

```sh
python3 deploy/linux-desktop/runtime-fonts/test_stage_emoji_font.py
```

Some existing monochrome glyphs may keep their original fallback style. Check
that combined emoji form one glyph; do not equate every monochrome glyph with a
missing character (for example, the current Noto family design is a silhouette).
