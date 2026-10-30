# JB Manager AI — arquitectura y plan de implementación

## Objetivo

Convertir JB Manager en el centro de control de JB Collections con un copiloto administrativo accesible desde una sección completa y una burbuja flotante. El asistente podrá interpretar instrucciones escritas o dictadas, preparar cambios y ejecutarlos únicamente después de una confirmación explícita del administrador.

## Restricciones y principios

- Mantener independientes el catálogo público y el panel privado.
- Reutilizar la autenticación actual de Supabase y la lista autorizada `admin_users`.
- No exponer claves Gemini, claves secretas de Supabase ni tokens en el navegador.
- No introducir servicios de pago obligatorios. Priorizar Gemini API Free y APIs de voz nativas del navegador; respetar cuotas y ofrecer entrada de texto como alternativa.
- La IA no tendrá permiso implícito para escribir. Toda mutación pasa por una herramienta backend validada y un paso de aprobación.
- Las respuestas del modelo son datos no confiables. Validar esquema, tipos, límites, IDs, permisos y estado actual antes de ejecutar.
- No enviar datos personales de clientes ni conversaciones privadas al modelo.
- No publicar ni eliminar productos por una orden ambigua.

## Arquitectura propuesta

1. **UI de JB Copilot**: sección propia en el menú, burbuja flotante, historial de la sesión, modo texto y modo voz.
2. **Voz en navegador**: Web Speech API (`SpeechRecognition` cuando esté disponible) para dictado y `speechSynthesis` para respuestas habladas. Fallback automático a texto cuando el navegador no soporte reconocimiento. No imitar ni usar voces protegidas; estilo conversacional propio, breve y de asistente.
3. **Cloudflare Pages Function privada**: endpoint administrativo que valida origen, JWT de Supabase y pertenencia a `admin_users`; usa `GEMINI_API_KEY` guardada como secreto de Cloudflare Pages. Límites de tamaño, tasa y cuota. Nunca devuelve la clave.
4. **Gemini**: interpreta intención y genera propuestas estructuradas. No ejecuta SQL ni recibe credenciales.
5. **Capa de herramientas tipadas**: consultas de solo lectura y comandos permitidos. Las escrituras se hacen con el cliente autenticado de Supabase bajo RLS o endpoints explícitos; no se entrega service-role al modelo.
6. **Confirmación**: mostrar entidad afectada, valor actual, valor propuesto y consecuencias. Botones Confirmar / Cancelar. Revalidar el dato actual al confirmar para evitar sobrescribir cambios recientes.
7. **Auditoría**: registrar actor, acción, entidad, valores anterior/nuevo, fecha, fuente indicada por el administrador y resultado; nunca registrar secretos ni transcripciones con datos sensibles.

## Flujos principales

### A. Actualizar precio al revisar la app del proveedor

1. El administrador dicta o escribe: “Actualizá el precio del [producto/variante]; GoPartner ahora muestra US$ X”.
2. El copiloto busca coincidencias y, si hay más de una, solicita elegir producto, configuración RAM/almacenamiento y color.
3. Presenta precio de proveedor actual y nuevo, moneda, disponibilidad y fecha de revisión.
4. Calcula la diferencia absoluta y porcentual; no inventa tasa de cambio.
5. Propone actualizar el registro privado `product_provider_status` y añadir una instantánea en `product_provider_review_history`.
6. Si el precio público también debe cambiar, presenta por separado el precio publicado actual y el propuesto. Según la política actual de catálogo, propone igualarlo al precio del proveedor, pero nunca lo cambia sin confirmación.
7. Al confirmar, actualiza los registros permitidos, recarga el producto y muestra el resultado.

**Importante:** los precios de proveedor y los precios públicos son conceptos distintos. El flujo debe evitar que una revisión de proveedor cambie accidentalmente todas las variantes o el precio publicado incorrecto.

### B. Añadir producto rápidamente

1. El administrador dicta nombre, marca, categoría, catálogo y datos disponibles.
2. Gemini devuelve un borrador estructurado con campos conocidos, campos faltantes y preguntas puntuales.
3. El sistema comprueba posibles duplicados en el catálogo.
4. Para tecnología, prepara variantes, RAM, almacenamiento, colores y precios por variante.
5. Para perfumería, prepara tipo, familia, concentración, volumen, audiencia y notas cuando se hayan proporcionado.
6. El administrador revisa una vista previa y puede completar imágenes, precios o especificaciones.
7. Solo al confirmar se rellena/guarda el formulario existente. El primer guardado será no publicado; publicar requiere una confirmación separada.

### C. Centro de calidad

- Consultar últimas ejecuciones de GitHub Actions y resultados guardados.
- Resumir escenarios, capturas, pruebas y hallazgos.
- Separar fallos confirmados, observaciones heurísticas y sugerencias.
- Crear una propuesta de corrección; no modificar código ni desplegar sin autorización.

### D. Inteligencia comercial y operaciones

- Resumir visitas y clics de WhatsApp desde `catalog_events`.
- Identificar productos con interés, fichas incompletas, revisiones de proveedor vencidas y borradores.
- No inferir ventas ni conversiones que no estén registradas.

## Herramientas que podrá invocar el copiloto

- `search_products`: búsqueda de productos y variantes.
- `get_product_details`: lectura de ficha, precios y variantes.
- `get_provider_snapshot`: lectura de última revisión del proveedor.
- `get_catalog_metrics`: agregados de eventos disponibles.
- `prepare_product_draft`: generar y validar un borrador, sin guardar.
- `prepare_provider_price_update`: preparar cambios y mostrar diferencias, sin guardar.
- `commit_provider_price_update`: ejecutar una propuesta aprobada y revalidada.
- `commit_product_draft`: guardar un borrador aprobado como no publicado.
- `get_latest_qa_report`: consultar resultados de calidad disponibles.

Cada herramienta tendrá un esquema JSON estricto, límites y permisos específicos. No habrá una herramienta genérica para ejecutar SQL, JavaScript arbitrario ni operaciones administrativas libres.

## Modelo de datos existente a reutilizar

- `products`: catálogo, precios publicados, variantes, imágenes y estado de publicación.
- `product_provider_status`: último precio/estado conocido del proveedor y snapshot por variante.
- `product_provider_review_history`: historial de revisiones del proveedor.
- `catalog_events`: vistas y clics de WhatsApp.
- `admin_users`: autorización administrativa.
- `perfume_details`: detalles específicos de perfumería.

Antes de añadir tablas o migraciones, revisar las políticas RLS y el código actual de revisión de proveedor. Evitar duplicar historial que ya existe.

## Voz estilo asistente

- Activación mediante botón de micrófono, no escucha permanente.
- Indicadores claros: Listo, Escuchando, Procesando, Respondiendo y Error.
- Confirmación hablada breve, por ejemplo: “Encontré el POCO X8 Pro Max. El precio del proveedor pasó de… ¿Querés registrar el cambio?”
- Requerir confirmación visible para toda escritura, incluso si la orden fue hablada.
- La voz generada depende de las voces disponibles en el dispositivo; el estilo será una personalidad propia de JB Copilot, no una imitación de Jarvis ni de un actor.

## Fases de entrega

1. **Fundación segura**: sección + burbuja, interfaz de chat, estado de voz, endpoint protegido, configuración de Gemini en Cloudflare y pruebas de autorización/cuotas.
2. **Consulta de solo lectura**: búsqueda de productos, variantes, historial del proveedor, métricas y auditorías.
3. **Actualización de precios**: propuesta comparativa, confirmación, revalidación y registro histórico.
4. **Alta rápida de productos**: dictado, borrador estructurado, detección de duplicados, previsualización y guardado no publicado.
5. **Agentes de calidad y operaciones**: recomendaciones, tareas y acciones autorizadas.

## Criterios de aceptación

- Ninguna clave de IA aparece en bundles, HTML, logs o respuestas del navegador.
- Usuario no administrador recibe 403.
- Sin cuota o sin configuración de Gemini, el panel sigue funcionando con texto y funciones manuales.
- Una propuesta ambigua nunca se guarda.
- Cada cambio muestra antes/después y exige aprobación.
- Los cambios de proveedor conservan historial.
- Un alta asistida crea un borrador no publicado; publicar es una acción independiente.
- Pruebas automatizadas cubren autorización, validación de esquemas, duplicados, precios, variantes, confirmación y fallback de voz.
