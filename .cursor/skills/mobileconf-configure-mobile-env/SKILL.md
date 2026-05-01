---
name: mobileconf-configure-mobile-env
description: Configure THEONE mobile app to work with local, stage, or prod backend and align EAS build profiles for testing (TestFlight/internal) and public release. Use when the user asks to "configure mobile to work with <env>" where env is local, stage, or prod.
---

# MobileConf Configure Mobile Env

## Purpose
Apply a complete mobile environment configuration for THEONE when the user asks:

- `configure mobile to work with local`
- `configure mobile to work with stage`
- `configure mobile to work with prod`

Scope includes:
- API target selection in mobile config
- EAS build profile alignment
- Operator run commands for testing and release

## Repo Paths
- Mobile root: `/Users/sagivdaniel/Documents/THEONE/mobile`
- Key files:
  - `/Users/sagivdaniel/Documents/THEONE/mobile/src/config/apiConfig.js`
  - `/Users/sagivdaniel/Documents/THEONE/mobile/eas.json`
  - `/Users/sagivdaniel/Documents/THEONE/mobile/app.json`
  - `/Users/sagivdaniel/Documents/THEONE/mobile/src/api/client.js`

## Required Behavior
1. Parse target env from user request: `local`, `stage`, or `prod`.
2. Configure API base resolution so requested env is selected deterministically.
3. Keep stage URL as `https://stage.the1.vip/v1`.
4. Keep prod URL as `https://app.the1.vip/v1`.
5. Ensure build profiles fit target usage:
   - internal/TestFlight QA -> stage profile (`preview` or equivalent internal profile)
   - public publish -> production profile only
6. For `prod` requests, enforce production release profile for store/public distribution.
7. Print or document exact commands the user should run after configuration.

## Execution Workflow
1. Inspect current state in `eas.json` and `apiConfig.js`.
2. Identify if production runtime is hardcoded to stage; remove ambiguity.
3. Apply explicit env mapping strategy:
   - Dev/local path can remain device-aware for localhost/IP.
   - Stage and prod must have explicit URL sources (env-first, safe fallback).
4. Verify no accidental stage-in-production release path remains.
5. Provide an operator checklist with exact commands:
   - local dev run
   - stage build commands
   - prod build commands
   - optional submit commands

## Output Requirements
When done, always report:
- Final API target for requested env
- Which EAS profile to use for TestFlight/internal QA
- Which EAS profile to use for public release
- One-line safety warning if production profile still points to stage

## Guardrails
- Do not change unrelated mobile screens or business logic.
- Keep changes limited to env/config/build files unless user asks otherwise.
- Keep URLs normalized with `/v1`.
- Prefer explicit env variables over implicit defaults.
