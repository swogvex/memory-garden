# Composición del ramo mensual (H6)

Estado: implementado en `src/features/bouquets/compose.ts` (H6.1). El dibujo de cada flor está en `src/lib/flowers/`.

## Qué recibe y qué devuelve

- Entrada (`BouquetInput`): el mes (`AAAA-MM`) y una lista de `BouquetMemory`: `id`, `date`, `flower` y `hasPhoto`. Nada más: ni títulos, ni textos, ni fotos, ni claves. El renderizador no importa `lib/crypto` ni `lib/storage`.
- Salida (`BouquetLayout`): números y textos planos (posiciones, giros, escalas, semillas). Se puede serializar y comparar.
- `renderBouquet(layout, opciones)` convierte ese resultado en SVG. Los nombres accesibles se los da quien lo llama.

## Determinismo

La misma entrada da siempre el mismo resultado:

1. Los recuerdos se ordenan por `(fecha, id)`; la lista de ids se ordena por separado. El orden de llegada no importa.
2. **Semilla** = FNV-1a de 32 bits de `mes|id1,id2,…` (ids ordenados). Cada paso del algoritmo (`phase`, `order`, `leaves`, `polaroids`) toma su propio generador `mulberry32` derivado de esa semilla y de su nombre, para que un paso no altere la secuencia de otro.
3. La pose y el tono de cada flor salen de `mes|id|pose`, y su dibujo de `mes|id|head`: **no dependen de las demás flores**. Añadir un recuerdo recoloca el ramo, pero las flores que ya estaban siguen siendo la misma flor.
4. No se usa `Math.random`, ni el reloj, ni nada del entorno. Las posiciones se redondean a 0,1.

Límite conocido: `Math.sin` y `Math.cos` no están garantizados bit a bit entre motores de JavaScript. Tras redondear a 0,1 la diferencia entre navegadores solo podría notarse en un valor justo en el borde del redondeo, y sería de una décima de unidad en un lienzo de 600. La prueba de instantánea se ejecuta en Node.

## Pasos

1. **Visibles.** Hasta 21 recuerdos son flor. Con más, se eligen 21 repartidos por el mes (índices equidistantes sobre la lista cronológica) y el resto se agrupa en «+N más» (no se pierde ningún recuerdo: la lista de la pantalla los muestra todos).
2. **Tamaño.** Pocas flores, más grandes: el radio base baja de 88 (una flor) a 50 (seis o más).
3. **Posiciones.** Espiral de Vogel (ángulo áureo) dentro de una elipse cuya área crece con el número de flores, hasta un máximo.
4. **Reparto.** Las flores «focales» (rosa, hortensia, girasol, dalia) ocupan el centro, las «medias» después y las espigas (lavanda) el borde. Dentro de cada grupo, el orden lo decide la semilla.
5. **Equilibrio.** 40 pasadas que separan solapes, mantienen todo dentro de la elipse y, al final, centran la masa en el eje (el centro de masa ponderado por área queda a menos de 2 px del eje en las 360 combinaciones de la prueba).
6. **Pose.** Cada flor se inclina hacia fuera según su posición y tiene un pequeño giro propio. Se dibujan las más altas primero.
7. **Follaje.** `round(0,55 · flores) + 3` hojas (entre 3 y 14) en arco alrededor de la masa, más 2 o 4 hojas del tallo junto al lazo. Un mes vacío tiene un brote de 3 hojas.
8. **Lazo.** Fijo, en la base. Los tallos se recogen a ±26 px de su centro.
9. **Polaroids.** Hasta 5, de los recuerdos con foto más recientes, de izquierda a derecha en orden cronológico. El lienzo es más alto solo si hay alguna.

## Cambiar el algoritmo cambia los ramos ya vistos

Los ramos no se guardan: se recalculan. Modificar cualquier paso cambia el aspecto de todos los meses ya existentes. Por eso la prueba «instantánea» fija el resultado de un mes de referencia; si falla, o se ha roto algo o se quiere cambiar a propósito. En ese caso hay que anotarlo en `DECISIONES.md` y actualizar el valor fijado.
