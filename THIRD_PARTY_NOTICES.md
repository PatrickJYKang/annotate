# Third-Party Software Notices

Annotate-owned source is licensed under GPL-3.0-only as described in LICENSE. It also incorporates or installs the following third-party software under their respective terms. These notices do not replace the license files distributed by each dependency or establish compatibility of the combined distribution. The [2026-10-24 licence review](docs/licence-review.md) identifies unresolved public-distribution gates.

## Roboflow Trackers

The adapted tracking and calibration primitives under sidecar/annotate_sidecar/vendor/trackers/ originate from [Roboflow Trackers](https://github.com/roboflow/trackers), copyright Roboflow, and are distributed under the Apache License 2.0. The complete license is kept at sidecar/annotate_sidecar/vendor/trackers/LICENSE. Adapted source files carry an explicit modification notice in their headers.

## OC-SORT

Parts of the vendored tracking implementation are adapted from [OC-SORT](https://github.com/noahcao/OC_SORT), copyright 2021 Yifu Zhang, under the MIT License. The complete license is kept at sidecar/annotate_sidecar/vendor/trackers/LICENSE.ocsort.

## PnLCalib

Annotate uses [PnLCalib](https://github.com/mguti97/PnLCalib) at commit 8c87391d6f4ea40c5e4d65e61529916c7a49ce62 and its v1.0.0 model weights. PnLCalib is distributed under GNU GPL version 2. Source development provisions it under `sidecar/third_party/pnlcalib/` unless overridden. Desktop staging bundles its source, upstream LICENSE, and weights under `runtime/pnlcalib/` inside the application resources. These downloaded artifacts are not committed to this Git repository.

An explicit later-GPL-version grant and confirmed terms for redistributing the two bundled weights have not been established by this review. Clarification is required before public distribution; a separate weight licence would not be necessary if the rights holder confirms the repository licence covers them. Upstream example footage and figures are omitted from new test packages because inference does not need them. Patrick confirmed sending the [licence enquiry](docs/pnlcalib-licence-enquiry.md) on 2026-10-25; a response is pending.

## IBM Plex Sans

IBM Plex Sans is distributed under the SIL Open Font License 1.1, copyright IBM Corp. The font package's full licence is copied into `runtime/licenses/IBM-Plex-Sans-OFL.txt` during staging.

## Desktop Runtime

Desktop packages also include Electron, standalone Python, ffmpeg/ffprobe, platform-specific native libraries, and their accompanying license material. macOS media-tool source archives and the build recipe accompany the runtime. The matching Annotate source archive is attached to the desktop release; dependency locks and `desktop/scripts/` describe how the package is assembled. These notes are an inventory, not a substitute for the individual licenses or completion of the outstanding distribution-license review.

## Installed Runtime Dependencies

The locked JavaScript and Python environments contain additional third-party packages. Notable runtime licenses include Ultralytics under AGPL-3.0, PyTorch under BSD-3-Clause, and Supervision under MIT. Desktop staging supplements Next's trace with notices from installed browser build inputs, nested vendored JavaScript, and Python wheels, including files outside `.dist-info`. It writes `runtime/licenses/dependency-inventory.json`; missing texts remain flagged. The full Annotate GPL text and Ultralytics AGPL text are included explicitly.

Checksum-verified source distributions for Ultralytics and Ultralytics THOP are collected under `runtime/licenses/sources/`. Exact-version Next notices and base libvips licence texts are restored during packaging. Native source inputs for libvips, OpenCV and FFmpeg are collected in a separate compliance companion bundle, not added to the installer; its index states the remaining coverage gaps. This includes sources for all 28 libraries listed by the native libvips package and the Windows OpenCV FFmpeg plugin inputs, but is not yet complete transitive corresponding source. The [distribution compliance record](docs/distribution-compliance.md) describes the evidence and remaining gates. PnLCalib permissions, complete native corresponding source, the missing `client-only` copyright/licence text and Microsoft redistribution entitlement still require resolution before publishing.

The inspected macOS OpenCV 4.11.0.86 wheel bundles FFmpeg 7.1/Homebrew 7.1_3 with GPL enabled; libavutil identifies its licence as GPL version 3 or later. This is separate from Annotate's standalone FFmpeg 8.1.1/x264 executables. The wheel's generic LGPL notice is retained as upstream material but does not override the actual embedded FFmpeg build's GPL terms. The full GPLv3 text is included with Annotate; exact source for all of this wheel's linked libraries remains under review.
