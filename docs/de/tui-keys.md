# Tasten in der Terminal-Oberfläche

Jeder Bildschirm der SWAO-Terminal-Oberfläche (`swao menu`) verwendet dieselben Tasten. Die Zeile mit den Tastenhinweisen über dem Hilfekasten zeigt die Tasten, die auf dem aktuellen Bildschirm gelten.

## Tasten

Die Tasten heißen hier so wie in den Tastenhinweisen der Oberfläche, die englisch ist. Auf einer deutschen Tastatur ist Ctrl die Taste Strg, Shift die Umschalttaste, Space die Leertaste, und PgUp und PgDn sind Bild↑ und Bild↓.

| Taste | Was sie tut | Wo sie gilt |
|---|---|---|
| Enter | Weiter: bestätigt den Schritt und geht zum nächsten; außerdem bestätigen, öffnen, auswählen | Jeder Bildschirm |
| ↑ ↓ | Bewegt den Cursor | Listen und Menüs |
| ← | Zurück zum vorherigen Schritt; die Eingaben bleiben erhalten | Listen, Zusammenfassungen, Bestätigungen und Ergebnisbildschirme |
| Shift+Tab | Zurück zum vorherigen Schritt; die Eingaben bleiben erhalten | In einem Textfeld, in dem ← den Textcursor bewegt |
| → | Vor zu einem Schritt, der in diesem Durchlauf schon abgeschlossen ist | Schrittfolgen (nicht im Setup-Assistenten: dort schließt Enter einen Schritt ab) |
| Space | Wählt einen Eintrag aus oder ab | Listen mit Mehrfachauswahl |
| Esc | Verlässt den Ablauf und öffnet das Hauptmenü; bricht einen laufenden Vorgang ab | Jeder Bildschirm |
| Ctrl+G | Öffnet oder schließt den Hilfekasten | Jeder Bildschirm mit Hilfekasten |
| PgUp PgDn | Blättert im Hilfekasten oder in einer langen Liste | Wenn er mehr als eine Seite hat |
| 1 bis 9 | Wählt einen nummerierten Eintrag | Nur in Listen, die Nummern zeigen |
| Buchstaben | Nur wenn ein sichtbarer Menüeintrag oder die Tastenhinweise den Buchstaben nennen | Selten |
| Ctrl+C | Fragt, ob SWAO beendet werden soll; ein zweites Ctrl+C innerhalb von 2 Sekunden beendet SWAO | Jeder Bildschirm |

## Was Esc tut, in dieser Reihenfolge

Ein Druck auf Esc tut genau eine Sache, in dieser Reihenfolge:

1. Ein offener Hilfekasten wird geschlossen.
2. Eine offene Abbruchfrage wird geschlossen, und Sie bleiben auf dem Bildschirm.
3. Ein laufender Vorgang (Bewertung, Aktualisierung, Recherche, Prüfung) wird abgebrochen. Bei langen Läufen fragt SWAO zuerst; die bisherigen Ergebnisse bleiben als abgebrochener Lauf erhalten.
4. Sonst endet der Ablauf, und das Hauptmenü öffnet sich. Enthält der Ablauf noch nicht gespeicherte Eingaben, fragt SWAO zuerst.

Esc überspringt nie einen Schritt. Ein optionaler Schritt hat „Skip this step“ als letzten Eintrag seiner Liste.

## Die Tastenhinweise je Bildschirm

| Bildschirm | Tastenhinweise |
|---|---|
| Menü | `↑↓ select   Enter open   Esc abort` |
| Auswahlliste in einem Ablauf | `↑↓ select   Enter next   ← back   Esc abort` |
| Mehrfachauswahl in einem Ablauf | `↑↓ select   Space toggle   Enter next   ← back   Esc abort` |
| Textfeld in einem Ablauf | `Enter next   Shift+Tab back   Esc abort` |
| Bestätigung | `Enter confirm   ← back   Esc abort` |
| Laufender Vorgang | `Esc cancel` |
| Letzter Schritt oder Abschlussbildschirm | `↑↓ select   Enter finish   Esc abort` |
| Abbruchfrage | `Enter abort   Esc stay` |

## Tipps

- Pfeiltasten, Zifferntasten, Space und Enter funktionieren auch bei geöffnetem Hilfekasten; der Kasten folgt dem markierten Eintrag.
- Eine lange Liste scrollt mit ↑ und ↓ und blättert mit PgUp und PgDn. Das Mausrad scrollt das Terminalfenster, nicht die Liste.
- Eingefügter Text gelangt als ein Stück in das Eingabefeld; im Chat sendet ein eingefügter Zeilenumbruch die Nachricht nicht.

Siehe auch: [Werkzeuge](/de/tools) | [Workspace-Setup](/de/workspace-setup)
