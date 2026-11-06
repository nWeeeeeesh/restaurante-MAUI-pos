> **Superado por docs/plan-sistema.md (2026-11-05).**

# Tesis: documentación

| Archivo | Qué es |
|---|---|
| `Plan_de_Tesis_MAUI_v3.docx` | Plan de tesis (UNSA). Fuente de verdad del diseño de la investigación: problema, objetivos, hipótesis, indicadores, análisis y limitaciones. |
| `../plan-inventario-tesis.md` | Encargo de desarrollo (v3): qué construir, en qué orden y con qué invariantes. |
| `../diccionario-datos-tesis.md` | Instrumento de medición: definiciones y columnas del export (dataset v1, congelado el 2026-11-09). |
| `hitos-tesis.md` | Hitos de redacción de la tesis (H0 a H9), fechas y reglas de redacción y de fuentes. |
| `fuentes.md` | Registro de fuentes bibliográficas: idioma, año, función, DOI y estado de verificación. |
| `replicacion-local-2.md` | Registro del costo de instalar el sistema en el segundo local (se crea en la entrega E2). |

## Resumen del diseño para quien desarrolla

- **Pregunta:** ¿cuál es el efecto de un sistema de gestión de insumos perecibles con pronóstico de demanda, integrado al POS, en la rentabilidad operativa del local principal?
- **Diseño:** series de tiempo interrumpidas con grupo de comparación.
  - El calamar y el pescado reciben la intervención de forma escalonada (11-ene y 01-feb de 2027, en orden sorteado).
  - Los mariscos quedan sin intervención hasta el fin del estudio (04-abr-2027) como grupo de comparación.
  - Línea base desde el 09-nov-2026.
- **Indicador principal:** utilidad bruta atribuible a cada grupo, por semana y a precios constantes. Se calcula en el análisis con el export (`sales`, `daily`, `purchases`, `transfers`, `counts` y recetas).
- **Indicadores secundarios:**
  - quiebres y ventas perdidas (cota superior);
  - food cost;
  - merma y sobrante;
  - adherencia a la sugerencia;
  - error del pronóstico (MASE);
  - beneficio-costo y escalabilidad.
- **Por qué importan las reglas del código:** si algo de la intervención llega antes de tiempo a un grupo, o al dueño como indicador global, el grupo de comparación deja de servir y la tesis pierde su evidencia. Por eso existen los invariantes de la §1.2 del plan.
