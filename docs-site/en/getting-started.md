<!-- +------------------------------------------------------------------+
     | SWAO -- Getting Started                                          |
     | Type: User Guide                                                 |
     | Version: Community Edition                                       |
     +------------------------------------------------------------------+ -->

---
title: Getting Started
---

# Getting Started

This guide walks you through setting up SWAO and running your first workload assessment.

## Prerequisites

Before you begin, ensure you have the following installed:

- **Node.js 20 or later** -- download from [nodejs.org](https://nodejs.org/)
- **pnpm** -- install with `npm install -g pnpm`

## Installation

Binary downloads for SWAO Community Edition are coming in Phase 2 of the release programme.
Check the [GitHub Releases page](https://github.com/Accenture/SWAO/releases) for the latest
availability updates.

In the meantime, you can run SWAO directly from source:

```bash
git clone https://github.com/Accenture/SWAO.git
cd SWAO
pnpm install
pnpm build
```

## Quick Start

Follow these five steps to complete your first assessment:

**Step 1 -- Initialise your workspace**

Create a workspace directory and initialise the SWAO configuration file:

```bash
mkdir my-assessment && cd my-assessment
swao init
```

This creates a `.swao.yml` file in the current directory. Edit it to point at your application
source and choose a compliance framework.

**Step 2 -- Verify your environment**

Run the diagnostics command to confirm that SWAO can reach all required dependencies:

```bash
swao doctor
```

Fix any issues flagged before proceeding.

**Step 3 -- Run an assessment**

Execute a compliance assessment against your configured application:

```bash
swao assess --app <name>
```

Replace `<name>` with the application identifier defined in your `.swao.yml`. SWAO will
analyse the source path and emit findings for each applicable control.

**Step 4 -- Open the HTML report**

After the assessment completes, open the generated HTML report in your browser:

```bash
swao report --open
```

The report contains every finding, its evidence link, and a summary by control domain.

**Step 5 -- Explore the interactive TUI**

For a live, navigable view of findings without leaving the terminal, run the assessment
in interactive mode:

```bash
swao assess --interactive
```

Use the arrow keys to navigate findings and press `q` to quit.

## Next Steps

- [CLI Reference](/en/reference/cli) -- full command and flag documentation
- [Configuration](/en/reference/configuration) -- all `.swao.yml` options explained
- [Frameworks](/en/frameworks/gdpr) -- supported compliance frameworks
