# Audit-Bewertung

::: warning Demnachst verfuegbar
Die Audit-Bewertung befindet sich auf der Roadmap. Die folgende Beschreibung spiegelt die
geplante Funktionalitaet wider.
:::

Die Audit-Bewertung unterstuetzt beratergeleitete Compliance-Pruefungen, bei denen kein
Anwendungsquellcode verfuegbar ist. Ein Berater erfasst Befunde aus Interviews,
Dokumentenpruefungen und Vor-Ort-Inspektionen mithilfe strukturierter Checklisten. SWAO
erstellt ein deterministisches Compliance-Urteil ohne jegliche LLM-Verarbeitung.

**Geplante CLI:** `swao audit init` / `swao assess --type audit`

**TUI:** Hauptmenue > Bewertung durchfuehren > [2] Audit-Bewertung (demnachst)

---

## Erwartete Ergebnisse

| Ausgabe | Inhalt |
|---|---|
| Compliance-Urteil | Jede Framework-Steuerung: SATISFIED / GAP / PARTIAL / NOT ASSESSED |
| Evidenzprotokoll | Dokumente, Interview-Notizen und Vor-Ort-Befunde, pro Steuerung attributiert |
| Pruefbericht | Vollstaendiger Markdown-Bericht geeignet fuer die regulatorische Einreichung |

---

## Geplante Funktionsweise

1. **Initialisieren** -- `swao audit init` erstellt die Checklistenstruktur in
   `wsp/inputs/audit/` basierend auf den aktiven Compliance-Frameworks.
2. **Checklisten ausfuellen** -- der Berater erfasst Befunde direkt in den YAML-Checklistendateien
   oder ueber ein gefuehrtes TUI-Formular.
3. **Evidenz anhaengen** -- PDFs, DOCXs und Screenshots werden in `wsp/inputs/audit/evidence/`
   abgelegt und in den Checklisteneintraegen referenziert.
4. **Ausfuehren** -- `swao assess --type audit` liest die ausgefuellten Checklisten und
   Evidenz, bewertet jede Steuerung deterministisch und generiert das Ausgabepaket.

Kein LLM erforderlich -- dies ist ein vollstaendig offline, deterministischer
Bewertungspfad, der fuer stark regulierte Umgebungen konzipiert ist, in denen der
LLM-Einsatz eingeschraenkt ist.
