# Bot de autos CABA

Busca autos en MercadoLibre (cualquier marca, preferencia Fiat/Chevrolet) y avisa por Telegram cuando hay uno nuevo que cumple:

- Precio entre $8.000.000 y $15.000.000
- Anticipo de financiación ≤ $5.500.000 (si ML no muestra el dato, se avisa igual marcado como "revisar financiamiento")
- Ubicado en Capital Federal, zona Villa Crespo/Almagro y barrios linderos (Caballito, Palermo, Chacarita, Colegiales, Balvanera)

Corre solo, gratis, vía GitHub Actions (`.github/workflows/buscar-autos.yml`), una vez por hora. No hace falta tenerlo abierto ni revisarlo.

## Cómo funciona

1. Cada hora, GitHub Actions ejecuta `scraper.js`.
2. El script pide las páginas públicas de `autos.mercadolibre.com.ar` para cada barrio (sin login, sin API paga).
3. Filtra por precio, financiamiento y prioriza Fiat/Chevrolet.
4. Los autos nuevos (no avisados antes) se mandan por Telegram al bot `@nicoautoscaba_bot`.
5. Guarda los IDs ya avisados en `sent_ids.json` (se commitea solo) para no repetir.

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

Todo está al principio de `scraper.js`: `PRICE_MIN`, `PRICE_MAX`, `FINANCING_MAX`, `PRIORITY_BRANDS`, `BARRIOS`.
