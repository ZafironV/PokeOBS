# PokeOBS: Pokédex visual para OBS Studio

Aplicación local para Windows que añade a OBS una ficha de Pokédex de estilo retro. Desde un panel dentro de OBS eliges juego y Pokémon, ves una vista previa y pulsas **Mostrar en directo**. Los espectadores ven una ficha con sprite, tipos, descripción de Pokédex y familia evolutiva, que desaparece sola pasado el tiempo configurado.

- **`/control`**: panel de control. Se añade como *panel de navegador personalizado* de OBS y no aparece en la emisión.
- **`/overlay`**: la ficha, con fondo transparente. Se añade como *Fuente de navegador* en una escena.

Las dos vistas se sincronizan mediante un servidor local (WebSocket). No hacen falta cuentas, claves API ni servicios de pago. Los datos proceden de [PokéAPI](https://pokeapi.co/docs/v2/), y los textos oficiales en español que PokéAPI no tiene, de [WikiDex](https://www.wikidex.net/). Todo se guarda en una caché local.

### Juegos incluidos

Las ediciones de las generaciones I a V y los remakes de Kanto, Johto y Hoenn. Cada una tiene su propio perfil, con sus textos de Pokédex, su Pokédex regional y sus sprites:

| Región | Originales | Remakes y secuelas |
|---|---|---|
| **Kanto** | Rojo, Azul, Amarillo (Game Boy · Gen. I) | Rojo Fuego, Verde Hoja (GBA · Gen. III) · Let's Go, Pikachu! / Let's Go, Eevee! (Switch · Gen. VII) |
| **Johto** | Oro, Plata, Cristal (Game Boy Color · Gen. II) | Oro HeartGold, Plata SoulSilver (DS · Gen. IV) |
| **Hoenn** | Rubí, Zafiro, Esmeralda (GBA · Gen. III) | Rubí Omega, Zafiro Alfa (3DS · Gen. VI) |
| **Sinnoh** | Diamante, Perla, Platino (DS · Gen. IV) | — (Diamante Brillante / Perla Reluciente no están incluidos) |
| **Teselia** | Negro, Blanco (DS · Gen. V) | Negro 2, Blanco 2: secuelas, no remakes (DS · Gen. V) |

---

## 1. Requisitos

| Requisito | Detalle |
|---|---|
| Windows 10 u 11 | El iniciador es un `.bat`; el código también funciona en otros sistemas con `npm`. |
| [Node.js](https://nodejs.org/) 20 LTS o superior | Incluye `npm`. Probado con Node.js 26.9. |
| OBS Studio con navegador integrado | Las compilaciones oficiales de OBS para Windows lo incluyen (Fuente de navegador y paneles personalizados). |
| Internet la primera vez | Para descargar dependencias y los datos de cada Pokémon (después se reutiliza la caché). |

## 2. Inicio rápido

### 2.1 Aplicación (recomendado)

1. Descarga `PokeOBS-x.y.z.msi` de la página **Releases** del repositorio en GitHub y ábrelo. No hace falta Node.js ni permisos de administrador: se instala para tu usuario y crea accesos directos en el escritorio y en el menú Inicio.
   - Como el instalador no está firmado, Windows puede mostrar «Windows protegió su PC»: pulsa **Más información → Ejecutar de todas formas**.
2. Abre **PokeOBS**. El panel aparece en su propia ventana; las direcciones para OBS son las mismas (abajo).
   - **Cerrar la ventana no detiene PokeOBS**: se queda en la bandeja de Windows (la Poké Ball junto al reloj) y OBS sigue funcionando. Clic o doble clic en la Poké Ball abre el panel; con clic derecho: *Abrir panel*, *Copiar dirección del overlay*, *Iniciar con Windows* y **Salir**, que es lo único que lo cierra del todo.
   - **Iniciar con Windows** (en el menú de la bandeja o en la pestaña OBS del panel): PokeOBS arranca al iniciar sesión, oculto en la bandeja.
3. Al arrancar, Windows pide permiso para la protección temporal de RetroArch (§10.1), igual que con el `.bat`.

**Actualizaciones automáticas**: la aplicación mira al abrirse (a los 15 s) y cada hora si hay una versión nueva en GitHub. Si la hay, la descarga en segundo plano, comprueba su suma SHA-256 y pregunta: **Al salir de PokeOBS** (se instala sola al salir desde la bandeja; elige esto si estás en directo) o **Reiniciar e instalar ahora**. Si la ventana está oculta en la bandeja, avisa con una notificación y la opción *Instalar la versión… y reiniciar* aparece en el menú de la bandeja. Tus ajustes y la caché se guardan en `%APPDATA%\PokeOBS\data` y no se pierden al actualizar. El registro del actualizador está en `%APPDATA%\PokeOBS\updater.log`.

### 2.2 Desde el código (`Iniciar-PokeOBS.bat`)

1. Instala Node.js (versión LTS) si no lo tienes.
2. Haz doble clic en **`Iniciar-PokeOBS.bat`**.
   - La primera vez instala las dependencias (`npm ci`), lo que tarda unos segundos.
   - Compila la aplicación, arranca el servidor y abre el panel en tu navegador.
   - Para no abrir el navegador: `Iniciar-PokeOBS.bat --sin-navegador`.
3. Deja abierta la ventana negra mientras emites. Para detener el servidor, ciérrala o pulsa `Ctrl+C`.

Direcciones (puerto por defecto 4520):

| Uso en OBS | Dirección |
|---|---|
| Panel de control | `http://127.0.0.1:4520/control` |
| Fuente de navegador (overlay) | `http://127.0.0.1:4520/overlay` |

El panel también muestra estas direcciones, con botón de copiar, en la sección **Direcciones para OBS**.

## 3. Configurar OBS

### 3.1 Panel de control (dock)

1. En OBS, abre el menú **Paneles** (*Docks*) → **Paneles de navegador personalizados…** (*Custom Browser Docks…*).
2. Nombre: `PokeOBS`. URL: `http://127.0.0.1:4520/control`.
3. Pulsa **Aplicar** y coloca el panel donde quieras. Funciona desde unos 320 px de ancho.

El panel es una ventana de la interfaz de OBS y **no forma parte de ninguna escena**, así que nunca se emite.

### 3.2 Overlay (Fuente de navegador)

1. En la escena deseada: **+** → **Navegador** (*Browser*) → nombre `PokeOBS overlay`.
2. Configuración:
   - **URL**: `http://127.0.0.1:4520/overlay`
   - **Ancho**: `1920` · **Alto**: `1080`
   - **CSS personalizado**: puedes dejar el que trae OBS o vaciarlo; la página ya fuerza fondo transparente.
   - Desmarca **«Apagar la fuente cuando no esté visible»** para que el overlay siga conectado.
   - Desmarca **«Actualizar el navegador cuando la escena se active»** (no es necesario).
3. Ajusta la fuente para que ocupe todo el lienzo (clic derecho → *Transformar* → *Ajustar a pantalla*).

Si el lienzo de OBS no es de 1920 × 1080, mantén la fuente a 1920 × 1080 y escálala en OBS, o ajusta la escala de la ficha desde el panel.

**Equipo, medallas, mochila, PC y mapa** (opcional, requiere la conexión con RetroArch, ver §4.2): cada uno es su propia Fuente de navegador, configurada igual que la anterior, con estas URL:

| Overlay | URL |
|---|---|
| Equipo | `http://127.0.0.1:4520/equipo` |
| Medallas | `http://127.0.0.1:4520/medallas` |
| Mochila | `http://127.0.0.1:4520/mochila` |
| PC | `http://127.0.0.1:4520/pc` |
| Mapa | `http://127.0.0.1:4520/mapa` |

Añade solo los que quieras usar.

### 3.3 Comprobación manual en OBS

> Las pruebas automáticas se han hecho en Microsoft Edge en modo *headless* (el mismo motor Chromium que usa OBS), **no dentro de OBS**. Comprueba lo siguiente la primera vez:

1. Con el servidor en marcha, el panel muestra **Servidor: conectado** y **Overlay: 1 conectado**.
2. Busca `pikachu`, selecciónalo y pulsa **Mostrar en directo**: la ficha aparece en la escena con una transición suave y el panel muestra la cuenta atrás.
3. Con la ficha visible, elige otro Pokémon y pulsa **Mostrar** de nuevo: se sustituye y el contador vuelve a empezar.
4. Pulsa **Ocultar ahora**: la ficha desaparece y la escena queda limpia.
5. Con una ficha visible, clic derecho sobre la fuente → **Actualizar**: la ficha vuelve con el tiempo restante, no con el total. Si el tiempo ya terminó, no reaparece.
6. Mira la vista previa del lienzo: fuera de la ficha debe verse la escena, sin fondo blanco ni negro.
7. Cambia escala, esquina y márgenes en **Posición y escala**: el overlay se actualiza al momento. Si la ficha se sale del lienzo, el registro del panel lo avisa.

## 4. Uso del panel

El panel está dividido en pestañas (se recuerda la última abierta):

| Pestaña | Para qué sirve |
|---|---|
| **Directo** | Juego, búsqueda y la ficha de la Pokédex: vista previa, «Mostrar en directo» y «Ocultar ahora». |
| **Diseño** | Eliges un overlay, lo ves en grande y ajustas su posición, presentación, textos y colores (§4.4). |
| **Turnos** | Grupos de elementos que aparecen por turnos (§4.4). |
| **Partida** | Conexión con RetroArch, botones «Probar combate» y los datos de la partida (§4.1, §4.2). |
| **OBS** | Direcciones para copiar en OBS, «Probar overlays en directo» y el lienzo completo con todos los overlays (§4.3). |
| **Registro** | Errores y avisos. Un número en la pestaña indica los que aún no has visto. |

Controles de la pestaña **Directo**:

| Control | Función |
|---|---|
| **Juego** | Perfil de juego, agrupado por región. Al cambiarlo se recarga el catálogo y se quita la selección si ese Pokémon no existe en él. |
| **Catálogo** | *Pokédex regional* (Kanto para Rojo, Hoenn original de 202 especies para Esmeralda) o *Pokédex Nacional de la época* (especies introducidas hasta esa generación). La nacional **no implica que todas sean capturables** en esa edición; el panel lo indica. En Rojo, Azul y Amarillo ambas coinciden. Let's Go no tiene Pokédex Nacional, así que esa opción aparece desactivada. |
| **Buscar** | Por nombre (sin distinguir acentos ni mayúsculas) o por número regional o nacional (`25`, `#025`). Se filtra localmente, sin consultas por cada pulsación. **Intro** selecciona el primer resultado. |
| **Vista previa** | La misma ficha que verá el público, más los avisos que solo ve el streamer: texto en inglés, sprite de otra edición, sin animación, etc. |
| **Sprites** | *Fiel al juego*: sprite estático de esa edición. *Animado*: sprite 2D animado en pixel art (ver §6). |
| **Descripciones** | De dónde sale el texto de Pokédex (ver §5.1). Por defecto: español de la edición; si falta, el de la edición española más cercana, indicado en la ficha. |
| **Duración** | De 5 a 60 s (15 por defecto). |
| **Mostrar en directo / Ocultar ahora** | Envían la ficha al overlay o la retiran. «Ocultar» funciona también mientras se carga. |
| **Estado** | Conexión con el servidor, overlays conectados, fase (cargando, preparando, en directo) y tiempo restante. |
| **Registro** (pestaña) | Errores y avisos con detalle técnico desplegable. **El overlay nunca muestra mensajes técnicos.** |

La posición, la escala y el aspecto de la ficha se ajustan en la pestaña **Diseño**.

Las preferencias (juego, catálogo, modo de sprites, duración, posición, escala y último Pokémon) se guardan en `data/settings.json` y se recuperan al reiniciar.

### Temporizador

- La exposición empieza **cuando la ficha está lista**: datos y sprites descargados, y el overlay confirma que ha precargado las imágenes. Si ningún overlay confirma en 4 s, el contador arranca igualmente y el panel lo indica.
- Pulsar **Mostrar** con otra ficha en pantalla la sustituye y reinicia el contador. Mientras se carga la nueva, la anterior sigue visible.
- Las peticiones antiguas o lentas nunca sustituyen a una selección más reciente, y una ficha ocultada durante la carga no llega a aparecer.
- Un overlay que se conecta o reconecta recibe la ficha vigente con su tiempo restante. Una ficha caducada no vuelve a mostrarse.

### 4.1 Detección automática desde RetroArch

PokeOBS puede leer la memoria del juego en RetroArch para mostrar la ficha del Pokémon rival en cada combate y, además, tu equipo, medallas, mochila y PC (§4.2). De momento solo funciona con **Pokémon Esmeralda** (comprobado con la edición española, `BPES`, y la americana, `BPEE`) y el núcleo **mGBA**.

**Preparación (solo la primera vez)**

1. En RetroArch: **Ajustes → Red → Comandos de red: Activado**, con el puerto **55355**. RetroArch guarda el cambio al cerrarse; no hace falta editar ningún archivo.
2. Carga Pokémon Esmeralda con el núcleo mGBA.
3. Abre PokeOBS con `Iniciar-PokeOBS.bat`, elige **Pokémon Esmeralda** en «Juego» y marca **Conectar con RetroArch**. La casilla **Mostrar la ficha del Pokémon rival en cada combate** viene marcada; desmárcala si solo quieres el equipo.

**Funcionamiento**

- La ficha sale con **cada Pokémon rival que aparece**, salvaje o de entrenador, aunque se repita la especie.
- En los **combates dobles** se muestran las dos tarjetas apiladas: una delante y la otra asomando detrás, y se intercambian cada pocos segundos (2–15 s, ajustable en el panel). El rival que acaba de salir va delante.
- Si el Pokémon no está en la Pokédex regional (por ejemplo, en el Frente Batalla), la ficha usa la Nacional.
- La ficha dura lo que marque **Duración** y sigue las mismas reglas del temporizador.
- **«¡Nuevo!»**: si es la primera vez que ves esa especie en tu partida, la ficha lleva esa etiqueta. Se compara con tu Pokédex de antes del combate (el juego marca al rival como visto en cuanto empieza).

**Estado y consumo**

- El panel indica si RetroArch responde, si el juego cargado es el correcto y si hay un combate en curso, además del último rival detectado y el consumo de PokeOBS (CPU, memoria y lecturas por segundo).
- **Copiar diagnóstico** copia un resumen para pedir ayuda.
- Fuera de combate se lee **1 byte** por consulta; en combate, unos 360 bytes. Por defecto se hacen 4 consultas por segundo (se puede bajar a 1 en «Opciones avanzadas»). Los datos de la partida se leen aparte y de forma escalonada (§4.2).
- Con la casilla desmarcada no se abre ninguna conexión. Si RetroArch está cerrado, se reintenta cada 3 s.
- Mientras PokeOBS está abierto, el puerto de RetroArch queda protegido frente a otros equipos de la red (ver §10.1).
- No se captura la pantalla.

**Limitaciones**

- Las direcciones de memoria están en `profiles/emerald.json` (`autoDetect`). Otras ediciones o hacks de ROM pueden usar direcciones distintas. Si el código del cartucho no es uno de los comprobados, el panel lo indica y no lee el combate.
- Con algunos entrenadores, la ficha puede salir un instante antes de que el Pokémon aparezca en pantalla, porque el juego carga sus datos al empezar el combate.

### 4.2 Partida: equipo, medallas, mochila y PC

Con la conexión con RetroArch activa, la sección **Partida** del panel muestra:

| Pestaña | Contenido |
|---|---|
| **Equipo** | Tus 6 Pokémon: sprite (variocolor si lo es, con ★), mote, nivel, barra de PS y estado (DOR, ENV, QUE, CON, PAR; DEB si está debilitado). Los huevos se indican. |
| **Medallas** | Las 8 medallas de Hoenn (Piedra, Puño, Dinamo, Calor, Equilibrio, Pluma, Mente, Lluvia). |
| **Mochila** | Los 5 bolsillos (Objetos, Poké Balls, MT y MO, Bayas, Objetos clave) con iconos y nombres en español. **Mostrar la mochila en directo** la enseña en el overlay `/mochila`. |
| **PC** | Las 14 cajas con sprites y niveles (calculados con la experiencia). Se lee al abrir la pestaña o con **Volver a leer**; **Mostrar el PC en directo** lo enseña en el overlay `/pc`. |

| **Mapa** | El mapa de Hoenn con la cara del personaje en el sitio donde está. |

En el título de la sección se ven también la zona en la que estás, la Pokédex de la partida (vistos y capturados) y el dinero.

**Gráficos originales de Esmeralda**: los overlays de la partida usan los gráficos del propio juego, tomados del proyecto [pokeemerald](https://github.com/pret/pokeemerald) (fijado a una versión concreta, `731ad5bf`), que PokeOBS descarga la primera vez, compone como el juego (piezas de 8 × 8 con su paleta) y guarda en `data/cache/gba/`:

| Overlay | Gráficos |
|---|---|
| Equipo | La Poké Ball en la que se capturó cada Pokémon, sus datos y su sprite. Tres disposiciones a elegir: vertical (6 filas), 2 columnas de 3 u horizontal (6 columnas). |
| Medallas | Los sprites de la tarjeta de entrenador de Esmeralda (grises, como en el juego); las que faltan, en silueta. |
| Mochila | La mochila del personaje (chico o chica) abierta por el bolsillo que se muestra, y el icono original de cada objeto. |
| PC | El fondo que tiene cada caja en tu partida (bosque, ciudad, sabana…) con su nombre; los Pokémon flotan por la caja y rebotan en los laterales. |
| Mapa | El mapa de Hoenn del juego con el icono de la cara del personaje en su posición, y el nombre de la zona debajo. |

Como los sprites de PokéAPI, son gráficos de Nintendo pensados para uso personal en tus directos.

**Overlays**: equipo, medallas, mochila, PC y mapa tienen cada uno su Fuente de navegador (§3.2) y sus ajustes en la pestaña **Diseño** (§4.4): si está visible siempre, la esquina, la escala, los márgenes, la presentación, los textos y los colores.

- **Equipo** y **medallas**: visibles siempre por defecto.
- **Mochila** y **PC**: por defecto solo aparecen al pulsar «Mostrar en directo», durante 3–60 s (10 por defecto), o puedes marcarlos como visibles siempre (con el PC fijo, se relee solo cada 30 s).
- **Mochila**: va pasando por los bolsillos con objetos, empezando por el elegido en la pestaña Mochila; los vacíos se saltan.
- **PC**: solo los sprites de los Pokémon, flotando en el hueco de la caja donde están (sin marco ni niveles). Va pasando por las cajas con Pokémon, empezando por la elegida en la pestaña PC; las vacías se saltan, y si solo una tiene Pokémon, se queda en esa.
- El cambio de bolsillo o de caja es cada 3–30 s (6 por defecto), en «Presentación» de la mochila o del PC (pestaña Diseño).
- **Mapa** (visible siempre por defecto): un mapa de Hoenn en estilo retro con la cara del personaje (chico o chica, según la partida) y el nombre de la zona. En exteriores, el marcador se mueve de forma continua según tu posición dentro de la ruta o ciudad; en interiores y cuevas, se queda en el centro de su zona. Fuera del mapa de Hoenn (por ejemplo, en la base secreta) se oculta.

  El mapa está dibujado por PokeOBS a partir de la tabla de zonas del juego (posición y tamaño de cada ciudad, ruta y lugar), no es la imagen del juego. La cara del personaje es un dibujo propio.

**Consumo**: ubicación para el mapa cada 0,5 s (unos 30 bytes en 4 consultas); equipo cada 2 s (unos 600 bytes); mochila, dinero, medallas y Pokédex cada 5 s (4 consultas pequeñas); en cada vuelta se lee como mucho una de estas partes. El PC (unos 33 KB) solo se lee cuando se pide o, con el overlay `/pc` fijo, cada 30 s; siempre en bloques de 2 KB.

**Datos externos**: los nombres y sprites de las especies salen de PokéAPI (como las fichas). Los nombres e iconos de los objetos salen de las tablas de PokéAPI (`item_game_indices.csv`, `item_names.csv` e `items.csv`, unos 500 KB que se descargan una vez y quedan en caché); son los nombres españoles actuales, que pueden diferir un poco de los de la Gen III.

**Limitaciones**: las posiciones de la partida son las del formato de Esmeralda, igual en todos los idiomas; aún no se han comprobado con una partida real. Si algo no cuadra, **Copiar diagnóstico** incluye un resumen de la partida.

### 4.3 Vista previa del directo y partida de ejemplo

En la pestaña **OBS**, **Lienzo completo del directo** muestra un lienzo de 1920 × 1080 a escala con todos los overlays (ficha, equipo, medallas, mochila, PC y mapa) en su posición y escala reales; al moverlos con los controles se ve el cambio al momento. Los cuadros grises representan la transparencia. Cada capa se puede ocultar con su casilla.

- Solo se carga mientras el apartado está abierto.
- No cuenta como overlay de OBS: el indicador «Overlay» del panel y la confirmación de las fichas siguen dependiendo solo de OBS.

### Botones de prueba (llegan al directo)

Para comprobar en OBS cómo se ven las cosas sin RetroArch, como el botón «Mostrar en directo» de la Pokédex:

| Botón | Dónde | Qué hace en el directo |
|---|---|---|
| **Probar combate** | Partida | Simula una detección: la ficha de un rival al azar del juego elegido, con «¡Nuevo!». |
| **Probar combate doble** | Partida | Igual, con dos rivales: las dos tarjetas apiladas que se turnan. |
| **Probar overlays en directo** | OBS | Enseña la partida de ejemplo en equipo, medallas, mochila, PC y mapa (también mochila y PC aunque no estén fijos) durante los segundos de «Mostrar en directo». El mismo botón la detiene antes; al terminar vuelven tus datos reales. |

**Usar partida de ejemplo** rellena equipo, medallas, mochila, PC y mapa con una partida inventada (con un recorrido a pie por Hoenn para ver moverse el mapa), sin necesidad de RetroArch. **Solo la reciben el panel y la vista previa: los overlays de OBS nunca la ven.** Se desactiva al cerrar PokeOBS.

### 4.4 Diseño del directo y turnos entre elementos

**Diseño** (pestaña del panel), en tres pasos:

1. **Eliges el overlay** en la fila de botones: Ficha · Equipo · Medallas · Mochila · PC · Mapa.
2. **Lo ves en grande**: la vista previa enseña solo ese elemento, a tamaño real si cabe (o el lienzo completo de 1920 × 1080 con «Lienzo completo»). Usa tu partida si RetroArch está conectado; si no, la partida de ejemplo. La ficha muestra el Pokémon elegido en «Directo» (o Pikachu). Esta vista previa no cuenta como overlay de OBS y nunca llega al directo.
3. **Lo ajustas** en bloques plegables; cada cambio se guarda solo y se ve al momento en la vista previa y en el directo. En pantallas anchas, la vista previa queda a la izquierda y los ajustes a la derecha.

- **Visibilidad y posición**: visible siempre (salvo la ficha, que sale con los combates o al mostrarla), esquina, escala y márgenes.
- **Presentación**:

| Elemento | Opciones |
|---|---|
| Equipo | Disposición (vertical, 2 columnas de 3, horizontal), sprite a la izquierda o a la derecha (la Poké Ball, al otro lado), mostrar u ocultar la Poké Ball, tamaño del sprite y del texto. |
| Medallas | 1 fila de 8, 2 filas de 4, 4 filas de 2 o 1 columna; con o sin nombres; tamaño. |
| Mochila | Lista a la derecha, izquierda, encima o debajo de la mochila (horizontal o vertical); 1 a 3 columnas; filas visibles, y si hay más objetos la lista **se desplaza despacio**; tamaño de la mochila, de los iconos y del texto; cada cuánto cambia de bolsillo y cuánto dura «Mostrar en directo». |
| PC | Tamaño de la caja y velocidad de los Pokémon (o quietos); cada cuánto cambia de caja. |
| Mapa | Tamaño del mapa. |

- **Textos**: qué textos se ven y cómo se alinean (izquierda, centro o derecha):

| Elemento | Textos |
|---|---|
| Ficha | Número de la Pokédex, tipos, descripción (también justificada), línea evolutiva y pie con el nombre del juego. |
| Equipo | Mote, nivel, barra de PS, PS en números y estado; alineación. |
| Medallas | Título («Medallas 3/8») y nombres de las medallas. |
| Mochila | Título y su alineación, nombres de los objetos y cantidades. |
| PC | Nombre de la caja y su alineación. |
| Mapa | Nombre de la zona (encima, debajo u oculto) y su alineación. |


- **Colores**: un tema ya hecho (Colores del juego, Esmeralda, Rubí, Zafiro, Oscuro, Claro) o **Personalizado**, con siete colores por elemento (marco arriba y abajo, borde, texto del marco, títulos, recuadros y su texto). Al tocar un color se pasa a Personalizado partiendo de los colores que se veían.

**Turnos** (pestaña del panel): grupos de elementos que aparecen por turnos, durante los segundos que elijas.

- **Alternar**: cada elemento en su propia posición, uno cada vez.
- **Mismo lugar**: todos en la posición del grupo, que se configura en el propio grupo.
- Los turnos sin nada que enseñar (por ejemplo, el PC sin leer) se saltan; con un solo elemento disponible, se queda fijo.
- **La ficha de la Pokédex** puede estar en un grupo: al empezar un combate aparece enseguida (en la posición del grupo si es de mismo lugar) y los demás elementos del grupo se apartan; al terminar, los turnos siguen por el siguiente.
- Cada elemento solo puede estar en un grupo; hasta 6 grupos. Los elementos que no están en ningún grupo siguen «Visible siempre».
- «Mostrar en directo» de la mochila y del PC y «Probar overlays en directo» funcionan igual con grupos.

## 5. Datos: qué se muestra y de dónde sale

Todos los datos proceden de PokéAPI v2 y se verificaron contra la API real durante el desarrollo:

| Dato | Fuente en PokéAPI | Regla |
|---|---|---|
| Catálogo regional | La Pokédex que PokéAPI asocia al *version-group* de cada juego (ver tabla siguiente) | Esmeralda usa la Hoenn **original** (`hoenn`), no `updated-hoenn` (la de Rubí Omega / Zafiro Alfa) ni «toda la Gen III». |
| Catálogo nacional | `pokedex/national` filtrado hasta el último número de la generación del juego | Especies introducidas hasta esa generación. |
| Nombre | `pokemon-species.names` (español) | Si no está en caché, el buscador usa un nombre derivado del identificador hasta que se consulta la especie. |
| Tipos | `pokemon.types` + `pokemon.past_types` | Se aplican los tipos históricos: Clefairy es Normal (no Hada), Magnemite solo Eléctrico en Rojo y Eléctrico/Acero en Esmeralda, Marill Agua en Esmeralda. Además, nunca se muestra un tipo que no existía (Siniestro y Acero antes de la Gen II, Hada antes de la Gen VI). |
| Descripción | PokéAPI (`flavor_text_entries`) y WikiDex (plantilla `{{Pokédex}}`) | Ver §5.1. Se normalizan saltos de línea, saltos de página (`\f`), guiones blandos y el marcado wiki. |
| Familia evolutiva | `evolution-chain` | Se excluyen las especies posteriores a la generación (en Rojo: sin Pichu, Bellossom, Politoed, Slowking, Espeon…). Si se excluye una preevolución, sus descendientes válidos suben de nivel. Las ramas se dibujan como árbol (Eevee, Wurmple, Gloom, Poliwhirl) y el Pokémon seleccionado se resalta. La familia puede incluir especies fuera del catálogo regional (Pichu en Esmeralda). |
| Condiciones de evolución | no se muestran | PokéAPI describe las condiciones actuales, que no siempre coinciden con las de juegos antiguos. |

Correspondencias verificadas contra PokéAPI:

| Juegos | Generación | version-group | Pokédex regional | Nacional hasta |
|---|---|---|---|---|
| Rojo, Azul | I | `red-blue` | `kanto` (151) | 151 |
| Amarillo | I | `yellow` | `kanto` (151) | 151 |
| Oro, Plata | II | `gold-silver` | `original-johto` (251) | 251 |
| Cristal | II | `crystal` | `original-johto` (251) | 251 |
| Rubí, Zafiro | III | `ruby-sapphire` | `hoenn` (202) | 386 |
| Esmeralda | III | `emerald` | `hoenn` (202) | 386 |
| Rojo Fuego, Verde Hoja | III | `firered-leafgreen` | `kanto` (151) | 386 |
| Oro HeartGold, Plata SoulSilver | IV | `heartgold-soulsilver` | `updated-johto` (256) | 493 |
| Rubí Omega, Zafiro Alfa | VI | `omega-ruby-alpha-sapphire` | `updated-hoenn` (211) | 721 |
| Let's Go, Pikachu! / Eevee! | VII | `lets-go-pikachu-lets-go-eevee` | `letsgo-kanto` (153) | sin Pokédex Nacional |
| Diamante, Perla | IV | `diamond-pearl` | `original-sinnoh` (151) | 493 |
| Platino | IV | `platinum` | `extended-sinnoh` (210) | 493 |
| Negro, Blanco | V | `black-white` | `original-unova` (156, desde Victini n.º 000) | 649 |
| Negro 2, Blanco 2 | V | `black-2-white-2` | `updated-unova` (301, desde Victini n.º 000) | 649 |

### La familia evolutiva depende de la generación del juego, no de la del original

Se muestran las especies que existían en la generación del juego seleccionado, aunque no aparezcan en su Pokédex regional. Así, en Esmeralda el catálogo de Hoenn no incluye a Charmander (sí aparece en el catálogo nacional), pero la familia de Pikachu sí incluye a Pichu. La familia de Eevee queda así:

| Juego | Familia de Eevee |
|---|---|
| Rojo, Azul, Amarillo (Gen. I) | Vaporeon, Jolteon, Flareon |
| Oro, Plata, Cristal, Rubí, Zafiro, Esmeralda | + Espeon, Umbreon |
| **Rojo Fuego / Verde Hoja** (remake, Gen. III) | + Espeon, Umbreon: el remake usa los datos de la Gen. III, aunque sea Kanto |
| Diamante, Perla, Platino, HeartGold, SoulSilver (Gen. IV) y Negro, Blanco, Negro 2, Blanco 2 (Gen. V) | + Leafeon, Glaceon |
| Rubí Omega / Zafiro Alfa (Gen. VI) | + Sylveon |
| Let's Go (Gen. VII, 153 especies) | Vaporeon, Jolteon, Flareon: solo especies que existen en ese juego (`familyScope: "regional"`) |

### 5.1 Descripciones en español

PokéAPI solo tiene los textos en español de **Rubí Omega, Zafiro Alfa y Let's Go**; del resto de ediciones solo tiene el inglés. Los juegos sí salieron en español, y **WikiDex** recoge los textos oficiales de los cartuchos españoles edición por edición. PokeOBS los usa en lugar de traducir: son los textos reales de cada juego, no traducciones aproximadas.

Orden de búsqueda (selector **Descripciones** del panel):

| Paso | Fuente | «Español; si falta, el más cercano» (por defecto) | «Español de esta edición» | «Solo PokéAPI» |
|---|---|---|---|---|
| 1 | Tus textos locales (`texts/`, §7) | ✔ | ✔ | ✔ |
| 2 | PokéAPI en español, esta edición | ✔ | ✔ | ✔ |
| 3 | WikiDex, texto oficial español de esta edición | ✔ | ✔ | — |
| 4 | Español de la **edición más cercana** (misma generación y, si no, la más próxima) | ✔, y la ficha lo indica: «Texto de Pokémon Oro» | — | — |
| 5 | PokéAPI en inglés, esta edición | ✔, con la etiqueta «Texto original en inglés» | ✔, con etiqueta | ✔, con etiqueta |

- Variantes: si WikiDex da un texto para Latinoamérica y otro para España, se usa el de **España**. Si da varias formas (Wormadam, Deoxys…), se usa la primera y el panel lo avisa.
- Solo se consulta WikiDex cuando hace falta: si no hay texto local ni texto español en PokéAPI para esa edición. Se pide **solo la página del Pokémon seleccionado**, una petición a la vez, y se guarda en `data/cache/wikidex/`, así que cada Pokémon se descarga una vez. No se descarga nada en bloque.
- Si WikiDex no responde, el panel lo indica y se pasa al paso siguiente.
- El panel siempre muestra de dónde salió el texto.
- Los textos de Pokédex son propiedad de Nintendo / Game Freak, y su transcripción es obra de la comunidad de WikiDex (contenido con licencia CC BY-NC-SA). Úsalos para tu emisión personal, sin fines comerciales. Si prefieres no consultar WikiDex, elige «Solo PokéAPI».

### Limitaciones reales de los datos

- **Textos en español**: dependen de que WikiDex tenga la entrada de esa edición. En las páginas que comprobé (Pikachu, Eevee, Nidoran♀/♂, Mr. Mime, Farfetch'd, Deoxys, Wormadam, Victini, Kyurem…) estaban todas las ediciones en las que aparece cada especie, pero WikiDex puede tener huecos o erratas de transcripción. Si detectas una, corrígela con un texto local (§7), que siempre tiene prioridad.
- **El buscador muestra los nombres en español** una vez consultada la especie. Antes usa el identificador de PokéAPI, que en la Gen I–III coincide prácticamente siempre con el nombre español (`Mr. Mime`, `Nidoran♀`, `Farfetch'd`).
- **Sprites de Rojo, Azul y Amarillo**: los de PokéAPI están coloreados (paletas de Super Game Boy). La Game Boy original era monocroma. Si prefieres el aspecto monocromo, cambia la ruta del perfil a `front_transparent_gray`.
- **Rubí Omega / Zafiro Alfa y Let's Go son juegos 3D**: su sprite «fiel» es un render del modelo 3D del propio juego, animado en Let's Go. El panel lo indica, y se escala suavizado, no como pixel art.
- **Forma por defecto**: se usa la variedad por defecto de cada especie (formas regionales y otras posteriores no aparecen).
- La caché no caduca porque los datos de PokéAPI son prácticamente estáticos. Para forzar una recarga, borra `data/cache/`.

## 6. Sprites

| Juegos | Fiel al juego | Animado |
|---|---|---|
| Rojo, Azul, Amarillo | Sprite de su edición (Game Boy) | Pixel art de **Negro/Blanco** (no tenían animaciones; se indica) |
| Oro, Plata | Sprite de su edición (GBC) | Pixel art de Negro/Blanco (se indica) |
| Cristal | Sprite de Cristal | **Animación propia de Cristal** |
| Rubí, Zafiro, Rojo Fuego, Verde Hoja | Sprite de su edición (GBA) | Animación de **Esmeralda** (mismo estilo de la época; se indica), o de Negro/Blanco si faltara |
| Esmeralda | Sprite de Esmeralda | **Animación propia de Esmeralda** |
| HeartGold, SoulSilver | Sprite de HGSS (DS) | **Animación propia de HGSS** |
| Rubí Omega, Zafiro Alfa | Render 3D del juego | Pixel art de Negro/Blanco; para especies de la Gen. VI no hay, así que se usa el estático y se avisa |
| Let's Go | Render 3D animado del juego | Pixel art de Negro/Blanco (se indica) |
| Diamante, Perla | Sprite de Diamante/Perla (DS) | **Animación propia de Diamante/Perla** |
| Platino | Sprite de Platino (DS) | **Animación propia de Platino** |
| Negro, Blanco | Sprite de Negro/Blanco (DS) | **Animación propia de Negro/Blanco** |
| Negro 2, Blanco 2 | Sprite de Negro/Blanco, que estas secuelas reutilizan (PokéAPI no los separa) | Animación de Negro/Blanco, también reutilizada |

- En el modo **Animado** nunca se usan modelos 3D renderizados. Si no hay animación 2D disponible, se usa el sprite estático y el panel lo indica.
- El pixel art se escala con factores enteros y bordes nítidos (`image-rendering: pixelated`), conservando las proporciones. A los sprites estáticos se les recorta el margen transparente, con un tamaño mínimo de referencia para no ampliar más un Pokémon pequeño que uno grande.
- Si un sprite falla al descargarse, la ficha se muestra sin él y el panel lo avisa.

## 7. Textos locales en español (`texts/`)

Para mostrar descripciones españolas verificadas (por ejemplo, transcritas de tu cartucho), edita `texts/<id-del-perfil>.json`:

```json
{
  "profile": "red",
  "language": "es",
  "entries": {
    "25": { "text": "Texto exacto de la Pokédex de la edición española.", "source": "Cartucho PAL-ESP, transcrito el 2026-10-23" }
  }
}
```

- La clave es el **número de la Pokédex Nacional** (25 = Pikachu), también en Esmeralda.
- `text` es obligatorio. `source` es opcional; anota de dónde sale el texto para poder revisarlo.
- Los saltos de línea del texto se normalizan automáticamente.
- Estas entradas **tienen prioridad** sobre PokéAPI y WikiDex y se muestran como texto español.
- Los archivos se releen solos al guardarlos; no hace falta reiniciar.
- Si el JSON tiene un error, se ignora y el panel lo indica en los avisos de la vista previa.
- Escribe solo textos que hayas verificado: el programa no comprueba que sean auténticos.

## 8. Añadir un perfil de juego (`profiles/`)

Cada juego es un JSON en `profiles/`. Para añadir uno, copia uno existente y ajusta los campos. Ejemplo (el perfil real de Amarillo):

```json
{
  "id": "yellow",
  "name": "Pokémon Amarillo",
  "shortName": "Amarillo",
  "platform": "Game Boy",
  "group": "Kanto",
  "order": 12,
  "notes": "Edición Amarilla: Edición Especial Pikachu, original de Game Boy (Generación I).",
  "generation": 1,
  "versionGroup": "yellow",
  "textVersion": "yellow",
  "regionalPokedex": { "name": "kanto", "label": "Pokédex de Kanto", "short": "Kanto" },
  "nationalDex": { "maxSpecies": 151, "label": "Pokédex Nacional (Gen. I: 151 especies)" },
  "sprites": {
    "game": [
      { "path": "versions.generation-i.yellow.front_transparent", "label": "Amarillo (Game Boy)" }
    ],
    "animated": [
      {
        "path": "versions.generation-v.black-white.animated.front_default",
        "label": "Animación pixel art de Negro/Blanco (no es de Amarillo)",
        "fromOtherGame": true,
        "animated": true
      }
    ],
    "family": [
      { "path": "versions.generation-i.yellow.front_transparent", "label": "Amarillo (Game Boy)" }
    ]
  },
  "theme": { "accent": "#e6b800", "accentDark": "#8a6d00" }
}
```

| Campo | Significado |
|---|---|
| `id` | Identificador único (minúsculas, números y guiones). Da nombre también al archivo de textos `texts/<id>.json`. |
| `group` / `order` | Grupo (región) y orden en el selector de juego. |
| `generation` | Generación **del juego** (no del original): filtra tipos (`past_types`) y familia evolutiva. Rojo Fuego es 3, HeartGold 4, Rubí Omega 6. |
| `versionGroup` | *version-group* de PokéAPI (`/api/v2/version-group/`). |
| `textVersion` | *version* de PokéAPI cuyos textos de Pokédex se usan (`/api/v2/version/`). Para los textos de WikiDex y la búsqueda de la edición más cercana, la versión debe figurar en `src/shared/versions.ts` con su clave de WikiDex (`rojoyazul`, `negro 2`…). |
| `regionalPokedex.name` | Nombre de la Pokédex regional en PokéAPI (`/api/v2/pokedex/`). Comprueba que su `version_groups` incluye tu juego. `short` es el nombre breve que aparece bajo el número de la ficha. |
| `nationalDex.maxSpecies` | Último número nacional de esa generación: 151 (I), 251 (II), 386 (III), 493 (IV), 649 (V), 721 (VI), 809 (VII)… |
| `nationalDex.available` | `false` si el juego no tiene Pokédex Nacional (Let's Go): el panel desactiva esa opción. |
| `familyScope` | `"national"` (por defecto): la familia incluye cualquier especie de la generación. `"regional"`: solo las de la Pokédex regional, para juegos con especies limitadas. |
| `sprites.game` / `animated` / `family` | Listas de rutas dentro del objeto `sprites` de `/api/v2/pokemon/{id}`, en orden de preferencia. `fromOtherGame: true` hace que el panel avise de que el sprite no es de esa edición; `animated: true` lo marca como animación; `render3d: true` indica un render 3D (escalado suavizado). |
| `theme` | Colores de la carcasa de la ficha. |

Antes de dar por bueno un perfil, consulta los datos reales en PokéAPI: el nombre exacto de la Pokédex regional, el *version-group* y si existen los sprites de esa versión. Reinicia el servidor para cargar perfiles nuevos (el iniciador recompila solo).

## 9. Caché, red y errores

- Las respuestas de PokéAPI se guardan en `data/cache/api/` y los sprites en `data/cache/img/`, como recomienda su política de uso justo. Hay como máximo 4 peticiones simultáneas y un único reintento.
- Todo lo que ya está en caché funciona sin conexión. **Lo que todavía no se ha consultado necesita Internet**: no hay descarga masiva previa.
- Errores gestionados: Pokémon inexistente, Pokémon fuera del catálogo, descripción o sprite no disponible, fallos de red, y desconexión y reconexión del overlay o del panel (reconexión automática). Los detalles aparecen solo en el **Registro** del panel.

## 10. Seguridad

- El servidor escucha solo en `127.0.0.1` y rechaza peticiones cuyo `Host` u `Origin` no sean locales (protección frente a *DNS rebinding*).
- El proxy de imágenes solo admite el repositorio oficial de sprites de PokéAPI.
- Variables de entorno opcionales: `POKEOBS_PORT` (puerto, por defecto 4520), `POKEOBS_HOST` (si lo cambias a `0.0.0.0` quedará accesible desde tu red local, bajo tu responsabilidad) y `POKEOBS_DATA` (carpeta de datos).

### 10.1 Protección temporal de los comandos de red de RetroArch

Los comandos de red de RetroArch (UDP 55355) **no piden contraseña y escuchan en todas las interfaces**: con ellos activados, cualquier equipo de tu red local podría enviar órdenes a RetroArch (cerrar el juego, cargar partidas, modificar la memoria…). PokeOBS no puede añadirles contraseña porque el protocolo es de RetroArch.

Por eso `Iniciar-PokeOBS.bat` aplica una protección **solo mientras PokeOBS está abierto**:

1. Windows pide permiso de administrador (una vez por arranque).
2. `scripts/firewall-guard.ps1`, oculto, crea la regla *«PokeOBS - Proteger comandos de red de RetroArch»*, que bloquea la **entrada desde la red** a ese puerto. El tráfico interno del PC (127.0.0.1) no pasa por el firewall, así que PokeOBS sigue leyendo RetroArch.
3. Al cerrar PokeOBS, también con la X de la ventana, el script borra la regla y el equipo queda como estaba. Cuando PokeOBS está cerrado no hay ningún cambio: otros programas o equipos de tu red pueden usar los comandos de red de RetroArch con normalidad.

Detalles:

- Si rechazas el permiso, PokeOBS funciona igual, sin la protección. El panel indica su estado en «Protección de red».
- **Si el PC se apaga con PokeOBS abierto** (apagado normal, corte de luz o bloqueo), el vigilante no llega a borrar la regla. Para eso, mientras PokeOBS está abierto existe también la tarea programada *«PokeOBS - Limpiar proteccion de red»*: en el siguiente arranque de Windows o inicio de sesión borra la regla y se borra a sí misma. Al cerrar PokeOBS con normalidad, la tarea se borra junto con la regla.
- Para quitar ambas a mano, ejecuta como administrador `powershell -ExecutionPolicy Bypass -File scripts\firewall-guard.ps1 -Remove`.
- Registro del vigilante: `data/firewall-guard.log`.

## 11. Desarrollo

```bash
npm install          # dependencias
npm run dev          # compila en modo observación y reinicia el servidor al cambiar el código
npm run build        # compilación de producción en dist/
npm start            # arranca dist/server.js
npm run typecheck    # comprobación de tipos (TypeScript)
npm test             # pruebas automáticas (Vitest)
npm run visual-check # comprobación visual en Edge/Chrome (requiere build previo)
npm run fixtures     # vuelve a descargar los datos reales usados por las pruebas
npm run app          # compila y abre la aplicación de escritorio (Electron)
npm run msi          # crea el instalador en release/PokeOBS-x.y.z.msi
```

> Dentro de VS Code la variable `ELECTRON_RUN_AS_NODE` puede estar activada y hace que Electron arranque como Node; bórrala en esa terminal antes de `npm run app`.

### 11.1 Publicar versiones (cada push a main)

`.github/workflows/release.yml` se ejecuta en cada push a la rama `main` del repositorio de GitHub (que debe ser **público** para que las aplicaciones descarguen las versiones sin contraseña):

1. Instala dependencias y pasa `typecheck` y `npm test`; si fallan, no se publica nada.
2. Pone la versión: mayor.menor de `package.json` más el número de ejecución (1.0.1, 1.0.2…). Para pasar a 1.1.x, cambia `"version"` a `1.1.0`.
3. Crea el instalador MSI y su suma SHA-256 y los publica como Release `v1.0.N`.

El repositorio de las actualizaciones se toma del propio GitHub al compilar (`updateRepo` en `package.json`); las compilaciones locales no buscan actualizaciones. La aplicación (`electron/main.cjs`) arranca el mismo servidor dentro de la ventana; si ya hay un PokeOBS abierto en el puerto 4520 (por ejemplo, el `.bat`), usa ese. El actualizador (`electron/updater.cjs`) descarga el `.msi`, descarta los que no coinciden con su suma y lo instala con `msiexec /passive` cuando la aplicación ya se ha cerrado. El icono se genera con `node scripts/make-icon.mjs`.

Estructura:

```
profiles/            perfiles de juego (JSON)
texts/               textos locales en español por perfil
public/              HTML y CSS del panel y del overlay
src/shared/          tipos y utilidades comunes (búsqueda, textos, tipos)
src/server/          servidor HTTP + WebSocket, PokéAPI, WikiDex, caché, reglas de datos, temporizador
src/client/          panel (control.ts), overlay (overlay.ts) y dibujo de la ficha (cardView.ts)
tests/               pruebas automáticas con respuestas reales de PokéAPI (tests/fixtures)
scripts/             compilación, comprobación visual, descarga de fixtures, icono y protección de red
electron/            aplicación de escritorio y actualizador
build/               icono de la aplicación
.github/workflows/   publicación automática de versiones
data/                (se crea solo) caché, preferencias y capturas de la comprobación visual
```

Dependencias de ejecución: `ws` (WebSocket) y las fuentes OFL `@fontsource/silkscreen` y `@fontsource/vt323`, que se sirven localmente. Para desarrollo: TypeScript, esbuild, Vitest, `playwright-core` y `pngjs`, que solo se usan en la comprobación visual.

### Qué verifican las pruebas

- **`npm test`** (235 pruebas, con datos reales guardados de PokéAPI y secciones reales de WikiDex):
  - Los 24 perfiles y su correspondencia de generación, version-group, textos y Pokédex.
  - Textos en español: análisis de la plantilla de WikiDex (referencias, variantes, formas), orden de prioridad de los tres modos y caída a la edición más cercana sin conexión. Rojo usa Kanto (151) y Esmeralda usa la Hoenn original (202).
  - La familia de Eevee en cada generación, incluidos los remakes y Let's Go.
  - Ningún catálogo antiguo contiene especies posteriores.
  - Tipos históricos y familias evolutivas filtradas con sus ramas.
  - Prioridad de las descripciones y elección de sprites.
  - Errores: inexistente, fuera del catálogo, red, sprite.
  - Máquina de estados del directo: inicio del temporizador al estar lista la ficha, reemplazo, ocultar durante la carga, peticiones lentas y reconexión.
  - Servidor WebSocket de extremo a extremo y protección de acceso local.
- **`npm run visual-check`** (162 comprobaciones, con PokéAPI y WikiDex reales, en Microsoft Edge headless, con capturas en `data/visual-check/`):
  - Transparencia píxel a píxel fuera de la ficha.
  - Ficha dentro del lienzo de 1920 × 1080 y sin desbordamientos internos.
  - Escala y posición.
  - Ningún píxel ni elemento tras ocultar.
  - Recarga del overlay con el tiempo restante.
  - Fichas de remakes: Eevee con 8 ramas en Rubí Omega, Let's Go en 3D, animaciones de Cristal y HGSS.
  - Botones y cuenta atrás del panel, limpieza de la selección al cambiar de juego, Pokédex Nacional desactivada en Let's Go y recuerdo de preferencias.

## 12. Solución de problemas

| Problema | Solución |
|---|---|
| «El puerto 4520 ya está en uso» | Ya hay otra ventana de PokeOBS abierta, o usa otro puerto: `set POKEOBS_PORT=4521` antes de ejecutar el `.bat` (y cambia las URL en OBS). |
| El panel dice **Overlay: ninguno** | Revisa la URL de la Fuente de navegador y que no esté marcada «Apagar la fuente cuando no esté visible». |
| «No se pudo contactar con PokéAPI» | Sin conexión y sin caché para ese Pokémon. Reintenta con conexión. |
| La ficha se ve borrosa | Usa escalas como 100 % o 200 % y no redimensiones la Fuente de navegador en OBS de forma no proporcional. |
| Quiero reiniciar las preferencias | Cierra el servidor y borra `data/settings.json`. |

---

Pokémon y sus nombres son marcas de Nintendo, Creatures Inc. y GAME FREAK inc. Proyecto personal sin afiliación; los datos y sprites proceden de PokéAPI, y las transcripciones de los textos en español, de WikiDex.
