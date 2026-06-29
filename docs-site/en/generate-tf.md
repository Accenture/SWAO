# Generate TF Modules

Generate TF Modules produces ready-to-apply Terraform modules from the assessment results.
When the assessment finds that a control is not satisfied, SWAO can generate the Terraform
code that would bring the environment into compliance -- turning findings into infrastructure
as code in one step.

Access from the TUI main menu by pressing **8**.

---

## What it does

After an Application or Landing Zone assessment, SWAO maps each unsatisfied control to a
curated library of Terraform modules. For each matching module, it generates:

- A configured `.tf` file with values pre-filled from the application context (app ID,
  cloud region, resource names, tags).
- A `variables.tf` block for any values that must be supplied at apply time.
- A `README.md` per module describing what it remediates and how to apply it.

The output lands in `apps/<id>/wsp/tf/<timestamp>/` and is structured so it can be applied
directly or imported into an existing Terraform root module.

---

## Supported providers

| Provider | Coverage |
|---|---|
| AWS | IAM, S3, KMS, CloudTrail, Config, Security Hub, WAF, VPC flow logs |
| Azure | RBAC, Key Vault, Storage account policies, Defender for Cloud, NSG, Monitor |
| GCP | IAM, Cloud Audit Logs, VPC Service Controls, Security Command Center |

Coverage grows with each release. Controls without a matching module are listed in a
`remediation-gaps.md` file so you know which findings still require manual work.

---

## Applying the modules

```bash
cd apps/<id>/wsp/tf/<timestamp>
terraform init
terraform plan
terraform apply
```

Review the plan output carefully before applying. The generated modules use sensible
defaults but your environment may have constraints -- naming conventions, tag requirements,
or existing resources -- that require adjustment before apply.

---

## Re-running after apply

Once you have applied the generated modules, run the assessment again. Compliance controls
that were previously GAP should now show SATISFIED if the Terraform configuration is
correct and the environment has converged.

This closes the loop between assessment findings and infrastructure remediation without
manual tracking.

---

::: tip Enterprise feature
Module generation from LLM and Hybrid assessments, including generation from audit-derived
findings, is an Enterprise edition feature.
:::
