<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=BroCodeOrganization.bro-code"><img src="https://img.shields.io/badge/VS_Code_Marketplace-007ACC?style=flat&logo=visualstudiocode&logoColor=white" alt="VS Code Marketplace"></a>
  <a href="https://x.com/BroCodeDev"><img src="https://img.shields.io/badge/BroCode-000000?style=flat&logo=x&logoColor=white" alt="X"></a>
  <a href="https://youtube.com/@brocodeyt?feature=shared"><img src="https://img.shields.io/badge/YouTube-FF0000?style=flat&logo=youtube&logoColor=white" alt="YouTube"></a>
  <a href="https://discord.gg/VxfP4Vx3gX"><img src="https://img.shields.io/badge/Join%20Discord-5865F2?style=flat&logo=discord&logoColor=white" alt="Join Discord"></a>
  <a href="https://www.reddit.com/r/BroCode/"><img src="https://img.shields.io/badge/Join%20r%2FZooCode-FF4500?style=flat&logo=reddit&logoColor=white" alt="Join r/BroCode"></a>
  <a href="https://github.com/Bro-Code-Org/Bro-Code/issues"><img src="https://img.shields.io/badge/GitHub-Issues-181717?style=flat&logo=github&logoColor=white" alt="GitHub Issues"></a>
</p>
<p align="center">
  <em>Get help fast → <a href="https://discord.gg/VxfP4Vx3gX">Join Discord</a> • Prefer async? → <a href="https://www.reddit.com/r/BroCode/">Join r/BroCode</a></em>
</p>

# Bro Code

> Your AI-Powered Dev Team, Right in Your Editor

> **Bro Code is a fork of [Zoo Code](https://github.com/Zoo-Code-Org/Zoo-Code)**, which is itself
> a fork of [Roo Code](https://github.com/RooCodeInc/Roo-Code). Both projects are licensed under
> the [Apache License 2.0](./LICENSE), and Bro Code is distributed under the same license. See the
> [License](#license) section below for the required attribution.
> This focuses on updating the features to primarily focus on developing features
> for LM Studio API Provider.
> This project is only for educational purposes so I can learn how to Vibe Code properly. Use at your own risk.

## What's New in v1.0.4

- Bro Code editor tabs now survive `Developer: Reload Window` — they're restored automatically with the task they had open instead of disappearing or reopening blank
- New Task now opens a fresh editor tab when clicked from within an existing Bro Code tab, instead of resetting that tab's conversation in place — the original tab and its task stay open alongside the new one
- Fix opening Bro Code in a new tab spawning a duplicate panel — now reveals the existing tab instead
- Fix new editor group detection when other webview panels (not just text editors) are visible
- Fix internal skill-check tag leaking into user-facing output on some providers (e.g. Copilot via the VS Code LM API)
- Harden the skill applicability check so it always runs fully inside `<thinking>` tags, never leaking section tags into responses
- Refreshed icon and logo assets

<details>
  <summary>🌐 Available languages</summary>

- [English](README.md)
- [Català](locales/ca/README.md)
- [Deutsch](locales/de/README.md)
- [Español](locales/es/README.md)
- [Français](locales/fr/README.md)
- [हिंदी](locales/hi/README.md)
- [Bahasa Indonesia](locales/id/README.md)
- [Italiano](locales/it/README.md)
- [日本語](locales/ja/README.md)
- [한국어](locales/ko/README.md)
- [Nederlands](locales/nl/README.md)
- [Polski](locales/pl/README.md)
- [Português (BR)](locales/pt-BR/README.md)
- [Русский](locales/ru/README.md)
- [Türkçe](locales/tr/README.md)
- [Tiếng Việt](locales/vi/README.md)
- [简体中文](locales/zh-CN/README.md)
- [繁體中文](locales/zh-TW/README.md)
- ...
  </details>

---

## What Can Bro Code Do For YOU?

- Generate Code from natural language descriptions and specs
- Adapt with Modes: Code, Architect, Ask, Debug, and Custom Modes
- Refactor & Debug existing code
- Write & Update documentation
- Answer Questions about your codebase
- Automate repetitive tasks
- Utilize MCP Servers

## Modes

Bro Code adapts to how you work:

- Code Mode: everyday coding, edits, and file ops
- Architect Mode: plan systems, specs, and migrations
- Ask Mode: fast answers, explanations, and docs
- Debug Mode: trace issues, add logs, isolate root causes
- Custom Modes: build specialized modes for your team or workflow

Learn more: [Using Modes](https://docs.brocode.dev/basic-usage/using-modes) •
[Custom Modes](https://docs.brocode.dev/advanced-usage/custom-modes)

## Tutorial & Feature Videos

<div align="center">

|                                                                                                                                                                                                               |                                                                                                                                                                                                       |                                                                                                                                                                                                   |
| :-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------: | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------: | :-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------: |
| <a href="https://www.youtube.com/watch?v=Mcq3r1EPZ-4"><img src="https://img.youtube.com/vi/Mcq3r1EPZ-4/maxresdefault.jpg" width="100%" alt="Installing the Extension"></a><br><b>Installing the Extension</b> | <a href="https://www.youtube.com/watch?v=ZBML8h5cCgo"><img src="https://img.youtube.com/vi/ZBML8h5cCgo/maxresdefault.jpg" width="100%" alt="Configuring Profiles"></a><br><b>Configuring Profiles</b> |  <a href="https://www.youtube.com/watch?v=r1bpod1VWhg"><img src="https://img.youtube.com/vi/r1bpod1VWhg/maxresdefault.jpg" width="100%" alt="Codebase Indexing"></a><br><b>Codebase Indexing</b>  |
|             <a href="https://www.youtube.com/watch?v=iiAv1eKOaxk"><img src="https://img.youtube.com/vi/iiAv1eKOaxk/maxresdefault.jpg" width="100%" alt="Custom Modes"></a><br><b>Custom Modes</b>             |          <a href="https://www.youtube.com/watch?v=Ho30nyY332E"><img src="https://img.youtube.com/vi/Ho30nyY332E/maxresdefault.jpg" width="100%" alt="Checkpoints"></a><br><b>Checkpoints</b>          | <a href="https://www.youtube.com/watch?v=HmnNSasv7T8"><img src="https://img.youtube.com/vi/HmnNSasv7T8/maxresdefault.jpg" width="100%" alt="Context Management"></a><br><b>Context Management</b> |

</div>
<p align="center">
<a href="https://docs.brocode.dev/tutorial-videos">More quick tutorial and feature videos...</a>
</p>

## Resources

- **[Documentation](https://docs.brocode.dev):** The official guide to
  installing, configuring, and mastering Bro Code.
- **[YouTube Channel](https://youtube.com/@brocodeyt?feature=shared):** Watch
  tutorials and see features in action.
- **[Discord Server](https://discord.gg/VxfP4Vx3gX):** Join the community for
  real-time help and discussion.
- **[Reddit Community](https://www.reddit.com/r/BroCode/):** Share your
  experiences and see what others are building.
- **[GitHub Issues](https://github.com/Bro-Code-Org/Bro-Code/issues):** Report
  bugs and track development.
- **[Feature Requests](https://github.com/Bro-Code-Org/Bro-Code/discussions/categories/feature-requests?discussions_q=is%3Aopen+category%3A%22Feature+Requests%22+sort%3Atop):**
  Have an idea? Share it with the developers.

---

## Local Setup & Development

1. **Clone** the repo:

```sh
git clone https://github.com/Bro-Code-Org/Bro-Code.git
```

2. **Install dependencies**:

```sh
pnpm install
```

3. **Run the extension**:

There are several ways to run the Bro Code extension:

### Development Mode (F5)

For active development, use VSCode's built-in debugging:

Press `F5` (or go to **Run** → **Start Debugging**) in VSCode. This will open a
new VSCode window with the Bro Code extension running.

- Changes to the webview will appear immediately.
- Changes to the core extension will also hot reload automatically.

### Automated VSIX Installation

To build and install the extension as a VSIX package directly into VSCode:

```sh
pnpm install:vsix [-y] [--editor=<command>]
```

This command will:

- Ask which editor command to use (code/cursor/code-insiders) - defaults to
  'code'
- Uninstall any existing version of the extension.
- Build the latest VSIX package.
- Install the newly built VSIX.
- Prompt you to restart VS Code for changes to take effect.

Options:

- `-y`: Skip all confirmation prompts and use defaults
- `--editor=<command>`: Specify the editor command (e.g., `--editor=cursor` or
  `--editor=code-insiders`)

### Manual VSIX Installation

If you prefer to install the VSIX package manually:

1. First, build the VSIX package:
    ```sh
    pnpm vsix
    ```
2. A `.vsix` file will be generated in the `bin/` directory (e.g.,
   `bin/bro-code-<version>.vsix`).
3. Install it manually using the VSCode CLI:
    ```sh
    code --install-extension bin/bro-code-<version>.vsix
    ```

---

We use [changesets](https://github.com/changesets/changesets) for versioning and
publishing. Check our `CHANGELOG.md` for release notes.

---

## Disclaimer

**Please note** that Bro Code does **not** make any representations or
warranties regarding any code, models, or other tools provided or made available
in connection with Bro Code, any associated third-party tools, or any resulting
outputs. You assume **all risks** associated with the use of any such tools or
outputs; such tools are provided on an **"AS IS"** and **"AS AVAILABLE"** basis.
Such risks may include, without limitation, intellectual property infringement,
cyber vulnerabilities or attacks, bias, inaccuracies, errors, defects, viruses,
downtime, property loss or damage, and/or personal injury. You are solely
responsible for your use of any such tools or outputs (including, without
limitation, the legality, appropriateness, and results thereof).

---

## Contributing

We love community contributions! Get started by reading our
[CONTRIBUTING.md](CONTRIBUTING.md).

---

## License

Bro Code is licensed under the [Apache License 2.0](./LICENSE).

Bro Code is a fork of [Zoo Code](https://github.com/Zoo-Code-Org/Zoo-Code) (Copyright © 2026 Zoo
Code), which is itself a fork of [Roo Code](https://github.com/RooCodeInc/Roo-Code). We are
grateful to the Zoo Code and Roo Code teams and communities for their work, which this project is
built upon in accordance with the terms of the Apache License 2.0.

[Apache 2.0 © 2026 Bro Code Org](./LICENSE)

---

**Enjoy Bro Code!** Whether you keep it on a short leash or let it roam
autonomously, we can’t wait to see what you build. If you have questions or
feature ideas, drop by our [Reddit community](https://www.reddit.com/r/BroCode/)
or [Discord](https://discord.gg/VxfP4Vx3gX), or open an
[issue](https://github.com/Bro-Code-Org/Bro-Code/issues). Happy coding!
