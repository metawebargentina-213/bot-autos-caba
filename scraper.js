// Bot de búsqueda de autos en MercadoLibre + Kavak (CABA) -> avisa por Telegram con foto.
// Corre vía GitHub Actions (ver .github/workflows/buscar-autos.yml).

const cheerio = require("cheerio");
const fs = require("fs");
const path = require("path");

const PRICE_MIN = 8_000_000;
const PRICE_MAX = 15_000_000;
const FINANCING_MAX = 5_500_000;
const KM_MAX = 160_000;
const PRIORITY_BRANDS = ["fiat", "chevrolet", "toyota"];
const EXCLUDED_BRANDS = ["citroën", "citroen", "peugeot"];
// Barrios que aparecen por las búsquedas por concesionaria (sin restricción de barrio) pero quedan lejos.
const EXCLUDED_LOCATIONS = ["agronomía", "agronomia"];

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

// Concesionarias puntuales a incluir sin restricción de barrio (Nicolás las conoce y confía en ellas).
// Se buscan con el ?q= de ML dentro del filtro "Concesionaria" de Capital Federal.
const DEALER_QUERIES = ["Autogringo", "Automoviles San Jorge", "Carps 2011"];

const STATE_FILE = path.join(__dirname, "sent_ids.json");
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

const FINANCING_KEYWORDS = /financi|cuotas fijas|acepto financiaci|aceptamos financiaci/i;
const FINANCING_AMOUNT_RE = /(anticipo|entrega)[^\d$]{0,20}\$?\s?([\d][\d.,]{4,12})/i;

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

function parseKm(text) {
  if (!text) return null;
  const m = text.match(/([\d.]+)\s*km/i);
  if (!m) return null;
  const digits = m[1].replace(/\D/g, "");
  return digits ? parseInt(digits, 10) : null;
}

function parseMLCards(html, barrio) {
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

    const attrsText = card
      .find(".poly-attributes_list__item")
      .map((__, li) => $(li).text())
      .get()
      .join(" ");
    const km = parseKm(attrsText);

    const seller = card.find(".poly-component__seller").first().text().trim();
    const image = card.find(".poly-component__picture").first().attr("src") || null;

    listings.push({
      id,
      source: "ml",
      title,
      link,
      price,
      anticipo,
      km,
      seller,
      image,
      location,
      barrio,
    });
  });

  return listings;
}

async function fetchML(url, context) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      "Accept-Language": "es-AR,es;q=0.9",
    },
  });
  if (!res.ok) {
    console.error(`[${context}] HTTP ${res.status}`);
    return [];
  }
  return parseMLCards(await res.text(), context);
}

// Filtro nativo de ML "Concesionaria" (seller_type=car_dealer): la mayoría de los
// concesionarios lo tienen cargado, es el equivalente a "perfil verificado".
async function fetchBarrio(barrio) {
  const url = `https://autos.mercadolibre.com.ar/capital-federal/${barrio}/concesionaria/_PriceRange_${PRICE_MIN}-${PRICE_MAX}`;
  return fetchML(url, barrio);
}

// Concesionarias puntuales, sin restricción de barrio: se buscan por nombre dentro
// del mismo filtro de Concesionaria + precio en toda Capital Federal.
async function fetchDealer(query) {
  const url = `https://autos.mercadolibre.com.ar/capital-federal/concesionaria/_PriceRange_${PRICE_MIN}-${PRICE_MAX}?q=${encodeURIComponent(
    query
  )}`;
  const listings = await fetchML(url, `dealer:${query}`);
  return listings.map((l) => ({ ...l, barrio: `dealer:${query}`, trustedDealer: true }));
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
    /"id":"(\d+)","url":"(https:\/\/www\.kavak\.com\/ar\/venta\/[^"]+)","image":"([^"]*)".*?"title":"([^"]+)","subtitle":"([^"]+)".*?"mainPrice":"([^"]+)"/g;

  const listings = [];
  let m;
  while ((m = re.exec(clean)) !== null) {
    const [, id, link, imagePath, title, subtitle, priceStr] = m;
    const price = parseInt(priceStr.replace(/\D/g, ""), 10);
    const km = parseKm(subtitle);
    listings.push({
      id: `KAVAK${id}`,
      source: "kavak",
      title: `${title.replace(" • ", " ")} ${subtitle.split("•")[0].trim()}`.trim(),
      link,
      price,
      anticipo: null, // Kavak no informa anticipo fijo por aviso (financiamiento vía simulador de cuotas).
      km,
      image: imagePath ? `https://images.kavak.services/${imagePath}` : null,
      location: zone.label,
      barrio: zone.value,
    });
  }
  return listings;
}

async function fetchMLFinancingFromDescription(link) {
  try {
    const res = await fetch(link, {
      headers: {
        "User-Agent": USER_AGENT,
        "Accept-Language": "es-AR,es;q=0.9",
      },
    });
    if (!res.ok) return { amount: null, mentioned: false };
    const html = await res.text();
    const idx = html.indexOf("ui-pdp-description__content");
    const chunk = idx === -1 ? "" : html.slice(idx, idx + 3000);
    const $ = cheerio.load(chunk);
    const text = $.text() || chunk;

    const amountMatch = text.match(FINANCING_AMOUNT_RE);
    const amount = amountMatch ? parseInt(amountMatch[2].replace(/\D/g, ""), 10) : null;
    const mentioned = amount != null || FINANCING_KEYWORDS.test(text);
    return { amount, mentioned };
  } catch {
    return { amount: null, mentioned: false };
  }
}

async function evaluateListing(listing) {
  if (!listing.price || listing.price < PRICE_MIN || listing.price > PRICE_MAX) {
    return null;
  }
  if (listing.km != null && listing.km > KM_MAX) {
    return null;
  }

  const titleLower = listing.title.toLowerCase();
  if (EXCLUDED_BRANDS.some((brand) => titleLower.includes(brand))) {
    return null;
  }

  const locationLower = (listing.location || "").toLowerCase();
  if (EXCLUDED_LOCATIONS.some((loc) => locationLower.includes(loc))) {
    return null;
  }

  let financingStatus = "revisar";
  let anticipo = listing.anticipo;

  if (anticipo != null) {
    if (anticipo > FINANCING_MAX) return null; // anticipo excede lo pedido, descartar
    financingStatus = "fuerte";
  } else if (listing.source === "ml") {
    // La tarjeta no trae anticipo: buscamos en la descripción del aviso (solo concesionarias, ya filtradas arriba).
    const detail = await fetchMLFinancingFromDescription(listing.link);
    await new Promise((r) => setTimeout(r, 300));
    if (detail.amount != null) {
      if (detail.amount > FINANCING_MAX) return null;
      anticipo = detail.amount;
      financingStatus = "fuerte";
    } else if (detail.mentioned) {
      financingStatus = "revisar-positivo";
    }
  }

  const priority =
    PRIORITY_BRANDS.some((brand) => titleLower.includes(brand)) || !!listing.trustedDealer;

  return { ...listing, anticipo, financingStatus, priority };
}

function formatMoney(n) {
  return "$" + n.toLocaleString("es-AR");
}

function formatCaption(listing) {
  const lines = [];
  const tag = listing.trustedDealer ? "🤝 " : listing.priority ? "⭐ " : "";
  lines.push(`${tag}${listing.title}`);
  const sellerPart = listing.seller ? ` (${listing.seller})` : "";
  lines.push(`${formatMoney(listing.price)} — ${listing.location}${sellerPart}`);
  if (listing.km != null) lines.push(`${listing.km.toLocaleString("es-AR")} km`);
  if (listing.financingStatus === "fuerte") {
    lines.push(`✅ Anticipo: ${formatMoney(listing.anticipo)}`);
  } else if (listing.financingStatus === "revisar-positivo") {
    lines.push(`💬 Menciona financiación (sin monto fijo) — revisar en el link`);
  } else {
    lines.push(`⚠️ Financiamiento no informado — revisar en el link`);
  }
  lines.push(listing.link);
  return lines.join("\n").slice(0, 1024); // límite de caption de Telegram
}

async function sendTelegramPhoto(photoUrl, caption) {
  const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendPhoto`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, photo: photoUrl, caption }),
  });
  return res.ok;
}

async function sendTelegramMessage(text) {
  const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text, disable_web_page_preview: false }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Telegram error ${res.status}: ${body}`);
  }
}

async function sendListing(listing) {
  const caption = formatCaption(listing);
  if (listing.image) {
    const ok = await sendTelegramPhoto(listing.image, caption);
    if (ok) return;
  }
  await sendTelegramMessage(caption); // fallback sin foto
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
        if (sentIds[listing.id]) continue;
        const evaluated = await evaluateListing(listing);
        if (evaluated) allMatches.push(evaluated);
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
        if (sentIds[listing.id]) continue;
        const evaluated = await evaluateListing(listing);
        if (evaluated) allMatches.push(evaluated);
      }
    } catch (err) {
      console.error(`Error en Kavak ${zone.value}:`, err.message);
    }
    await new Promise((r) => setTimeout(r, 500)); // ser educado con Kavak
  }

  for (const query of DEALER_QUERIES) {
    try {
      const listings = await fetchDealer(query);
      for (const listing of listings) {
        if (sentIds[listing.id]) continue;
        const evaluated = await evaluateListing(listing);
        if (evaluated) allMatches.push(evaluated);
      }
    } catch (err) {
      console.error(`Error buscando concesionaria ${query}:`, err.message);
    }
    await new Promise((r) => setTimeout(r, 500)); // ser educado con ML
  }

  // Dedupe entre barrios (mismo aviso puede aparecer en más de uno)
  const uniqueMatches = Array.from(
    new Map(allMatches.map((m) => [m.id, m])).values()
  );

  // Prioridad: concesionarias de confianza y Fiat/Chevrolet/Toyota primero, después por precio ascendente.
  uniqueMatches.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority ? -1 : 1;
    return a.price - b.price;
  });

  if (uniqueMatches.length === 0) {
    console.log("Sin autos nuevos que cumplan los criterios en esta corrida.");
    return;
  }

  if (dryRun) {
    console.log(`[DRY RUN] ${uniqueMatches.length} matches (no se envía ni se guarda estado):\n`);
    for (const m of uniqueMatches) console.log(formatCaption(m) + `\n[img: ${m.image}]\n---`);
    return;
  }

  await sendTelegramMessage(
    `🚗 ${uniqueMatches.length} auto(s) nuevo(s), solo concesionarias, entre ${formatMoney(
      PRICE_MIN
    )} y ${formatMoney(PRICE_MAX)}:`
  );

  for (const m of uniqueMatches) {
    await sendListing(m);
    await new Promise((r) => setTimeout(r, 400));
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
