---
control_id: BSI_SYS11_A1
framework_id: BSI_GRUNDSCHUTZ_2023
collected_at: 2026-07-08
collected_by: assessor
classification: client-internal
---

# Physical and Logical Access Restrictions for Servers (SYS.1.1.A1) -- evidence template

## Purpose

Physical access to server hardware must be restricted to authorised personnel; logical access must be restricted to named administrators; server consoles and management interfaces must be accessible only from defined management networks and access must be logged.

## Evidence required

- Physical access control records for server locations, such as access logs or electronic badge entry records showing only authorised individuals gained entry
- Management network or VLAN configuration restricting server console and out-of-band management interface access to defined administrative subnets
- Evidence that interactive login with shared accounts is prohibited, such as an account policy extract or configuration showing shared accounts are disabled on servers
- Access log samples showing management-plane access with individual user attribution for a recent period
- Evidence that console or out-of-band management interfaces are inaccessible from general user networks, such as firewall rules or network segmentation documentation

## Reference

https://www.bsi.bund.de/dok/SYS-1-1
