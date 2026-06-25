---
title: Mitwirken
---
<!-- +------------------------------------------------------------------+
     | SWAO -- Community Edition                                        |
     +------------------------------------------------------------------+ -->


# Mitwirken

Vielen Dank fuer Ihr Interesse an einem Beitrag zu SWAO. Alle Beitraege sind willkommen und
werden geschaetzt. Bitte lesen Sie die vollstaendige
[CONTRIBUTING.md](https://github.com/Accenture/SWAO/blob/main/CONTRIBUTING.md) im
Repository-Stammverzeichnis, bevor Sie etwas einreichen.

## Framework-Beitraege

Der schnellste Weg, einen Beitrag zu leisten, ist das Hinzufuegen eines Compliance-Frameworks.
Frameworks werden ausschliesslich in YAML definiert -- kein TypeScript erforderlich.
So steuern Sie ein neues Framework bei:

1. Erstellen Sie ein Verzeichnis unter `docs/custom-frameworks/<ihr-framework-slug>/`.
2. Fuegen Sie eine `framework-meta.yaml`-Datei mit Name, Version und Anwendungsbereich des
   Frameworks hinzu.
3. Fuegen Sie eine `controls.yaml`-Datei hinzu, die die zu pruefenden Kontrollen auflistet.
4. Eroeffnen Sie einen Pull Request mit einer kurzen Beschreibung des Frameworks und seines
   Anwendungsbereichs.

Als Referenz koennen Sie ein vorhandenes Framework wie `docs/custom-frameworks/gdpr/` ansehen.

## Fehlermeldungen

Wenn Sie unerwartetes Verhalten beobachten, eroeffnen Sie bitte
[ein Issue](https://github.com/Accenture/SWAO/issues/new?template=bug_report.md) auf GitHub.
Geben Sie dabei an:

- SWAO-Version (`swao --version`)
- Betriebssystem und Node.js-Version
- Schritte zur Reproduktion
- Erwartetes und tatsaechliches Verhalten
- Relevante Log-Ausgaben (persoenliche oder vertrauliche Daten schwaarzen)

## Feature-Anfragen und Diskussionen

Fuer Ideen, Fragen oder allgemeine Diskussionen nutzen Sie das
[GitHub-Discussions](https://github.com/Accenture/SWAO/discussions)-Board. Pruefen Sie
vor dem Erstellen eines neuen Threads, ob Ihr Thema bereits besprochen wird.

## Verhaltenskodex

Alle Mitwirkenden sind verpflichtet, den
[Verhaltenskodex](https://github.com/Accenture/SWAO/blob/main/CODE_OF_CONDUCT.md) des
Projekts einzuhalten.
