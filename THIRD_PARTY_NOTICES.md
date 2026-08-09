# Third-Party Software Notices

Annotate is licensed under GPL-3.0-only as described in LICENSE. It also incorporates or installs the following third-party software. These notices do not replace the license files distributed by each dependency.

## Roboflow Trackers

The adapted tracking and calibration primitives under sidecar/annotate_sidecar/vendor/trackers/ originate from [Roboflow Trackers](https://github.com/roboflow/trackers), copyright Roboflow, and are distributed under the Apache License 2.0. The complete license is kept at sidecar/annotate_sidecar/vendor/trackers/LICENSE. Adapted source files carry an explicit modification notice in their headers.

## OC-SORT

Parts of the vendored tracking implementation are adapted from [OC-SORT](https://github.com/noahcao/OC_SORT), copyright 2021 Yifu Zhang, under the MIT License. The complete license is kept at sidecar/annotate_sidecar/vendor/trackers/LICENSE.ocsort.

## PnLCalib

Annotate's installer obtains [PnLCalib](https://github.com/mguti97/PnLCalib) at commit 8c87391d6f4ea40c5e4d65e61529916c7a49ce62 and its v1.0.0 model weights. PnLCalib is distributed under GNU GPL version 2. Its upstream LICENSE remains inside sidecar/third_party/pnlcalib/ in every installed copy. The source and weights are downloaded rather than copied into this Git repository so their large artifacts do not inflate Annotate's history.

## Installed Runtime Dependencies

The locked JavaScript and Python environments contain additional third-party packages. Their package archives include their own metadata and license files. Notable runtime licenses include Ultralytics under AGPL-3.0, TensorFlow under Apache-2.0, PyTorch under BSD-3-Clause, and Supervision under MIT.
