# Test Authentication Policy

## Decision

Do not introduce token-based authentication in this service.

## Reason

The current session-based authentication flow remains the security boundary for this test. Adding another authentication mechanism would increase security and maintenance risk.

## Alternative

Keep the existing session-based authentication flow.

## Impact

Authentication behavior remains unchanged.
