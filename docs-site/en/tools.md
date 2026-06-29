# Tools

The Tools screen provides access to utilities that support the SWAO workspace rather than
running assessments directly. These are configuration, licensing, and diagnostic functions
you use to keep the workspace current and troubleshoot issues.

Access from the TUI main menu by pressing **9**.

---

## Available tools

### Lenses

Lenses are reusable viewpoints that filter the signal and compliance view to a specific
angle: regulatory, architectural, or persona-based.

Examples:

| Lens | What it filters |
|---|---|
| GDPR / DPO | Data-residency and data-handling controls only |
| Financial Services | DORA, MAS TRM, and SOX-relevant controls |
| Security Architect | All security-related signals across all passes |
| Migration Lead | 7R migration signals and landing zone signals only |

Apply a lens from the Tools screen to change which signals appear in the publication and
the auditor report without rerunning the assessment. Lenses do not change the underlying
signal set -- they change the view.

---

### Licence

The Licence tool shows:

- Current edition (Community / Consultant / Enterprise)
- Licence key status and expiry
- Features enabled by the current licence

To activate or update a licence key:

```
swao tools license --key <your-key>
```

If you are running Community edition and need to trial Enterprise features, contact
your Accenture engagement sponsor or raise a request via the SWAO service catalogue.

---

### Credentials

Credentials manages the secrets SWAO uses to call external services:

| Credential | Used for |
|---|---|
| LLM provider API key | Application and LLM assessment passes |
| VCS token | Cloning private repositories for assessment |
| Container registry token | Pulling images for container pass analysis |
| CMDB / ServiceNow token | Context ingestion from ITSM sources |

Credentials are stored encrypted in the workspace secrets store (`wsp/.secrets/`), never
in `.swao.yml` or any tracked file. The health check confirms each credential is present
and the target service responds before you start an assessment.

To set a credential:

```
swao tools credentials --set llm-api-key
```

SWAO prompts for the value interactively so it does not appear in shell history.

---

### Help

Opens the in-context help for any SWAO command or screen. You can also access help
directly from the command line:

```
swao help
swao help assess
swao help publish
```

For the full product documentation, visit the [SWAO project documentation](https://github.com/Accenture/SWAO).
