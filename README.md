# Bot de autos CABA

Busca autos en MercadoLibre y Kavak (cualquier marca excepto Citroën/Peugeot/Ford, preferencia Fiat/Chevrolet/Toyota) y avisa por Telegram con foto cuando hay uno nuevo que cumple:

- Precio entre $8.000.000 y $15.000.000
- Máximo 160.000 km
- Modelo 2009 en adelante
- Anticipo de financiación ≤ $5.500.000 (en ML, si la tarjeta no lo muestra, se busca en la descripción del aviso; si sigue sin haber monto, se avisa igual marcado "revisar financiamiento")
- En ML, **solo concesionarias** (filtro nativo `seller_type=car_dealer` de MercadoLibre — el "perfil verificado", se descartan particulares). Kavak siempre cuenta como vendedor verificado.
- Ubicado en Capital Federal: MercadoLibre en Villa Crespo/Almagro y barrios linderos (Caballito, Palermo, Chacarita, Colegiales, Balvanera); Kavak en las zonas DOT y Almagro
- Además, sin restricción de barrio: Autogringo y Carps 2011 (concesionarias de confianza, se buscan por nombre en toda Capital Federal) — marcadas con 🤝, salvo que el auto esté en Agronomía (queda lejos, se descarta igual)

Corre solo, gratis, vía GitHub Actions (`.github/workflows/buscar-autos.yml`), una vez por hora. No hace falta tenerlo abierto ni revisarlo.

## Cómo funciona

1. Cada hora, GitHub Actions ejecuta `scraper.js`.
2. El script pide las páginas públicas de `autos.mercadolibre.com.ar` (por barrio, por concesionaria puntual) y `kavak.com/ar/usados` (por zona), sin login ni API paga.
3. Filtra por precio, km, marca excluida y financiamiento; para concesionarias de ML sin anticipo visible, abre el aviso y busca menciones de financiación en la descripción.
4. Prioriza Autogringo/Carps 2011 y Fiat/Chevrolet/Toyota.
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

Todo está al principio de `scraper.js`: `PRICE_MIN`, `PRICE_MAX`, `FINANCING_MAX`, `KM_MAX`, `YEAR_MIN`, `PRIORITY_BRANDS`, `EXCLUDED_BRANDS`, `EXCLUDED_LOCATIONS`, `BARRIOS`, `KAVAK_ZONES`, `DEALER_QUERIES`.
