import http from "k6/http";
import { check, sleep, group } from "k6";
import { parseHTML } from "k6/html";

export const options = {
	// stages: [
	//   { duration: '10s', target: 1 },  // giữ 1 VU trong 1 phút
	// ],
	stages: [
		{ duration: "2m", target: 100 }, // ramp lên 100 user
		{ duration: "5m", target: 100 }, // giữ 100 user
		{ duration: "2m", target: 200 }, // tăng lên 200 user
		{ duration: "5m", target: 200 }, // giữ 200 user
		{ duration: "2m", target: 0 }, // hạ nhiệt
	],
	// stages: [
	//   { duration: '10s', target: 20 },   // ramp lên 20 user
	//   { duration: '20s', target: 20 },   // giữ 20 user
	//   { duration: '10s', target: 50 },   // tăng lên 50 user
	//   { duration: '20s', target: 50 },   // giữ 50 user
	//   { duration: '10s', target: 0 },    // hạ nhiệt
	// ],
	// stages: [
	// 	{ duration: "30s", target: 20 }, // ramp lên 20 user
	// 	{ duration: "90s", target: 20 }, // giữ 20 user (1.5 phút)
	// 	{ duration: "30s", target: 50 }, // ramp lên 50 user
	// 	{ duration: "90s", target: 50 }, // giữ 50 user (1.5 phút)
	// 	{ duration: "40s", target: 0 }, // hạ nhiệt
	// ],
	thresholds: {
		http_req_failed: ["rate<0.05"], // cho phép fail đến 5% request
		"http_req_duration{endpoint:PDP}": ["p(95)<5000"], // 5s
		"http_req_duration{endpoint:add_to_cart}": ["p(95)<10000"], // 10s
		// "http_req_duration{endpoint:get_refreshed_fragments}": ["p(95)<5000"], // 5s
		"http_req_duration{endpoint:update_order_review}": ["p(95)<10000"], // 10s
		"http_req_duration{endpoint:checkout_page}": ["p(95)<15000"], // 15s
		"http_req_duration{endpoint:checkout}": ["p(95)<20000"], // 20s
		checks: ["rate>0.95"], // relax 95% checks pass
	},
	discardResponseBodies: false, // bật true nếu bạn chỉ quan tâm latency
};

const URL_BASE = "https://dev.theavotree.co.nz";
const PRODUCT_URL = __ENV.URL || "https://dev.theavotree.co.nz/product/hass";
// đồng bộ BASE với URL để cookie/giỏ hàng cùng domain
let BASE;
try {
	BASE = new URL(URL_BASE).origin;
} catch (_) {
	// Fallback nếu bản k6 của bạn không hỗ trợ constructor URL
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

export default function () {
	// 1) HOME Page
	group("Home Page", () => {
		const res = http.get(URL_BASE, {
			timeout: "60s",
			tags: { endpoint: "PDP" },
		});

		check(res, {
			"Home Page 200": (r) => r.status === 200,
			"Home Page": (r) => (r.body || "").length > 0,
		});

		sleep(1);
	});

	// 1) PDP
	group("Product Detail Page", () => {
		const res = http.get(PRODUCT_URL, {
			timeout: "60s",
			tags: { endpoint: "PDP" },
		});

		check(res, {
			"PDP 200": (r) => r.status === 200,
			"PDP body": (r) => (r.body || "").length > 0,
		});

		sleep(1);
	});

	// 2) Add to Cart
	group("Add To Cart", () => {
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
			`attributes%5Battribute_pa_optional-product%5D=${encodeURIComponent(
				p.attr
			)}`,
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
		let j;
		try {
			j = res.json();
			if (j && typeof j === "object") {
				console.log(`[ATC JSON] keys=${Object.keys(j).join(",")}`);
			}
			ok =
				ok &&
				(j?.error === false || j?.fragments || j?.success === true);
		} catch (e) {
			console.log(`[ATC JSON parse error] ${String(e)}`);
		}

		if (!ok) {
			console.log(
				`[ATC BODY SNIPPET] ${String(res.body || "").slice(0, 300)}`
			);
		}

		check(res, { "ATC": () => ok });
		sleep(1);
	});

	// 3) Checkout
	group("Checkout", () => {
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

		// 3.1 GET /checkout/
		const page = http.get(`${BASE}/checkout/`, {
			timeout: "60s",
			tags: { endpoint: "checkout_page" },
		});
		check(page, {
			"Checkout page < 400": (r) => r.status && r.status < 400,
		});

		const $ = parseHTML(page.body);

		// nonce cho checkout
		let checkoutNonce =
			$.find('input[name="woocommerce-process-checkout-nonce"]')
				.first()
				.attr("value") ||
			$.find('input[name="_wpnonce"]').first().attr("value") ||
			"";

		// nonce cho update_order_review
		let uorNonce = "";
		{
			const m =
				page.body.match(
					/update_order_review_nonce["']\s*:\s*["']([^"']+)["']/
				) ||
				page.body.match(/"update_order_review_nonce":"([a-zA-Z0-9]+)"/);
			if (m) uorNonce = m[1];
		}

		console.log(`[Nonce] checkout=${checkoutNonce} uor=${uorNonce}`);

		// ✅ Thêm check kết quả test cho nonce
		check(
			{ checkoutNonce, uorNonce },
			{
				"Checkout nonce found": (v) =>
					v.checkoutNonce && v.checkoutNonce.length > 0,
				"UOR nonce found": (v) => v.uorNonce && v.uorNonce.length > 0,
			}
		);

		// 3.2 POST update_order_review
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
		const post_data = encodeURIComponent(postDataPairs.join("&"));

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
			`s_city=`,
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

		check(uor, { "UOR 200": (r) => r.status >= 200 && r.status < 400 });

		// 3.3 POST checkout
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
			`woocommerce-process-checkout-nonce=${encodeURIComponent(
				checkoutNonce
			)}`,
			`_wp_http_referer=%2F%3Fwc-ajax%3Dupdate_order_review`,
		].join("&");

		const co = http.post(`${BASE}/?wc-ajax=checkout`, form, {
			headers: HEADERS_FORM,
			timeout: "60s",
			tags: { endpoint: "checkout" },
		});

		let coOk = co.status && co.status < 400;
		if (!coOk) {
			console.log(
				`[Checkout BODY SNIPPET] ${String(co.body || "").slice(0, 300)}`
			);
		}

		check(co, { "Checkout ok": () => coOk });
	});

	sleep(1 + Math.random()); // 1–2s
}
