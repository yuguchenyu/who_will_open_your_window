# Qwen Portraits Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Switch local emotion portrait generation to Qwen while keeping the existing preview and save workflow.

**Architecture:** Select the Qwen JSON adapter by image model name, download its returned image on the server, then use the existing PNG and job lifecycle. Explicit legacy models retain their existing adapter.

**Tech Stack:** Node.js built-in fetch, node:test, SQLite, existing PNG codec; no new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-02-qwen-portraits-design.md`

## Global Constraints

- Keep all work local; no commits or pushes.
- No credentials in tracked files, logs, or browser responses.
- Default image model: `qwen-image-2.1-pro` (available to the local credential).
- Retain existing consent, quotas, private previews, stale checks, and alpha verification.
- Use one 180-second timeout across generation and download; no automatic retries.
- Download only public HTTPS OSS bucket subdomains of `aliyuncs.com`, rejecting internal endpoints, credentials, custom ports, redirects, and Authorization headers; cap PNG responses at 12 MB.

## Review Focus

- Returned URLs must not allow internal requests or credential forwarding.
- Unknown lengths and redirect responses must not bypass download bounds.
- Opaque or corrupt output must not replace an existing portrait.
- Download timeouts must release the task and global concurrency slot.
- Existing explicit legacy image configurations must keep working.

## Task 1: Adapter and defaults

**Files:** `lib/portrait-generation.mjs`, `server.mjs`, `tests/qwen-portrait-generation.test.mjs`, existing portrait test fixtures.

**Interfaces:** Preserve `createPortraitGeneration(db, config, {fetchImpl, timeout})`; continue returning the same public job state and PNG previews.

- [x] Add Qwen request/download tests and observe the expected failures.
- [x] Add JSON generation, validated bounded download, and Qwen defaults; preserve the legacy branch.
- [x] Run targeted portrait and server tests; verify failures are resolved.

## Task 2: Local configuration and presentation

**Files:** `.env` (ignored), `.env.example`, `README.md`, `public/app.mjs`.

**Interfaces:** Existing `AI_IMAGE_BASE_URL`, `AI_IMAGE_API_KEY`, `AI_IMAGE_MODEL` remain the local connection settings.

- [x] Replace local image key with the current local Qwen text credential and select the native DashScope image base and model.
- [x] Update the image description and safe example configuration.
- [x] Confirm text settings and unrelated local settings are preserved.

## Task 3: Verification and local service

- [x] Run `npm test` and the existing portrait browser smoke test where available.
- [x] Generate one real transparent emotion portrait from a bundled fictional character, using the job service with an in-memory database.
- [x] Review the final change with a fresh agent, resolve actionable findings, and repeat affected tests.
- [x] Restart the current project service and verify the local status/login endpoints.
- [x] Report the model, test evidence, real output result, and that nothing was committed or pushed.

## Verification record

- Baseline: 119 tests passed. Qwen contract tests initially failed against the multipart adapter, then passed after implementation.
- Native protocol and typed-array Base64 handling were verified with regression tests. Returned internal OSS and unrelated service URLs were rejected after a review finding and a failing regression test.
- Full suite: 140 tests passed. Browser smoke test passed with native Qwen generation/download fixtures.
- Real native `qwen-image-2.1-pro` generation and download returned HTTP 200; 30.7 seconds, 808×1760, 1.65 MB, alpha validated, private preview followed by explicit save verified in an in-memory database.
- Account model discovery lists 2.1 Pro, not Turbo; local image base is explicitly `https://dashscope.aliyuncs.com/api/v1`. Other deployments using the old compatible text base must likewise explicitly configure their native image base.
