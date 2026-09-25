# MINDS//WORK sobre Bernried

## Decisión y alcance

Conservar el Project Hub actual y añadir una capa de memoria. El prototipo 0.1 está aislado en un iframe y se activa únicamente con `?minds=1`. No requiere compilación, dependencias nuevas, migraciones ni cambios de alojamiento.

El único cambio en `index.html` son dos líneas al final: un comentario y la carga diferida de `minds/bridge.js`. Sin el parámetro, el módulo termina sin modificar la página. `terminplan.html`, planos, imágenes, modelo, login y operaciones de Supabase mantienen su código original.

Base revisada: `cd3c39170a4d7d480860176404b6e80918a74467`. Inspección del repositorio y de la página publicada realizada el 24–25 de septiembre de 2026. El repositorio contiene dos HTML y assets, sin framework, herramientas de compilación ni migraciones de base de datos.

## Qué existe y qué conservar

| Pieza actual | Función | Integración propuesta |
| --- | --- | --- |
| `index.html` | Navegación, planos, modal PDF, imágenes, modelo D5 y contacto | Mantener las seis vistas e incorporar una entrada opcional MINDS |
| Supabase desde el Hub | Lee `projects`, `documents`, `images`; Auth y bucket `project-hub` para administración | Reutilizar identidad y proyecto en una fase posterior, con autorización verificada |
| Archivos en `assets/` | Siete planos PDF y sus miniaturas, portada y visualizaciones | Enlazar las fuentes; evitar copias y una segunda lista editorial |
| `terminplan.html` | Calendario LPH 3; edición, exportación JSON/CSV e impresión | Conservarlo como herramienta; MINDS solo guarda un enlace en 0.1 |
| Estado local del calendario | `bernried_lph3_terminplan_v13` y `bernried_lph3_ui_v13` | MINDS no lee ni escribe esas claves |

El calendario publicado muestra un período 27.07–27.11.2026, 33 tareas y 12 hitos. Son datos visibles del calendario, no una confirmación de que describan el estado real del proyecto hoy. El Hub puede reemplazar ese calendario por un HTML o PDF remoto; no se debe deducir el calendario vigente exclusivamente del archivo Git.

## Arquitectura concreta

```text
Project Hub existente en GitHub Pages
  ├─ planos / imágenes / modelo / calendario / contacto / Admin
  └─ ?minds=1 → bridge.js → iframe minds/index.html
                              ├─ app.js: interfaz y captura
                              ├─ core.js: validación, búsqueda, almacenamiento
                              └─ sources.json: catálogo público de respaldo
```

El puente es el único adaptador que conoce las variables del Hub (`docs`, `LOCAL_DOCS`, `storageUrl`). Lee lo que el Hub ya ha cargado; no hace consultas nuevas a Supabase y no envía tokens al iframe. Intercambia mensajes únicamente con el iframe esperado y el mismo origen. La interfaz de MINDS no utiliza las clases de navegación del Hub.

Contrato: solicitud `minds:request-context`; respuesta `minds:context` con `project`, `projectName`, `capturedAt`, `note` y `sources[]`. Cada fuente incluye `id`, `title`, `url`, `kind`, `meta`, `version`, `capturedAt` y `mode`. Los modos distinguen la visualización del Hub, su fallback y el catálogo tomado del repositorio. Se actualiza al entrar en MINDS o al pulsar **Quellen aktualisieren**, sin sondeo continuo. Si la carga del Hub sigue pendiente, se etiqueta el fallback.

El registro conserva una copia del **verweis/referencia**, no una copia inmutable del contenido del documento. Su fecha de captura no equivale a fecha de aprobación. Un enlace puede mostrar otra versión si se reemplaza el archivo. La fuente elegida al abrir el formulario queda fijada durante esa edición; actualizar el catálogo no cambia silenciosamente el documento asociado a una nota.

### Implementado en 0.1

- **Today:** puntos abiertos, preguntas y decisiones sin fecha, y cualquier entrada pendiente con fecha hasta siete días después de hoy, incluidos vencidos. Usa el día local.
- **Memory:** búsqueda por palabras en título, contexto, responsables, referencias, alternativas y consecuencias; notas, experiencias/errores y procedimientos.
- **Decisions:** contexto, alternativas, consecuencias, participantes y fuente.
- **Questions:** captura manual de preguntas y contador de títulos repetidos. No captura actividad de otros servicios ni guarda respuestas de IA automáticamente.
- **Sources:** enlaces a los siete planos, calendario y modelo que ya conoce el Hub. No extrae texto ni interpreta PDFs.
- Creación, edición, cierre/reapertura, archivo/restauración y copia JSON. No hay borrado definitivo en la interfaz.

El formato es `{schemaVersion:1, project:'bernried', entries:[...]}`. Cada entrada tiene ID, tipo, estado, título, contexto, alternativas, consecuencias, responsable, fecha de seguimiento, referencia, fuente opcional, fechas de creación/edición y marca de archivo. La persistencia usa exclusivamente `minds_work_bernried_v1`.

Importar añade IDs nuevos sin sobrescribir los existentes. Rechaza proyecto o versión incorrectos, IDs duplicados, campos inválidos, URLs ejecutables y archivos mayores de 2 MB. Los errores de almacenamiento no anuncian un guardado exitoso ni sustituyen el estado anterior. Hay detección de cambios de otra pestaña antes de escribir, pero el piloto no es un sistema colaborativo ni una base de datos con transacciones. Se recomienda una sola pestaña de edición.

### Memoria compartida: siguiente entrega

El siguiente paso es sustituir el almacenamiento local por un repositorio de datos con este modelo, sin cambiar las pantallas:

| Entidad propuesta | Campos y finalidad |
| --- | --- |
| `project_members` | `project_id`, `user_id`, rol; clave única por proyecto y usuario |
| `minds_entries` | Campos del piloto más `project_id`, autor, visibilidad y versión para detectar ediciones concurrentes |
| `minds_sources` | Identidad estable de cada fuente; referencia a `documents.id` cuando exista |
| `minds_source_versions` | Versión inmutable, hash del contenido, ubicación privada, fecha, página y autor de la ingestión |
| `minds_entry_sources` | Relación entre memoria y una o varias versiones concretas de las fuentes |
| `minds_events` | Historial de cambios, confirmaciones, archivo y restauración |

Antes de implementarlo hay que inspeccionar el esquema y las políticas reales del proyecto Supabase: esos permisos no aparecen en el repositorio. La UI actual muestra Admin al existir cualquier sesión; esto no demuestra autorización por proyecto. No se ha aplicado ni auditado ninguna política de producción en esta entrega.

Las tablas nuevas deben exigir membresía en el proyecto en cada operación, con RLS y permisos SQL mínimos. `anon` no tendrá acceso a la memoria interna. `UPDATE` necesita autorización tanto sobre la fila existente como sobre el resultado, impidiendo moverla a otro proyecto. La pertenencia no será editable por cualquier cliente. Probar usuario desconectado, miembro y no miembro, además de aislamiento entre proyectos. Los archivos internos requieren un bucket privado y acceso autorizado; el bucket público actual no debe convertirse en almacén de correo o protocolos internos. Referencias: [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security) y [buckets públicos y privados](https://supabase.com/docs/guides/storage/buckets/fundamentals).

### Ask MINDS y captura futura

1. **My project memory:** recuperación filtrada por permisos y versiones, respuestas con citas a página/fragmento y declaración explícita cuando falte evidencia. Empezar con búsqueda textual antes de incorporar búsqueda semántica.
2. **Beyond my memory:** investigación externa por una ruta distinta; fuentes externas y fecha visibles. Una respuesta no pasa a ser decisión o experiencia propia sin una acción explícita de confirmación.

La llamada a modelos y la ingestión de PDFs/correo irán en una función de servidor, con credenciales solo del lado del servidor, límites y registro de actividad. Las respuestas, preguntas, propuestas y hechos confirmados son entidades distintas. El calendario puede integrarse después mediante su exportación JSON, como copia fechada de solo lectura; no inicializar un segundo calendario para extraer tareas, pues `render()` escribe en su almacenamiento local.

## Probar y revertir

Desde una copia completa de esta rama, servir la carpeta por HTTP, por ejemplo con `python -m http.server 8000 --bind 127.0.0.1`. Abrir `/index.html?minds=1#minds`; `/minds/index.html` abre el módulo independiente con el catálogo del repositorio. Abrir `/index.html` sin parámetro conserva la experiencia habitual. Estas rutas corresponden a la rama; no están publicadas automáticamente por crear el PR.

Para desactivar la prueba, quitar `?minds=1`. Para retirarla del código, revertir este commit o eliminar las dos líneas añadidas y los archivos de MINDS. No hay esquema ni datos de servidor que revertir. Exportar las notas antes de cambiar de navegador/origen o borrar datos del navegador; una rama o puerto distinto no migra el almacenamiento automáticamente.

**Límite del piloto:** localStorage no es cifrado, no está asociado a una cuenta y puede ser leído por código del mismo origen. El iframe aísla estilos y ejecución normal, no es una frontera de seguridad. La opción `?minds=1` tampoco es autenticación. Usar contenido de prueba o no confidencial hasta conectar la memoria privada con autorización de servidor. No subir exports de notas al repositorio público.

## Verificación

- `node --test tests/minds-core.test.cjs tests/minds-app.test.cjs`: 12 pruebas de persistencia, recuperación JSON, validación, búsquedas, fechas, cuotas, conflicto entre pestañas y dos regresiones de pérdida de datos/referencias durante operaciones asíncronas.
- Inspección del portal publicado: navegación de planos y calendario; contexto y cifras del calendario revisados visualmente.
- Prueba local en navegador: crear y editar una decisión con fuente; recargar; archivar y restaurar; buscar; rechazar un JSON de otro proyecto. El texto con etiquetas HTML se muestra como texto. Navegación de las seis vistas originales e Inicio, apertura y cierre de los visores PDF e imagen; diseño de escritorio y móvil sin desbordamiento horizontal de la página MINDS.
- Comparación contra la base: solo dos líneas añadidas a `index.html`; `terminplan.html` permanece idéntico. Los assets no forman parte del cambio.
- Incidencia preexistente identificada: `saveData()` en `terminplan.html` intenta actualizar `#saveState`, pero el HTML no contiene ese elemento. Puede producir un error tras guardar localmente. No se corrige en este PR para mantener el cambio de MINDS aislado.

Las operaciones administrativas que modifican Supabase no se ejecutan como prueba. No se ha fusionado la rama ni desplegado esta versión.
