# PnLCalib licence enquiry

Patrick confirmed sending the enquiry on 2026-10-25. Awaiting a response; no clarification or additional permission has been received. The retained draft below records the questions raised, not a verified copy of the sent message.

## Contact and evidence

Marc Gutiérrez-Pérez, PnLCalib's first author and GitHub maintainer `mguti97`: **mgutierrez@iri.upc.edu**. This professional contact is published on the [IRI/UPC staff page](https://www.urus.upc.es/staff/mgutierrez), which also lists the PnLCalib paper. The GitHub [profile](https://github.com/mguti97) and [repository](https://github.com/mguti97/PnLCalib) establish the maintainer identity.

Checked the repository licence, README, release v1.0.0, all eight existing issues and their public comments on 2026-10-24. No clarification of licence version or weight redistribution was found. The issue page reports restricted issue creation, so email is the more suitable first contact. This is an unanswered scope question, not an assertion that the author prohibits redistribution.

## Email draft

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
