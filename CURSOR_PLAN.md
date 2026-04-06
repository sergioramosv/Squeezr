# Plan: Squeezr para IDEs (Cursor, Continue, Windsurf)

Rama: `feature/cursor-ide-support`  
Estado: en progreso — NO publicar en npm hasta confirmar que funciona

---

## Resumen de la investigación

| IDE | Viable | Método | Notas |
|-----|--------|--------|-------|
| **Continue** (VS Code/JetBrains) | ✅ Sí, hoy | `apiBase: http://localhost:8080/v1` | Cero trabajo, funciona directo |
| **Cursor** | ✅ Sí, con tunnel | Override OpenAI Base URL → URL pública HTTPS | No acepta localhost, necesita tunnel |
| **Windsurf** | ⚠️ Difícil | BYOK no expone custom base URL | A investigar más |
| **Antigravity** | ❌ No viable | Endpoint interno Google, MITM falla, banea cuentas | Skip |

### Por qué Cursor necesita un tunnel

Cursor no llama al endpoint desde tu máquina. Sus servidores hacen la llamada desde la infraestructura de Cursor (`api2.cursor.sh`). Por eso `localhost:8080` no es alcanzable — el servidor de Cursor no puede llegar a tu localhost.

Solución: exponer el proxy con **Cloudflare Quick Tunnel** (gratis, sin cuenta) → URL pública HTTPS como `https://xxxx.trycloudflare.com`.

### Qué intercepta Squeezr en Cursor

- ✅ Chat (Ask mode)
- ✅ Agent mode  
- ✅ Cmd+K
- ❌ Tab completions (siempre van a Cursor's infra, no interceptable)

---

## Cambios a implementar

### 1. CORS middleware en el servidor ✅ HECHO

**Archivo:** `src/server.ts`

Cursor (Electron) envía OPTIONS preflight antes de cada POST. Sin CORS headers la request se bloquea.

```typescript
app.use('*', async (c, next) => {
  if (c.req.method === 'OPTIONS') {
    return c.text('', 204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Max-Age': '86400',
    })
  }
  await next()
  c.res.headers.set('Access-Control-Allow-Origin', '*')
  // ...
})
```

**Por qué no rompe nada:** CORS headers en respuestas de API son ignorados por CLIs. Solo afectan a clientes web/Electron.

---

### 2. Comando `squeezr tunnel` ✅ HECHO

**Archivo:** `bin/squeezr.js`

Levanta un Cloudflare Quick Tunnel y muestra instrucciones para Cursor.

```
squeezr tunnel
```

Flujo:
1. Verifica que el proxy esté corriendo
2. Intenta `cloudflared` binario instalado, si no existe usa `npx cloudflared@latest`
3. Parsea la URL `*.trycloudflare.com` del output
4. Muestra panel con instrucciones para Cursor y Continue

Output esperado:
```
╔══════════════════════════════════════════════════════════════════╗
║  Tunnel active:  https://xxxx.trycloudflare.com                 ║
╠══════════════════════════════════════════════════════════════════╣
║  CURSOR SETUP                                                    ║
║                                                                  ║
║  1. Cursor → Settings → Models                                   ║
║  2. Add your OpenAI or Anthropic API key                         ║
║  3. Enable "Override OpenAI Base URL"                            ║
║  4. Set URL to: https://xxxx.trycloudflare.com/v1               ║
║  5. Disable all built-in Cursor models                           ║
║  6. Add a custom model pointing to the same URL                  ║
║                                                                  ║
║  CONTINUE EXTENSION (VS Code / JetBrains)                        ║
║  No tunnel needed — use http://localhost:8080 directly           ║
╚══════════════════════════════════════════════════════════════════╝
```

---

### 3. Documentación para Continue ⏳ PENDIENTE

**Archivo:** `squeezr-web/app/docs/` → nueva página `continue/page.tsx`

Continue no necesita tunnel. Config en `~/.continue/config.json`:

```json
{
  "models": [{
    "title": "Claude via Squeezr",
    "provider": "openai",
    "model": "claude-sonnet-4-5",
    "apiKey": "any",
    "apiBase": "http://localhost:8080/v1"
  }]
}
```

---

### 4. Documentación para Cursor ⏳ PENDIENTE

**Archivo:** `squeezr-web/app/docs/` → nueva página `cursor/page.tsx`

Pasos:
1. `squeezr start`
2. `squeezr tunnel` → copia la URL
3. Cursor → Settings → Models → Add OpenAI key → Override Base URL → pegar URL + `/v1`
4. Deshabilitar modelos built-in de Cursor
5. Añadir modelo custom

Advertencias a documentar:
- El tunnel es temporal (URL cambia cada vez que se reinicia)
- Tab completions NO se comprimen (van siempre a Cursor's infra)
- Solo funciona con BYOK (tu propia API key), no con el plan de Cursor

---

### 5. Actualizar docs index y navegación ⏳ PENDIENTE

- Añadir Cursor y Continue a la sección Tool Guides de `squeezr-web/app/docs/page.tsx`
- Actualizar README con mención de Cursor/Continue

---

### 6. Bump versión y compilar ⏳ PENDIENTE

- `package.json`: `1.17.1` → `1.17.2`
- `npm run build`
- Commit en rama `feature/cursor-ide-support`
- **No publicar** en npm hasta probar en Cursor real

---

## Pruebas necesarias antes de publicar

- [ ] `squeezr tunnel` arranca sin error con `cloudflared` instalado
- [ ] `squeezr tunnel` arranca con `npx cloudflared` si no está instalado
- [ ] URL se parsea y se muestra correctamente
- [ ] Cursor puede conectar a la URL del tunnel
- [ ] OPTIONS preflight responde 204 con CORS headers correctos
- [ ] Chat / Agent en Cursor funciona y los tokens se comprimen
- [ ] Continue en VS Code funciona con `http://localhost:8080/v1`
- [ ] Claude Code / Aider / Gemini CLI siguen funcionando (CORS no debe romperlos)

---

## Lo que NO vamos a hacer

- **No MITM de tráfico propio de Cursor** (`api2.cursor.sh` usa gRPC/ConnectRPC con HTTP/2, impráctica de interceptar)
- **No Antigravity** (endpoint interno Google, ToS bans documentados)
- **No Windsurf** (por ahora — no expone custom base URL en BYOK individual)
