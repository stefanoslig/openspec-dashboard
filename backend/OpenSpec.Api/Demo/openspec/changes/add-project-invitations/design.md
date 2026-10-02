# Invitation design

## Approach

Keep invitations separate from membership until the invited person accepts. Store a hash of each token and validate it on the server.

## Invitation lifecycle

```text
Created → Email sent → Accepted → Member added
               └──→ Expired or revoked
```

## Decisions

### One active invitation per person

Sending another invitation replaces the previous token. This prevents an old email from granting unexpected access.

### Membership is created atomically

Accepting an invitation and creating membership happen in one transaction. A retry returns the existing membership.

## Open questions

Should project owners be notified when a teammate accepts? This can be decided independently of the initial release.
