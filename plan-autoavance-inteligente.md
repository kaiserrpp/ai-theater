# Plan - Autoavance inteligente

Fecha de actualizacion: 2026-05-10
Rama de trabajo: `codex/intelligent-line-advance`
Ultimo commit subido: `e9437eb Keep mixed Spanish lines in Spanish recognition`
Preview: `https://ai-theater-git-codex-intelligent-lin-686108-kaiserrpps-projects.vercel.app`

## Objetivo

Construir un modo de ensayo inteligente que escuche la replica del usuario, compare lo dicho con la linea esperada y avance automaticamente solo cuando la coincidencia sea suficientemente segura.

La prioridad no es exigir literalidad absoluta, sino reconocer frases dichas de forma natural durante un ensayo, incluyendo:
- pequenas diferencias entre espanol latinoamericano y espanol de Espana
- cambios de `usted` a `tu`
- nombres propios mal transcritos por el navegador
- numeros dictados como cifras o palabras
- frases equivalentes que mantienen la intencion teatral

## Estado actual

El modo `Autoavance inteligente beta` ya existe en la rama `codex/intelligent-line-advance`.

Funciona separado del avance por silencio:
- no avanza por pausas
- usa reconocimiento de voz del navegador
- muestra lo que debias decir
- muestra lo que ha oido
- muestra el porcentaje de coincidencia
- permite guardar `Linea buena`
- permite `Reintentar`
- permite usar el comando oral `siguiente linea`

## Cambios ya incorporados

### Reconocimiento y scoring

Archivo principal: `src/utils/lineMatching.ts`

Ya se ha incorporado:
- idioma por defecto `es-ES`
- normalizacion de texto
- eliminacion de acotaciones
- palabras funcionales y muletillas con poco peso
- proteccion de negaciones (`no`, `nunca`, `sin`, etc.)
- normalizacion de numeros (`50` / `cincuenta`, `70-30` / `setenta treinta`)
- equivalencias para nombres propios y errores habituales del reconocedor
- coincidencia difusa por distancia entre tokens
- puntuacion combinada:
  - cobertura de palabras clave
  - orden aproximado
  - coincidencia del final de la frase
  - precision respecto a lo que se ha oido
- umbral actual de autoavance: `86%`

### Autoavance seguro

Archivo principal: `src/components/RehearsalView.tsx`

Ya se ha incorporado:
- autoavance cuando la coincidencia supera el umbral y pasa las reglas de seguridad
- bloqueo del autoavance si hay cambios en negaciones
- registro de eventos `auto_avance`
- si el usuario vuelve atras tras un autoavance, aparece la opcion de marcar incidencia

### Informes de prueba

Archivos principales:
- `src/components/RehearsalView.tsx`
- `src/types/sharedScript.ts`
- `src/api/sharedScripts.ts`
- `api/shared-script/intelligent-feedback.js`

El informe registra:
- linea original
- texto reconocido
- porcentaje asignado
- personaje
- escena
- idioma usado
- referencia que mejor coincidio
- resultado

Resultados posibles:
- `auto_avance`: la app avanzo sola
- `linea_buena`: la app se quedo parada y el usuario confirmo que la linea era correcta
- `reintentar`: el usuario pidio repetir la captura
- `siguiente_linea`: el usuario avanzo manualmente desde el panel
- `comando_siguiente`: el usuario dijo el comando oral
- `falso_positivo`: la app avanzo sola, el usuario volvio atras y lo marco como incorrecto

Para `falso_positivo`, ahora tambien se guarda:
- `issueType`
- `issueNote`

Tipos de incidencia:
- `corto_antes_de_tiempo`: la app avanzo mientras el usuario aun hablaba
- `dije_mal_mi_frase`: el usuario reconoce que dijo mal la linea
- `otro`: permite escribir una nota libre

## Informes revisados

Ya se han revisado los informes enviados el 2026-05-09 y el 2026-05-10.

Conclusiones principales:
- no aparecen falsos positivos marcados en los dos ultimos informes
- el autoavance actual es seguro, pero conservador
- hay lineas buenas manuales que se pueden recuperar sin bajar el umbral global
- los patrones mas utiles estan en nombres propios, diferencias Espana/Latinoamerica, reacciones cortas y finales de frase bien captados

Siguiente tarea:
1. Validar la Fase 1 en dispositivo real.
2. Enviar un nuevo informe de prueba.
3. Revisar primero cualquier `falso_positivo`.
4. Si no hay falsos positivos, avanzar a Fase 2.
5. Si hay falsos positivos, endurecer la regla concreta que lo haya provocado.

## Criterio para ajustar reglas

Reglas que si conviene anadir:
- equivalencias repetidas en varios informes
- errores claros del reconocedor de voz
- variantes naturales que no cambian el sentido
- diferencias de tratamiento (`usted` / `tu`) cuando no cambian la intencion
- formas verbales equivalentes dentro del mismo contexto

Reglas que NO conviene anadir sin cuidado:
- equivalencias que eliminen una negacion
- sinonimos demasiado amplios
- reglas basadas en una unica transcripcion claramente contaminada
- bajadas generales del umbral para arreglar un caso aislado

## Flujo de analisis recomendado

1. Obtener informe:
   - endpoint: `/api/shared-script/intelligent-feedback`
   - usar `vercel curl` porque el preview esta protegido por Vercel
   - password de administracion por cabecera `x-song-admin-password`

2. Preparar resumen:
   - total de entradas
   - total de `auto_avance`
   - total de `linea_buena`
   - total de `falso_positivo`
   - media de puntuacion
   - puntuaciones minimas y maximas
   - falsos positivos agrupados por `issueType`

3. Clasificar casos:
   - `auto_avance` sin incidencia: mantener como validacion positiva
   - `linea_buena` con score bajo: candidato a nueva regla
   - `falso_positivo/corto_antes_de_tiempo`: revisar si el umbral o final de frase es demasiado permisivo
   - `falso_positivo/dije_mal_mi_frase`: no entrenar como frase equivalente
   - `falso_positivo/otro`: leer nota y decidir manualmente

4. Ajustar `src/utils/lineMatching.ts`.

5. Simular localmente los casos del informe antes de subir:
   - comprobar nuevo score
   - comprobar si autoavanzaria o no
   - asegurar que no se rompen negaciones

6. Validar:
   - `npx tsc --noEmit`
   - `npm run lint`
   - `npx expo export --platform web`

7. Subir a la rama y probar de nuevo en preview.

## Siguientes mejoras probables

### Analizador local de informes

Crear un script para convertir informes en una tabla util:
- linea
- personaje
- resultado
- incidencia
- score
- texto esperado resumido
- texto oido resumido
- recomendacion automatica

Esto evitaria revisar manualmente JSON grandes.

### Diccionario de equivalencias por obra

Si las diferencias Espana / Latinoamerica se repiten mucho, puede convenir separar:
- reglas globales
- reglas especificas de `Glee Newsies`
- variantes aceptadas por linea

### Entrenamiento por linea

Ya se guardan variantes locales al pulsar `Linea buena`.

Pendiente de decidir:
- si algunas variantes aceptadas deben poder sincronizarse con la obra compartida
- si deben validarse antes de ser reglas compartidas

## Riesgos a vigilar

- Safari/iPhone puede tener soporte limitado de reconocimiento de voz.
- El reconocimiento puede producir texto parcial antes de terminar la frase.
- Las frases cortas pueden dar falsos positivos si el umbral se relaja demasiado.
- Las negaciones no deben flexibilizarse.
- No conviene mezclar este modo con el avance por silencio durante la prueba.

## Archivos clave

- `src/components/RehearsalView.tsx`
- `src/hooks/useSpeechRecognition.ts`
- `src/utils/lineMatching.ts`
- `src/types/sharedScript.ts`
- `src/api/sharedScripts.ts`
- `api/shared-script/intelligent-feedback.js`
- `api/shared-script/_shared.js`

## Punto exacto para retomar

Retomar con validacion en dispositivo:
1. Probar la preview en un ensayo real.
2. Enviar un nuevo informe.
3. Revisar primero cualquier `falso_positivo`.
4. Si no hay falsos positivos, avanzar a Fase 2.
5. Si hay falsos positivos, endurecer la regla concreta que lo haya provocado.

## Analisis de informes 2026-05-10

Se han revisado los informes enviados el 2026-05-09 por la noche y el 2026-05-10.

Resumen:
- informe 2026-05-10: 49 entradas
- autoavances: 27
- lineas buenas manuales: 22
- falsos positivos marcados: 0
- tasa de autoavance: 55%
- media de score en autoavances: 99%
- media de score en lineas buenas manuales: 66%

Resumen del informe anterior:
- 42 entradas
- autoavances: 18
- lineas buenas manuales: 22
- reintentos: 2
- falsos positivos marcados: 0
- tasa de autoavance: 43%
- media de score en autoavances: 97%
- media de score en lineas buenas manuales: 69%

Lectura:
- la mejora ya va en buena direccion
- el sistema no esta generando falsos positivos en estos informes
- el problema principal ahora es conservadurismo: muchas lineas validas se quedan entre 60% y 85%
- hay un grupo de lineas con final perfecto y buena cobertura que deberian poder avanzar solas sin bajar el umbral global

## Patrones detectados

### 1. Regla de confianza alta por final perfecto

Hay lineas con:
- score entre 82% y 85%
- cobertura aceptable
- precision aceptable
- final de frase perfecto
- sin penalizacion de negacion

Estas lineas se quedan paradas por muy poco, pero parecen buenos candidatos a autoavance.

Plan:
- mantener el umbral general en 86%
- anadir una segunda via segura:
  - score >= 82%
  - coverage >= 75%
  - finalScore = 100%
  - precision >= 65%
  - sin penalizacion de negacion

Impacto estimado directo:
- recupera 5 lineas del informe del 2026-05-10
- recupera 1 linea del informe anterior
- subiria el informe del 2026-05-10 de 55% a aproximadamente 65% de autoavance, sin tocar sinonimos amplios

### 2. Espanol de Espana frente a latinoamericano

Se repiten diferencias de tratamiento y formulacion:
- `Oigan` / `oye`
- `les` / `os`
- `pasen la noche` / `pasar la noche`
- `tienen` / `teneis`
- `que tal si` / `que os parece`
- `le importa si` / `podriamos`

Plan:
- anadir equivalencias controladas para estas formas
- no tratarlas como sinonimos globales demasiado amplios
- preferir reglas de frase cuando sea posible

### 3. Nombres propios y transcripciones raras

El reconocedor sigue deformando nombres:
- `Medda` aparece como `meda`, `me da`, `medalla`
- `Snyder` aparece como `Snider`, `Sneider`, `Schneider`
- `Weasel` aparece como `Wisel`
- `Newsies` aparece como variantes foneticas
- `Specs` puede aparecer como `SpaceX` o similar
- `Jack Kelly` puede aparecer como una palabra parecida a un nombre comun

Plan:
- ampliar `TOKEN_ALIASES` y `PHRASE_ALIASES`
- tratar algunos nombres compuestos como unidad, por ejemplo `Jack Kelly`
- revisar especialmente `Medda`, porque aparece en varias lineas buenas manuales

### 4. Reacciones y sonidos no verbales

Hay casos tipo:
- `Woooow`
- `Shh`
- transcripciones como `uh` o `chist`

Plan:
- extender la normalizacion de reacciones
- incluir `chist` como equivalente de silencio/chistar
- revisar por que una linea con score 100 quedo como `linea_buena`; puede haber un bloqueo por `interimTranscript` persistente

### 5. Negaciones

La proteccion de negaciones es necesaria, pero hay dos casos a revisar:
- `por que no` puede ser una formula gramatical y no una negacion semantica fuerte
- a veces el reconocimiento anade ruido al final con palabras negativas despues de haber captado bien la frase

Plan:
- no relajar las negaciones globalmente
- estudiar reglas especificas:
  - no contar `no` dentro de `por que no` como negacion fuerte
  - si la frase ya esta completamente cubierta y el ruido negativo aparece al final, marcar como caso revisable, no autoavanzar aun

### 6. Parafraseo valido

Varias lineas buenas manuales no son errores de reconocimiento, sino frases dichas de forma natural con otras palabras.

Ejemplos de patron:
- `que pena` / `lo siento` / `lamento`
- `esta bien` / `vale` / `de acuerdo`
- `tiene que ser` / `debe tratarse`
- `me llevo cien` / `dame cien`
- `haganse un favor` / `haceos un favor`

Plan:
- anadir primero las equivalencias que aparezcan repetidas
- evitar sinonimos demasiado generales
- cuando la equivalencia sea muy de una linea concreta, preferir variante aceptada por linea antes que regla global

## Plan de implementacion propuesto

### Fase 1 - Recuperacion segura

Objetivo:
- subir autoavance sin aumentar falsos positivos

Cambios:
- anadir segunda via de autoavance por final perfecto
- ampliar aliases de nombres propios frecuentes
- normalizar `chist` / `shh`
- anadir equivalencias Espana-Latinoamerica de bajo riesgo
- limpiar mejor casos con `interimTranscript` persistente si el score ya es perfecto o muy alto

Validacion:
- simular contra los informes del 2026-05-09 y 2026-05-10
- contar cuantos `linea_buena` pasarian a `auto_avance`
- confirmar que no se autoavanzan casos con negacion dudosa

Objetivo numerico:
- pasar del 55% actual a 65-70% en el informe del 2026-05-10

### Fase 2 - Parafraseo controlado

Objetivo:
- reconocer mejor frases naturales que conservan intencion

Cambios:
- anadir equivalencias repetidas de parafraseo
- separar reglas globales de reglas especificas de `Glee Newsies`
- estudiar si conviene guardar variantes aceptadas compartidas, no solo locales

Objetivo numerico:
- acercarse a 75-80% de autoavance sin falsos positivos marcados

### Fase 3 - Herramienta de analisis

Objetivo:
- que cada nuevo informe sea mas facil de explotar

Crear script local que lea informes y produzca:
- resumen por resultado
- lineas manuales ordenadas por score
- falsos positivos agrupados por causa
- candidatos automaticos a nueva regla
- simulacion antes/despues de cambios

Archivo sugerido:
- `scripts/analyze-intelligent-feedback.js`

### Fase 4 - Afinado de UX de prueba

Objetivo:
- recoger datos mas precisos cuando algo falla

Posibles mejoras:
- permitir marcar tambien una `linea_buena` como:
  - frase valida pero app no avanzo
  - la dije diferente pero me vale
  - ruido de transcripcion
- mostrar si el bloqueo fue por score bajo, por negacion o por transcripcion parcial

## Fase 1 implementada

Cambios aplicados:
- segunda via segura de autoavance por final perfecto
- aliases para nombres propios y errores habituales de transcripcion
- equivalencias controladas Espana/Latinoamerica
- normalizacion de reacciones como `Shh` / `chist`
- permiso para avanzar con transcripcion parcial residual solo si el score ya es muy alto

Simulacion con informes reales:
- informe 2026-05-10: pasa de 27/49 autoavances a 39/49 proyectados, aproximadamente 80%
- informe 2026-05-09 noche: pasa de 18/42 autoavances a 24/42 proyectados, aproximadamente 57%
- informe 2026-05-09 tarde: pasa de 0/27 a 14/27 proyectados, aproximadamente 52%

Pruebas de seguridad:
- no hay falsos positivos marcados en los informes usados
- las frases con negacion omitida siguen bloqueadas
- una frase mixta con titulo en ingles sigue usando `es-ES`

Siguiente paso:
- subir preview y pedir un nuevo informe
- si no aparecen falsos positivos, pasar a Fase 2 con parafraseo controlado

## Fase 1.5 - Modo fluido por cierre de replica

Motivacion:
- en ensayo real prima mantener el ritmo
- en lineas largas es normal cambiar palabras sin cambiar la intencion practica de la replica
- lo mas importante para que entre el siguiente actor es llegar bien al cierre de la linea

Cambios aplicados:
- nueva razon de autoavance: `fluent_final`
- se calcula `finalPhraseScore` con las ultimas 5 palabras normalizadas de la linea
- se permite avanzar si:
  - la replica tiene al menos 6 palabras relevantes
  - las ultimas 5 palabras encajan al menos al 80%
  - la cobertura general es al menos 60%
  - la precision es al menos 50%
  - el orden mantiene un minimo de 45%
- las diferencias de negacion ya no bloquean esta via fluida
- el informe guarda metricas separadas para revisar despues:
  - `coverageScore`
  - `orderScore`
  - `finalScore`
  - `finalPhraseScore`
  - `precisionScore`
  - `negationPenaltyApplied`
  - `autoAdvanceReason`

Simulacion con informe 2026-05-11:
- informe: 63 entradas
- autoavances originales: 30
- lineas manuales recuperadas por `fluent_final`: 18
- autoavance proyectado: 48/63, aproximadamente 76%
- falsos positivos reportados en ese informe: 0

Objetivo de la siguiente prueba:
- comprobar si el ensayo se siente mas fluido
- revisar si aparecen falsos positivos tras usar `fluent_final`
- usar las nuevas metricas para separar ritmo de fidelidad al texto
