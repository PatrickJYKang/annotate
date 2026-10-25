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
| Ultralytics and YOLOv8n | Installed AGPL-3.0 licence, pinned package and weight checksum | AGPL obligations require an explicit distribution/source strategy. A public GitHub repository or an Apache-licensed tracker does not by itself settle the obligations of the integrated product. GPLv3 and AGPLv3 have combination provisions; do not describe their coexistence as automatically prohibited or automatically satisfied. |
| Electron / Chromium | Electron licence and Chromium notices in the packaged application | Retain both, including Chromium's third-party notices. |
| Standalone Python and Python packages | Python distribution licence; wheel `.dist-info` metadata and licence files | Inventory generated per target. Preserve these files. Wheel metadata is not a complete compatibility audit of every native library inside a wheel. |
| FFmpeg / x264 | macOS includes source archives, build recipe and GPL text; Windows includes the upstream FFmpeg distribution and licence | The Windows build and all enabled codec dependencies still need a corresponding-source review. Linking to an upstream release is not treated here as proof that the distribution's source obligations are fulfilled. |
| Microsoft VC runtime | Extracted Microsoft redistributable licence material under `licenses/msvc/` | Confirm the distributable-code terms cover the app-local DLL selection and distribution process. Copying the EULA alone does not establish entitlement. |
| IBM Plex Sans | Fontsource package's SIL Open Font License 1.1 | The font licence is now copied explicitly into runtime notices; CSS tracing alone would not retain it reliably. |
| JavaScript renderer packages | Matching installed package licence files and package metadata | Staging collects notices outside Next's executable trace and writes a versioned dependency inventory. Missing metadata is marked for review, not interpreted as permission. |

Upstream football demonstration media and figures are removed from the staged PnLCalib directory because inference does not require them. This does not resolve the separate model-weight or code questions. User-guide and outreach footage are not bundled in the app, and their rights remain separate from the software licences.

## Required decisions before public release

1. Obtain clarification of PnLCalib's code licence version and redistribution terms for `SV_kp` and `SV_lines`; retain the response alongside the pinned provenance.
2. Decide and document the appropriate GPL/AGPL compliance approach for the integrated stack, with qualified advice if needed. Do not silently change the repository licence or assume a process boundary exempts the combination.
3. Complete the corresponding-source package/offer for the exact distributed binaries, including the Windows FFmpeg build and relevant native components. Verify Microsoft runtime redistribution terms.
4. Keep the target-specific inventory, licence texts, source archive, build recipe, version, commit and checksums alongside release artifacts. A successful build or notarization does not close these licence gates.

The current build scripts still produce local evaluation artifacts for the maintainer's testing. They do not upload them. This is not a statement that calling a publicly shared binary a preview exempts it from licence obligations.

## Sources

- [Pinned PnLCalib source, README and licence](https://github.com/mguti97/PnLCalib/tree/8c87391d6f4ea40c5e4d65e61529916c7a49ce62).
- [Ultralytics AGPL-3.0 terms](https://www.ultralytics.com/legal/agpl-3-0-software-license), particularly corresponding source and combination provisions.
- [GNU GPL compatibility guidance](https://www.gnu.org/licenses/license-list.html) and the licences themselves. Version-specific permissions matter.
- The locally staged licence files, package metadata, `sidecar/requirements.lock.txt`, `webapp/package-lock.json`, and `desktop/scripts/bundle-windows-runtime.mjs` identify the actual build inputs.
