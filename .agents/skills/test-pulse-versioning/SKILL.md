---
name: test-pulse-versioning
description: >-
  Semantic versioning rule and workflow for Test Pulse Suite. Use whenever making
  any UI, frontend, backend, or manifest change in jira-test-management to evaluate
  whether the change is small (PATCH), medium/feature (MINOR), or large (MAJOR) and
  update the version displayed in the Test Pulse status bar before building and deploying.
---

# Test Pulse Suite Status Bar Versioning

Whenever modifying **Test Pulse Suite** (`jira-test-management`), always evaluate the scope of the change and update the version displayed in the bottom status bar (`Test Pulse Suite vX.Y.Z © El Puerto de Liverpool`).

## 1. Evaluate the Magnitude of the Change (SemVer `MAJOR.MINOR.PATCH`)

- **Cambio pequeño (`PATCH` -> `X.Y.Z+1`)**:
  - Bug fixes, visual/CSS adjustments, label/text edits, alignment fixes, or small internal refactors.
- **Cambio mediano / Funcionalidad (`MINOR` -> `X.Y+1.0`)**:
  - New features, new UI components/tables/filters, new report sections, or functional improvements in existing modules.
- **Gran cambio (`MAJOR` -> `X+1.0.0`)**:
  - Brand-new modules, major architectural/storage redesigns, or complete UI overhauls.

## 2. Files to Synchronize

Always update the version in all of the following files before running `npm run build` and `forge deploy`:
1. `/Users/gbarbosam/jira-test-management/package.json` (`"version": "X.Y.Z"`)
2. `/Users/gbarbosam/jira-test-management/static/hello-world/package.json` (`"version": "X.Y.Z"`)
3. `/Users/gbarbosam/jira-test-management/static/hello-world/src/App.js` (`APP_VERSION` fallback string)
