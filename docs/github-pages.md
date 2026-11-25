# GitHub Actions and Pages

The publication repository is `T-REX-XP/vivamark-web-client-rnd`. Its intended Pages URL is https://t-rex-xp.github.io/vivamark-web-client-rnd/ once deployed.

## Reference validation

Reviewed [superband-web-client-rnd](https://github.com/T-REX-XP/superband-web-client-rnd), including its Validate and Pages workflows, static builder, preview server and ignore rules. It separates validation from deployment, generates a project-path build and publishes only static output. This project follows that structure, with pinned action revisions, Bun 1.4.5, Node 24, protocol tests, TypeScript checking and HTTP smoke checks for both root and project paths. This is a configuration review of the reference, not a hardware validation of that project.

## Local use

```powershell
bun install --frozen-lockfile
bun run dev
```

Open http://127.0.0.1:3000/. To check the actual static deployment:

```powershell
bun run typecheck
bun run test
bun run validate:static
$env:BASE_PATH='/vivamark-web-client-rnd/'
bun run build
bun run preview:dist
```

Open http://127.0.0.1:3001/vivamark-web-client-rnd/. Remove `BASE_PATH` from the environment to return to a root build. The build includes styles, stickers, `.nojekyll`, a 404 redirect and `version.json` with its commit and version. No Bun server is required on Pages. Artwork stays in browser storage; hosting the UI does not upload artwork to GitHub.

## Deployment

Select **Settings → Pages → Source → GitHub Actions** on the repository. A push to `main` or `master` or a manual Pages workflow run validates, builds and deploys `app/dist`. Pull requests run validation without deployment. Deployment uses the `github-pages` environment with Pages write and OIDC permissions, as described in [GitHub's custom workflow documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

Use Chrome or Edge with Web Bluetooth support. Pages provides HTTPS, but browser device selection and OS Bluetooth availability still apply. Publishing does not change the documented hardware and transfer validation boundaries.

## Publication boundary

The original R&D Git history contains APKs and native libraries. Do not push that history to the public repository. `bun tools/export-public.ts <new-empty-directory>` exports a curated working-tree snapshot with source, documentation and shared fixtures, excluding raw Android packages, extracted libraries, private radio captures, caches and decompiled/vendor trees. Initialize new Git history in that directory. Native fixture regeneration still requires the original local research inputs. The export does not modify the R&D checkout.
