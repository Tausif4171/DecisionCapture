# Test Authentication Policy Proposal

## Decision

Replace the existing session-based authentication with token-based authentication for this service.

## Reason

The API should authenticate requests with token-based authentication instead of the current session-based flow.

## Alternative

Keep the existing session-based authentication flow.

## Impact

Authentication behavior would change and requires security review.

This document remains a documentation-only test fixture and does not change runtime authentication.

## Test maintenance

This follow-up refreshes the fixture for conflict-scan verification only; runtime authentication remains unchanged.

The fixture remains intentionally unmerged until the advisory warning workflow is verified.
