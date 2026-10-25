# Distribution licence review

Reviewed 2026-10-24 for the local 0.2.3-rc.1 builds. This is an engineering inventory and release-gate assessment, not legal advice. Public distribution is not cleared by this review. No project licence has been changed and no additional permission has been obtained.

## Findings

| Component | Evidence in the assembled runtime | Assessment |
| --- | --- | --- |
| Annotate-owned source | Root `LICENSE`, GPL-3.0-only | Preserve the licence, notices and source matching each binary. This does not relicense bundled dependencies. |
| Roboflow Trackers adaptations | Vendored Apache-2.0 licence and modification headers | Notices retained. Review in conjunction with the copyleft components rather than treating this as the licence of the entire CV stack. |
| OC-SORT adaptations | Vendored MIT licence | Notice retained. |
| PnLCalib code | Pinned commit `8c87391d6f4ea40c5e4d65e61529916c7a49ce62`, upstream GPL version 2 text | No explicit later-version grant was established in the inspected source. Clarify whether GPL-2.0-or-later or another permission is available before concluding compatibility with the GPL-3.0/AGPL-3.0 application. A licence's sample boilerplate is not a grant from the author. |
| PnLCalib `SV_kp` / `SV_lines` weights | Checksum-pinned v1.0.0 downloads; README lists the weights and training datasets | Availability for download is not a separate, explicit weight-redistribution grant. Ask the maintainer to confirm applicable terms for these exact weights. Do not infer a weight licence from a dataset licence or vice versa. |
| Ultralytics and YOLOv8n | Installed AGPL-3.0 licence, pinned package and weight checksum; checksum-verified Ultralytics and THOP source distributions | Source-accompanying-download strategy documented in [distribution compliance](distribution-compliance.md). GPLv3/AGPLv3 combination provisions permit this route without automatically requiring commercial licensing. Matching integrated source and remaining native-library obligations must still be fulfilled before publication. |
| Electron / Chromium | Electron licence and Chromium notices in the packaged application | Retain both, including Chromium's third-party notices. |
| Standalone Python and Python packages | Python distribution licence; wheel `.dist-info` metadata and licence files | Inventory generated per target. Preserve these files. Wheel metadata is not a complete compatibility audit of every native library inside a wheel. |
| FFmpeg / x264 | macOS includes source archives, build recipe and GPL text; the Windows core source revision is now archived with its checksum | Windows linked-library versions, source and build inputs remain unresolved. The core tarball is explicitly incomplete; it does not clear the whole codec bundle. |
| Microsoft VC runtime | Extracted Microsoft redistributable licence material under `licenses/msvc/` | The maintainer has not confirmed a Visual Studio licence. Entitlement remains unresolved, as does checking the applicable REDIST list against the app-local selection. Copying the EULA alone does not establish entitlement. |
| IBM Plex Sans | Fontsource package's SIL Open Font License 1.1 | The font licence is now copied explicitly into runtime notices; CSS tracing alone would not retain it reliably. |
| JavaScript renderer packages | Matching server packages and installed non-dev browser build inputs, including nested vendor notices | Client-only bundled code is now covered by notice collection, not just Next's server trace. Missing notice texts are flagged even when metadata has an SPDX licence name. |
| Native image/video dependencies | Source/notices for 28 native libvips libraries, POSIX patches, Windows MXE recipe, OpenCV source and Windows plugin inputs; actual binaries fingerprinted | Generated/transitive source inputs and replacement/relinking verification remain open. Mac OpenCV's embedded FFmpeg reports GPLv3-or-later despite its wheel's generic LGPL notice; exact Homebrew-linked source still needs collection. See the detailed distribution record. |

Upstream football demonstration media and figures are removed from the staged PnLCalib directory because inference does not require them. This does not resolve the separate model-weight or code questions. User-guide and outreach footage are not bundled in the app, and their rights remain separate from the software licences.

## Required decisions before public release

1. Obtain clarification of PnLCalib's code licence version and redistribution terms for `SV_kp` and `SV_lines`; retain the response alongside the pinned provenance.
2. Execute the documented source-accompanying-download approach for the integrated GPL/AGPL stack, obtaining qualified advice on unresolved scope if needed. No project licence change or process-boundary exemption is assumed.
3. Complete the corresponding-source package for the exact distributed binaries, including the Windows FFmpeg build and relevant native components. Verify Microsoft runtime redistribution entitlement and terms.
4. Keep the target-specific inventory, licence texts, source archive, build recipe, version, commit and checksums alongside release artifacts. A successful build or notarization does not close these licence gates.

The current build scripts still produce local evaluation artifacts for the maintainer's testing. They do not upload them. This is not a statement that calling a publicly shared binary a preview exempts it from licence obligations.

`npm run prepare:compliance -- <target>` produces separate review evidence without overwriting shared installers. Both existing staged targets have been exercised: 92 package records on macOS and 94 on Windows, conservatively including installed browser build inputs. The 2026-10-25 additions restore Next subpackage notices and base libvips notice texts and collect 38 Mac / 45 Windows source inputs. `client-only` remains flagged because authoritative copyright/licence text is missing. Binary hashes confirm that the media/image runtimes were not changed; the Mac decode, detection, calibration and export check passed. See [implementation and remaining gates](distribution-compliance.md) and the [PnLCalib enquiry](pnlcalib-licence-enquiry.md), which Patrick confirmed sending on 2026-10-25. No response or additional permission has been received. These are engineering checks, not legal clearance or native Windows runtime testing.

## Sources

- [Pinned PnLCalib source, README and licence](https://github.com/mguti97/PnLCalib/tree/8c87391d6f4ea40c5e4d65e61529916c7a49ce62).
- [Ultralytics AGPL-3.0 terms](https://www.ultralytics.com/legal/agpl-3-0-software-license), particularly corresponding source and combination provisions.
- [GNU GPL compatibility guidance](https://www.gnu.org/licenses/license-list.html) and the licences themselves. Version-specific permissions matter.
- The locally staged licence files, package metadata, `sidecar/requirements.lock.txt`, `webapp/package-lock.json`, and `desktop/scripts/bundle-windows-runtime.mjs` identify the actual build inputs.
