# 2. Repo Sync

Rush does **not** provide a built-in feature to clone or update multiple external repositories for us.

Rush can manage projects once they are already inside the workspace, but it does not automatically do things like:

```
clone this repo
add it as a submodule
pull latest changes
checkout this specific commit
```

So we automated that part using a custom sync script.

The script is exposed through Rush as:

```bash
rush sync
```

## What `rush sync` Does

The sync command reads the list of child apps from:

```
common/config/projects.json
```

For each app, it checks:

- repo URL
- local folder path
- branch name
- whether to use latest branch or a fixed commit

Then it makes sure the app exists inside the parent workspace as a Git submodule.

If the submodule is missing, it adds it.

If the submodule already exists, it initializes it and updates it.

## Latest Mode

If the project config says:

```json
"commit": "latest"
```

then sync pulls the latest version from the configured branch.

Example:

```
Use latest from main branch
```

## Pinned Commit Mode

If the project config has a specific commit hash, sync checks out that exact commit.

Example:

```
Use this exact version of the app
```

This is useful when we want stable builds or fixed production versions.

## Safety Check

Before updating a child repo, the script checks if that child repo has uncommitted changes.

If it has changes, sync stops.

This prevents local work from being overwritten.

## Final Result

After sync finishes, it shows which apps changed and the parent repo status.

If a child app moved to a new commit, the parent repo needs to record that new submodule pointer.

Example:

```bash
git add .gitmodules apps
git commit -m "Sync application submodules"
```

So the simple idea is:

```
Rush handles workspace commands.
Git handles submodules.
The sync script connects both.
```