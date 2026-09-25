import { permanentRedirect } from 'next/navigation';
import { systemRoutes } from '@swisshub/shared';

export const dynamic = 'force-dynamic';

/**
 * Die alte Adresse der Selbstauskunft.
 *
 * Sie zeigte dieselbe Akte wie `/profil` heute - zwei Adressen, beide mit
 * dem Titel «Mein Profil», und die Seitenleiste fuehrte auf die andere.
 * Statt zwei Seiten zu pflegen, fuehrt diese jetzt dorthin.
 *
 * `permanentRedirect` und nicht geloescht: die Adresse steht in
 * Lesezeichen und in aelteren Discord-Nachrichten. Ein 404 waere fuer
 * niemanden eine Verbesserung.
 */
export default function AlteProfilAdresse(): never {
  permanentRedirect(systemRoutes.profil());
}
