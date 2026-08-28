---
control_id: BSI_NET11_A1
framework_id: BSI_GRUNDSCHUTZ_2023
collected_at: 2026-07-07
collected_by: consultant
classification: client-internal
---

# Network Architecture Requirements (NET.1.1.A1) -- consultant-furnished context

## Verdict (consultant-asserted)

outcome: PARTIAL
severity: high
rationale: >-
  The workload uses cloud-provider virtual networking (VPCs / virtual networks)
  with separate subnets for application and data tiers, and a managed ingress
  controller for public traffic. This represents a de facto network zone
  separation, but no formal network architecture concept document exists.
  Trust boundaries and permitted traffic flows between zones are not documented;
  the security group and firewall rules were set during initial deployment and
  have not been reviewed since. The principle of need-to-connect is not
  explicitly applied to rule authoring -- several overly permissive rules were
  noted during the technical walk-through. No process exists to keep the
  network architecture documentation current as the infrastructure evolves.

## Network architecture register

| Requirement | Current state | Gap |
| --- | --- | --- |
| Network architecture concept document | None | Yes |
| Network zones defined and documented | Implicit in cloud config | Partial |
| Trust boundaries documented | Not documented | Yes |
| Permitted traffic flows documented | Not documented | Yes |
| Need-to-connect principle applied to rules | Not explicitly applied | Yes |
| Security group / firewall rules reviewed | Not reviewed post-setup | Yes |
| Process to keep architecture documentation current | None | Yes |
| Placement of security controls (firewalls, proxies) | Managed ingress only | Partial |

## Counter-hypothesis considered

Considered whether the cloud-provider VPC topology and subnet separation
implicitly satisfies the network architecture requirement. Accepted as a
partial compensating control: the physical zone separation exists. However,
the absence of documentation, the unreviewed rule set, and the missing
need-to-connect analysis mean the control is PARTIAL rather than SATISFIED.

## Auditor notes

(empty)
