# Propuesta de conversión y confianza — JB Collections

**Estado:** propuesta para debate. No implementar en producción hasta recibir luz verde explícita.
**Alcance:** documentación, revisión técnica y plan de pruebas únicamente. No modificar HTML/CSS/JS de la web, la configuración de despliegue ni las funciones de producción.

## 1. Decisiones de contenido confirmadas

- La portada de tecnología debe mostrar confianza de forma temprana, dentro del área señalada en la captura: debajo del texto principal y antes de la imagen destacada.
- Los mensajes a considerar son:
  - **Envíos a departamentos** — describir las condiciones reales de envío, sin prometer disponibilidad universal.
  - **Atención por WhatsApp** — facilitar consultas de disponibilidad, precio, entrega y opciones de pago.
  - **Pago al recibir** — mostrarlo solo con una aclaración de que está sujeto a disponibilidad/confirmación.
- Estos mensajes deben reemplazar los microtextos actuales que repiten ideas similares, no sumarse como una pila larga de etiquetas.
- Mantener los botones principales para explorar tecnología y perfumería diferenciados visualmente, accesibles y fáciles de pulsar en móvil.
- No cambiar el sitio todavía. La presente propuesta no autoriza ningún cambio de producción.

## 2. Garantía: regla estricta por catálogo y producto

- **Tecnología:** mostrar el plazo de garantía específico que corresponda a cada producto: 3, 6 o 12 meses, según los datos verificados.
- No mostrar una afirmación general de “1 año de garantía” para todo el catálogo.
- **Perfumería:** no mostrar distintivos, microtextos ni promesas de garantía.
- Si el producto tecnológico no tiene un plazo verificado, omitir el distintivo en lugar de asumir uno.
- Antes de implementar, comprobar de dónde se obtiene el plazo y cómo se representa en las fichas de productos y variantes.

## 3. Jerarquía propuesta para la portada móvil

1. Título principal de tecnología.
2. Una frase breve sobre comparar características y precios.
3. Dos o tres señales compactas de confianza, priorizando envíos, WhatsApp y pago al recibir sujeto a confirmación.
4. Imagen principal.
5. Botones para explorar cada catálogo en el punto de navegación apropiado.

No añadir más elementos si desplazan demasiado la imagen o crean una pared de etiquetas. Mantener el diseño equilibrado y comprobarlo a 390 px de ancho como mínimo.

## 4. Botones y llamada a la acción

- Usar botones visuales reales para “Explorar tecnología” y “Explorar perfumería”, con áreas táctiles amplias.
- Mantener azul/cian para tecnología y acentos dorados para perfumería, respetando la identidad existente.
- En las fichas de producto, preferir “Consultar por WhatsApp” cuando la acción abre una conversación y la disponibilidad todavía debe confirmarse. Reservar “Comprar” para un flujo de compra real.
- La consulta debe incluir el nombre del producto y, cuando corresponda, la variante seleccionada.
- Medir clics en cada catálogo y en WhatsApp para evaluar la conversión, sin considerar el aumento de clics como prueba suficiente de aumento de ventas.

## 5. Cotización temporal

El usuario indica que los mensajes ya están definidos; no reescribirlos ni añadir textos redundantes sin revisar primero la implementación actual. El acuerdo es revisar la interfaz y verificar:
- qué datos se solicitan y por qué;
- qué aviso ve el cliente antes de introducir datos;
- cómo se comunica el uso temporal de los datos;
- que las afirmaciones sobre cifrado, almacenamiento y procesamiento sean verificables en la arquitectura real;
- que el enlace temporal caduque y que el acceso esté limitado como se espera.

No afirmar “conexión cifrada” o “servidor seguro” como promesa de marketing sin verificar los controles técnicos.

## 6. Revisión de api/share.js

### Hallazgo inicial

La auditoría estática identificó api/share.js como archivo JavaScript aparentemente desconectado del grafo del sitio. Esto **no demuestra que sea código muerto**: las plataformas de despliegue pueden registrar automáticamente archivos bajo api/ como rutas serverless.

### Diferencia observada

- api/share.js exporta un handler de estilo CommonJS (module.exports = async function handler(req, res)), patrón compatible con una ruta API de Vercel.
- functions/api/share.js exporta onRequest(...), patrón de Cloudflare Pages Functions.
- El repositorio tiene pruebas para functions/api/share.js, incluyendo metadatos para tecnología/perfumería, variantes, productos no publicados, método HEAD y manejo de errores.
- La ejecución de Cloudflare Pages se completó correctamente en el último CI observado.

### Próximas verificaciones antes de decidir

1. Confirmar si Vercel sigue conectado al repositorio o si api/share.js atiende tráfico real.
2. Buscar referencias a /api/share en el código cliente, la configuración de despliegue y las URL públicas compartidas.
3. Comparar comportamiento y pruebas entre ambos handlers, incluidos encabezados, caché, selección de variantes y tratamiento de errores.
4. Si Vercel ya no se usa, decidir si conviene conservar el handler por compatibilidad, archivarlo o retirarlo en una propuesta separada.
5. No borrar ni modificar api/share.js hasta completar esas comprobaciones y obtener autorización.

## 7. Plan de implementación después de la luz verde

1. Inspeccionar la portada actual de ambos catálogos y registrar los textos existentes para evitar duplicaciones.
2. Confirmar la fuente de datos de garantía y los plazos reales por producto tecnológico.
3. Diseñar una propuesta compacta para móvil y escritorio.
4. Implementar solo los cambios aprobados.
5. Añadir pruebas de DOM, accesibilidad, responsive y enlaces/acciones.
6. Ejecutar CI completo y revisar el resultado visual en tema claro/oscuro y móvil.
7. Comparar eventos de clic antes/después si existe suficiente tráfico; no declarar aumento de ventas sin datos.

## Restricción de alcance

Hasta recibir luz verde explícita, este documento es únicamente una propuesta y una lista de investigación. No autoriza cambios de producción.