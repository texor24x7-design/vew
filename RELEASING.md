# Releasing Vew

## One-time setup

1. Create the GitHub repository and set its `owner/repo` in `package.json` → `repository.url`
   (the updater reads it from there), then push this project to it.
2. Optional, when you have certificates: add these repository secrets (Settings → Secrets → Actions).

| Secret                                                     | What it is                                                                     |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `CSC_LINK`, `CSC_KEY_PASSWORD`                             | Apple **Developer ID Application** certificate (.p12, base64) and its password |
| `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` | For notarization                                                               |
| `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD`                     | Windows code-signing certificate (.pfx, base64) and its password               |

Without them releases still build: macOS apps are ad-hoc signed (users right-click → Open the first time,
and macOS won't auto-update them), Windows shows a SmartScreen warning.

## Cut a release

1. Bump `version` in `package.json` (e.g. `0.2.0`) and commit.
2. Tag and push: `git tag v0.2.0 && git push origin main v0.2.0`.
3. The **Release** workflow builds macOS (universal .dmg + .zip) and Windows (x64, arm64 and combined
   installers) and uploads them to a **draft** release. Check it, then click **Publish release**.
4. Installed copies of Vew find the update within 6 hours (or at next launch), download it in the
   background, and install it when quit; the menu also offers “Restart to Update”.

## Local builds

- `npm run dist:mac:unsigned` — universal .dmg in `dist/`, ad-hoc signed, for testing on any Mac.
- `npm run dist:mac` — signed, when a Developer ID certificate is in your keychain.
- `npm run dist:win` — Windows installers (cross-builds from macOS; unsigned).

Onboarding footage credits (CC BY) live in `resources/onboarding/CREDITS.md` and in About Vew.
