# MINDS//WORK sobre Bernried

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