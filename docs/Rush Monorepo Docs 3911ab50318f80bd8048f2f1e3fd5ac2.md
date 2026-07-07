# Rush Monorepo Docs

## What Rush Provides

Rush is the workspace orchestration tool.

It helps us with:

- registering all projects in one place using `rush.json`
- installing dependencies consistently with `rush update`
- maintaining one central lockfile
- building all registered projects with `rush build`
- force rebuilding everything with `rush rebuild`
- running builds in parallel
- skipping projects that are already up to date
- creating custom commands like `rush sync`

In simple terms:

> Rush manages the workspace, dependencies, and build flow.

---

## What Rush Does Not Provide

Rush does not automatically manage external Git repositories.

It does not directly do things like:

- clone multiple app repos
- add repos as Git submodules
- pull the latest child repo changes
- checkout a pinned child commit
- update submodule automatically
- decide which external repo should live in which folder

That part still belongs to Git.

So we added our own sync script and exposed it as:

```bash
rush sync
```
