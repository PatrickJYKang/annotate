# Third-Party Software Notices

Annotate-owned source is licensed under GPL-3.0-only as described in LICENSE. It also incorporates or installs the following third-party software under their respective terms. These notices do not replace the license files distributed by each dependency or establish compatibility of the combined distribution. The [licence review](docs/licence-review.md) identifies unresolved public-distribution gates.

## Roboflow Trackers

The adapted tracking and calibration primitives under sidecar/annotate_sidecar/vendor/trackers/ originate from [Roboflow Trackers](https://github.com/roboflow/trackers), copyright Roboflow, and are distributed under the Apache License 2.0. The complete license is kept at sidecar/annotate_sidecar/vendor/trackers/LICENSE. Adapted source files carry an explicit modification notice in their headers.

## OC-SORT

Parts of the vendored tracking implementation are adapted from [OC-SORT](https://github.com/noahcao/OC_SORT), copyright 2021 Yifu Zhang, under the MIT License. The complete license is kept at sidecar/annotate_sidecar/vendor/trackers/LICENSE.ocsort.

## PnLCalib

Annotate pins [PnLCalib](https://github.com/mguti97/PnLCalib) at commit 42088864170f75ea02e76d20e9a9a1db59edb3e3. The author's code is copyright (C) 2024-2026 Marc Gutiérrez-Pérez, under GPL-2.0-or-later. The required Microsoft HRNet-derived model/cls_hrnet.py and model/cls_hrnet_l.py retain their MIT terms and restored author headers. Source development provisions PnLCalib under `sidecar/third_party/pnlcalib/` unless overridden. Desktop staging bundles source, upstream LICENSE and weights under `runtime/pnlcalib/`, with full licences and attribution also collected under `runtime/licenses/pnlcalib/`. These downloaded artifacts are not committed to this Git repository.

The unmodified SV_kp and SV_lines weights from release v1.0.0 are licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), as expressly stated in the pinned upstream README. Attribution: Marc Gutiérrez-Pérez and Antonio Agudo, *PnLCalib: Sports Field Registration via Points and Lines Optimization*, [paper](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=4998149). The preferred upstream citation, weight download links/checksums, full CC BY text and Microsoft MIT notice are retained in [PnLCalib attribution](desktop/compliance/pnlcalib/ATTRIBUTION.md) and its accompanying files. No author endorsement is implied. Example footage, figures and the separate SoccerNet sn_calibration evaluation folder are omitted from new desktop staging; the HRNet inference files remain. The [maintainer clarification](docs/pnlcalib-licence-enquiry.md) resolves the former code-version and weight-permission questions, not the rights to user footage or training datasets. Existing installers have not been rebuilt with these changes.

## IBM Plex Sans

IBM Plex Sans is distributed under the SIL Open Font License 1.1, copyright IBM Corp. The font package's full licence is copied into `runtime/licenses/IBM-Plex-Sans-OFL.txt` during staging.

## Desktop Runtime

Desktop packages also include Electron, standalone Python, ffmpeg/ffprobe, platform-specific native libraries, and their accompanying license material. macOS media-tool source archives and the build recipe accompany the runtime. The matching Annotate source archive is attached to the desktop release; dependency locks and `desktop/scripts/` describe how the package is assembled. These notes are an inventory, not a substitute for the individual licenses or completion of the outstanding distribution-license review.

## Installed Runtime Dependencies

New Mac staging builds OpenCV 4.11.0 with FFmpeg 7.1 and the pinned x264 source instead of shipping the OpenCV wheel's native Homebrew libraries. The combined module is distributed under GPLv3 with its Apache-2.0, GPL-2.0-or-later and third-party notices retained. Its source inputs, build commands and fingerprints are documented in `runtime/licenses/opencv-controlled/`; the OpenCV/FFmpeg source archives and bundled third-party sources accompany the release source bundle, and x264 source is retained under `runtime/ffmpeg/licenses/`. Only Apple system libraries are dynamically linked. Original wheel metadata is preserved for package resolution and is not the licence of the replacement binary. See [controlled build details](docs/distribution-compliance.md#controlled-mac-opencv).

The locked JavaScript and Python environments contain additional third-party packages. Notable runtime licenses include Ultralytics under AGPL-3.0, PyTorch under BSD-3-Clause, and Supervision under MIT. Desktop staging supplements Next's trace with notices from installed browser build inputs, nested vendored JavaScript, and Python wheels, including files outside `.dist-info`. It writes `runtime/licenses/dependency-inventory.json`; missing texts remain flagged. The full Annotate GPL text and Ultralytics AGPL text are included explicitly.

Checksum-verified source distributions for Ultralytics and Ultralytics THOP are collected under `runtime/licenses/sources/`. Exact-version Next notices are restored during packaging. New renderers disable the unused Next image optimizer and omit sharp/libvips and its WASM fallback. New builds replace the registry `client-only@0.0.1` package with independently authored `webapp/vendor/client-only` code under Annotate's GPL-3.0-only licence; the original package is not relicensed. Native source companions retain the inputs appropriate to the actual binaries, including the Windows OpenCV FFmpeg plugin, GEOS 3.13.1 and Shapely's wheel recipes. Old binary stacks keep their historical source obligations. See the [distribution record](docs/distribution-compliance.md) for candidate status and remaining release verification.

Microsoft Visual C++ runtime DLLs retain Microsoft's terms, not Annotate's GPL licence. The Windows packaging review records the maintainer's Visual Studio Community confirmation and verifies all 13 copied runtime DLLs against their upstream packages, including Shapely's renamed copy. The installer displays the runtime terms scoped only to those Microsoft components. See `desktop/compliance/msvc-runtime.json` for exact provenance and the [confirmation record](docs/distribution-compliance.md#microsoft-runtime-confirmation). Other distributors must establish their own applicable rights.

The isolated source-built Windows FFmpeg candidate includes FFmpeg 8.1.1, x264, dav1d and zlib-ng, with GPLv3 distribution terms for the combined tools and the upstream component notices retained. Its sources, build recipe and compiler/runtime notices are collected together; it is not substituted into existing installers without Windows workflow validation.

The previously shipped macOS OpenCV 4.11.0.86 wheel bundles FFmpeg 7.1/Homebrew 7.1_3 with GPL enabled; libavutil identifies its licence as GPL version 3 or later. This is separate from Annotate's standalone FFmpeg 8.1.1/x264 executables. The wheel's generic LGPL notice is retained as upstream material but does not override the actual embedded FFmpeg build's GPL terms. The full GPLv3 text is included with Annotate; exact source for all of this wheel's linked libraries remains under review.

The source companion now includes original recipes and base sources for 47 matched Homebrew builds, covering 62 of the wheel's 65 dylibs, plus the identified external patches, JPEG XL's sjpeg resource and all 227 registry crate sources pinned by rav1e's archived Cargo.lock. Homebrew's BSD-2-Clause attribution accompanies the unmodified recipes. Native source notices are also copied under `licenses/python/bundled-notices/opencv-sources/`; exact GVDB source and notices supplement the image-library collection. The old wheel's unmatched binaries are GMP, x264 and ZeroMQ. New Mac staging replaces that entire wheel-native dependency chain with the controlled source build described above; historical binaries are not retroactively cleared. Isolated Mac and Windows candidates carry the new renderer and PnLCalib notices, but existing public installers are unchanged.
