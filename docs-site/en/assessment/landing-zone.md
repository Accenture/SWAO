# Landing Zone Assessment

Landing Zone Assessment evaluates your cloud infrastructure configuration against the
sovereignty requirements derived from your active compliance frameworks. It fetches the
live service catalogue from your cloud provider and produces a structured fit/gap report
showing which services and configurations meet the sovereign requirements and which do not.

**CLI:** `swao assess --type landing-zone`

**TUI:** Main Menu > Run Assessment > [3] Landing Zone Assessment

---

## What it produces

| Output | What it contains |
|---|---|
| Fit/gap report | Every landing zone control with COMPLIANT / GAP / PARTIAL status |
| Service catalogue snapshot | The cloud provider's sovereign service list at assessment time |
| Signal set | Structured findings mapped to compliance framework controls |
| BI export | Star schema entries for the portfolio Power BI dashboard |

---

## Supported cloud providers

Landing Zone Assessment connects to the cloud provider service catalogue to validate
which services are available in the sovereign region. Supported providers:

- **AWS** -- sovereign and restricted regions
- **Azure** -- sovereign cloud and commercial regions with data-residency guarantees

---

## Inputs required

Before running a Landing Zone Assessment, place your landing zone snapshot in the workspace:

- **IaC state file** -- Terraform state (`terraform.tfstate`) or CloudFormation template
- **CSP configuration export** -- AWS Config snapshot or Azure Resource Graph export
- **Network topology** (optional) -- subnet, VPC, or VNET configuration for traffic-flow analysis

SWAO reads these from `wsp/inputs/landing-zone/`. If the folder is absent or empty, SWAO
uses the active compliance framework controls alone to generate a guidance-only report
without a configuration-specific verdict.

---

## How scoring works

Each landing zone control maps to one or more framework requirements. SWAO compares the
control's expected configuration against what it finds in your IaC or configuration snapshot:

- **COMPLIANT** -- the configuration meets the sovereignty requirement.
- **PARTIAL** -- partially configured; specific gaps are documented.
- **GAP** -- the requirement is not met; remediation guidance is included.
- **NOT ASSESSED** -- insufficient configuration data to evaluate this control.

The report groups findings by framework domain so a compliance reviewer can work through
the gaps systematically.
