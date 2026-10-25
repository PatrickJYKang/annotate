# Support and recovery

In desktop builds starting with 0.2.3-rc.1, the Help menu contains **User guide**, **Open logs**, **Copy diagnostic information**, **Report a problem**, and **Downloads and updates**. A bug report should include steps, expected and actual behavior, and copied diagnostics. Diagnostics contain build/version, OS, architecture, Electron and sidecar capability status, not project paths, media, credentials or raw logs. Nothing is submitted automatically.

Service logs are in `~/Library/Application Support/Annotate/logs/` on macOS and `%APPDATA%\Annotate\logs\` on Windows. Review them before attaching: they can contain local paths and filenames. Do not attach private footage, project folders or credentials. See [security reporting](../SECURITY.md) for sensitive reports.

Current development source also adds **Help > Licences and source**, which opens the packaged licence folder or the source repository for the build commit. The browser header has a **Source** link. This addition is not in the already shared 0.2.3-rc.1 installers. Local builds with unpublished changes are not represented as complete matching public source. See [distribution compliance](distribution-compliance.md) for outstanding release requirements.

## Saved state

Project JSON and media remain in the chosen project folder. Locale and panel layouts are stored separately in the desktop user-data folder, independent of the changing localhost port. The previous preview's origin-local settings are not automatically migrated. Browser preferences still use the browser origin.

Pin annotation recovery copies are written to the desktop `recovery/` directory before an annotation save is attempted. Their identity uses the authorized canonical project path and relative annotation path, not a session token. When opening a pin with a newer differing recovery copy, choose **Restore recovery copy** or **Keep saved version**. Neither option is chosen automatically. While the prompt is open, editing and autosave are blocked so the copy is not silently replaced. Closing the window without choosing preserves it for later.

These copies cover pin annotation saves, not every keystroke or unsaved provisional tracking operation. A crash before the autosave debounce, a multi-file operation interrupted by power loss, a renamed project folder, or disk failure can still require manual recovery. Keep independent project-folder backups. Do not edit the same folder in browser and desktop at once; their locks are not shared. Old ambiguous browser backups are deliberately left untouched.

## Unresponsive windows

A crashed or unresponsive editor offers **Keep waiting**, **Reload window**, or **Close window**. A close request that remains unfinished also offers these choices after 15 seconds. Waiting is the default. Reload and close can lose changes that were not yet saved or backed up; they require an explicit choice. Normal closing still flushes pending saves and asks before discarding failed saves or provisional work.

A second launch with the same desktop profile focuses the existing app rather than starting duplicate services. If the main process is terminated abruptly, its private lifetime pipes close and the owned renderer/sidecar services exit. This cleanup does not turn an interrupted multi-file save into a transaction.

## Updating

Quit the app normally before replacing it. Install the new version without deleting the user-data folder or project folders. The Windows uninstaller preserves application data. Use a project copy for candidate testing. There is no automatic updater and no need to run an installer again merely to restart the app.
