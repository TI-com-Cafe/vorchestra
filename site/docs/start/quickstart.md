# Quick start

Use this guide after installing VOrchestra or running it from source.

## Goal

At the end of this flow you should have:

- One workspace added.
- One scan completed.
- At least one environment opened in Studio.
- Package catalog loaded.
- One health or diagnostics action reviewed.

## Start the app

Installed app:

- Launch VOrchestra from your operating system menu.

Source build:

```bash
git clone https://github.com/TI-com-Cafe/vorchestra.git
cd vorchestra
npm install
npm run tauri dev
```

## Add your first workspace

Choose a directory that contains projects. Avoid selecting `/` for the first scan.

Recommended examples:

```bash
~/projects
~/work
/dados/python
```

After adding the workspace, run Scan.

## Review environment cards

Environment cards show the first operational signals:

- Name and path.
- Python version when available.
- Manager type such as pip, uv, Conda, or Pixi.
- Template label when created from a template.
- Health and repair indicators.
- Package count and stale/broken state.

Open Studio for the environment you want to inspect.

## Open Package Studio

Package Studio is the main environment workspace.

Start with the package list. Then try:

- Search package names.
- Sort by size.
- Filter unknown-size packages.
- Open Tree for dependency hierarchy.
- Open Graph for visual dependency shape.
- Use Why installed for a package you did not expect.

If a helper tool is missing, VOrchestra shows installation guidance and action buttons for the selected environment.

## Run diagnostics manually

Diagnostics do not auto-run on tab entry. This is intentional because diagnostics can be expensive.

Open Diagnostics and click the action to start checks. Review:

- Package conflicts.
- Outdated packages.
- Missing tools.
- Manager-specific hints.

## Run security audit when needed

Open Security and run the audit. If `pip-audit` is missing, use the install action or terminal command provided by VOrchestra.

## Try Repair Wizard

Open Repair to see environment-specific actions. Common actions include:

- Remove stale entry.
- Install missing pip.
- Install pipdeptree.
- Install pip-audit.
- Re-sync project.
- Rebuild from project sources.
- Set VS Code interpreter.

## Next steps

Read [First run](./first-run.md) for more detail, then [User workflows](../product/workflows.md) for common end-to-end scenarios.
