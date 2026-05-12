# Squeezr para Cursor — Guía para no técnicos

## El problema: tu dinero se va en repetición

Cada vez que escribes un mensaje en Cursor, la app no manda solo tu pregunta al modelo de IA. Manda **todo** esto junto:

- Tu mensaje nuevo
- **Todos los mensajes anteriores de la conversación** (aunque sean de hace 20 minutos)
- El contenido de los ficheros abiertos
- Las reglas de tu proyecto (`.cursorrules`)
- Las herramientas MCP conectadas
- El sistema interno de Cursor

Una pregunta simple de "¿cómo mejoro esta función?" puede consumir **50.000 tokens** porque arrastra todo ese historial y contexto — aunque el 80% sea información que ya procesó antes y no ha cambiado.

**Y desde junio 2025, Cursor cobra por tokens consumidos.** Los $20/mes del plan Pro = $20 de crédito que se gasta según cuántos tokens mandes. Una sesión de agente larga puede costarte $0.15–$0.50 de crédito. En conversaciones intensas, $20 dura menos de una semana.

---

## Qué hace Squeezr

Squeezr se pone en medio entre Cursor y los servidores de Anthropic/OpenAI, **antes de que el mensaje salga**. Intercepta cada request y:

```
Tu Cursor  →  [Squeezr]  →  api5.cursor.sh
              comprime
              el contexto
              aquí
```

### Lo que comprime

**Turnos antiguos de conversación**
Los mensajes de hace 10+ turnos contienen información redundante. Squeezr los resume usando el propio cursor-small (el modelo barato de Cursor) y cachea el resultado. La próxima vez que aparezca ese mismo turno en el historial, ya está comprimido y listo.

**Ficheros que se repiten request tras request**
Si tienes abierto `auth.ts` en cada mensaje de la sesión, Cursor lo manda entero cada vez. Squeezr lo comprime la primera vez, cachea la versión reducida por hash del contenido, y la usa en todas las requests siguientes.

**JSON verboso del editor**
Cursor incluye internamente dos versiones de cada mensaje: el texto plano y una versión en formato JSON del editor (más grande). Squeezr elimina la versión JSON de los mensajes viejos porque ya existe el texto plano — zero pérdida de información.

### Lo que NO toca

- Tus mensajes nuevos (el que acabas de escribir)
- Los últimos 3 turnos de conversación (necesarios para que el modelo tenga contexto reciente)
- Las respuestas del modelo (solo comprime lo que tú mandas)
- Nada de otras apps ni del proxy de Claude Code

---

## Cuánto ahorra

| Situación | Tokens sin Squeezr | Tokens con Squeezr | Ahorro |
|---|---|---|---|
| Conversación corta (5 turnos) | ~15K | ~14K | ~7% |
| Conversación media (15 turnos) | ~50K | ~25K | ~50% |
| Sesión de agente larga (30+ turnos) | ~120K | ~40K | ~67% |

**En dinero (plan Pro, modelo Auto):**
- Sin Squeezr: ~320 requests con $20
- Con Squeezr (conversaciones largas): ~600–700 requests con $20
- En modelos premium (Claude Sonnet): de ~133 requests a ~266+

---

## Cómo funciona el cache

La primera vez que Squeezr ve un texto (un turno de conversación, un fichero), lo pasa sin cambios y lanza en segundo plano una llamada a cursor-small para comprimirlo. Este proceso tarda unos segundos y no interfiere con tu respuesta.

La **segunda vez** que ese mismo contenido aparece en un request (que es casi siempre, porque Cursor arrastra el historial), Squeezr ya tiene la versión comprimida guardada y la aplica instantáneamente.

```
Request 1:  "Cómo mejoro esta función?"
  → historial sin comprimir → Squeezr pasa sin tocar
  → en background: comprime turnos 1-10 con cursor-small → guarda

Request 2:  "Vale, ahora refactoriza también el servicio"  
  → historial: turnos 1-10 ya comprimidos en cache ✓
  → Squeezr aplica compresión → manda 40% menos tokens
  → la respuesta llega antes, gastas menos crédito
```

---

## Setup (una sola vez)

1. Ejecutar `squeezr setup --cursor` — añade una línea al fichero `hosts` de Windows y genera un certificado TLS local
2. Reiniciar Cursor
3. Ya está — sin configurar nada más en Cursor

El certificado hace que Cursor confíe en el proxy local igual que confiaría en los servidores de Anthropic. Todo el tráfico sigue cifrado end-to-end.

---

## Preguntas frecuentes

**¿Afecta a la calidad de las respuestas?**
No. Squeezr solo comprime los turnos *viejos* de la conversación, no el contexto reciente. El modelo sigue teniendo toda la información relevante; solo se elimina la redundancia verbal de los mensajes antiguos.

**¿Se envían mis datos a algún servidor de Squeezr?**
No. El proxy corre 100% local en tu máquina. Los únicos servidores que reciben datos son los mismos de siempre: los de Cursor/Anthropic/OpenAI.

**¿Funciona con todos los modelos de Cursor?**
Sí — Claude, GPT, Gemini. Todos pasan por el mismo proxy y todos se benefician de la misma reducción de contexto.

**¿Afecta al Tab Completion o al autocompletado?**
No. Tab Completion usa un endpoint diferente que Squeezr no intercepta.
