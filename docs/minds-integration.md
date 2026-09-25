# MINDS//WORK sobre Bernried

## Estado actual: Pilot 0.3 · Private Memory

El Pilot 0.3 mueve **Memory, To-Dos, Mail y conversaciones** fuera de `localStorage` y los persiste en el proyecto Supabase `Bernried Project Hub`.

La interfaz sigue alojada en GitHub Pages, pero el contenido privado no está en el repositorio. El navegador utiliza únicamente la publishable key; la protección real se aplica en PostgreSQL mediante Row Level Security y en Storage mediante un bucket privado.

### Seguridad implementada

- tablas privadas: `minds_entries`, `minds_mails`, `minds_conversations`, `minds_messages`, `minds_mail_files`, `minds_events`;
- todas las tablas tienen RLS;
- `anon` no tiene permisos sobre las tablas MINDS;
- acceso condicionado a pertenencia del usuario autenticado en `project_admins`;
- las conversaciones son además privadas por usuario;
- bucket `minds-private` con `public = false`;
- acceso a objetos limitado a usuarios autorizados del proyecto cuyo slug coincide con la primera carpeta del objeto;
- archivos de correo se almacenan bajo `bernried/mail/<mail-id>/...`;
- la service-role key no aparece en el frontend;
- cambios relevantes generan eventos append-only en `minds_events`.

### Migración desde el Pilot 0.2

Al abrir MINDS por primera vez después de esta actualización, el cliente busca las claves locales antiguas `minds_work_bernried_v1` y `minds_work_bernried_mail_v1`. Si contienen datos, los migra una vez a Supabase y marca localmente que la migración se completó. Los datos locales antiguos no se borran automáticamente.

### Qué cambia para el usuario

- To-Dos, Memory y Mail dejan de depender del navegador;
- las conversaciones MINDS se conservan en Supabase;
- iniciar un nuevo Gespräch archiva la conversación anterior en vez de borrarla;
- Mail permite texto privado y adjuntos en Storage privado;
- la búsqueda actual sigue siendo determinista sobre los registros del proyecto;
- todavía no hay LLM conectado ni lectura automática de adjuntos/PDF.

### Regla epistemológica

Se mantiene la separación entre PROJECT MEMORY, OFFICE MEMORY (futuro), EXTERNAL / NORMATIVE (futuro) y MINDS SUGGESTION.

### Siguiente fase

El siguiente salto es ingestión estructurada de emails/documentos, citación de fragmentos, búsqueda semántica/full-text, conexión de un LLM para My project memory, Beyond my memory separado, redacción contextual de emails y recordatorios/recurrencias.

---

## Registro del Pilot 0.2


## Estado actual: Pilot 0.2

MINDS//WORK ya no se concibe como una base de datos que el Projektleiter debe mantener manualmente. La interfaz visible es un **asistente de proyecto**; Memory, Decisions, Questions y Sources siguen existiendo, pero pasan a segundo plano como órganos internos del sistema.

Bernried es el primer proyecto vivo con el que se prueba esta arquitectura.

## Qué conserva del Project Hub

El portal existente sigue siendo la superficie para Grundrisse, Schnitte und Ansichten, 3D Modell, Terminplan, Images y Kontakt / Admin.

`terminplan.html`, planos, imágenes y modelo no se reescriben. `minds/bridge.js` añade la entrada `MINDS//WORK` y reutiliza la sesión Supabase existente como **puerta de interfaz**.

> Importante: esta puerta no constituye todavía una frontera de seguridad suficiente para datos confidenciales. La memoria del Pilot 0.2 sigue en `localStorage`. Antes de cargar correo real o información sensible hay que mover memoria y archivos privados a Supabase con RLS y bucket privado.

## Experiencia visible

### MINDS

Es la pantalla principal. Funciona como interfaz conversacional sobre el contexto ya almacenado. El prototipo puede resumir To-Dos abiertos, mostrar asuntos en espera, recuperar decisiones, buscar contexto en Memory y Mail, registrar cada pregunta como `AI Question Signal`, detectar títulos/palabras que reaparecen y reconocer órdenes sencillas de creación de To-Do en alemán o español pidiendo confirmación antes de guardar.

No hay un modelo LLM conectado. Las respuestas actuales son recuperación determinista sobre el corpus local y sirven para validar interacción, ontología y memoria antes de conectar IA viva.

### To-Dos

Los To-Dos son entradas de memoria de tipo `task`, no una lista aislada. Conservan título, estado, fecha, responsable, contexto, fuente de proyecto y referencia. Se muestran como Board con **Offen / Wartet / Erledigt**.

### Mail

Se añadió una bandeja de correspondencia de proyecto para validar búsqueda por remitente, asunto y cuerpo, consulta desde MINDS y la relación futura email → decisión → To-Do → documento.

En 0.2 la entrada es manual y local. **No usar correo confidencial real todavía.**

### Memory

La memoria anterior no desaparece. Pasa a una vista secundaria para inspeccionar y corregir decisiones, experiencias / errores, procedimientos, preguntas a AI, notas y fuentes.

## AI Question Signals

Toda pregunta hecha desde la interfaz MINDS se guarda como entrada `question`. El Pilot detecta preguntas exactamente repetidas y palabras relevantes que aparecen en más de una pregunta. En una versión con IA/embeddings, las señales deberán agrupar intenciones semánticamente relacionadas.

Las preguntas son evidencia de interés, incertidumbre o fricción cognitiva; **no son automáticamente decisiones ni conocimiento confirmado**.

## Arquitectura actual

```text
GitHub Pages / Project Hub
  ├─ public project surfaces
  ├─ Supabase Auth (existing Admin login)
  └─ minds/bridge.js
       ↓ authenticated UI entry
      minds/index.html
       ├─ Assistant
       ├─ To-Dos
       ├─ Mail
       └─ Memory
            ├─ core.js: validation / retrieval / signals
            ├─ app.js: interaction
            └─ localStorage (pilot only)
```

Claves locales:

- `minds_work_bernried_v1` → memoria / To-Dos / decisiones / preguntas;
- `minds_work_bernried_mail_v1` → correo de prueba.

El backup v0.2 exporta ambas colecciones en un JSON conjunto. El import sigue aceptando el backup v0.1 de Memory.

## Regla epistemológica

MINDS debe mantener separadas cuatro capas:

1. **PROJECT MEMORY** — información explícitamente registrada o derivada de fuentes internas.
2. **OFFICE MEMORY** — precedentes de otros proyectos; todavía no implementado.
3. **EXTERNAL / NORMATIVE** — DIN, BayBO, fabricantes, bibliografía, web; todavía no implementado.
4. **MINDS SUGGESTION** — inferencia o propuesta del asistente, nunca presentada como hecho confirmado.

## Siguiente capa técnica

Antes de conectar un LLM, mover el almacenamiento privado a Supabase con tablas para membresías, entradas/eventos, fuentes/versiones, correo/adjuntos y conversaciones/mensajes.

Requisitos: RLS por proyecto y usuario; `anon` sin acceso a memoria interna; bucket privado; provenance y versiones inmutables; historial append-only; ninguna service-role key en cliente.

Después: ingestión de PDFs/emails; búsqueda full-text y semántica; `My project memory` con respuestas citadas; `Beyond my memory` separado; redacción contextual de emails; recordatorios/recurrencias; memoria transversal entre proyectos; resurfacing de errores, decisiones y precedentes.

## Qué NO está implementado todavía

- IA viva / LLM;
- consulta real de DIN/Normen;
- lectura automática de PDFs;
- Outlook / Teams / Planner;
- reminders del sistema;
- tareas recurrentes;
- memoria entre proyectos;
- sincronización entre dispositivos;
- almacenamiento confidencial seguro;
- autorización granular por proyecto.

## Principio de producto

```text
hablar → entender → proponer → confirmar → actuar → recordar → anticipar
```

El Projektleiter no debe decidir de antemano si algo es `Decision`, `Question` o `Memory`. La conversación es la entrada principal; la estructura es infraestructura.

## Reversibilidad

Todo el trabajo permanece en la rama `codex/minds-work-pilot` y en el PR de borrador. `main` y la página publicada no cambian hasta fusionar. El Pilot puede retirarse eliminando la carga de `minds/bridge.js` y la carpeta `minds/`.
## Pilot 0.4 · Planner Board + Indexed Memory

### To-Dos: Buckets statt Status-Spalten

Die Board-Ansicht folgt jetzt dem Organisationsprinzip von Microsoft Planner: Buckets sind frei benennbare Arbeitsbereiche. Status ist ein Attribut der Aufgabe und nicht mehr die Spaltenstruktur.

Implementiert:

- frei anlegbare, umbenennbare und archivierbare Buckets;
- Reihenfolge per `Nach links` / `Nach rechts`;
- Aufgabe direkt innerhalb eines Buckets hinzufügen;
- Drag & Drop von Aufgaben zwischen Buckets;
- Board- und Rasteransicht;
- Filter nach Status und Textsuche;
- Priorität, Fälligkeit, Verantwortliche und Checkliste als Task-Metadaten;
- Completed bleibt im Bucket und kann über Statusfilter ein-/ausgeblendet werden.

Die Daten liegen in `minds_buckets`; Tasks referenzieren `bucket_id`. Bucket und Status bleiben bewusst orthogonal.

### Ingestion foundation

Für die nächste MINDS-Stufe wurden zusätzlich `minds_sources` und `minds_chunks` eingeführt. Beide sind projektprivat und RLS-geschützt.

Beim Speichern einer E-Mail wird ihr Body jetzt automatisch:

1. als Source mit Origin `mail` registriert;
2. deterministisch in Text-Chunks zerlegt;
3. mit Provenance (`mailId`, Subject, Sender, Datum) gespeichert;
4. über PostgreSQL Full-Text Search auffindbar.

Bestehende E-Mails werden beim ersten Start von 0.4 einmalig indexiert. Die Assistenz kann den Quellenindex bereits als Fallback durchsuchen.

**Noch nicht implementiert:** PDF-Textextraktion, OCR, Embeddings/Vector Search und LLM-Antworten. Das Schema ist so angelegt, dass diese Schichten folgen können, ohne E-Mail- oder Task-Memory erneut umzubauen.

Die geplante Pipeline bleibt:

`source → extraction → chunks + provenance → lexical/semantic retrieval → LLM answer → citations`
