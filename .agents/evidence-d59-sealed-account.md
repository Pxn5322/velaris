# D-59 sealed platform-owner account evidence

Status: **Template. Not evidence. D-59 remains Blocked.**
Date: [YYYY-MM-DD]
Owner: Operations owner
Reviewer: Product/security owner

The sealed account is a break-glass platform identity. This record covers custody, initial provisioning, use and the annual test. It does not create the account and does not approve production use.

Do not record passwords, TOTP secrets, recovery tokens or unsealed secret values in this file. Record only the secret location name, seal number and access record.

## 1. Account identity

| Item | Value |
| --- | --- |
| Application user id | [uuid] |
| Supabase subject | [uuid] |
| Dedicated email | [address] |
| Environment | [development, staging or production] |
| Account status | [active or disabled] |
| Normal use prohibited | [yes] |

## 2. People and quorum

| Role | Name | Alternate | Availability rule |
| --- | --- | --- | --- |
| Custodian A | [name] | [name] | [rule] |
| Custodian B | [name] | [name] | [rule] |
| Platform security owner | [name] | [name] | [rule] |
| Second platform owner | [name] | [name] | [rule] |

Quorum decision:

- [ ] Two custodians plus the security owner.
- [ ] Two custodians plus two distinct platform owners. Use this option only if at least four named, available people exist.
- Conflict-of-interest rule: [rule]

## 3. Storage and seals

| Part | Custodian | Storage location | Seal id | Last rotation |
| --- | --- | --- | --- | --- |
| Part A | [name] | [location] | [id] | [YYYY-MM-DD] |
| Part B | [name] | [location] | [id] | [YYYY-MM-DD] |

- No single custodian can reconstruct the material.
- Access register location: [path or system]
- Last register review: [YYYY-MM-DD]
- Next review: [YYYY-MM-DD]

## 4. Initial provisioning

| Step | Result | Evidence |
| --- | --- | --- |
| Account created | [ ] pass [ ] fail | [reference] |
| Dedicated mailbox controlled | [ ] pass [ ] fail | [reference] |
| First TOTP factor enrolled | [ ] pass [ ] fail | [factor id only] |
| Recovery email tested | [ ] pass [ ] fail | [reference] |
| Initial sessions revoked | [ ] pass [ ] fail | [request id] |
| Material split and sealed | [ ] pass [ ] fail | [seal ids] |
| Ceremony recorded | [ ] pass [ ] fail | [record id] |

Participants: [names]
Date: [YYYY-MM-DD]
The seven-day enrollment grace does not apply to this account.

## 5. Use record

Complete one record for each use.

| Item | Value |
| --- | --- |
| Incident id | [id] |
| Date and time | [YYYY-MM-DD HH:MM UTC] |
| Reason | [reason] |
| Normal owner unavailable | [name and reason] |
| Approvers | [names] |
| Custodians present | [names] |
| Seal ids opened | [ids] |
| Actions performed | [list] |
| Audit event ids | [ids] |
| Sessions revoked | [ ] yes [ ] no |
| Password rotated | [ ] yes [ ] no |
| TOTP factor rotated | [ ] yes [ ] no |
| Material re-sealed | [ ] yes [ ] no |
| New seal ids | [ids] |
| Post-incident review owner | [name] |
| Post-incident review due | [YYYY-MM-DD] |

## 6. Annual test

| Item | Value |
| --- | --- |
| Test date | [YYYY-MM] |
| Owner | Operations owner |
| Method | [ ] Tabletop [ ] Read-only sign-in |
| Participants | [names] |
| Material retrievable | [ ] pass [ ] fail |
| Seal records match | [ ] pass [ ] fail |
| Procedure current | [ ] pass [ ] fail |
| Sign-in revoked immediately | [ ] yes [ ] no [ ] not applicable |
| Result | [pass or fail] |
| Follow-up actions | [list] |

The first planned test is November 2027. A production write is not permitted during the test.

## 7. Successor and re-seal record

| Date | Change | Old custodian | New custodian | Re-sealed | Evidence |
| --- | --- | --- | --- | --- | --- |
| [YYYY-MM-DD] | [custodian change or rotation] | [name] | [name] | [ ] yes [ ] no | [reference] |

A custodian change requires re-sealing within five business days.

## 8. Evidence checklist

- [ ] Account identity and dedicated mailbox recorded.
- [ ] Custodians, successors and approvers named.
- [ ] Quorum selected and available.
- [ ] Storage locations and seal ids recorded.
- [ ] Initial provisioning completed.
- [ ] Use record completed for every use.
- [ ] Annual test completed and signed.
- [ ] Incident record linked to audit event ids.
- [ ] No secret value appears in this file.

## 9. Sign-off

| Role | Name | Decision | Date | Reference |
| --- | --- | --- | --- | --- |
| Operations owner | [name] | [ ] Accepted [ ] Rejected | [YYYY-MM-DD] | [ticket] |
| Product/security owner | [name] | [ ] Accepted [ ] Rejected | [YYYY-MM-DD] | [ticket] |
