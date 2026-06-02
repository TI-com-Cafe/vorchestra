# FAQ

## Is VOrchestra a package manager?

No. VOrchestra coordinates existing tools such as pip, uv, Conda, Pixi, VS Code, Docker, Jupyter, pipdeptree, and pip-audit. Its value is inventory, diagnosis, repair, cleanup, security review, and project operations across many local environments.

## Does it work offline?

Yes for local workflows. Workspace scans, local environment inventory, package cataloging, local tree generation, `.env` editing, VS Code settings, Docker file generation, repair views, and many diagnostics can run offline.

Network is needed for package installation, PyPI search, metadata refresh, dependency downloads, and security advisory retrieval.

## Does it collect telemetry?

No. VOrchestra is local-first and does not require an account.

## Why is Conda read-only, and how is Pixi handled?

Conda and Pixi manage their own metadata and workflows. VOrchestra currently detects and inventories them but avoids mutation to prevent fighting the native manager. Future mutation support should be designed and tested explicitly.

## Why does Tree require pipdeptree for pip environments?

pip does not provide a native full dependency tree command. `pipdeptree` supplies that view. If it is missing, VOrchestra shows install instructions and action buttons for the selected environment.

## Why does Security require pip-audit?

`pip-audit` is the PyPA-oriented tool VOrchestra uses for vulnerability scanning. If it is missing, the app shows install commands adapted to the selected environment manager.

## What does Remove stale entry do?

It removes an inventory record from VOrchestra when the environment folder no longer exists on disk. It does not delete a real environment folder. If the folder exists, use the normal delete flow instead.

## Can I add `/` as a workspace?

You can, but it is not recommended. Scanning `/` can be slow, discover system paths, and create noisy results. Use narrower roots such as `~/projects`, `~/work`, or `/dados/python`.

## Why does package size show Unknown?

Package size is calculated separately from package cataloging. Some packages may not map cleanly to installed directories, and size scans can be cancelled or delayed. Unknown size means the package exists but VOrchestra does not have reliable disk-size data for it yet.

## Why does a job keep running after I delete an environment?

Long scans and package jobs are independent background operations. VOrchestra has guards to prevent stale scan writes from re-adopting deleted paths, but you should cancel active jobs before deleting or recreating the same path.

## Why did a uv command fail with an unexpected argument?

uv evolves quickly and CLI options differ by version. VOrchestra avoids assuming newest-only commands where possible. If a command fails, check `uv --version` and `uv <command> --help`, then report the version and failing action.
