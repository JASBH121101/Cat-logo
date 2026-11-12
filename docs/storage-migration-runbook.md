# JB Collections — migración controlada de Supabase Storage a R2

## Alcance

- Origen: Supabase Storage, bucket `product-images`, región `us-east-2`.
- Destino de esta demo: Cloudflare R2, bucket `jb-collections-fiverr-demo`, binding `PRODUCT_IMAGES` (entorno Preview aislado).
- El bucket `jb-collections` queda reservado para Production y no se toca en esta migración de demo.
- Endpoint: `POST /api/migration/supabase-r2`.
- Acceso: sesión administrativa Neon Auth y autorización `admin_users`.
- La operación solo lee el bucket de origen y escribe objetos faltantes en R2.
- No elimina, renombra ni actualiza objetos en Supabase.

## Secretos requeridos (solo Preview)

Configurar en Cloudflare Pages → Settings → Variables and Secrets → Preview:

- `SUPABASE_S3_ACCESS_KEY_ID` (Secret)
- `SUPABASE_S3_SECRET_ACCESS_KEY` (Secret)

No copiar estos valores a GitHub, al navegador ni a archivos de configuración.
No añadirlos al entorno Production hasta que exista autorización de corte.

## Binding requerido (solo Preview)

- Binding: `PRODUCT_IMAGES`
- Bucket Preview: `jb-collections-fiverr-demo`
- No conectar ni escribir en el bucket Production `jb-collections`.

## Uso desde JB Manager

1. Iniciar sesión como propietario en el deployment Preview de `fiverr-demo`.
2. Abrir **Migración de imágenes**.
3. Pulsar **Verificar conexión e inventario**.
4. Solo si el inventario S3 termina correctamente y todas las rutas son válidas, iniciar la copia.
5. La herramienta copia lotes de hasta 10 objetos, omite objetos ya existentes con el mismo tamaño y detiene el lote ante conflictos.
6. Revisar los errores antes de continuar.

## Límites de seguridad actuales

- Máximo 10 objetos por lote.
- Máximo 50 MiB por objeto.
- Solo extensiones y tipos de imagen permitidos.
- No se sobrescriben objetos de R2.
- La verificación posterior a cada escritura comprueba el tamaño del objeto en R2.
- Supabase permanece como fuente original y fallback hasta completar una auditoría independiente.
- El recuento esperado actual es 568 objetos; no se considera finalizada la migración por un simple recuento: también debe compararse el inventario completo y verificarse cada objeto.

## Rollback

No existe ninguna operación de borrado de origen en este endpoint. Para detener la migración, pausar el panel y retirar los secretos exclusivamente del entorno Preview. Mantener intacta la rama `main` y el deployment Production.
