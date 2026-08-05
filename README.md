# Bot de autos CABA

Busca autos en MercadoLibre y Kavak (cualquier marca excepto Citroën/Peugeot/Ford, preferencia Fiat/Chevrolet/Toyota) y avisa por Telegram con foto cuando hay uno nuevo que cumple:

- Precio entre $8.000.000 y $15.000.000
- Máximo 160.000 km
- Modelo 2009 en adelante
- Motor 1.3 en adelante (nada de 1.2 o menos)
- 4 o 5 puertas (nada de 3, tampoco 6+) — solo cuando el título lo informa
- Anticipo de financiación ≤ $5.500.000 (en ML, si la tarjeta no lo muestra, se busca en la descripción del aviso; si sigue sin haber monto, se avisa igual marcado "revisar financiamiento")
- En ML, **solo concesionarias** (filtro nativo `seller_type=car_dealer` de MercadoLibre — el "perfil verificado", se descartan particulares). Kavak siempre cuenta como vendedor verificado.
- Sin GNC confirmado en la descripción del aviso (no alcanza con que la ficha técnica diga "Nafta/GNC", eso suele ser solo la opción de fábrica) y sin color rojo — aprendido del feedback, solo aplica en ML por ahora
- Ubicado en Capital Federal: MercadoLibre en Villa Crespo/Almagro y barrios linderos (Caballito, Palermo, Chacarita, Colegiales, Balvanera); Kavak en las zonas DOT y Almagro
- Además, sin restricción de barrio: Autogringo, Carps 2011 y Qualis Cars (concesionarias de confianza, se buscan por nombre en toda Capital Federal) — marcadas con 🤝, salvo que el auto esté en Agronomía (queda lejos, se descarta igual)
- **Imola Autos** ([imolaautos.com](https://imolaautos.com)) — sitio propio de esa concesionaria, con sus 3 sucursales en CABA, marcado con 🤝. A diferencia de ML, ahí el combustible es un dato estructurado, así que el filtro de GNC es directo (no hace falta buscarlo en la descripción)
- **Avisos en USD**: ML a veces publica en dólares. Se convierten a pesos con la cotización del [dólar blue](https://api.bluelytics.com.ar/v2/latest) (gratis, sin API key) para poder compararlos contra el rango de precio; el mensaje muestra el original en USD y la conversión, ej. `US$ 6.500 (≈ $10.010.000 blue)`. El anticipo de esos avisos también viene en USD y se convierte igual.

Corre solo, gratis, cada 30 minutos. No hace falta tenerlo abierto ni revisarlo.

Cada aviso llega con dos botones, **✅ Me gustó** / **❌ No me gustó**. Al tocar uno, el bot pregunta al instante qué te gustó (o no) y guarda tu respuesta junto con los datos del auto — así se va armando un registro de tus gustos (marcas, precios, features) para ir afinando qué priorizar.

## Cómo funciona

1. El scraper (`scraper.js`) corre en GitHub Actions y hace todo el trabajo pesado: busca, filtra y manda por Telegram.
2. El script pide las páginas públicas de `autos.mercadolibre.com.ar` (por barrio, por concesionaria puntual), `kavak.com/ar/usados` (por zona) e `imolaautos.com/resultados` (con filtro de precio propio), sin login ni API paga.
3. Filtra por precio, km, año, motor, marca excluida, color/GNC y financiamiento; para concesionarias de ML sin anticipo visible, abre el aviso y busca menciones de financiación en la descripción.
4. Prioriza Autogringo/Carps 2011/Qualis Cars/Imola Autos y Fiat/Chevrolet/Toyota.
5. Los autos nuevos (no avisados antes) se mandan por Telegram al bot `@nicoautoscaba_bot`, uno por uno con su foto y los botones ✅/❌. La metadata de cada uno se guarda en Cloudflare KV para poder mostrarla después si das feedback.
6. Guarda los IDs ya avisados en `sent_ids.json` (se commitea solo) para no repetir.

### Quién dispara el scraper cada 30 min

**El `schedule` de GitHub Actions no es confiable** — en este repo nunca disparó ni una sola vez por su cuenta (bug conocido, reportado seguido por la comunidad en repos nuevos), ni siquiera después de hacer el repo público. Por eso el cron real vive en Cloudflare: el mismo Worker de abajo tiene un **Cron Trigger** (`*/30 * * * *`, nativo de Cloudflare, confiable) que dispara el workflow de GitHub por su API (`workflows/buscar-autos.yml/dispatches`), usando un Personal Access Token de alcance mínimo (`GITHUB_DISPATCH_TOKEN`, permiso único: Actions de este repo). El trigger `schedule` del workflow se dejó como respaldo por si GitHub lo arregla en el futuro, pero no es de quien depende.

### El webhook + cron (`worker/`)

Un [Cloudflare Worker](https://bot-autos-caba-webhook.nicoautoscaba.workers.dev) separado (gratis, plan free, cuenta `rnico2080@gmail.com`) hace dos cosas:

- **Cron** (cada 30 min): dispara la corrida del scraper en GitHub Actions (ver arriba).
- **Webhook de Telegram** (tiempo real): si tocás ✅/❌ en un aviso, responde al instante citando el mensaje del auto y preguntando qué te gustó/no te gustó. Tu respuesta se guarda en Cloudflare KV (namespace `bot_autos_data`) junto con los datos del auto: `feedback:<timestamp>_<id>` → `{listingId, sentiment, reason, title, price, km, year, seller, ...}`. Ese registro no ajusta los filtros solo — hay que revisarlo y actualizar `PRIORITY_BRANDS`/`EXCLUDED_BRANDS`/etc. a mano en base a los patrones que aparezcan.
- **Proxy de Kavak** (`/kavak-proxy`): GitHub Actions tiene la IP bloqueada por el anti-bot de Kavak (403 directo), Cloudflare no. `scraper.js` le pide las páginas de Kavak a este endpoint del Worker en vez de pedírselas directo, protegido con el mismo secreto del webhook (`KAVAK_PROXY_SECRET` = `WEBHOOK_SECRET`). Si `KAVAK_PROXY_URL` no está configurado, cae al fetch directo (sirve para correr local, no para Actions).

Deploy del Worker: `cd worker && npx wrangler deploy` (con `CLOUDFLARE_API_TOKEN` y `CLOUDFLARE_ACCOUNT_ID` en el entorno).

## Setup (ya hecho)

- Bot de Telegram: `@nicoautoscaba_bot`
- Secrets en el repo de GitHub: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_KV_NAMESPACE_ID`, `KAVAK_PROXY_URL`, `KAVAK_PROXY_SECRET`
- Cuenta de Cloudflare: `rnico2080@gmail.com` (separada de la cuenta de GitHub de la agencia, a pedido)
- Worker desplegado en `bot-autos-caba-webhook.nicoautoscaba.workers.dev`, registrado como webhook del bot de Telegram y con Cron Trigger propio (`*/30 * * * *`)
- Repo de GitHub público (necesario para que el trigger `schedule` tenga chance de andar; igual el cron real es el de Cloudflare)

## Correr manualmente

En GitHub → Actions → "Buscar autos CABA" → "Run workflow". O local:

```bash
npm install
TELEGRAM_BOT_TOKEN=xxx TELEGRAM_CHAT_ID=xxx CLOUDFLARE_ACCOUNT_ID=xxx CLOUDFLARE_API_TOKEN=xxx CLOUDFLARE_KV_NAMESPACE_ID=xxx node scraper.js
```

(Las variables de Cloudflare son opcionales: sin ellas el bot manda los avisos igual, solo que sin metadata guardada para los botones.)

## Ajustar criterios

Todo está al principio de `scraper.js`: `PRICE_MIN`, `PRICE_MAX`, `FINANCING_MAX`, `KM_MAX`, `YEAR_MIN`, `ENGINE_MIN`, `DOORS_MIN`, `DOORS_MAX`, `PRIORITY_BRANDS`, `EXCLUDED_BRANDS`, `EXCLUDED_LOCATIONS`, `EXCLUDED_COLORS`, `BARRIOS`, `KAVAK_ZONES`, `DEALER_QUERIES`.
