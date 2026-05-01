# Journal, May 1, 2026

As I have discontinued my session logs for there being too much of a backlog and maintenance load, here be an overview of what was accomplished between now and the previous reporting point.

As a reminder, the actual documentation for the project is at [README.md](../README.md). For a lower level overview see [`technical_document.md`](../technical_document.md). Documentation for the sidecar specifically is at [sidecar/README.md](../sidecar/README.md). [/plans/](../plans/) contains planning documents for various deliverables; these are not up to date references.

## Accomplishments

Since last logged item, which was planning for implementing the clip system. In roughly chronological order:

 - Implemented clips ([commit 7c6f549](https://github.com/PatrickJYKang/annotate/commit/7c6f5493410bc91fc1c3a5974041e5bdd8cf731d))
 - Fixed homography issues ([commit a56975a](https://github.com/PatrickJYKang/annotate/commit/a56975aa2c88b21d0d947c7326de71efa875134c))
 - Added presentation feature ([commit 58b160f](https://github.com/PatrickJYKang/annotate/commit/58b160f0a23112f36f42c26908bb347a5cde1737))
 - Wholesale changes to video loading ([commit b886599](https://github.com/PatrickJYKang/annotate/commit/b8865997307ad4f213696a8b234a1c424c28db12), [commit f1ef0e8](https://github.com/PatrickJYKang/annotate/commit/f1ef0e8c4a6ae1413c83770ac2d766da648f9397), [commit 060fb45](https://github.com/PatrickJYKang/annotate/commit/060fb450c42345fc88789c9105ee5dd741163f15), [commit 25fd2e0](https://github.com/PatrickJYKang/annotate/commit/25fd2e00765398dffe2ec3e170dff1ac78e23e4f), [commit 7110d84](https://github.com/PatrickJYKang/annotate/commit/7110d840a43af763fa116260469c467b12c94485), [commit 2ed3ef8](https://github.com/PatrickJYKang/annotate/commit/2ed3ef8dc59824df596d4372a4473072c750e975))
 - Bug fixes and improvements to annotation editor ([commit 5f56178](https://github.com/PatrickJYKang/annotate/commit/5f56178c8e07992f0b49eb7ea1079fe5991c39d3), [commit fb7c122](https://github.com/PatrickJYKang/annotate/commit/fb7c1222dce982adc760b470cc21807431d0c8db))
 - Various QoL fixes to clip editor ([commit e1cab25](https://github.com/PatrickJYKang/annotate/commit/e1cab25bcbf04ed8a6c234cbd7c5f34827044a6a), [commit 75515d1](https://github.com/PatrickJYKang/annotate/commit/75515d169d18cc04b5afd03cf8b86253526ac4bb), [commit eab04e0](https://github.com/PatrickJYKang/annotate/commit/eab04e0e3e982d1c4ce5e713396a61078dd7758e))
 - Migrate CV stack to `roboflow/trackers` ([commit aeca8f4](https://github.com/PatrickJYKang/annotate/commit/aeca8f469d0384da68fe47e73ffa0af672d91a7c), [commit 3ba23b1](https://github.com/PatrickJYKang/annotate/commit/3ba23b1c578ed9d22c9ebf03258481545bd32eef), [commit f94813d](https://github.com/PatrickJYKang/annotate/commit/f94813d8789e1f582a6a68a77d97518bac79589f))
 - Implement batch tracking ([commit 39c4750](https://github.com/PatrickJYKang/annotate/commit/39c475088f157c906a9de2fa1cee74f23cad3b35))
 - Various other improvements and fixes

A summary in words: the most significant change in this period was the migration of the app from a stills-only platform, which would be mostly accomplishable with something like PowerPoint, to an app centred around annotating and analysing video clips. Two major hurdles were encountered here: first, how to efficiently create, load, and render said clips, and second, how to do tracking, analysis, and etc. The solution to the first involved a lot of back and forth between solutions and pre-rendering things here and there. The solution to the second was not to train a set of CV models but instead to mostly vendor the setup and models from the wonderful [roboflow/trackers](https://github.com/roboflow/trackers) and [mguti97/PnLCalib](https://github.com/mguti97/PnLCalib).

## Next steps

With USC on the horizon and my original list of features completed the natural next step would be to produce a presentation, likely including a video demonstration (a live demo would take too long, because my CV models are slow and my video loading is also slow).

From a development perspective, the next step is to actively hunt for QoL issues and bugs. Since I do not think I am at the stage where I want to start looking for testers yet, I will probably go ahead and attempt to analyse an entire match end-to-end to see what happens. This is already underway.

## Thanks

Obviously there are some people who without their support this project would not have been possible: the entire Tech Sem team, coaches and analysts that have provided feedback, football twitter, as well as the open source community. A few special words go out to the [ACFC YouTube Channel](https://www.youtube.com/@ACFC) for their excellent content and for being the original birth of inspiration and a continuing reference point for this project; to the organisations that have uploaded full-length match videos to the internet for free use; and to the developers of the open source tools that made this project possible. This project has been developed in OpenAI Codex and Windsurf, with support from Claude Code, and almost all code is written by AI. 