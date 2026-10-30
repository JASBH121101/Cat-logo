# JB Collections — sistema de QA visual gratuito

## Arquitectura

El workflow conserva dos capas independientes:

1. **QA determinista (siempre):** Playwright recorre páginas públicas en modo solo lectura, toma capturas, comprueba responsive, navegación, carga de imágenes y accesibilidad Axe. No consume créditos de IA.
2. **Revisión visual asistida por IA (opcional):** los modelos analizan las mismas capturas junto con las mediciones del navegador. Las respuestas deben cumplir el contrato JSON y quedan sujetas a revisión humana. Ninguna IA modifica código, productos, pedidos ni datos de producción.

## Proveedores y failover

El orden predeterminado es `gemini,cloudflare`.

- **Google Gemini API — Gemini 3.1 Flash-Lite** es el proveedor gratuito principal. El nivel gratuito publica entrada de texto/imagen y salida sin costo, sujeto a límites de solicitudes, tokens y disponibilidad del proyecto.
- **Cloudflare Workers AI** es un respaldo opcional, desactivado por defecto. Solo se inyectan sus credenciales cuando `ENABLE_CLOUDFLARE_AI=true`; activalo únicamente después de confirmar que tu cuenta está en Workers Free. En Workers Paid, las solicitudes que superen la asignación gratuita diaria pueden generar cargos.
- Si Gemini agota la cuota gratuita, su clave es inválida o el proyecto no tiene acceso al nivel gratuito, el circuito de Gemini se abre. Si Cloudflare se habilitó expresamente y está disponible, puede tomar el relevo; de lo contrario, la revisión de IA queda pendiente sin intentar otro proveedor.
- Los errores temporales tienen reintentos limitados. Los errores permanentes por proveedor no generan reintentos repetidos. Una respuesta que no cumpla el JSON esperado nunca cuenta como evaluación limpia.

## Configuración en GitHub

Abrí **Settings → Secrets and variables → Actions**.

La revisión visual por IA permanece desactivada por defecto. Para habilitarla:

1. En **Secrets**, creá `GEMINI_API_KEY` y guardá la clave obtenida de Google AI Studio.
2. En **Variables**, creá `ENABLE_AI_VISUAL_REVIEW` con el valor `true`.
3. No configures ni habilites Cloudflare AI todavía. El workflow usa Gemini gratuito y deja Cloudflare desactivado aunque sus claves ya existan en el repositorio.

Variables opcionales:

| Variable | Predeterminado | Función |
|---|---|---|
| `ENABLE_AI_VISUAL_REVIEW` | `false` | Interruptor explícito para permitir el envío de capturas a IA |
| `GEMINI_VISION_MODEL` | `gemini-3.1-flash-lite` | Modelo Gemini con entrada visual |
| `AI_PROVIDER_ORDER` | `gemini,cloudflare` | Orden de prioridad; Cloudflare solo estará disponible si se activa expresamente |

El workflow **no configura OpenAI API ni proveedores pagos**. No es necesario añadir una tarjeta o vincular un proyecto de facturación para usar el nivel gratuito de Gemini. No cambies el proyecto de Google a un nivel de pago ni vincules facturación. Para garantizar que Cloudflare no consuma una cuenta Workers Paid, dejá `ENABLE_CLOUDFLARE_AI` sin crear o en `false`.

## Límites y privacidad

El nivel gratuito de Gemini tiene cuotas de uso que pueden cambiar y la disponibilidad se determina por proyecto/cuenta. Nicaragua figura en la lista de regiones disponibles para Google AI Studio y Gemini API. Si Google no habilita el nivel gratuito para un proyecto concreto, el sistema marca el proveedor como no disponible; no debe vincularse facturación para desbloquearlo. Si se agota la cuota gratuita de Gemini y Cloudflare no está habilitado, la IA deja la revisión pendiente; las pruebas deterministas siguen operando sin costo de modelos.

Google indica que el contenido del nivel gratuito puede utilizarse para mejorar sus productos. Este revisor únicamente debe recibir capturas de páginas públicas del catálogo. No incluyas capturas del panel administrador, credenciales, datos de clientes, conversaciones privadas ni datos personales.

No se envían imágenes a un proveedor salvo que `ENABLE_AI_VISUAL_REVIEW=true` y al menos una credencial estén configuradas. La clave permanece en GitHub Actions, nunca en el frontend ni en el repositorio. Si los proveedores gratuitos agotan sus cuotas, la revisión de IA queda pendiente; el QA determinista sigue funcionando.

## Reportes

Cada ejecución publica el artefacto `production-visual-audit-evidence`. El informe registra proveedor y modelo usados por captura, failovers, cuotas, mediciones del navegador, incidencias y capturas sin evaluar.

## Seguridad

La auditoría es de solo lectura. La IA no corrige código automáticamente, no publica cambios y no decide por sí sola si un diseño está aprobado. Los hallazgos deben verificarse antes de modificar el catálogo.
