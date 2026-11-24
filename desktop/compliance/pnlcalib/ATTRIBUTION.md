# PnLCalib attribution

PnLCalib: Sports Field Registration via Points and Lines Optimization, by Marc Gutiérrez-Pérez and Antonio Agudo. Source: https://github.com/mguti97/PnLCalib/tree/42088864170f75ea02e76d20e9a9a1db59edb3e3. Paper: https://papers.ssrn.com/sol3/papers.cfm?abstract_id=4998149.

The author's code is copyright (C) 2024-2026 Marc Gutiérrez-Pérez, licensed under GPL-2.0-or-later. The complete upstream notice and GPL text are in ../LICENSE. Annotate retains this grant; it does not relicense upstream code. The Microsoft HRNet-derived files model/cls_hrnet.py and model/cls_hrnet_l.py retain their author headers and MIT terms; the full notice is in HRNet-MIT.txt.

The bundled, unmodified SV_kp and SV_lines model weights from PnLCalib release v1.0.0 are licensed under Creative Commons Attribution 4.0 International (CC BY 4.0): https://creativecommons.org/licenses/by/4.0/. The full licence, including its warranty disclaimer, is in CC-BY-4.0.txt. No endorsement of Annotate by the authors is implied.

Weight sources and SHA-256 checksums:

- https://github.com/mguti97/PnLCalib/releases/download/v1.0.0/SV_kp: 7ea78fa76aaf94976a8eca428d6e3c59697a93430cba1a4603e20284b61f5113
- https://github.com/mguti97/PnLCalib/releases/download/v1.0.0/SV_lines: d72f4ed71734a2e3df9fa084f666e9b8adaef21bf69bac8952d6d3f970ff7455

Annotate omits examples/, figures/ and the separate SoccerNet sn_calibration/ evaluation folder from its runtime bundle. Inference source files and weights are otherwise unchanged from the pinned upstream inputs. Training datasets and football footage are not included.

Preferred upstream citation:

```bibtex
@article{gutierrez4998149pnlcalib,
  title={Pnlcalib: Sports Field Registration Via Points and Lines Optimization},
  author={Guti{\'e}rrez-P{\'e}rez, Marc and Agudo, Antonio},
  journal={Available at SSRN 4998149}
}
```

The licence clarification is published at https://github.com/mguti97/PnLCalib/commit/42088864170f75ea02e76d20e9a9a1db59edb3e3 and in that revision's README License section. This attribution does not license user footage or training datasets.
