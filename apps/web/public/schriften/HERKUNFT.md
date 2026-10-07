# Inter – Schriftschnitte für den Post-Export

Drei statische Schnitte der Schrift **Inter** (Regular 400, SemiBold 600,
ExtraBold 800), bezogen von Google Fonts (`fonts.gstatic.com`, Inter v20).

## Warum sie hier liegen und nicht nachgeladen werden

`next/og` bringt genau eine Schriftdatei mit – `noto-sans-v27-latin-regular.ttf`,
nur Schnitt 400. Ohne eigene Schnitte wird jedes `fontWeight: 700` oder `800`
im gerenderten PNG **stillschweigend ignoriert**: der Export sieht dann exakt
aus wie derselbe Text in Normalschrift. Eine Überschrift unterscheidet sich von
ihrem Fliesstext dann nur noch durch die Grösse, und genau das lässt eine
Grafik beliebig wirken.

Nachladen zur Laufzeit wäre die schlechtere Lösung: der Export hinge an einem
fremden Server, der antworten muss, während jemand auf eine Datei wartet – und
der Produktionsserver hat bewusst keinen freien Ausgang ins Netz.

## Warum die vollständigen Dateien und kein Subset

Ein auf Latein beschnittener Satz wäre rund ein Viertel so gross. Er hätte aber
eine Lücke, die erst im fertigen Export auffällt: ein Teamname in kyrillischer
oder griechischer Schrift würde als leeres Kästchen gesetzt. Rund ein Megabyte
einmalig im Repository ist der ruhigere Weg.

## Lizenz

SIL Open Font License 1.1 – siehe `OFL.txt`. Die Weitergabe der Dateien als
Teil dieses Repositories ist davon ausdrücklich gedeckt; die Lizenzdatei muss
dabei beiliegen, deshalb liegt sie hier.
