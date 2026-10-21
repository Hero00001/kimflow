# Releasing KimFlow

Windows only, triggered by hand. Nothing is published automatically.

There are two workflows:

| Workflow | Trigger | What it does |
|---|---|---|
| **CI** | every push to `main`, every pull request, or by hand | typecheck → test → build → package (no installer). Never publishes. |
| **Release (Windows)** | **only** when you click *Run workflow* | verifies → builds the installer → commits the version bump → tags → creates a **draft** release. |

---

## Releasing, step by step

### 1. Write the release notes

Open `releases/NEXT.md` and write the notes for this release. Use
`{{version}}` where the number goes — it is filled in from the version you type
later, so the notes can never disagree with the release.

Commit and push the notes to `main` before running the workflow. The workflow
reads the file **from `main`**, so uncommitted notes are invisible to it.

### 2. Start the workflow

1. Open the repo on GitHub.
2. Click the **Actions** tab.
3. In the left sidebar, click **Release (Windows)**.
4. On the right, click **Run workflow**.
5. Type the version — numbers only, like `1.4.2`. **No leading `v`**: the
   workflow adds it, and a tag is always `v1.4.2`.
6. Leave the branch on `main` and click the green **Run workflow** button.

The run takes roughly 5–10 minutes. You can watch it live; each step is
labelled, so if it stops you can see exactly which one failed.

### 3. Check the draft before publishing

When the run goes green, the release is **still private**. Go to the
**Releases** page — the new release is at the top marked *Draft*.

Before you click **Publish release**, check:

- **The installer filename** matches the version you typed
  (`KimFlow.Setup.1.4.2.exe`).
- **The notes** read correctly, and `{{version}}` has been replaced.
- Optionally download the `.exe` and install it once.

Then click **Publish release**. That is the moment it becomes visible to
everyone.

### 4. Get ready for the next one

Rewrite `releases/NEXT.md` for the next release.

---

## What the workflow guarantees

**The version cannot drift again.** Every earlier release shipped an installer
whose internal version was unrelated to its tag — the 1.4.1 release actually
contained `KimFlow.Setup.0.1.0.exe`. The workflow now runs `npm version` before
building, so `package.json`, the installer filename, the installer's own
version, and the git tag are all the same number.

**A failed build leaves nothing behind.** The tag is created only after the
installer has been successfully built and found on disk. If the build fails,
there is no tag and no draft to clean up — fix the problem and run it again.

**Notes cannot drift either.** `{{version}}` in `NEXT.md` is substituted at
release time, and the workflow fails rather than publish notes with a
placeholder still in them.

**Nothing is published by a push.** The Release workflow has no push trigger at
all.

---

## Things that will surprise you once

**The release commit will not have a CI run.** GitHub deliberately does not
start workflows for commits pushed with its own token, and the release workflow
pushes the version bump using that token. So `chore(release): v1.4.2` shows no
green tick. This is expected — the same run already typechecked and tested
everything before it committed.

**The commit is authored by "KimFlow Release".** Not you. That identity is set
inside the workflow so the bump commit is clearly machine-made.

**A release can only run from `main`.** If you start it from another branch it
stops immediately with a message, rather than quietly releasing whatever is
there.

**Tags are `v1.4.2`.** Your existing tags are inconsistent (`v1.0.0`,
`v1.4.0`, but `1.4.1` with no `v`). New ones always carry the `v`. The old ones
are left alone.

---

## When it fails

| Message | Meaning | Fix |
|---|---|---|
| `'x' is not a version` | The version box had something other than `1.4.2` — usually a leading `v`. | Type numbers only. |
| `Tag v1.4.2 already exists` | That version is already released. | Use the next number. |
| `releases/NEXT.md is missing or empty` | The notes were not committed to `main`. | Write and push them first. |
| `Expected dist-electron/KimFlow.Setup.1.4.2.exe` | The build succeeded but produced a different filename. | Open the log — it lists what *was* produced. The naming comes from `build.artifactName` in `package.json`. |
| Tests fail | A real regression. | Fix it and push to `main`; CI will confirm. Then run the release again. |

Nothing is half-published in any of these cases: the tag and the draft are both
created at the very end.

---

## Notes on the current configuration

- **Windows only.** `mac` and `linux` targets still exist in `package.json` but
  nothing builds them. If you ever do: both point at `app icon/icon.png`, which
  is **not in the repo** — neither target would build until it is added.
- **No code signing.** Windows shows "Windows protected your PC" on first
  install; users click *More info → Run anyway*. Signing needs a paid
  certificate and is not configured.
- **No auto-update.** The app does not check for updates. Adding it later means
  configuring `publish` in `package.json` and `electron-updater` in the app.
- **Node version.** Both workflows pin Node 24, the version the test suite was
  verified on. If a runner update ever breaks the suite, change the
  `node-version` in both workflow files.
