# Squeezr como servicio Windows con NSSM

NSSM (Non-Sucking Service Manager) convierte Squeezr en un **servicio Windows real**: arranca automáticamente con el sistema, se reinicia solo si crashea, y no depende del Task Scheduler ni de permisos de admin en cada sesión.

## Por qué NSSM en lugar del Task Scheduler

| Característica | Task Scheduler | NSSM |
|---|---|---|
| Auto-inicio al login | Sí (requiere admin) | Sí |
| Reinicio automático si crashea | No | Sí |
| Logs de errores | No | Sí (stdout + stderr) |
| Control con `sc` / `services.msc` | No | Sí |
| Funciona sin usuario logueado | No | Sí (SYSTEM) |

El problema concreto que resuelve: si Squeezr crashea por un `ECONNRESET` u otro error de Node.js, NSSM lo detecta y lo reinicia en segundos, sin intervención manual.

---

## Requisitos

- Windows 10/11
- Node.js 18+ instalado
- Squeezr instalado globalmente (`npm install -g squeezr-ai`)
- PowerShell como **Administrador** para los pasos de instalación

---

## Instalación

### 1. Instalar NSSM

Elige uno de estos métodos:

```powershell
# Con winget (recomendado, sin dependencias extra)
winget install nssm

# Con Chocolatey
choco install nssm

# Manual: descargar desde https://nssm.cc/download
# Extraer nssm.exe a C:\Windows\System32\ o a cualquier carpeta en el PATH
```

Verifica la instalación:
```powershell
nssm version
```

---

### 2. Obtener las rutas necesarias

Necesitas la ruta exacta de `node.exe` y del script `squeezr.js`:

```powershell
# Ruta de node
where.exe node
# Ejemplo: C:\Program Files\nodejs\node.exe

# Ruta del script principal de squeezr
npm root -g
# Ejemplo: C:\Users\Ramos\AppData\Roaming\npm\node_modules
# El script estará en: <npm root -g>\squeezr-ai\bin\squeezr.js
```

Combínalos para obtener algo como:
```
node.exe   → C:\Program Files\nodejs\node.exe
script     → C:\Users\Ramos\AppData\Roaming\npm\node_modules\squeezr-ai\bin\squeezr.js
```

---

### 3. Crear el servicio

Abre PowerShell **como Administrador** y ajusta las rutas según el paso anterior:

```powershell
$node    = "C:\Program Files\nodejs\node.exe"
$script  = "$env:APPDATA\npm\node_modules\squeezr-ai\bin\squeezr.js"
$logDir  = "$env:USERPROFILE\.squeezr"

# Crear el servicio
nssm install SqueezrProxy $node $script

# Directorio de trabajo
nssm set SqueezrProxy AppDirectory "$env:USERPROFILE\.squeezr"

# Logs de stdout y stderr
nssm set SqueezrProxy AppStdout "$logDir\service-stdout.log"
nssm set SqueezrProxy AppStderr "$logDir\service-stderr.log"
nssm set SqueezrProxy AppRotateFiles 1
nssm set SqueezrProxy AppRotateSeconds 86400

# Reinicio automático si el proceso termina
nssm set SqueezrProxy AppExit Default Restart
nssm set SqueezrProxy AppRestartDelay 3000

# Descripción visible en services.msc
nssm set SqueezrProxy Description "Squeezr AI token compression proxy on port 8080"

# Arrancar el servicio
nssm start SqueezrProxy
```

---

### 4. Verificar que funciona

```powershell
# Estado del servicio
nssm status SqueezrProxy

# O con sc nativo de Windows
sc query SqueezrProxy

# Probar que el proxy responde
curl http://localhost:8080/squeezr/health
```

Deberías ver `{"status":"ok"}` en la respuesta del health check.

---

### 5. Deshabilitar la instancia anterior del Task Scheduler (si existe)

Si ya habías corrido `squeezr setup` antes, es posible que haya una tarea registrada en el Task Scheduler que arranque un proceso duplicado:

```powershell
# Ver si existe la tarea
schtasks /query /tn "Squeezr" 2>$null

# Deshabilitarla si existe
schtasks /change /tn "Squeezr" /disable

# O eliminarla completamente
schtasks /delete /tn "Squeezr" /f
```

También detén cualquier instancia de Squeezr corriendo fuera del servicio:
```powershell
squeezr stop
```

Después reinicia el servicio para asegurarte de que solo corre la instancia de NSSM:
```powershell
nssm restart SqueezrProxy
```

---

## Gestión del servicio

```powershell
nssm start SqueezrProxy      # Iniciar
nssm stop SqueezrProxy       # Detener
nssm restart SqueezrProxy    # Reiniciar
nssm status SqueezrProxy     # Ver estado
nssm edit SqueezrProxy       # Abrir GUI de configuración
nssm remove SqueezrProxy confirm  # Eliminar el servicio
```

También puedes gestionarlo desde `services.msc` (Servicios de Windows) — aparece como **SqueezrProxy**.

---

## Ver logs

```powershell
# Salida estándar del proxy
Get-Content "$env:USERPROFILE\.squeezr\service-stdout.log" -Tail 50 -Wait

# Errores (crashes, ECONNRESET, etc.)
Get-Content "$env:USERPROFILE\.squeezr\service-stderr.log" -Tail 50 -Wait
```

---

## Cómo funciona internamente

```
Windows boot
    └─> SCM (Service Control Manager)
            └─> NSSM supervisa el proceso
                    └─> node.exe bin/squeezr.js
                            └─> HTTP proxy en localhost:8080
                            └─> MITM HTTPS proxy en localhost:8081

Claude Code / Codex / Aider
    └─> ANTHROPIC_BASE_URL=http://localhost:8080
            └─> Squeezr comprime el contexto
                    └─> Reenvía a Anthropic API
```

**Flujo de recuperación ante crash:**
1. Node.js lanza una excepción no capturada (`ECONNRESET`, OOM, etc.)
2. El proceso termina con código distinto de 0
3. NSSM detecta la terminación en menos de 1 segundo
4. Espera `AppRestartDelay` (3 segundos por defecto)
5. Relanza `node.exe squeezr.js` automáticamente
6. El proxy vuelve a estar disponible en `localhost:8080`

---

## Solución de problemas

**El servicio no arranca:**
```powershell
# Ver error detallado
nssm status SqueezrProxy
Get-Content "$env:USERPROFILE\.squeezr\service-stderr.log" -Tail 20
```

**Puerto 8080 ocupado:**
```powershell
netstat -ano | findstr :8080
# Busca el PID y termínalo si es un proceso huérfano
```

**Múltiples instancias corriendo:**
```powershell
# Ver todos los procesos de node relacionados con squeezr
Get-Process node | Where-Object { $_.MainWindowTitle -eq "" }
squeezr stop   # detiene la instancia CLI
nssm restart SqueezrProxy   # reinicia solo el servicio
```

**Variables de entorno no cargadas en el servicio:**
Si el servicio arranca pero las variables `ANTHROPIC_BASE_URL` etc. no están disponibles en PowerShell, ábrelas manualmente:
```powershell
[System.Environment]::SetEnvironmentVariable("ANTHROPIC_BASE_URL", "http://localhost:8080", "User")
```
O vuelve a ejecutar `squeezr setup` en una sesión normal (no como admin) para que se registren en el entorno del usuario.
