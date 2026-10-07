import type { NextRequest } from 'next/server';
import { AppError } from '@swisshub/shared';

/**
 * Das Formular einer Upload-Anfrage - mit einer Meldung, die stimmt.
 *
 * ## Warum das nicht einfach `request.formData()` ist
 *
 * Weil `formData()` bei einer zu grossen Datei nicht sagt, dass sie zu gross
 * ist. Es wirft `TypeError: Failed to parse body as FormData`, und das ist
 * sachlich richtig: der Koerper war wirklich kein gueltiges Multipart mehr.
 * Abgeschnitten hat ihn aber eine Schicht darueber - Next klont den Koerper
 * fuer die Middleware und kappt ihn bei `middlewareClientMaxBodySize`, oder
 * der Reverse Proxy bricht bei `client_max_body_size` ab.
 *
 * Aus dem `TypeError` wird ohne diese Stelle ein `INTERNAL` und daraus
 * «Aktion konnte nicht ausgefuehrt werden. Bitte versuche es spaeter
 * erneut.» - gemessen am gebauten Server mit einer 11,4 MB grossen PNG. Das
 * ist die Meldung, die jemanden die Datei dreimal neu exportieren laesst,
 * ohne dass er je erfaehrt, dass es an der Groesse lag.
 *
 * ## Was sie nicht tut
 *
 * Sie prueft nicht die Groesse. Das tut `storeLogoUpload` an den echten
 * Bytes und mit der Grenze des jeweiligen Namensraums. Hier wird nur ein
 * Fehler uebersetzt, der sonst stumm bliebe - und zwar in die Richtung, die
 * stimmt: wenn das Parsen scheitert, war der Koerper unvollstaendig, und
 * unvollstaendig wird er in der Praxis durch seine Groesse.
 */
export async function leseFormular(request: NextRequest, maxMb: number): Promise<FormData> {
  try {
    return await request.formData();
  } catch (error) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: `Die Datei ist zu gross. Maximal erlaubt: ${maxMb} MB.`,
      internalMessage: `formData() gescheitert: ${(error as Error).message}`,
    });
  }
}
