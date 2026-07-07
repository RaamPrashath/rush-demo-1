# 1. Git Cloning, Git Subtree, and Git Submodules

## 1. What We Wanted to Solve

We wanted one parent workspace that can manage multiple app repositories from one place.

The goal was to:

- keep each app in its own Git repo
- bring all apps under one parent workspace
- install dependencies from one place
- build all apps using Rush
- update child apps without manually cloning each one
- support both latest branch updates and fixed commit versions
- keep the parent repo lightweight

So the main question was:

> How do we bring external app repositories into the parent workspace cleanly?
> 

We compared three options:

1. Regular clone
2. Git subtree
3. Git submodule

---

## 2. Option 1: Regular Clone

Regular clone means manually cloning each app into the parent repo.

Example:

```bash
git clone https://github.com/RaamPrashath/app-react-one.git apps/app-react-one
```

This is simple, but it does not give a clean relationship between the parent repo and the child repo.

If the child repo keeps its own `.git` folder, we end up with a Git repo inside another Git repo.

If we remove the child `.git` folder, then it becomes copied code. At that point, it loses the clean link to the original app repo.

### Pros

- Easy to understand
- Easy to start with
- No special Git setup needed

### Cons

- No clean tracking between parent and child repos
- Hard to know which version of the child app is being used
- Updating each child repo is manual
- Easy to accidentally copy, overwrite, or lose changes
- Not a good fit when every app must stay as its own repo

### Decision

We did not choose regular cloning because it is too manual and does not track child repo versions cleanly.

---

## 3. Option 2: Git Subtree

Git subtree brings another repo’s files directly into a folder inside the parent repo.

Example:

```bash
git subtree add --prefix=apps/app-react-one https://github.com/RaamPrashath/app-react-one.git main --squash
```

With subtree, the child app files become normal files inside the parent repo.

Example:

```
apps/app-react-one/package.json
apps/app-react-one/src/App.tsx
apps/app-react-one/vite.config.ts
```

So the parent repo starts behaving more like a normal monorepo.

### Pros

- Child files are directly tracked by the parent repo
- Easier for monorepo tools to detect file changes
- No special submodule initialization after clone
- Good if we want one repo to own everything

### Cons

- The parent repo now owns/imports the child app files
- The child app is not strongly separate inside the workspace
- Pulling and pushing changes between parent and child needs subtree commands
- History can become large if not squashed
- Not ideal when child apps must stay independent

### Decision

We did not choose subtree because we wanted the apps to remain separate repositories.

Subtree is good when we want a more traditional monorepo setup. That was not our requirement here.

---

## 4. Option 3: Git Submodules

Git submodules allow one Git repo to include another Git repo inside it.

Example:

```bash
git submodule add https://github.com/RaamPrashath/app-react-one.git apps/app-react-one
```

The child app exists inside the parent workspace:

```
rush-demo/
  apps/
    app-react-one/
    app-react-two/
```

But each child app is still its own Git repository.

The parent repo does not track every file inside the child app. Instead, it tracks the commit of the child repo.

Example:

```
apps/app-react-one -> commit 50da251
```

This is called a submodule pointer.

### Pros

- Each app remains its own Git repo
- Parent repo controls which commit of each app is used
- Supports fixed/pinned versions
- Supports latest branch syncing
- Parent repo stays lightweight because it does not store all child app code directly
- Good for keeping app ownership clear

### Cons

- Submodules need setup and syncing
- Developers must understand submodule pointers
- Pinned commits can put a submodule in detached HEAD mode
- Parent repo does not track child files directly
- Rush file-level change detection is not as strong as a normal monorepo
- Generated folders must be ignored inside child repos

### Decision

Submodules is the best fit

Reason:

> Each app needs to remain an independent Git repository, but the parent workspace should control which version of each app is used.
> 

---

## 5. Final Choice

| Approach | Keeps child repo separate? | Parent tracks child files directly? | Good for this case? |
| --- | --- | --- | --- |
| Regular clone | Not cleanly | Maybe | No |
| Git subtree | No | Yes | Not preferred |
| Git submodule | Yes | No, tracks commit pointer | Yes |

Final decision:

> Use Git submodules for repo separation, and use Rush for install/build orchestration.
>