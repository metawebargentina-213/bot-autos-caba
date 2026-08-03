# Bot de autos CABA

Busca autos en MercadoLibre y Kavak (cualquier marca excepto Citroën/Peugeot/Ford, preferencia Fiat/Chevrolet/Toyota) y avisa por Telegram con foto cuando hay uno nuevo que cumple:

- Precio entre $8.000.000 y $15.000.000
- Máximo 160.000 km
- Modelo 2009 en adelante
- Anticipo de financiación ≤ $5.500.000 (en ML, si la tarjeta no lo muestra, se busca en la descripción del aviso; si sigue sin haber monto, se avisa igual marcado "revisar financiamiento")
- En ML, **solo concesionarias** (filtro nativo `seller_type=car_dealer` de MercadoLibre — el "perfil verificado", se descartan particulares). Kavak siempre cuenta como vendedor verificado.
- Sin GNC confirmado en la descripción del aviso (no alcanza con que la ficha técnica diga "Nafta/GNC", eso suele ser solo la opción de fábrica) y sin color rojo — aprendido del feedback, solo aplica en ML por ahora
- Ubicado en Capital Federal: MercadoLibre en Villa Crespo/Almagro y barrios linderos (Caballito, Palermo, Chacarita, Colegiales, Balvanera); Kavak en las zonas DOT y Almagro
- Además, sin restricción de barrio: Autogringo y Carps 2011 (concesionarias de confianza, se buscan por nombre en toda Capital Federal) — marcadas con 🤝, salvo que el auto esté en Agronomía (queda lejos, se descarta igual)

Corre solo, gratis, vía GitHub Actions (`.github/workflows/buscar-autos.yml`), cada 30 minutos. No hace falta tenerlo abierto ni revisarlo.

Cada aviso llega con dos botones, **✅ Me gustó** / **❌ No me gustó**. Al tocar uno, el bot pregunta al instante qué te gustó (o no) y guarda tu respuesta junto con los datos del auto — así se va armando un registro de tus gustos (marcas, precios, features) para ir afinando qué priorizar.

## Cómo funciona

1. Cada 30 min, GitHub Actions ejecuta `scraper.js`.
2. El script pide las páginas públicas de `autos.mercadolibre.com.ar` (por barrio, por concesionaria puntual) y `kavak.com/ar/usados` (por zona), sin login ni API paga.
3. Filtra por precio, km, año, marca excluida y financiamiento; para concesionarias de ML sin anticipo visible, abre el aviso y busca menciones de financiación en la descripción.
4. Prioriza Autogringo/Carps 2011 y Fiat/Chevrolet/Toyota.
5. Los autos nuevos (no avisados antes) se mandan por Telegram al bot `@nicoautoscaba_bot`, uno por uno con su foto y los botones ✅/❌. La metadata de cada uno se guarda en Cloudflare KV para poder mostrarla después si das feedback.
6. Guarda los IDs ya avisados en `sent_ids.json` (se commitea solo) para no repetir.

### El webhook de feedback (`worker/`)

Un [Cloudflare Worker](https://bot-autos-caba-webhook.nicoautoscaba.workers.dev) separado (gratis, plan free) escucha en tiempo real los mensajes que le mandás al bot:

- Si tocás ✅/❌, responde al instante preguntando qué te gustó/no te gustó.
- Tu respuesta se guarda en Cloudflare KV (namespace `bot_autos_data`) junto con los datos del auto: `feedback:<timestamp>_<id>` → `{listingId, sentiment, reason, title, price, km, year, seller, ...}`.
- Ese registro no ajusta los filtros solo — hay que revisarlo y actualizar `PRIORITY_BRANDS`/`EXCLUDED_BRANDS` a mano en base a los patrones que aparezcan.

Deploy del Worker: `cd worker && npx wrangler deploy` (con `CLOUDFLARE_API_TOKEN` y `CLOUDFLARE_ACCOUNT_ID` en el entorno).

## Setup (ya hecho)

- Bot de Telegram: `@nicoautoscaba_bot`
- Secrets en el repo de GitHub: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_KV_NAMESPACE_ID`
- Cuenta de Cloudflare: `rnico2080@gmail.com` (separada de la cuenta de GitHub de la agencia, a pedido)
- Worker desplegado en `bot-autos-caba-webhook.nicoautoscaba.workers.dev`, registrado como webhook del bot de Telegram

## Correr manualmente

En GitHub → Actions → "Buscar autos CABA" → "Run workflow". O local:

```bash
npm install
TELEGRAM_BOT_TOKEN=xxx TELEGRAM_CHAT_ID=xxx CLOUDFLARE_ACCOUNT_ID=xxx CLOUDFLARE_API_TOKEN=xxx CLOUDFLARE_KV_NAMESPACE_ID=xxx node scraper.js
```

(Las variables de Cloudflare son opcionales: sin ellas el bot manda los avisos igual, solo que sin metadata guardada para los botones.)

## Ajustar criterios

Todo está al principio de `scraper.js`: `PRICE_MIN`, `PRICE_MAX`, `FINANCING_MAX`, `KM_MAX`, `YEAR_MIN`, `PRIORITY_BRANDS`, `EXCLUDED_BRANDS`, `EXCLUDED_LOCATIONS`, `EXCLUDED_COLORS`, `BARRIOS`, `KAVAK_ZONES`, `DEALER_QUERIES`.
