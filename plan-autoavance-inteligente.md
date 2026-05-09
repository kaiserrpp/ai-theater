# Plan - Autoavance inteligente

Fecha de actualizacion: 2026-05-10
Rama de trabajo: `codex/intelligent-line-advance`
Ultimo commit subido: `844ef1b Capture intelligent advance incidents`
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

## Informe pendiente de revisar

El usuario ha enviado un informe del ultimo ensayo el 2026-05-10.

Tarea para manana:
1. Leer el ultimo informe desde el endpoint protegido.
2. Separar las entradas por `result`.
3. Revisar primero los `falso_positivo`.
4. Revisar despues los `linea_buena` con puntuacion baja o media.
5. Detectar patrones:
   - equivalencias Espana / Latinoamerica
   - usted / tu
   - nombres propios
   - numeros
   - frases dichas en otro orden
   - finales de frase mal reconocidos
   - falsos positivos por transcripcion parcial
6. Convertir solo los patrones fiables en reglas.
7. No bajar el umbral global salvo que los datos lo justifiquen.

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

Manana empezar por el informe nuevo:
1. Leer `latestReport`.
2. Sacar tabla de resultados.
3. Revisar falsos positivos.
4. Revisar lineas buenas que no autoavanzaron.
5. Proponer reglas concretas.
6. Implementar solo reglas seguras.

