# JB Collections — sistema de QA visual gratuito

## Arquitectura

El workflow conserva dos capas independientes:

1. **QA determinista (siempre):** Playwright recorre páginas públicas en modo solo lectura, toma capturas, comprueba responsive, navegación, carga de imágenes y accesibilidad Axe. No consume créditos de IA.
2. **Revisión visual asistida por IA (opcional):** los modelos analizan las mismas capturas junto con las mediciones del navegador. Las respuestas deben cumplir el contrato JSON y quedan sujetas a revisión humana. Ninguna IA modifica código, productos, pedidos ni datos de producción.

## Proveedores y failover

El orden predeterminado es `cloudflare,gemini`.

- **Cloudflare Workers AI** es el proveedor primario si se configuran `CLOUDFLARE_ACCOUNT_ID` y `CLOUDFLARE_API_TOKEN`. El plan Free incluye una asignación diaria; cuando se consume, la ejecución no pasa a cobro por sí sola, sino que abre el circuito y prueba Gemini.
- **Google Gemini API — Gemini 3.1 Flash-Lite** es el respaldo. Su nivel gratuito publica entrada de texto/imagen y salida sin costo, sujeto a límites de solicitudes, tokens y disponibilidad del proyecto.
- Si Cloudflare agota su cuota o requiere aceptación de licencia, las capturas pendientes pasan a Gemini. Si Gemini alcanza el límite gratuito, su clave es inválida o el proyecto no tiene acceso al nivel gratuito, el circuito de Gemini se abre para esa ejecución.
- Los errores temporales tienen reintentos limitados. Los errores permanentes por proveedor no generan reintentos repetidos. Una respuesta que no cumpla el JSON esperado nunca cuenta como evaluación limpia.

## Configuración en GitHub

Abrí **Settings → Secrets and variables → Actions**.

La revisión visual por IA permanece desactivada por defecto. Para habilitarla:

1. En **Secrets**, creá `GEMINI_API_KEY` y guardá la clave obtenida de Google AI Studio.
2. En **Variables**, creá `ENABLE_AI_VISUAL_REVIEW` con el valor `true`.
3. Para conservar Cloudflare como primer proveedor, mantené la variable `CLOUDFLARE_ACCOUNT_ID` y el secreto `CLOUDFLARE_API_TOKEN`. Si no están disponibles, Gemini será el único proveedor configurado.

Variables opcionales:

| Variable | Predeterminado | Función |
|---|---|---|
| `ENABLE_AI_VISUAL_REVIEW` | `false` | Interruptor explícito para permitir el envío de capturas a IA |
| `GEMINI_VISION_MODEL` | `gemini-3.1-flash-lite` | Modelo Gemini con entrada visual |
| `AI_PROVIDER_ORDER` | `cloudflare,gemini` | Orden de prioridad; también se puede usar `gemini,cloudflare` |

El workflow **no configura OpenAI API ni proveedores pagos**. No es necesario añadir una tarjeta o vincular un proyecto de facturación para usar el nivel gratuito de Gemini. No cambies el proyecto de Google a un nivel de pago ni vincules facturación.

## Límites y privacidad

El nivel gratuito de Gemini tiene cuotas de uso que pueden cambiar y la disponibilidad se determina por proyecto/cuenta. Nicaragua figura en la lista de regiones disponibles para Google AI Studio y Gemini API. Si Google no habilita el nivel gratuito para un proyecto concreto, el sistema marca el proveedor como no disponible; no debe vincularse facturación para desbloquearlo.

Google indica que el contenido del nivel gratuito puede utilizarse para mejorar sus productos. Este revisor únicamente debe recibir capturas de páginas públicas del catálogo. No incluyas capturas del panel administrador, credenciales, datos de clientes, conversaciones privadas ni datos personales.

No se envían imágenes a un proveedor salvo que `ENABLE_AI_VISUAL_REVIEW=true` y al menos una credencial estén configuradas. La clave permanece en GitHub Actions, nunca en el frontend ni en el repositorio. Si los proveedores gratuitos agotan sus cuotas, la revisión de IA queda pendiente; el QA determinista sigue funcionando.

## Reportes

Cada ejecución publica el artefacto `production-visual-audit-evidence`. El informe registra proveedor y modelo usados por captura, failovers, cuotas, mediciones del navegador, incidencias y capturas sin evaluar.

## Seguridad

La auditoría es de solo lectura. La IA no corrige código automáticamente, no publica cambios y no decide por sí sola si un diseño está aprobado. Los hallazgos deben verificarse antes de modificar el catálogo.
