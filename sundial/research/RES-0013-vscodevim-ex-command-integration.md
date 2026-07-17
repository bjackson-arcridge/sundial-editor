---
id: RES-0013
title: VSCodeVim Ex command integration
domain: vscode.extension
summary: Vim reserves percent in Ex command position as the whole-buffer range. VSCodeVim exposes a built-in vsc[ode] bridge to registered VS Code commands, but its standalone Ex parser has no cross-extension custom-command registration surface.
created: 2026-07-16
updated: 2026-07-16
---

## Research

Verified on 2026-07-16 against Vim 9.2 documentation, VSCodeVim's current source, and locally installed VSCodeVim 1.32.4.

- Vim calls the `:` input state Command-line mode. It accepts Ex commands, searches, and filters.
- In an Ex command, `%` is a line-range address equal to `1,$`, or the entire buffer. It is not an available namespace marker. For example, `:%s/old/new/g` applies `:substitute` to the entire buffer.
- `:g[lobal]/{pattern}/{command}` is Vim's built-in global command. Its default range is already the whole file, and `:%g/...` explicitly supplies that same whole-buffer range. A Sundial syntax beginning `:%g` would therefore collide with established Vim grammar.
- Standard Vim user-defined Ex commands must begin with an uppercase letter. A Vim-native namespace would conventionally look like `:Sundial ...`, not `:%...`.
- VSCodeVim's standalone Ex parser uses a static list of built-in commands. In the checked source, `:com[mand]` is listed but unimplemented, and there is no contribution point or exported cross-extension API for registering another extension's Ex commands or command-line completions.
- VSCodeVim implements `:vsc[ode] <command-id>` as a special bridge. It passes the entire text after required whitespace to `vscode.commands.executeCommand` as a command id. Consequently, a VS Code extension can register commands normally and users can invoke a no-argument command with syntax such as `:vsc sundial.commandId`.
- The locally installed manifest contributes `vim.showQuickpickCmdLine`, which opens a VS Code input box and executes the entered Ex command. This is not VSCodeVim's usual status-bar-backed `CommandlineInProgress` mode.
- In VSCodeVim 1.32.4, typing `:` while in Normal or Visual mode enters `CommandlineInProgress`. VSCodeVim intercepts VS Code's `type` command to process that key. Its `extension.vim_escape` command is used by the Escape keybinding but is not listed as a contributed public command. A peer extension can therefore approximate “focus the editor, leave the current Vim mode, then enter `:` Command-line mode” with `extension.vim_escape` followed by `type` with `{ text: ':' }`, but this relies partly on VSCodeVim implementation-level command behavior.

Sources:

- https://vimhelp.org/cmdline.txt.html
- https://vimhelp.org/usr_10.txt.html
- https://github.com/vim/vim/blob/master/runtime/doc/map.txt
- https://github.com/VSCodeVim/Vim/blob/master/src/vimscript/exCommandParser.ts
- https://github.com/VSCodeVim/Vim/blob/master/src/vimscript/lineRange.ts
- https://github.com/VSCodeVim/Vim/blob/master/src/cmd_line/commands/vscode.ts
- `~/.vscode/extensions/vscodevim.vim-1.32.4/package.json`
- `~/.vscode/extensions/vscodevim.vim-1.32.4/out/extensionBase.js`
- `~/.vscode/extensions/vscodevim.vim-1.32.4/out/extension.js`
