# Cat-logo
Catálogo celulares y más.

## JB Manager: notificaciones de mensajería

La mensajería administrativa usa Web Push para avisar cuando un cliente solicita atención o confirma que desea comprar.

### Configuración de producción
- El cliente carga `adminPushPublicKey` desde `config.js`. Es una clave pública y no debe sustituirse por la clave privada.
- En Cloudflare Pages, las Functions necesitan las variables secretas `VAPID_PRIVATE_JWK` y `PUSH_DISPATCH_SECRET`, y la variable pública `VAPID_PUBLIC_KEY`.
- `PUSH_DISPATCH_SECRET` debe coincidir con el hash SHA-256 almacenado en `private.admin_push_dispatch_config`; nunca debe publicarse en el repositorio.
- Las suscripciones de los dispositivos se guardan en `public.admin_push_subscriptions`, protegidas mediante RLS; cada administrador solo gestiona su propia suscripción.
- Después de cambiar variables de entorno de Cloudflare Pages, debe hacerse un nuevo despliegue para que las Functions las reciban.

### Activación en el dispositivo
1. Abrir JB Manager en una dirección HTTPS en un navegador compatible con Service Worker y Push.
2. Iniciar sesión como administrador y entrar a Mensajería.
3. Pulsar **Activar notificaciones** y aceptar el permiso del navegador.
4. Confirmar que aparece la notificación de prueba y que el panel informa que el dispositivo quedó registrado.
5. Probar una solicitud de atención y una confirmación de compra desde un navegador/dispositivo distinto.

Tener el permiso del navegador concedido no equivale a tener la suscripción push guardada. La prueba del botón debe confirmar ambas cosas. Los navegadores o WebViews que no implementen Web Push no pueden prometer notificaciones con el panel cerrado.

### Pruebas automáticas
La suite de CI comprueba el registro y errores de suscripción, el cifrado y autenticación Web Push, la transición de confirmación de compra, la integridad de la navegación del panel y una auditoría responsive de sus secciones a 360, 390, 430 y 1280 px. El informe `admin-quality-audit.md` se publica como artefacto del workflow.
