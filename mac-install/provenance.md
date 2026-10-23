# Mac installer evidence

`dmg-window-before.png`, `dmg-window.png` and `move-dialog.png` are copies of the original #8 evidence in `/tmp/rs-evidence/dmg-install-window/`. Its live PR body was fetched on 2026-10-21 at head dcfcbd6c5b1621928867e3d306573c42907e0ea2.

The Finder pair shows the same ad-hoc Electron app, packed with main's plain DMG step and the designed DMG step. The designed-art run was at 99abb6b. The prompt capture was at ecdaba2; its installer prompt text is unchanged. The old body links the evidence commit 7d037cef3c142d7ec7d991d446a24cdf0cdb645e. These are historical captures, not a new packaged build.

The art bytes, rendering commands, icon coordinates, Finder bounds and dialog's initial question remain unchanged. The SVG comment no longer refers to deleted tooling. Reuse therefore shows the retained window. The failure dialog now gives recovery instructions that also work for a translocated app opened from Downloads; that failure dialog has no runtime capture.

Current verification ran with scratch TMPDIR, REELSTUDIO_USER_DATA, REELSTUDIO_ROOT, REELSTUDIO_MODELS_DIR and REELENGINE_CACHE. Main ignored --self-test and produced no JSON before a 12-second deadline. The rebuilt app wrote JSON and exited 1 for the local Python's missing NumPy, with isPackaged=false. This verifies failure reporting, not a successful installed encode.

No full DMG, signed release, real Applications move/replacement or quarantined/translocated launch was run. Those still need release qualification. The old #5 installed export evidence is historical and does not qualify this rebuilt head.

## Inter re-lettering (54ac95f)

`dmg-background-sf-pro.png` is `packaging/dmg/render-background.sh` run on `background.svg` at bf07bb8. `dmg-background-inter.png` is the same script at 54ac95f, after `letter-background.py` rewrote the copy in Inter. Both are the 1280x864 (2x) render; the 1x render goes into the same TIFF. `dmg-lettering-compare-1x.png` and `-2x.png` crop the two lines of copy from each render, old above new, the 1x crop scaled up 3x with nearest-neighbour. Measured from the 2x renders, the headline ink spans x 144.5-495.5 before and 144.0-495.0 after, and the second line 209.0-430.5 in both. These are renders of the background file, not Finder captures of a built disk image.
