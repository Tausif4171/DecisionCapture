# Test Session-to-Token Authentication Policy

## Decision

Replace the existing session-based authentication flow with token-based authentication for API requests.

## Reason

This documentation-only fixture evaluates whether token-based authentication should replace the current session-based security boundary.

## Alternative

Keep the existing session-based authentication flow.

## Impact

Authentication behavior would change and requires security review.

## Verification

- This is a documentation-only conflict test fixture.
- No runtime authentication code changes are included.
- Keep the pull request open for conflict review lifecycle testing.
