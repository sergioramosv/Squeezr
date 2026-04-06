# Cómo funciona Squeezr con Cursor IDE

> Documento técnico de referencia — para entender qué hace falta, por qué, y qué puede fallar.

---

## Por qué Cursor es diferente a Claude Code

Claude Code, Aider, y Gemini CLI son CLIs. Leen env vars del shell y hacen sus llamadas HTTP directamente desde tu máquina. Squeezr les pone `ANTHROPIC_BASE_URL=http://localhost:8080` y eso es todo.

Cursor es una **app Electron** (Chromium + Node.js). Tiene dos capas:

```
Tu teclado
    ↓
Cursor Electron (renderer Chromium)
    ↓
Cursor backend servers (api2.cursor.sh)  ← aquí es donde se hace la llamada LLM por defecto
    ↓
Anthropic / OpenAI
```

Cuando usas los modelos propios de Cursor (plan de Cursor), la llamada LLM la hacen **sus servidores**, no tu máquina. Ahí localhost es imposible.

---

## El modo que SÍ permite interceptar: BYOK + Override Base URL

Cuando pones **tu propia API key** en Cursor (BYOK = Bring Your Own Key), el flujo cambia:

```
Cursor Electron (renderer)
    ↓
http://TU-ENDPOINT/v1/chat/completions  ← llama directo desde tu app
    ↓
Tu API Key → Anthropic / OpenAI
```

En este modo, **Cursor llama al endpoint desde la app en tu máquina**, no desde sus servidores. Esto significa que `localhost:8080` debería funcionar... con una condición.

---

## El problema de CORS

Cursor corre en Chromium. Chromium aplica CORS igual que un navegador web. Antes de cada POST, manda un `OPTIONS` (preflight):

```
OPTIONS http://localhost:8080/v1/chat/completions
Origin: http://cursor.sh
Access-Control-Request-Method: POST
Access-Control-Request-Headers: authorization, content-type
```

Si el servidor no responde con los headers CORS correctos → Chromium bloquea la request → Cursor no puede conectar.

**Squeezr 1.17.2 ya tiene el CORS middleware** que responde correctamente a ese OPTIONS. Este era el obstáculo principal.

---

## ¿Necesito tunnel o no?

| Situación | ¿Funciona localhost? |
|-----------|---------------------|
| Modelos propios de Cursor (plan Cursor) | ❌ No — la llama hacen sus servidores |
| BYOK con OpenAI key | ✅ Probablemente sí con CORS |
| BYOK con Anthropic key | ✅ Probablemente sí con CORS |
| Modelos custom que tú definas | ✅ Probablemente sí con CORS |

**Intentar primero sin tunnel.** Si Cursor da error de conexión o CORS → usar `squeezr tunnel`.

El tunnel resuelve además el caso donde Cursor sí delega al servidor remoto aunque estés en BYOK (comportamiento que puede variar entre versiones de Cursor).

---

## Setup paso a paso

### Paso 1: Asegúrate que Squeezr está corriendo

```bash
squeezr start
squeezr status   # debe decir "running"
```

### Paso 2: Configura Cursor

Abre Cursor → `Cmd+Shift+J` (Settings) → **Models**

#### 2a. Pon tu API key

- **OpenAI API Key**: pon tu key de OpenAI (`sk-...`)  
  O bien  
- **Anthropic API Key**: pon tu key de Anthropic (`sk-ant-...`)

Sin una API key propia, el Override Base URL no tiene efecto (Cursor usa sus propios modelos con su propia auth).

#### 2b. Activa Override OpenAI Base URL

En la sección de OpenAI, activa el toggle **"Override OpenAI Base URL"** y pon:

```
http://localhost:8080/v1
```

> ⚠️ **Bug conocido de Cursor**: cuando activas Override Base URL, Cursor intenta mandar TODOS los modelos (incluidos los built-in de Cursor) a esa URL, y fallan. La solución es desactivar los modelos built-in de Cursor.

#### 2c. Desactiva los modelos built-in de Cursor

En la lista de modelos, **desactiva** (toggle off) todos los modelos que no sean el tuyo:
- `cursor-small`, `cursor-fast` → off
- `claude-3-5-sonnet`, `gpt-4o` (versiones de Cursor) → off

Deja solo activados los modelos que llamen a tu endpoint.

#### 2d. Añade un modelo custom (opcional pero recomendado)

Abajo del todo en Models → **"Add model"**:
- Model name: `gpt-4o` (o el que use tu API key)
- Esta es la entrada que realmente pasará por Squeezr

### Paso 3: Prueba

Abre un chat en Cursor (Cmd+L) y escribe algo. Si funciona → terminado.

Si da error de conexión → sigue al Paso 4 (tunnel).

---

## Si localhost no funciona: usar el tunnel

```bash
squeezr tunnel
```

Esto levanta un **Cloudflare Quick Tunnel** (gratis, sin cuenta, sin instalar nada extra):

```
Squeezr proxy (localhost:8080)
    ↑
cloudflared (proceso local)
    ↑
Cloudflare edge servers
    ↑
https://xxxx.trycloudflare.com  ← URL pública HTTPS
    ↑
Cursor (desde donde sea)
```

El comando muestra la URL y las instrucciones exactas:

```
╔══════════════════════════════════════════════════════════════════╗
║  Tunnel active:  https://abc123.trycloudflare.com               ║
╠══════════════════════════════════════════════════════════════════╣
║  CURSOR SETUP                                                    ║
║                                                                  ║
║  Override OpenAI Base URL →  https://abc123.trycloudflare.com/v1║
╚══════════════════════════════════════════════════════════════════╝
```

Sustituye `http://localhost:8080/v1` por `https://abc123.trycloudflare.com/v1` en Cursor Settings.

> **Importante**: La URL del tunnel cambia cada vez que reinicias `squeezr tunnel`. Tendrás que actualizar Cursor Settings cada vez. Esto es una limitación del Quick Tunnel gratuito — los túneles con URL fija requieren cuenta de Cloudflare (gratis también, pero requiere login).

---

## Qué intercepta Squeezr en Cursor

| Feature de Cursor | Interceptado |
|-------------------|-------------|
| Chat (Ask mode, Cmd+L) | ✅ Sí |
| Agent mode | ✅ Sí |
| Cmd+K (inline edit) | ✅ Sí |
| Tab completions (autocompletado inline) | ❌ No — siempre van a Cursor's infra |

Las tab completions usan un modelo propietario de Cursor (`cursor-small`) que siempre va a `api3.cursor.sh` independientemente de la configuración de Base URL. Es imposible interceptarlas.

---

## Continue Extension (VS Code / JetBrains)

Continue no necesita tunnel. Llama directamente desde el proceso de VS Code, que corre en tu máquina.

Edita `~/.continue/config.json`:

```json
{
  "models": [
    {
      "title": "Claude via Squeezr",
      "provider": "openai",
      "model": "claude-sonnet-4-5",
      "apiKey": "sk-ant-...",
      "apiBase": "http://localhost:8080/v1"
    }
  ]
}
```

Reinicia VS Code → funciona.

---

## Errores comunes y soluciones

### "Failed to fetch" o "Network error" en Cursor

**Causa probable**: CORS no respondido correctamente o servidor no corriendo.  
**Fix**: Verifica `squeezr status`. Si corre, actualiza a 1.17.2 que tiene el CORS middleware.

### Los modelos built-in de Cursor dejan de funcionar tras poner Override Base URL

**Causa**: Bug conocido de Cursor — el override afecta a todos los modelos.  
**Fix**: Desactiva los modelos built-in de Cursor en Settings → Models. Usa solo tu modelo custom.

### "Override Anthropic Base URL se activa solo"

**Causa**: Bug en Cursor — al poner BYOK Anthropic key, Cursor activa el override solo.  
**Fix**: Normal, déjalo activado si quieres usar Anthropic. Asegúrate de que la URL apunte a Squeezr.

### El tunnel no arranca

**Causa**: `cloudflared` no instalado y npx falla.  
**Fix**: Instala cloudflared manualmente:
- macOS: `brew install cloudflared`
- Windows: `winget install Cloudflare.cloudflared`
- Linux: [cloudflare.com/downloads](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)

### Squeezr recibe las requests pero la API da 401

**Causa**: La API key que Cursor manda llega a Squeezr, que la reenvía. Verifica que la key esté bien en Cursor Settings.  
**Fix**: `squeezr logs` para ver las requests entrantes.

---

## Cosas que NO vamos a hacer

- **Interceptar las tab completions**: usan gRPC/HTTP2 propietario de Cursor hacia `api3.cursor.sh`. Imposible sin parchear el binario de Cursor.
- **Interceptar el tráfico del plan Cursor** (sin BYOK): las llamadas las hace `api2.cursor.sh`, no tu máquina. Requeriría un proxy completo en los servidores de Cursor.
- **Windsurf**: su BYOK no expone custom base URL. HTTP/2 + WebSocket resiste MITM. No viable por ahora.
- **Antigravity**: endpoint interno de Google, documentado que no funciona, banea cuentas de Google. Skip total.

---

## Estado de implementación

- [x] CORS middleware en `src/server.ts`
- [x] Comando `squeezr tunnel` en `bin/squeezr.js`
- [ ] Compilar y probar en Cursor real
- [ ] Documentación web (página `/docs/cursor` y `/docs/continue`)
- [ ] Publicar en npm
