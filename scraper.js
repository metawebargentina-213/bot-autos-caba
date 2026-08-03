// Bot de búsqueda de autos en MercadoLibre (CABA) -> avisa por Telegram.
// Corre vía GitHub Actions (ver .github/workflows/buscar-autos.yml).

const cheerio = require("cheerio");
const fs = require("fs");
const path = require("path");

const PRICE_MIN = 8_000_000;
const PRICE_MAX = 15_000_000;
const FINANCING_MAX = 5_500_000;
const PRIORITY_BRANDS = ["fiat", "chevrolet", "toyota"];

// Villa Crespo / Almagro + barrios linderos (~2-3km), todo dentro de CABA.
const BARRIOS = [
  "villa-crespo",
  "almagro",
  "caballito",
  "palermo",
  "chacarita",
  "colegiales",
  "balvanera",
];

// Zonas de Kavak (filtro real vía query param ?location=, no el slug de URL):
// sucursal DOT (Núñez, CABA) y zona "Almagro".
const KAVAK_ZONES = [
  { value: "kavak_dot", label: "Kavak DOT" },
  { value: "almagro", label: "Kavak — Almagro" },
];

const STATE_FILE = path.join(__dirname, "sent_ids.json");
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

function loadSentIds() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
  } catch {
    return {};
  }
}

function saveSentIds(sent) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(sent, null, 2));
}

function moneyFromAriaLabel(ariaLabel) {
  if (!ariaLabel) return null;
  const digits = ariaLabel.replace(/[^\d]/g, "");
  return digits ? parseInt(digits, 10) : null;
}

async function fetchBarrio(barrio) {
  const url = `https://autos.mercadolibre.com.ar/capital-federal/${barrio}/_PriceRange_${PRICE_MIN}-${PRICE_MAX}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      "Accept-Language": "es-AR,es;q=0.9",
    },
  });
  if (!res.ok) {
    console.error(`[${barrio}] HTTP ${res.status}`);
    return [];
  }
  const html = await res.text();
  const $ = cheerio.load(html);
  const listings = [];

  $("li.ui-search-layout__item").each((_, el) => {
    const card = $(el);
    const titleEl = card.find("a.poly-component__title").first();
    const title = titleEl.text().trim();
    const link = (titleEl.attr("href") || "").split("#")[0];
    if (!title || !link) return;

    const idMatch = link.match(/MLA-?(\d+)/);
    const id = idMatch ? `MLA${idMatch[1]}` : link;

    const priceAria = card
      .find(".poly-price__current .andes-money-amount")
      .first()
      .attr("aria-label");
    const price = moneyFromAriaLabel(priceAria);

    const anticipoAria = card
      .find(".poly-price__complements .andes-money-amount")
      .first()
      .attr("aria-label");
    const anticipo = moneyFromAriaLabel(anticipoAria);

    const location = card.find(".poly-component__location").first().text().trim();

    listings.push({ id, title, link, price, anticipo, location, barrio });
  });

  return listings;
}

async function fetchKavakZone(zone) {
  const url = `https://www.kavak.com/ar/usados?location=${zone.value}&min_price=${PRICE_MIN}&max_price=${PRICE_MAX}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      "Accept-Language": "es-AR,es;q=0.9",
    },
  });
  if (!res.ok) {
    console.error(`[kavak:${zone.value}] HTTP ${res.status}`);
    return [];
  }
  const html = await res.text();
  // Los datos vienen embebidos como JSON escapado dentro del payload RSC de Next.js.
  const clean = html.split('\\"').join('"').split("\\/").join("/");

  const re =
    /"id":"(\d+)","url":"(https:\/\/www\.kavak\.com\/ar\/venta\/[^"]+)".*?"title":"([^"]+)","subtitle":"([^"]+)".*?"mainPrice":"([^"]+)"/g;

  const listings = [];
  let m;
  while ((m = re.exec(clean)) !== null) {
    const [, id, link, title, subtitle, priceStr] = m;
    const price = parseInt(priceStr.replace(/\D/g, ""), 10);
    listings.push({
      id: `KAVAK${id}`,
      title: `${title.replace(" • ", " ")} ${subtitle.split("•")[0].trim()}`.trim(),
      link,
      price,
      anticipo: null, // Kavak no informa anticipo fijo por aviso (financiamiento vía simulador de cuotas).
      location: zone.label,
      barrio: zone.value,
    });
  }
  return listings;
}

function evaluateListing(listing) {
  if (!listing.price || listing.price < PRICE_MIN || listing.price > PRICE_MAX) {
    return null;
  }

  let financingStatus;
  if (listing.anticipo != null) {
    if (listing.anticipo > FINANCING_MAX) return null; // anticipo excede lo pedido, descartar
    financingStatus = "fuerte";
  } else {
    financingStatus = "revisar";
  }

  const titleLower = listing.title.toLowerCase();
  const priority = PRIORITY_BRANDS.some((brand) => titleLower.includes(brand));

  return { ...listing, financingStatus, priority };
}

function formatMoney(n) {
  return "$" + n.toLocaleString("es-AR");
}

function formatMessage(listing) {
  const lines = [];
  const tag = listing.priority ? "⭐ " : "";
  lines.push(`${tag}${listing.title}`);
  lines.push(`${formatMoney(listing.price)} — ${listing.location}`);
  if (listing.financingStatus === "fuerte") {
    lines.push(`✅ Anticipo: ${formatMoney(listing.anticipo)}`);
  } else {
    lines.push(`⚠️ Financiamiento no informado — revisar en el link`);
  }
  lines.push(listing.link);
  return lines.join("\n");
}

async function sendTelegram(text) {
  const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text,
      disable_web_page_preview: false,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Telegram error ${res.status}: ${body}`);
  }
}

function chunkMessages(blocks, maxLen = 3800) {
  const chunks = [];
  let current = "";
  for (const block of blocks) {
    if (current && (current.length + block.length + 2) > maxLen) {
      chunks.push(current);
      current = "";
    }
    current += (current ? "\n\n" : "") + block;
  }
  if (current) chunks.push(current);
  return chunks;
}

async function main() {
  const dryRun = process.env.DRY_RUN === "1";
  if (!dryRun && (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID)) {
    throw new Error("Faltan TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID en el entorno.");
  }

  const sentIds = loadSentIds();
  const allMatches = [];

  for (const barrio of BARRIOS) {
    try {
      const listings = await fetchBarrio(barrio);
      for (const listing of listings) {
        const evaluated = evaluateListing(listing);
        if (evaluated && !sentIds[evaluated.id]) {
          allMatches.push(evaluated);
        }
      }
    } catch (err) {
      console.error(`Error en barrio ${barrio}:`, err.message);
    }
    await new Promise((r) => setTimeout(r, 500)); // ser educado con ML
  }

  for (const zone of KAVAK_ZONES) {
    try {
      const listings = await fetchKavakZone(zone);
      for (const listing of listings) {
        const evaluated = evaluateListing(listing);
        if (evaluated && !sentIds[evaluated.id]) {
          allMatches.push(evaluated);
        }
      }
    } catch (err) {
      console.error(`Error en Kavak ${zone.value}:`, err.message);
    }
    await new Promise((r) => setTimeout(r, 500)); // ser educado con Kavak
  }

  // Dedupe entre barrios (mismo aviso puede aparecer en más de uno)
  const uniqueMatches = Array.from(
    new Map(allMatches.map((m) => [m.id, m])).values()
  );

  // Prioridad: Fiat/Chevrolet primero, después por precio ascendente.
  uniqueMatches.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority ? -1 : 1;
    return a.price - b.price;
  });

  if (uniqueMatches.length === 0) {
    console.log("Sin autos nuevos que cumplan los criterios en esta corrida.");
    return;
  }

  const blocks = uniqueMatches.map(formatMessage);
  const header = `🚗 ${uniqueMatches.length} auto(s) nuevo(s) en CABA (Villa Crespo/Almagro y zona) entre ${formatMoney(
    PRICE_MIN
  )} y ${formatMoney(PRICE_MAX)}:\n`;
  const chunks = chunkMessages([header, ...blocks]);

  if (dryRun) {
    console.log(`[DRY RUN] ${uniqueMatches.length} matches (no se envía ni se guarda estado):\n`);
    console.log(chunks.join("\n\n---\n\n"));
    return;
  }

  for (const chunk of chunks) {
    await sendTelegram(chunk);
    await new Promise((r) => setTimeout(r, 300));
  }

  for (const m of uniqueMatches) {
    sentIds[m.id] = new Date().toISOString();
  }
  saveSentIds(sentIds);
  console.log(`Enviados ${uniqueMatches.length} autos nuevos.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
