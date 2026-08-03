# Bot de autos CABA

Busca autos en MercadoLibre y Kavak (cualquier marca, preferencia Fiat/Chevrolet/Toyota) y avisa por Telegram con foto cuando hay uno nuevo que cumple:

- Precio entre $8.000.000 y $15.000.000
- Máximo 160.000 km
- Anticipo de financiación ≤ $5.500.000 (en ML, si la tarjeta no lo muestra, se busca en la descripción del aviso; si sigue sin haber monto, se avisa igual marcado "revisar financiamiento")
- En ML, **solo concesionarias/tiendas oficiales verificadas** (se descartan particulares). Kavak siempre cuenta como vendedor verificado.
- Ubicado en Capital Federal: MercadoLibre en Villa Crespo/Almagro y barrios linderos (Caballito, Palermo, Chacarita, Colegiales, Balvanera); Kavak en las zonas DOT y Almagro

Corre solo, gratis, vía GitHub Actions (`.github/workflows/buscar-autos.yml`), una vez por hora. No hace falta tenerlo abierto ni revisarlo.

## Cómo funciona

1. Cada hora, GitHub Actions ejecuta `scraper.js`.
2. El script pide las páginas públicas de `autos.mercadolibre.com.ar` (por barrio) y `kavak.com/ar/usados` (por zona), sin login ni API paga.
3. Filtra por precio, km, tienda oficial (solo ML) y financiamiento; para concesionarias de ML sin anticipo visible, abre el aviso y busca menciones de financiación en la descripción.
4. Prioriza Fiat/Chevrolet/Toyota.
5. Los autos nuevos (no avisados antes) se mandan por Telegram al bot `@nicoautoscaba_bot`, uno por uno con su foto.
6. Guarda los IDs ya avisados en `sent_ids.json` (se commitea solo) para no repetir.

## Setup (ya hecho)

- Bot de Telegram: `@nicoautoscaba_bot`
- Secrets configurados en el repo de GitHub: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`

## Correr manualmente

En GitHub → Actions → "Buscar autos CABA" → "Run workflow". O local:

```bash
npm install
TELEGRAM_BOT_TOKEN=xxx TELEGRAM_CHAT_ID=xxx node scraper.js
```

## Ajustar criterios

Todo está al principio de `scraper.js`: `PRICE_MIN`, `PRICE_MAX`, `FINANCING_MAX`, `KM_MAX`, `PRIORITY_BRANDS`, `BARRIOS`, `KAVAK_ZONES`.
