# PnLCalib licence enquiry

Patrick confirmed sending the enquiry on 2026-10-25 and shared Marc's reply on 2026-10-26. The code-version and weight-redistribution questions are resolved by the published clarification below. The retained draft records the original questions, not a verified copy of the sent message; its old source pin is historical.

## Published clarification

Marc published [commit 42088864170f75ea02e76d20e9a9a1db59edb3e3](https://github.com/mguti97/PnLCalib/commit/42088864170f75ea02e76d20e9a9a1db59edb3e3), whose parent is our previous pin. It adds a GPL-2.0-or-later grant for the code he controls, an explicit CC BY 4.0 licence for all release weights, and restored Microsoft MIT headers on model/cls_hrnet.py and model/cls_hrnet_l.py. The only four changed files are LICENSE, README.md and those two files' comments; no inference implementation changes. The pinned [README License section](https://github.com/mguti97/PnLCalib/blob/42088864170f75ea02e76d20e9a9a1db59edb3e3/README.md#license) is the public evidence for the weight grant. The v1.0.0 release body was still empty when checked, so this record does not rely on an updated release description.

The weights may be redistributed, including commercially, with attribution and the CC BY 4.0 terms retained. The README states that the training agreement has expired and that the weights contain no footage or further restrictions. This is the maintainer's statement about the weights, not permission to redistribute SoccerNet data or third-party match footage.

Annotate keeps the required HRNet inference files with their MIT notice, excludes the unused sn_calibration evaluation folder from desktop bundles, preserves the exact SV_kp/SV_lines checksums and includes the preferred citation. The upstream grant remains GPL-2.0-or-later; Annotate's own GPL-3.0-only licence does not need changing. Other runtime redistribution and corresponding-source work remains tracked in [distribution compliance](distribution-compliance.md). No further PnLCalib permission request is currently needed.

## Contact and evidence

Marc Gutiérrez-Pérez, PnLCalib's first author and GitHub maintainer `mguti97`: **mgutierrez@iri.upc.edu**. This professional contact is published on the [IRI/UPC staff page](https://www.urus.upc.es/staff/mgutierrez), which also lists the PnLCalib paper. The GitHub [profile](https://github.com/mguti97) and [repository](https://github.com/mguti97/PnLCalib) establish the maintainer identity.

The initial 2026-10-24 review covered the repository licence, README, release v1.0.0, all eight then-existing issues and their public comments. It found no clarification of licence version or weight redistribution. Restricted issue creation led to the email enquiry. That was the pre-reply uncertainty, not a current unanswered question or an assertion that the author prohibited redistribution.

## Original enquiry draft

To: mgutierrez@iri.upc.edu

Subject: PnLCalib licence clarification for an open-source football analysis app

Hi Marc,

I'm Patrick, the developer of Annotate, an open-source football video analysis app: https://github.com/PatrickJYKang/annotate. We use PnLCalib for pitch calibration, and it has been very useful. Thank you for making the work available.

We're preparing a desktop release for macOS and Windows and want to make sure we distribute your work correctly. Our current integration imports PnLCalib into a Python sidecar and bundles its source and the `SV_kp` and `SV_lines` weights for local inference. We use commit `8c87391d6f4ea40c5e4d65e61529916c7a49ce62` and the weights from release `v1.0.0`.

Could you clarify two points?

1. Is the code licensed under GPL version 2 only, or GPL version 2 or any later version? I found the GPLv2 licence file but not an explicit version-selection notice. Annotate's own code is GPLv3, and the tracker also uses AGPLv3 components. If the intended licence is GPLv2-only, would you be able to authorize GPLv3-compatible use of the code you control, or point us to whoever can clarify this?
2. Which licence covers `SV_kp` and `SV_lines`? Does it allow us to redistribute the unmodified weights inside the app's downloadable installers for general football analysis, including use by coaches and clubs? If the repository licence covers the weights too, a confirmation of that would be helpful. Please also let us know of any separate restrictions or notices that apply.

We will retain your licence and attribution, identify our integration changes, and provide matching source and build instructions. We are not asking to make your code proprietary. A clarification in the repository or release notes would help other users too, if convenient.

Thanks for your time,
Patrick Kang
