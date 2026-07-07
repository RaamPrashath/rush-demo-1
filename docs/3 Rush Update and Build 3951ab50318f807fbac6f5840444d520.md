# 3. Rush Update and Build

After the repos are synced into the workspace, Rush is used to install dependencies and build the projects.

The basic flow is:

```bash
rush sync
rush update
rush build
```

---

## 1. `rush update`

`rush update` installs dependencies for all projects registered in `rush.json`.

It also updates the central Rush lockfile:

```
common/config/rush/pnpm-lock.yaml
```

Use `rush update` when:

- setting up the workspace for the first time
- adding a new project
- changing `package.json`
- adding or removing dependencies
- updating the central lockfile

Command:

```bash
rush update
```

In simple terms:

```
rush update = install dependencies and update lockfile
```

---

## 2. `rush build`

`rush build` builds the projects normally.

It can skip projects that are already up to date.

Use `rush build` for normal development builds.

Command:

```bash
rush build
```

Example result:

```
app-react-one was skipped
app-react-two was skipped
client was skipped
anonymous-blog completed with warnings
klhrms completed with warnings
```

This means Rush checked the project state and skipped the projects that did not need to be rebuilt.

In simple terms:

```
rush build = build what changed, skip what is already up to date
```

---

## 3. `rush rebuild`

`rush rebuild` forces all projects to build again.

It does not care whether the projects are already up to date.

Use `rush rebuild` when:

- testing the full workspace
- preparing for a demo
- checking whether all apps can build from scratch
- validating parallel builds

Command:

```bash
rush rebuild
```

In simple terms:

```
rush rebuild = force build everything
```

---

## 4. Build One Project

To build only one project, use:

```bash
rush rebuild --to <project-name>
```

Example:

```bash
rush rebuild --to anonymous-blog
```

This is useful after fixing or syncing one app.

Other examples:

```bash
rush rebuild --to app-react-one
rush rebuild --to klhrms
rush rebuild --to client
```

In simple terms:

```
rush rebuild --to <project> = build only the selected project
```

---

## 5. Normal Workflow

For regular usage:

```bash
rush sync
rush update
rush build
```

Meaning:

```
1. Sync child repos
2. Install/update dependencies
3. Build changed projects
```

---

## 6. Clean Demo Workflow

For demo or validation:

```bash
rush sync
rush update
rush rebuild
```

Meaning:

```
1. Sync child repos
2. Install/update dependencies
3. Force build all projects
```

This is better for demos because it clearly shows every project building.

---

## 7. Parallel Build Result

In our demo, we ran:

```bash
rush rebuild
```

Rush built 5 projects:

```
app-react-one
app-react-two
anonymous-blog
klhrms
client
```

Rush showed:

```
Executing a maximum of 5 simultaneous processes...
```

This means Rush was allowed to build all 5 projects in parallel.

The total build time was close to the slowest single project, not the sum of all project times.

That proves the projects were built in parallel.

---

## 8. Final Summary

```
rush sync     -> brings child repos to the correct version
rush update   -> installs dependencies and updates lockfile
rush build    -> builds only what changed
rush rebuild  -> force builds everything
```

For normal work:

```bash
rush sync
rush update
rush build
```

For demo:

```bash
rush sync
rush update
rush rebuild
```