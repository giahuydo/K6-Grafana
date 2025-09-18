import http from "k6/http";
import { check, sleep, group } from "k6";
import { parseHTML } from "k6/html";

const URL_BASE = "https://dev.theavotree.co.nz";
const SHOP_ALL_URL = "https://dev.theavotree.co.nz/shop-all/";
const PRODUCT_URL = __ENV.URL || "https://dev.theavotree.co.nz/product/hass";

export const options = {
	// stages: [
	//   { duration: '10s', target: 1 },  // giữ 1 VU trong 1 phút
	// ],
	// stages: [
	// 	{ duration: "2m", target: 100 }, // ramp lên 100 user
	// 	{ duration: "5m", target: 100 }, // giữ 100 user
	// 	{ duration: "2m", target: 200 }, // tăng lên 200 user
	// 	{ duration: "5m", target: 200 }, // giữ 200 user
	// 	{ duration: "2m", target: 0 }, // hạ nhiệt
	// ],
	// stages: [
	// 	{ duration: "10s", target: 20 }, // ramp lên 20 user
	// 	{ duration: "20s", target: 20 }, // giữ 20 user
	// 	{ duration: "10s", target: 50 }, // tăng lên 50 user
	// 	{ duration: "20s", target: 50 }, // giữ 50 user
	// 	{ duration: "10s", target: 0 }, // hạ nhiệt
	// ],
	stages: [
		{ duration: "30s", target: 20 }, // ramp lên 20 user
		{ duration: "90s", target: 20 }, // giữ 20 user (1.5 phút)
		{ duration: "30s", target: 50 }, // ramp lên 50 user
		{ duration: "90s", target: 50 }, // giữ 50 user (1.5 phút)
		{ duration: "40s", target: 0 }, // hạ nhiệt
	],

	// add global tags so Grafana dashboard filters (e.g., Test ID) can match
	tags: {
		testid: __ENV.TEST_ID || "local-dev",
	},

  // sample 3 minute
  // scenarios: {
  //   main: {
  //     executor: "ramping-vus",
  //     startVUs: 0,
  //     stages: [
  //       { duration: "1m", target: 10 },
  //       { duration: "1m", target: 10 },
  //       { duration: "1m", target: 0 },
  //     ],
  //     gracefulRampDown: "10s",
  //     gracefulStop: "10s",
  //   },
  // },


	thresholds: {
		http_req_failed: ["rate<0.05"], // cho phép fail đến 5% request
		"http_req_duration{endpoint:home_page}": ["p(95)<3000"], // HomePage < 5s
		"http_req_duration{endpoint:shop_all}": ["p(95)<5000"],
		"http_req_duration{endpoint:PDP}": ["p(95)<5000"], // 5s
		"http_req_duration{endpoint:add_to_cart}": ["p(95)<10000"], // 10s
		"http_req_duration{endpoint:update_order_review}": ["p(95)<10000"], // 10s
		"http_req_duration{endpoint:checkout_page}": ["p(95)<15000"], // 15s
		"http_req_duration{endpoint:checkout_finish}": ["p(95)<20000"], // 20s
		checks: ["rate>0.95"], // relax 95% checks pass
	},
	discardResponseBodies: false, // turn on if you only care about latency
};

let BASE;
try {
	BASE = new URL(URL_BASE).origin;
} catch (_) {
	BASE = __ENV.BASE || PRODUCT_URL.split("/").slice(0, 3).join("/");
}

// helper log
function logReq(label, res, extra = {}) {
	const t = res.timings || {};
	console.log(
		`[${label}] status=${res.status} size=${(res.body || "").length}B ` +
			`dur=${t.duration}ms wait=${t.waiting}ms send=${t.sending}ms recv=${t.receiving}ms ` +
			`blocked=${t.blocked}ms tls=${t.tls_handshaking}ms conn=${t.connecting}ms ` +
			`tags=${JSON.stringify(res.request?.tags || {})} ` +
			(extra.msg ? `msg="${extra.msg}" ` : "") +
			(extra.note ? `note="${extra.note}"` : "")
	);
}

const PRODUCTS = [
	{
		pid: 728952,
		vid: 729076,
		qty: 1,
		attr: "box-25-price-box",
		custom_box_price: 25,
		referer: `${BASE}/product/hass/`,
	},
	{
		pid: 728951,
		vid: 729067,
		qty: 15,
		attr: "size-mini",
		custom_box_price: 1.39,
		referer: `${BASE}/product/gem/`,
	},
];

function pick(arr) {
	return arr[(Math.random() * arr.length) | 0];
}

// ===== Helpers =====
function logFail(label, res, url, slice = 200) {
  console.log(`[${label} FAIL] status=${res.status} url=${url}`);
  console.log(`[${label} body] ${String(res.body || "").slice(0, slice)}`);
}

function checkTagged(target, checks, tags) {
  return check(target, checks, tags);
}

// ===== 1) Home =====
export function hitHome() {
  const res = http.get(URL_BASE, { timeout: "60s", tags: { endpoint: "home_page" } });
  if (res.status !== 200) logFail("Home", res, URL_BASE);
  checkTagged(
    res,
    { "Home 200": r => r.status === 200, "Home body not empty": r => (r.body || "").length > 0 },
    { endpoint: "home_page" }
  );
  sleep(1);
}

// ===== 2) Shop All =====
export function hitShopAll() {
  const res = http.get(SHOP_ALL_URL, { timeout: "60s", tags: { endpoint: "shop_all" } });
  if (res.status !== 200) logFail("ShopAll", res, SHOP_ALL_URL);
  checkTagged(
    res,
    { "ShopAll 200": r => r.status === 200, "ShopAll body not empty": r => (r.body || "").length > 0 },
    { endpoint: "shop_all" }
  );
  sleep(1);
}

// ===== 3) PDP =====
export function hitPDP() {
  const res = http.get(PRODUCT_URL, { timeout: "60s", tags: { endpoint: "PDP" } });
  if (res.status !== 200) logFail("PDP", res, PRODUCT_URL);
  checkTagged(
    res,
    { "PDP 200": r => r.status === 200, "PDP body not empty": r => (r.body || "").length > 0 },
    { endpoint: "PDP" }
  );
  sleep(1);
}

// ===== 4) Add to Cart =====
export function addToCart() {
  const p = pick(PRODUCTS);
  const HEADERS_ATC = {
    Accept: "application/json, text/javascript, */*; q=0.01",
    "Accept-Language": "en-US,en;q=0.9,vi;q=0.8",
    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    "X-Requested-With": "XMLHttpRequest",
    Origin: BASE,
    Referer: p.referer,
    "User-Agent": "k6-avotree-loadtest/1.0",
    "X-Test-Run": "avotree-loadtest",
  };

  const body = [
    `action=woocommerce_ajax_add_to_cart`,
    `product_id=${encodeURIComponent(p.pid)}`,
    `variation_id=${encodeURIComponent(p.vid)}`,
    `quantity=${encodeURIComponent(p.qty)}`,
    `custom_box_price=${encodeURIComponent(p.custom_box_price)}`,
    `attributes%5Battribute_pa_optional-product%5D=${encodeURIComponent(p.attr)}`,
    `memberships%5Bpa_frequency%5D=`,
    `memberships%5Bpa_dispatch-day%5D=`,
    `memberships%5Bstart_subcription%5D=`,
  ].join("&");

  const res = http.post(`${BASE}/wp-admin/admin-ajax.php`, body, {
    headers: HEADERS_ATC,
    timeout: "60s",
    tags: { endpoint: "add_to_cart" },
  });

  let ok = res.status && res.status < 400;
  try {
    const j = res.json();
    ok = ok && (j?.error === false || j?.fragments || j?.success === true);
  } catch (_) { /* ignore parse error */ }

  if (!ok) logFail("ATC", res, `${BASE}/wp-admin/admin-ajax.php`, 300);

  checkTagged(res, { "Add to Cart": () => ok }, { endpoint: "add_to_cart" });
  sleep(1);
}

// ===== 5) Checkout (3 bước) =====
export function runCheckout() {
  const HEADERS_FORM = {
    Accept: "application/json, text/javascript, */*; q=0.01",
    "Accept-Language": "en-US,en;q=0.9,vi;q=0.8",
    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    "X-Requested-With": "XMLHttpRequest",
    Origin: BASE,
    Referer: `${BASE}/checkout/`,
    "User-Agent": "k6-avotree-loadtest/1.0",
    "X-Test-Run": "avotree-loadtest",
  };

  // 5.1 GET checkout page
  const page = http.get(`${BASE}/checkout/`, { timeout: "60s", tags: { endpoint: "checkout_page" } });
  checkTagged(page, { "Checkout page OK": r => r.status && r.status < 400 }, { endpoint: "checkout_page" });

  const $ = parseHTML(page.body);
  let checkoutNonce =
    $.find('input[name="woocommerce-process-checkout-nonce"]').first().attr("value") ||
    $.find('input[name="_wpnonce"]').first().attr("value") || "";

  let uorNonce = "";
  {
    const m = page.body.match(/update_order_review_nonce["']\s*:\s*["']([^"']+)["']/) ||
              page.body.match(/"update_order_review_nonce":"([a-zA-Z0-9]+)"/);
    if (m) uorNonce = m[1];
  }

  checkTagged(
    { checkoutNonce, uorNonce },
    {
      "Checkout nonce found": v => v.checkoutNonce && v.checkoutNonce.length > 0,
      "UOR nonce found": v => v.uorNonce && v.uorNonce.length > 0,
    },
    { endpoint: "checkout_page" }
  );

  // 5.2 POST update_order_review
  const email = `loadtest+${__VU}-${__ITER}@example.com`;
  const postDataPairs = [
    "wc-points-rewards-max-points=0",
    "billing_first_name=Test",
    "billing_last_name=User",
    `billing_email=${encodeURIComponent(email)}`,
    "billing_phone=0210000000",
    "billing_country=NZ",
    "billing_address_1=1 Test St",
    "billing_city=Auckland",
    "billing_postcode=1010",
    "payment_method=cod",
  ];
  const post_data = postDataPairs.join("&");

  const uorBody = [
    `security=${encodeURIComponent(uorNonce)}`,
    `payment_method=cod`,
    `country=NZ`,
    `state=`,
    `postcode=1010`,
    `city=Auckland`,
    `address=${encodeURIComponent("1 Test St")}`,
    `address_2=`,
    `s_country=NZ`,
    `s_state=`,
    `s_postcode=`,
    `s_city=Auckland`,
    `s_address=`,
    `s_address_2=`,
    `has_full_address=true`,
    `post_data=${post_data}`,
  ].join("&");

  const uor = http.post(`${BASE}/?wc-ajax=update_order_review`, uorBody, {
    headers: HEADERS_FORM,
    timeout: "60s",
    tags: { endpoint: "update_order_review" },
  });
  checkTagged(uor, { "UOR 200": r => r.status >= 200 && r.status < 400 }, { endpoint: "update_order_review" });

  // 5.3 POST checkout finish
  const form = [
    `billing_first_name=Test`,
    `billing_last_name=User`,
    `billing_email=${encodeURIComponent(email)}`,
    `billing_phone=0210000000`,
    `billing_address_1=1 Test St`,
    `billing_city=Auckland`,
    `billing_postcode=1010`,
    `billing_country=NZ`,
    `payment_method=cod`,
    `terms=on`,
    `woocommerce-process-checkout-nonce=${encodeURIComponent(checkoutNonce)}`,
    `_wp_http_referer=%2F%3Fwc-ajax%3Dupdate_order_review`,
  ].join("&");

  const co = http.post(`${BASE}/?wc-ajax=checkout`, form, {
    headers: HEADERS_FORM,
    timeout: "60s",
    tags: { endpoint: "checkout_finish" },
  });

  const coOk = co.status && co.status < 400;

  if (!coOk) logFail("Checkout", co, `${BASE}/?wc-ajax=checkout`, 300);
  checkTagged(co, { "Checkout OK": () => coOk }, { endpoint: "checkout_finish" });

  sleep(1);
}

// ===== default =====
export default function () {
  hitHome();
  hitShopAll();
  hitPDP();
  addToCart();
  runCheckout();
  sleep(1 + Math.random()); // 1–2s
}
