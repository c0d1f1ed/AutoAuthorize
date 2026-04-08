# Auto-Authorize for Claude Code

A VSCode extension that automatically approves Claude Code tool requests matching user-defined regex patterns.

When Claude Code asks for permission to run a command, Auto-Authorize checks it against your rules and instantly approves matching requests. Commands that don't match any rule are shown as normal approval prompts.

## How It Works

Auto-Authorize patches `child_process.spawn` in the VSCode extension host to intercept Claude Code's CLI subprocess communication. Permission requests (`can_use_tool`) are parsed from the newline-delimited JSON stdio stream, evaluated against your regex rules, and either auto-approved or passed through to the normal prompt.

## Installation

1. Download the latest `.vsix` from the [Releases](https://github.com/c0d1f1ed/AutoAuthorize/releases) page
2. In VSCode: Extensions view > `...` menu > **Install from VSIX...**
3. Reload the window

Or build from source:

```bash
git clone https://github.com/c0d1f1ed/AutoAuthorize.git
cd AutoAuthorize
npm install
npm run compile
npm run package
```

Then install the generated `auto-authorize-0.1.0.vsix`.

## Usage

1. Click the shield icon in the activity bar to open the Auto-Authorize panel
2. Go to the **Rules** tab and click **+ Add Rule**
3. Select a tool type (Bash, Read, Write, Edit, or Any)
4. Enter a regex pattern (e.g., `^(grep|ls|cat|head|tail|wc)\b` for read-only commands)
5. Add a description and click **Save**

Rules are evaluated in order. The first matching enabled rule wins.

## Features

- **Regex-based rules** -- full JavaScript regex support, not limited to glob patterns
- **Per-tool filtering** -- scope rules to Bash, Read, Write, Edit, or any tool
- **Live regex tester** -- paste a sample command in the rule form to test before saving
- **Activity Log** -- see every intercepted request and whether it was auto-approved or passed through
- **Persistent JSONL logs** -- one log file per session, persisted to disk for auditing (click "Open Log Folder" in the Activity Log tab)
- **Sound notification** -- optional chime when a command needs manual approval (toggle in the panel header)
- **Import/Export** -- share rule sets as JSON
- **Debug tab** -- inspect raw extension activity and protocol messages

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `autoAuthorize.debug` | `false` | Log all spawned processes and intercepted messages |

## VSCode Commands

- `Auto-Authorize: Open Panel` -- focus the sidebar panel
- `Auto-Authorize: Enable` -- enable auto-approval
- `Auto-Authorize: Disable` -- disable auto-approval (all requests pass through)

## Disclaimer

THIS SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NONINFRINGEMENT.

This extension intercepts and modifies communication between VSCode and the Claude Code CLI by monkey-patching `child_process.spawn`. This is an unofficial tool, not affiliated with or endorsed by any company or individual. It may break at any time due to changes in Claude Code's internal protocol.

**You use this extension entirely at your own risk.** The author(s) accept no responsibility for any consequences resulting from its use, including but not limited to: unintended command execution, data loss, policy violations, or security issues. You are responsible for the regex rules you configure and the commands they approve.

## License

BSD 3-Clause License. See [LICENSE.txt](LICENSE.txt) for details.
