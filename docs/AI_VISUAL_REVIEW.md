# JB Collections — sistema de QA visual con doble método e IA

## Arquitectura

El workflow conserva dos capas independientes:

1. **QA determinista (siempre):** Playwright abre el catálogo publicado, recorre escenarios de solo lectura, toma capturas, mide responsive y carga de imágenes; las comprobaciones Axe verifican accesibilidad. Esta capa no requiere claves de IA.
2. **Revisión visual asistida por IA (opcional):** el revisor analiza las mismas capturas junto con las mediciones del navegador. Toda respuesta debe superar el contrato JSON y sigue marcada para revisión humana. La IA no modifica código, productos ni datos de producción.

## Proveedores y failover

El orden predeterminado es `cloudflare,openai`.

- **Cloudflare Workers AI** es el proveedor primario cuando están configuradas ambas credenciales.
- **OpenAI Responses API** es el respaldo, con visión mediante `input_image`. El modelo predeterminado es `gpt-5.4-mini`.
- Si Cloudflare agota la cuota diaria o exige una aceptación de licencia, el circuito de Cloudflare se abre para el resto de esa ejecución y las capturas pasan a OpenAI.
- Si OpenAI informa clave inválida, modelo no disponible o saldo/cuota agotada, ese proveedor se desactiva durante esa ejecución. El otro proveedor puede continuar.
- Los fallos de formato reciben un segundo intento correctivo; un resultado inválido nunca se registra como una revisión limpia.

## Configuración en GitHub

En el repositorio, abrí **Settings → Secrets and variables → Actions**. La revisión por IA queda desactivada por defecto para evitar cargos automáticos. Para activarla, creá también la variable de repositorio `ENABLE_AI_VISUAL_REVIEW=true`. Con esa variable activa, las revisiones de IA se ejecutan en cada auditoría de producción de la rama `main`; el QA determinista de Playwright/Axe sigue ejecutándose aunque la variable esté ausente o en `false`.

### Para habilitar OpenAI como respaldo

1. Generá una clave de API en el panel de OpenAI API Platform.
2. En **Secrets**, creá el secreto `OPENAI_API_KEY` y pegá allí la clave.
3. No la guardés en archivos del repositorio, HTML, JavaScript público, variables del catálogo ni mensajes de chat.

### Variables opcionales

| Variable | Predeterminado | Función |
|---|---|---|
| `ENABLE_AI_VISUAL_REVIEW` | `false` | Interruptor de consentimiento para ejecutar revisiones que consumen cuota de IA |

| Variable | Predeterminado | Función |
|---|---|---|
| `OPENAI_VISION_MODEL` | `gpt-5.4-mini` | Modelo OpenAI con entrada visual |
| `AI_PROVIDER_ORDER` | `cloudflare,openai` | Orden de prioridad; también se puede usar `openai,cloudflare` |

Para seguir usando Cloudflare se requieren la variable `CLOUDFLARE_ACCOUNT_ID` y el secreto `CLOUDFLARE_API_TOKEN`. Si solo se configura OpenAI, el flujo funciona igualmente con ese proveedor.

## Reportes

Cada ejecución sube el artefacto `production-visual-audit-evidence`. El informe registra proveedor y modelo usados por captura, fallos detectados, failovers, cuotas, imágenes optimizadas, mediciones del navegador y las capturas no revisadas.

## Costos y seguridad

La clave de OpenAI se utiliza solo dentro de GitHub Actions; el navegador público nunca la recibe. Las capturas se envían a un proveedor únicamente cuando sus credenciales están configuradas. La revisión con IA consume uso de la API de OpenAI y se factura de forma separada de una suscripción de ChatGPT. Revisá los límites de gasto y el uso de la organización API antes de ejecutar auditorías numerosas.

El sistema es de solo lectura respecto a JB Collections. No publica cambios automáticamente y exige revisión humana antes de corregir cualquier hallazgo.
