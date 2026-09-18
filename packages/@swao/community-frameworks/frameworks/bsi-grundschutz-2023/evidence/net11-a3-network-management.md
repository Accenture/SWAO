---
control_id: BSI_NET11_A3
framework_id: BSI_GRUNDSCHUTZ_2023
collected_at: 2026-07-08
collected_by: assessor
classification: client-internal
---

# Secure Network Management Access (NET.1.1.A3) -- evidence template

## Purpose

Management access to network equipment must be restricted to a dedicated out-of-band management network or hardened jump host; remote management must use encrypted protocols with multi-factor authentication; all management-plane access must be logged.

## Evidence required

- Jump host or management network configuration evidence showing network equipment is accessible only via the dedicated management path
- Evidence that Telnet and other unencrypted management protocols are disabled on all network equipment, such as device configuration extracts
- MFA configuration for remote network management access, showing all administrative accounts require a second factor
- Management-plane access log samples showing individual account attribution and timestamps for a recent period
- Periodic review records for management-plane access, confirming unused accounts are removed and access remains appropriate

## Reference

https://www.bsi.bund.de/dok/NET-1-1
