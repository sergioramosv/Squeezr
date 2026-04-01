# RTK vs Squeezr: Comparacion para No-Tecnicos

> Abril 2026 | Sin jerga, con ejemplos

---

## El problema que resuelven

Cuando usas un asistente de IA para programar (Claude, Copilot, Cursor...), cada vez que le envias un mensaje, la IA recibe **toda la conversacion anterior completa**. Es como si un empleado, cada vez que le pides algo nuevo, tuviera que releer TODOS los emails anteriores del hilo.

Despues de 50 mensajes, la IA esta releyendo el equivalente a un libro corto. Eso:
1. **Cuesta dinero** (pagas por todo lo que la IA lee)
2. **Se llena** (hay un limite de cuanto puede leer)
3. **Se vuelve lenta** (mas texto = mas tiempo de proceso)

**RTK** y **Squeezr** reducen ese texto. Pero lo hacen de forma muy diferente.

---

## Como funciona cada una

### RTK — El filtro de correo

RTK funciona como un filtro de spam para emails. Cada vez que ejecutas un comando (como "muestrame los cambios del codigo"), RTK limpia el resultado **antes de que la IA lo vea**: quita basura visual, repeticiones, y lineas innecesarias.

- Solo limpia el resultado del momento. No toca nada de lo anterior.
- Es gratis y rapidisimo.
- La IA nunca ve la basura.

### Squeezr — El asistente ejecutivo

Squeezr funciona como un asistente ejecutivo que:
1. **Limpia los resultados nuevos** (lo mismo que RTK — tiene los mismos filtros internos)
2. **Resume toda la conversacion pasada** usando una IA pequena y barata
3. **Comprime las instrucciones del sistema** (que pesan mucho y se repiten en cada mensaje)
4. **Se adapta**: si queda poco espacio, resume mas agresivamente

La diferencia clave: **Squeezr hace lo que RTK hace, y ademas limpia todo lo que ya se acumulo.**

---

## Analogia: La oficina

Imagina que la IA es un directivo que recibe informes cada hora.

**RTK** es un filtro en la impresora: cada informe nuevo sale limpio, sin paginas en blanco, sin headers repetidos, sin graficos decorativos. Pero los 49 informes anteriores que ya estan en la mesa del directivo siguen ahi, completos y pesados.

**Squeezr** es un asistente personal que:
- Tambien limpia cada informe nuevo (igual que el filtro)
- **Ademas** resume los informes viejos en post-its de una linea cada uno
- **Ademas** resume el manual de la empresa (que pesa 50 paginas) en media pagina
- Y si el directivo necesita el informe original, puede pedirlo y el asistente se lo trae

El resultado: con RTK la mesa tiene 50 informes limpios. Con Squeezr, la mesa tiene 3 informes recientes limpios, 47 post-its, y media pagina de manual.

---

## Comparacion directa

| Pregunta | RTK | Squeezr |
|---|---|---|
| **Limpia resultados nuevos?** | Si (77 filtros) | Si (31 filtros + 5 extras que RTK no tiene) |
| **Limpia conversacion pasada?** | No | Si (resume con IA barata) |
| **Comprime instrucciones del sistema?** | No | Si (ahorra ~95%) |
| **Se adapta segun el espacio?** | No | Si (4 niveles) |
| **Necesita instalacion?** | Minima (un archivo) | Facil (npm install + setup) |
| **Necesita Node.js?** | No | Si |
| **Cuesta dinero usarlo?** | No | Casi nada (~$0.0001 por compresion) o gratis con IA local |
| **Anade espera?** | No (<10ms) | Casi nada (~200ms, una vez, luego cacheado) |
| **Funciona con que?** | Claude, Copilot, Cursor, Gemini, Windsurf, Cline | Claude, Gemini, Aider, Codex, OpenCode, Ollama |

---

## Numeros que importan

Imagina una sesion de trabajo de 50 mensajes:

| Concepto | Sin nada | Con RTK | Con Squeezr |
|---|---|---|---|
| Instrucciones del sistema | 13,000 palabras | 13,000 palabras | ~600 palabras |
| Resultado del comando actual | ~3,000 palabras | ~600 palabras | ~600 palabras |
| 47 mensajes anteriores | ~134,000 palabras | ~134,000 palabras | ~15,000 palabras |
| **Total que la IA lee** | **~150,000** | **~147,600** | **~16,200** |
| **Ahorro** | — | **~1.6%** | **~89%** |

En sesiones cortas (5 mensajes) ambos rinden parecido. **En sesiones largas, Squeezr marca una diferencia enorme** porque el 90% del peso esta en el historial, y RTK no lo toca.

---

## Pros y Contras

### RTK

**Lo bueno:**
- Rapidisimo, cero espera
- Totalmente gratis, siempre
- No necesita nada instalado (un solo archivo)
- Funciona con muchos editores: Copilot, Cursor, Windsurf, Cline...
- 77 filtros para casi cualquier herramienta de desarrollo
- Facil de extender (se anaden filtros sin saber programar en Rust)

**Lo malo:**
- Solo limpia el resultado actual — no toca lo anterior
- No comprime las instrucciones del sistema
- No se adapta segun cuanto espacio queda
- En sesiones largas, apenas ahorra (~1.6% en 50 mensajes)

### Squeezr

**Lo bueno:**
- Incluye los mismos filtros que RTK (no necesitas ambos)
- Ademas comprime TODO: historial, instrucciones, resultados
- Se adapta automaticamente segun cuanto espacio queda
- Invisible una vez instalado (no cambias tu forma de trabajar)
- Puede ser 100% gratis con IA local (Ollama)
- Si la IA necesita el contenido original, puede recuperarlo (`squeezr_expand`)
- 190 tests automatizados verifican que funciona correctamente
- Ahorro masivo en sesiones largas (~89% en 50 mensajes)

**Lo malo:**
- Necesita Node.js instalado
- Tiene un coste minimo por usar IA barata (salvo con IA local)
- No funciona con Cursor, Copilot ni Windsurf
- Necesita un servicio corriendo en segundo plano
- No cubre Ruby, .NET ni herramientas cloud (que RTK si cubre)

---

## Cual elegir?

### Elige RTK si:
- Usas **Cursor, Copilot, Windsurf o Cline** (Squeezr no los soporta)
- Tus sesiones son siempre cortas (menos de 10 mensajes)
- No quieres ningun proceso extra corriendo

### Elige Squeezr si:
- Usas **Claude Code, Aider, Codex, Gemini CLI u OpenCode**
- Tus sesiones son largas (mas de 10 mensajes)
- Quieres maximizar el ahorro de tokens y dinero
- Quieres algo que funcione sin cambiar tu forma de trabajar

### No necesitas ambos:
- Squeezr ya incluye internamente los mismos filtros que RTK
- Usar RTK encima de Squeezr aportaria un beneficio marginal
- La unica razon para usar RTK si ya tienes Squeezr es si tambien usas editores que Squeezr no soporta

---

## Conclusion

| | RTK | Squeezr |
|---|---|---|
| **En una palabra** | Filtro | Motor de compresion |
| **Que hace** | Limpia resultados nuevos | Limpia resultados nuevos + resume todo lo anterior |
| **Fuerte en** | IDEs, zero-config, gratis | Sesiones largas, ahorro masivo, adaptativo |
| **Debil en** | Sesiones largas (no toca historial) | IDEs como Cursor/Copilot |

**Squeezr hace todo lo que RTK hace y le suma capas encima.** La unica ventaja real de RTK es que soporta editores que Squeezr no (Cursor, Copilot, Windsurf). Para todo lo demas, Squeezr es la opcion mas completa.
