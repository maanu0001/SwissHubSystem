/**
 * Mitgliederprofile.
 *
 * Kein Modul im Sinne der Registry: es gibt keinen Schalter dafuer. Ein
 * Profil hat jedes Mitglied, so wie jedes Mitglied einen Namen hat - «Mein
 * Profil» darf nicht davon abhaengen, ob jemand ein Modul eingeschaltet hat
 * oder eine Verwaltungsberechtigung besitzt.
 *
 * Was hier **nicht** liegt: der Discord-Spiegel (`discord/member-sync.ts`),
 * das XP-System (`level/`), der Spielekatalog (`games/`) und die
 * Mitgliedsakte der Moderation (`members/`). Diese Dateien lesen daraus,
 * doppeln aber nichts davon.
 */
export * from './angaben';
export * from './auszeichnungen';
export * from './bearbeiten';
export * from './entdecken';
export * from './gestaltung';
export * from './schemas';
export * from './service';
export * from './showcase';
export * from './socials';
export * from './spielfelder';
