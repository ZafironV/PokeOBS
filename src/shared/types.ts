// Tipos compartidos entre servidor, panel de control y overlay.

export type CatalogMode = 'regional' | 'national';
export type SpriteMode = 'game' | 'animated';
/**
 * Origen de las descripciones:
 * - "es-aprox": español; si falta el de esta edición, el de la edición española más cercana (indicado).
 * - "es-exacto": español de esta edición (PokéAPI o WikiDex); si no hay, inglés de esta edición.
 * - "pokeapi": solo PokéAPI (español si existe; si no, inglés).
 */
export type TextMode = 'es-aprox' | 'es-exacto' | 'pokeapi';
export type Anchor =
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right'
  | 'center-left'
  | 'center-right';

/** Ruta dentro del objeto `sprites` de /pokemon, p. ej. "versions.generation-i.red-blue.front_transparent". */
export interface SpriteSource {
  path: string;
  label: string;
  /** true si el sprite procede de otra edición distinta a la del perfil. */
  fromOtherGame?: boolean;
  animated?: boolean;
  /** Render de un modelo 3D (juegos de 3DS/Switch): se escala suavizado, no como pixel art. */
  render3d?: boolean;
}

export interface GameProfile {
  id: string;
  name: string;
  shortName: string;
  platform: string;
  /** Agrupación en el selector (p. ej. "Kanto"). */
  group: string;
  /** Orden dentro del selector. */
  order: number;
  notes?: string;
  generation: number;
  /** version-group de PokéAPI (p. ej. "red-blue"). */
  versionGroup: string;
  /** version de PokéAPI cuyos textos de Pokédex se usan (p. ej. "red"). */
  textVersion: string;
  /** short: nombre breve de la región para la ficha ("Johto"). */
  regionalPokedex: { name: string; label: string; short: string };
  /**
   * maxSpecies: último número nacional existente en la generación del juego.
   * available: false si el juego no tiene Pokédex Nacional (Let's Go).
   */
  nationalDex: { maxSpecies: number; label: string; available: boolean };
  /**
   * "national": la familia evolutiva incluye cualquier especie de la generación.
   * "regional": solo especies de la Pokédex regional (juegos con especies limitadas, como Let's Go).
   */
  familyScope: 'national' | 'regional';
  sprites: {
    game: SpriteSource[];
    animated: SpriteSource[];
    family: SpriteSource[];
  };
  theme: { accent: string; accentDark: string };
  /** Detección automática del combate leyendo la RAM del emulador (solo algunos juegos). */
  autoDetect?: AutoDetectProfile;
}

/**
 * Mapa de memoria de un juego para la detección automática. Las direcciones son
 * las del bus de la consola (p. ej. 0x02024084 en GBA).
 */
export interface AutoDetectProfile {
  /** Motor de lectura; de momento solo "gen3" (estructuras de pokeemerald). */
  engine: 'gen3';
  /** Códigos de cartucho (cabecera, 0xAC) con direcciones comprobadas, p. ej. "BPES". */
  gameCodes: string[];
  /** Byte con el indicador "en combate" (gMain.inBattle) y su máscara. */
  inBattle: { address: number; mask: number };
  /** gBattleTypeFlags (u32). */
  battleTypeFlags: number;
  /** gBattleMons: 4 estructuras BattlePokemon de 0x58 bytes. */
  battleMons: number;
  /** gPlayerPartyCount (u8); gPlayerParty empieza 3 bytes después. */
  party: number;
  /** gSaveBlock1Ptr, seguido de gSaveBlock2Ptr y gPokemonStoragePtr (3 punteros u32). */
  saveBlockPointers: number;
  /** gMapHeader: cabecera del mapa actual (zona del mapa en +0x14, tipo de mapa en +0x17). */
  mapHeader: number;
  /** gBackupMapLayout: ancho y alto (s32) del mapa actual, con el borde incluido. */
  backupMapLayout: number;
}

export interface GameSummary {
  id: string;
  name: string;
  shortName: string;
  platform: string;
  group: string;
  notes?: string;
  generation: number;
  regionalLabel: string;
  nationalLabel: string;
  nationalAvailable: boolean;
  /** true cuando la Pokédex regional y la nacional de la época coinciden (Rojo). */
  regionalEqualsNational: boolean;
  /** El juego admite detección automática desde RetroArch. */
  autoDetect: boolean;
}

export interface CatalogEntry {
  speciesId: number;
  slug: string;
  name: string;
  regionalNumber: number | null;
}

export interface Catalog {
  gameId: string;
  mode: CatalogMode;
  label: string;
  entries: CatalogEntry[];
}

export interface PokemonType {
  id: string;
  label: string;
}

export type Description =
  | {
      status: 'ok';
      text: string;
      lang: 'es' | 'en';
      source: 'local' | 'pokeapi' | 'wikidex';
      /** Versión de la que procede el texto. */
      version: string;
      /** Nombre de la otra edición cuando el texto no es de la seleccionada (modo aproximado). */
      approxFrom?: string;
    }
  | { status: 'missing' };

export interface CardSprite {
  url: string;
  label: string;
  animated: boolean;
  fromOtherGame: boolean;
  render3d: boolean;
}

export interface EvoNode {
  speciesId: number;
  name: string;
  sprite: string | null;
  selected: boolean;
  children: EvoNode[];
}

export interface Card {
  gameId: string;
  gameName: string;
  platform: string;
  accent: string;
  accentDark: string;
  speciesId: number;
  name: string;
  /** Número mostrado según el catálogo activo. */
  number: number;
  numberLabel: string;
  nationalNumber: number;
  types: PokemonType[];
  description: Description;
  sprite: CardSprite | null;
  family: EvoNode[];
  /** Los sprites de la familia son renders 3D (escalado suavizado). */
  familySmooth: boolean;
  /** Avisos para el panel de control; nunca se muestran en el directo. */
  warnings: string[];
  /** Primera vez que el jugador ve esta especie en su partida. */
  isNew?: boolean;
}

export interface OverlayLayout {
  scale: number;
  anchor: Anchor;
  offsetX: number;
  offsetY: number;
}

export interface Settings {
  gameId: string;
  catalogMode: CatalogMode;
  spriteMode: SpriteMode;
  textMode: TextMode;
  durationSec: number;
  selectedSpeciesId: number | null;
  overlay: OverlayLayout;
  /** Segundos entre intercambios de las dos tarjetas en combates dobles. */
  doubleSwapSec: number;
  auto: AutoSettings;
  views: GameViews;
  groups: RotationGroup[];
}

export interface AutoSettings {
  /** Conexión con RetroArch (lectura de la memoria del juego). */
  enabled: boolean;
  /** Mostrar la ficha del rival en cada combate. */
  battleCards: boolean;
  /** Intervalo entre lecturas de memoria (250–1000 ms). */
  intervalMs: number;
  /** Puerto UDP de los comandos de red de RetroArch. */
  port: number;
}

/** Disposición del overlay del equipo. */
export type PartyLayout = 'vertical' | 'grid' | 'horizontal';

/** Overlays de la partida, cada uno con su propia Fuente de navegador. */
export type GameView = 'party' | 'badges' | 'bag' | 'pc' | 'map';

export interface ViewSettings {
  /** Visible siempre (si no, solo aparece al pulsar «Mostrar en directo»). */
  visible: boolean;
  layout: OverlayLayout;
}

/** Elementos del directo que pueden turnarse (la ficha de la Pokédex y los de la partida). */
export type SlotItem = 'card' | GameView;

/** Presentación de cada elemento (posiciones de sus partes, columnas y tamaños). */
/** Alineación de un texto. */
export type TextAlign = 'left' | 'center' | 'right';

/** Ficha de la Pokédex: qué textos se ven y cómo se alinea la descripción. */
export interface CardStyle {
  showNumber: boolean;
  showTypes: boolean;
  showDescription: boolean;
  showFamily: boolean;
  /** Pie con el nombre del juego. */
  showFooter: boolean;
  descAlign: TextAlign | 'justify';
}

export interface PartyStyle {
  layout: PartyLayout;
  /** Lado del sprite; la Poké Ball va al contrario. */
  spriteSide: 'left' | 'right';
  showBall: boolean;
  /** Escala del sprite (1 = 64 px). */
  spriteScale: number;
  /** Tamaño del texto en px. */
  textSize: number;
  showNickname: boolean;
  showLevel: boolean;
  showHpBar: boolean;
  showHpText: boolean;
  showStatus: boolean;
  textAlign: TextAlign;
}
export interface BadgesStyle {
  /** Medallas por fila. */
  columns: 1 | 2 | 4 | 8;
  names: boolean;
  /** Escala del sprite de 16 px. */
  size: number;
  /** «Medallas 5/8». */
  showTitle: boolean;
}
export interface BagStyle {
  /** Posición de la lista respecto a la imagen de la mochila. */
  listPosition: 'left' | 'right' | 'top' | 'bottom';
  columns: 1 | 2 | 3;
  /** Filas visibles; si hay más objetos, la lista se desplaza despacio. */
  rows: number;
  scroll: boolean;
  /** Escala de la imagen de la mochila (64 px). */
  bagSize: number;
  /** Escala de los iconos (24 px). */
  iconSize: number;
  textSize: number;
  showTitle: boolean;
  titleAlign: TextAlign;
  showNames: boolean;
  showQuantity: boolean;
}
export interface PcStyle {
  showName: boolean;
  /** Escala de la caja (160 × 144 px). */
  scale: number;
  /** Velocidad de los Pokémon (px/s; 0 = quietos en su hueco). */
  speed: number;
  nameAlign: TextAlign;
}
export interface MapStyle {
  labelPosition: 'top' | 'bottom' | 'hidden';
  /** Escala del mapa (240 × 160 px). */
  scale: number;
  labelAlign: TextAlign;
}
export interface ViewStyles {
  card: CardStyle;
  party: PartyStyle;
  badges: BadgesStyle;
  bag: BagStyle;
  pc: PcStyle;
  map: MapStyle;
}

/** Colores de un elemento: un tema ya hecho o colores propios. */
export type ThemeId = 'game' | 'esmeralda' | 'rubi' | 'zafiro' | 'oscuro' | 'claro' | 'custom';
export interface ColorSet {
  /** Degradado del marco. */
  frame: string;
  frameDark: string;
  border: string;
  /** Texto sobre el marco y títulos. */
  text: string;
  title: string;
  /** Recuadros interiores (pantallas, listas) y su texto. */
  panel: string;
  panelText: string;
}
export interface ViewColors {
  theme: ThemeId;
  custom: ColorSet;
}

/**
 * Grupo de turnos: sus elementos aparecen por turnos. alternate: cada uno en su
 * propia posición; shared: todos en la posición del grupo. Si incluye la ficha,
 * al empezar un combate la ficha aparece enseguida y los demás se apartan.
 */
export interface RotationGroup {
  id: string;
  name: string;
  enabled: boolean;
  mode: 'alternate' | 'shared';
  items: SlotItem[];
  /** Segundos de cada turno. */
  seconds: number;
  /** Posición compartida (modo shared). */
  layout: OverlayLayout;
}

/** Estado de los turnos para los overlays: solo aparecen los elementos que están en un grupo. */
export type SlotState = Partial<Record<SlotItem, { group: string; active: boolean; layout: OverlayLayout | null }>>;

export interface GameViews {
  party: ViewSettings;
  badges: ViewSettings;
  bag: ViewSettings;
  pc: ViewSettings;
  map: ViewSettings;
  styles: ViewStyles;
  colors: Record<SlotItem, ViewColors>;
  /** Bolsillo y caja por los que empiezan los overlays de mochila y PC. */
  pocket: PocketId;
  box: number;
  /** Segundos entre bolsillos de la mochila y entre cajas del PC (solo se turnan los que tienen algo). */
  rotateSec: number;
  /** Segundos que se muestran la mochila o una caja al pulsar «Mostrar en directo». */
  showcaseSec: number;
}

// Datos de la partida leídos de la memoria del juego

export type PocketId = 'items' | 'balls' | 'tmhm' | 'berries' | 'key';

export interface PartySlot {
  /** Número nacional; null si no se reconoce. */
  species: number | null;
  nickname: string;
  level: number;
  hp: number;
  maxHp: number;
  status: number;
  isEgg: boolean;
  shiny: boolean;
  /** Poké Ball de captura (gráfico /gba/ball-N.png; 0 si no se sabe). */
  ball: number;
}

export interface BoxSlot {
  species: number | null;
  nickname: string;
  /** El nivel se calcula en el cliente con la experiencia y el ritmo de crecimiento de la especie. */
  experience: number;
  isEgg: boolean;
  shiny: boolean;
}

export interface BagEntry {
  id: number;
  quantity: number;
  /** null mientras no se haya cargado la lista de objetos. */
  name: string | null;
  icon: string | null;
}

/** Cada parte es null mientras no se haya podido leer. */
export interface GameData {
  /** Juego y colores de su perfil. */
  game: { name: string; accent: string; accentDark: string } | null;
  player: { name: string; gender: 'male' | 'female' } | null;
  party: PartySlot[] | null;
  badges: { name: string; owned: boolean }[] | null;
  money: number | null;
  pokedex: { seen: number; owned: number } | null;
  bag: { id: PocketId; label: string; items: BagEntry[] }[] | null;
  pc: { currentBox: number; readAt: number; boxes: { name: string; wallpaper: number; mons: (BoxSlot | null)[] }[] } | null;
}

/** Dónde está el jugador, para el minimapa. */
export interface PlayerLocation {
  /** Zona del mapa (MAPSEC) y su nombre. */
  mapsec: number;
  name: string;
  /** Posición en la cuadrícula de 28 × 15 del mapa de Hoenn (con decimales); null si la zona no está en él. */
  x: number | null;
  y: number | null;
}

/** Nombre, sprite y ritmo de crecimiento de una especie, para el equipo y el PC. */
export interface SpeciesBrief {
  id: number;
  name: string;
  sprite: string | null;
  /** Sprite variocolor (shiny) de la misma edición, si existe. */
  spriteShiny: string | null;
  growthRate: string | null;
}

export type Showcase = { kind: 'bag'; pocket: PocketId } | { kind: 'pc'; box: number };

export interface ShowRequest {
  gameId: string;
  catalogMode: CatalogMode;
  spriteMode: SpriteMode;
  textMode: TextMode;
  speciesId: number;
  durationSec: number;
  /** Segundo Pokémon de un combate doble: se muestra apilado detrás del primero. */
  partnerSpeciesId?: number;
  /** Petición de la detección automática: si la especie no está en el catálogo, se usa la Nacional. */
  auto?: boolean;
  /** Especies que el jugador no había visto antes de este combate: la ficha lleva «¡Nuevo!». */
  newSpeciesIds?: number[];
}

export type LivePhase = 'idle' | 'loading' | 'preparing' | 'live';

export interface LiveStatus {
  phase: LivePhase;
  /** Nombre de la ficha en directo (si la hay). */
  liveName: string | null;
  pendingName: string | null;
  remainingMs: number;
  durationMs: number;
  overlays: number;
  /** Si la ficha actual fue confirmada por un overlay (true) o arrancó por tiempo de espera (false). */
  confirmedByOverlay: boolean | null;
}

export interface ErrorInfo {
  code: 'NOT_FOUND' | 'OUT_OF_CATALOG' | 'NETWORK' | 'INVALID' | 'INTERNAL';
  message: string;
  detail?: string;
}

// Mensajes WebSocket

export type ClientMessage =
  /**
   * preview: vista previa del panel (no cuenta como overlay de OBS). editor: vista
   * previa del editor de diseño (enseña siempre su elemento; sin partida real, usa la de ejemplo).
   */
  | { type: 'hello'; role: 'control' | 'overlay' | 'team'; preview?: boolean; editor?: boolean }
  | { type: 'demo'; enabled: boolean }
  /** Prueba en el directo: la partida de ejemplo en los overlays de OBS durante unos segundos. */
  | { type: 'testOverlays'; enabled: boolean }
  /** Simula una detección de combate con un rival al azar del juego elegido. */
  | { type: 'testBattle'; double: boolean }
  | { type: 'refreshPc' }
  | { type: 'showcase'; showcase: Showcase }
  | { type: 'showcaseHide' }
  | { type: 'show'; request: ShowRequest }
  | { type: 'hide' }
  | { type: 'settings'; patch: Partial<Settings> }
  | { type: 'ready'; seq: number; overflow: boolean }
  | { type: 'overlayError'; seq: number; message: string };

export type ServerMessage =
  | { type: 'settings'; settings: Settings }
  | { type: 'status'; status: LiveStatus }
  | { type: 'prepare'; seq: number; cards: Card[] }
  | { type: 'show'; seq: number; cards: Card[]; remainingMs: number }
  | { type: 'hide'; seq: number }
  | { type: 'error'; error: ErrorInfo }
  | { type: 'notice'; message: string }
  | { type: 'auto'; status: AutoStatus }
  | { type: 'game'; data: GameData }
  | { type: 'species'; entries: SpeciesBrief[] }
  | { type: 'showcase'; showcase: Showcase; remainingMs: number }
  | { type: 'showcaseHide' }
  | { type: 'location'; location: PlayerLocation | null }
  /** Partida de ejemplo activa: solo la ven el panel y la vista previa, nunca el directo. */
  | { type: 'demo'; enabled: boolean }
  /** Prueba de los overlays en el directo: tiempo restante (0 = terminada). */
  | { type: 'test'; remainingMs: number }
  /** Turnos: qué elementos de los grupos están a la vista y en qué posición. */
  | { type: 'slots'; slots: SlotState };

export type AutoState = 'off' | 'unsupported' | 'connecting' | 'no-game' | 'wrong-game' | 'watching' | 'battle';

export interface AutoEvent {
  at: number;
  kind: 'info' | 'detect' | 'warn';
  text: string;
}

/** Estado de la detección automática para el panel. */
export interface AutoStatus {
  state: AutoState;
  /** Explicación para el usuario. */
  message: string;
  retroarchVersion: string | null;
  /** Código del cartucho cargado, si se pudo leer. */
  gameCode: string | null;
  lastDetected: { names: string[]; kind: string; at: number } | null;
  /** Consumo de todo el proceso de PokeOBS mientras la detección está activa. */
  usage: { cpuPercent: number; memoryMb: number; readsPerSec: number; latencyMs: number } | null;
  /** Regla temporal del firewall que impide órdenes a RetroArch desde la red; null si no se sabe. */
  firewall: boolean | null;
  events: AutoEvent[];
}
