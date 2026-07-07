# 4. Rush Custom Commands

Rush already gives us built-in commands like:

```bash
rush update
rush build
rush rebuild
```

But Rush does not automatically know about our custom sync script.

Our sync script lives here:

```
common/scripts/sync-submodules.js
```

By default, we would have to run it like this:

```bash
node common/scripts/sync-submodules.js
```

That works, but it does not feel like part of the Rush workflow.

So we expose it as a Rush custom command.

That lets us run:

```bash
rush sync
```

instead.

---

## Where Custom Commands Are Defined

Rush custom commands are defined in:

```
common/config/rush/command-line.json
```

This file tells Rush:

```
When someone runs this command, execute this script.
```

---

## Why We Use a Custom Command

We use a custom command so that repo syncing becomes part of the normal Rush workflow.

Instead of this:

```bash
node common/scripts/sync-submodules.js
rush update
rush build
```

we can do this:

```bash
rush sync
rush update
rush build
```

That is cleaner and easier to explain.

---

## Our Sync Command

The sync command runs the submodule sync script once from the parent repo.

Example:

```json
{
  "commandKind": "global",
  "name": "sync",
  "summary": "Sync application submodules",
  "description": "Adds, initializes, and updates app submodules from projects.json.",
  "shellCommand": "node common/scripts/sync-submodules.js"
}
```

This means:

```
rush sync
```

will run:

```bash
node common/scripts/sync-submodules.js
```

---

## Global Command vs Bulk Command

Rush custom commands can be different types.

For our case, the important ones are:

| Type | Meaning | Example |
| --- | --- | --- |
| Global command | Runs once from the parent repo | `rush sync` |
| Bulk command | Runs once for each selected project | build/test/lint style commands |

Our sync command should be a **global command**.

Reason:

```
Syncing submodules is a parent workspace task.
It should not run separately inside every project.
```

---

## Final Flow

After adding the custom command, the workflow becomes:

```bash
rush sync
rush update
rush build
```

Meaning:

```
1. rush sync   -> bring child repos to the correct version
2. rush update -> install dependencies and update lockfile
3. rush build  -> build the registered Rush projects
```

So the custom command is mainly a clean wrapper.

It does not make Rush manage Git by itself.

Git still handles submodules.

The sync script handles automation.

Rush only gives us a clean command entry point.