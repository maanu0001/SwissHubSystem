import {
  Images,
  CreditCard,
  Dice5,
  Gauge,
  IdCard,
  LayoutGrid,
  Moon,
  Package,
  Image,
  BarChart3,
  Clock,
  List,
  Plus,
  Award,
  Star,
  Gem,
  Zap,
  CalendarDays,
  Activity,
  Bell,
  Blocks,
  Bot,
  Clapperboard,
  MessageCircleQuestion,
  Library,
  Radio,
  CalendarClock,
  Dices,
  Gamepad2,
  Crown,
  Database,
  DatabaseBackup,
  Bug,
  Flame,
  HeartHandshake,
  PartyPopper,
  DoorOpen,
  Heart,
  Link2,
  Medal,
  Rocket,
  Swords,
  CalendarCheck,
  Gavel,
  Gift,
  Hash,
  House,
  KeyRound,
  LayoutDashboard,
  Lock,
  Megaphone,
  MessageSquare,
  Mic,
  Music,
  Palette,
  Plug,
  RefreshCw,
  Sparkles,
  ScrollText,
  Server,
  Settings,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Ticket,
  TrendingUp,
  Trophy,
  Users,
  UserRound,
  UserSearch,
  Volume2,
  ArrowRightLeft,
  Workflow,
  type LucideIcon,
} from 'lucide-react';

/**
 * Erlaubte Navigations- und Modulsymbole.
 *
 * Bewusst als feste Zuordnung statt dynamischem Import: dadurch landet nur ein
 * kleiner Teil der Icon-Bibliothek im Bundle und Module können keine
 * beliebigen Komponenten einschleusen.
 *
 * `Award`, `Star`, `Gem` und `Zap` kamen mit den verwaltbaren Auszeichnungen
 * dazu: wer eine anlegt, waehlt ein Symbol, und die Auswahl darf nicht aus
 * vier Pokalen bestehen.
 *
 * Die Namen unten stehen einzeln je Zeile und ohne Kommentar dazwischen -
 * `module-icons.test.ts` liest diesen Block als Text aus.
 */
const ICONS = {
  Images,
  CreditCard,
  Dice5,
  Gauge,
  IdCard,
  LayoutGrid,
  Moon,
  Package,
  Image,
  BarChart3,
  Clock,
  List,
  Plus,
  Award,
  Star,
  Gem,
  Zap,
  CalendarDays,
  Activity,
  Bell,
  Blocks,
  Bot,
  Clapperboard,
  MessageCircleQuestion,
  Library,
  Radio,
  CalendarClock,
  Dices,
  Gamepad2,
  Crown,
  Bug,
  Flame,
  HeartHandshake,
  PartyPopper,
  Database,
  DatabaseBackup,
  Gavel,
  Gift,
  Hash,
  House,
  KeyRound,
  LayoutDashboard,
  Lock,
  Megaphone,
  MessageSquare,
  Mic,
  Music,
  Palette,
  Plug,
  RefreshCw,
  Sparkles,
  ScrollText,
  Server,
  Settings,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Ticket,
  TrendingUp,
  Trophy,
  Medal,
  Swords,
  Heart,
  Rocket,
  Link2,
  DoorOpen,
  CalendarCheck,
  Users,
  UserRound,
  UserSearch,
  Volume2,
  ArrowRightLeft,
  Workflow,
} satisfies Record<string, LucideIcon>;

/**
 * Die Namen, die es tatsaechlich gibt.
 *
 * Ein Typ und keine Zeichenkette: wo der Name im Quelltext steht - in einem
 * `Panel`, in einer `StatCard` -, faellt ein Tippfehler beim Uebersetzen auf
 * und nicht erst im Browser. Wo er aus der Datenbank kommt - Modulregistry,
 * Auszeichnungen -, bleibt es `string`, und dort faengt ihn `NavIcon` mit dem
 * Ersatzsymbol ab; `tests/unit/module-icons.test.ts` prueft diese Namen.
 */
export type SymbolName = keyof typeof ICONS;

export function NavIcon({ name, className }: { name: string; className?: string }): React.JSX.Element {
  const Icon = (ICONS as Record<string, LucideIcon>)[name] ?? Blocks;
  return <Icon className={className} aria-hidden="true" />;
}

/**
 * Ein Symbol fuer eine Kopfzeile: entweder ein fertiges Element oder ein Name.
 *
 * ## Warum das ueberhaupt zwei Formen sind
 *
 * Weil es zwei Herkuenfte gibt. In einer Seite steht `<Trophy />` - das ist
 * das Naheliegende und bleibt so. Aus einer Navigationsliste oder der
 * Modulregistry kommt dagegen ein **Name**, weil die Liste serverseitig
 * entsteht und ein React-Element den Weg zum Client nicht uebersteht.
 *
 * ## Was dabei schiefgegangen ist
 *
 * `Panel` und `StatCard` nahmen `React.ReactNode`. Eine Zeichenkette ist ein
 * gueltiger `ReactNode` - also nahm TypeScript `icon="BarChart3"` an, und
 * React zeichnete den **Namen als Text** in den Symbolkreis. An 23 Stellen in
 * «SwissHub fragt» stand deshalb `Radio`, `Library` oder `BarChart3»
 * geschrieben, wo ein Symbol hingehoerte.
 *
 * Diese Funktion ist die Antwort darauf: eine Zeichenkette wird hier
 * **nachgeschlagen**, nie gezeichnet. Und weil der Typ `SymbolName` heisst und
 * nicht `string`, ist ein Name, den es nicht gibt, ein Uebersetzungsfehler.
 */
export type SymbolAngabe = React.ReactElement | SymbolName;

export function symbolKnoten(symbol: SymbolAngabe | null | undefined): React.ReactNode {
  if (symbol === null || symbol === undefined) {
    return null;
  }
  return typeof symbol === 'string' ? <NavIcon name={symbol} /> : symbol;
}
