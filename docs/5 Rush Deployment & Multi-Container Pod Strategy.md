# Enterprise Rush Monorepo: Architecture, Containerization & Single-Pod Deployment

This document provides a complete technical guide to the architecture, dependency management, parallel containerization, and single-pod Kubernetes deployment implemented in this Rush monorepo.

---

## 1. Executive Summary & Architectural Overview

The core objective of this architecture is to provide a **hybrid enterprise monorepo**:
* **Decoupled Development:** External development teams maintain their own isolated Git repositories.
* **Centralized Coordination:** A single Rush umbrella workspace pulls those independent repositories together via Git Submodules.
* **Centralized Dependencies:** Shared pnpm lockfile guarantees zero package version drift across teams.
* **Smart Incremental Builds:** Rush compiles only modified packages with topological dependency awareness.
* **Selective Deployment:** Rush filters only designated production packages, strips devDependencies, and resolves symlinks.
* **Controlled Parallel Containerization:** A native custom Rush command (`rush docker:build`) builds Docker images with concurrency throttling and Git diff detection.
* **Single-Pod Kubernetes Deployment:** Multiple application containers run side-by-side inside **one Kubernetes Pod**, sharing `localhost` with zero internal latency and zero-downtime rolling updates.
* **Automated CI/CD:** GitHub Actions triggers on push, checks out submodules, compiles, builds images, and pushes to GitHub Container Registry (GHCR).

```
                                      ARCHITECTURE AT A GLANCE
                                      
  [ Minor Repo 1 ]      [ Minor Repo 2 ]      [ Minor Repo 3 ]
  (app-react-one)       (app-react-two)       (nestjs-demo)
         │                     │                     │
         └─────────────────────┼─────────────────────┘
                               ▼
        ┌──────────────────────────────────────────────┐
        │       CENTRAL RUSH WORKSPACE                 │
        │  • sync-submodules.js (Git Submodule Sync)   │
        │  • pnpm-lock.yaml (Centralized Dependencies) │
        │  • rush build (Topological Cached Compile)   │
        │  • deploy.json (Scope Filter)                │
        │  • rush docker:build (Parallel Builder)      │
        └──────────────────────┬───────────────────────┘
                               ▼
                    [ GITHUB ACTIONS CI/CD ]
                               │
                ┌──────────────┴──────────────┐
                ▼                             ▼
       [ GHCR Registry ]             [ Kubernetes Single Pod ]
       app-react-one:latest ───────► Container 1 (Nginx :80)
       nestjs-api:latest    ───────► Container 2 (Node  :5000)
                                     (Shared localhost network)
```

---

## 2. Layer 1: Code Sourcing (Git Submodules)

### Why Git Submodules?
In enterprise setups, putting all code directly into one repository limits access control. External frontend contractors or specialized backend teams should only access their own respective codebases.

* Each application lives in its own remote Git repository.
* The master monorepo links to these repositories via **Git Submodules** inside the `apps/` directory.

### The Custom Sync Engine: `common/scripts/sync-submodules.js`
Rush and Git do not natively synchronize submodules from a configuration inventory. We created a custom sync engine:
1. Reads definitions from `common/config/projects.json`.
2. Inspects `.gitmodules` to check registration.
3. Automatically executes `git submodule add` or `git submodule update --init --recursive`.
4. Checks out specified branches (`main`, `dev`, `master`) or pinned commit hashes.
5. Verifies working trees to prevent accidental overwrites.
6. Registered as a global Rush command:
   ```bash
   rush sync
   ```

---

## 3. Layer 2: Centralized Dependencies & Compilation

### The Dependency Drift Problem
When independent repositories manage their own `package.json`, Team A might adopt `react: 18` while Team B adopts `react: 19`, and backend teams might use incompatible versions of shared database connectors.

### The Rush Solution
* **Shared Virtual Store:** Rush uses **pnpm** under the hood. All packages across the monorepo are downloaded once into `common/temp/node_modules/.pnpm/` and hardlinked/symlinked into each app folder.
* **Single Source of Truth:** `common/config/rush/pnpm-lock.yaml` locks all dependency versions across the company.
* **Topological Build Order:** When running `rush build`, Rush inspects inter-package dependencies and compiles them in parallel in dependency order.
* **Smart Incremental Cache:** If a project has not changed since the last build, Rush skips it completely.

---

## 4. Layer 3: Production Extraction & Filtering (`deploy.json`)

### The Monorepo Symlink Problem
In development, `apps/my-app/node_modules` contains symlinks pointing to `common/temp/`. If you copy that folder into a production Docker image:
1. The symlinks break because `common/temp/` doesn't exist in the image.
2. If you copy the entire root monorepo, your Docker image balloons to 3 GB – 5 GB with useless compilers, test suites, and linters.

### The Solution: `deploy.json` & `rush deploy`
Rush includes a native deployment extractor configured via `common/config/rush/deploy.json`:

```json
{
  "$schema": "https://developer.microsoft.com/json-schemas/rush/v5/deploy-scenario.schema.json",
  "deploymentProjectNames": [
    "app-react-one"
  ],
  "projectSettings": [
    {
      "projectName": "app-react-one",
      "additionalProjectsToInclude": [
        "app-react-two"
      ]
    },
    {
      "projectName": "app-react-two"
    }
  ]
}
```

### What `rush deploy` Executes:
1. **Filters Scope:** Extracts **only** the projects declared in `deploymentProjectNames` and `additionalProjectsToInclude`.
2. **Drops devDependencies:** Strips out TypeScript compilers, linters, test runners, and build scripts.
3. **Resolves Symlinks:** Replaces pnpm symlinks with real standalone files.
4. **Outputs Clean Files:** Writes a self-contained production bundle to `common/deploy/`.

---

## 5. Layer 4: Parallel, Deadlock-Free Containerization

### The Challenge of Parallel Builds
Compiling multiple Docker images simultaneously can exhaust host memory and CPU, leading to process hangs or system deadlocks.

### The Engine: `common/scripts/build-images.js`
We built a dedicated Node.js automation script registered as `rush docker:build`:

```bash
rush docker:build                     # Builds all images in deploy.json
rush docker:build --changed-only      # Builds only apps with Git changes
rush docker:build --push              # Builds and pushes to GHCR
```

### Key Technical Implementations:
1. **Strict Alignment with `deploy.json`:** Discovers projects from `common/config/rush/deploy.json` and cross-references `rush.json` to find their physical directories.
2. **Concurrency Throttling (`MAX_CONCURRENT = 2`):** Implements a promise-based worker queue capping concurrent Docker builds to 2 workers, preventing CPU starvation.
3. **Stream Prefixing:** Buffers and prefixes stdout/stderr (e.g. `[app-react-one] ...`), preventing parallel console output from scrambling.
4. **Git Diff Detection (`--changed-only`):** Evaluates `git diff` and submodule pointer status. If an app had no changes, its image build is skipped entirely.

---

## 6. Layer 5: Cloud Storage & Replacement (GHCR)

### Why Push to a Registry?
GitHub Actions runners are temporary machines that terminate after running. The Docker image must be stored in permanent cloud storage so Kubernetes can pull it anytime.

### How Atomic Replacement Works:
1. GitHub Actions logs in using its native `secrets.GITHUB_TOKEN`.
2. When `build-images.js` runs with `--push`, it tags the image:
   `ghcr.io/<owner>/<app-name>:latest`
3. When uploaded to **GitHub Container Registry (GHCR)**:
   * GHCR moves the `:latest` pointer to the newly built image.
   * Older layers remain cached; unchanged sibling apps are never re-uploaded.

---

## 7. Layer 6: Single-Pod Kubernetes Deployment

### Architecture: `k8s/rush-pod.yaml`
In Kubernetes, multiple containers can run inside **one single Pod**.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: rush-monorepo-deployment
spec:
  replicas: 1
  selector:
    matchLabels:
      app: rush-monorepo
  template:
    metadata:
      labels:
        app: rush-monorepo
    spec:
      containers:
        # Container 1: Backend API
        - name: nestjs-api
          image: ghcr.io/org/nestjs-api:latest
          imagePullPolicy: Always
          ports:
            - containerPort: 5000

        # Container 2: Frontend UI
        - name: app-react-one
          image: ghcr.io/org/app-react-one:latest
          imagePullPolicy: Always
          ports:
            - containerPort: 80
---
apiVersion: v1
kind: Service
metadata:
  name: rush-monorepo-service
spec:
  type: LoadBalancer
  selector:
    app: rush-monorepo
  ports:
    - name: http
      port: 80
      targetPort: 80
```

### How the Single-Pod Mechanics Work:
1. **Shared Network (`localhost`):** Both containers share the same IP address and network namespace.
2. **Reverse Proxying Without CORS:**
   * `app-react-one` runs Nginx on Port 80, serving static React assets.
   * Nginx proxies `/api/*` directly to `http://localhost:5000/`.
   * The client browser only communicates with Port 80, completely eliminating CORS configuration.
3. **Zero-Downtime Rolling Updates:**
   * When an updated image is pushed, Kubernetes does not perform in-place surgery on the running Pod.
   * Kubernetes spins up a **new Pod instance** alongside the old one.
   * Because unchanged containers use cached image layers, startup takes under 2 seconds.
   * Once healthy, traffic switches and the old Pod is terminated gracefully.

---

## 8. Layer 7: Automated CI/CD (GitHub Actions)

### Workflow File: `.github/workflows/deploy.yml`

```yaml
name: Build & Deploy Monorepo (Selective)

on:
  push:
    branches: [ "main" ]
  pull_request:
    branches: [ "main" ]
  workflow_dispatch:

permissions:
  contents: read
  packages: write

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout Monorepo with Submodules
        uses: actions/checkout@v4
        with:
          submodules: recursive
          fetch-depth: 0

      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 22

      - name: Rush Install
        run: node common/scripts/install-run-rush.js install

      - name: Rush Build
        run: node common/scripts/install-run-rush.js build

      - name: Log in to GitHub Container Registry
        if: github.event_name != 'pull_request'
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Selective Parallel Docker Build & Push
        run: node common/scripts/build-images.js --changed-only --push
        env:
          GITHUB_REPOSITORY_OWNER: ${{ github.repository_owner }}
```

---

## 9. Client Presentation: Key Architectural Trade-Offs

When presenting this architecture to clients or leadership, use these core comparative points:

| Dimension | Multi-Repo Approach | Single-Pod Rush Monorepo | Enterprise Multi-Pod |
| :--- | :--- | :--- | :--- |
| **Code Access** | Completely fragmented | Isolated submodules in one parent repo | Isolated submodules in one parent repo |
| **Dependency Health** | Frequent version drift & mismatch | Central `pnpm-lock.yaml` enforcement | Central `pnpm-lock.yaml` enforcement |
| **Build Efficiency** | No shared caching | Rush incremental build & caching | Rush incremental build & caching |
| **Cloud Hosting Cost** | High (separate servers/instances per app) | **Lowest (1 unified compute Pod)** | Moderate/High (1 Pod per service) |
| **Internal Networking** | Public internet / VPC gateways | **Fast `localhost` IPC** | Kubernetes Service DNS resolution |
| **Container Portability** | Custom per repo | **Standard OCI Docker images** | Standard OCI Docker images |

> **Key Presentation Takeaway:**  
> Because each application is containerized as its own independent OCI Docker image, this architecture allows starting on a cost-efficient **Single Pod** today, with zero code rewrites required if the client later chooses to scale into **Multiple Pods**.

---

## 10. Quick Command Reference

```bash
# 1. Synchronize all application submodules
rush sync

# 2. Install shared dependencies
rush install

# 3. Incrementally compile projects
rush build

# 4. Preview React applications locally
rush preview

# 5. Build Docker images for projects in deploy.json (parallel)
rush docker:build

# 6. Build ONLY projects with Git changes
node common/scripts/build-images.js --changed-only

# 7. Build and push to GitHub Container Registry
node common/scripts/build-images.js --changed-only --push

# 8. Deploy / Update Kubernetes Single Pod
kubectl apply -f k8s/rush-pod.yaml
```
