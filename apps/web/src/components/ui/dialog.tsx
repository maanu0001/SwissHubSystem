'use client';

import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogPortal = DialogPrimitive.Portal;
const DialogClose = DialogPrimitive.Close;

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      'fixed inset-0 z-50 bg-black/70 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
      className,
    )}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

/**
 * Wo der Dialog steht - und wie er dorthin kommt.
 *
 * ## Warum das eine benannte Entscheidung ist und keine Klassenliste
 *
 * Es gab hier lange nur eine Geometrie: mittig, mit `-translate-x-1/2
 * -translate-y-1/2`, und ein Auftritt, der von 95 % auf 100 % waechst. Wer
 * etwas anderes wollte, schrieb die Gegenklassen ins `className`. Fuer die
 * Position ging das gut - `tailwind-merge` kennt `left-*` und `translate-*`
 * als Konflikt und wirft die unterlegene Klasse weg.
 *
 * Fuer den Auftritt ging es nicht gut. `zoom-in-95` hat keine Gegenklasse,
 * die man danebenschreiben koennte; es bleibt einfach stehen. Ein Drawer, der
 * links am Rand klebt und die volle Hoehe hat, wuchs damit aus seiner eigenen
 * Mitte heraus: gemessen auf dem gebauten Server wanderte seine linke Kante
 * 7,6 Pixel nach rechts und zurueck, die Breite um 15,2 Pixel, die Hoehe um
 * 42 bis 59 Pixel - je nach Geraet. Das ist das sichtbare Wackeln.
 *
 * Die Geometrie gehoert deshalb hierher, als Entscheidung mit Namen. Wer eine
 * dritte braucht, legt sie hier an, statt sie am Aufrufort zu uebermalen.
 */
export type DialogGeometrie = 'zentriert' | 'oben' | 'drawer';

const GEOMETRIEN: Record<DialogGeometrie, string> = {
  zentriert:
    'left-1/2 top-1/2 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 sm:rounded-lg',
  oben: 'left-1/2 top-[15%] w-full max-w-lg -translate-x-1/2 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 sm:rounded-lg',
  // Kein `h-dvh`, sondern `inset-y-0`: `dvh` wird neu aufgeloest, waehrend
  // die Adressleiste in iOS Safari ein- und ausfaehrt - der Drawer aenderte
  // dann waehrend des Scrollens seine Hoehe. Oben und unten verankert loest
  // der Browser die Hoehe einmal auf und laesst sie stehen.
  //
  // Und kein Zoom: ein Drawer kommt von der Seite, nicht aus der Mitte.
  // `slide-in-from-left` ist eine reine Verschiebung - sie laeuft im
  // Compositor, loest kein Layout aus und veraendert keine Kante ausser der,
  // die sich bewegen soll.
  drawer: 'inset-y-0 left-0 data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left',
};

interface DialogContentProps extends React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> {
  /** Vorgabe `zentriert` - die Geometrie, die jeder Dialog bisher hatte. */
  geometrie?: DialogGeometrie;
}

const DialogContent = React.forwardRef<React.ElementRef<typeof DialogPrimitive.Content>, DialogContentProps>(
  ({ className, children, geometrie = 'zentriert', ...props }, ref) => (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          'fixed z-50 grid gap-4 border border-border bg-popover p-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
          GEOMETRIEN[geometrie],
          className,
        )}
        {...props}
      >
        {children}
        {/*
        Das Kreuz sieht aus wie vorher und ist dreimal so gross anzufassen.

        Gemessen am gebauten Server auf 390 Pixel Breite: 16 x 16 Pixel. Das
        war das Symbol selbst - die Schaltflaeche hatte keine Flaeche darueber
        hinaus. Zum Vergleich: die Knoepfe der Kopfzeile sind 40 x 40, und das
        ist das Mass, an dem sich hier alles orientiert.
      */}
        <DialogPrimitive.Close
          className={cn(
            // `size-10` bei `right-1 top-1`: dieselben 40 Pixel wie die
            // Knoepfe der Kopfzeile, und das Symbol bleibt `size-4`. Die
            // Mitte liegt 4 + 20 = 24 Pixel vom Rand des Innenbereichs -
            // dort, wo sie bei `right-4` plus 16-Pixel-Symbol lag. Wo ein
            // Dialog eine Bildlaufrinne freihaelt (der Drawer tut das),
            // rueckt sie um deren Breite nach innen; gemessen 33 statt 25
            // Pixel. Das ist richtig so, sonst laege das Kreuz auf der
            // Leiste.
            'absolute right-1 top-1 grid size-10 place-items-center rounded-md',
            'text-muted-foreground opacity-70 transition-opacity hover:opacity-100',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          )}
        >
          <X className="size-4" />
          <span className="sr-only">Schliessen</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPortal>
  ),
);
DialogContent.displayName = DialogPrimitive.Content.displayName;

function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return <div className={cn('flex flex-col space-y-1.5 text-left', className)} {...props} />;
}

function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return (
    <div className={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)} {...props} />
  );
}

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn('text-lg font-semibold leading-none tracking-tight', className)}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn('text-sm text-muted-foreground', className)}
    {...props}
  />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
};
