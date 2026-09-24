/**
 * Der Spielekatalog.
 *
 * Eine Liste fuer alle Module, die Spiele kennen: Turniere, Clips, «Was
 * spielen wir?» und die Mitgliederakte. Kein Modul im Sinne der Registry -
 * es gibt keinen Schalter dafuer, weil eine leere Liste kein Zustand ist,
 * den man einschalten koennte.
 *
 * Gepflegt wird er unter «Was spielen wir?»; dieser Teil weiss davon nichts.
 */
export * from './config';
export * from './katalog';
export * from './nutzung';
export * from './schemas';
export * from './verwaltung';
